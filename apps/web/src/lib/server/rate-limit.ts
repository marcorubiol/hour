/**
 * KV-backed fixed-window rate limiter (Phase 0.9 hardening gate).
 *
 * SCOPE — be honest about what this does and doesn't stop. The read →
 * compare → write is NOT atomic (KV has no atomic increment), so a burst
 * of requests that all arrive before the first `put` is readable each read
 * the same stale count and all pass the gate. It therefore bounds SLOW,
 * SEQUENTIAL abuse (a script hammering login one-at-a-time) but gives
 * little protection against a CONCURRENT burst — which is the shape a
 * serious credential-stuffing tool uses. Treat it as an in-Worker backstop,
 * not the primary control.
 *
 * Login has a second, burst-oriented control: Cloudflare's native Workers
 * Rate Limiting binding. The native counter and this five-minute KV window
 * are deliberately composed: the native binding catches concurrent bursts
 * while KV preserves the longer 10-per-five-minute budget for sequential
 * attempts. See build/runbooks/beta-readiness.md.
 *
 * No binding → no-op (allow everything). This keeps vite dev, preview and
 * pre-KV deploys working; creating the namespace and uncommenting the
 * binding in wrangler.jsonc is a deploy step (see runbook).
 */

export interface RateLimitRule {
  /** Max requests admitted per window. */
  limit: number;
  /** Window length in seconds (KV TTL floor is 60). */
  windowSec: number;
}

/** Minimal structural type so unit tests do not need a Workers runtime. */
export interface NativeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Cloudflare-native burst gate. No binding in local development means no-op.
 * A transient binding error fails open so Cloudflare cannot lock every user
 * out; the independent KV window still runs immediately afterwards.
 */
export async function allowNativeRequest(
  limiter: NativeRateLimiter | undefined,
  key: string,
): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

function bucketKey(key: string, rule: RateLimitRule): string {
  const bucket = Math.floor(Date.now() / (rule.windowSec * 1000));
  return `rl:${key}:${bucket}`;
}

/**
 * True = request admitted. Fails open on KV errors — availability of the
 * login path outranks precision of the limiter.
 */
export async function allowRequest(
  kv: KVNamespace | undefined,
  key: string,
  rule: RateLimitRule,
): Promise<boolean> {
  if (!kv) return true;
  try {
    const kvKey = bucketKey(key, rule);
    const count = parseInt((await kv.get(kvKey)) ?? '0', 10);
    if (count >= rule.limit) return false;
    // Not atomic (KV is last-write-wins) — see module docblock.
    await kv.put(kvKey, String(count + 1), {
      expirationTtl: Math.max(60, rule.windowSec * 2),
    });
    return true;
  } catch {
    return true;
  }
}

/**
 * Read-only gate: true = under the limit, WITHOUT incrementing. Pair with
 * `recordFailure` when the counter must only advance on failed attempts (e.g.
 * per-account login throttling, where counting successes would let an attacker
 * lock out the real user, and counting the victim's own successful logins is
 * pointless). Fails open.
 */
export async function underLimit(
  kv: KVNamespace | undefined,
  key: string,
  rule: RateLimitRule,
): Promise<boolean> {
  if (!kv) return true;
  try {
    const count = parseInt((await kv.get(bucketKey(key, rule))) ?? '0', 10);
    return count < rule.limit;
  } catch {
    return true;
  }
}

/** Increment the window counter for `key` (best-effort). Use after an attempt
 * that should count against the budget — typically a FAILED one. */
export async function recordFailure(
  kv: KVNamespace | undefined,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  if (!kv) return;
  try {
    const kvKey = bucketKey(key, rule);
    const count = parseInt((await kv.get(kvKey)) ?? '0', 10);
    await kv.put(kvKey, String(count + 1), {
      expirationTtl: Math.max(60, rule.windowSec * 2),
    });
  } catch {
    /* best-effort — see module docblock */
  }
}

/** SHA-256 hex of a value, for KV keys that must not store the plaintext
 * (e.g. the login email in a per-account throttle key). */
export async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The client IP as Cloudflare saw it. 'unknown' groups non-CF traffic
 * (vite dev, preview) into one bucket — harmless there. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
