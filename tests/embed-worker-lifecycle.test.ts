import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runEmbedWorkerAt } from '@/lib/ingestion/embeddings';

/**
 * Regression cover for the product-sync stall.
 *
 * The exit handler used to reject only when `code !== 0 && signal !== null`.
 * A crashing child exits `code=1, signal=null`, so that guard was false — and
 * because the handler had already cleared the timeout, the promise settled
 * never. ingestProducts awaited it on the first batch, before a single catalog
 * row was written, so finishRun never ran and the IngestionRun sat at
 * RUNNING/0% permanently. The dashboard showed "Syncing your store… Products
 * 0%" forever and classified every search against an empty catalog.
 *
 * The assertion that matters in each case is simply THAT IT SETTLES.
 */
const fixture = (name: string): string => resolve(__dirname, 'fixtures', name);

// Comfortably above the fork+exit round trip, far below any real hang.
const SETTLE_BUDGET_MS = 10_000;

async function settlesWithin<T>(p: Promise<T>, ms: number): Promise<'settled' | 'hung'> {
  return Promise.race([
    p.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms)),
  ]);
}

describe('runEmbedWorkerAt — child lifecycle', () => {
  it('rejects when the child crashes at import (code=1, signal=null)', async () => {
    const p = runEmbedWorkerAt(fixture('embed-worker-crash.mjs'), ['hello']);
    await expect(p).rejects.toThrow(/exited without replying/);
  }, SETTLE_BUDGET_MS);

  it('surfaces the child stderr so the cause is diagnosable from worker logs', async () => {
    // Production has no readable database; if this message is empty, a failed
    // model load is indistinguishable from any other crash.
    await expect(
      runEmbedWorkerAt(fixture('embed-worker-crash.mjs'), ['hello']),
    ).rejects.toThrow(/simulated top-level import failure/);
  }, SETTLE_BUDGET_MS);

  it('rejects when the child exits cleanly without ever replying', async () => {
    await expect(
      runEmbedWorkerAt(fixture('embed-worker-silent-exit.mjs'), ['hello']),
    ).rejects.toThrow(/exited without replying/);
  }, SETTLE_BUDGET_MS);

  it('never leaves the promise pending — the actual defect', async () => {
    for (const f of ['embed-worker-crash.mjs', 'embed-worker-silent-exit.mjs']) {
      const outcome = await settlesWithin(runEmbedWorkerAt(fixture(f), ['hello']), 5_000);
      expect(outcome, `${f} left the promise pending`).toBe('settled');
    }
  }, SETTLE_BUDGET_MS * 2);

  it('rejects a missing worker file rather than hanging', async () => {
    const outcome = await settlesWithin(
      runEmbedWorkerAt(fixture('does-not-exist.mjs'), ['hello']),
      5_000,
    );
    expect(outcome).toBe('settled');
  }, SETTLE_BUDGET_MS);
});
