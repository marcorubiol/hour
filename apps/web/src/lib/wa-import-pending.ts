/**
 * La importación de un chat espera el plazo de «Deshacer» antes de escribirse
 * (ADR-189, como «Apuntar llamada», ADR-182): el registro no se borra
 * (ADR-098), así que deshacer es no escribirla nunca.
 *
 * Se escribe al acabar el plazo, al importar otro chat o al salir de la lente
 * (`commitImport`). Una pestaña cerrada dentro del plazo la pierde: no cabe
 * en un `keepalive` y no se ha escrito nada, así que volver a importar el
 * mismo archivo la completa.
 */

import { mutateJSON } from '$lib/api';
import { addToast, removeToast } from '$lib/components/Toast.svelte';
import { CREATED_TOAST_MS } from '$lib/created';
import { t, type Locale } from '$lib/i18n';
import type { ImportRequest, ImportResult } from '$lib/wa-import';

export interface PendingImport {
  request: ImportRequest;
  /** Cuántos mensajes, para el aviso. */
  count: number;
  locale: Locale;
  /** Las listas y los hilos se vuelven a leer tras escribir. */
  refresh: (conversationIds: string[]) => void;
}

let pending: PendingImport | null = null;
let toastId: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function take(): PendingImport | null {
  const p = pending;
  pending = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (toastId !== null) removeToast(toastId);
  toastId = null;
  return p;
}

/** Las conversaciones que toca una importación. */
export function touchedConversations(request: ImportRequest): string[] {
  return [...new Set(request.messages.flatMap((m) => m.placements.flatMap((p) => (p.conversation_id ? [p.conversation_id] : []))))];
}

/** La importación espera su plazo; la anterior, si la había, se escribe ya. */
export async function holdImport(p: PendingImport) {
  await commitImport();
  pending = p;
  timer = setTimeout(() => void commitImport(), CREATED_TOAST_MS);
  toastId = addToast({
    tone: 'success',
    message: t('wa_import.saved', p.locale, { n: p.count }),
    duration: CREATED_TOAST_MS,
    action: { label: t('ui.undo', p.locale), run: () => void take() },
  });
}

/** La escribe, una sola vez. */
export async function commitImport(): Promise<ImportResult | null> {
  const p = take();
  if (!p) return null;
  try {
    return await mutateJSON<ImportResult>('POST', '/api/whatsapp/import', p.request);
  } catch (err) {
    addToast({
      tone: 'danger',
      title: t('wa_import.failed', p.locale),
      message: t('perf.try_again', p.locale, { error: err instanceof Error ? err.message : t('perf.unexpected', p.locale) }),
    });
    return null;
  } finally {
    p.refresh(touchedConversations(p.request));
  }
}
