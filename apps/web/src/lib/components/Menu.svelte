<script lang="ts">
  import type { Snippet } from 'svelte';

  export interface MenuAction {
    label: string;
    onclick?: () => void;
    href?: string;
    disabled?: boolean;
    danger?: boolean;
  }

  interface Props {
    items?: MenuAction[];
    align?: 'start' | 'end';
    label?: string;
    triggerClass?: string;
    trigger?: Snippet;
    children?: Snippet<[{ close: () => void }]>;
    onopen?: () => void;
    onclose?: () => void;
  }

  let {
    items,
    align = 'start',
    label = 'Open menu',
    triggerClass = 'btn--outline btn--s',
    trigger,
    children,
    onopen,
    onclose,
  }: Props = $props();

  let open = $state(false);
  let wrapperEl: HTMLElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLUListElement | undefined = $state();
  let focusedIndex = $state(0);

  function openMenu() {
    if (open) return;
    open = true;
    focusedIndex = 0;
    onopen?.();
  }

  function close(returnFocus = true) {
    if (!open) return;
    open = false;
    onclose?.();
    if (returnFocus) triggerEl?.focus();
  }

  function toggle() {
    open ? close() : openMenu();
  }

  $effect(() => {
    if (!open || !wrapperEl) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperEl?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  $effect(() => {
    if (!open || !menuEl) return;
    const itemEls = menuEl.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])'
    );
    itemEls[focusedIndex]?.focus();
  });

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    if (!open || !menuEl) return;
    const itemEls = menuEl.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])'
    );
    const max = itemEls.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusedIndex = focusedIndex >= max ? 0 : focusedIndex + 1;
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusedIndex = focusedIndex <= 0 ? max : focusedIndex - 1;
        break;
      case 'Home':
        event.preventDefault();
        focusedIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        focusedIndex = max;
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        close(false);
        break;
    }
  }

  function handleItemClick(item: MenuAction) {
    if (item.disabled) return;
    item.onclick?.();
    close();
  }

  let menuClasses = $derived(`menu menu--${align}`);
</script>

<div class="menu-wrapper" bind:this={wrapperEl}>
  <button
    bind:this={triggerEl}
    type="button"
    class={triggerClass}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={trigger ? undefined : label}
    onclick={toggle}
    onkeydown={handleTriggerKeydown}
  >
    {#if trigger}
      {@render trigger()}
    {:else}
      <span aria-hidden="true">⋮</span>
    {/if}
  </button>

  {#if open}
    <ul
      bind:this={menuEl}
      class={menuClasses}
      role="menu"
      onkeydown={handleMenuKeydown}
    >
      {#if items}
        {#each items as item, i (i)}
          <li role="none">
            {#if item.href && !item.disabled}
              <a
                role="menuitem"
                href={item.href}
                class={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                tabindex={focusedIndex === i ? 0 : -1}
                onclick={() => close(false)}
              >
                {item.label}
              </a>
            {:else}
              <button
                role="menuitem"
                type="button"
                class={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                tabindex={focusedIndex === i ? 0 : -1}
                onclick={() => handleItemClick(item)}
              >
                {item.label}
              </button>
            {/if}
          </li>
        {/each}
      {:else if children}
        {@render children({ close })}
      {/if}
    </ul>
  {/if}
</div>
