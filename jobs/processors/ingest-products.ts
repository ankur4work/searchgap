import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ingestProducts } from '@/lib/ingestion/products';
import { acquireStoreMutex } from '@/lib/ingestion/mutex';
import { startRun, finishRun } from '@/lib/ingestion/runs';
import { ShopifyAuthError } from '@/lib/shopify/client';
import { isTokenExpired } from '@/lib/shopify/store';
import { withTimeout } from '@/lib/timeout';
import type { IngestionJobData } from '../queue';
import { ingestionQueue, classifyQueue } from '../queue';

const AUTH_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Hard ceiling on a single product sync. Deliberately under the 30-minute store
 * mutex so a stalled run fails and releases before its own lock expires.
 *
 * Without this, any hang below us leaves the IngestionRun at RUNNING forever:
 * the dashboard then shows "Syncing your store… Products 0%" and a "Syncing"
 * status card on every page load, with no path out short of a worker restart.
 */
const INGEST_TIMEOUT_MS = 25 * 60 * 1000;

export async function ingestProductsProcessor(job: Job<IngestionJobData>): Promise<void> {
  const { storeId, force } = job.data;
  const mutex = await acquireStoreMutex(storeId, 30 * 60, 'products');
  if (!mutex) {
    logger.info({ storeId, jobId: job.id }, 'Store locked — re-enqueueing products sync');
    await ingestionQueue.add(
      'ingest:products',
      { storeId, force, origin: job.data.origin },
      { jobId: `retry-${storeId}-products`, delay: 3_000 },
    );
    return;
  }

  try {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.uninstalledAt) {
      return;
    }

    if (isTokenExpired(store)) {
      logger.warn({ storeId, shop: store.shopDomain }, 'Access token expired — skipping products sync until merchant reopens app');
    // Do NOT record this as a FAILED run. An expired token is a "waiting for
    // the merchant" state, not a sync fault: the embedded bootstrap mints a new
    // token the instant the app is opened. Recording FAILED made the latest run
    // per job type failed, and onboarding.status derives hasError from exactly
    // that — so the dashboard showed a red "Error / Refresh error" banner that
    // no amount of waiting cleared, on a store whose data was merely a little
    // stale. Leaving the previous successful run in place keeps the dashboard
    // honest, and the bootstrap re-enqueues a sync on the next app open.
      return;
    }

    const run = await startRun({
      storeId,
      jobType: 'INGEST_PRODUCTS',
      bullJobId: job.id ?? null,
      attempt: job.attemptsMade + 1,
    });

    try {
      await withTimeout(
        ingestProducts(store, { force, runId: run.id }),
        INGEST_TIMEOUT_MS,
        `Product sync exceeded ${INGEST_TIMEOUT_MS / 60000} minutes and was abandoned`,
      );
      await finishRun(run.id, 'DONE');
      // Re-classify against the FRESH catalog. The backfill enqueues products,
      // orders and search in parallel; search ingest is fast and triggers an
      // early classify that races ahead of the slow product bulk-import — so
      // that run sees a stale catalog and produces no keyword fixes (TYPE_2).
      // Triggering classify here, after the catalog is written, guarantees a
      // pass with the up-to-date products. Dedup by jobId.
      await classifyQueue.add(
        'classify:store',
        { storeId, origin: 'post-ingest' },
        { jobId: `classify-${storeId}-${Date.now()}` },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finishRun(run.id, 'FAILED', msg);

      if (err instanceof ShopifyAuthError) {
        logger.warn(
          { storeId, shop: store.shopDomain },
          'ShopifyAuthError in products processor — re-queuing after delay for token exchange',
        );
        await ingestionQueue.add(
          'ingest:products',
          { storeId, force: true, origin: 'manual' },
          {
            jobId: `auth-retry-${storeId}-products`,
            delay: AUTH_RETRY_DELAY_MS,
          },
        );
        return;
      }

      throw err;
    }
  } finally {
    await mutex.release();
  }
}
