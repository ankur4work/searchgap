import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ingestSearchAnalytics } from '@/lib/ingestion/search-analytics';
import { acquireStoreMutex } from '@/lib/ingestion/mutex';
import { startRun, finishRun } from '@/lib/ingestion/runs';
import { classifyQueue, ingestionQueue, type IngestionJobData } from '../queue';

export async function ingestSearchProcessor(job: Job<IngestionJobData>): Promise<void> {
  const { storeId, sinceDays = 1 } = job.data;
  const mutex = await acquireStoreMutex(storeId, 600, 'search');
  if (!mutex) {
    logger.info({ storeId, jobId: job.id }, 'Store locked — re-enqueueing search sync');
    await ingestionQueue.add(
      'ingest:search',
      { storeId, sinceDays, origin: job.data.origin },
      { jobId: `retry-${storeId}-search`, delay: 3_000 },
    );
    return;
  }
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store || store.uninstalledAt) {
    logger.info({ storeId }, 'Store missing or uninstalled — skip');
    await mutex.release();
    return;
  }
  const { isTokenExpired } = await import('@/lib/shopify/store');
  if (isTokenExpired(store)) {
    logger.warn({ storeId, shop: store.shopDomain }, 'Access token expired — skipping search sync until merchant reopens app');
    // Do NOT record this as a FAILED run. An expired token is a "waiting for
    // the merchant" state, not a sync fault: the embedded bootstrap mints a new
    // token the instant the app is opened. Recording FAILED made the latest run
    // per job type failed, and onboarding.status derives hasError from exactly
    // that — so the dashboard showed a red "Error / Refresh error" banner that
    // no amount of waiting cleared, on a store whose data was merely a little
    // stale. Leaving the previous successful run in place keeps the dashboard
    // honest, and the bootstrap re-enqueues a sync on the next app open.
    await mutex.release();
    return;
  }
  const run = await startRun({
    storeId,
    jobType: 'INGEST_SEARCH',
    bullJobId: job.id ?? null,
    attempt: job.attemptsMade + 1,
  });
  try {
    await ingestSearchAnalytics(store, { sinceDays, runId: run.id });
    await finishRun(run.id, 'DONE');
    // Trigger classification immediately on fresh search data. Dedup by jobId
    // so a burst of ingest:search completions only schedules one classify run.
    await classifyQueue.add(
      'classify:store',
      { storeId, origin: 'post-ingest' },
      { jobId: `classify-${storeId}-${Date.now()}` },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, 'FAILED', msg);
    throw err;
  } finally {
    await mutex.release();
  }
}
