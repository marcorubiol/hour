/**
 * Client-side API fetch — the auth contract every page needs. Since the
 * Phase 0.9 cookie migration the JWT rides an httpOnly cookie, so there is
 * no header to attach: the contract is now 401 → refresh the session once
 * → retry once → still 401 → clear and bounce to /login. The renewal itself
 * lives with the session (`$lib/session.svelte`): a request waits for one on
 * the wire, renews first when the cookie is known to be dead, and a 401
 * joins whichever renewal is already going. Error bodies
 * surface their hint/error. Lives once (philosophy: the repeated utility
 * function is the named anti-pattern).
 */

import { goto } from '$app/navigation';
import { clearSession, recoverSession, sessionReady } from '$lib/session.svelte';

function clearAuthAndBounce(): void {
  clearSession();
  // Best-effort cookie cleanup — the session is already dead server-side
  // (that's why we're bouncing), but clearing keeps the gates honest.
  void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  void goto('/login', { replaceState: true });
}

/**
 * One request under the auth contract: ready the session, send, and on a 401
 * retry once if the session could be recovered. Concurrent 401s (a page
 * firing four queries at once when the access token dies) share one renewal.
 */
async function sendWithSession(url: string, init: RequestInit): Promise<Response> {
  await sessionReady();
  const sentAt = Date.now();
  const res = await fetch(url, init);
  if (res.status === 401 && (await recoverSession(sentAt))) return fetch(url, init);
  return res;
}

export async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await sendWithSession(url, { signal });
  // Every failure is an ApiError (an Error with the same message as before)
  // so a reader can tell «not there for you» from «broke» by `.status`
  // (`load-fail.ts`). A network failure stays fetch's own TypeError.
  if (res.status === 401) {
    clearAuthAndBounce();
    throw new ApiError(401, 'Unauthorized');
  }
  if (res.status === 404) throw new ApiError(404, 'Not found');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string;
      error?: string;
    };
    throw new ApiError(res.status, body.detail || body.error || `Error ${res.status}`, body);
  }
  return (await res.json()) as T;
}

/**
 * Error carrying the HTTP status so a mutation caller can special-case a
 * code (409 conflict, etc.) without re-parsing the response. `message` is
 * already the endpoint's hint/detail/error, ready to show in a toast.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** The parsed error body, for callers that read a field of it (e.g. the 409's `conversation_id`). */
    public readonly body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The write sibling of fetchJSON — the single home for every mutation's
 * auth + error contract (session cookie, 401 → refresh once → retry once
 * → bounce, hint/detail/error surfaced, 204 → null). The retry is safe:
 * a 401 means PostgREST rejected the token before touching any row, so
 * the write never happened. Returns the parsed body, or null for a
 * no-content response. Throws ApiError on any non-2xx so callers can
 * branch on `.status` (e.g. 409 → "already exists").
 */
export async function mutateJSON<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T | null> {
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const res = await sendWithSession(url, init);
  if (res.status === 401) {
    clearAuthAndBounce();
    throw new ApiError(401, 'Unauthorized');
  }
  if (res.status === 204) return null;
  const parsed = (await res.json().catch(() => ({}))) as {
    hint?: string;
    detail?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      parsed.hint || parsed.detail || parsed.error || `Error ${res.status}`,
      parsed as Record<string, unknown>,
    );
  }
  return parsed as T;
}
