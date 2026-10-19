<script lang="ts">
  /**
   * Dialog — the one frame for every add and edit (ADR-139 p4).
   *
   * The paper sits one step above the canvas with a hairline, so it never
   * melts into a dark page. The title is the lens title one step down, in
   * the same italic (numbers upright, LensTitle). The body scrolls on its
   * own and the foot stays put; on a phone the paper is a sheet from below.
   *
   * The foot has two ends: `actions` on the right (a quiet «Cancelar» and
   * the one primary), `lead` on the left for the action that is not the
   * point of the dialog (delete, switch to another form) — always a word.
   */
  import type { Snippet } from 'svelte';
  import LensTitle from './LensTitle.svelte';

  type Size = 's' | 'm' | 'l';

  interface Props {
    open?: boolean;
    title?: string;
    description?: string;
    size?: Size;
    closeOnBackdrop?: boolean;
    onclose?: () => void;
    children?: Snippet;
    actions?: Snippet;
    lead?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    description,
    size = 'm',
    closeOnBackdrop = true,
    onclose,
    children,
    actions,
    lead,
  }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let titleId = $derived(`dialog-${Math.random().toString(36).slice(2, 8)}`);

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) dialogEl.showModal();
    else if (!open && dialogEl.open) dialogEl.close();
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });

  function handleClose() {
    if (open) {
      open = false;
      onclose?.();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (!closeOnBackdrop) return;
    if (event.target === dialogEl) handleClose();
  }

  let dialogClasses = $derived(`dialog dialog--${size}`);
</script>

<dialog
  bind:this={dialogEl}
  class={dialogClasses}
  aria-labelledby={title ? titleId : undefined}
  onclose={handleClose}
  onclick={handleBackdropClick}
>
  <div class="dialog__panel">
    {#if title || description}
      <header class="dialog__header">
        {#if title}<h2 id={titleId} class="dialog__title"><LensTitle text={title} /></h2>{/if}
        {#if description}
          <p class="dialog__description">{description}</p>
        {/if}
      </header>
    {/if}

    {#if children}
      <div class="dialog__body">{@render children()}</div>
    {/if}

    {#if actions || lead}
      <footer class="dialog__actions">
        {#if lead}<div class="dialog__lead">{@render lead()}</div>{/if}
        {#if actions}{@render actions()}{/if}
      </footer>
    {/if}
  </div>
</dialog>
