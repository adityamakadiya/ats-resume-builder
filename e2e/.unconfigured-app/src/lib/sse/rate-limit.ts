/**
 * A token bucket per user.
 *
 * IT DOES NOT SURVIVE MORE THAN ONE INSTANCE. The state below is a module
 * global, so two server processes mean two buckets and twice the allowance,
 * and a serverless cold start means a fresh full bucket. That is a known and
 * accepted limit: this exists to stop one tab in a retry loop spending a
 * hundred dollars on gpt-5, not to enforce a billing plan. The day it has to
 * do the latter, the storage moves to Postgres or Redis and this file keeps
 * its shape: `take()` is the whole interface, and it is already async-free at
 * the call sites only because the current store is local.
 *
 * Refill is lazy. There is no sweeper, so a bucket for a user who never comes
 * back sits in the map until the process restarts; at one small object per
 * user that is cheaper than the timer would be.
 */

export type Bucket = { capacity: number; refillPerSecond: number };

/**
 * The costs are the point of the table. A score is pure computation on a
 * payload the client already has, so it can be hit on every keystroke. A
 * tailor run is several model calls and can cost real money, so it is the one
 * with the small bucket.
 */
export const BUCKETS = {
  score: { capacity: 120, refillPerSecond: 2 },
  tailor: { capacity: 8, refillPerSecond: 8 / 600 },
  chat: { capacity: 30, refillPerSecond: 30 / 300 },
  render: { capacity: 30, refillPerSecond: 0.5 },
} as const satisfies Record<string, Bucket>;

export type BucketName = keyof typeof BUCKETS;

type State = { tokens: number; at: number };

const state = new Map<string, State>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function take(name: BucketName, userId: string, now = Date.now()): RateLimitResult {
  const bucket = BUCKETS[name];
  const key = `${name}:${userId}`;
  const current = state.get(key) ?? { tokens: bucket.capacity, at: now };

  const elapsed = Math.max(0, now - current.at) / 1000;
  const tokens = Math.min(bucket.capacity, current.tokens + elapsed * bucket.refillPerSecond);

  if (tokens < 1) {
    state.set(key, { tokens, at: now });
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / bucket.refillPerSecond)),
    };
  }

  state.set(key, { tokens: tokens - 1, at: now });
  return { ok: true };
}

/** Test seam. Never called from a route. */
export function resetRateLimits(): void {
  state.clear();
}
