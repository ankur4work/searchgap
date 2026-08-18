import { describe, it, expect } from 'vitest';
import { estimateRevenue } from '@/lib/engine/revenue';
import { defaultAovFor, benchmarkFor } from '@/lib/engine/benchmarks';

/**
 * Regression cover for the "SAR 5" defect.
 *
 * The category AOV benchmarks are US-dollar figures that carried no currency,
 * so a store trading in SAR had a $60 benchmark rendered under its own symbol:
 *   1 gap x 6000 cents x 0.08 = 480 -> "SAR 5"
 * — wrong by the exchange rate, on the very card the app was rejected over.
 */
describe('estimateRevenue — currency safety', () => {
  const base = {
    classificationType: 'TYPE_1' as const,
    monthlyVolume: 1,
    aovCents: null,
    storeCategory: 'DEFAULT',
  };

  it('reproduces the rejected figure when the store trades in the benchmark currency', () => {
    // Same arithmetic as before — for USD stores the behaviour is unchanged.
    const out = estimateRevenue({ ...base, storeCurrency: 'USD' });
    expect(out.estimateCents).toBe(480);
    expect(out.note).toBe('estimated_aov');
  });

  it('produces NO figure for a non-USD store with nothing else to go on', () => {
    const out = estimateRevenue({ ...base, storeCurrency: 'SAR' });
    expect(out.estimateCents).toBe(0);
    expect(out.note).toBe('no_aov');
  });

  it('never applies a USD benchmark to a non-USD store, for any category', () => {
    for (const category of ['FASHION', 'BEAUTY', 'ELECTRONICS', 'HOME', 'FOOD', 'DEFAULT']) {
      for (const currency of ['SAR', 'INR', 'EUR', 'JPY', 'GBP']) {
        const out = estimateRevenue({
          ...base,
          monthlyVolume: 50,
          storeCategory: category,
          storeCurrency: currency,
        });
        expect(out.estimateCents, `${category}/${currency} used the USD benchmark`).toBe(0);
        expect(out.note).toBe('no_aov');
      }
    }
  });

  it('uses the catalog median price for a non-USD store, in that store currency', () => {
    // 300 SAR median product price, 1 search, 8% default benchmark.
    const out = estimateRevenue({
      ...base,
      storeCurrency: 'SAR',
      catalogAovCents: 30_000,
    });
    expect(out.aovCents).toBe(30_000);
    expect(out.estimateCents).toBe(Math.round(1 * 30_000 * benchmarkFor('DEFAULT').pct));
    expect(out.note).toBe('catalog_aov');
  });

  it('prefers real order AOV over both fallbacks', () => {
    const out = estimateRevenue({
      ...base,
      aovCents: 12_345,
      storeCurrency: 'SAR',
      catalogAovCents: 30_000,
    });
    expect(out.aovCents).toBe(12_345);
    expect(out.note).toBeUndefined();
  });

  it('prefers the catalog median over the USD benchmark even for a USD store', () => {
    // The merchant's own prices beat an industry average whenever we have them.
    const out = estimateRevenue({ ...base, storeCurrency: 'USD', catalogAovCents: 9_900 });
    expect(out.aovCents).toBe(9_900);
    expect(out.note).toBe('catalog_aov');
    expect(out.aovCents).not.toBe(defaultAovFor('DEFAULT').aovCents);
  });

  it('treats an unknown store currency as "not the benchmark currency"', () => {
    // store.currency is null until the order ingest runs; guessing USD there is
    // how a non-USD store gets a dollar figure in the first place.
    const out = estimateRevenue({ ...base, storeCurrency: '' });
    expect(out.estimateCents).toBe(0);
    expect(out.note).toBe('no_aov');
  });

  it('ignores a nonsensical catalog AOV rather than trusting it', () => {
    for (const bad of [0, -1]) {
      const out = estimateRevenue({ ...base, storeCurrency: 'SAR', catalogAovCents: bad });
      expect(out.estimateCents).toBe(0);
      expect(out.note).toBe('no_aov');
    }
  });

  it('declares the benchmark currency explicitly', () => {
    expect(defaultAovFor('FASHION').currency).toBe('USD');
    expect(defaultAovFor(null).currency).toBe('USD');
  });
});
