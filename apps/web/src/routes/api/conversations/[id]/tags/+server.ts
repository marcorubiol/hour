/**
 * PUT /api/conversations/:id/tags: { tag_ids: uuid[] }, al menos una.
 *
 * Deja en la conversación exactamente esas etiquetas activas (ADR-138 § 1),
 * por la RPC `set_conversation_tags`: quien edita la conversación
 * (`edit:conversation` y su privacidad). Una etiqueta de otro espacio, una
 * desactivada o una conversación que no editas: 403. Devuelve los ids que
 * lleva al acabar.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const BodySchema = v.object({
  tag_ids: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.minLength(1), v.maxLength(32)),
});

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
    const { data } = await pgPostRpc<string>(env, 'set_conversation_tags', jwt, {
      p_conversation_id: params.id,
      p_tag_ids: parsed.output.tag_ids,
    });
    return jsonNoStore({ tag_ids: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/conversations/[id]/tags', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden' },
          '22023': { status: 400, error: 'invalid_input' },
        },
      },
    );
  }
};
