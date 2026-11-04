/**
 * El mes en que empieza la temporada del espacio (tarea 78): septiembre por
 * defecto. Cuentas, Conversaciones, el Desk y `conversation_feed` cuentan la
 * temporada desde él (`$lib/season-year`, `private.season_start`).
 *
 * GET → { season_start_month, can_edit }
 * PUT { season_start_month: 1..12 } → lo cambia un admin (policy
 *     `workspace_update`, grant por columnas); para los demás, 404 sin
 *     confirmar nada.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const BodySchema = v.object({
  season_start_month: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
});

type Row = { season_start_month: number };

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  try {
    const [ws, admin] = await Promise.all([
      pgGet<Row>(env, 'workspace', jwt, { search: { select: 'season_start_month', id: `eq.${params.id}` } }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: params.id }),
    ]);
    const row = ws.data[0];
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ season_start_month: row.season_start_month, can_edit: admin.data[0] === true });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/workspaces/[id]/season', requestId: locals.requestId });
  }
};

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  try {
    const { data } = await pgPatch<Row>(
      env,
      'workspace',
      jwt,
      { season_start_month: parsed.output.season_start_month },
      { search: { id: `eq.${params.id}`, select: 'season_start_month' } },
    );
    if (!data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ season_start_month: data[0].season_start_month });
  } catch (err) {
    return pgErrorResponse(err, { route: 'PUT /api/workspaces/[id]/season', requestId: locals.requestId });
  }
};
