<script lang="ts">
  /**
   * ‹ ›, only where scrolling does not already move you (ADR-209 head, the
   * drawing of 16-11): the Agenda and the Month are scrolled, «Hoy» brings
   * you back. The Day travels to the next day that holds something, which no
   * scroll does, so its arrows stay beside its title until the seven-day
   * strip replaces them. The Board pans sideways, which a plain wheel does
   * not, so its arrows ride quietly with its dial.
   */
  import { t, type Locale } from '$lib/i18n';
  import type { PlannerView } from '$lib/planner';

  interface Props {
    view: Extract<PlannerView, 'day' | 'board'>;
    locale: Locale;
    /** `shift` = una muesca literal, no un salto a plan: el mismo gesto que
        `Shift+← →` en el Planner, con el ratón. La pantalla no lo anuncia
        (ADR-154): es un atajo para quien lo sabe. */
    onStepBack: (shift?: boolean) => void;
    onStepNext: (shift?: boolean) => void;
  }
  let { view, locale, onStepBack, onStepNext }: Props = $props();

  /* THE ARROWS SAY WHAT THEY DO IN THIS DRAWING (uso #15): in the Day they
     travel to the next day that HOLDS something, not to tomorrow, and the
     board pans a screen. «Next month» was the name on all of them. */
  let stepKeys = $derived(
    view === 'day'
      ? { prev: 'planner.prev_planned', next: 'planner.next_planned' }
      : view === 'board'
        ? { prev: 'planner.pan_back', next: 'planner.pan_next' }
        : { prev: 'planner.prev_month', next: 'planner.next_month' },
  );
</script>

<!-- Small on purpose, 28px squares: the thing they must not do is compete
     with the title: the title says where you are, these only move it. -->
<button
  type="button"
  class="cal__arw hit"
  aria-label={t(stepKeys.prev, locale)}
  title={t(stepKeys.prev, locale)}
  onclick={(e) => onStepBack(e.shiftKey)}>‹</button
>
<button
  type="button"
  class="cal__arw hit"
  aria-label={t(stepKeys.next, locale)}
  title={t(stepKeys.next, locale)}
  onclick={(e) => onStepNext(e.shiftKey)}>›</button
>

<style>
  @layer components {
    /* Sizes verbatim from the prototype: 28px squares, 13px glyph,
       `var(--radius)` for the squares. On a coarse
       pointer, a finger's target (móvil #5) that reaches past the square
       without growing it (`.hit`, base.css). */
    .cal__arw {
      inline-size: var(--control-size-xs);
      block-size: var(--control-size-xs);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius);
      background: var(--bg-ultra-light);
      color: var(--text-faint);
      font-size: var(--text-s);
      font-style: normal;
      line-height: 1;
      cursor: pointer;
    }
    .cal__arw:hover {
      color: var(--text-color);
      border-color: var(--text-faint);
    }
  }
</style>
