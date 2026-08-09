/**
 * In-process dedupe for search events, used only when Redis is unreachable.
 *
 * One shopper search fires up to three events — the predictive-search fetch,
 * the form submit, and the results-page view — and Redis normally collapses
 * them with a SET NX. The old fallback counted every `search_submitted`
 * instead, and TWO of the three events carry that name, so a Redis outage
 * silently doubled every occurrence and therefore doubled Revenue At Risk.
 * Over-counting is the exact failure Shopify cites under 2.1.4, and it is
 * worse than a brief gap in data because the inflated numbers look plausible.
 *
 * This keeps the same semantics as the Redis path — the first event for a key
 * within the window counts, the rest do not — using a bounded in-memory map.
 *
 * Deliberate limitation: this is per-process. With several web replicas, two
 * events for one search can land on different containers and both count. That
 * is strictly better than the previous behaviour (which double-counted on a
 * SINGLE container) but it is not exact, so the caller still logs the fallback
 * at error level — Redis being down is the problem to fix, not this.
 */

/** Matches the Redis `EX 10` window so both paths behave identically. */
const WINDOW_MS = 10_000;

/**
 * Cap on retained keys. At ~100 bytes/entry this is a few MB worst case, and
 * an unbounded map on a public, unauthenticated endpoint is a memory-pressure
 * vector: anyone can mint fresh keys by varying the query.
 */
const MAX_ENTRIES = 10_000;

/** key → epoch ms after which the key no longer suppresses. */
const seen = new Map<string, number>();

/**
 * True when this key has not been seen inside the window — i.e. the caller
 * should count this event as an occurrence.
 */
export function countOnceInProcess(key: string, nowMs: number = Date.now()): boolean {
  const expiresAt = seen.get(key);
  if (expiresAt !== undefined && expiresAt > nowMs) {
    return false;
  }
  // Re-insert rather than update so the key moves to the end of the Map's
  // insertion order, which is what makes the oldest-first eviction below sane.
  seen.delete(key);
  seen.set(key, nowMs + WINDOW_MS);
  if (seen.size > MAX_ENTRIES) sweep(nowMs);
  return true;
}

function sweep(nowMs: number): void {
  for (const [k, expiresAt] of seen) {
    if (expiresAt <= nowMs) seen.delete(k);
  }
  // Still oversized means a burst of live keys, not stale ones. Drop the
  // oldest; Map iterates in insertion order.
  if (seen.size > MAX_ENTRIES) {
    let excess = seen.size - MAX_ENTRIES;
    for (const k of seen.keys()) {
      seen.delete(k);
      if (--excess <= 0) break;
    }
  }
}

/** Test-only: clear state between cases. */
export function __resetFallbackDedupe(): void {
  seen.clear();
}
