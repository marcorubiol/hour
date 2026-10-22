/**
 * GET /api/person-merges/resolve?ids=uuid,uuid — a qué persona apunta hoy
 * cada id fusionado (`resolve_merged_persons`, plan 2026-10-22 § 6.2). Lo
 * pide el marco de `/h` para reescribir los pins `pe:<id>` que viven en el
 * navegador. Solo dice lo que quien llama ya ve: la ficha que se quedó.
 *
 * Responde `{ into: { [dropId]: keepId } }`. Sin la migración de la fase 3,
 * `{ into: {} }`: los pins se quedan como estaban.
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { isMissingFunction } from '$lib/server/person-merge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const ids = [
    ...new Set(
      (url.searchParams.get('ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => UUID.test(s)),
    ),
  ].slice(0, 50);
  if (ids.length === 0) return jsonNoStore({ into: {} });

  try {
    const { data } = await pgPostRpc<{ person_id: string; merged_into: string }>(
      env,
      'resolve_merged_persons',
      jwt,
      { p_person_ids: ids },
    );
    return jsonNoStore({ into: Object.fromEntries(data.map((r) => [r.person_id, r.merged_into])) });
  } catch (err) {
    if (isMissingFunction(err)) return jsonNoStore({ into: {} });
    return pgErrorResponse(err, { route: 'GET /api/person-merges/resolve', requestId: locals.requestId });
  }
};
