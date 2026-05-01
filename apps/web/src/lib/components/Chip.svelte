<script lang="ts">
  import type { Snippet } from 'svelte';

  type Tone =
    | 'neutral'
    | 'primary'
    | 'info'
    | 'success'
    | 'warning'
    | 'danger';
  type Size = 'xs' | 's' | 'm';

  interface Props {
    tone?: Tone;
    size?: Size;
    selected?: boolean;
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    onRemove?: (event: MouseEvent) => void;
    removeLabel?: string;
    children?: Snippet;
    lead?: Snippet;
    tail?: Snippet;
  }

  let {
    tone = 'neutral',
    size = 's',
    selected = false,
    disabled = false,
    onclick,
    onRemove,
    removeLabel = 'Remove',
    children,
    lead,
    tail,
  }: Props = $props();

  let classes = $derived(
    [
      `chip--${tone}`,
      `chip--${size}`,
      selected && 'chip--selected',
      disabled && !onclick && 'chip--disabled',
    ]
      .filter(Boolean)
      .join(' ')
  );

  // Mutual exclusion: onRemove takes priority — chip body becomes static.
  // If both passed at once, only the X is interactive (avoids nested buttons).
  let isClickable = $derived(Boolean(onclick) && !onRemove);
</script>

{#if isClickable}
  <button
    type="button"
    class={classes}
    {disabled}
    aria-pressed={selected || undefined}
    {onclick}
  >
    {#if lead}<span class="chip__lead">{@render lead()}</span>{/if}
    {#if children}{@render children()}{/if}
    {#if tail}<span class="chip__tail">{@render tail()}</span>{/if}
  </button>
{:else}
  <span class={classes}>
    {#if lead}<span class="chip__lead">{@render lead()}</span>{/if}
    {#if children}{@render children()}{/if}
    {#if tail}<span class="chip__tail">{@render tail()}</span>{/if}
    {#if onRemove}
      <button
        type="button"
        class="chip__remove"
        aria-label={removeLabel}
        {disabled}
        onclick={onRemove}
      >
        <span aria-hidden="true">×</span>
      </button>
    {/if}
  </span>
{/if}
