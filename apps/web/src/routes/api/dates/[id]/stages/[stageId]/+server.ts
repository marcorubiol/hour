/**
 * /api/dates/:id/stages/:stageId — one stage of a trip (ADR-097).
 *
 * PUT `StageInput` → `update_travel_stage`, which REPLACES the stage (what is
 * not sent is emptied), then it is placed by its departure → `{ stages }`.
 * DELETE → `delete_travel_stage` (a real delete; the audit log keeps the
 * row, and the positions close the gap) → `{ stages }`.
 *
 * Both answer with the whole list, so the screen never has to guess what a
 * reorder or a closed gap did to the rest.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, placeAndList, stagesOf } from '$lib/server/travel-stages';
import { StageInputSchema, stageRpcArgs } from '$lib/travel-stage';

const Id = v.pipe(v.string(), v.uuid());

const CODES = {
  '42501': { status: 404, error: 'not_found' },
  '22023': { status: 400, error: 'invalid_body' },
  '23514': { status: 400, error: 'constraint_violation' },
};

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!v.is(Id, params.id) || !v.is(Id, params.stageId)) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(StageInputSchema, raw);
  if (!parsed.success) {
    return json({ error: 'invalid_body', hint: parsed.issues[0]?.message }, 400);
  }

  try {
    // The stage must belong to THIS trip: the RPC only knows the stage id,
    // and a URL that says one trip must not edit another's stage.
    const mine = await stagesOf(env, jwt, params.id);
    if (!mine.some((s) => s.id === params.stageId)) return json({ error: 'not_found' }, 404);
    await pgPostRpc(env, 'update_travel_stage', jwt, {
      p_stage_id: params.stageId,
      ...stageRpcArgs(parsed.output),
    });
    const stages = await placeAndList(env, jwt, params.id, params.stageId);
    return json({ stages });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/dates/[id]/stages/[stageId]', requestId: locals.requestId },
      { codes: CODES, passUpstream: [401, 403] },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!v.is(Id, params.id) || !v.is(Id, params.stageId)) return json({ error: 'invalid_id' }, 400);

  try {
    const mine = await stagesOf(env, jwt, params.id);
    if (!mine.some((s) => s.id === params.stageId)) return json({ error: 'not_found' }, 404);
    await pgPostRpc(env, 'delete_travel_stage', jwt, { p_stage_id: params.stageId });
    const stages = await stagesOf(env, jwt, params.id);
    return json({ stages });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/dates/[id]/stages/[stageId]', requestId: locals.requestId },
      { codes: CODES, passUpstream: [401, 403] },
    );
  }
};
