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
    /**
     * THE WINDOW'S THREE CONTROLS, and they live in THIS row — before the
     * view words, which is where the design puts them.
     *
     * They step whatever the drawing's window IS (a month, a day, the
     * agenda's start), so the page owns the arithmetic and hands down three
     * verbs. `onNow` moves you to the present in whatever drawing you are in.
     */
    onStepBack: () => void;
    onStepNext: () => void;
    onNow: () => void;
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
    onStepBack,
    onStepNext,
    onNow,
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
  <!-- THE WINDOW'S CONTROLS OPEN THE ROW, before the view words.

       They were up with the title, on the argument that a date you can walk
       through is one object. Marco's own prototype puts them here, and here
       they are also SMALL — 28px squares and a 12px pill — because the thing
       they must not do is compete with the words beside them: those name the
       drawing, these only move the window inside it.

       And the button is `Now`, NOT `Today`. Adjacent to a view called Today,
       the same word at the same weight seventy pixels apart is two different
       acts wearing one label — the one defect in this band that can lose
       somebody their place without telling them why. `Now` moves the window;
       `Today` names a drawing, like Agenda, Month and Board do. -->
  <span class="cal__nav">
    <button
      type="button"
      class="cal__arw"
      aria-label={t('planner.prev_month', locale)}
      onclick={onStepBack}>‹</button
    >
    <button
      type="button"
      class="cal__arw"
      aria-label={t('planner.next_month', locale)}
      onclick={onStepNext}>›</button
    >
  </span>
  <button type="button" class="cal__now" onclick={onNow}>{t('planner.now', locale)}</button>
  <span class="cal__sep" aria-hidden="true"></span>
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
       this one writes. It says WHAT it makes — a bare `+` in a planner is the
       one glyph that could mean anything the app can create — and it sits at
       the row's own height, because a control that outgrows its band starts
       announcing itself instead of waiting to be used. -->
  <button type="button" class="cal__add" onclick={onCreate}
    >＋ <span>{t('planner.date_word', locale)}</span></button
  >
  <Menu
    align="end"
    triggerClass="cal__kebab"
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
    /* ── the window's controls · deliberately the smallest things here ──
       Sizes verbatim from the prototype: 28px squares, 13px glyph; the pill
       at 12px with 5/12 padding. The CORNER is ours and one step tighter than
       the prototype's 8px — `var(--radius)` (6px), the same step the scope bar
       now takes, so the app has one radius for a small control instead of an
       imported literal beside a token. The `VIEW` lead word that used to open
       this row went with them: the nav is what precedes the words in the
       design, and two labels in that slot is one too many. */
    .cal__nav {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .cal__arw {
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
      line-height: 1.1;
      cursor: pointer;
    }
    .cal__now:hover {
      color: var(--text-color);
    }
    /* A hairline, not a gap: the window's controls and the view words are two
       different acts, and eight pixels of air does not say so. */
    .cal__sep {
      inline-size: 1px;
      block-size: 20px;
      background: var(--border-color-light);
      margin-inline: var(--space-2xs);
    }

    /* ── BAND 2 · the view, 21px serif, full ink ────────────────────── */
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
      /* THE LIT WORD KEEPS A STEP OVER ITS SISTERS, and the step is SIZE.
         All four at 21px made the row of controls weigh as much as the date
         above it, and then the only thing saying which drawing you were in
         was a 1.5px rule — the quietest signal on the band carrying the most
         important fact on it.
         21px is the view band's named scale (window 29 · view 21 · meta 9.5),
         so it belongs to the word that is TRUE, not to all four. */
      font-size: 15.5px;
      font-weight: 400;
      line-height: 1.1;
      color: var(--text-faint);
      transition:
        color 0.12s,
        font-size 0.12s;
    }
    .cal__view:hover {
      color: var(--text-muted);
    }
    /* Size and ink, and nothing else. The underline was a third signal for a
       fact already said twice — and a rule under one word in a row of four
       reads as a tab, which is the shape this axis stopped being. */
    .cal__view--on {
      font-size: 21px;
      color: var(--text-color);
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

    /* ── the two on the right, at the row's own height ────────────────
       They were the shared `Button` at size `s` — 44px tall next to a 28px
       arrow, so the loudest objects in the band were the two that do the
       least reading. Same 28px and the same 8px corner as the arrows: one
       row, one height. */
    .cal__add {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      block-size: 28px;
      padding-inline: 11px;
      border: 1px solid var(--text-color);
      border-radius: var(--radius);
      background: var(--text-color);
      color: var(--bg);
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
    }
    .cal__add span {
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .cal__add:hover {
      background: var(--text-muted);
      border-color: var(--text-muted);
    }
    /* The kebab lives inside `Menu`, so it is reached through its
       `triggerClass` and scoped by this row rather than styled globally. */
    .cal__toolbar :global(.cal__kebab) {
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
      line-height: 1;
      cursor: pointer;
    }
    .cal__toolbar :global(.cal__kebab:hover) {
      color: var(--text-color);
      border-color: var(--text-faint);
    }


    /* Agrupa per (ADR-080 §8) — its own row under the toolbar, left-aligned. */

    /* Named projection toggle + Agrupa per — text tabs, active underlined
       (ADR-076: nunca un icono). Lighter than a pill: the word is the tab. */
  }
</style>
