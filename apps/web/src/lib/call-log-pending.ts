/**
 * La llamada apuntada desde la cabecera (121 A, ADR-182) espera el plazo de
 * «Deshacer» antes de escribirse, como la nota de «Ya está»
 * (`chat-done.svelte.ts`): el historial no se borra (ADR-098, no hay DELETE
 * de un evento), así que deshacer es no escribirla nunca. Si para apuntarla
 * se abrió una conversación, deshacer también la borra (como «Deshacer» tras
 * «Añadir conversación», ADR-139 p7).
 *
 * Se escribe al acabar el plazo, al pulsar «Ver conversación», al apuntar
 * otra, al salir de la lente o al cerrar sesión; cerrar o recargar la
 * pestaña la envía con `keepalive` (`flushCall`).
 */

import { goto } from '$app/navigation';
import { mutateJSON } from '$lib/api';
import { addToast, removeToast } from '$lib/components/Toast.svelte';
import { CREATED_TOAST_MS } from '$lib/created';
import { t, type Locale } from '$lib/i18n';
import type { ConversationEventCreate } from '$lib/conversation';

export interface PendingCall {
  conversationId: string;
  event: ConversationEventCreate;
  /** La conversación nació para esta llamada: deshacer la borra. */
  created: boolean;
  /** Con quién, para el aviso. */
  name: string;
  /** La ficha de la conversación. */
  href: string | null;
  locale: Locale;
  /** Las listas y el hilo se vuelven a leer tras escribir o deshacer. */
  refresh: (conversationId: string) => void;
}

let pending: PendingCall | null = null;
let toastId: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function take(): PendingCall | null {
  const p = pending;
  pending = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (toastId !== null) removeToast(toastId);
  toastId = null;
  return p;
}

/** La llamada espera su plazo; la anterior, si la había, se escribe ya. */
export async function holdCall(p: PendingCall) {
  await commitCall();
  pending = p;
  timer = setTimeout(() => void commitCall(), CREATED_TOAST_MS);
  toastId = addToast({
    tone: 'success',
    message: t('call.saved', p.locale, { name: p.name }),
    duration: CREATED_TOAST_MS,
    action: { label: t('ui.undo', p.locale), run: () => void undoCall() },
    also: p.href ? { label: t('call.see', p.locale), run: () => void seeCall() } : undefined,
  });
}

/** La escribe, una sola vez. False si no se pudo. */
export async function commitCall(): Promise<boolean> {
  const p = take();
  if (!p) return true;
  try {
    await mutateJSON('POST', `/api/conversations/${p.conversationId}/events`, p.event);
    return true;
  } catch (err) {
    addToast({
      tone: 'danger',
      title: t('conversations.not_recorded', p.locale),
      message: t('perf.try_again', p.locale, { error: err instanceof Error ? err.message : t('perf.unexpected', p.locale) }),
    });
    return false;
  } finally {
    p.refresh(p.conversationId);
  }
}

/** «Ver conversación»: se escribe y se abre su ficha. */
async function seeCall() {
  const href = pending?.href;
  await commitCall();
  if (href) await goto(href);
}

/** «Deshacer»: no se escribe; la conversación abierta para ella se borra. */
export async function undoCall() {
  const p = take();
  if (!p) return;
  try {
    if (p.created) await mutateJSON('DELETE', `/api/conversations/${p.conversationId}`);
    addToast({ tone: 'info', message: t('ui.undone', p.locale) });
  } catch (err) {
    addToast({ tone: 'danger', title: t('ui.not_undone', p.locale), message: err instanceof Error ? err.message : String(err) });
  } finally {
    p.refresh(p.conversationId);
  }
}

/** La pestaña se cierra o se recarga: sale con `keepalive`, sin esperar respuesta. */
export function flushCall() {
  const p = take();
  if (!p) return;
  try {
    void fetch(`/api/conversations/${p.conversationId}/events`, {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.event),
    }).catch(() => {});
  } catch {
    /* the page is going: nothing to tell */
  }
}
