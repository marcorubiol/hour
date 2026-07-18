<script lang="ts">
  /**
   * Pill — lens / filter selector button.
   *
   * Skeleton wraps the .pill class system from base.css. Modifiers are
   * applied as class names; the CSS reads variables, not properties.
   *
   * Variants:
   * - size 'md' (default, lens top-bar) | 'sm' (filter rows)
   * - active: filled (var(--text-color) bg, var(--bg) fg)
   * - all: dashed outline + dot prefix (passive "no filter" indicator)
   */

  import type { Snippet } from 'svelte';

  type Size = 'md' | 'sm';

  interface Props {
    active?: boolean;
    size?: Size;
    all?: boolean;
    type?: 'button' | 'submit';
    disabled?: boolean;
    ariaLabel?: string;
    ariaCurrent?: 'page' | 'true' | undefined;
    /** Toggle-button semantics (e.g. a type-pill row) — sets aria-pressed. */
    ariaPressed?: boolean;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    active = false,
    size = 'md',
    all = false,
    type = 'button',
    disabled = false,
    ariaLabel,
    ariaCurrent,
    ariaPressed,
    onclick,
    children,
  }: Props = $props();

  let classes = $derived(
    ['pill', size === 'sm' && 'pill--sm', active && 'pill--on', all && 'pill--all']
      .filter(Boolean)
      .join(' '),
  );
</script>

<button
  {type}
  class={classes}
  {disabled}
  aria-label={ariaLabel}
  aria-current={ariaCurrent}
  aria-pressed={ariaPressed}
  {onclick}
>
  {#if children}{@render children()}{/if}
</button>
