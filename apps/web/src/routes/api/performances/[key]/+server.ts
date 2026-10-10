/**
 * GET /api/performances/:key
 *
 * Single performance with the full detail bundle: venue, line, project,
 * conversation (+person), crew, cast overrides, related dates, assets, and
 * the project's canonical cast (ADR-034).
 *
 * `:key` is a uuid, or a slug combined with `?ws=<workspace-slug>` (slugs
 * are unique per workspace, ADR-024).
 *
 * RLS authorizes (`has_permission(project_id, 'edit:performance')` on the base
 * table); zero rows map to 404 without confirming existence.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { PerformancePatchSchema } from '$lib/performance';
import { fetchPerformanceBundle, isUuid } from '$lib/server/performance-bundle';
import { pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import {
  SCHEDULE_SLOT_EMBED,
  applyTimeslotPatch,
  reinterpretSlots,
  splitTimeslotPatch,
  timeslotsFromSlots,
  timeslotsOrdered,
  withTimeslots,
  type ScheduleSlotRow,
} from '$lib/schedule-slot';

/** The two clocks a running order can be typed in: its venue's, else home. */
const CLOCK_EMBED = 'venue_id,venue:venue_id(timezone)';
const ORDER_HINT = 'Timeslots must be ordered: load in ≤ soundcheck ≤ start ≤ load out ≤ wrap.';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) {
    return json(
      { error: 'missing_authorization', hint: 'Send Authorization: Bearer <supabase_jwt>.' },
      401,
    );
  }

  const key = params.key;
  const ws = url.searchParams.get('ws');
  if (!isUuid(key) && !ws) {
    return json(
      { error: 'invalid_key', hint: 'Pass a uuid, or a slug with ?ws=<workspace-slug>.' },
      400,
    );
  }

  try {
    const bundle = await fetchPerformanceBundle(env, jwt, key, ws);
    if (!bundle) return json({ error: 'not_found' }, 404);
    return json(bundle);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/performances/[key]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

/**
 * PATCH /api/performances/:key — update the operational fields of a gig
 * (ADR-043): status, performed_at, the 5 timeslots, denormalized venue
 * trio, conversation/line links. The timeslots are `schedule_slot` rows
 * since ADR-090: they are written with `replace_schedule_slots` (whole
 * running order, one transaction) and the response derives the five fields. Whitelisted by PerformancePatchSchema; no
 * money, no notes (collab doc owns notes, ADR-042). RLS enforces
 * has_permission(project_id, 'edit:performance') on UPDATE.
 *
 * PostgREST mutations can't filter through embedded joins, so slug keys
 * resolve to an id first.
 */
export const PATCH: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const key = params.key;
  const ws = url.searchParams.get('ws');
  if (!isUuid(key) && !ws) {
    return json(
      { error: 'invalid_key', hint: 'Pass a uuid, or a slug with ?ws=<workspace-slug>.' },
      400,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PerformancePatchSchema, raw);
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
  const patch = { ...parsed.output };
  if (patch.country) patch.country = patch.country.toUpperCase();
  if (Object.keys(patch).length === 0) {
    return json({ error: 'empty_patch' }, 400);
  }

  try {
    // Resolve id + project_id in one lookup (uuid keys included — the
    // project is needed to guard relinks below).
    const lookup = new URLSearchParams();
    if (isUuid(key)) {
      lookup.set('select', `id,project_id,workspace_id,${CLOCK_EMBED},workspace:workspace_id(timezone)`);
      lookup.set('id', `eq.${key}`);
    } else {
      lookup.set(
        'select',
        `id,project_id,workspace_id,${CLOCK_EMBED},workspace:workspace_id!inner(slug,timezone)`,
      );
      lookup.set('slug', `eq.${key}`);
      lookup.set('workspace.slug', `eq.${ws}`);
    }
    lookup.set('deleted_at', 'is.null');
    lookup.set('limit', '1');
    const found = await pgGet<{
      id: string;
      project_id: string;
      workspace_id: string;
      venue_id: string | null;
      venue: { timezone: string | null } | null;
      workspace: { timezone: string | null } | null;
    }>(
      env,
      'performance',
      jwt,
      { search: lookup },
    );
    if (found.data.length === 0) return json({ error: 'not_found' }, 404);
    const id = found.data[0].id;
    const projectId = found.data[0].project_id;
    const workspaceId = found.data[0].workspace_id;
    const homeTz = found.data[0].workspace?.timezone ?? null;
    /** The running order's clock before this PATCH: the venue's, else home. */
    const clockBefore = found.data[0].venue?.timezone ?? homeTz;
    let clockAfter = clockBefore;

    // Relink guard — the create RPC enforces that conversation/line belong
    // to the performance's project; updates must hold the same invariant
    // (the FKs are unscoped, RLS only checks the performance's project).
    for (const [field, table] of [
      ['conversation_id', 'conversation'],
      ['line_id', 'line'],
    ] as const) {
      const value = patch[field];
      if (!value) continue;
      const check = new URLSearchParams();
      check.set('select', 'id');
      check.set('id', `eq.${value}`);
      check.set('project_id', `eq.${projectId}`);
      check.set('deleted_at', 'is.null');
      check.set('limit', '1');
      const row = await pgGet<{ id: string }>(env, table, jwt, { search: check });
      if (row.data.length === 0) {
        return json(
          { error: 'cross_project_link', hint: `${field} must belong to the performance's project.` },
          400,
        );
      }
    }

    // Venue is workspace-scoped (not project-scoped) — same relink guard
    // one level up (ADR-049).
    if (patch.venue_id) {
      const check = new URLSearchParams();
      check.set('select', 'id,timezone');
      check.set('id', `eq.${patch.venue_id}`);
      check.set('workspace_id', `eq.${workspaceId}`);
      check.set('deleted_at', 'is.null');
      check.set('limit', '1');
      const row = await pgGet<{ id: string; timezone: string | null }>(env, 'venue', jwt, {
        search: check,
      });
      if (row.data.length === 0) {
        return json(
          { error: 'cross_workspace_link', hint: "venue_id must belong to the performance's workspace." },
          400,
        );
      }
      clockAfter = row.data[0].timezone ?? homeTz;
    } else if ('venue_id' in patch) {
      clockAfter = homeTz; // unlinked: back to the home space's clock
    }
    // Relinked to a venue in another zone: the running order keeps its wall
    // clock and gets new instants (`reinterpretSlots`). The only writer of
    // that rule, so the screens never have to remember it.
    const rezone =
      clockBefore !== null && clockAfter !== null && clockBefore !== clockAfter
        ? { from: clockBefore, to: clockAfter }
        : null;

    const { timeslots, rest } = splitTimeslotPatch(patch);

    // The running order first (ADR-090). The order rule the old CHECK held
    // for the five fields is checked here, on the order that would result,
    // before anything is written.
    let scheduleMoved = false;
    if (Object.keys(timeslots).length > 0 || rezone) {
      const current = new URLSearchParams();
      current.set('select', 'id,kind,label,at,ends_at,sort,notes');
      current.set('performance_id', `eq.${id}`);
      current.set('order', 'sort.asc');
      const { data: slots } = await pgGet<ScheduleSlotRow>(env, 'schedule_slot', jwt, {
        search: current,
      });
      // Rezone first, then the explicit timeslots: a value in the body is
      // already an instant and wins over the reinterpretation.
      const base = rezone ? reinterpretSlots(slots, rezone.from, rezone.to) : slots;
      const next = applyTimeslotPatch(base, timeslots);
      if (!timeslotsOrdered(timeslotsFromSlots(next.map((s, i) => ({ ...s, sort: i + 1 }))))) {
        return json({ error: 'constraint_violation', hint: ORDER_HINT }, 400);
      }
      if (Object.keys(timeslots).length > 0 || slots.length > 0) {
        await pgPostRpc(env, 'replace_schedule_slots', jwt, {
          p_target_table: 'performance',
          p_target_id: id,
          p_slots: next,
        });
      }
      scheduleMoved = Boolean(rezone) && slots.length > 0;
    }

    const search = new URLSearchParams();
    search.set('id', `eq.${id}`);
    search.set('deleted_at', 'is.null');
    search.set(
      'select',
      [
        'id,workspace_id,project_id,line_id,conversation_id,slug,performed_at,status',
        'venue_id,venue_name,city,country',
        SCHEDULE_SLOT_EMBED,
        'logistics,hospitality,technical,notes,custom_fields',
        'created_by,created_at,updated_at,deleted_at,previous_slugs,hold_notice_days,readiness',
      ].join(','),
    );
    // Only the timeslots changed → nothing to PATCH on the row; read it back.
    const { data } =
      Object.keys(rest).length > 0
        ? await pgPatch<Record<string, unknown> & { schedule_slot: ScheduleSlotRow[] }>(
            env,
            'performance',
            jwt,
            rest,
            { search },
          )
        : await pgGet<Record<string, unknown> & { schedule_slot: ScheduleSlotRow[] }>(
            env,
            'performance',
            jwt,
            { search },
          );
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({
      performance: withTimeslots(data[0]),
      // The screen says the hours were moved to the new venue's clock.
      ...(scheduleMoved && rezone ? { schedule_rezoned: rezone } : {}),
    });
  } catch (err) {
    // 23514 = CHECK violation (country format, a slot ending before it
    // starts) → the caller sent an impossible combination, not a gateway
    // fault. 42501 from replace_schedule_slots = no edit:performance.
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/performances/[key]', requestId: locals.requestId },
      {
        codes: {
          '23514': {
            status: 400,
            error: 'constraint_violation',
            hint: ORDER_HINT,
          },
          '42501': { status: 404, error: 'not_found' },
        },
        passUpstream: [401, 403],
      },
    );
  }
};

