/**
 * Content-addressed caching for model calls.
 *
 * One resume against ten postings re-extracts the same facts ten times unless
 * something stops it, and that is the easiest money in the pipeline to stop
 * spending. The old Python store proved the idea on facts alone; this
 * generalises it to every step.
 *
 * The key mixes the step, the prompt version, the model and a hash of the
 * input. Each of those is load-bearing:
 *
 *   step + model      two steps may legitimately send identical input
 *   prompt version    editing a prompt must not keep serving old answers
 *   input hash        the whole point
 *
 * PRIVACY RULE, and it decides the shape of this file.
 * -----------------------------------------------------
 * A cache keyed purely on content is shared across tenants. That is exactly
 * what you want for a job description: two people applying to the same posting
 * should decompose it once. It is exactly what you must not do for a resume,
 * because a cache hit on resume-derived input is one tenant reading another
 * tenant's data, and the fact that they had to guess the input first does not
 * make it acceptable.
 *
 * So scope is not a parameter with a default. Every call states it, the
 * compiler requires it, and `user` mixes the owner into the key. When in
 * doubt the answer is `user`: a redundant extraction costs a fraction of a
 * cent, and the other mistake is a breach.
 */

import { createHash } from "node:crypto";

export type CacheScope =
  /** Derived only from public input, such as a job posting. Shared globally. */
  | { kind: "global" }
  /** Derived from anything the user uploaded or wrote. Never shared. */
  | { kind: "user"; userId: string };

export type CacheEntry<T> = {
  value: T;
  createdAt: number;
};

export interface CacheStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
}

/**
 * The default store. Process-local, so it survives a re-render and nothing
 * else, which is the honest behaviour for a dev server. Production passes a
 * Postgres-backed store; see `setCacheStore`.
 */
class MemoryStore implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; at: number }>();
  private readonly limit = 500;

  async get(key: string) {
    return this.entries.get(key)?.value ?? null;
  }

  async set(key: string, value: unknown) {
    // Bounded, because a long-lived dev server extracting every resume a
    // developer tries should not become the reason the machine swaps.
    if (this.entries.size >= this.limit) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.entries.delete(oldest[0]);
    }
    this.entries.set(key, { value, at: Date.now() });
  }
}

let store: CacheStore = new MemoryStore();

export function setCacheStore(next: CacheStore): void {
  store = next;
}

export function cacheKey(input: {
  step: string;
  promptVersion: string;
  model: string;
  payload: unknown;
  scope: CacheScope;
}): string {
  const owner = input.scope.kind === "user" ? input.scope.userId : "global";
  const body = typeof input.payload === "string" ? input.payload : stableStringify(input.payload);

  return createHash("sha256")
    .update(
      [input.step, input.promptVersion, input.model, owner, body].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 48);
}

/**
 * JSON with sorted keys, so two structurally identical objects produce one key.
 *
 * Without this, a cache hit depends on property insertion order, which depends
 * on how the object happened to be built. That turns the cache into something
 * that works in tests and misses in production.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export type CachedResult<T> = { value: T; hit: boolean };

/**
 * Run `compute` unless an identical call has already been made.
 *
 * A read failure is not a call failure: a cache that is down should slow the
 * pipeline, not stop it. A write failure is swallowed for the same reason.
 */
export async function withCache<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<CachedResult<T>> {
  try {
    const hit = await store.get(key);
    if (hit !== null && hit !== undefined) return { value: hit as T, hit: true };
  } catch (error) {
    console.warn("[cache] read failed, computing instead:", error);
  }

  const value = await compute();

  try {
    await store.set(key, value);
  } catch (error) {
    console.warn("[cache] write failed:", error);
  }

  return { value, hit: false };
}
