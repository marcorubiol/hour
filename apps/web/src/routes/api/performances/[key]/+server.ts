/**
 * GET /api/performances/:key
 *
 * Single performance with the full detail bundle: venue, line, project,
 * engagement (+person), crew, cast overrides, related dates, assets, and
 * the project's canonical cast (ADR-034).
 *
 * `:key` is a uuid, or a slug combined with `?ws=<workspace-slug>` (slugs
 * are unique per workspace, ADR-024).
 *
 * RLS authorizes (`has_permission(project_id, 'edit:show')` on the base
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
 * trio, engagement/line links. Whitelisted by PerformancePatchSchema; no
 * money, no notes (collab doc owns notes, ADR-042). RLS enforces
 * has_permission(project_id, 'edit:show') on UPDATE.
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
      lookup.set('select', 'id,project_id,workspace_id');
      lookup.set('id', `eq.${key}`);
    } else {
      lookup.set('select', 'id,project_id,workspace_id,workspace:workspace_id!inner(slug)');
      lookup.set('slug', `eq.${key}`);
      lookup.set('workspace.slug', `eq.${ws}`);
    }
    lookup.set('deleted_at', 'is.null');
    lookup.set('limit', '1');
    const found = await pgGet<{ id: string; project_id: string; workspace_id: string }>(
      env,
      'performance',
      jwt,
      { search: lookup },
    );
    if (found.data.length === 0) return json({ error: 'not_found' }, 404);
    const id = found.data[0].id;
    const projectId = found.data[0].project_id;
    const workspaceId = found.data[0].workspace_id;

    // Relink guard — the create RPC enforces that engagement/line belong
    // to the performance's project; updates must hold the same invariant
    // (the FKs are unscoped, RLS only checks the performance's project).
    for (const [field, table] of [
      ['engagement_id', 'engagement'],
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
      check.set('select', 'id');
      check.set('id', `eq.${patch.venue_id}`);
      check.set('workspace_id', `eq.${workspaceId}`);
      check.set('deleted_at', 'is.null');
      check.set('limit', '1');
      const row = await pgGet<{ id: string }>(env, 'venue', jwt, { search: check });
      if (row.data.length === 0) {
        return json(
          { error: 'cross_workspace_link', hint: "venue_id must belong to the performance's workspace." },
          400,
        );
      }
    }

    const search = new URLSearchParams();
    search.set('id', `eq.${id}`);
    search.set('deleted_at', 'is.null');
    const { data } = await pgPatch<Record<string, unknown>>(
      env,
      'performance',
      jwt,
      patch,
      { search },
    );
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ performance: data[0] });
  } catch (err) {
    // 23514 = CHECK violation (timeslot ordering, country format) → the
    // caller sent an impossible combination, not a gateway fault.
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/performances/[key]', requestId: locals.requestId },
      {
        codes: {
          '23514': {
            status: 400,
            error: 'constraint_violation',
            hint: 'Timeslots must be ordered: load in ≤ soundcheck ≤ start ≤ load out ≤ wrap.',
          },
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
 * has_permission(project, 'edit:show').
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
