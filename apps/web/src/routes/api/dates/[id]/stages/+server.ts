/**
 * /api/dates/:id/stages — the stages of one trip (ADR-089 P2, ADR-097).
 *
 * GET → `{ stages, can_edit }`, in their order. `can_edit` is
 * `has_permission(project, 'edit:performance')`, the RPCs' own gate, so the
 * screen draws the editor only to whoever the write would let through.
 *
 * POST `StageInput` → `create_travel_stage` (appends), then the new stage is
 * placed by its departure → `{ stages }`, the whole list after the write.
 *
 * Auth: the session's JWT. RLS reads, the RPCs write; 42501 is «not yours or
 * not there» and answers 404, as everywhere else. 22023 is a date that is
 * not a travel day: only a trip has stages.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, placeAndList, stagesOf } from '$lib/server/travel-stages';
import { StageInputSchema, stageRpcArgs, type TravelStageRow } from '$lib/travel-stage';

const Id = v.pipe(v.string(), v.uuid());

const CODES = {
  '42501': { status: 404, error: 'not_found' },
  '22023': { status: 400, error: 'invalid_body' },
  '23514': { status: 400, error: 'constraint_violation' },
};

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!v.is(Id, params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    const search = new URLSearchParams();
    search.set('select', 'id,project_id,kind');
    search.set('id', `eq.${params.id}`);
    search.set('deleted_at', 'is.null');
    search.set('limit', '1');
    const { data } = await pgGet<{ id: string; project_id: string; kind: string }>(env, 'date', jwt, {
      search,
    });
    const trip = data[0];
    if (!trip) return json({ error: 'not_found' }, 404);
    const [stages, perm] = await Promise.all([
      stagesOf(env, jwt, trip.id),
      pgPostRpc<boolean>(env, 'has_permission', jwt, {
        p_project_id: trip.project_id,
        p_perm: 'edit:performance',
      }),
    ]);
    return json({ stages, can_edit: trip.kind === 'travel_day' && perm.data[0] === true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/dates/[id]/stages', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!v.is(Id, params.id)) return json({ error: 'invalid_id' }, 400);

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
    const { data } = await pgPostRpc<TravelStageRow>(env, 'create_travel_stage', jwt, {
      p_date_id: params.id,
      ...stageRpcArgs(parsed.output),
    });
    const stages = await placeAndList(env, jwt, params.id, data[0]?.id ?? null);
    return json({ stages }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/dates/[id]/stages', requestId: locals.requestId },
      { codes: CODES, passUpstream: [401, 403] },
    );
  }
};
