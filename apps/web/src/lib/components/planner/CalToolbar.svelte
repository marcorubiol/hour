<script module lang="ts">
  /** Client-side status filter (ADR-078 §12: Tot | Holds | Confirmats). */
  export type CalFilter = 'all' | 'holds' | 'confirmed';
</script>

<script lang="ts">
  /**
   * Planner toolbar — ‹ month › · today · [filter] · [projection] · + · ⋯,
   * plus the carrils-only "Agrupa per" row. Pure presentation: the page
   * owns every piece of state (view/filter/group, month window, dialog
   * flags) and the URL-sync semantics; this component only renders values
   * and reports gestures up through callbacks.
   */
  import Button from '$lib/components/Button.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { t, type Locale } from '$lib/i18n';
  import type { CarrilsGroup } from '$lib/carrils';
  import type { PlannerView } from '$lib/planner';

  interface Props {
    view: PlannerView;
    monthTitle: string;
    year: number;
    filter: CalFilter;
    carrilsGroup: CarrilsGroup;
    /** Calm mode hides the manual status filter (confirmed-only forced). */
    calm: boolean;
    /** Blackout entry points hide while availability/team feeds are absent. */
    canBlackout: boolean;
    locale: Locale;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onThisMonth: () => void;
    onScrollToToday: () => void;
    onSetView: (v: PlannerView) => void;
    onSetGroup: (g: CarrilsGroup) => void;
    onSetFilter: (f: CalFilter) => void;
    onCreate: () => void;
    onFeed: () => void;
    onBlackout: () => void;
  }

  let {
    view,
    monthTitle,
    year,
    filter,
    carrilsGroup,
    calm,
    canBlackout,
    locale,
    onPrevMonth,
    onNextMonth,
    onThisMonth,
    onScrollToToday,
    onSetView,
    onSetGroup,
    onSetFilter,
    onCreate,
    onFeed,
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
  {#if !calm}
    <div class="cal__filter" role="group" aria-label={t('planner.filter_label', locale)}>
      <button
        type="button"
        class="cal__filter-btn"
        class:cal__filter-btn--on={filter === 'all'}
        aria-pressed={filter === 'all'}
        onclick={() => onSetFilter('all')}>{t('planner.filter_all', locale)}</button
      >
      <button
        type="button"
        class="cal__filter-btn"
        class:cal__filter-btn--on={filter === 'holds'}
        aria-pressed={filter === 'holds'}
        onclick={() => onSetFilter('holds')}>{t('planner.filter_holds', locale)}</button
      >
      <button
        type="button"
        class="cal__filter-btn"
        class:cal__filter-btn--on={filter === 'confirmed'}
        aria-pressed={filter === 'confirmed'}
        onclick={() => onSetFilter('confirmed')}>{t('planner.filter_confirmed', locale)}</button
      >
    </div>
  {/if}
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
      class:cal__tab--on={view === 'carrils'}
      aria-pressed={view === 'carrils'}
      onclick={() => onSetView('carrils')}>{t('planner.view_carrils', locale)}</button
    >
  </div>
  <Button size="s" onclick={onCreate} label={t('planner.new', locale)}>+</Button>
  <Menu
    align="end"
    label={t('planner.more', locale)}
    items={[
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

{#if view === 'carrils'}
  <!-- Agrupa per (ADR-080 §8) — its own row, left-aligned; carrils only. -->
  <div class="cal__grouprow" role="group" aria-label={t('planner.group_label', locale)}>
    <span class="cal__group-lead">{t('planner.group_label', locale)}</span>
    <div class="cal__tabs">
      {#each ['espai', 'projecte', 'persona'] as const as g (g)}
        <button
          type="button"
          class="cal__tab"
          class:cal__tab--on={carrilsGroup === g}
          aria-pressed={carrilsGroup === g}
          onclick={() => onSetGroup(g)}>{t(`planner.group_${g}`, locale)}</button
        >
      {/each}
    </div>
  </div>
{/if}

<style>
  @layer components {
    /* Toolbar: ‹ month › · today · [filter] · [projection] · + · ⋯ */
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

    .cal__filter {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
    }
    .cal__filter-btn {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-m);
      background: none;
      border: none;
      cursor: pointer;
      transition: color var(--transition), background var(--transition);
    }
    .cal__filter-btn:hover {
      color: var(--text-color);
    }
    .cal__filter-btn--on {
      color: var(--text-color);
      background: var(--bg-light);
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
