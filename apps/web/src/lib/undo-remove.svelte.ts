/**
 * Borrar lo que se puede deshacer (tarea 134): se va al momento, el aviso
 * dice qué se fue con «Deshacer», y el borrado de verdad espera a que acabe
 * el aviso. Así se deshace sin que la API tenga que restaurar nada: lo que
 * no se ha escrito no hay que devolverlo (el mismo trato que las tareas de
 * Hoy y la llamada apuntada, `call-log-pending`). Lo que no se puede deshacer,
 * o llega a otras personas, no pasa por aquí: pide `ConfirmDialog`.
 *
 * Cada pantalla crea el suyo al montarse (`undoableRemovals()`), esconde lo
 * que `hidden` tenga y llama a `remove()`. Al salir de la pantalla o cerrar
 * la pestaña se escribe lo pendiente.
 */

import { addToast, removeToast } from '$lib/components/Toast.svelte';
import { CREATED_TOAST_MS } from '$lib/created';
import { t, type Locale } from '$lib/i18n';

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  toast: number;
  commit: () => Promise<unknown>;
}

export interface UndoableRemovals {
  /** Lo que se ha quitado y aún espera: la pantalla no lo pinta. */
  readonly hidden: ReadonlySet<string>;
  /** Quita `id` ya; `commit` lo borra de verdad al acabar el aviso. */
  remove(id: string, opts: { message: string; commit: () => Promise<unknown> }): void;
  /** «Deshacer» del aviso: no se escribe y vuelve a la vista. */
  undo(id: string): void;
  /** Escribe ya todo lo pendiente (al salir). */
  flush(): void;
}

export function undoableRemovals(opts: { locale: Locale; ms?: number; onsettled?: () => void }): UndoableRemovals {
  const { locale, ms = CREATED_TOAST_MS, onsettled } = opts;
  let hidden = $state(new Set<string>());
  const pending = new Map<string, Pending>();

  function show(id: string) {
    if (!hidden.has(id)) return;
    const next = new Set(hidden);
    next.delete(id);
    hidden = next;
  }

  function take(id: string): Pending | null {
    const p = pending.get(id) ?? null;
    if (!p) return null;
    pending.delete(id);
    clearTimeout(p.timer);
    return p;
  }

  async function commit(id: string) {
    const p = take(id);
    if (!p) return;
    removeToast(p.toast);
    try {
      await p.commit();
    } catch (err) {
      show(id);
      addToast({
        tone: 'danger',
        title: t('ui.not_removed', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    } finally {
      // Borrado, sigue escondido: la lectura que llega ya no lo trae.
      onsettled?.();
    }
  }

  function undo(id: string) {
    if (!take(id)) return;
    show(id);
    addToast({ tone: 'info', message: t('ui.undone', locale) });
  }

  function remove(id: string, o: { message: string; commit: () => Promise<unknown> }) {
    if (pending.has(id)) return;
    hidden = new Set(hidden).add(id);
    const toast = addToast({
      tone: 'success',
      message: o.message,
      duration: ms,
      action: { label: t('ui.undo', locale), run: () => undo(id) },
    });
    pending.set(id, { timer: setTimeout(() => void commit(id), ms), toast, commit: o.commit });
  }

  function flush() {
    for (const id of [...pending.keys()]) void commit(id);
  }

  $effect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  });

  return {
    get hidden() {
      return hidden;
    },
    remove,
    undo,
    flush,
  };
}
