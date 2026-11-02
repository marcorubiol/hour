/**
 * POST /api/mailout/invitation { workspace_id, audience_id?, conversation_ids?,
 * project_id?, performance_id? } → { id, workspace_slug }: una invitación en
 * borrador (ADR-173 § 10, `create_invitation`). Nace desde la vista Público
 * (con lista), desde la selección de Conversaciones («Invitar a N», con
 * profesionales de cualquier proyecto) o desde una función (con proyecto y
 * función, sin destinatarios). Todo con el JWT de quien la escribe.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { MAILOUT_PG_CODES, pgMessage, readBody } from '$lib/server/mailout/route';
import { InvitationCreateSchema } from '$lib/audience';
import type { MailoutItem } from '$lib/mailout';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const body = await readBody(request, InvitationCreateSchema);
  if (body instanceof Response) return body;
  try {
    const created = await pgPostRpc<MailoutItem>(env, 'create_invitation', jwt, {
      p_workspace_id: body.workspace_id,
      p_audience_id: body.audience_id ?? null,
      p_conversation_ids: body.conversation_ids.length ? body.conversation_ids : null,
      p_project_id: body.project_id ?? null,
      p_performance_id: body.performance_id ?? null,
    });
    const m = created.data[0];
    if (!m) return jsonNoStore({ error: 'not_found' }, 404);
    const ws = await pgGet<{ slug: string }>(env, 'workspace', jwt, { search: { select: 'slug', id: `eq.${m.workspace_id}` } });
    return jsonNoStore({ id: m.id, workspace_slug: ws.data[0]?.slug ?? null }, 201);
  } catch (err) {
    if (/no audience sending domain/.test(pgMessage(err))) return jsonNoStore({ error: 'no_audience_domain' }, 409);
    return pgErrorResponse(err, { route: 'POST /api/mailout/invitation', requestId: locals.requestId }, { codes: MAILOUT_PG_CODES });
  }
};