/**
 * DELETE /api/performances/:key — soft-delete a gig created by mistake
 * (ADR-052). Goes through the `delete_performance` RPC: ADR-048 rule —
 * with the universal `deleted_at IS NULL` SELECT pattern no soft-delete
 * can ride a client PATCH; always RPC. Gated on
 * has_permission(project, 'edit:performance').
 *
 * A gig that fell through is NOT deleted — that's status `cancelled`.
 * Live, non-cancelled invoices block deletion (409).
 */
export const DELETE: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const key = params.key;
  const ws = url.searchParams.get('ws');
  if (!isUuid(key) && !ws) {
    return json(
      { error: 'invalid_key', hint: 'Pass a uuid, or a slug with ?ws=<workspace-slug>.' },
      400,
    );
  }

  try {
    // Slug keys resolve to an id first (RPC takes a uuid).
    let id = key;
    if (!isUuid(key)) {
      const lookup = new URLSearchParams();
      lookup.set('select', 'id,workspace:workspace_id!inner(slug)');
      lookup.set('slug', `eq.${key}`);
      lookup.set('workspace.slug', `eq.${ws}`);
      lookup.set('deleted_at', 'is.null');
      lookup.set('limit', '1');
      const found = await pgGet<{ id: string }>(env, 'performance', jwt, { search: lookup });
      if (found.data.length === 0) return json({ error: 'not_found' }, 404);
      id = found.data[0].id;
    }

    await pgPostRpc(env, 'delete_performance', jwt, { p_performance_id: id });
    return new Response(null, { status: 204 });
  } catch (err) {
    // RPC RAISEs: 42501 collapses not-found and no-permission → 404
    // (existence is never confirmed); 23503 → live invoices block.
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/performances/[key]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '23503': {
            status: 409,
            error: 'performance_has_invoices',
            hint: 'Discard or cancel its invoices first — or set the gig to cancelled instead.',
          },
        },
      },
    );
  }
};
