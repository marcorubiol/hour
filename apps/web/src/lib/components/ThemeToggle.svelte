<script lang="ts">
  /**
   * ThemeToggle — single button cycling through Light → Auto → Dark.
   *
   * Glyph reflects the SAVED mode (not the resolved theme). That way
   * every click visibly changes the icon even when the OS preference
   * makes the underlying paint identical between two consecutive
   * states (e.g. light → auto on a light-preferring OS still flips
   * the glyph from ☼ to ◐, so the user sees the cycle moved).
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

  const GLYPH: Record<ThemeMode, string> = {
    light: '☼',
    system: '◐',
    dark: '☾',
  };
  const NAME: Record<ThemeMode, string> = {
    light: 'Light',
    system: 'Auto',
    dark: 'Dark',
  };

  let glyph = $derived(GLYPH[theme.mode]);
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
  <span aria-hidden="true">{glyph}</span>
</button>

<style>
  /* Skeleton declares the variable contract; modifiers redeclare vars only. */
  .theme-toggle {
    --toggle-border: 1px solid var(--border-color-light);
    --toggle-bg: transparent;
    --toggle-bg-hover: var(--bg-hover);
    --toggle-border-hover: var(--border-color-dark);

    inline-size: 28px;
    block-size: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--toggle-bg);
    border: var(--toggle-border);
    border-radius: var(--radius-s);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--text-s);
    line-height: 1;
    transition:
      background var(--transition), color var(--transition),
      border-color var(--transition);
  }

  .theme-toggle--plain {
    --toggle-border: 0;
    --toggle-bg: transparent;
    --toggle-bg-hover: transparent;
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
