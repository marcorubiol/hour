/**
 * Las lecturas de la lista de Conversaciones (plan `build/plans/2026-10-22-
 * conversations-list.md`):
 *
 *   · la página sale de `conversation_feed` en modo lista (fase 3, migración
 *     20261022200000): alcance, etiqueta del chip, búsqueda, filtros (relación,
 *     línea, temporada, turno, temperatura, envío), orden (§ 4; los filtros de
 *     bloque en el de su bloque), total y ventana, en una llamada. Las reglas
 *     son las de `$lib/conversation-overview` escritas en SQL; el test RLS
 *     `conversation-feed-list.test.ts` compara cada filtro con la lectura del
 *     panel (`loadOverviewRows`), que queda solo para el panel;
 *   · lo que la fila enseña además (§ 3 y § 8): sus bolos sin dinero
 *     (`conversations_bolos`, solo con `read:performance`) y el último envío que
 *     recibió, una lectura por página, no por fila.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import type { FeedConversation } from '$lib/conversation-feed';
import type { ConversationBolo } from '$lib/conversation-relation';
import type { ListFilter, RowMailout } from '$lib/conversation-overview';
import type { Orden } from '$lib/conversation-order';
import { loadConversationBolos } from '$lib/server/conversation-overview';

export interface ListPageQuery {
  projectIds: string[];
  workspaceIds: string[];
  /** La clave del chip; sin ella, todas las conversaciones (sin hilos). */
  tag: string | null;
  q: string | null;
  filter: ListFilter;
  /** Las líneas fijadas en la barra: con `filter.temporada`, solo esas. */
  lineIds: string[];
  orden: Orden;
  limit: number;
  offset: number;
  /** «Seleccionar las N que coinciden»: solo ids, hasta `MATCHING_MAX`. */
  idsOnly?: boolean;
}

/** Lo que la RPC devuelve en modo lista; con `idsOnly`, cada fila es solo `id` y `project_id`. */
export interface ListPage {
  total: number;
  more: boolean;
  items: (Pick<FeedConversation, 'id' | 'project_id'> & Partial<FeedConversation>)[];
}

/** Los parámetros de `conversation_feed` en modo lista; lo que no se pide no viaja. */
export function listPageArgs(query: ListPageQuery): Record<string, unknown> {
  const f = query.filter;
  const args: Record<string, unknown> = {
    p_project_ids: query.projectIds.length > 0 ? query.projectIds : null,
    p_workspace_ids: query.workspaceIds.length > 0 ? query.workspaceIds : null,
    p_tag: query.tag,
    p_q: query.q,
    p_list: true,
    p_order: query.orden,
    p_limit: query.limit,
    p_offset: query.offset,
    p_relation: f.relacion ?? null,
    p_line: f.linea ?? null,
    p_season: Boolean(f.temporada),
    p_season_line_ids: f.temporada && query.lineIds.length > 0 ? query.lineIds : null,
    p_turn: f.turno ?? null,
    p_temp: f.temp ?? null,
    p_mailout_id: f.envio ?? null,
    p_mailout_pick: f.envio ? (f.r ?? 'todos') : null,
    p_ids_only: Boolean(query.idsOnly),
  };
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== false));
}

/** Una página de la lista (o sus ids) en una llamada. */
export async function loadListPage(env: SupabaseEnv, jwt: string, query: ListPageQuery): Promise<ListPage> {
  const { data } = await pgPostRpc<ListPage>(env, 'conversation_feed', jwt, listPageArgs(query));
  return data[0] ?? { total: 0, more: false, items: [] };
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
