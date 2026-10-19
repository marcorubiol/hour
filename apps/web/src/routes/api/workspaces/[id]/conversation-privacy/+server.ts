/**
 * Cómo nacen las conversaciones nuevas del espacio (ADR-099, añadido del
 * 2026-10-11): privadas de quien las crea (por defecto) o compartidas.
 *
 * GET → { new_conversations_private, can_edit }
 * PUT { new_conversations_private: boolean } → lo cambia un admin (policy
 *     `workspace_update`); para los demás, 404 sin confirmar nada.
 * Las conversaciones que ya existen no cambian; cada persona cambia las suyas.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const BodySchema = v.object({ new_conversations_private: v.boolean() });

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  try {
    const [ws, admin] = await Promise.all([
      pgGet<{ new_conversations_private: boolean }>(env, 'workspace', jwt, {
        search: { select: 'new_conversations_private', id: `eq.${params.id}` },
      }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: params.id }),
    ]);
    const row = ws.data[0];
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ new_conversations_private: row.new_conversations_private, can_edit: admin.data[0] === true });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/workspaces/[id]/conversation-privacy', requestId: locals.requestId });
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
    const { data } = await pgPatch<{ new_conversations_private: boolean }>(
      env,
      'workspace',
      jwt,
      { new_conversations_private: parsed.output.new_conversations_private },
      { search: { id: `eq.${params.id}`, select: 'new_conversations_private' } },
    );
    if (!data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ new_conversations_private: data[0].new_conversations_private });
  } catch (err) {
    return pgErrorResponse(err, { route: 'PUT /api/workspaces/[id]/conversation-privacy', requestId: locals.requestId });
  }
};
