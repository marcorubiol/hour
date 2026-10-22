/**
 * Las lecturas de la lista de Conversaciones (plan `build/plans/2026-10-22-
 * conversations-list.md`, fase 1, sin migración):
 *
 *   · el orden y los no leídos salen de `conversation_feed`, la misma RPC que
 *     «Todas» (una regla para toda la lente, § 4), con la etiqueta del chip y la
 *     búsqueda. La RPC da como mucho 500 filas: si hay más, quien llama lee el
 *     alcance entero con `loadOverviewRows` y ordena con las mismas claves;
 *   · lo que la fila enseña además (§ 3 y § 8): sus bolos sin dinero
 *     (`conversations_bolos`, solo con `read:performance`) y el último envío que
 *     recibió, una lectura por página, no por fila.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { conversationView, type ConversationFeedResponse, type FeedConversationView } from '$lib/conversation-feed';
import type { ConversationBolo } from '$lib/conversation-relation';
import type { RowMailout } from '$lib/conversation-overview';
import { loadConversationBolos } from '$lib/server/conversation-overview';

/** Lo que la RPC devuelve por llamada. */
export const FEED_MAX = 500;

export interface FeedOrderQuery {
  projectIds: string[];
  workspaceIds: string[];
  /** La clave del chip; sin ella, todas (los hilos se descartan). */
  tag: string | null;
  q: string | null;
}

/** Las conversaciones del alcance en el orden de la RPC, con su turno y sus no leídos. */
export async function loadFeedConversations(
  env: SupabaseEnv,
  jwt: string,
  query: FeedOrderQuery,
  now: Date,
): Promise<{ rows: FeedConversationView[]; more: boolean }> {
  const { data } = await pgPostRpc<ConversationFeedResponse>(env, 'conversation_feed', jwt, {
    p_project_ids: query.projectIds.length > 0 ? query.projectIds : null,
    p_workspace_ids: query.workspaceIds.length > 0 ? query.workspaceIds : null,
    p_tag: query.tag,
    p_q: query.q,
    p_limit: FEED_MAX,
  });
  const res = data[0] ?? { items: [], more: false };
  return {
    rows: res.items.flatMap((r) => (r.kind === 'conversation' ? [conversationView(r, now)] : [])),
    more: res.more,
  };
}

/** Los estados de una destinataria a la que el envío le salió. */
const LEFT = 'in.(sent,delivered,bounced,complained)';

/**
 * El último envío que recibió cada conversación de la página: salido (o
 * saliendo) y con la destinataria fuera. Lo lee quien lee el envío
 * (`mailout_select`), con la regla de su política.
 */
export async function loadRowMailouts(env: SupabaseEnv, jwt: string, ids: readonly string[]): Promise<Map<string, RowMailout>> {
  const out = new Map<string, RowMailout>();
  if (ids.length === 0) return out;
  const { data } = await pgGet<{
    conversation_id: string;
    mailout_id: string;
    status: string;
    sent_at: string | null;
    mailout: { queued_at: string | null } | null;
  }>(env, 'mailout_recipient', jwt, {
    search: {
      select: 'conversation_id,mailout_id,status,sent_at,mailout:mailout!inner(queued_at)',
      conversation_id: `in.(${ids.join(',')})`,
      status: LEFT,
      'mailout.status': 'in.(queued,sending,paused,done)',
      order: 'sent_at.desc.nullslast,created_at.desc',
      limit: '1000',
    },
  });
  for (const r of data) {
    if (out.has(r.conversation_id)) continue;
    out.set(r.conversation_id, { mailout_id: r.mailout_id, at: r.sent_at ?? r.mailout?.queued_at ?? null, status: r.status });
  }
  return out;
}

/**
 * Lo que la fila enseña además de la conversación. Un fallo de estas dos
 * lecturas no tumba la lista: la fila no dice nada de bolos (desconocido, no
 * «ninguno») ni de envío.
 */
export async function loadRowExtras(
  env: SupabaseEnv,
  jwt: string,
  ids: readonly string[],
): Promise<{ bolos: Map<string, ConversationBolo[]> | null; mailouts: Map<string, RowMailout> }> {
  const [bolos, mailouts] = await Promise.all([
    ids.length > 0 ? loadConversationBolos(env, jwt, ids).catch(() => null) : Promise.resolve(new Map<string, ConversationBolo[]>()),
    loadRowMailouts(env, jwt, ids).catch(() => new Map<string, RowMailout>()),
  ]);
  return { bolos, mailouts };
}
