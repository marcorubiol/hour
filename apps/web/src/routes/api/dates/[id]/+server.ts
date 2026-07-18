/**
 * PATCH /api/dates/:id — edit a date row's operational fields (ADR-078).
 * Direct PostgREST PATCH: date_update RLS gates on
 * has_permission(project, 'edit:performance'), is NOT claim-bound, and the
 * row stays SELECT-visible after a field edit (ADR-048 only bites
 * soft-deletes). Whitelisted by DatePatchSchema — NO project_id (rescoping
 * is delete + recreate, the expense rule). `status` accepts the full
 * lifecycle here (cancelled/done are edit states, ADR-078 §9).
 *
 * Cross-project guard (ADR-043 pattern, same as PATCH /api/performances):
 * line_id / performance_id relinks must stay inside the date's project —
 * the FKs are unscoped, RLS only checks the date's own project.
 *
 * Invariant maintenance the DB can't express:
 * - travel_direction rides only kind='travel_day' (DB CHECK): a kind
 *   change away from travel_day auto-clears the direction instead of
 *   tripping 23514.
 * - label rides only kind='other' at custom_fields.label (ADR-078 §8, no
 *   DB CHECK): this endpoint is the only PATCH-side writer of
 *   custom_fields, only ever touches the `label` key, and strips it when
 *   the kind moves away from 'other' (keeps GET /api/dates/labels honest).
 *
 * DELETE /api/dates/:id — soft-delete via the `delete_date` RPC (ADR-048:
 * no DELETE policy, deleted_at never rides a client PATCH).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { DatePatchSchema, type DateRow } from '$lib/date';
import { pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);
  const id = idParsed.output;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const parsed = v.safeParse(DatePatchSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;
  if (Object.keys(input).length === 0) {
    return json({ error: 'empty_patch' }, 400);
  }

  try {
    // Current row: project for the relink guards, kind + custom_fields for
    // the travel/label invariants.
    const lookup = new URLSearchParams();
    lookup.set('select', 'id,project_id,kind,custom_fields');
    lookup.set('id', `eq.${id}`);
    lookup.set('deleted_at', 'is.null');
    lookup.set('limit', '1');
    const found = await pgGet<{
      id: string;
      project_id: string;
      kind: string;
      custom_fields: unknown;
    }>(env, 'date', jwt, { search: lookup });
    if (found.data.length === 0) return json({ error: 'not_found' }, 404);
    const row = found.data[0];
    const effectiveKind = input.kind ?? row.kind;

    // Relink guard — line/performance must belong to the date's project
    // (create_date enforces the same invariant; updates must hold it).
    for (const [field, table] of [
      ['line_id', 'line'],
      ['performance_id', 'performance'],
    ] as const) {
      const value = input[field];
      if (!value) continue;
      const check = new URLSearchParams();
      check.set('select', 'id');
      check.set('id', `eq.${value}`);
      check.set('project_id', `eq.${row.project_id}`);
      check.set('deleted_at', 'is.null');
      check.set('limit', '1');
      const linked = await pgGet<{ id: string }>(env, table, jwt, { search: check });
      if (linked.data.length === 0) {
        return json(
          { error: 'cross_project_link', hint: `${field} must belong to the date's project.` },
          400,
        );
      }
    }

    // Travel invariant: direction only on travel days.
    if (input.travel_direction && effectiveKind !== 'travel_day') {
      return json(
        { error: 'invalid_body', hint: "travel_direction requires kind='travel_day'." },
        400,
      );
    }

    const { label, ...patch } = input as Record<string, unknown> & {
      label?: string | null;
    };
    if (patch.country) patch.country = (patch.country as string).toUpperCase();

    // Kind moved away from travel_day without an explicit direction → clear
    // it, so the edit doesn't die on the DB CHECK.
    if (input.kind && input.kind !== 'travel_day' && input.travel_direction === undefined) {
      patch.travel_direction = null;
    }

    // Label ↔ custom_fields (ADR-078 §8): only the `label` key, ever.
    const stored =
      row.custom_fields && typeof row.custom_fields === 'object' && !Array.isArray(row.custom_fields)
        ? (row.custom_fields as Record<string, unknown>)
        : {};
    if (label !== undefined) {
      if (label && effectiveKind !== 'other') {
        return json(
          { error: 'invalid_body', hint: "label is only accepted for kind='other'." },
          400,
        );
      }
      const next = { ...stored };
      if (label) next.label = label;
      else delete next.label;
      patch.custom_fields = next;
    } else if (input.kind && input.kind !== 'other' && stored.label !== undefined) {
      const next = { ...stored };
      delete next.label;
      patch.custom_fields = next;
    }

    if (Object.keys(patch).length === 0) {
      return json({ error: 'empty_patch' }, 400);
    }

    const search = new URLSearchParams();
    search.set('id', `eq.${id}`);
    search.set('deleted_at', 'is.null');
    const { data } = await pgPatch<DateRow>(env, 'date', jwt, patch, { search });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ date: data[0] });
  } catch (err) {
    // 23514 = a CHECK on the final row (travel_direction × kind, country).
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/dates/[id]', requestId: locals.requestId },
      {
        codes: { '23514': { status: 400, error: 'constraint_violation' } },
        passUpstream: [401, 403],
      },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_date', jwt, { p_date_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    // 42501 collapses not-found and no-permission → 404 (no existence oracle).
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/dates/[id]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
