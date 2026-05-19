<script lang="ts">
  /**
   * BrandMark — pure wordmark, no glyph.
   *
   * Phase 0 brand strategy: maximum minimalism. The typography (italic
   * Newsreader) + the editorial voice carry the identity; no logo lives
   * here until one is designed. When the real logo lands, this is the
   * one component to swap.
   *
   * In compact mode (collapsed sidebar) renders the lowercase initial
   * "h" italic — same typography, same voice, just truncated to fit
   * the rail.
   *
   * If `href` is set the mark renders as a link; otherwise it's a
   * plain inline element.
   */

  type Size = 's' | 'm' | 'l';

  interface Props {
    href?: string;
    size?: Size;
    /** Truncates to the initial "h" — for collapsed sidebar rails. */
    compact?: boolean;
    ariaLabel?: string;
  }

  let {
    href,
    size = 'm',
    compact = false,
    ariaLabel = 'Hour — home',
  }: Props = $props();

  let label = $derived(compact ? 'h' : 'hour');
  let classes = $derived(
    ['brand', `brand--${size}`, compact && 'brand--compact']
      .filter(Boolean)
      .join(' '),
  );
</script>

{#if href}
  <a class={classes} {href} aria-label={ariaLabel}>{label}</a>
{:else}
  <span class={classes} aria-label={ariaLabel}>{label}</span>
{/if}

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    color: var(--text-color);
    text-decoration: none;
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .brand--s {
    font-size: var(--text-l);
  }
  .brand--m {
    font-size: var(--text-xl);
  }
  .brand--l {
    font-size: var(--text-xxl);
  }

  a.brand:hover {
    color: var(--text-muted);
  }
  a.brand:focus-visible {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: 4px;
    border-radius: 2px;
  }
</style>
