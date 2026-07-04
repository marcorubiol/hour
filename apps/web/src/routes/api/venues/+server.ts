/**
 * Venues — the linkable venue entity (ADR-049).
 *
 * GET  /api/venues?workspace_ids=&q= — RLS-gated list (workspace members
 *      see their workspace's venues), optional name search.
 * POST /api/venues — create via the `create_venue` RPC (the direct
 *      INSERT is claim-bound — fifth case of the pattern). Idempotent on
 *      (workspace, name, city): promoting an existing denormalized trio
 *      returns the existing venue.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { VENUE_COLS } from '$lib/venue';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const CreateSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^[A-Za-z]{2}$/, 'ISO 3166 alpha-2')))),
  address: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(300)))),
  capacity: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
  timezone: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(64)))),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseUuidList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const workspaceIds = parseUuidList(url.searchParams.get('workspace_ids'));
  const q = url.searchParams.get('q')?.trim() ?? '';

  const search = new URLSearchParams();
  search.set('select', VENUE_COLS);
  if (workspaceIds.length > 0) search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  if (q) {
    // Same PostgREST pattern-metacharacter hygiene as the engagement search.
    const safe = q.replace(/[%_*,()]/g, ' ').trim();
    if (safe) search.set('name', `ilike.*${safe}*`);
  }
  search.set('deleted_at', 'is.null');
  search.set('order', 'name.asc');
  search.set('limit', '200');

  try {
    const { data } = await pgGet(env, 'venue', jwt, { search });
    return json({ items: data });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(CreateSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  try {
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'create_venue', jwt, {
      p_workspace_id: input.workspace_id,
      p_name: input.name,
      p_city: input.city ?? null,
      p_country: input.country ?? null,
      p_address: input.address ?? null,
      p_capacity: input.capacity ?? null,
      p_timezone: input.timezone ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ venue: data[0] }, 201);
  } catch (err) {
    if (err instanceof PostgrestError) {
      if (err.code === '22023') return json({ error: 'invalid_input', detail: err.body }, 400);
      if (err.code === '42501') return json({ error: 'forbidden' }, 403);
      const upstream = err.status === 401 ? 401 : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
