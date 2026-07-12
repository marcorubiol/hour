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
import { extractBearer } from '$lib/auth';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const DELETE: RequestHandler = async ({ request, params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.assetId);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_asset_version', jwt, { p_asset_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof PostgrestError) {
      // 42501 collapses not-found and no-permission → 404 (no oracle).
      if (err.code === '42501') return json({ error: 'not_found' }, 404);
      const upstream = err.status === 401 ? 401 : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
