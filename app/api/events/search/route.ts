import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { ShopDomainSchema } from '@/lib/shopify/validators';
import { normalizeQuery, dateBucketUTC } from '@/lib/ingestion/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How long to wait after the last search before classifying. Long enough to
 * collapse a shopper trying several queries in a row into one run, short enough
 * that opening the app straight after searching already shows the gap.
 */
const REALTIME_CLASSIFY_DEBOUNCE_MS = 8_000;

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
  // (submitted/viewed) arrives first. If Redis is unavailable we fall back to
  // the legacy rule (count submits) so an infra blip never drops data.
  let countOccurrence: boolean;
  let dedupeVia: 'redis' | 'fallback' = 'redis';
  try {
    // Scope the de-dupe to the shopper session when the tracker provides one,
    // so the same query from different shoppers within the window is NOT
    // merged. Cached trackers without a session id fall back to (store, query).
    const dedupeKey = sid
      ? `srch:dedup:${store.id}:${queryNormalized}:${sid}`
      : `srch:dedup:${store.id}:${queryNormalized}`;
    const firstInWindow = await redis.set(dedupeKey, '1', 'EX', 10, 'NX');
    countOccurrence = firstInWindow !== null;
  } catch (err) {
    // Redis unavailable: the ONLY reason a single shopper search inflates the
    // count. Every hook (predictive, form submit, results page) reports the
    // same search, and this fallback counts each 'search_submitted' among them
    // separately. Log loudly — silently over-counting corrupts every downstream
    // revenue estimate, which is worse than dropping the event.
    dedupeVia = 'fallback';
    countOccurrence = event === 'search_submitted';
    logger.error(
      { shop, query: queryNormalized, err: (err as Error).message },
      'search dedupe unavailable — occurrence counts may inflate',
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
