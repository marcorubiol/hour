<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'outline' | 'danger';
  type Size = 'xs' | 's' | 'm' | 'l';

  interface Props {
    variant?: Variant;
    size?: Size;
    /** Tone modifier — combinable with any variant. Currently 'warn'
        repaints text+border to danger; useful for outline buttons that
        carry destructive secondary actions (Leave, Cancel, Remove). */
    tone?: 'warn';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    onclick?: (event: MouseEvent) => void;
    /** Accessible name for icon-only buttons (renders as aria-label). */
    label?: string;
    children?: Snippet;
    lead?: Snippet;
    tail?: Snippet;
  }

  let {
    variant = 'primary',
    size = 'm',
    tone,
    type = 'button',
    disabled = false,
    loading = false,
    onclick,
    label,
    children,
    lead,
    tail,
  }: Props = $props();

  let classes = $derived(
    [
      `btn--${variant}`,
      `btn--${size}`,
      tone === 'warn' && 'is-warn',
      loading && 'btn--loading',
    ]
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
  aria-label={label}
  {onclick}
>
  {#if loading}<span class="btn__spinner" aria-hidden="true"></span>{/if}
  {#if lead}<span class="btn__lead">{@render lead()}</span>{/if}
  {#if children}{@render children()}{/if}
  {#if tail}<span class="btn__tail">{@render tail()}</span>{/if}
</button>
