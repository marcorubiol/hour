/**
 * GET /api/audience/also?workspace_id=&person_id= → { items: AudienceAlso[] }
 * (tarea 103; ADR-173 § 7): en la ficha de un contacto, las listas del público
 * del espacio en las que está su correo. Va por la persona, no por la
 * dirección, para no llevar un correo en la URL; la dirección la lee el
 * Worker del dossier con el JWT. Sin dossier, sin correo o sin leer el
 * público: lista vacía.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { alsoSubscribedTo } from '$lib/server/audience';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const ws = url.searchParams.get('workspace_id') ?? '';
  const person = url.searchParams.get('person_id') ?? '';
  if (!UUID_RE.test(ws) || !UUID_RE.test(person)) return jsonNoStore({ error: 'invalid_id' }, 400);
  try {
    const wp = await pgGet<{ email: string | null }>(env, 'workspace_person', jwt, {
      search: { select: 'email', workspace_id: `eq.${ws}`, person_id: `eq.${person}`, deleted_at: 'is.null' },
    });
    const email = wp.data[0]?.email;
    return jsonNoStore({ items: email ? await alsoSubscribedTo(env, jwt, ws, email) : [] });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/audience/also', requestId: locals.requestId });
  }
};
