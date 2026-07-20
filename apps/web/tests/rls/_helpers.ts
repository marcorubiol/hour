/**
 * RLS regression suite — shared helpers.
 *
 * These tests hit the live `hour-phase0` Supabase project as a real
 * authenticated user (or as anon) and assert what PostgREST returns
 * AFTER all RLS policies have applied. They are intentionally NOT
 * unit tests — they're integration tests against production. Run via
 * `pnpm test:rls` (separate Vitest project), not `pnpm test:unit`.
 *
 * Required env vars (sourced from apps/web/.env.test or shell):
 *   PUBLIC_SUPABASE_URL
 *   PUBLIC_SUPABASE_ANON_KEY
 *   PW_TEST_EMAIL
 *   PW_TEST_PASSWORD
 *
 * Optional limited-role fixture (tests using it skip when absent):
 *   PW_LIMITED_EMAIL
 *   PW_LIMITED_PASSWORD
 */

const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const LIMITED_EMAIL = process.env.PW_LIMITED_EMAIL;
const LIMITED_PASSWORD = process.env.PW_LIMITED_PASSWORD;
const EXTERNAL_EMAIL = process.env.PW_EXTERNAL_EMAIL ?? 'external@hour.test';
const EXTERNAL_PASSWORD = process.env.PW_EXTERNAL_PASSWORD ?? LIMITED_PASSWORD;

export function envReady(): boolean {
  return Boolean(SB_URL && SB_ANON && EMAIL && PASSWORD);
}

export function requireEnv(): {
  url: string;
  anon: string;
  email: string;
  password: string;
} {
  if (!SB_URL || !SB_ANON || !EMAIL || !PASSWORD) {
    throw new Error(
      'RLS suite needs PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, PW_TEST_EMAIL, PW_TEST_PASSWORD',
    );
  }
  return { url: SB_URL, anon: SB_ANON, email: EMAIL, password: PASSWORD };
}

export function limitedEnvReady(): boolean {
  return Boolean(SB_URL && SB_ANON && LIMITED_EMAIL && LIMITED_PASSWORD);
}

export function requireLimitedEnv(): { email: string; password: string } {
  if (!LIMITED_EMAIL || !LIMITED_PASSWORD) {
    throw new Error(
      'Limited-role RLS tests need PW_LIMITED_EMAIL and PW_LIMITED_PASSWORD',
    );
  }
  return { email: LIMITED_EMAIL, password: LIMITED_PASSWORD };
}

export function externalEnvReady(): boolean {
  return Boolean(SB_URL && SB_ANON && EXTERNAL_EMAIL && EXTERNAL_PASSWORD);
}

export function requireExternalEnv(): { email: string; password: string } {
  if (!EXTERNAL_EMAIL || !EXTERNAL_PASSWORD) {
    throw new Error(
      'External-identity RLS tests need PW_EXTERNAL_PASSWORD or PW_LIMITED_PASSWORD',
    );
  }
  return { email: EXTERNAL_EMAIL, password: EXTERNAL_PASSWORD };
}

interface AuthOk {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Login programmatically via Supabase Auth REST API (same path the login
 * form uses). Returns the JWT to use in subsequent PostgREST requests.
 */
export async function login(email: string, password: string): Promise<string> {
  const { url, anon } = requireEnv();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Auth failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as AuthOk;
  return data.access_token;
}

interface PgResult<T> {
  status: number;
  rows: T[];
}

/**
 * Run a SELECT-style PostgREST query as either `authenticated` (with JWT)
 * or `anon` (no JWT). Returns the raw row array + HTTP status so tests
 * can assert both. Never throws on non-2xx — that's part of what we
 * test.
 */
export async function pgGet<T = unknown>(
  path: string,
  jwt: string | null,
  search?: URLSearchParams,
): Promise<PgResult<T>> {
  const { url, anon } = requireEnv();
  const u = new URL(`/rest/v1/${path.replace(/^\/+/, '')}`, url);
  if (search) for (const [k, v] of search) u.searchParams.append(k, v);

  const headers: Record<string, string> = {
    apikey: anon,
    Authorization: `Bearer ${jwt ?? anon}`,
    Accept: 'application/json',
  };

  const res = await fetch(u.toString(), { headers });
  let rows: T[] = [];
  if (res.ok) {
    const body = await res.text();
    if (body) rows = JSON.parse(body) as T[];
  }
  return { status: res.status, rows };
}

/**
 * Run a PATCH against PostgREST as either `authenticated` (with JWT) or
 * `anon` (no JWT), asking for `return=representation`. Like pgGet it never
 * throws on non-2xx — `rows` stays empty and `status` carries the code.
 * Zero returned rows on a 2xx means the filter matched nothing OR RLS
 * denied the update; PostgREST does not distinguish the two.
 */
export async function pgPatch<T = unknown>(
  path: string,
  jwt: string | null,
  patch: Record<string, unknown>,
  search?: URLSearchParams,
): Promise<PgResult<T>> {
  const { url, anon } = requireEnv();
  const u = new URL(`/rest/v1/${path.replace(/^\/+/, '')}`, url);
  if (search) for (const [k, v] of search) u.searchParams.append(k, v);

  const headers: Record<string, string> = {
    apikey: anon,
    Authorization: `Bearer ${jwt ?? anon}`,
    Accept: 'application/json',
    'content-type': 'application/json',
    Prefer: 'return=representation',
  };

  const res = await fetch(u.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  let rows: T[] = [];
  if (res.ok) {
    const body = await res.text();
    if (body) rows = JSON.parse(body) as T[];
  }
  return { status: res.status, rows };
}

/**
 * Call a Postgres function via PostgREST RPC as `authenticated` (with JWT)
 * or `anon` (no JWT). Never throws on non-2xx. Scalar-returning functions
 * come back as a naked JSON value — `data` carries it verbatim.
 */
export async function pgRpc<T = unknown>(
  functionName: string,
  jwt: string | null,
  args: Record<string, unknown> = {},
): Promise<{ status: number; data: T | null; error?: string }> {
  const { url, anon } = requireEnv();
  const u = new URL(`/rest/v1/rpc/${functionName}`, url);

  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${jwt ?? anon}`,
      Accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  let data: T | null = null;
  let error: string | undefined;
  if (res.ok) {
    const body = await res.text();
    if (body) data = JSON.parse(body) as T;
  } else {
    error = await res.text();
  }
  return { status: res.status, data, ...(error ? { error } : {}) };
}

/** Decode a JWT body (no signature verification — just inspect claims). */
export function decodeJwt(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split('.');
  if (!payload) throw new Error('Malformed JWT: no payload');
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<
    string,
    unknown
  >;
}
