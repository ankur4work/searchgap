import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { ShopDomainSchema } from '@/lib/shopify/validators';
import { normalizeQuery, dateBucketUTC, isTypingArtifact } from '@/lib/ingestion/normalize';
import { invalidateSummary } from '@/lib/cache';
import { countOnceInProcess } from '@/lib/ingestion/fallback-dedupe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How long to wait after the last search before classifying. Long enough to
 * collapse a shopper trying several queries in a row into one run, short enough
 * that opening the app straight after searching already shows the gap.
 */
const REALTIME_CLASSIFY_DEBOUNCE_MS = 8_000;

/**
 * Shopify's own internal lookups, which arrive on the same endpoints a shopper
 * search uses. Themes fetch `/search?q=id:123 OR id:456` for product
 * recommendations and predictive-search hydration; nobody typed that. Recorded
 * as searches they become phantom gaps with revenue attached — a store with
 * zero real traffic can show "gaps" purely from its own theme.
 *
 * Matched against the NORMALIZED query, where `id:123` has become `id 123`.
 */
const INTERNAL_QUERY = /\bid \d{6,}\b/;

/**
 * How long a shopper's in-progress query stays eligible to be superseded by a
 * longer one they were still typing.
 *
 * This is a TYPING window, not a browsing one. It was 60s, which is long enough
 * to swallow deliberate consecutive searches: a merchant (or an App Store
 * reviewer) trying "shirt", then "shirt blue", then "shirt blue xl" had the
 * first two deleted and saw "Searches tracked: 1". Predictive search debounces
 * in the low hundreds of milliseconds, so a real mid-word pause resolves in
 * a few seconds at most.
 */
const PREFIX_WINDOW_SEC = 5;

const EventSchema = z.object({
  shop: ShopDomainSchema,
  event: z.enum(['search_submitted', 'search_viewed']),
  query: z.string().min(1).max(500),
  resultCount: z.number().int().nonnegative().nullable().optional(),
  filters: z.record(z.string(), z.string()).nullable().optional(),
  at: z.number().int().positive(),
  path: z.string().max(500).optional(),
  // Per-session id from the tracker (sessionStorage). Optional for backward
  // compatibility with cached trackers that predate it.
  sid: z.string().min(1).max(64).nullable().optional(),
});

function cors(res: NextResponse): NextResponse {
  // Storefront origin is arbitrary *.myshopify.com / custom domains; allow all.
  // Authentication is via shop field in the payload, not the origin header.
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('access-control-allow-methods', 'POST, OPTIONS');
  res.headers.set('access-control-allow-headers', 'content-type');
  return res;
}

export function OPTIONS(): NextResponse {
  return cors(new NextResponse(null, { status: 204 }));
}

