/**
 * «Lo conozco» (ADR-138 § 5).
 *
 * GET /api/acquaintances: las marcas que quien llama lee en todos sus espacios
 *     (las suyas y las compartidas de dossiers que lee; la RLS decide) y el
 *     nombre de sus dueños. Todas de una vez: la lente de Conversaciones cruza
 *     espacios, y son pocas filas por persona del equipo.
 * PUT /api/acquaintances: { workspace_id, person_id, known, shared } por la
 *     RPC `set_acquaintance`, que solo escribe la fila propia de un dossier
 *     que quien llama lee. `known: false` borra la marca.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decodeJwtPayload } from '$lib/server/session';
import { authorNames } from '$lib/server/threads';
import type { Acquaintance, AcquaintanceView } from '$lib/acquaintance';
import { json } from '$lib/server/http';

const SELECT = 'workspace_id,person_id,user_id,shared';

const BodySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  person_id: v.pipe(v.string(), v.uuid()),
  known: v.boolean(),
  shared: v.optional(v.boolean(), false),
});

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const me = decodeJwtPayload(jwt)?.sub;
  if (typeof me !== 'string') return json({ error: 'missing_authorization' }, 401);

  try {
    const { data } = await pgGet<Acquaintance>(env, 'person_acquaintance', jwt, { search: { select: SELECT } });
    const others = data.filter((a) => a.user_id !== me).map((a) => a.user_id);
    const view: AcquaintanceView = { me, items: data, names: await authorNames(env, jwt, others) };
    return json(view);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/acquaintances', requestId: locals.requestId });
  }
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((pp) => pp.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  try {
    const { data } = await pgPostRpc<Acquaintance>(env, 'set_acquaintance', jwt, {
      p_workspace_id: input.workspace_id,
      p_person_id: input.person_id,
      p_known: input.known,
      p_shared: input.shared,
    });
    return json({ acquaintance: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/acquaintances', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          // Un dossier que no lees: no existe para ti.
          '42501': { status: 404, error: 'not_found' },
        },
      },
    );
  }
};
