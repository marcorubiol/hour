/**
 * POST /api/conversations/:id/read: la conversación, leída hasta ahora
 * (`mark_conversation_read`, ADR-138 fase 3): sus entrantes dejan de contar
 * como no leídos para quien llama. Solo sube. Devuelve { last_read_at }.
 * Una conversación que no lees, 403 (igual que una que no existe).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  try {
    const { data } = await pgPostRpc<string>(env, 'mark_conversation_read', jwt, { p_conversation_id: params.id });
    return jsonNoStore({ last_read_at: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/conversations/[id]/read', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden_or_not_found' } } },
    );
  }
};
