/**
 * Cómo se lee un hilo en pantalla (ADR-106, pregunta 6), igual en el tablón
 * del bolo y en el hilo del equipo de una conversación:
 *  - la raya de «nuevos» se queda donde estaba AL ABRIR (`readAtOpen`);
 *  - lo nuevo se marca leído cuando se ve (`markReadWhenSeen`).
 *
 * Se llaman al iniciar el componente: `markReadWhenSeen` monta sus efectos.
 */

import { mutateJSON } from '$lib/api';
import type { BoardThread } from '$lib/threads';

/**
 * Hasta dónde había leído cada hilo al abrir la pantalla. Se apunta la primera
 * vez que se ve el hilo y no cambia al marcarlo leído: si cambiase, la raya de
 * «nuevos» desaparecería a los 30 s, mientras se lee. Un Map sin estado a
 * propósito: es memoria de esta visita, no algo que repinte.
 */
export function readAtOpen(): (key: string, threadId: string | null, reads: Record<string, string>) => string | null {
  const openedAt = new Map<string, string | null>();
  return (key, threadId, reads) => {
    if (!openedAt.has(key)) openedAt.set(key, (threadId && reads[threadId]) || null);
    return openedAt.get(key) ?? null;
  };
}

type Readable = Pick<BoardThread, 'thread_id' | 'unread_count' | 'last_message_at'>;

/**
 * Marca leídos los hilos con nuevos cuando `target` está a la vista y la
 * pestaña visible. Una marca por novedad (hilo y último mensaje), no una por
 * recarga; al acabar, `onmarked` para que el dueño recargue sus recuentos.
 */
export function markReadWhenSeen(options: {
  target: () => HTMLElement | undefined;
  threads: () => readonly Readable[];
  onmarked: () => void;
}): void {
  let inView = $state(false);

  $effect(() => {
    const el = options.target();
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  });

  const marked = new Set<string>();

  $effect(() => {
    const threads = options.threads();
    if (!inView || document.visibilityState !== 'visible') return;
    const pending = threads.filter(
      (th) => th.thread_id && th.unread_count > 0 && !marked.has(`${th.thread_id}@${th.last_message_at}`),
    );
    if (pending.length === 0) return;
    for (const th of pending) marked.add(`${th.thread_id}@${th.last_message_at}`);
    void Promise.allSettled(pending.map((th) => mutateJSON('POST', `/api/threads/${th.thread_id}/read`))).then(
      options.onmarked,
    );
  });
}

/**
 * Abrir una conversación la deja leída (ADR-138, fase 3): sus entrantes dejan
 * de contar como no leídos en la lista (`mark_conversation_read`). Una marca
 * por visita y novedad (la conversación y su último evento), con la pestaña
 * visible; al acabar, `onmarked` para que la lista recargue. El hilo del
 * equipo se lee aparte, cuando se ve (`markReadWhenSeen`).
 */
export function markConversationReadOnOpen(options: {
  conversationId: () => string | null | undefined;
  /** Lo último que hay en su registro: cambia cuando entra algo mientras está abierta. */
  latest: () => string;
  onmarked: (conversationId: string) => void;
}): void {
  const marked = new Set<string>();
  let visible = $state(typeof document === 'undefined' ? false : document.visibilityState === 'visible');

  $effect(() => {
    const onChange = () => (visible = document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  });

  $effect(() => {
    const id = options.conversationId();
    const key = `${id}@${options.latest()}`;
    if (!id || !visible || marked.has(key)) return;
    marked.add(key);
    void mutateJSON('POST', `/api/conversations/${id}/read`).then(
      () => options.onmarked(id),
      () => marked.delete(key),
    );
  });
}

/**
 * Una ficha abierta desde «de qué se habla» lleva el nombre de su hilo en la
 * dirección (`#board`, `#team`, `feedHref`): cuando el hilo aparece, baja
 * hasta él, una vez por visita. El navegador no puede hacerlo solo porque el
 * hilo se pinta después de cargar. Al quedar a la vista, `markReadWhenSeen`
 * lo marca leído, que es lo que se vino a hacer.
 */
export function scrollWhenNamed(hash: string, target: () => HTMLElement | undefined): void {
  let done = false;
  $effect(() => {
    const el = target();
    if (done || !el || location.hash !== hash) return;
    done = true;
    el.scrollIntoView({ block: 'start' });
  });
}
