<script module lang="ts">
</script>

<script lang="ts">
  /**
   * Planner toolbar — ‹ month › · today · [projection] · [lanes] · + · ⋯,
   * plus the carrils-only "Agrupa per" row. Pure presentation: the page
   * owns every piece of state (view/lanes, month window, dialog
   * flags) and the URL-sync semantics; this component only renders values
   * and reports gestures up through callbacks.
   */
  import Button from '$lib/components/Button.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { LaneAxis } from '$lib/carrils';
  import type { PlannerView } from '$lib/planner';

  interface Props {
    view: PlannerView;
    monthTitle: string;
    year: number;
    laneAxis: LaneAxis;
    calm: boolean;
    /** Blackout entry points hide while availability/team feeds are absent. */
    canBlackout: boolean;
    locale: Locale;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onThisMonth: () => void;
    onScrollToToday: () => void;
    onSetView: (v: PlannerView) => void;
    onSetLaneAxis: (g: LaneAxis) => void;
    onCreate: () => void;
    onFeed: () => void;
    /** «reading the marks» — the grammar key, one door for all four views. */
    onReadMarks: () => void;
    onBlackout: () => void;
  }

  let {
    view,
    monthTitle,
    year,
    laneAxis,
    calm,
    canBlackout,
    locale,
    onPrevMonth,
    onNextMonth,
    onThisMonth,
    onScrollToToday,
    onSetView,
    onSetLaneAxis,
    onCreate,
    onFeed,
    onReadMarks,
    onBlackout,
  }: Props = $props();
</script>

<div class="cal__toolbar">
  <div class="cal__nav-buttons">
    {#if view !== 'agenda'}
      <!-- Month/Carrils step through `ym`; the agenda is a continuous
           book (its own span) so the ←/→ window nav means nothing there. -->
      <Button variant="outline" size="s" onclick={onPrevMonth} label={t('planner.prev_month', locale)}
        >←</Button
      >
      <span class="cal__tbmonth">{monthTitle} {year}</span>
      <Button variant="outline" size="s" onclick={onNextMonth} label={t('planner.next_month', locale)}
        >→</Button
      >
    {/if}
    <Button
      variant="outline"
      size="s"
      onclick={view === 'agenda' ? onScrollToToday : onThisMonth}>{t('planner.today', locale)}</Button
    >
  </div>
  <div class="cal__spacer"></div>
  <!-- THE STATUS FILTER IS GONE (ADR-095 §3). The app already has one machine
       for narrowing and it is called scope, one line above. What survives is
       CALM, and it survives as a word on the facts side of the state line —
       never as a switch here. -->
  <div class="cal__tabs" role="group" aria-label={t('planner.view_label', locale)}>
    <button
      type="button"
      class="cal__tab"
      class:cal__tab--on={view === 'month'}
      aria-pressed={view === 'month'}
      onclick={() => onSetView('month')}>{t('planner.view_month', locale)}</button
    >
    <button
      type="button"
      class="cal__tab"
      class:cal__tab--on={view === 'agenda'}
      aria-pressed={view === 'agenda'}
      onclick={() => onSetView('agenda')}>{t('planner.view_agenda', locale)}</button
    >
    <button
      type="button"
      class="cal__tab"
      class:cal__tab--on={view === 'board'}
      aria-pressed={view === 'board'}
      onclick={() => onSetView('board')}>{t('planner.view_board', locale)}</button
    >
  </div>
  <Button size="s" onclick={onCreate} label={t('planner.new', locale)}>+</Button>
  <Menu
    align="end"
    label={t('planner.more', locale)}
    items={[
      { label: t('planner.read_marks', locale), onclick: onReadMarks },
      { label: t('planner.feed', locale), onclick: onFeed },
      ...(canBlackout
        ? [
            {
              label: t('planner.blackout_menu', locale),
              onclick: onBlackout,
            },
          ]
        : []),
    ]}
  >
    {#snippet trigger()}⋯{/snippet}
  </Menu>
</div>

{#if view === 'board'}
  <!-- Agrupa per (ADR-080 §8) — its own row, left-aligned; carrils only. -->
  <div class="cal__grouprow" role="group" aria-label={t('planner.lanes_label', locale)}>
    <span class="cal__group-lead">{t('planner.lanes_label', locale)}</span>
    <div class="cal__tabs">
      {#each ['workspace', 'project', 'person'] as const as g (g)}
        <button
          type="button"
          class="cal__tab"
          class:cal__tab--on={laneAxis === g}
          aria-pressed={laneAxis === g}
          onclick={() => onSetLaneAxis(g)}>{t(`planner.lanes_${g}`, locale)}</button
        >
      {/each}
    </div>
  </div>
{/if}

<style>
  @layer components {
    /* Toolbar: ‹ month › · today · [projection] · [lanes] · + · ⋯ */
    .cal__toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      flex-wrap: wrap;
    }
    .cal__nav-buttons {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .cal__tbmonth {
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 500;
      min-inline-size: 7.5rem;
      text-align: center;
      text-transform: capitalize;
    }
    .cal__spacer {
      flex: 1;
    }


    /* Agrupa per (ADR-080 §8) — its own row under the toolbar, left-aligned. */
    .cal__grouprow {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .cal__group-lead {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      white-space: nowrap;
    }

    /* Named projection toggle + Agrupa per — text tabs, active underlined
       (ADR-076: nunca un icono). Lighter than a pill: the word is the tab. */
    .cal__tabs {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .cal__tab {
      border: none;
      background: none;
      padding: 0;
      font-family: inherit;
      font-size: var(--text-s);
      line-height: 1.3;
      color: var(--text-faint);
      cursor: pointer;
      white-space: nowrap;
      border-block-end: 1.5px solid transparent;
      transition: color var(--transition);
    }
    .cal__tab:hover {
      color: var(--text-muted);
    }
    .cal__tab--on {
      color: var(--text-color);
      font-weight: 500;
      border-block-end-color: var(--text-color);
    }
  }
</style>
