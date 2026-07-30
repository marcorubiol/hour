/**
 * The project's cast — the roster writer that did not exist (task 20).
 *
 * GET  /api/projects/:id/cast — the live cast, plus the people who COULD be
 *      cast (the workspace's dossiers). Both in one response because the
 *      screen needs both to draw a picker and there is no reason to pay two
 *      round trips for one panel.
 * POST /api/projects/:id/cast — { person_id, role } via the `add_cast_member`
 *      RPC.
 *
 * Why an RPC and not a direct insert: `cast_member_insert` is claim-bound
 * (`workspace_id = current_workspace_id()`), and the app does not re-issue a
 * token per workspace — a direct insert would only work for whichever
 * workspace the JWT claim happens to name. Same reason `create_date` exists.
 *
 * Why this matters beyond one screen: `/api/team` is `cast_member ∪
 * crew_assignment`, so this endpoint is what finally lets somebody enter the
 * ⌘K person search, the person pins (ADR-092) and the Planner's person axis.
 * Until it existed the only rosters in production were seeded by hand.
 *
 * Auth: Bearer JWT required. RLS scopes reads; the RPC gates writes on
 * has_permission(project, 'edit:performance').
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

const BodySchema = v.object({
  person_id: v.pipe(v.string(), v.uuid()),
  // Mirrors the column: NOT NULL with a non-empty CHECK. A cast row without
  // a role is not a fact anybody can use.
  role: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
});

/** The person shape both halves of the response share. */
const PERSON_SELECT =
  'person:workspace_person!cast_member_workspace_person_fkey(id:person_id,slug,full_name,email)';

type CastRow = {
  id: string;
  role: string;
  person: { id: string; slug: string | null; full_name: string; email: string | null } | null;
};

type CandidateRow = {
  person_id: string;
  slug: string | null;
  full_name: string;
  email: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Resolve the project and its workspace. Returns null when RLS hides it —
 * not-found and no-membership collapse, so this is never an existence oracle.
 */
async function resolveProject(
  env: SupabaseEnv,
  jwt: string,
  projectId: string,
): Promise<{ id: string; workspace_id: string } | null> {
  const search = new URLSearchParams({
    select: 'id,workspace_id',
    id: `eq.${projectId}`,
    deleted_at: 'is.null',
    limit: '1',
  });
  const { data } = await pgGet<{ id: string; workspace_id: string }>(env, 'project', jwt, {
    search,
  });
  return data[0] ?? null;
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const project = await resolveProject(env, jwt, idParsed.output);
    if (!project) return json({ error: 'not_found' }, 404);

    const castSearch = new URLSearchParams({
      select: `id,role,${PERSON_SELECT}`,
      project_id: `eq.${project.id}`,
      deleted_at: 'is.null',
      order: 'role.asc',
    });

    // Everybody with a dossier here — the pool the picker offers. Casting
    // REQUIRES a dossier (`cast_member_workspace_person_fkey`), so a person
    // outside this list is not a candidate the UI may show.
    const peopleSearch = new URLSearchParams({
      select: 'person_id,slug,full_name,email',
      workspace_id: `eq.${project.workspace_id}`,
      deleted_at: 'is.null',
      order: 'full_name.asc',
    });

    const [cast, people] = await Promise.all([
      pgGet<CastRow>(env, 'cast_member', jwt, { search: castSearch }),
      pgGet<CandidateRow>(env, 'workspace_person', jwt, { search: peopleSearch }),
    ]);

    return json({ cast: cast.data, people: people.data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/projects/[id]/cast', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

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
    const { data } = await pgPostRpc<CastRow>(env, 'add_cast_member', jwt, {
      p_project_id: idParsed.output,
      p_person_id: parsed.output.person_id,
      p_role: parsed.output.role,
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ member: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/projects/[id]/cast', requestId: locals.requestId },
      {
        codes: {
          // The RPC's own sentences: a missing dossier and an empty role are
          // the caller's problem, a repeat is a conflict, and a hidden
          // project reads as forbidden (never as "does not exist").
          '22023': { status: 400, error: 'invalid_input' },
          '23505': { status: 409, error: 'already_cast' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
