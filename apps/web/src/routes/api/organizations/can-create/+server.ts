/**
 * GET /api/organizations/can-create — whether this database makes an
 * organization on its own yet (136): `create_workspace_organization` arrives
 * with migration 20261111130000, and until it is applied the screen offers
 * neither «Nueva organización» nor the person's organization field, instead
 * of a door that answers with an error.
 *
 * The probe writes nothing: it calls the RPC for the nil workspace, which the
 * function refuses (42501) before reading anything. PostgREST answers 404
 * (PGRST202) only when the function does not exist. Whether the CALLER may
 * make one is still the RPC's call, per space.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';

const NIL = '00000000-0000-0000-0000-000000000000';

export const GET: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    await pgPostRpc(env, 'create_workspace_organization', jwt, { p_workspace_id: NIL, p_name: '' });
    return jsonNoStore({ available: true });
  } catch (err) {
    const missing = err instanceof PostgrestError && (err.status === 404 || err.code === 'PGRST202');
    return jsonNoStore({ available: !missing && err instanceof PostgrestError });
  }
};
