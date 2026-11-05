/**
 * Road sheet public share links (ADR-047, D6). A share pins a performance
 * + a public role; the token opens `/public/roadsheet/:token` with no
 * account. Management is RPC-only — `roadsheet_share` is deny-all even
 * for authenticated, so the token never travels through PostgREST table
 * reads; both RPCs gate on `edit:performance`.
 *
 * GET  → active shares for the performance (token included: the operator
 *        needs it to build/copy the URL — it is not a secret FROM them),
 *        expired ones too, with `expires_at` (ADR-163 § 2): the screen says
 *        «caducó el …» and lets the date move.
 * POST → { role: venue|performer|tech_manager } → 201 with the new share.
 *
 * 121 B (ADR-180): a link can be someone's. GET also says whose each link
 * is (`person`) and who in the performance's team can get one (`team`,
 * `roadsheetTeam`); POST { person_id } creates a personal link through
 * `create_roadsheet_share_for_person`, which sets the role from the team
 * (crew: tech_manager, cast: performer). Only a personal link shows
 * «Llego tarde».
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { fetchPerformanceBundle, resolvePerformanceId } from '$lib/server/performance-bundle';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { roadsheetTeam, type TeamMember } from '$lib/roadsheet-late';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import type { RoadsheetShare } from '$lib/roadsheet';

const BodySchema = v.union([
  v.object({ role: v.picklist(['venue', 'performer', 'tech_manager']) }),
  v.object({ person_id: v.pipe(v.string(), v.uuid()) }),
]);

type ShareRow = Omit<RoadsheetShare, 'person'> & { person_id?: string | null };

function mapShare(s: ShareRow, team: readonly TeamMember[] = []): RoadsheetShare {
  const person = s.person_id
    ? { id: s.person_id, name: team.find((m) => m.person_id === s.person_id)?.name ?? '' }
    : null;
  return { id: s.id, token: s.token, role: s.role, created_at: s.created_at, expires_at: s.expires_at, person };
}

/**
 * The performance's team, as the caller reads it (RLS), for the personal
 * links. Secondary to the list: if it cannot be read, the links still list
 * (without names) and the failure goes to the log.
 */
async function readTeam(
  env: SupabaseEnv,
  jwt: string,
  performanceId: string,
  requestId: string | null | undefined,
): Promise<TeamMember[]> {
  try {
    const bundle = await fetchPerformanceBundle(env, jwt, performanceId, null);
    if (!bundle) return [];
    return roadsheetTeam(bundle.performance.crew_assignment, bundle.cast_members, bundle.performance.cast_override);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'roadsheet_team_read_failed',
        request_id: requestId ?? null,
        performance_id: performanceId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return [];
  }
}

// Both "performance not found" and "edit:performance required" surface as 42501
// from the RPC — indistinguishable by design.
const SHARE_CODES = {
  '42501': { status: 403, error: 'forbidden_or_not_found' },
  '22023': { status: 400, error: 'invalid_input' },
};

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  try {
    const id = await resolvePerformanceId(env, jwt, params.key, url.searchParams.get('ws'));
    if (!id) return json({ error: 'not_found' }, 404);

    const [{ data }, team] = await Promise.all([
      pgPostRpc<ShareRow>(env, 'list_roadsheet_shares', jwt, { p_performance_id: id }),
      readTeam(env, jwt, id, locals.requestId),
    ]);
    return json({ items: data.filter(Boolean).map((s) => mapShare(s, team)), team });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/performances/[key]/roadsheet/shares', requestId: locals.requestId },
      { codes: SHARE_CODES },
    );
  }
};

export const POST: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) {
    return json({ error: 'invalid_body', hint: 'role ∈ venue | performer | tech_manager, or person_id.' }, 400);
  }

  try {
    const id = await resolvePerformanceId(env, jwt, params.key, url.searchParams.get('ws'));
    if (!id) return json({ error: 'not_found' }, 404);

    const body = parsed.output;
    const { data } =
      'person_id' in body
        ? await pgPostRpc<ShareRow>(env, 'create_roadsheet_share_for_person', jwt, {
            p_performance_id: id,
            p_person_id: body.person_id,
          })
        : await pgPostRpc<ShareRow>(env, 'create_roadsheet_share', jwt, {
            p_performance_id: id,
            p_role: body.role,
          });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ share: mapShare(data[0]) }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/performances/[key]/roadsheet/shares', requestId: locals.requestId },
      { codes: SHARE_CODES },
    );
  }
};
