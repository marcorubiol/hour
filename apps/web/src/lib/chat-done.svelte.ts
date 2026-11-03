/**
 * «Ya está» (ADR-176 § 5, enmendado por ADR-177): lo que se resolvió por
 * teléfono o WhatsApp sale de «Nos toca» de un toque. Es el «No pide
 * respuesta» de la ficha (`reply_settled_at`, la acción `settle` de
 * `POST /api/conversations/bulk`), que se escribe en el acto: la fila se va.
 *
 * Lo que queda pendiente no vive en la fila, que una recarga puede quitar,
 * sino aquí, uno a la vez: el «cómo» opcional y «Deshacer» (`ChatDoneLine`).
 * En el hilo queda una nota («Ya está» o «Ya está: por teléfono») que firma
 * quien la marcó, con su fecha. La nota espera al «cómo» o a que pase el
 * plazo de deshacer; deshacer devuelve `reply_settled_at` y la nota no se
 * escribe nunca (el historial no se borra, ADR-098). Otro «Ya está», o salir
 * de la lente, escribe la anterior.
 */

import { mutateJSON } from '$lib/api';
import { t, type Locale } from '$lib/i18n';
import { addToast } from '$lib/components/Toast.svelte';
import type { BulkResult } from '$lib/conversation-bulk';

/** Lo que dura el «Deshacer» si nadie escribe el «cómo». */
export const DONE_UNDO_MS = 8000;

export interface PendingDone {
  id: string;
  /** Con quién, para la línea y el lector de pantalla. */
  name: string;
  locale: Locale;
  undo: BulkResult['undo'];
  how: string;
  /** Las listas se vuelven a leer tras escribir o deshacer. */
  refresh: () => void;
}

export const done = $state<{ pending: PendingDone | null; busy: string | null }>({ pending: null, busy: null });

let timer: ReturnType<typeof setTimeout> | null = null;

export function holdDone() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function waitDone() {
  holdDone();
  if (done.pending) timer = setTimeout(() => void commitDone(), DONE_UNDO_MS);
}

/** Un toque: se marca en el acto; lo anterior pendiente se escribe. */
export async function settleDone(id: string, name: string, locale: Locale, refresh: () => void) {
  if (done.busy) return;
  await commitDone();
  done.busy = id;
  try {
    const res = await mutateJSON<BulkResult>('POST', '/api/conversations/bulk', { action: 'settle', ids: [id] });
    if (!res || res.done.length === 0) throw new Error('not_done');
    done.pending = { id, name, locale, undo: res.undo, how: '', refresh };
    waitDone();
  } catch {
    addToast({ tone: 'danger', message: t('chat.done_failed', locale) });
  } finally {
    done.busy = null;
    refresh();
  }
}

/** La nota del hilo, una sola vez. */
export async function commitDone() {
  const p = done.pending;
  if (!p) return;
  holdDone();
  done.pending = null;
  const said = p.how.trim();
  const body = said ? t('chat.done_body_how', p.locale, { how: said }) : t('chat.done_body', p.locale);
  try {
    await mutateJSON('POST', `/api/conversations/${p.id}/events`, { kind: 'note', body });
  } catch {
    // Marcada sigue: lo que falta es la nota del hilo.
    addToast({ tone: 'warning', message: t('chat.done_note_failed', p.locale, { name: p.name }) });
  } finally {
    p.refresh();
  }
}

/** Deshacer: vuelve a pedir respuesta, y la nota no se escribe. */
export async function revertDone() {
  const p = done.pending;
  if (!p) return;
  holdDone();
  done.pending = null;
  done.busy = p.id;
  try {
    const res = await mutateJSON<BulkResult>('POST', '/api/conversations/bulk', { action: 'restore', items: p.undo });
    if (!res || res.failed.length > 0 || res.done.length === 0) throw new Error('not_undone');
    addToast({ tone: 'success', message: t('ui.undone', p.locale) });
  } catch {
    addToast({ tone: 'danger', message: t('ui.not_undone', p.locale) });
  } finally {
    done.busy = null;
    p.refresh();
  }
}
