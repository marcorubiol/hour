/**
 * POST/DELETE /api/me/profile-share — the door to a mechanism that was
 * already built, already applied to production, already in `db-types.ts`, and
 * had no caller anywhere in the app.
 *
 * `share_my_profile_with_workspace` is what turns a LOGIN into a PERSON:
 *
 *   1. it claims an existing local dossier that carries your verified auth
 *      email (preferring the workspace you are sharing with), so joining a
 *      company that already had you as a contact does not fork your identity;
 *   2. failing that it creates the portable `person` row;
 *   3. it writes `user_profile.person_id` — the link nothing else writes;
 *   4. it upserts your `workspace_person` dossier with the fields you chose.
 *
 * Step 4 is not a nicety: `cast_member` and `crew_assignment` reference the
 * dossier through a composite FK on (workspace_id, person_id), so **without a
 * dossier in that workspace you cannot be cast in it at all**. That is why
 * this endpoint is the prerequisite for the person axis — being pinnable,
 * appearing in a roster, having an absence — and not a settings nicety.
 *
 * WHY THIS IS NOT AUTOMATIC on accepting an invitation, even though that
 * would fix the empty column in one go: the identity pass decided share and
 * revoke are EXPLICIT acts. Sharing writes your name (and whatever else you
 * pick) into somebody else's workspace. Doing that silently because you
 * accepted an invitation is exactly the kind of consent-by-default the model
 * refuses. So the fix is a door, not a trigger.
 *
 * The DEFAULT here is deliberately narrower than the function's own: the RPC
 * defaults to nine fields (phone, city, website…), this endpoint defaults to
 * `full_name` alone — the minimum that makes you castable. Widening is a
 * choice the caller makes field by field; it should never be the thing that
 * happens when you do not choose.
 *
 * DELETE stops future syncing and empties the shared-field list. It does NOT
 * delete the dossier or the values already copied into it: revoking is not
 * erasing (a cast row that points at you keeps working, and the company keeps
 * the record it already had).
 *
 * Auth: Bearer JWT required. The RPCs are SECURITY DEFINER and gate
 * themselves on `auth.uid()` plus an accepted workspace membership, so this
 * endpoint adds shape validation and nothing else.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const UUID = v.pipe(v.string(), v.uuid());

/**
 * The function's own allowlist, mirrored so a typo fails at the edge with a
 * readable message instead of as a Postgres exception. `full_name` is
 * mandatory there too — a dossier with no name is not a person anybody can
 * pick from a list.
 */
const SHAREABLE = [
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'website',
  'city',
  'country',
  'languages',
  'professional_title',
] as const;

const ShareBody = v.object({
  workspace_id: UUID,
  fields: v.optional(
    v.pipe(
      v.array(v.picklist(SHAREABLE)),
      v.minLength(1),
      v.check((f) => f.includes('full_name'), 'fields must include full_name'),
    ),
  ),
});
const StopBody = v.object({ workspace_id: UUID });

type DossierRow = {
  workspace_id: string;
  person_id: string;
  slug: string;
  full_name: string;
  profile_shared_fields: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const raw = await readBody(request);
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  const parsed = v.safeParse(ShareBody, raw);
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

  try {
    const { data } = await pgPostRpc<DossierRow>(env, 'share_my_profile_with_workspace', jwt, {
      p_workspace_id: parsed.output.workspace_id,
      // Name only unless the caller asked for more — see the header.
      p_fields: parsed.output.fields ?? ['full_name'],
    });
    return json({ dossier: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/me/profile-share', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const raw = await readBody(request);
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  const parsed = v.safeParse(StopBody, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    await pgPostRpc(env, 'stop_sharing_my_profile_with_workspace', jwt, {
      p_workspace_id: parsed.output.workspace_id,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/me/profile-share', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
