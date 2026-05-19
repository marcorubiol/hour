<script lang="ts">
  /**
   * ThemeToggle — single button cycling through Light → Auto → Dark.
   *
   * Icons are inline SVG with the same drawing language as the logout
   * icon in the account menu (viewBox 16, stroke 1.4, round caps) so
   * all line-art icons read as one family.
   *
   * Glyph reflects the SAVED mode (not the resolved theme). That way
   * every click visibly changes the icon even when the OS preference
   * makes the underlying paint identical between two consecutive
   * states (e.g. light → auto on a light-preferring OS still flips
   * the icon from sun to half, so the user sees the cycle moved).
   *
   * `variant`:
   *   'boxed' — bordered button (toolbar contexts)
   *   'plain' — icon-only, inherits surrounding rhythm (menu rows)
   */

  import { useTheme, type ThemeMode } from '$lib/theme.svelte';

  type Variant = 'boxed' | 'plain';

  interface Props {
    variant?: Variant;
  }

  let { variant = 'boxed' }: Props = $props();

  const theme = useTheme();

  const CYCLE: ThemeMode[] = ['light', 'system', 'dark'];

  function next(mode: ThemeMode): ThemeMode {
    const i = CYCLE.indexOf(mode);
    return CYCLE[(i + 1) % CYCLE.length];
  }

  const NAME: Record<ThemeMode, string> = {
    light: 'Light',
    system: 'Auto',
    dark: 'Dark',
  };

  let label = $derived(
    theme.mode === 'system'
      ? `Auto (currently ${theme.resolvedMode}) — click for ${NAME[next(theme.mode)]}`
      : `${NAME[theme.mode]} — click for ${NAME[next(theme.mode)]}`,
  );

  let classes = $derived(`theme-toggle theme-toggle--${variant}`);
</script>

<button
  type="button"
  class={classes}
  aria-label={label}
  title={label}
  onclick={() => theme.setMode(next(theme.mode))}
>
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if theme.mode === 'light'}
      <!-- Sun — central disc + 8 geometric rays -->
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5 V3" />
      <path d="M8 13 V14.5" />
      <path d="M1.5 8 H3" />
      <path d="M13 8 H14.5" />
      <path d="M3.4 3.4 L4.5 4.5" />
      <path d="M11.5 11.5 L12.6 12.6" />
      <path d="M3.4 12.6 L4.5 11.5" />
      <path d="M11.5 4.5 L12.6 3.4" />
    {:else if theme.mode === 'system'}
      <!-- Auto — full disc outlined, left half filled (the "split" between
           light & dark following the OS). -->
      <circle cx="8" cy="8" r="5.5" />
      <path
        d="M8 2.5 A5.5 5.5 0 0 0 8 13.5 Z"
        fill="currentColor"
        stroke="none"
      />
    {:else}
      <!-- Moon — crescent made from one stroked path (two arcs). -->
      <path d="M13 9.5 A5.5 5.5 0 1 1 6.5 3 A4 4 0 0 0 13 9.5 Z" />
    {/if}
  </svg>
</button>

<style>
  /* Skeleton declares the variable contract; modifiers redeclare vars only.
     `--toggle-size` lets each variant fit its surrounding rhythm — boxed
     in toolbars at 28px, plain in the account menu at 32px so it aligns
     with sibling icon-action buttons (.settings-row__action). */
  .theme-toggle {
    --toggle-size: 28px;
    --toggle-border: 1px solid var(--border-color-light);
    --toggle-bg: transparent;
    --toggle-bg-hover: var(--bg-hover);
    --toggle-border-hover: var(--border-color-dark);

    inline-size: var(--toggle-size);
    block-size: var(--toggle-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--toggle-bg);
    border: var(--toggle-border);
    border-radius: var(--radius-s);
    color: var(--text-faint);
    cursor: pointer;
    line-height: 1;
    transition:
      background var(--transition), color var(--transition),
      border-color var(--transition);
  }

  .theme-toggle--plain {
    --toggle-size: 32px;
    --toggle-border: 0;
    --toggle-bg: transparent;
    --toggle-bg-hover: var(--bg-ultra-light);
    --toggle-border-hover: 0;
  }

  .theme-toggle:hover {
    background: var(--toggle-bg-hover);
    color: var(--text-color);
    border-color: var(--toggle-border-hover);
  }

  .theme-toggle:focus-visible {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: var(--focus-offset);
  }
</style>
