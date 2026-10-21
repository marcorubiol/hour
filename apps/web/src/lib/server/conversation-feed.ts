/**
 * La lectura común de Conversaciones (ADR-138, fase 3 de etiquetas):
 * conversaciones e hilos en una lista (`conversation_feed`), con el turno
 * derivado por el módulo del panel (`feedView`) y el nombre de quien escribió
 * el último mensaje de cada hilo.
 */

import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { feedView, type ConversationFeedResponse, type ConversationFeedView } from '$lib/conversation-feed';
import { authorNames } from '$lib/server/threads';

export interface ConversationFeedQuery {
  projectIds: string[];
  workspaceIds: string[];
  /** null = Todas; `team` = los hilos; una clave = esa etiqueta. */
  tag: string | null;
  q: string | null;
  limit: number;
}

export async function loadConversationFeed(
  env: SupabaseEnv,
  jwt: string,
  me: string,
  query: ConversationFeedQuery,
  now: Date,
): Promise<ConversationFeedView> {
  const { data } = await pgPostRpc<ConversationFeedResponse>(env, 'conversation_feed', jwt, {
    p_project_ids: query.projectIds.length > 0 ? query.projectIds : null,
    p_workspace_ids: query.workspaceIds.length > 0 ? query.workspaceIds : null,
    p_tag: query.tag,
    p_q: query.q,
    p_limit: query.limit,
  });
  const res = data[0] ?? { items: [], more: false };
  const authorIds = res.items.flatMap((r) => (r.kind === 'thread' ? [r.last_message.author_id] : []));
  return { me, items: feedView(res.items, now), more: res.more, authors: await authorNames(env, jwt, authorIds) };
}
