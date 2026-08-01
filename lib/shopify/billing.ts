import type { Plan, Store } from '@prisma/client';
import { ShopifyClient } from './client';
import { env } from '../env';

/**
 * Shopify App Pricing (formerly "Managed Pricing").
 *
 * Plans live in the Shopify dev dashboard, NOT in this codebase. Shopify hosts
 * the plan-selection page, creates the subscription, and handles trials,
 * proration, upgrades, downgrades and test charges. The app never calls
 * appSubscriptionCreate.
 *
 * Consequences that matter when editing this file:
 *
 *  1. **Never hard-code a price.** The app owner changes pricing in the
 *     dashboard and it must take effect with no deploy. Any amount shown to a
 *     merchant has to come from `fetchActiveSubscription` (their real, current
 *     subscription) or not be shown at all. A literal here would silently
 *     disagree with what Shopify actually bills.
 *  2. Entitlement is derived from *having* an active subscription, not from
 *     matching a price or a plan name typed into the dashboard.
 */

const ACTIVE_SUBSCRIPTION_QUERY = /* GraphQL */ `
  query ActiveAppSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface ActiveSubscriptionResp {
  currentAppInstallation: {
    activeSubscriptions: Array<{
      id: string;
      name: string;
      status: string;
      test: boolean;
      trialDays: number;
      currentPeriodEnd: string | null;
      lineItems: Array<{
        id: string;
        plan: {
          pricingDetails: {
            __typename: string;
            interval?: string;
            price?: { amount: string; currencyCode: string };
          };
        };
      }>;
    }>;
  } | null;
}

export interface ActiveSubscription {
  id: string;
  /** Plan name as configured in the dashboard — display only, never matched on. */
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  /** Live recurring price. Null for plans with no recurring line item. */
  price: { amount: string; currencyCode: string; interval: string } | null;
}

/**
 * The merchant's current subscription, straight from Shopify.
 *
 * This is the authoritative source for both entitlement and the displayed
 * price. The `Store.plan` column is only a cache kept warm by the
 * app_subscriptions/update webhook, so it can lag a dashboard price change or a
 * merchant action by however long delivery takes.
 *
 * Returns null when the merchant has no active subscription (i.e. free), and
 * also on API failure — callers must treat null as "not entitled" rather than
 * failing open, so a Shopify outage can't hand out paid features.
 */
export async function fetchActiveSubscription(
  store: Pick<Store, 'shopDomain' | 'accessToken'>,
): Promise<ActiveSubscription | null> {
  const client = new ShopifyClient(store);
  const resp = await client.graphql<ActiveSubscriptionResp>(ACTIVE_SUBSCRIPTION_QUERY);
  const subs = resp.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const sub = subs.find((s) => s.status === 'ACTIVE') ?? subs[0];
  if (!sub) return null;

  const recurring = sub.lineItems
    .map((li) => li.plan.pricingDetails)
    .find((d) => d.__typename === 'AppRecurringPricing' && d.price);

  return {
    id: sub.id,
    name: sub.name,
    status: sub.status,
    test: sub.test,
    trialDays: sub.trialDays,
    currentPeriodEnd: sub.currentPeriodEnd,
    price:
      recurring?.price && recurring.interval
        ? {
            amount: recurring.price.amount,
            currencyCode: recurring.price.currencyCode,
            interval: recurring.interval,
          }
        : null,
  };
}

/**
 * Map a Shopify subscription onto our internal entitlement tier.
 *
 * Paid means: an ACTIVE subscription carrying a recurring charge above zero.
 *
 * The "above zero" part matters as soon as a **Free plan is defined in the
 * dashboard**. A managed Free plan still produces a real ACTIVE subscription —
 * one with a $0 recurring price — so treating mere existence of a subscription
 * as paid would hand every free merchant the full Growth feature set.
 *
 * This is a zero-check, not a price match: it asks "is this plan billable?",
 * never "is this plan $9?". Editing the amount in the dashboard changes nothing
 * here, which is the whole point of Shopify App Pricing.
 *
 * Names are deliberately NOT matched on — they are free text the app owner
 * edits per language, so matching would drop paying merchants to FREE the
 * moment someone renamed a plan.
 *
 * Caveat: a plan billed purely through usage meters, with no recurring line
 * item, would read as free here. GapFinder has no usage charges; add a meter
 * check alongside this if that ever changes.
 *
 * If a second paid tier is ever added, match on the plan HANDLE (stable) here —
 * never the display name, and never the amount.
 */
export function planFromSubscription(sub: ActiveSubscription | null): Plan {
  if (!sub || sub.status !== 'ACTIVE') return 'FREE';
  const amount = Number(sub.price?.amount ?? '0');
  if (!Number.isFinite(amount) || amount <= 0) return 'FREE';
  return 'GROWTH';
}

/**
 * Shopify-hosted plan selection page for this app.
 *
 * Pattern (per Shopify App Pricing docs):
 *   https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans
 *
 * `store_handle` is the myshopify subdomain; `app_handle` is the app's handle in
 * the dev dashboard, supplied via SHOPIFY_APP_HANDLE so a rename doesn't need a
 * code change. Embedded apps must open this at the TOP window — it lives on
 * admin.shopify.com, so an in-iframe navigation is blocked.
 */
export function planSelectionUrl(shopDomain: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${storeHandle}/charges/${env.SHOPIFY_APP_HANDLE}/pricing_plans`;
}
