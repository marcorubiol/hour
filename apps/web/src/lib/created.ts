/**
 * After creating, one notice with «Deshacer» (ADR-139 p7): the dialog has
 * closed, so the toast is where the new thing says it exists, and the way
 * back is one click on it. `undo` deletes what was just made; without one
 * (nothing to delete it with yet) the notice only says it.
 */
import { addToast } from '$lib/components/Toast.svelte';
import { t, type Locale } from '$lib/i18n';

export const CREATED_TOAST_MS = 6000;

export function toastCreated(opts: {
  message: string;
  locale: Locale;
  undo?: () => Promise<unknown>;
  /** «Abrir»: go to what was just made (a performance's page), staying put
      until asked. */
  open?: () => void;
}): number {
  const { message, locale, undo, open } = opts;
  return addToast({
    tone: 'success',
    message,
    duration: CREATED_TOAST_MS,
    action: undo
      ? {
          label: t('ui.undo', locale),
          run: () => {
            undo().then(
              () => addToast({ tone: 'info', message: t('ui.undone', locale) }),
              (err: unknown) =>
                addToast({
                  tone: 'danger',
                  title: t('ui.not_undone', locale),
                  message: err instanceof Error ? err.message : String(err),
                }),
            );
          },
        }
      : undefined,
    also: open ? { label: t('ui.open', locale), run: open } : undefined,
  });
}
