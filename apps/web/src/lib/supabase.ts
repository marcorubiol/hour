/**
 * Thin PostgREST client.
 *
 * We deliberately avoid pulling in @supabase/supabase-js here — for API routes
 * we only need HTTP against /rest/v1. Using fetch directly keeps the Worker
 * bundle small and makes the RLS boundary explicit: every request carries the
 * user's JWT as Authorization, the anon key as apikey, and Postgres decides
 * what the user can see.
 */

export interface SupabaseEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

export interface PostgrestOptions {
  /** Raw SearchParams to forward to PostgREST (select, filter, order, limit…). */
  search?: URLSearchParams | Record<string, string>;
  /**
   * If true, ask PostgREST for an exact count in the response (Content-Range
   * header). Costs an extra COUNT(*). Default: false.
   */
  exactCount?: boolean;
}

export interface PostgrestResult<T> {
  data: T[];
  /** Populated only when exactCount was requested. */
  total: number | null;
  status: number;
}

export class PostgrestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`PostgREST ${status}: ${body.slice(0, 200)}`);
  }

  /**
   * The Postgres error code from the structured error body, or null.
   * Prefer this over substring-matching the raw body — user-influenced
   * text (constraint details, RAISE messages) could contain a code-like
   * digit string.
   */
  get code(): string | null {
    try {
      const parsed = JSON.parse(this.body) as { code?: unknown };
      return typeof parsed.code === 'string' ? parsed.code : null;
    } catch {
      return null;
    }
  }
}

function baseHeaders(env: SupabaseEnv, jwt: string | null): Record<string, string> {
  return {
    apikey: env.PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${jwt ?? env.PUBLIC_SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };
}

function resourceUrl(env: SupabaseEnv, path: string, search?: PostgrestOptions['search']): URL {
  const url = new URL(`/rest/v1/${path.replace(/^\/+/, '')}`, env.PUBLIC_SUPABASE_URL);
  if (search) {
    const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
    for (const [k, v] of params) url.searchParams.append(k, v);
  }
  return url;
}

/**
 * GET a PostgREST resource with the caller's JWT. If jwt is null, the request
 * runs as `anon` — useful for smoke-tests but RLS will deny most tables.
 */
export async function pgGet<T = unknown>(
  env: SupabaseEnv,
  path: string,
  jwt: string | null,
  options: PostgrestOptions = {},
): Promise<PostgrestResult<T>> {
  const url = resourceUrl(env, path, options.search);

  const headers = baseHeaders(env, jwt);
  if (options.exactCount) headers.Prefer = 'count=exact';

  const res = await fetch(url.toString(), { headers });
  const body = await res.text();

  if (!res.ok) throw new PostgrestError(res.status, body);

  const data = body ? (JSON.parse(body) as T[]) : [];

  let total: number | null = null;
  if (options.exactCount) {
    // "0-24/156" → 156
    const range = res.headers.get('content-range');
    const slash = range?.lastIndexOf('/');
    if (range && slash != null && slash >= 0) {
      const n = Number.parseInt(range.slice(slash + 1), 10);
      if (!Number.isNaN(n)) total = n;
    }
  }

  return { data, total, status: res.status };
}

/**
 * PATCH a PostgREST resource with the caller's JWT. `options.search` must
 * carry the row filter (e.g. `id=eq.<uuid>`) plus an optional `select` for
 * the returned shape. Asks for `return=representation`, so `data` holds the
 * updated rows — an empty array means no row matched the filter (missing id
 * or RLS denied; PostgREST does not distinguish the two).
 */
export async function pgPatch<T = unknown>(
  env: SupabaseEnv,
  path: string,
  jwt: string | null,
  patch: Record<string, unknown>,
  options: PostgrestOptions = {},
): Promise<PostgrestResult<T>> {
  const url = resourceUrl(env, path, options.search);

  const headers: Record<string, string> = {
    ...baseHeaders(env, jwt),
    'content-type': 'application/json',
    Prefer: 'return=representation',
  };

  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  const body = await res.text();

  if (!res.ok) throw new PostgrestError(res.status, body);

  const data = body ? (JSON.parse(body) as T[]) : [];
  return { data, total: null, status: res.status };
}

/**
 * Call a Postgres function (RPC) via PostgREST. Pass named arguments as an
 * object — PostgREST matches them to the function's parameter names.
 * Returns the rows the function yields (a single-row scalar function comes
 * back as a one-element array).
 */
export async function pgPostRpc<T = unknown>(
  env: SupabaseEnv,
  functionName: string,
  jwt: string | null,
  args: Record<string, unknown> = {},
): Promise<PostgrestResult<T>> {
  const url = new URL(`/rest/v1/rpc/${functionName}`, env.PUBLIC_SUPABASE_URL);

  const headers: Record<string, string> = {
    ...baseHeaders(env, jwt),
    'content-type': 'application/json',
  };

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  const body = await res.text();

  if (!res.ok) throw new PostgrestError(res.status, body);

  // PostgREST wraps set-returning functions as a JSON array; scalar returns
  // arrive as a naked value. Normalise to an array either way.
  const parsed = body ? JSON.parse(body) : [];
  const data = (Array.isArray(parsed) ? parsed : [parsed]) as T[];

  return { data, total: null, status: res.status };
}
