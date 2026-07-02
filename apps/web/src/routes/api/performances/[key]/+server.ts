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
import { extractBearer } from '$lib/auth';
import { PerformancePatchSchema } from '$lib/performance';
import { fetchPerformanceBundle, isUuid } from '$lib/server/performance-bundle';
import { pgGet, pgPatch, PostgrestError, type SupabaseEnv } from '$lib/supabase';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, params, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
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
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
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
export const PATCH: RequestHandler = async ({ request, params, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
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
      lookup.set('select', 'id,project_id');
      lookup.set('id', `eq.${key}`);
    } else {
      lookup.set('select', 'id,project_id,workspace:workspace_id!inner(slug)');
      lookup.set('slug', `eq.${key}`);
      lookup.set('workspace.slug', `eq.${ws}`);
    }
    lookup.set('deleted_at', 'is.null');
    lookup.set('limit', '1');
    const found = await pgGet<{ id: string; project_id: string }>(env, 'performance', jwt, {
      search: lookup,
    });
    if (found.data.length === 0) return json({ error: 'not_found' }, 404);
    const id = found.data[0].id;
    const projectId = found.data[0].project_id;

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
    if (err instanceof PostgrestError) {
      // 23514 = CHECK violation (timeslot ordering, country format) → the
      // caller sent an impossible combination, not a gateway fault.
      if (err.code === '23514') {
        return json(
          {
            error: 'constraint_violation',
            hint: 'Timeslots must be ordered: load in ≤ soundcheck ≤ start ≤ load out ≤ wrap.',
            detail: err.body,
          },
          400,
        );
      }
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
