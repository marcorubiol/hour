/**
 * POST /api/late-notices/:id/move: «Mover <moment> a HH:MM» (121 B, ADR-180),
 * once a person who edits the performance confirmed it.
 *
 * The move is the notice's, never the client's: `roadsheet_late_move_plan`
 * says which moment, from what time and to what time (the time when warned
 * plus the minutes), and only to `edit:performance`. The time moves THROUGH
 * the collab doc, which manda on the running order (ADR-090 P2): one moment,
 * compare-and-set, the others stay. Then `record_roadsheet_late_move` notes
 * it (the same move or nothing), marks it seen and leaves the line in the
 * bolo group.
 *
 * 409 `moment_changed`: someone edited that time meanwhile; nothing moved.
 * 503 `collab_unavailable`: the doc could not be reached; nothing moved.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { decodeJwtPayload } from '$lib/server/session';
import { MomentChangedError, moveMomentInDoc } from '$lib/server/collab-schedule';

const IdSchema = v.pipe(v.string(), v.uuid());

interface MovePlan {
  performance_id: string;
  slot_id: string;
  from: string;
  to: string;
}

const CODES = {
  '42501': { status: 403, error: 'forbidden_or_not_found' },
  '22023': { status: 409, error: 'nothing_to_move' },
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const id = v.safeParse(IdSchema, params.id);
  if (!id.success) return json({ error: 'invalid_id' }, 400);

  let plan: MovePlan | undefined;
  try {
    const { data } = await pgPostRpc<MovePlan>(env, 'roadsheet_late_move_plan', jwt, { p_notice_id: id.output });
    plan = data[0];
  } catch (err) {
    return pgErrorResponse(err, { route: 'POST /api/late-notices/[id]/move', requestId: locals.requestId }, { codes: CODES });
  }
  if (!plan) return json({ error: 'not_found' }, 404);

  const userId = decodeJwtPayload(jwt)?.sub;
  if (typeof userId !== 'string' || !platform.env.ROADSHEET_COLLAB) {
    return json({ error: 'collab_unavailable' }, 503);
  }
  try {
    await moveMomentInDoc(
      platform.env.ROADSHEET_COLLAB,
      'performance',
      plan.performance_id,
      userId,
      plan.slot_id,
      plan.from,
      plan.to,
    );
  } catch (error) {
    if (error instanceof MomentChangedError) return json({ error: 'moment_changed' }, 409);
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'late_move_failed',
        request_id: locals.requestId ?? null,
        notice_id: id.output,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ error: 'collab_unavailable' }, 503);
  }

  try {
    await pgPostRpc(env, 'record_roadsheet_late_move', jwt, {
      p_notice_id: id.output,
      p_from: plan.from,
      p_to: plan.to,
    });
  } catch (err) {
    // The time already moved in the doc; only the note of it failed.
    return pgErrorResponse(err, { route: 'POST /api/late-notices/[id]/move', requestId: locals.requestId }, { codes: CODES });
  }
  return json({ moved: { from: plan.from, to: plan.to } });
};
