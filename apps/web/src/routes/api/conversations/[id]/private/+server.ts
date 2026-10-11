/**
 * PUT /api/conversations/:id/private — { private: boolean }.
 *
 * Marca o desmarca una conversación como privada (ADR-099 punto 4): solo la
 * ve quien la marcó y desaparece para los demás, también de los recuentos.
 * La regla vive en la base (trigger `conversation_private_guard` y las
 * policies): solo te la marcas a ti y solo quien la marcó la desmarca.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPatch, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, jwtSubject, UUID_RE } from '$lib/server/mail/http';

const BodySchema = v.object({ private: v.boolean() });

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) return json({ error: 'missing_authorization' }, 401);
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
    const { data } = await pgPatch<{ id: string; private_to: string | null }>(
      env,
      'conversation',
      jwt,
      { private_to: parsed.output.private ? sub : null },
      { search: { id: `eq.${params.id}`, select: 'id,private_to' } },
    );
    if (!data[0]) return json({ error: 'not_found' }, 404);
    return json({ id: data[0].id, private: data[0].private_to !== null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/conversations/[id]/private', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          // 20261011500000: entre las vivas, una compartida por persona y
          // proyecto, y una privada por persona, proyecto y dueño. Las dos
          // filas que pueden chocar son visibles para quien llama.
          '23505': {
            status: 409,
            error: 'conversation_exists',
            hint: 'This person already has a conversation like this one in this project.',
          },
        },
      },
    );
  }
};
