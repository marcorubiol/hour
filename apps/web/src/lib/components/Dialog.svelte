<script lang="ts">
  import type { Snippet } from 'svelte';

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
        {#if title}<h2 id={titleId} class="dialog__title">{title}</h2>{/if}
        {#if description}
          <p class="dialog__description">{description}</p>
        {/if}
      </header>
    {/if}

    {#if children}
      <div class="dialog__body">{@render children()}</div>
    {/if}

    {#if actions}
      <footer class="dialog__actions">{@render actions()}</footer>
    {/if}
  </div>
</dialog>
