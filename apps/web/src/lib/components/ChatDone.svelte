<script lang="ts">
  /**
   * «Ya está» en la fila de chat (ADR-176 § 5, enmendado por ADR-177): lo
   * que se resolvió por teléfono o WhatsApp sale de «Nos toca» de un toque.
   * Es el «No pide respuesta» de la ficha (`reply_settled_at`, la acción
   * `settle` de `POST /api/conversations/bulk`), que se escribe en el acto.
   *
   * Tras el toque, en su sitio: una línea de «cómo», opcional de verdad (sin
   * segundo paso: se escribe o no), y «Deshacer». En el hilo queda una nota
   * («Ya está» o «Ya está: por teléfono»), que firma quien la marcó con su
   * fecha. La nota espera: al «cómo» (Intro o al salir del campo) o, si
   * nadie lo toca, a que pase el plazo de deshacer. Deshacer devuelve
   * `reply_settled_at` y la nota no se escribe nunca (el historial no se
   * borra, ADR-098). Si la fila se va antes, lo pendiente sale entonces.
   */
  import { onDestroy } from 'svelte';
  import { mutateJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { BulkResult } from '$lib/conversation-bulk';

  interface Props {
    conversationId: string;
    /** Con quién, para el lector de pantalla («Teatre de la Llum: ya está»). */
    name: string;
    locale: Locale;
    /** Después de escribir o de deshacer: la lista se vuelve a leer. */
    onchange?: () => void;
    /**
     * Mientras se puede deshacer o escribir el «cómo»: quien aloja la fila la
     * mantiene aunque una recarga diga que ya no pide respuesta.
     */
    onhold?: (holding: boolean) => void;
  }

  let { conversationId, name, locale, onchange, onhold }: Props = $props();

  /** Lo que dura el «Deshacer» si nadie escribe el «cómo». */
  const UNDO_MS = 8000;

  let phase = $state<'idle' | 'busy' | 'done'>('idle');
  let how = $state('');
  let undo: BulkResult['undo'] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let input = $state<HTMLInputElement>();
  let undoButton = $state<HTMLButtonElement>();

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function wait() {
    stop();
    timer = setTimeout(() => void commit(), UNDO_MS);
  }

  async function settle() {
    phase = 'busy';
    try {
      const res = await mutateJSON<BulkResult>('POST', '/api/conversations/bulk', { action: 'settle', ids: [conversationId] });
      if (!res || res.done.length === 0) throw new Error('not_done');
      undo = res.undo;
      phase = 'done';
      onhold?.(true);
      wait();
      queueMicrotask(() => input?.focus({ preventScroll: true }));
    } catch {
      phase = 'idle';
      addToast({ tone: 'danger', message: t('chat.done_failed', locale) });
    }
  }

  /** La nota del hilo, una sola vez. */
  async function commit() {
    if (phase !== 'done') return;
    stop();
    phase = 'idle';
    onhold?.(false);
    const said = how.trim();
    const body = said ? t('chat.done_body_how', locale, { how: said }) : t('chat.done_body', locale);
    try {
      await mutateJSON('POST', `/api/conversations/${conversationId}/events`, { kind: 'note', body });
    } finally {
      onchange?.();
    }
  }

  async function revert() {
    if (phase !== 'done') return;
    stop();
    phase = 'busy';
    try {
      await mutateJSON('POST', '/api/conversations/bulk', { action: 'restore', items: undo });
      addToast({ tone: 'success', message: t('ui.undone', locale) });
    } catch {
      addToast({ tone: 'danger', message: t('ui.not_undone', locale) });
    } finally {
      phase = 'idle';
      onhold?.(false);
      how = '';
      onchange?.();
    }
  }

  onDestroy(() => void commit());
</script>

{#if phase === 'done'}
  <span class="done" role="group" aria-label={t('chat.done_aria', locale, { name })}>
    <span class="done__said">{t('chat.done_line', locale)}</span>
    <input
      bind:this={input}
      class="done__how"
      type="text"
      maxlength="200"
      placeholder={t('chat.done_how', locale)}
      aria-label={t('chat.done_how', locale)}
      bind:value={how}
      onfocus={stop}
      onblur={(e) => {
        // To «Deshacer», nothing is written; leaving an empty field restarts the wait.
        if (e.relatedTarget === undoButton) return;
        if (how.trim()) void commit();
        else wait();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          void commit();
        }
      }}
    />
    <button bind:this={undoButton} type="button" class="fact-act" onpointerdown={(e) => e.preventDefault()} onclick={() => void revert()}
      >{t('ui.undo', locale)}</button
    >
  </span>
{:else}
  <button
    type="button"
    class="fact-act"
    disabled={phase === 'busy'}
    aria-label={t('chat.done_aria', locale, { name })}
    onclick={() => void settle()}>{t('chat.done', locale)}</button
  >
{/if}

<style>
  @layer components {
    .done {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
    }
    .done__said {
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .done__how {
      inline-size: 12em;
      padding: 0 var(--space-2xs);
      border: none;
      border-block-end: var(--line-hairline) solid var(--border-color-dark);
      background: transparent;
      color: var(--text-color);
      font: inherit;
      font-size: var(--text-xs);
    }
    .done__how:focus-visible {
      outline: none;
      border-block-end-color: var(--focus-color);
    }
  }
</style>
