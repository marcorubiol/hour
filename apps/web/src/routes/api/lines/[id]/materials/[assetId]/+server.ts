/**
 * DELETE /api/lines/:id/materials/:assetId — soft-delete a registered
 * material via the `delete_asset_version` RPC (house rule since ADR-048:
 * soft-deletes never ride a client PATCH; the hard DELETE policy exists
 * but soft keeps the audit trail).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.assetId);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);
  const lineParsed = v.safeParse(IdSchema, params.id);
  if (!lineParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    // The URL claims this asset belongs to :id — hold it to that (review
    // 2026-07-12): without the check any asset the caller can edit is
    // deletable through any line's URL. RLS scopes the lookup.
    const check = new URLSearchParams();
    check.set('select', 'id');
    check.set('id', `eq.${idParsed.output}`);
    check.set('line_id', `eq.${lineParsed.output}`);
    check.set('deleted_at', 'is.null');
    check.set('limit', '1');
    const found = await pgGet<{ id: string }>(env, 'asset_version', jwt, { search: check });
    if (found.data.length === 0) return json({ error: 'not_found' }, 404);

    await pgPostRpc(env, 'delete_asset_version', jwt, { p_asset_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/lines/[id]/materials/[assetId]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
        },
      },
    );
  }
};
