/**
 * Las lecturas de los hilos (ADR-106) que comparten los endpoints: los
 * mensajes de unos hilos ya conocidos, con el nombre de sus autores y hasta
 * dónde había leído el que llama.
 *
 * UNA consulta por lectura, con los hilos nombrados. La política de `message`
 * hereda la frontera de `thread` con un subplan que evalúa la regla de lectura
 * una vez por hilo de TODA la tabla (EXPLAIN de la fase 1, ~0,3 ms por hilo):
 * pedir los mensajes hilo a hilo la pagaría tantas veces como hilos. Si esa
 * cuenta crece, el sitio para cambiarla es este fichero (una RPC de lectura
 * acotada), y nadie más lee `message` directamente.
 */

import { pgGet, type SupabaseEnv } from '$lib/supabase';
import {
  BOARD_MESSAGE_LIMIT,
  conversationThread,
  type ConversationThreadView,
  type ThreadMessage,
} from '$lib/threads';

const MESSAGE_SELECT = 'id,thread_id,author_id,performance_id,body,created_at,edited_at';

export interface ThreadMessages {
  messages: ThreadMessage[];
  authors: Record<string, string>;
  reads: Record<string, string>;
  truncated: boolean;
}

export async function loadThreadMessages(
  env: SupabaseEnv,
  jwt: string,
  threadIds: string[],
  limit = BOARD_MESSAGE_LIMIT,
): Promise<ThreadMessages> {
  if (threadIds.length === 0) return { messages: [], authors: {}, reads: {}, truncated: false };
  const ids = `in.(${threadIds.join(',')})`;

  const [msgs, reads] = await Promise.all([
    pgGet<ThreadMessage>(env, 'message', jwt, {
      search: {
        select: MESSAGE_SELECT,
        thread_id: ids,
        deleted_at: 'is.null',
        // Los más recientes: si hay que cortar, se corta lo viejo.
        order: 'created_at.desc,id.desc',
        limit: String(limit + 1),
      },
    }),
    pgGet<{ thread_id: string; last_read_at: string }>(env, 'thread_read', jwt, {
      search: { select: 'thread_id,last_read_at', thread_id: ids },
    }),
  ]);

  const truncated = msgs.data.length > limit;
  const messages = truncated ? msgs.data.slice(0, limit) : msgs.data;

  // El nombre sale del perfil, que se lee si compartes espacio con su dueño.
  // Quien ya no comparte (o borró su login) queda sin nombre, no sin mensaje.
  const authorIds = [...new Set(messages.map((m) => m.author_id).filter((id): id is string => Boolean(id)))];
  const authors: Record<string, string> = {};
  if (authorIds.length > 0) {
    const profiles = await pgGet<{ user_id: string; full_name: string | null }>(env, 'user_profile', jwt, {
      search: { select: 'user_id,full_name', user_id: `in.(${authorIds.join(',')})` },
    });
    for (const p of profiles.data) if (p.full_name) authors[p.user_id] = p.full_name;
  }

  return {
    messages,
    authors,
    reads: Object.fromEntries(reads.data.map((r) => [r.thread_id, r.last_read_at])),
    truncated,
  };
}

/**
 * El hilo del equipo de una conversación, con sus mensajes. `null` si quien
 * llama no lee la conversación (no existe, borrada, sin Converses o privada de
 * otro): un hilo de conversación se lee exactamente cuando se lee ella
 * (`private.can_read_conversation`), y aquí no se anuncia ni vacío.
 *
 * La conversación y el hilo, por la RLS del que llama y a la vez: si se ve la
 * conversación, se ve su hilo (la misma regla en las dos políticas).
 */
export async function loadConversationThread(
  env: SupabaseEnv,
  jwt: string,
  me: string,
  conversationId: string,
): Promise<ConversationThreadView | null> {
  const [conv, threads] = await Promise.all([
    pgGet<{ id: string }>(env, 'conversation', jwt, {
      search: { select: 'id', id: `eq.${conversationId}`, deleted_at: 'is.null' },
    }),
    pgGet<{ id: string; last_message_at: string | null }>(env, 'thread', jwt, {
      search: { select: 'id,last_message_at', conversation_id: `eq.${conversationId}` },
    }),
  ]);
  if (conv.data.length === 0) return null;

  const row = threads.data[0] ?? null;
  const loaded = await loadThreadMessages(env, jwt, row ? [row.id] : []);
  // Del más antiguo al más nuevo, como se lee.
  const messages = [...loaded.messages].reverse();
  return {
    me,
    thread: conversationThread(row, messages, me, row ? loaded.reads[row.id] : null),
    ...loaded,
    messages,
  };
}
