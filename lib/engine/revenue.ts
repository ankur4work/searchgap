import type { ClassificationType } from '@prisma/client';
import { engineConfig } from './config';
import { benchmarkFor, defaultAovFor } from './benchmarks';
import { logger } from '../logger';

export interface RevenueInput {
  classificationType: ClassificationType | 'NONE';
  monthlyVolume: number;
  /** Real AOV computed from this store's own orders, in the store's currency. */
  aovCents: number | null;
  storeCategory: string | null | undefined;
  /**
   * The store's currency. Required: the category benchmarks are denominated in
   * USD, and applying one to a store trading in another currency prints a
   * number that is wrong by the exchange rate — a $60 benchmark rendered as
   * "SAR 5". Without this we cannot tell the two cases apart.
   */
  storeCurrency: string;
  /**
   * Median catalog price for this store, in the store's currency. Used ahead of
   * the USD benchmark when the store has too few recent orders, because it is
   * derived from the merchant's own data and is currency-correct by
   * construction.
   */
  catalogAovCents?: number | null;
}

export interface RevenueEstimate {
  monthlyVolume: number;
  aovCents: number;
  benchmarkPct: number;
  estimateCents: number;
  bandLowCents: number;
  bandHighCents: number;
  category: string;
  /**
   * - 'estimated_aov' — too few recent orders, used the category-typical USD
   *   benchmark. Only ever set for USD stores. The UI badges these as estimates.
   * - 'catalog_aov' — too few recent orders, used the store's median product
   *   price instead. Currency-correct and store-specific.
   * - 'no_aov' — no real AOV, no catalog prices, and the store does not trade
   *   in the benchmark currency. We deliberately produce NO figure rather than
   *   convert at an exchange rate we do not have.
   * - 'not_classified' — query was healthy, no gap.
   */
  note?: 'estimated_aov' | 'catalog_aov' | 'no_aov' | 'not_classified';
}

/**
 * Pure revenue estimate. Formula (PRD §10.3):
 *     estimate = monthlyVolume × aov × benchmarkPct
 *     band     = estimate × (1 ± CLASSIFY_REVENUE_BAND_PCT)
 *
 * Worked example: 200 × $42 × 10% = $840, band $672 – $1,008.
 *
 * Edge cases:
 *   • classification == NONE (query is fine) → zero estimate, note='not_classified'
 *   • aovCents == null (no orders yet)       → category-typical AOV,
 *     note='estimated_aov' (NOT a zero estimate — see the fallback below)
 *   • monthlyVolume <= 0                     → zero estimate
 *   • benchmark missing for category         → DEFAULT (with warn log inside benchmarkFor)
 */
export function estimateRevenue(input: RevenueInput): RevenueEstimate {
  const { pct, category } = benchmarkFor(input.storeCategory);

  if (input.classificationType === 'NONE') {
    return zero(pct, category, 'not_classified');
  }
  if (input.monthlyVolume <= 0) {
    return zero(pct, category);
  }

  // Fall back when the store has too few recent orders, so dashboards on
  // day-one show real magnitudes instead of $0 — but only via a figure that is
  // actually denominated in this store's currency.
  //
  // Order of preference:
  //   1. real AOV from the store's own orders  (always store currency)
  //   2. the store's median catalog price      (always store currency)
  //   3. the category USD benchmark            (ONLY if the store trades in USD)
  //   4. nothing — no figure at all
  //
  // Step 3's currency guard is the fix for a reported defect: the benchmarks are
  // US-dollar figures with no currency attached, so a Saudi store's single gap
  // rendered a $60 benchmark as "SAR 5" — off by the exchange rate, on the very
  // card the app was rejected over. Converting would need an FX rate we do not
  // have and cannot keep current, so we decline to state a number instead.
  let aovCents = input.aovCents;
  let note: RevenueEstimate['note'];
  if (aovCents == null) {
    const catalogAov = input.catalogAovCents;
    if (catalogAov != null && catalogAov > 0) {
      aovCents = catalogAov;
      note = 'catalog_aov';
      logger.debug(
        { catalogAovCents: aovCents, monthlyVolume: input.monthlyVolume, benchmarkPct: pct },
        'revenue.estimate using catalog median price as AOV',
      );
    } else {
      const fallback = defaultAovFor(input.storeCategory);
      if (fallback.currency !== input.storeCurrency) {
        logger.warn(
          {
            storeCurrency: input.storeCurrency,
            benchmarkCurrency: fallback.currency,
            category: input.storeCategory,
          },
          'revenue.estimate suppressed — benchmark AOV is in a different currency and no catalog prices are available',
        );
        return zero(pct, category, 'no_aov');
      }
      aovCents = fallback.aovCents;
      note = 'estimated_aov';
      logger.debug(
        {
          category: input.storeCategory,
          fallbackAovCents: aovCents,
          monthlyVolume: input.monthlyVolume,
          benchmarkPct: pct,
        },
        'revenue.estimate using fallback AOV',
      );
    }
  }

  // Integer-cents math: multiply volume × aovCents first (both integers) then
  // scale by benchmark percentage. Rounding at the end keeps numeric drift
  // below ±1 cent for the worked-example magnitudes.
  const estimateCents = Math.round(input.monthlyVolume * aovCents * pct);

  const bandPct = engineConfig.revenueBandPct;
  const bandLowCents = Math.round(estimateCents * (1 - bandPct));
  const bandHighCents = Math.round(estimateCents * (1 + bandPct));

  return {
    monthlyVolume: input.monthlyVolume,
    aovCents,
    benchmarkPct: pct,
    estimateCents,
    bandLowCents,
    bandHighCents,
    category,
    ...(note ? { note } : {}),
  };
}

function zero(pct: number, category: string, note?: RevenueEstimate['note']): RevenueEstimate {
  return {
    monthlyVolume: 0,
    aovCents: 0,
    benchmarkPct: pct,
    estimateCents: 0,
    bandLowCents: 0,
    bandHighCents: 0,
    category,
    ...(note ? { note } : {}),
  };
}
