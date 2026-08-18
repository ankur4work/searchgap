import type { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

/**
 * Minimum distinct priced products before a median is worth computing.
 *
 * This was 5, on the reasoning that a smaller sample is too easily skewed. That
 * reasoning is right in general and wrong for the case that actually matters:
 * App Store review stores are tiny. The store this app was rejected against has
 * THREE products and eight orders, so a threshold of 5 declined, and with a
 * non-USD currency blocking the benchmark too the dashboard fell all the way
 * through to showing no figure at all. An empty revenue card on a review store
 * reads as "still not syncing" — the exact conclusion we are trying to avoid.
 *
 * One priced product is enough to state something true: this merchant's own
 * prices, in this merchant's own currency, labelled as an estimate. That beats
 * both a blank card and a US-dollar benchmark wearing a riyal symbol.
 */
const MIN_PRICED_PRODUCTS = 1;

interface VariantLike {
  price?: string | number | null;
}

/**
 * Median product price for a store, in cents, in the STORE'S OWN currency.
 *
 * Used as the average-order-value stand-in when a store has too few recent
 * orders to compute a real AOV. It is a proxy — a basket is not one product —
 * but it beats the alternative it replaces: a US-dollar industry benchmark
 * printed under a non-USD currency symbol, which is wrong by the exchange rate.
 * Prices come from the catalog sync, which stores Shopify's `shopMoney`, so the
 * currency always matches the store's.
 *
 * Median rather than mean: one $9,000 item in a catalog of $30 items should not
 * drag every revenue estimate on the dashboard up with it.
 *
 * Returns null when the catalog has too few priced products to be meaningful.
 */
export async function catalogMedianPriceCents(
  prisma: PrismaClient,
  storeId: string,
): Promise<number | null> {
  const products = await prisma.catalogProduct.findMany({
    where: { storeId },
    select: { variantsJson: true },
  });

  const pricesCents: number[] = [];
  for (const p of products) {
    const variants = Array.isArray(p.variantsJson)
      ? (p.variantsJson as unknown as VariantLike[])
      : [];
    // One price per product, not per variant — a product with 40 size variants
    // would otherwise count 40 times and dominate the median.
    const productPrices: number[] = [];
    for (const v of variants) {
      const raw = typeof v?.price === 'number' ? v.price : Number.parseFloat(String(v?.price ?? ''));
      if (!Number.isFinite(raw) || raw <= 0) continue;
      productPrices.push(Math.round(raw * 100));
    }
    if (productPrices.length === 0) continue;
    productPrices.sort((a, b) => a - b);
    pricesCents.push(median(productPrices));
  }

  if (pricesCents.length < MIN_PRICED_PRODUCTS) {
    logger.debug(
      { storeId, pricedProducts: pricesCents.length, min: MIN_PRICED_PRODUCTS },
      'catalog median price unavailable — too few priced products',
    );
    return null;
  }

  pricesCents.sort((a, b) => a - b);
  const value = median(pricesCents);
  logger.debug(
    { storeId, pricedProducts: pricesCents.length, medianPriceCents: value },
    'catalog median price computed',
  );
  return value;
}

/** Median of a pre-sorted, non-empty array. Even lengths average the middle pair. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}
