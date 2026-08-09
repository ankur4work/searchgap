import { describe, it, expect, beforeEach } from 'vitest';
import { countOnceInProcess, __resetFallbackDedupe } from '@/lib/ingestion/fallback-dedupe';

/**
 * The Redis-outage path. Its predecessor counted every 'search_submitted', and
 * two of the three events a single search fires carry that name — so an outage
 * doubled every occurrence and, because revenue is occurrences x AOV x
 * benchmark, doubled Revenue At Risk with it.
 */
describe('countOnceInProcess', () => {
  beforeEach(() => {
    __resetFallbackDedupe();
  });

  const KEY = 'srch:dedup:store_1:shirt:sess_a';

  it('counts the first event for a key', () => {
    expect(countOnceInProcess(KEY, 1_000)).toBe(true);
  });

  it('suppresses repeats inside the window', () => {
    expect(countOnceInProcess(KEY, 1_000)).toBe(true);
    expect(countOnceInProcess(KEY, 2_000)).toBe(false);
    expect(countOnceInProcess(KEY, 9_000)).toBe(false);
  });

  it('collapses the real 3-event burst into ONE occurrence', () => {
    // Exactly the pattern observed in production for one shopper search:
    // predictive fetch, results view, form submit — all within ~4s.
    const decisions = [0, 1_771, 2_863].map((offset) =>
      countOnceInProcess(KEY, 1_000 + offset),
    );
    expect(decisions).toEqual([true, false, false]);
    expect(decisions.filter(Boolean)).toHaveLength(1);
  });

  it('counts again once the window has passed', () => {
    expect(countOnceInProcess(KEY, 1_000)).toBe(true);
    expect(countOnceInProcess(KEY, 11_001)).toBe(true);
  });

  it('treats the window boundary as expired', () => {
    expect(countOnceInProcess(KEY, 1_000)).toBe(true);
    // expiry is exactly 11_000; at that instant it must no longer suppress
    expect(countOnceInProcess(KEY, 11_000)).toBe(true);
  });

  it('keeps different shoppers separate', () => {
    expect(countOnceInProcess('srch:dedup:s1:shirt:sess_a', 1_000)).toBe(true);
    expect(countOnceInProcess('srch:dedup:s1:shirt:sess_b', 1_000)).toBe(true);
  });

  it('keeps different queries separate', () => {
    expect(countOnceInProcess('srch:dedup:s1:shirt:sess_a', 1_000)).toBe(true);
    expect(countOnceInProcess('srch:dedup:s1:shirt blue:sess_a', 1_000)).toBe(true);
  });

  it('keeps different stores separate', () => {
    expect(countOnceInProcess('srch:dedup:s1:shirt:sess_a', 1_000)).toBe(true);
    expect(countOnceInProcess('srch:dedup:s2:shirt:sess_a', 1_000)).toBe(true);
  });

  it('stays bounded under a flood of unique keys', () => {
    // The endpoint is public and unauthenticated, so an attacker can mint
    // fresh keys by varying the query. Memory must not grow without limit.
    for (let i = 0; i < 25_000; i += 1) {
      countOnceInProcess(`srch:dedup:s1:q${i}:sess`, 1_000 + i);
    }
    // Still functional after eviction rather than wedged or throwing.
    expect(countOnceInProcess('srch:dedup:s1:fresh:sess', 30_000)).toBe(true);
    expect(countOnceInProcess('srch:dedup:s1:fresh:sess', 30_100)).toBe(false);
  });

  it('never counts one search twice across a realistic session', () => {
    // Three deliberate searches, three events each — the exact live trace.
    const searches = ['shirt', 'shirt blue', 'shirt blue xl'];
    let counted = 0;
    searches.forEach((q, i) => {
      const base = 1_000 + i * 12_000; // 12s apart, as observed
      [0, 1_771, 2_863].forEach((off) => {
        if (countOnceInProcess(`srch:dedup:s1:${q}:sess_a`, base + off)) counted += 1;
      });
    });
    expect(counted).toBe(3);
  });
});
