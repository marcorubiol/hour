/**
 * GET /api/lines/:id/materials — the line's versioned-materials registry
 * (ADR-056, Materials module v1: rows + links, upload arrives with R2 UI).
 *
 * POST — register a version. Goes through `create_asset_version` (the
 * INSERT is claim-bound — ninth case of the pattern). Line scope only
 * admits direction 'outbound' in v1 (the table CHECK forbids 'inbound'
 * without a performance and 'adapted' needs a source).
 *
 * Auth: Bearer JWT required. RLS (edit:show via the line's project)
 * decides visibility.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { ASSET_KINDS, MaterialCreateSchema, type MaterialItem } from '$lib/material';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const IdSchema = v.pipe(v.string(), v.uuid());

const QuerySchema = v.object({
  kind: v.optional(v.union([v.literal('any'), v.picklist(ASSET_KINDS)]), 'any'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(200),
    ),
    '100',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const MATERIAL_SELECT = 'id,kind,direction,url,notes,uploaded_at,uploaded_by';

export const GET: RequestHandler = async ({ request, params, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) return json({ error: 'invalid_query' }, 400);
  const { kind, limit } = parsed.output;

  const search = new URLSearchParams();
  search.set('select', MATERIAL_SELECT);
  search.set('line_id', `eq.${idParsed.output}`);
  if (kind !== 'any') search.set('kind', `eq.${kind}`);
  search.set('deleted_at', 'is.null');
  search.set('order', 'uploaded_at.desc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<MaterialItem>(env, 'asset_version', jwt, { search });
    return json({ items: data });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};

export const POST: RequestHandler = async ({ request, params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(MaterialCreateSchema, raw);
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
    const { data } = await pgPostRpc<MaterialItem>(env, 'create_asset_version', jwt, {
      p_line_id: idParsed.output,
      p_kind: input.kind,
      p_url: input.url,
      p_notes: input.notes ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ material: data[0] }, 201);
  } catch (err) {
    if (err instanceof PostgrestError) {
      if (err.code === '22023') return json({ error: 'invalid_input', detail: err.body }, 400);
      if (err.code === '42501') return json({ error: 'not_found' }, 404);
      const upstream = err.status === 401 ? 401 : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
