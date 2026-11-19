/**
 * PUT /api/performances/[key]/preparation
 *
 * Close or reopen one hand-made thing of «Qué preparamos para una función»
 * (ADR-221, fase 3) on one performance: `{ thing: 'm_…', estado: 'hecho' |
 * 'no_aplica' | null }` (null reopens it). Goes through
 * `set_performance_preparation`, which gates on `edit:performance`, stamps who
 * and when, and leaves the rest of `custom_fields` alone. `key` is the
 * performance's uuid. Answers `{ preparation }`: the performance's whole state.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { MANUAL_ID_RE } from '$lib/preparation';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const BodySchema = v.object({
  thing: v.pipe(v.string(), v.regex(MANUAL_ID_RE)),
  estado: v.nullable(v.picklist(['hecho', 'no_aplica'])),
});

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const id = params.key ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'invalid_id', hint: 'Pass the performance uuid.' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) {
    return json(
      { error: 'invalid_body', issues: parsed.issues.map((i) => ({ path: i.path?.map((p) => p.key).join('.'), message: i.message })) },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<unknown>(env, 'set_performance_preparation', jwt, {
      p_performance_id: id,
      p_thing: parsed.output.thing,
      p_estado: parsed.output.estado,
    });
    return json({ preparation: data[0] ?? {} });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/performances/[key]/preparation', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'rpc_error' },
          '42501': { status: 403, error: 'forbidden' },
        },
        passUpstream: [],
      },
    );
  }
};
