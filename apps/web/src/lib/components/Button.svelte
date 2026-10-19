<script lang="ts">
  import type { Snippet } from 'svelte';

  /** The closed set (ADR-139 p4): primary (ink, one per dialog or screen),
      secondary (a hairline), quiet (a word). Destructive is `tone="warn"`. */
  type Variant = 'primary' | 'secondary' | 'quiet';
  /** Two sizes from the first level's scale: s (default) and xs (in a row). */
  type Size = 'xs' | 's';

  interface Props {
    variant?: Variant;
    size?: Size;
    /** Tone modifier — combinable with any variant. 'warn' repaints the
        words (and a secondary's hairline) to danger: Delete, Leave, Remove. */
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
    size = 's',
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
