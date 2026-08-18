import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { catalogMedianPriceCents } from '@/lib/engine/catalog-aov';

/**
 * The store-currency AOV stand-in that replaces the USD benchmark for non-USD
 * stores. Prices come from the catalog sync, which stores Shopify `shopMoney`,
 * so whatever this returns is denominated in the store's own currency.
 */
function fakePrisma(products: Array<{ variantsJson: unknown }>): PrismaClient {
  return {
    catalogProduct: { findMany: async () => products },
  } as unknown as PrismaClient;
}

const priced = (...prices: Array<string | number>): { variantsJson: unknown } => ({
  variantsJson: prices.map((price) => ({ price })),
});

describe('catalogMedianPriceCents', () => {
  it('returns the median product price in cents', () => {
    const p = fakePrisma([priced('10.00'), priced('20.00'), priced('30.00'), priced('40.00'), priced('50.00')]);
    return expect(catalogMedianPriceCents(p, 's1')).resolves.toBe(3_000);
  });

  it('is not dragged up by a single outlier, unlike a mean', async () => {
    const withOutlier = fakePrisma([
      priced('30.00'), priced('30.00'), priced('30.00'), priced('30.00'), priced('9000.00'),
    ]);
    // Mean would be ~$1,824. Median stays honest.
    await expect(catalogMedianPriceCents(withOutlier, 's1')).resolves.toBe(3_000);
  });

  it('counts each product once, not once per variant', async () => {
    // One cheap product with 40 size variants must not outvote four dear ones.
    const manyVariants = { variantsJson: Array.from({ length: 40 }, () => ({ price: '5.00' })) };
    const p = fakePrisma([
      manyVariants,
      priced('100.00'), priced('100.00'), priced('100.00'), priced('100.00'),
    ]);
    await expect(catalogMedianPriceCents(p, 's1')).resolves.toBe(10_000);
  });

  it('returns null below the minimum sample rather than guessing', async () => {
    const p = fakePrisma([priced('10.00'), priced('20.00'), priced('30.00'), priced('40.00')]);
    await expect(catalogMedianPriceCents(p, 's1')).resolves.toBeNull();
  });

  it('returns null for an empty catalog — the state a stalled sync leaves behind', async () => {
    await expect(catalogMedianPriceCents(fakePrisma([]), 's1')).resolves.toBeNull();
  });

  it('skips unpriced, zero, negative and malformed variants', async () => {
    const p = fakePrisma([
      { variantsJson: [{ price: null }] },
      { variantsJson: [{ price: '0.00' }] },
      { variantsJson: [{ price: '-5.00' }] },
      { variantsJson: [{ price: 'free' }] },
      { variantsJson: null },
      priced('10.00'), priced('20.00'), priced('30.00'), priced('40.00'), priced('50.00'),
    ]);
    await expect(catalogMedianPriceCents(p, 's1')).resolves.toBe(3_000);
  });

  it('accepts numeric as well as string prices', async () => {
    const p = fakePrisma([priced(10), priced(20), priced(30), priced(40), priced(50)]);
    await expect(catalogMedianPriceCents(p, 's1')).resolves.toBe(3_000);
  });

  it('averages the middle pair for an even sample', async () => {
    const p = fakePrisma([priced('10.00'), priced('20.00'), priced('30.00'), priced('50.00'), priced('60.00'), priced('70.00')]);
    expect(await catalogMedianPriceCents(p, 's1')).toBe(4_000);
  });
});
