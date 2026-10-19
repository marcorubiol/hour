<script lang="ts">
  /**
   * The window's controls — ‹ › Now — beside the title they move (ADR-136).
   * The title of Day, Agenda, Month and Board IS the window («October 2026»,
   * «Mon 20 Oct», «From 18 Oct»), so its three verbs ride with it. The Season
   * is a horizon from today with nothing to step: the page simply does not
   * render this there, and nothing is reserved.
   */
  import { t, type Locale } from '$lib/i18n';
  import type { PlannerView } from '$lib/planner';

  interface Props {
    view: PlannerView;
    locale: Locale;
    /** `shift` = una muesca literal, no un salto a plan. El teclado ya lo dice
        así (`Shift+← →` en el Planner); esto es el mismo gesto con el ratón,
        para que no haya que saberse el atajo para llegar a un hueco. */
    onStepBack: (shift?: boolean) => void;
    onStepNext: (shift?: boolean) => void;
    onNow: () => void;
  }
  let { view, locale, onStepBack, onStepNext, onNow }: Props = $props();

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
  function stepTitle(key: string): string {
    return view === 'day' ? `${t(key, locale)} · ${t('planner.step_hint', locale)}` : t(key, locale);
  }
</script>

<!-- Small on purpose — 28px squares and a 12px pill — because the thing they
     must not do is compete with the title beside them: the title says where
     you are, these only move it.

     And the button is `Now`, NOT `Today`: a view is called Today, and the
     same word for two acts is the one defect here that can lose somebody
     their place without telling them why. -->
<button
  type="button"
  class="cal__arw"
  aria-label={t(stepKeys.prev, locale)}
  title={stepTitle(stepKeys.prev)}
  onclick={(e) => onStepBack(e.shiftKey)}>‹</button
>
<button
  type="button"
  class="cal__arw"
  aria-label={t(stepKeys.next, locale)}
  title={stepTitle(stepKeys.next)}
  onclick={(e) => onStepNext(e.shiftKey)}>›</button
>
<button type="button" class="cal__now" onclick={onNow}>{t('planner.now', locale)}</button>

<style>
  @layer components {
    /* Sizes verbatim from the prototype: 28px squares, 13px glyph; the pill
       at 12px with 5/12 padding, `var(--radius)` for the squares. On a coarse
       pointer, a finger's target (móvil #5). */
    .cal__arw,
    .cal__now {
      min-block-size: var(--touch-target);
    }
    .cal__arw {
      min-inline-size: var(--touch-target);
      inline-size: 28px;
      block-size: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
      background: var(--bg-ultra-light);
      color: var(--text-faint);
      font-size: 13px;
      font-style: normal;
      line-height: 1;
      cursor: pointer;
    }
    .cal__arw:hover {
      color: var(--text-color);
      border-color: var(--text-faint);
    }
    .cal__now {
      padding: 5px 12px;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-circle);
      background: var(--bg-ultra-light);
      color: var(--text-faint);
      font-family: inherit;
      font-size: 12px;
      font-style: normal;
      line-height: 1.1;
      cursor: pointer;
    }
    .cal__now:hover {
      color: var(--text-color);
    }
  }
</style>
