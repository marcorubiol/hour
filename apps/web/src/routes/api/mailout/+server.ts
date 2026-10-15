/**
 * POST /api/mailout { project_id, conversation_ids } → { id, workspace_slug }:
 * «Escribir a N» desde Conversations (plan § 10). Crea el borrador con el
 * primer dominio verificado del espacio (si hay) y le pone los destinatarios;
 * todo con el JWT de quien escribe (`edit:conversation` en el proyecto). Las
 * conversaciones de otro proyecto, borradas o privadas ajenas: 404.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/mail/http';
import { MAILOUT_PG_CODES, readBody } from '$lib/server/mailout/route';
import { MailoutCreateSchema, type MailoutItem } from '$lib/mailout';
import type { MailoutEnv } from '$lib/server/mailout';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as MailoutEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const body = await readBody(request, MailoutCreateSchema);
  if (body instanceof Response) return body;
  try {
    const project = await pgGet<{ workspace_id: string; workspace: { slug: string } | null }>(env, 'project', jwt, {
      search: { select: 'workspace_id,workspace:workspace_id(slug)', id: `eq.${body.project_id}` },
    });
    const p = project.data[0];
    if (!p?.workspace) return json({ error: 'not_found' }, 404);
    const domains = await pgGet<{ id: string }>(env, 'mail_domain', jwt, {
      search: { select: 'id', workspace_id: `eq.${p.workspace_id}`, verified_at: 'not.is.null', order: 'created_at.asc', limit: '1' },
    });
    const created = await pgPostRpc<MailoutItem>(env, 'create_mailout', jwt, {
      p_project_id: body.project_id,
      p_mail_domain_id: domains.data[0]?.id ?? null,
    });
    const m = created.data[0];
    if (!m) return json({ error: 'not_found' }, 404);
    await pgPostRpc(env, 'set_mailout_recipients', jwt, { p_id: m.id, p_conversation_ids: body.conversation_ids });
    return json({ id: m.id, workspace_slug: p.workspace.slug }, 201);
  } catch (err) {
    return pgErrorResponse(err, { route: 'POST /api/mailout', requestId: locals.requestId }, { codes: MAILOUT_PG_CODES });
  }
};
