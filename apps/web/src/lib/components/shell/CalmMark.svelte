<script lang="ts">
  /**
   * Calm as a mark (ADR-202 § 11, design-system rule 14): the wave that
   * settles, in a circle; an outline when it is off, the circle filled with
   * the mark in negative when it is on. The same mark in every theme: a theme
   * changes its stroke (`--mark-stroke`) and its inks, never the drawing.
   * One home for it: the phone's top bar and the desktop rail both draw this.
   * The `c` key toggles it too (the /h layout).
   */
  import { appLocale, t } from '$lib/i18n';
  import { useCalm } from '$lib/stores/calm.svelte';

  const calm = useCalm();
  const locale = appLocale();
</script>

<button
  type="button"
  class="calmmark"
  aria-pressed={calm.on}
  aria-label={t('calm.mark_aria', locale)}
  title={t('calm.mark_aria', locale)}
  aria-keyshortcuts="C"
  onclick={() => calm.toggle()}
>
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8c1.1-3.6 2.9-3.6 4 0c.9 2.3 2.4 2.3 3.3 0H14.5" /></svg>
</button>

<style>
  .calmmark {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    padding: 0;
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
  }
  /* The finger's target grows past the drawn circle, never the circle. */
  .calmmark::before {
    content: '';
    position: absolute;
    inset: min(0em, calc((var(--control-size-s) - var(--touch-target)) / 2));
  }
  @media (hover: hover) {
    .calmmark:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }
  }
  .calmmark[aria-pressed='true'] {
    background: var(--heading-color);
    border-color: var(--heading-color);
    color: var(--bg);
  }
  .calmmark svg {
    inline-size: 1rem;
    block-size: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: var(--mark-stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
