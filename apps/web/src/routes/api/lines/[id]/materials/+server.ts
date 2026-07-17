/**
 * GET /api/lines/:id/materials — the line's versioned-materials registry
 * (ADR-056, Materials module v1: rows + links, upload arrives with R2 UI).
 *
 * POST — register a version. Goes through `create_asset_version` (the
 * INSERT is claim-bound — ninth case of the pattern). Line scope only
 * admits direction 'outbound' in v1 (the table CHECK forbids 'inbound'
 * without a performance and 'adapted' needs a source).
 *
 * Auth: Bearer JWT required. RLS (edit:performance via the line's project)
 * decides visibility.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { ASSET_KINDS, MaterialCreateSchema, type MaterialItem } from '$lib/material';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

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

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) return json({ error: 'invalid_query' }, 400);
  const { kind, limit } = parsed.output;

  // Resolve the line first (like the sibling people endpoint): an
  // invisible/unknown line is a 404, not an empty registry.
  const lineLookup = new URLSearchParams();
  lineLookup.set('select', 'id');
  lineLookup.set('id', `eq.${idParsed.output}`);
  lineLookup.set('deleted_at', 'is.null');
  lineLookup.set('limit', '1');
  try {
    const line = await pgGet<{ id: string }>(env, 'line', jwt, { search: lineLookup });
    if (line.data.length === 0) return json({ error: 'not_found' }, 404);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/lines/[id]/materials', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }

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
    return pgErrorResponse(
      err,
      { route: 'GET /api/lines/[id]/materials', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
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
    return pgErrorResponse(
      err,
      { route: 'POST /api/lines/[id]/materials', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 404, error: 'not_found' },
        },
      },
    );
  }
};
