/**
 * Calendar feed links (ADR-054). A share pins a WORKSPACE; the token
 * opens `/api/public/calendar/:token` with no account. Management is
 * RPC-only — `calendar_share` is deny-all even for authenticated, so the
 * token never travels through PostgREST table reads; all RPCs gate on
 * accepted workspace membership.
 *
 * GET  ?workspace_id= → active feed links for the workspace, each with its scope.
 * POST { workspace_id, scope? } → 201 with the new share. `scope` is `all`
 *   (the default) or `mine` (90): only the caller's own, which needs the
 *   caller to be a person (`user_profile.person_id`), else 400 `not_a_person`.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { CalendarShareCreateSchema, toCalendarShare } from '$lib/calendar-share';

type ShareRow = Parameters<typeof toCalendarShare>[0];

// "workspace not found" and "not a member" both surface as 42501 —
// indistinguishable by design.
const SHARE_CODES = {
  '42501': { status: 403, error: 'forbidden_or_not_found' },
  '22023': { status: 400, error: 'invalid_input' },
};

// On create, the scope is already valid (Valibot): a 22023 there is «mine»
// asked by a login that is not a person yet.
const CREATE_CODES = {
  ...SHARE_CODES,
  '22023': { status: 400, error: 'not_a_person' },
};

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const wsId = url.searchParams.get('workspace_id') ?? '';
  const parsed = v.safeParse(v.pipe(v.string(), v.uuid()), wsId);
  if (!parsed.success) return json({ error: 'invalid_workspace_id' }, 400);

  try {
    const { data } = await pgPostRpc<ShareRow>(env, 'list_calendar_shares', jwt, {
      p_workspace_id: wsId,
    });
    return json({ items: data.filter(Boolean).map(toCalendarShare) });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/calendar-shares', requestId: locals.requestId },
      { codes: SHARE_CODES },
    );
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
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
  const parsed = v.safeParse(CalendarShareCreateSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<ShareRow>(env, 'create_calendar_share', jwt, {
      p_workspace_id: parsed.output.workspace_id,
      p_scope: parsed.output.scope,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ share: toCalendarShare(data[0]) }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/calendar-shares', requestId: locals.requestId },
      { codes: CREATE_CODES },
    );
  }
};
