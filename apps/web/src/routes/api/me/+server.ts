/**
 * GET /api/me — which PERSON am I?
 *
 * `/api/auth/session` already answers "which login am I" (`sub`, email,
 * display name) off the JWT, with no database read. This answers the other
 * half, and it is a different question: a login is an operator, a `person`
 * is somebody who appears in a cast, on a crew, in an absence and on a road
 * sheet. The bridge between them is `user_profile.person_id`, and nothing
 * client-facing has ever read it — so the app has never been able to say
 * "this is you" about a row on the calendar.
 *
 * That is the whole reason this endpoint exists: pinning YOURSELF on the
 * person axis needs one id that the app did not have.
 *
 * `person_id: null` is a NORMAL answer, not an error. Most logins are not
 * linked to a person yet (the link is written by hand today), so a caller
 * must treat null as "the person axis is not available for me" and hide the
 * affordance — never as a failure, and never by guessing an identity from
 * the display name.
 *
 * Why the filter is explicit: `user_profile_select` deliberately admits a
 * co-member's row as well as your own (the workspace roster needs it), so an
 * unfiltered select would return several rows and the first one might not be
 * yours. RLS is the wall; the filter is the question.
 *
 * It also answers WHERE you exist as a person: one entry per workspace that
 * holds your dossier. That is what makes you castable there (roster rows
 * reference the dossier through a composite FK), so a surface offering to pin
 * you — or to put you in a cast — needs this list, not just the id. Written
 * by `POST /api/me/profile-share`.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { decodeJwtPayload } from '$lib/server/session';
import { pgGet, pgPatch, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

type ProfileRow = { person_id: string | null; full_name: string };
type DossierRow = {
  workspace_id: string;
  slug: string;
  full_name: string;
  profile_sync_enabled: boolean;
  profile_shared_fields: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * The name a person is known by. It is the ONLY field this endpoint writes,
 * and the reason is the chain it sits at the head of: `user_profile.full_name`
 * is what `share_my_profile_with_workspace` copies into your dossier, and the
 * dossier's name is what every cast list, roster and person row shows. Until
 * now nothing could write it, so a login provisioned from an email address was
 * stuck being called `marcorubiol` in every company it worked with.
 *
 * Everything else on the profile stays out on purpose: the identity link
 * (`person_id`) is not the caller's to set — that is what makes the whole
 * consent model work — and the remaining fields have no surface yet, so
 * accepting them here would be inventing a contract nothing renders.
 */
const PatchBody = v.object({
  full_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
});

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const claims = decodeJwtPayload(jwt);
  const sub = typeof claims?.sub === 'string' ? claims.sub : null;
  if (!sub) return json({ error: 'invalid_token' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PatchBody, raw);
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

  // Filtered by user_id as well as gated by RLS: the update policy already
  // scopes to your own row, but an unfiltered PATCH is a full-table write
  // waiting for the day somebody widens that policy.
  const search = new URLSearchParams();
  search.set('user_id', `eq.${sub}`);

  try {
    const { data } = await pgPatch<{ full_name: string }>(
      env,
      'user_profile',
      jwt,
      { full_name: parsed.output.full_name },
      { search },
    );
    return json({ full_name: data[0]?.full_name ?? parsed.output.full_name });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/me', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const claims = decodeJwtPayload(jwt);
  const sub = typeof claims?.sub === 'string' ? claims.sub : null;
  if (!sub) return json({ error: 'invalid_token' }, 401);

  const search = new URLSearchParams();
  search.set('select', 'person_id,full_name');
  search.set('user_id', `eq.${sub}`);
  search.set('limit', '1');

  try {
    const { data } = await pgGet<ProfileRow>(env, 'user_profile', jwt, { search });
    const personId = data[0]?.person_id ?? null;
    const fullName = data[0]?.full_name ?? '';
    // No person, no dossiers to look for — and no second round trip.
    if (!personId) return json({ person_id: null, full_name: fullName, dossiers: [] });

    const dossierSearch = new URLSearchParams();
    dossierSearch.set(
      'select',
      'workspace_id,slug,full_name,profile_sync_enabled,profile_shared_fields',
    );
    dossierSearch.set('person_id', `eq.${personId}`);
    dossierSearch.set('deleted_at', 'is.null');
    const dossiers = await pgGet<DossierRow>(env, 'workspace_person', jwt, {
      search: dossierSearch,
    });
    return json({ person_id: personId, full_name: fullName, dossiers: dossiers.data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/me', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
