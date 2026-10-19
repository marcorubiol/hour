/**
 * GET /api/conversation-tags: el vocabulario de etiquetas de conversación
 * (ADR-138 § 1). Las estándar de Hour y las propias de tus espacios, con los
 * ajustes de cada espacio (renombrar, desactivar, ordenar). Son nombres, no
 * datos: la RLS se lo deja leer a cualquier miembro. Qué chips salen y en qué
 * orden lo decide `$lib/conversation-tags` (`scopeTags`, `workspaceTags`).
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/mail/http';
import type { TagRow, TagSettingRow, TagVocabulary } from '$lib/conversation-tags';

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  try {
    const [tags, settings] = await Promise.all([
      pgGet<TagRow>(env, 'conversation_tag', jwt, {
        search: { select: 'id,workspace_id,key,label,labels,sort', order: 'sort,key' },
      }),
      pgGet<TagSettingRow>(env, 'workspace_conversation_tag_setting', jwt, {
        search: { select: 'workspace_id,tag_id,label,labels,active,sort' },
      }),
    ]);
    const body: TagVocabulary = { tags: tags.data, settings: settings.data };
    return json(body);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversation-tags', requestId: locals.requestId });
  }
};
