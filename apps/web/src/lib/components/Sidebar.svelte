<script lang="ts">
  import type { Snippet } from 'svelte';

  type Side = 'start' | 'end';

  interface Props {
    open?: boolean;
    side?: Side;
    closeOnBackdrop?: boolean;
    label?: string;
    onclose?: () => void;
    header?: Snippet;
    children?: Snippet<[{ close: () => void }]>;
    footer?: Snippet;
  }

  let {
    open = $bindable(false),
    side = 'start',
    closeOnBackdrop = true,
    label = 'Navigation',
    onclose,
    header,
    children,
    footer,
  }: Props = $props();

  let sidebarEl: HTMLElement | undefined = $state();

  // Drawer-semantic close — only acts on mobile, where the sidebar is a
  // dismissable overlay. On desktop the sidebar is static; navigation inside
  // it shouldn't hide it. To hide it on desktop, mutate `open` from outside.
  function close() {
    if (open && isMobile()) {
      open = false;
      onclose?.();
    }
  }

  function handleBackdropClick() {
    if (closeOnBackdrop) close();
  }

  function isMobile(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 47.999rem)').matches
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open && isMobile()) {
      event.preventDefault();
      close();
    }
  }

  // Body scroll lock — only when drawer is open on mobile.
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (!open || !isMobile()) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });

  // Move focus into the drawer on mobile open so keyboard users land inside.
  $effect(() => {
    if (!open || !sidebarEl || !isMobile()) return;
    const focusable = sidebarEl.querySelector<HTMLElement>(
      'a, button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
  });

  let classes = $derived(
    ['sidebar', `sidebar--${side}`, open && 'sidebar--open']
      .filter(Boolean)
      .join(' ')
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<aside bind:this={sidebarEl} class={classes} aria-label={label}>
  {#if header}<header class="sidebar__header">{@render header()}</header>{/if}
  {#if children}
    <div class="sidebar__body">{@render children({ close })}</div>
  {/if}
  {#if footer}<footer class="sidebar__footer">{@render footer()}</footer>{/if}
</aside>

<button
  type="button"
  class="sidebar__backdrop"
  aria-label="Close navigation"
  aria-hidden={!open}
  tabindex={open ? 0 : -1}
  data-open={open || undefined}
  onclick={handleBackdropClick}
></button>
