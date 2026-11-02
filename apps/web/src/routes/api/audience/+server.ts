/**
 * El público de los espacios en pantalla (ADR-173, fase 3; plan § 6.1).
 *
 * GET ?workspace_ids=a,b → AudienceListResponse: las listas que quien llama
 *     lee en esos espacios (la RLS: owner, admin o la faceta Público), con sus
 *     recuentos, las últimas invitaciones y qué puede hacer en cada espacio.
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
  type AudienceItem,
  type AudienceListResponse,
  type SubscriptionStatus,
  type InvitationSummary,
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
  if (ids.length === 0) return jsonNoStore({ items: [], invitations: [], access: {} } satisfies AudienceListResponse);
  try {
    const access = await audienceAccess(env, jwt, ids);
    const readable = ids.filter((w) => access[w]?.read);
    if (readable.length === 0) return jsonNoStore({ items: [], invitations: [], access } satisfies AudienceListResponse);
    const inWs = `in.(${readable.join(',')})`;
    // Los recuentos, en la misma lectura: un `count` embebido por estado,
    // con la RLS de la suscripción (sin traer filas ni pedir uno por lista).
    type Counted = AudienceItem & Record<SubscriptionStatus, { count: number }[] | null>;
    const [lists, invitations] = await Promise.all([
      pgGet<Counted>(env, 'audience', jwt, {
        search: {
          select: `${AUDIENCE_SELECT},${STATUSES.map((s) => `${s}:audience_subscription(count)`).join(',')}`,
          ...Object.fromEntries(STATUSES.map((s) => [`${s}.status`, `eq.${s}`])),
          workspace_id: inWs,
          status: 'neq.archived',
          order: 'created_at.asc',
        },
      }),
      pgGet<InvitationSummary>(env, 'mailout', jwt, {
        search: {
          select: 'id,workspace_id,audience_id,subject,status,queued_at,created_at',
          workspace_id: inWs,
          kind: 'eq.invitation',
          status: 'neq.cancelled',
          order: 'created_at.desc',
          limit: '10',
        },
      }),
    ]);
    return jsonNoStore({
      items: lists.data.map(({ confirmed, pending, unsubscribed, ...a }) => ({
        ...a,
        counts: {
          confirmed: confirmed?.[0]?.count ?? 0,
          pending: pending?.[0]?.count ?? 0,
          unsubscribed: unsubscribed?.[0]?.count ?? 0,
        },
      })),
      invitations: invitations.data,
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
