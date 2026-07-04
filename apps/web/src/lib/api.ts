/**
 * Client-side API fetch — the auth contract every page needs: JWT from
 * localStorage, 401 clears the session and bounces to /login, error
 * bodies surface their detail. Lives once (philosophy: the repeated
 * utility function is the named anti-pattern). The four pre-existing
 * copies (Plaza, RelationshipStub, Today dashboard, project detail)
 * migrate here when next touched.
 */

import { goto } from '$app/navigation';

export function clearAuthAndBounce(): void {
  localStorage.removeItem('hour_jwt');
  localStorage.removeItem('hour_refresh');
  localStorage.removeItem('hour_expires_at');
  void goto('/login', { replaceState: true });
}

export async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const jwt = localStorage.getItem('hour_jwt');
  if (!jwt) {
    clearAuthAndBounce();
    throw new Error('Missing JWT');
  }
  const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${jwt}` } });
  if (res.status === 401) {
    clearAuthAndBounce();
    throw new Error('Unauthorized');
  }
  if (res.status === 404) throw new Error('Not found');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string;
      error?: string;
    };
    throw new Error(body.detail || body.error || `Error ${res.status}`);
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
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The write sibling of fetchJSON — the single home for every mutation's
 * auth + error contract (Bearer JWT, 401 → bounce to login, hint/detail/
 * error surfaced, 204 → null). Returns the parsed body, or null for a
 * no-content response. Throws ApiError on any non-2xx so callers can
 * branch on `.status` (e.g. 409 → "already exists").
 */
export async function mutateJSON<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T | null> {
  const jwt = localStorage.getItem('hour_jwt');
  if (!jwt) {
    clearAuthAndBounce();
    throw new ApiError(401, 'Missing JWT');
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
    );
  }
  return parsed as T;
}
