/**
 * Las lentes del espacio (ADR-132): cuáles no usa y quién puede cambiarlo.
 *
 * GET → { lenses_off, can_edit, admins } (admins: los nombres de quien
 *     administra el espacio, para que la pantalla de una lente apagada diga a
 *     quién pedírsela; vacío para un invitado)
 * PUT { lenses_off } → lo cambia un owner/admin por `update_workspace`; a los
 *     demás, 403.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { TOGGLE_LENSES } from '$lib/lenses.svelte';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/mail/http';

const BodySchema = v.object({ lenses_off: v.array(v.picklist(TOGGLE_LENSES)) });

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);
  try {
    const [ws, admin, admins] = await Promise.all([
      pgGet<{ lenses_off: string[] }>(env, 'workspace', jwt, {
        search: { select: 'lenses_off', id: `eq.${params.id}` },
      }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: params.id }),
      pgPostRpc<string>(env, 'workspace_admin_names', jwt, { p_workspace_id: params.id }),
    ]);
    const row = ws.data[0];
    if (!row) return json({ error: 'not_found' }, 404);
    return json({ lenses_off: row.lenses_off, can_edit: admin.data[0] === true, admins: admins.data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/workspaces/[id]/lenses', requestId: locals.requestId });
  }
};

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  try {
    const { data } = await pgPostRpc<{ lenses_off: string[] }>(env, 'update_workspace', jwt, {
      p_workspace_id: params.id,
      p_patch: { lenses_off: parsed.output.lenses_off },
    });
    if (!data[0]) return json({ error: 'not_found' }, 404);
    return json({ lenses_off: data[0].lenses_off });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/workspaces/[id]/lenses', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'rpc_error' },
          '23514': { status: 400, error: 'rpc_error' },
          '42501': { status: 403, error: 'forbidden' },
          P0002: { status: 404, error: 'not_found' },
        },
        passUpstream: [],
      },
    );
  }
};