/**
 * Storefront search event ingestion.
 *
 * Trust model: payload asserts `shop`; we validate it's a live store we
 * installed into. No HMAC — storefront JS has no access to SHOPIFY_API_SECRET.
 * Anti-abuse: rate-limit per-shop, drop rows whose normalized query is empty,
 * cap body size via zod max limits. A motivated attacker can inject fake
 * queries for their OWN shop; classification engine treats low-volume queries
 * as `lowVolume=true` which hides them from free-tier dashboards anyway.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let parsed;
  try {
    parsed = EventSchema.safeParse(await req.json());
  } catch {
    return cors(NextResponse.json({ error: 'invalid json' }, { status: 400 }));
  }
  if (!parsed.success) {
    return cors(NextResponse.json({ error: 'invalid payload' }, { status: 400 }));
  }
  const { shop, query, resultCount, filters, at, event, sid } = parsed.data;

  const queryNormalized = normalizeQuery(query);
  if (!queryNormalized) {
    return cors(new NextResponse(null, { status: 204 }));
  }
  if (INTERNAL_QUERY.test(queryNormalized)) {
    // Drop silently: this is the theme talking to Shopify, not a shopper.
    return cors(new NextResponse(null, { status: 204 }));
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain: shop },
    select: { id: true, uninstalledAt: true },
  });
  if (!store || store.uninstalledAt) {
    // Silently drop — storefront JS may linger after uninstall.
    return cors(new NextResponse(null, { status: 204 }));
  }

  const occurredAt = new Date(at);
  const bucket = dateBucketUTC(occurredAt);

  // One logical shopper search emits several events across page contexts
  // (predictive box, form submit, then the /search results page) within a few
  // seconds. The client guard can't dedupe across page navigations, so we gate
  // the occurrence count server-side: the FIRST event for a (store, query)
  // within a short window counts once; later same-query events only refresh
  // resultCount. Keyed on a Redis SET NX so it works regardless of which event
  // (submitted/viewed) arrives first. If Redis is unavailable an in-process
  // dedupe takes over with the same key and window, so an infra blip neither
  // drops data nor inflates it.
  //
  // Scope the de-dupe to the shopper session when the tracker provides one, so
  // the same query from different shoppers within the window is NOT merged.
  // Cached trackers without a session id fall back to (store, query).
  const dedupeKey = sid
    ? `srch:dedup:${store.id}:${queryNormalized}:${sid}`
    : `srch:dedup:${store.id}:${queryNormalized}`;
  let countOccurrence: boolean;
  let dedupeVia: 'redis' | 'fallback' = 'redis';
  try {
    const firstInWindow = await redis.set(dedupeKey, '1', 'EX', 10, 'NX');
    countOccurrence = firstInWindow !== null;
  } catch (err) {
    // Redis unavailable. This used to count every 'search_submitted', but TWO
    // of the three events one search fires carry that name (predictive fetch
    // and form submit), so an outage silently DOUBLED every occurrence — and
    // occurrences multiply straight into the revenue estimate. Inflated totals
    // that look plausible are worse than missing ones, and over-counting is
    // precisely what Shopify cites under 2.1.4.
    //
    // Fall back to an in-process dedupe with the same key and window as Redis,
    // so the first event still counts once and the rest are suppressed. It is
    // per-container and therefore approximate across replicas, which is why
    // this still logs at error: Redis being down is the thing to fix.
    dedupeVia = 'fallback';
    countOccurrence = countOnceInProcess(dedupeKey);
    logger.error(
      { shop, query: queryNormalized, event, countOccurrence, err: (err as Error).message },
      'search dedupe unavailable — using in-process fallback',
    );
  }

  // Per-event trace of the dedupe decision. Without this an inflated
  // occurrenceCount is undiagnosable: the totals look plausible and there is no
  // record of how many events produced them.
  logger.info(
    { shop, query: queryNormalized, event, hasSid: Boolean(sid), countOccurrence, dedupeVia },
    'search event received',
  );

  try {
    await prisma.searchQuery.upsert({
      where: {
        uniq_store_query_bucket: {
          storeId: store.id,
          queryNormalized,
          dateBucket: bucket,
        },
      },
      create: {
        storeId: store.id,
        query,
        queryNormalized,
        occurredAt,
        dateBucket: bucket,
        occurrenceCount: 1,
        resultCount: resultCount ?? 0,
        clickCount: 0,
        filtersJson: filters ?? undefined,
      },
      update: {
        occurredAt,
        // Only bump volume for the first event in the dedupe window.
        ...(countOccurrence ? { occurrenceCount: { increment: 1 } } : {}),
        // Keep the latest result_count seen — the /search results page often
        // carries a more accurate count than the predictive box.
        ...(resultCount != null ? { resultCount } : {}),
        filtersJson: filters ?? undefined,
      },
    });
  } catch (err) {
    logger.warn(
      { shop, query: queryNormalized, err: (err as Error).message },
      'search event persist failed',
    );
    return cors(NextResponse.json({ error: 'write failed' }, { status: 500 }));
  }

  // Collapse in-progress typing.
  //
  // Predictive search fires on a pause, not only on submit, so a shopper typing
  // "test products" with a hesitation mid-word lands BOTH "test pr" and
  // "test products" as separate searches. The partial is not a query anyone
  // meant — it inflates the search count and shows up as its own phantom gap,
  // usually a zero-result one because half a word matches nothing.
  //
  // When the next query from the SAME shopper session extends the previous one,
  // treat the previous as an artifact and give back its occurrence. Scoped to a
  // session id so one shopper's typing can never cancel another's search, and
  // to the same day bucket so the unique key still holds.
  if (countOccurrence && sid) {
    const lastKey = `srch:last:${store.id}:${sid}`;
    try {
      const previous = await redis.get(lastKey);
      if (previous && isTypingArtifact(previous, queryNormalized)) {
        await prisma.searchQuery.updateMany({
          where: {
            storeId: store.id,
            queryNormalized: previous,
            dateBucket: bucket,
            occurrenceCount: { gt: 0 },
          },
          data: { occurrenceCount: { decrement: 1 } },
        });
        // A partial that only ever existed as an artifact drops to zero — remove
        // it rather than leave a phantom gap with no occurrences behind.
        const removed = await prisma.searchQuery.deleteMany({
          where: {
            storeId: store.id,
            queryNormalized: previous,
            dateBucket: bucket,
            occurrenceCount: { lte: 0 },
          },
        });

        // Remove the gap the partial already produced.
        //
        // The real-time classifier may have run between the two keystrokes and
        // written a classification (plus revenue) for the partial. Deleting the
        // search row alone left that behind: revenue attached to a search the
        // dashboard no longer counts, which is precisely the cross-surface
        // inconsistency Shopify rejected the app for. Only drop it once NO
        // search row for that query remains in any day bucket — the same term
        // may legitimately have been searched on its own earlier.
        if (removed.count > 0) {
          const stillSearched = await prisma.searchQuery.count({
            where: { storeId: store.id, queryNormalized: previous },
          });
          if (stillSearched === 0) {
            // RevenueEstimate rows cascade on delete.
            await prisma.classification.deleteMany({
              where: { storeId: store.id, queryNorm: previous },
            });
          }
        }

        logger.info(
          { shop, superseded: previous, by: queryNormalized, removedSearchRows: removed.count },
          'search event superseded an in-progress prefix',
        );
      }
      await redis.set(lastKey, queryNormalized, 'EX', PREFIX_WINDOW_SEC);
    } catch (err) {
      // Non-fatal: worst case a partial query survives as its own row.
      logger.warn(
        { shop, err: (err as Error).message },
        'prefix supersede check failed — partial queries may persist',
      );
    }
  }

  // The search count just moved, so the cached cards are stale.
  //
  // Only the classification job used to invalidate this, and it runs 8s later.
  // Until then the "Searches over time" chart (uncached) showed the new search
  // while the cards above it served a snapshot up to 60s old — the same data
  // disagreeing with itself on one screen, including right after a reviewer
  // clicks "Refresh data".
  await invalidateSummary(store.id).catch(() => undefined);

  // Classify in near-real-time.
  //
  // Capture used to be instant while classification only ran on the hourly cron
  // or a manual "Refresh data" click, so a shopper (or an App Store reviewer)
  // could search, open the app, and see nothing — the gap existed but no job
  // had turned it into one.
  //
  // Debounced by a fixed jobId plus a delay: a burst of searches collapses into
  // ONE classify run a few seconds after the last one, instead of one run per
  // keystroke-burst. BullMQ ignores an add() whose jobId is already waiting or
  // delayed, and the job is removed on completion so the next search can arm it
  // again.
  //
  // Best-effort: a Redis hiccup must never fail the tracker beacon, which the
  // storefront cannot retry. The cron remains the backstop.
  try {
    const { classifyQueue } = await import('@/jobs/queue');
    await classifyQueue.add(
      'classify:store',
      { storeId: store.id, origin: 'post-ingest' },
      {
        jobId: `rt-classify-${store.id}`,
        delay: REALTIME_CLASSIFY_DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (err) {
    logger.warn(
      { shop, err: (err as Error).message },
      'realtime classify enqueue failed — cron will still pick this up',
    );
  }

  return cors(new NextResponse(null, { status: 204 }));
}
