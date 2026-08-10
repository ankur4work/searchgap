import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { ClassificationType, PrismaClient } from '@prisma/client';
import { protectedProcedure, router, FREE_PLAN_VISIBLE_GAPS } from '../trpc';
import { bucketForEstimate } from '@/lib/money';
import { getOrCompute, summaryCacheKey } from '@/lib/cache';
import { env } from '@/lib/env';
import { decrypt } from '@/lib/crypto';
import { ADMIN_API_VERSION } from '@/lib/shopify/client';

const TypeFilterSchema = z.enum(['ALL', 'TYPE_1', 'TYPE_2', 'TYPE_3', 'TYPE_4']);

/**
 * The reporting window, shared by `summary` and `searchTrend`. Both procedures
 * MUST accept the same range: the cards previously hardcoded 30 days while the
 * chart offered 7–90, so selecting any other range put a "last 30 days" total
 * next to a 90-day plot and the two read as unsynchronized data.
 */
export const DEFAULT_WINDOW_DAYS = 30;
const WindowSchema = z
  .object({ days: z.number().int().min(7).max(90).default(DEFAULT_WINDOW_DAYS) })
  .optional();

function latestDate(dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

export const dashboardRouter = router({
  /**
   * Headline cards. Takes the SAME `days` window as `searchTrend` so the two
   * can never disagree: a reviewer switching the chart to 90 days moves the
   * cards with it.
   *
   * Every figure here is derived from one windowed population — see
   * `computeSummary`.
   */
  summary: protectedProcedure
    .input(WindowSchema)
    .query(async ({ ctx, input }) => {
      if (!ctx.session.storeId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No store in session' });
      const storeId = ctx.session.storeId;
      const days = input?.days ?? DEFAULT_WINDOW_DAYS;
      return getOrCompute(summaryCacheKey(storeId, days), env.DASHBOARD_SUMMARY_CACHE_TTL_SEC, () =>
        computeSummary(ctx.prisma, storeId, days),
      );
    }),

  /**
   * Daily search + gap volume for the trend chart.
   *
   * Two series on ONE scale (both are counts of searches), so they are directly
   * comparable — deliberately not a dual-axis chart. `gaps` is the subset of
   * `searches` whose query currently classifies as a gap, which is why it is
   * always <= searches and reads as an area beneath it.
   *
   * Days with no activity are emitted as zeros rather than omitted: a gap in
   * the x-axis would imply "no data" when the truth is "no searches", and it
   * would also make the line lie by connecting across the missing days.
   */
  searchTrend: protectedProcedure
    .input(WindowSchema)
    .query(async ({ ctx, input }) => {
      if (!ctx.session.storeId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No store in session' });
      }
      const days = input?.days ?? DEFAULT_WINDOW_DAYS;
      const storeId = ctx.session.storeId;
      const since = new Date(Date.now() - days * 86_400_000);

      const rows = await ctx.prisma.$queryRaw<
        Array<{ day: Date; searches: number; gaps: number }>
      >`
        SELECT sq.date_bucket AS day,
               SUM(sq.occurrence_count)::int AS searches,
               SUM(CASE WHEN c.id IS NOT NULL THEN sq.occurrence_count ELSE 0 END)::int AS gaps
        FROM search_queries sq
        LEFT JOIN classifications c
          ON c.store_id = sq.store_id
         AND c.query_norm = sq.query_normalized
        WHERE sq.store_id = ${storeId}
          AND sq.occurred_at >= ${since}
        GROUP BY sq.date_bucket
        ORDER BY sq.date_bucket
      `;

      const byDay = new Map(
        rows.map((r) => [
          new Date(r.day).toISOString().slice(0, 10),
          { searches: Number(r.searches), gaps: Number(r.gaps) },
        ]),
      );

      const series: Array<{ date: string; searches: number; gaps: number }> = [];
      const cursor = new Date(Date.now() - (days - 1) * 86_400_000);
      for (let i = 0; i < days; i += 1) {
        const key = new Date(
          Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()),
        )
          .toISOString()
          .slice(0, 10);
        const hit = byDay.get(key);
        series.push({ date: key, searches: hit?.searches ?? 0, gaps: hit?.gaps ?? 0 });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      const totalSearches = series.reduce((acc, d) => acc + d.searches, 0);
      const totalGaps = series.reduce((acc, d) => acc + d.gaps, 0);
      return { days, series, totalSearches, totalGaps };
    }),

  gaps: protectedProcedure
    .input(
      z.object({
        type: TypeFilterSchema.default('ALL'),
        limit: z.number().int().positive().max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.session.storeId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No store resolved' });
      }
      const storeId = ctx.session.storeId;
      const plan = ctx.session.plan ?? 'FREE';

      // NOTE: We intentionally do NOT filter out low-volume gaps on FREE. A
      // brand-new store (and an App Reviewer doing a burst of distinct test
      // searches) initially has ONLY low-volume gaps — hiding them made the
      // FREE list render empty while the stat card still claimed gaps existed,
      // which read as "the app is broken". Monetization is preserved by the
      // blur-lock below: FREE still only reveals the top FREE_PLAN_VISIBLE_GAPS
      // (ordered by occurrence/revenue, so genuine high-volume gaps win the
      // visible slots), with the rest shown blurred behind the upgrade CTA.
      const where = {
        storeId,
        ...(input.type === 'ALL' ? {} : { type: input.type }),
      };

      const [total, rows] = await Promise.all([
        ctx.prisma.classification.count({ where }),
        ctx.prisma.classification.findMany({
          where,
          include: { revenueEstimates: true },
          orderBy: [{ occurrenceCount: 'desc' }, { queryNorm: 'asc' }],
          take: input.limit * 2,
          skip: input.offset,
        }),
      ]);

      // Rank by how often shoppers searched it, THEN by revenue.
      //
      // Revenue used to lead. Since revenue is occurrences x AOV x benchmark and
      // the last two are constant per store, the two orders normally agree — but
      // when every gap has been searched once they all tie on revenue and fall
      // through to the alphabetical tiebreak, so the list reads as if it isn't
      // ranked at all. Occurrences are also what the column actually shows, so
      // leading with them makes the ordering self-evident.
      rows.sort((a, b) => {
        if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
        const av = a.revenueEstimates[0]?.estimateCents ?? 0;
        const bv = b.revenueEstimates[0]?.estimateCents ?? 0;
        if (bv !== av) return bv - av;
        return a.queryNorm.localeCompare(b.queryNorm);
      });
      const paged = rows.slice(0, input.limit);

      const matchedIds = Array.from(
        new Set(paged.flatMap((r) => r.matchedProductIds.slice(0, 3))),
      );
      const products = matchedIds.length
        ? await ctx.prisma.catalogProduct.findMany({
            where: { id: { in: matchedIds } },
            select: { id: true, title: true, shopifyProductId: true },
          })
        : [];
      const titleById = new Map(products.map((p) => [p.id, p]));

      let lockedRevenueSumCents = 0;
      const gaps = paged.map((c, i) => {
        const globalIndex = i + input.offset;
        const visible = plan !== 'FREE' || globalIndex < FREE_PLAN_VISIBLE_GAPS;
        const revenue = c.revenueEstimates[0] ?? null;
        const titles = c.matchedProductIds
          .slice(0, 3)
          .map((id) => titleById.get(id)?.title)
          .filter((t): t is string => Boolean(t));

        if (!visible && revenue) lockedRevenueSumCents += revenue.estimateCents;

        return {
          id: c.id,
          queryNorm: c.queryNorm,
          type: c.type,
          confidence: c.confidence,
          occurrenceCount: c.occurrenceCount,
          matchedProductIds: visible ? c.matchedProductIds : [],
          matchedProductTitles: visible ? titles : [],
          lowVolume: c.lowVolume,
          locked: !visible,
          estimateCents: visible ? revenue?.estimateCents ?? 0 : null,
          bandLowCents: visible ? revenue?.bandLowCents ?? 0 : null,
          bandHighCents: visible ? revenue?.bandHighCents ?? 0 : null,
          revenueBucket: revenue ? bucketForEstimate(revenue.estimateCents) : null,
          reasoning: visible ? c.reasoning : null,
        };
      });

      return {
        gaps,
        total,
        lockedCount: gaps.filter((g) => g.locked).length,
        lockedRevenueSumCents,
        plan,
      };
    }),

  trend: protectedProcedure
    .input(z.object({ queryNormalized: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.session.storeId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const rows = await ctx.prisma.searchQuery.findMany({
        where: {
          storeId: ctx.session.storeId,
          queryNormalized: input.queryNormalized,
          occurredAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
        },
        orderBy: { dateBucket: 'asc' },
        select: { dateBucket: true, occurrenceCount: true },
      });
      return rows.map((r) => ({ date: r.dateBucket, count: r.occurrenceCount }));
    }),

  trackerStatus: protectedProcedure.query(async ({ ctx }) => {
    const NULL_STATUS = { enabled: null as boolean | null, passwordProtected: null as boolean | null };
    if (!ctx.session?.storeId) return NULL_STATUS;
    const storeId = ctx.session.storeId;
    const cacheKey = `dash:tracker-status:v5:${storeId}`;
    return getOrCompute(cacheKey, 300, async () => {
      const store = await ctx.prisma.store.findUnique({
        where: { id: storeId },
        select: { shopDomain: true, accessToken: true },
      });
      if (!store) return NULL_STATUS;

      // Is the storefront password-protected? A locked storefront 302-redirects
      // its root to /password. We surface this so the app can warn the merchant
      // (their test searches + "Open storefront" can't work while it's locked)
      // instead of silently dead-ending them on Shopify's password gate.
      // null = couldn't determine (network/error); don't show the warning then.
      let passwordProtected: boolean | null = null;
      try {
        const sfRes = await fetch(`https://${store.shopDomain}/`, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': 'GapFinder-Tracker-Check' },
        });
        const loc = sfRes.headers.get('location') ?? '';
        passwordProtected =
          (sfRes.status >= 300 && sfRes.status < 400 && /\/password(\b|\/|$)/.test(loc)) ||
          sfRes.url.endsWith('/password');
      } catch {
        passwordProtected = null;
      }

      try {
        const token = decrypt(store.accessToken);
        const headers = {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        };

        const themesRes = await fetch(
          `https://${store.shopDomain}/admin/api/${ADMIN_API_VERSION}/themes.json?role=main`,
          { headers },
        );
        if (!themesRes.ok) return { enabled: null as boolean | null, passwordProtected };

        const themesData = (await themesRes.json()) as {
          themes: Array<{ id: number; role: string }>;
        };
        const mainTheme = themesData.themes.find((t) => t.role === 'main');
        if (!mainTheme) return { enabled: null as boolean | null, passwordProtected };

        const assetRes = await fetch(
          `https://${store.shopDomain}/admin/api/${ADMIN_API_VERSION}/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
          { headers },
        );
        if (!assetRes.ok) return { enabled: null as boolean | null, passwordProtected };

        const assetData = (await assetRes.json()) as { asset: { value: string } };

        type ThemeBlock = { type: string; disabled?: boolean; blocks?: Record<string, ThemeBlock> };
        type SettingsData = {
          current?: {
            blocks?: Record<string, ThemeBlock>;
            sections?: Record<string, { type?: string; disabled?: boolean; blocks?: Record<string, ThemeBlock> }>;
          };
        };
        const settings = JSON.parse(assetData.asset.value) as SettingsData;

        function isTrackerBlock(b: ThemeBlock): boolean {
          // Theme block type: shopify://apps/<app-handle>/blocks/<block-handle>/<uid>
          // Match on the BLOCK handle (`tracker`, from blocks/tracker.liquid),
          // not the app handle. The app handle changes when the app is renamed
          // or re-created — it was previously hardcoded as `lostsearch`, which
          // silently broke tracker detection after the DemandRadar rebrand. The
          // block handle is stable across renames.
          return /^shopify:\/\/apps\/[^/]+\/blocks\/tracker\//.test(b.type);
        }

        // App embed blocks live at current.blocks in OS 2.0 themes.
        // Some themes store them nested inside sections — search both.
        const topBlocks = Object.values(settings.current?.blocks ?? {});
        const sectionBlocks = Object.values(settings.current?.sections ?? {}).flatMap(
          (s) => Object.values(s.blocks ?? {}),
        );
        const trackerBlock = [...topBlocks, ...sectionBlocks].find(isTrackerBlock);

        ctx.logger.info(
          { shop: store.shopDomain, found: !!trackerBlock, enabled: trackerBlock ? trackerBlock.disabled !== true : false },
          'trackerStatus check',
        );

        if (!trackerBlock) return { enabled: false, passwordProtected };
        return { enabled: trackerBlock.disabled !== true, passwordProtected };
      } catch {
        return { enabled: null as boolean | null, passwordProtected };
      }
    });
  }),

  markDashboardViewed: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.session.storeId) return { isFirstView: false };
    const result = await ctx.prisma.store.updateMany({
      where: { id: ctx.session.storeId, firstDashboardViewAt: null },
      data: { firstDashboardViewAt: new Date() },
    });
    return { isFirstView: result.count === 1 };
  }),
});

/**
 * One windowed population, every card derived from it.
 *
 * Shopify rejected the app under 2.1.4 because these cards contradicted each
 * other: "searches tracked" filtered `search_queries` to the last 30 days,
 * while "gaps identified" and "revenue at risk" summed `classifications` and
 * `revenue_estimates` filtered by store ONLY. Three cards on one row counted
 * three different time ranges, so the dashboard could show more gaps than
 * searches, and revenue that no search in the window justified. Pruning aged
 * rows in the classification job narrowed the drift but could not remove it —
 * between runs the tables genuinely disagree.
 *
 * So the window is applied at READ time, in SQL, from a single CTE:
 *   - `windowed` is the authoritative set — queries with searches in range.
 *   - gaps and revenue are LEFT JOINed onto it, so a classification can only
 *     count if a search in the window justifies it.
 * Correctness no longer depends on a background job having run recently.
 *
 * `revenue_estimates` is joined via a LATERAL taking only the newest row per
 * classification. The pipeline replaces estimates idempotently, so today there
 * is at most one — the LATERAL means a duplicate could never silently double
 * the headline figure.
 */
interface WindowedTotals {
  total_searches: number;
  type_1: number;
  type_2: number;
  type_3: number;
  type_4: number;
  revenue_cents: number;
  band_low_cents: number;
  band_high_cents: number;
  last_classified_at: Date | null;
}

async function computeWindowedTotals(
  prisma: PrismaClient,
  storeId: string,
  since: Date,
): Promise<WindowedTotals> {
  const rows = await prisma.$queryRaw<WindowedTotals[]>`
    WITH windowed AS (
      SELECT sq.query_normalized AS q,
             SUM(sq.occurrence_count)::int AS occurrences
      FROM search_queries sq
      WHERE sq.store_id = ${storeId}
        AND sq.occurred_at >= ${since}
      GROUP BY sq.query_normalized
    )
    SELECT
      COALESCE(SUM(w.occurrences), 0)::int                                  AS total_searches,
      COUNT(c.id) FILTER (WHERE c.type = 'TYPE_1')::int                     AS type_1,
      COUNT(c.id) FILTER (WHERE c.type = 'TYPE_2')::int                     AS type_2,
      COUNT(c.id) FILTER (WHERE c.type = 'TYPE_3')::int                     AS type_3,
      COUNT(c.id) FILTER (WHERE c.type = 'TYPE_4')::int                     AS type_4,
      COALESCE(SUM(re.estimate_cents), 0)::int                              AS revenue_cents,
      COALESCE(SUM(re.band_low_cents), 0)::int                              AS band_low_cents,
      COALESCE(SUM(re.band_high_cents), 0)::int                             AS band_high_cents,
      MAX(c.created_at)                                                     AS last_classified_at
    FROM windowed w
    LEFT JOIN classifications c
      ON c.store_id = ${storeId}
     AND c.query_norm = w.q
    LEFT JOIN LATERAL (
      SELECT r.estimate_cents, r.band_low_cents, r.band_high_cents
      FROM revenue_estimates r
      WHERE r.classification_id = c.id
      ORDER BY r.created_at DESC
      LIMIT 1
    ) re ON TRUE
  `;

  return (
    rows[0] ?? {
      total_searches: 0,
      type_1: 0,
      type_2: 0,
      type_3: 0,
      type_4: 0,
      revenue_cents: 0,
      band_low_cents: 0,
      band_high_cents: 0,
      last_classified_at: null,
    }
  );
}

async function computeSummary(
  prisma: PrismaClient,
  storeId: string,
  days: number = DEFAULT_WINDOW_DAYS,
): Promise<DashboardSummary> {
  const since = new Date(Date.now() - days * 86_400_000);

  const [store, totals, topGap] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: {
        shopDomain: true,
        plan: true,
        currency: true,
        industry: true,
        category: true,
        aovCents: true,
        insufficientAov: true,
        lastSearchSync: true,
        lastProductSync: true,
        lastOrderSync: true,
        firstDashboardViewAt: true,
      },
    }),
    computeWindowedTotals(prisma, storeId, since),
    // The headline gap must also be inside the window — otherwise the card
    // could name a query nothing in the current range accounts for.
    prisma.classification.findFirst({
      where: {
        storeId,
        lowVolume: false,
        type: { not: 'UNCAT' },
        queryNorm: {
          in: (
            await prisma.searchQuery.findMany({
              where: { storeId, occurredAt: { gte: since } },
              select: { queryNormalized: true },
              distinct: ['queryNormalized'],
              take: 1000,
            })
          ).map((r) => r.queryNormalized),
        },
      },
      orderBy: [{ occurrenceCount: 'desc' }],
      include: { revenueEstimates: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
  ]);

  const countsByType: Record<ClassificationType, number> = {
    TYPE_1: totals.type_1,
    TYPE_2: totals.type_2,
    TYPE_3: totals.type_3,
    TYPE_4: totals.type_4,
    UNCAT: 0,
  };

  return {
    windowDays: days,
    storeName: store?.shopDomain.replace(/\.myshopify\.com$/, '') ?? 'Store',
    shopDomain: store?.shopDomain ?? '',
    plan: store?.plan ?? 'FREE',
    currency: store?.currency ?? 'USD',
    industry: store?.industry ?? null,
    category: store?.category ?? 'DEFAULT',
    aovCents: store?.aovCents ?? null,
    insufficientAov: store?.insufficientAov ?? false,
    lastSyncedAt: latestDate([
      store?.lastSearchSync,
      store?.lastProductSync,
      store?.lastOrderSync,
    ]),
    firstDashboardViewAt: store?.firstDashboardViewAt ?? null,
    revenueImpactCents: totals.revenue_cents,
    bandLowCents: totals.band_low_cents,
    bandHighCents: totals.band_high_cents,
    countsByType: {
      TYPE_1: countsByType.TYPE_1,
      TYPE_2: countsByType.TYPE_2,
      TYPE_3: countsByType.TYPE_3,
      TYPE_4: countsByType.TYPE_4,
    },
    productGaps: countsByType.TYPE_1,
    keywordFixes: countsByType.TYPE_2,
    resultsNoClick: countsByType.TYPE_3,
    totalMonthlySearches: totals.total_searches,
    totalClassifications:
      countsByType.TYPE_1 + countsByType.TYPE_2 + countsByType.TYPE_3 + countsByType.TYPE_4,
    topQuery: topGap
      ? {
          query: topGap.queryNorm,
          estimateCents: topGap.revenueEstimates[0]?.estimateCents ?? 0,
        }
      : null,
    lastUpdatedAt: totals.last_classified_at,
  };
}

/**
 * Shape of the dashboard summary payload.
 *
 * Was a never-called `emptySummary()` factory that existed only so
 * `ReturnType<typeof emptySummary>` could name this shape — an interface says
 * the same thing without the dead runtime function lint was flagging.
 */
export interface DashboardSummary {
  /** Reporting window these figures cover. Echoed so the UI can label them. */
  windowDays: number;
  storeName: string;
  shopDomain: string;
  plan: 'FREE' | 'GROWTH' | 'PRO';
  currency: string;
  industry: string | null;
  category: string;
  aovCents: number | null;
  insufficientAov: boolean;
  lastSyncedAt: Date | null;
  firstDashboardViewAt: Date | null;
  revenueImpactCents: number;
  bandLowCents: number;
  bandHighCents: number;
  countsByType: { TYPE_1: number; TYPE_2: number; TYPE_3: number; TYPE_4: number };
  productGaps: number;
  keywordFixes: number;
  resultsNoClick: number;
  totalMonthlySearches: number;
  totalClassifications: number;
  topQuery: { query: string; estimateCents: number } | null;
  lastUpdatedAt: Date | null;
}
