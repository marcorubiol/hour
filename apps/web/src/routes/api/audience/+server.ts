/**
 * El público de los espacios en pantalla (ADR-173, fase 3; plan § 6.1).
 *
 * GET ?workspace_ids=a,b → AudienceListResponse: las listas que quien llama
 *     lee en esos espacios (la RLS: owner, admin o la faceta Público), con sus
 *     recuentos y qué puede hacer en cada espacio (las invitaciones van en la
 *     lista de Envíos, `GET /api/mailout?list=1`, ADR-176).
 * POST { workspace_id, name, languages?, default_language? } → la lista nueva
 *     en borrador (`create_audience`).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { MAILOUT_PG_CODES, readBody } from '$lib/server/mailout/route';
import { audienceAccess } from '$lib/server/audience';
import {
  AUDIENCE_SELECT,
  AudienceCreateSchema,
  type AudienceCounts,
  type AudienceItem,
  type AudienceListResponse,
  type SubscriptionStatus,
} from '$lib/audience';

const STATUSES: SubscriptionStatus[] = ['confirmed', 'pending', 'unsubscribed'];

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const ids = (url.searchParams.get('workspace_ids') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => UUID_RE.test(x));
  if (ids.length === 0) return jsonNoStore({ items: [], access: {} } satisfies AudienceListResponse);
  try {
    const access = await audienceAccess(env, jwt, ids);
    const readable = ids.filter((w) => access[w]?.read);
    if (readable.length === 0) return jsonNoStore({ items: [], access } satisfies AudienceListResponse);
    const inWs = `in.(${readable.join(',')})`;
    const lists = await pgGet<AudienceItem>(env, 'audience', jwt, {
      search: { select: AUDIENCE_SELECT, workspace_id: inWs, status: 'neq.archived', order: 'created_at.asc' },
    });
    // Un recuento por lista y estado, con `select=id`. No embebido
    // (`audience_subscription(count)`): la tabla solo da SELECT por columnas y
    // PostgREST cuenta el embebido con `*`, que da 403.
    const counts = await Promise.all(
      lists.data.map((a) =>
        Promise.all(
          STATUSES.map((status) =>
            pgGet(env, 'audience_subscription', jwt, {
              search: { select: 'id', audience_id: `eq.${a.id}`, status: `eq.${status}`, limit: '1' },
              exactCount: true,
            }).then((r) => [status, r.total ?? 0] as const),
          ),
        ),
      ),
    );
    return jsonNoStore({
      items: lists.data.map((a, i) => ({ ...a, counts: Object.fromEntries(counts[i]) as AudienceCounts })),
      access,
    } satisfies AudienceListResponse);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/audience', requestId: locals.requestId });
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const body = await readBody(request, AudienceCreateSchema);
  if (body instanceof Response) return body;
  try {
    const created = await pgPostRpc<AudienceItem>(env, 'create_audience', jwt, {
      p_workspace_id: body.workspace_id,
      p_name: body.name,
      p_languages: body.languages,
      p_default_language: body.default_language ?? body.languages[0],
    });
    const a = created.data[0];
    if (!a) return jsonNoStore({ error: 'not_found' }, 404);
    const ws = await pgGet<{ slug: string }>(env, 'workspace', jwt, { search: { select: 'slug', id: `eq.${a.workspace_id}` } });
    return jsonNoStore({ id: a.id, workspace_slug: ws.data[0]?.slug ?? null }, 201);
  } catch (err) {
    return pgErrorResponse(err, { route: 'POST /api/audience', requestId: locals.requestId }, { codes: MAILOUT_PG_CODES });
  }
};
