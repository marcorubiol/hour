/**
 * «Voy / no voy» — one person's word on a performance or a date (ADR-103).
 *
 * PUT /api/commitments/:target/:id — { person_id, state: 'going' | 'not_going' | null }
 *     via the `set_commitment_person` RPC. `null` clears the word and the
 *     person goes back to being inferred from the project cast.
 *
 * The RPC is the gate: on yourself, being able to read the commitment is
 * enough; on anybody else it takes `edit:performance`. «No voy» on a person
 * already on a performance's explicit roster is refused (22023): that is a
 * roster edit, not an answer to an inference.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import type { Commitment } from '$lib/people';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ParamsSchema = v.object({
  target: v.picklist(['performance', 'date'] as const),
  id: v.pipe(v.string(), v.uuid()),
});

const BodySchema = v.object({
  person_id: v.pipe(v.string(), v.uuid()),
  state: v.nullable(v.picklist(['going', 'not_going'] as const)),
});

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const target = v.safeParse(ParamsSchema, params);
  if (!target.success) return json({ error: 'invalid_target' }, 400);

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

  try {
    const { data } = await pgPostRpc<Commitment>(env, 'set_commitment_person', jwt, {
      p_target_table: target.output.target,
      p_target_id: target.output.id,
      p_person_id: parsed.output.person_id,
      p_state: parsed.output.state,
    });
    return json({ commitment: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/commitments/[target]/[id]', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
