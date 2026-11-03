<script lang="ts">
  /**
   * La línea de «Ya está» encima de la lista (ADR-177): «Teatre de la Llum:
   * ya está · hoy», un «cómo» opcional de verdad (sin segundo paso: se
   * escribe o no) y «Deshacer». Vive aquí y no en la fila, que se va con el
   * toque, así que ni una recarga ni «Seleccionar» se la llevan. El estado es
   * de `$lib/chat-done.svelte`; esta línea sólo lo dibuja.
   *
   * Al aparecer, el foco va al «cómo» (la fila que lo tenía se ha ido). Intro
   * guarda con el «cómo»; Escape lo borra y deja correr el plazo; al cerrar,
   * el foco vuelve a la lista (`onclose`). La región avisa al lector.
   */
  import { onDestroy, tick } from 'svelte';
  import { t, type Locale } from '$lib/i18n';
  import { commitDone, done, holdDone, revertDone, waitDone } from '$lib/chat-done.svelte';

  interface Props {
    locale: Locale;
    /** Al guardar o deshacer desde aquí: adónde vuelve el foco. */
    onclose?: () => void;
  }

  let { locale, onclose }: Props = $props();

  let input = $state<HTMLInputElement>();
  let undoButton = $state<HTMLButtonElement>();
  let shown = $derived(done.pending?.id ?? null);

  $effect(() => {
    if (shown) void tick().then(() => input?.focus({ preventScroll: true }));
  });

  async function save() {
    await commitDone();
    onclose?.();
  }

  async function undo() {
    await revertDone();
    onclose?.();
  }

  // Leaving the lens writes what is pending: «Ya está» is already marked.
  onDestroy(() => void commitDone());
</script>

<div class="doneline" class:is-on={done.pending !== null} role="status" aria-live="polite">
  {#if done.pending}
    <span class="doneline__said">{t('chat.done_said', locale, { name: done.pending.name })}</span>
    <input
      bind:this={input}
      class="doneline__how"
      type="text"
      maxlength="200"
      placeholder={t('chat.done_how', locale)}
      aria-label={t('chat.done_how', locale)}
      bind:value={done.pending.how}
      onfocus={holdDone}
      onblur={(e) => {
        // To «Deshacer», nothing is written; an empty field lets the wait run again.
        if (e.relatedTarget === undoButton) return;
        if (done.pending?.how.trim()) void commitDone();
        else waitDone();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void save();
        } else if (e.key === 'Escape' && done.pending) {
          // Escape cancels the «cómo», not the «ya está».
          e.preventDefault();
          e.stopPropagation();
          done.pending.how = '';
          input?.blur();
        }
      }}
    />
    <button bind:this={undoButton} type="button" class="fact-act" onpointerdown={(e) => e.preventDefault()} onclick={() => void undo()}
      >{t('ui.undo', locale)}</button
    >
  {/if}
</div>

<style>
  @layer components {
    .doneline {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs) var(--space-s);
    }
    .doneline.is-on {
      padding: var(--space-xs) var(--space-s);
      border-radius: var(--radius-m);
      background: var(--bg-ultra-light);
    }
    .doneline__said {
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .doneline__how {
      flex: 1 1 12em;
      min-inline-size: 0;
      max-inline-size: 20em;
      padding: 0 var(--space-2xs);
      border: none;
      border-block-end: var(--line-hairline) solid var(--border-color-dark);
      background: transparent;
      color: var(--text-color);
      font: inherit;
      font-size: var(--text-s);
    }
    .doneline__how:focus-visible {
      outline: none;
      border-block-end-color: var(--focus-color);
    }
  }
</style>
