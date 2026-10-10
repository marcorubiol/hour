/**
 * /api/schedule/:target/:id — the running order of a performance or a date
 * (ADR-090 P3). `target` is `performance` or `date`; one endpoint because the
 * table is one (`schedule_slot`, performance XOR date) and so is the RPC.
 *
 * GET → `{ slots, can_edit }`. `slots` in their order; `can_edit` is
 * `has_permission(project, 'edit:performance')`, the RPC's own gate, so the
 * screen draws the editor only to whoever the write would let through.
 *
 * PUT `{ slots: ScheduleSlotInput[] }` → the WHOLE order, written with
 * `replace_schedule_slots` (diff by id, one transaction) → `{ slots }`.
 * Whole order and not one row at a time on purpose: it is the shape P2 will
 * materialize from the collab doc, so the screen and the doc write the same
 * contract. When P2 lands, this PUT is what the doc replaces (ADR-090: «the
 * doc wins»), and the screen writes through the doc instead.
 *
 * The order rule the old CHECK held for the five legacy kinds (load in ≤
 * soundcheck ≤ start ≤ load out ≤ wrap) is kept here, as the PATCH of
 * /api/performances keeps it: a running order where the show starts before
 * its own load-in is refused, not stored.
 *
 * Auth: the session's JWT. RLS reads, the RPC writes; 42501 from the RPC is
 * «not yours or not there» and answers 404, as everywhere else.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { RUNNING_ORDER_TARGETS } from '$lib/running-order';
import {
  timeslotsFromSlots,
  timeslotsOrdered,
  type ScheduleSlotRow,
} from '$lib/schedule-slot';

const ORDER_HINT = 'Timeslots must be ordered: load in ≤ soundcheck ≤ start ≤ load out ≤ wrap.';
const SLOT_SELECT = 'id,kind,label,at,ends_at,sort,notes';

const ParamsSchema = v.object({
  target: v.picklist(RUNNING_ORDER_TARGETS),
  id: v.pipe(v.string(), v.uuid()),
});

const Iso = v.pipe(v.string(), v.isoTimestamp());

const SlotSchema = v.pipe(
  v.object({
    id: v.optional(v.pipe(v.string(), v.uuid())),
    kind: v.nullable(v.pipe(v.string(), v.regex(/^[a-z][a-z0-9_]{0,31}$/))),
    label: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200))),
    at: Iso,
    ends_at: v.nullable(Iso),
    notes: v.nullable(v.pipe(v.string(), v.maxLength(5000))),
  }),
  v.check((s) => Boolean(s.kind || s.label), 'a slot needs a kind or a label'),
  v.check(
    (s) => !s.ends_at || new Date(s.ends_at).getTime() >= new Date(s.at).getTime(),
    'a slot cannot end before it starts',
  ),
);

const PutSchema = v.object({ slots: v.pipe(v.array(SlotSchema), v.maxLength(200)) });

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

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const p = v.safeParse(ParamsSchema, params);
  if (!p.success) return json({ error: 'invalid_target' }, 400);
  const { target, id } = p.output;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PutSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((x) => x.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const slots = parsed.output.slots.map((s) => ({ ...s, label: s.label || null }));

  if (!timeslotsOrdered(timeslotsFromSlots(slots.map((s, i) => ({ ...s, sort: i + 1 }))))) {
    return json({ error: 'constraint_violation', hint: ORDER_HINT }, 400);
  }

  try {
    const { data } = await pgPostRpc<ScheduleSlotRow>(env, 'replace_schedule_slots', jwt, {
      p_target_table: target,
      p_target_id: id,
      p_slots: slots,
    });
    const rows = data.map(
      ({ id: sid, kind, label, at, ends_at, sort, notes }) => ({
        id: sid,
        kind,
        label,
        at,
        ends_at,
        sort,
        notes,
      }),
    );
    return json({ slots: rows });
  } catch (err) {
    // 42501 = no edit:performance, or the parent is not there for this user.
    // 22023 = a slot of another running order, a duplicate id, no `at`.
    // 23514 = a CHECK (a label too long, an end before its start).
    return pgErrorResponse(
      err,
      { route: 'PUT /api/schedule/[target]/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '22023': { status: 400, error: 'invalid_body' },
          '23514': { status: 400, error: 'constraint_violation' },
        },
        passUpstream: [401, 403],
      },
    );
  }
};
