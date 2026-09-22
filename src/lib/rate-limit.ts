/**
 * A sliding-window rate limit, as a pure function plus a small in-memory store.
 *
 * In memory on purpose: the thing being protected is a billed third-party API
 * key against accidental or malicious volume, and a new datastore dependency
 * to hold four timestamps per user would cost more than it protects. A serverless
 * instance recycling resets the window, which is the honest trade — this is a
 * ceiling on runaway usage, not a billing control.
 *
 * The decision is pure so the boundaries can be tested directly: the request
 * exactly on the limit, the one exactly as the window expires, and the retry
 * hint being the wait until the *oldest* hit ages out rather than a flat guess.
 */
export type RateDecision = {
  allowed: boolean;
  /** How long until the next request would be allowed. Zero when allowed. */
  retryAfterMs: number;
  /** The history to store back, with expired entries already dropped. */
  history: number[];
};

export function checkRate(
  history: readonly number[],
  now: number,
  limit: number,
  windowMs: number,
): RateDecision {
  const live = history.filter((t) => now - t < windowMs).sort((a, b) => a - b);
  if (live.length < limit) {
    return { allowed: true, retryAfterMs: 0, history: [...live, now] };
  }
  // Blocked until the oldest hit in the window falls out of it.
  const oldest = live[0];
  return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)), history: live };
}

/** Seconds, rounded up and floored at one, for a Retry-After header. */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

/**
 * A keyed store over `checkRate`.
 *
 * Prunes on write rather than on a timer: there is no interval to leak, and a
 * key nobody has used since its window closed is dropped the next time any
 * key is touched.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, number[]>();

  return function take(key: string, now: number = Date.now()): RateDecision {
    for (const [other, hits] of buckets) {
      if (!hits.length || now - hits[hits.length - 1] >= windowMs) buckets.delete(other);
    }
    const decision = checkRate(buckets.get(key) ?? [], now, limit, windowMs);
    buckets.set(key, decision.history);
    return decision;
  };
}
