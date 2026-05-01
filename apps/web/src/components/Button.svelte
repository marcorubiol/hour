<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'outline';
  type Size = 'xs' | 's' | 'm' | 'l';

  interface Props {
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
    lead?: Snippet;
    tail?: Snippet;
  }

  let {
    variant = 'primary',
    size = 'm',
    type = 'button',
    disabled = false,
    loading = false,
    onclick,
    children,
    lead,
    tail,
  }: Props = $props();

  let classes = $derived(
    [`btn--${variant}`, `btn--${size}`, loading && 'btn--loading']
      .filter(Boolean)
      .join(' ')
  );

  let isDisabled = $derived(disabled || loading);
</script>

<button
  {type}
  class={classes}
  disabled={isDisabled}
  aria-busy={loading || undefined}
  {onclick}
>
  {#if loading}<span class="btn__spinner" aria-hidden="true"></span>{/if}
  {#if lead}<span class="btn__lead">{@render lead()}</span>{/if}
  {#if children}{@render children()}{/if}
  {#if tail}<span class="btn__tail">{@render tail()}</span>{/if}
</button>
