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

  /** The order the design fixes, and the order the keys follow. */
  const VIEW_ORDER = ['day', 'agenda', 'month', 'board'] as const;

  let {
    view,
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

<!-- THE ROW OF VIEWS (ADR-095 § «El encabezado: el título es la fecha»).

     Three bands, three scales, three jobs: the WINDOW is the answer (29px
     serif, up with the title), the VIEW is the drawing (21px serif, full ink),
     and the META is the machine (9.5px mono). The view word keeps A STEP over
     its siblings — knowing which drawing you are in at a glance is worth one
     — and it does not need to be the title to have it.

     THE ORDER NEVER CHANGES WITH THE STATE: Today · Agenda · Month · Board,
     the same order as the keys 1 2 3 4.

     And the dial is METADATA and looks like it: mono, in this row, right
     behind the last view word, with ONE word of grammar — `Board by workspace
     project person`. `by` is a preposition, so the row reads as a SENTENCE
     instead of a form. It was a label («Group by») on a row of its own, which
     is what made nine states of the board look like nine views. -->
<div class="cal__toolbar">
  <span class="cal__viewlead">{t('planner.view_label', locale)}</span>
  <div class="cal__views" role="group" aria-label={t('planner.view_label', locale)}>
    {#each VIEW_ORDER as v (v)}
      <button
        type="button"
        class="cal__view"
        class:cal__view--on={view === v}
        aria-pressed={view === v}
        onclick={() => onSetView(v)}>{t(`planner.view_${v}`, locale)}</button
      >
    {/each}
  </div>

  {#if view === 'board'}
    <span class="cal__dial">
      <span class="cal__dial-by">{t('planner.lanes_label', locale)}</span>
      {#each ['workspace', 'project', 'person'] as const as g (g)}
        <button
          type="button"
          class="cal__dial-v"
          class:cal__dial-v--on={laneAxis === g}
          aria-pressed={laneAxis === g}
          onclick={() => onSetLaneAxis(g)}>{t(`planner.lanes_${g}`, locale)}</button
        >
      {/each}
    </span>
  {/if}

  <div class="cal__spacer"></div>

  <!-- `＋ date` is the one solid thing here: everything else in this row reads,
       this one writes. -->
  <Button size="s" onclick={onCreate} label={t('planner.new_date', locale)}>＋</Button>
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

<style>
  @layer components {
    /* ── BAND 2 · the view, 21px serif, full ink ────────────────────── */
    .cal__viewlead {
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-faint);
      align-self: center;
    }
    .cal__views {
      display: flex;
      align-items: baseline;
      gap: var(--space-m);
    }
    .cal__view {
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
      font-family: var(--font-display);
      /* 21px, named by the design: the view is the middle of three scales —
         window 29 · view 21 · meta 9.5 — and the token nearest it is 19.5,
         which flattens the step the view word is supposed to keep. */
      font-size: 21px;
      font-weight: 400;
      line-height: 1.1;
      color: var(--text-faint);
      transition: color 0.12s;
    }
    .cal__view:hover {
      color: var(--text-muted);
    }
    /* The lit word is a STEP UP, not a different object: full ink and a rule.
       It must not stand out from its siblings by becoming another shape. */
    .cal__view--on {
      color: var(--text-color);
      border-block-end: 1.5px solid var(--text-color);
    }

    /* ── the dial · metadata, and it looks like it ───────────────────── */
    .cal__dial {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
      margin-inline-start: var(--space-m);
      align-self: center;
    }
    .cal__dial-by,
    .cal__dial-v {
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__dial-v {
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
    }
    .cal__dial-v:hover {
      color: var(--text-muted);
    }
    /* Full ink, a rule, and HALF A POINT of size. One point more and a mono
       word in caps stops reading as the same list — it is a qualifier, not a
       title. */
    .cal__dial-v--on {
      font-size: 10.5px;
      color: var(--text-color);
      border-block-end: 1px solid var(--text-color);
    }
    /* Toolbar: ‹ month › · today · [projection] · [lanes] · + · ⋯ */
    .cal__toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      flex-wrap: wrap;
    }
    .cal__spacer {
      flex: 1;
    }


    /* Agrupa per (ADR-080 §8) — its own row under the toolbar, left-aligned. */

    /* Named projection toggle + Agrupa per — text tabs, active underlined
       (ADR-076: nunca un icono). Lighter than a pill: the word is the tab. */
  }
</style>
