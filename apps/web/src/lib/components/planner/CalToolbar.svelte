<script lang="ts">
  /**
   * Planner toolbar — [views] · [lanes] · + · ⋯ (the window's ‹ › Now ride
   * with the title, CalNav, ADR-136),
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
    /** Blackout entry points hide while availability/team feeds are absent. */
    canBlackout: boolean;
    locale: Locale;
    onSetView: (v: PlannerView) => void;
    onSetLaneAxis: (g: LaneAxis) => void;
    /** Absent: whoever looks cannot write the plan (`/api/performances/access`). */
    onCreate?: () => void;
    /** Absent: no space on screen publishes a calendar feed for them. */
    onFeed?: () => void;
    /** «reading the marks» — the grammar key, one door for all four views. */
    onReadMarks: () => void;
    onBlackout: () => void;
  }

  /** The order the design fixes, and the order the keys follow. The season
      overview (ADR-117) is the portada, so it opens the row. */
  const VIEW_ORDER = ['overview', 'day', 'agenda', 'month', 'board'] as const;

  let {
    view,
    laneAxis,
    canBlackout,
    locale,
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
     behind the last view word, with ONE word of grammar — `Board by scope
     person`. `by` is a preposition, so the row reads as a SENTENCE instead
     of a form. It was a label («Group by») on a row of its own, which is
     what made nine states of the board look like nine views. Two values now,
     not three (ADR-094): workspace and project were both «a thing you
     booked», and the scope bar already owns how many of those you see. -->
<div class="cal__toolbar">
  <!-- THE VIEW WORDS OPEN THE ROW, in all five drawings (ADR-136). The
       window's controls went up beside the title they move, so nothing here
       is reserved for a drawing that has no window: the Season's row starts
       where every other row starts. -->
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
      {#each ['scope', 'person'] as const as g (g)}
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
  {#if onCreate}
    <button type="button" class="cal__add" onclick={onCreate}
      >＋ <span>{t('planner.date_word', locale)}</span></button
    >
  {/if}
  <Menu
    align="end"
    triggerClass="cal__kebab"
    label={t('planner.more', locale)}
    items={[
      { label: t('planner.read_marks', locale), onclick: onReadMarks },
      ...(onFeed ? [{ label: t('planner.feed', locale), onclick: onFeed }] : []),
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
    /* A finger's target on touch (móvil #5): 28px squares and 17px words
       were under half of it. */
    .cal__add,
    .cal__view,
    .cal__dial-v,
    .cal__toolbar :global(.cal__kebab) {
      min-block-size: var(--touch-target);
    }
    .cal__toolbar :global(.cal__kebab) {
      min-inline-size: var(--touch-target);
    }
    @media (max-width: 47.999rem) {
      /* TWO ROWS, NOT THREE (móvil #4): the words that name the drawing take
         the first row; the two acts the second. */
      .cal__views {
        order: -1;
        flex-basis: 100%;
      }
    }

    /* ── BAND 2 · the view, 21px serif, full ink ────────────────────── */
    .cal__views {
      display: flex;
      align-items: baseline;
      gap: var(--space-m);
      /* …so the dial beside it has a baseline to meet. */
      align-self: baseline;
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
      font-size: var(--text-m);
      font-weight: 400;
      line-height: 1.1;
      color: var(--text-faint);
      transition:
        color var(--duration-fast),
        font-size var(--duration-fast);
    }
    .cal__view:hover {
      color: var(--text-muted);
    }
    /* Size and ink, and nothing else. The underline was a third signal for a
       fact already said twice — and a rule under one word in a row of four
       reads as a tab, which is the shape this axis stopped being. */
    .cal__view--on {
      font-size: var(--text-l);
      color: var(--text-color);
    }

    /* ── the dial · metadata, and it looks like it ───────────────────── */
    /* ONE SENTENCE, ON ONE BASELINE. The dial was centred on the row while
       the view words sat on their own baseline, so a 9.5px mono phrase
       floated in the middle of a 21px serif line — two objects on one row
       instead of `Board by workspace project person` read straight through.
       And it stood `--space-m` away from the last word, which is the gap
       BETWEEN the four view words: the dial is not a fifth view, so it must
       be nearer than they are to each other, not the same distance — and
       nearer than a word space, because `Board by …` is one phrase and the
       four words are a list. */
    .cal__dial {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
      /* THE TOOLBAR'S OWN GAP IS CANCELLED FIRST. `.cal__toolbar` puts
         `--space-s` between every child, so a margin here ADDS to it — the
         dial ended up 17px from the last word against the 18px that separates
         the words themselves, which is the one distance it must not have.
         Subtracting the row's gap makes this declaration the whole answer:
         the phrase closes at `--space-xs`, a third of the list's spacing. */
      margin-inline-start: calc(var(--space-xs) - var(--space-s));
      align-self: baseline;
    }
    .cal__dial-by,
    .cal__dial-v {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
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
      font-size: var(--text-xs);
      color: var(--text-color);
      border-block-end: var(--line-hairline) solid var(--text-color);
    }
    /* Toolbar: ‹ month › · today · [projection] · [lanes] · + · ⋯ */
    /* ── THE BAR DOES NOT LIVE IN THE DOCUMENT (2026-08-03) ──────────────
       On a diary of months, changing the drawing meant scrolling back to
       wherever this row had gone — and the head of the book used to load
       history as you approached it, so the journey grew while you made it.
       These controls are chrome, not content: they stick under the shell's
       top bar and are simply always there. Translucency + blur is the
       shell's own voice for a stuck band (.shell__top, .shell__address). */
    .cal__toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      flex-wrap: wrap;
      position: sticky;
      inset-block-start: var(--header-height);
      z-index: calc(var(--z-sticky) - 1);
      background: color-mix(in oklch, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px);
      padding-block: var(--space-2xs);
      container-type: scroll-state;
    }
    /* The hairline only WHEN stuck — at rest it would draw a rule the
       three-band head does not have. `scroll-state` is a progressive
       enhancement: without it the blur stays the only seam. */
    .cal__toolbar::after {
      content: '';
      position: absolute;
      inset-inline: 0;
      inset-block-end: 0;
      block-size: var(--line-hairline);
      background: var(--border-color-light);
      opacity: 0;
      transition: opacity var(--transition);
    }
    @container scroll-state(stuck: block-start) {
      .cal__toolbar::after {
        opacity: 1;
      }
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
      gap: var(--space-xs);
      block-size: var(--control-size-xs);
      padding-inline: var(--space-s);
      border: var(--line-hairline) solid var(--text-color);
      border-radius: var(--radius);
      background: var(--text-color);
      color: var(--bg);
      font-size: var(--text-s);
      line-height: 1;
      cursor: pointer;
    }
    .cal__add span {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
    }
    .cal__add:hover {
      background: var(--text-muted);
      border-color: var(--text-muted);
    }
    /* The kebab lives inside `Menu`, so it is reached through its
       `triggerClass` and scoped by this row rather than styled globally. */
    .cal__toolbar :global(.cal__kebab) {
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
