/**
 * /api/schedule/:target/:id — the running order of a performance or a date,
 * READ (ADR-090). `target` is `performance` or `date`; one endpoint because
 * the table is one (`schedule_slot`, performance XOR date).
 *
 * GET → `{ slots, can_edit }`. `slots` in their order; `can_edit` is
 * `has_permission(project, 'edit:performance')`, the gate of the collab doc
 * the editor writes through, so the screen draws the editor only to whoever
 * the doc would let in.
 *
 * NO WRITES HERE ANY MORE (ADR-090 P2, Marco 2026-10-10: the doc manda, like
 * the notes). The running order is written into the `schedule` array of the
 * target's collab doc (`/api/collab/<target>/<id>`), and the RoadsheetCollab
 * Durable Object materializes it into these rows. The PUT (whole order) and
 * PATCH (move) of P3 were a second writer the doc would have overwritten on
 * its next save; they are gone, and a stale client gets 405.
 *
 * Auth: the session's JWT. RLS reads; a parent that is not there for this
 * user answers 404.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { RUNNING_ORDER_TARGETS } from '$lib/running-order';
import type { ScheduleSlotRow } from '$lib/schedule-slot';

const SLOT_SELECT = 'id,kind,label,at,ends_at,sort,notes';

const ParamsSchema = v.object({
  target: v.picklist(RUNNING_ORDER_TARGETS),
  id: v.pipe(v.string(), v.uuid()),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** The parent row, as RLS lets this user see it. Null = not there for them. */
async function parentOf(
  env: SupabaseEnv,
  jwt: string,
  target: 'performance' | 'date',
  id: string,
): Promise<{ id: string; project_id: string } | null> {
  const search = new URLSearchParams();
  search.set('select', 'id,project_id');
  search.set('id', `eq.${id}`);
  search.set('deleted_at', 'is.null');
  search.set('limit', '1');
  const { data } = await pgGet<{ id: string; project_id: string }>(env, target, jwt, { search });
  return data[0] ?? null;
}

async function slotsOf(
  env: SupabaseEnv,
  jwt: string,
  target: 'performance' | 'date',
  id: string,
): Promise<ScheduleSlotRow[]> {
  const search = new URLSearchParams();
  search.set('select', SLOT_SELECT);
  search.set(target === 'performance' ? 'performance_id' : 'date_id', `eq.${id}`);
  search.set('order', 'sort.asc');
  const { data } = await pgGet<ScheduleSlotRow>(env, 'schedule_slot', jwt, { search });
  return data;
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const p = v.safeParse(ParamsSchema, params);
  if (!p.success) return json({ error: 'invalid_target' }, 400);
  const { target, id } = p.output;

  try {
    const parent = await parentOf(env, jwt, target, id);
    if (!parent) return json({ error: 'not_found' }, 404);
    const [slots, perm] = await Promise.all([
      slotsOf(env, jwt, target, id),
      pgPostRpc<boolean>(env, 'has_permission', jwt, {
        p_project_id: parent.project_id,
        p_perm: 'edit:performance',
      }),
    ]);
    return json({ slots, can_edit: perm.data[0] === true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/schedule/[target]/[id]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

