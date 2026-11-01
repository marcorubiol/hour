/**
 * DELETE /api/performances/:key/roadsheet/shares/:id — revoke a public
 * road sheet link (ADR-047). Revocation is a soft kill (revoked_at): the
 * public RPC stops resolving the token immediately. The RPC re-checks
 * `edit:performance` against the share's own performance, so `:key` is URL
 * shape only.
 *
 * PATCH → { last_day: 'YYYY-MM-DD' } — «Cambiar la fecha» (ADR-160 § 2): the
 * link opens until that day ends, in the workspace's zone, through
 * `set_roadsheet_share_expiry` (same gate as revoking). A day before today
 * is 400.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import type { RoadsheetShare } from '$lib/roadsheet';

const IdSchema = v.pipe(v.string(), v.uuid());

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'revoke_roadsheet_share', jwt, { p_share_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/performances/[key]/roadsheet/shares/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
      },
    );
  }
};

const PatchSchema = v.object({
  last_day: v.pipe(v.string(), v.isoDate()),
});

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  const parsed = v.safeParse(PatchSchema, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body', hint: 'last_day: YYYY-MM-DD.' }, 400);

  try {
    const { data } = await pgPostRpc<RoadsheetShare>(env, 'set_roadsheet_share_expiry', jwt, {
      p_share_id: idParsed.output,
      p_last_day: parsed.output.last_day,
    });
    const s = data[0];
    if (!s) return json({ error: 'not_found' }, 404);
    return json({
      share: { id: s.id, token: s.token, role: s.role, created_at: s.created_at, expires_at: s.expires_at },
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/performances/[key]/roadsheet/shares/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden_or_not_found' },
          '22023': { status: 400, error: 'invalid_input', hint: 'The last day is today or later.' },
        },
      },
    );
  }
};
