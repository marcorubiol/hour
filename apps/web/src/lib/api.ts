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
