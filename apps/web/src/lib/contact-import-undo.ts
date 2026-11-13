/**
 * Deshacer una importación de contactos (138), lo mismo desde el resultado,
 * el aviso y Ajustes: la llamada, lo que se vuelve a leer y lo que se dice.
 * La confirmación (`ConfirmDialog`, ADR-194 § 1) la pone quien llama.
 */

import type { QueryClient } from '@tanstack/svelte-query';
import { ApiError, mutateJSON } from '$lib/api';
import { addToast } from '$lib/components/Toast.svelte';
import { t, type Locale } from '$lib/i18n';
import type { UndoResult } from '$lib/contact-import';

/** Lo que cambia al deshacer: personas, organizaciones, notas y el historial. */
export const CONTACT_IMPORT_KEYS = [['contact-imports'], ['person'], ['organization'], ['organizations'], ['palette-search']] as const;

export async function undoContactImport(id: string, locale: Locale, queryClient: QueryClient): Promise<boolean> {
  try {
    const body = await mutateJSON<{ undo: UndoResult | null }>('DELETE', `/api/contact-imports/${encodeURIComponent(id)}`);
    await Promise.all(CONTACT_IMPORT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
    const kept = (body?.undo?.persons_kept ?? 0) + (body?.undo?.organizations_kept ?? 0);
    addToast({
      tone: 'info',
      message: t('contact_import.undone', locale),
      ...(kept > 0 ? { title: t('contact_import.undone_kept', locale, { n: kept }) } : {}),
      ...(body?.undo?.notes_kept ? { title: t('contact_import.undone_notes_kept', locale, { n: body.undo.notes_kept }) } : {}),
    });
    return true;
  } catch (err) {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    addToast({
      tone: 'danger',
      title: t('contact_import.undo_failed', locale),
      message:
        code === 'undo_expired'
          ? t('contact_import.err_expired', locale)
          : code === 'already_undone'
            ? t('contact_import.err_undone', locale)
            : code === 'not_ready'
              ? t('contact_import.not_ready', locale)
              : t('perf.unexpected', locale),
    });
    return false;
  }
}
