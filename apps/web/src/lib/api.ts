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
import { appLocale, t } from '$lib/i18n';

/**
 * The network gave no answer (offline, DNS, a dropped connection). fetch's
 * own TypeError says «Failed to fetch» in the browser's English, and that
 * text reached toasts as it was (tarea 132): this one says it in the app's
 * language. Not an ApiError, so `load-fail` still reads it as `failed`.
 */
export class NetworkError extends Error {
  constructor() {
    super(t('ui.no_connection', appLocale()));
    this.name = 'NetworkError';
  }
}

/** fetch, with a dead network said in words. An abort stays an abort. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError();
  }
}

/** A server failure without a hint of its own: never its raw text («Error 500»). */
function failedMessage(status: number, hint: string | undefined): string {
  return hint || (status >= 500 ? t('ui.failed', appLocale()) : `Error ${status}`);
}

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
  const res = await send(url, init);
  if (res.status === 401 && (await recoverSession(sentAt))) return send(url, init);
  return res;
}

export async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await sendWithSession(url, { signal });
  // Every failure is an ApiError (an Error with the same message as before)
  // so a reader can tell «not there for you» from «broke» by `.status`
  // (`load-fail.ts`). A network failure is a NetworkError, in words.
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
    throw new ApiError(res.status, failedMessage(res.status, body.detail || body.error), body);
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
  /** `keepalive`: the request outlives the page (a write sent while it closes, `$lib/undo-remove`). */
  opts?: { keepalive?: boolean },
): Promise<T | null> {
  return sendMutation<T>(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive: opts?.keepalive,
  });
}

/**
 * A file as the raw request body (an image upload, ADR-172): POST, the
 * blob's own content type, and the same contract as mutateJSON.
 */
export async function uploadBlob<T = unknown>(url: string, blob: Blob): Promise<T | null> {
  return sendMutation<T>(url, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  });
}

async function sendMutation<T>(url: string, init: RequestInit): Promise<T | null> {
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
      parsed.hint || failedMessage(res.status, parsed.detail || parsed.error),
      parsed as Record<string, unknown>,
    );
  }
  return parsed as T;
}
