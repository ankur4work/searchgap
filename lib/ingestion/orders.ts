import type { Store } from '@prisma/client';
import { ShopifyClient } from '../shopify/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { updateProgress } from './runs';

const ORDERS_QUERY = /* GraphQL */ `
  query IngestOrders($first: Int!, $after: String, $q: String!) {
    orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
          displayFinancialStatus
          currentTotalPriceSet {
            shopMoney { amount currencyCode }
          }
        }
      }
    }
    shop { currencyCode }
  }
`;

interface OrdersResponse {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        createdAt: string;
        displayFinancialStatus: string | null;
        currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      };
    }>;
  };
  shop: { currencyCode: string };
}

const EXCLUDED_STATUSES = new Set([
  'VOIDED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);

const MIN_ORDERS_FOR_AOV = 10;

export interface OrdersIngestionResult {
  orderCount: number;
  aovCents: number | null;
  currency: string;
  insufficientData: boolean;
}

/**
 * Order lookback, in days.
 *
 * Capped at 60 deliberately. The app requests `read_orders`, which Shopify
 * limits to orders from the last 60 days — asking for 90 did not return 90, it
 * silently returned 60 while the code believed it had a full quarter. On a
 * store whose orders were mostly older than that, fewer than
 * MIN_ORDERS_FOR_AOV survived, `aovCents` came back null, and every revenue
 * figure fell through to the generic category AOV. That is how a store with 48
 * visible orders in the Shopify admin produced a "Revenue at risk" built on a
 * $60 industry default.
 *
 * Reading further back requires the `read_all_orders` scope, which needs
 * Shopify's approval; until then the honest window is 60 days and the UI
 * badges the estimate when real AOV is unavailable.
 */
export const ORDER_WINDOW_DAYS = 60;

export async function ingestOrders(
  store: Store,
  opts: { windowDays: number; runId?: string } = { windowDays: ORDER_WINDOW_DAYS },
): Promise<OrdersIngestionResult> {
  const client = new ShopifyClient(store);
  const since = new Date(Date.now() - opts.windowDays * 86_400_000).toISOString();
  const q = `created_at:>=${since}`;

  let cursor: string | null = null;
  let totalCents = 0;
  let count = 0;
  let page = 0;
  let storeCurrency = 'USD';

  do {
    // Explicit type annotation — the do/while + cursor reassignment confuses
    // TS's inference, so `resp` silently became `any` without this.
    const resp: Awaited<ReturnType<typeof client.graphql<OrdersResponse>>> =
      await client.graphql<OrdersResponse>(ORDERS_QUERY, {
        first: 250,
        after: cursor,
        q,
      });
    if (resp.errors?.length) {
      throw new Error(`orders query errors: ${resp.errors.map((e) => e.message).join('; ')}`);
    }
    const data = resp.data;
    if (!data) throw new Error('orders query returned no data');

    storeCurrency = data.shop.currencyCode;

    for (const edge of data.orders.edges) {
      const status = edge.node.displayFinancialStatus?.toUpperCase();
      if (status && EXCLUDED_STATUSES.has(status)) continue;
      const shopMoney = edge.node.currentTotalPriceSet.shopMoney;
      // Pin to shop's primary currency — ignore presentment variance.
      if (shopMoney.currencyCode !== storeCurrency) continue;
      const amount = Number.parseFloat(shopMoney.amount);
      if (!Number.isFinite(amount)) continue;
      totalCents += Math.round(amount * 100);
      count += 1;
    }

    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    page += 1;
    if (opts.runId) await updateProgress(opts.runId, Math.min(90, page * 10));
  } while (cursor);

  const insufficientData = count < MIN_ORDERS_FOR_AOV;
  const aovCents = insufficientData || count === 0 ? null : Math.round(totalCents / count);

  await prisma.store.update({
    where: { id: store.id },
    data: {
      aovCents,
      currency: storeCurrency,
      orderSampleSize: count,
      insufficientAov: insufficientData,
      lastOrderSync: new Date(),
    },
  });

  logger.info(
    { shop: store.shopDomain, count, aovCents, currency: storeCurrency, insufficientData },
    'Orders ingestion complete',
  );
  return { orderCount: count, aovCents, currency: storeCurrency, insufficientData };
}
