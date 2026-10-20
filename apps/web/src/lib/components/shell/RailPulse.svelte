<script lang="ts">
  /**
   * THE PULSE — the rail's second sentence, under the clock.
   *
   *   NOW   free  UNTIL 15h30
   *   NEXT  ÚO SHOW 20h
   *         Teatre Principal
   *         Palma ES · CALL 15h30
   *
   * The clock says when you are; this says what you are in. The truth layer
   * is `$lib/pulse` (pure, `now` injected, no words); this file fetches, and
   * translates the keys it gets back.
   *
   * WHAT COMES NEXT IS A SLIP, the same object the month cell, the board, the
   * diary and the day card draw — with its ground taken away, which is the
   * only thing a rail cannot afford. It is not a copy of the card's type
   * rules: the first version of this block resolved its own name out of
   * `venue_name ?? city ?? title` and drew a production meeting called
   * «Barcelona». ADR-095 §0 had already written down what a second opinion
   * about one card costs.
   *
   * IT NEVER CHANGES HEIGHT WHILE ONE ANSWER IS BEING DRAWN. What has no
   * truth yet draws a dash in the space the answer will take. A block that
   * appears and disappears above the scope list makes the whole rail jump
   * every time a query settles, and the rail is furniture: it must be where
   * it was a second ago.
   *
   * IT NEVER FILTERS BY SCOPE. It sits ABOVE the scope list on purpose: the
   * lens narrows what you are looking at, and this says what is happening to
   * you regardless of where you are looking. What it DOES narrow by is the
   * person axis — you — and only on facts (see $lib/pulse § whose day it is).
   *
   * Calm touches one thing (enmienda a ADR-096 § 5, Marco 2026-10-20): in
   * calm, NEXT names only what is confirmed, by `$lib/calm` (`railNextShows`),
   * the same family the Planner's paper keeps. NOW is a fact about the present
   * and calm leaves it alone. Outside calm, nothing changes.
   */
  import { useQueryClient } from '@tanstack/svelte-query';
  import { dualTime, hourMark, localeDayMonthNear, localeWeekdayShort } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import type { SlipKind } from '$lib/month-events';
  import type { CommitmentState } from '$lib/people';
  import { setCommitment } from '$lib/commitments';
  import { dayKeyInTz } from '$lib/planner';
  import { computePulse, type PulseWord } from '$lib/pulse';
  import { createPulseFeeds, pulseSlip, pulseSlipContext } from '$lib/pulse-feeds.svelte';
  import Slip from '$lib/components/planner/Slip.svelte';
  import { railNextShows } from '$lib/calm';
  import { useCalm } from '$lib/stores/calm.svelte';

  interface Props {
    /** The rail's clock, already ticking on the minute — one timer in the
        shell, not two. Everything here re-derives from it. */
    now: Date;
    locale: Locale;
  }

  let { now, locale }: Props = $props();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let today = $derived(dayKeyInTz(now.toISOString(), viewerTz));

  // The feeds live in $lib/pulse-feeds so the Desk's «lo siguiente» reads
  // the same rows from the same cache (ADR-117).
  const feeds = createPulseFeeds(() => today);
  let personId = $derived(feeds.personId);
  const calm = useCalm();

  let pulse = $derived(
    computePulse(
      {
        performances: feeds.performances,
        dates: feeds.dates,
        viewerTz,
        axis: feeds.axis,
        nextKeeps: (ref) => railNextShows(ref.family, calm.on),
      },
      now,
    ),
  );

  // Nothing has landed yet: draw the frame, claim nothing. «free» is a
  // statement about the day and an empty cache is not one.
  let settled = $derived(feeds.settled);

  const kindLabel = (kind: SlipKind) => t(`planner.kind_${kind}`, locale);

  let slipCtx = $derived(pulseSlipContext(feeds.workspaces, viewerTz, kindLabel));

  let nextSlip = $derived(pulse.next ? pulseSlip(pulse.next.ref, pulse.next.day, slipCtx) : null);

  /** A run-sheet key or a date kind → the words the app already owns.
      `start` has no anchor key of its own; the Desk calls that moment the
      show, and one moment may not have two names. */
  function wordLabel(word: PulseWord): string {
    if (word.of === 'step') {
      const key = word.key === 'load_in' ? 'loadin' : word.key === 'start' ? 'show' : word.key;
      return t(`desk.anchor_${key}`, locale);
    }
    return word.label ?? kindLabel(word.key as SlipKind);
  }

  /** Venue-first, the planner's clock. No viewer gloss on the two margin
      hours: the rail has 13rem, and the slip prints its own gloss already. */
  function hour(iso: string, tz: string | null): string {
    return hourMark(dualTime(iso, tz, viewerTz).primary);
  }

  let doingLabel = $derived(pulse.now.doing ? wordLabel(pulse.now.doing.word) : null);
  let untilLabel = $derived(pulse.now.until ? hour(pulse.now.until.at, pulse.now.until.tz) : null);
  /** Anything but a fact is a claim, and a claim is drawn as one. */
  let nowGuess = $derived(pulse.now.doing ? pulse.now.doing.ref.attribution !== 'explicit' : false);
  let nextGuess = $derived(pulse.next ? pulse.next.ref.attribution !== 'explicit' : false);

  /**
   * ADR-103 — a guess about YOU can be answered from here: «voy» turns it into
   * a fact, «no voy» takes it off your rail. Only an `inferred` row asks: an
   * `unattributed` one is the company's day, not a guess about you.
   */
  const queryClient = useQueryClient();
  let answering = $state(false);
  let canAnswer = $derived(
    Boolean(personId) && pulse.next?.ref.attribution === 'inferred' && !answering,
  );
  async function answer(state: CommitmentState) {
    const next = pulse.next;
    if (!next || !personId) return;
    answering = true;
    try {
      await setCommitment(queryClient, next.ref.of, next.ref.id, personId, state);
    } finally {
      answering = false;
    }
  }

  /** The one fact the slip cannot carry: a gig is ONE instant on the sheet
      (see `performanceSlip`), and the call is the moment before it. */
  let nextCall = $derived(pulse.next?.call ? hour(pulse.next.call, pulse.next.ref.tz) : null);

  /** Another day gets named; today does not — the clock above already did. */
  let nextDay = $derived.by(() => {
    if (!pulse.next || pulse.next.today) return null;
    const days = Math.round(
      (Date.parse(`${pulse.next.day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    return days <= 6
      ? `${localeWeekdayShort(pulse.next.day, locale)} ${Number(pulse.next.day.slice(8, 10))}`
      : localeDayMonthNear(pulse.next.day, today, locale);
  });
</script>

<!-- ONE GRID, not two rows that happen to line up: the label column sizes
     itself to the longest word in whatever language is on, and NOW and NEXT
     cannot drift apart when that word changes. -->
<div class="pulse">
  <span class="pulse__k">{t('pulse.now', locale)}</span>
  <span class="pulse__v">
    {#if !settled}
      <span class="pulse__dash">—</span>
    {:else if doingLabel}
      <span class="pulse__doing" class:guess={nowGuess}>{doingLabel}</span>
    {:else}
      <span class="pulse__doing">{t('pulse.free', locale)}</span>
    {/if}
    {#if untilLabel}
      <span class="pulse__note"
        ><span class="pulse__lab">{t('planner.away_until', locale)}</span> {untilLabel}</span
      >
    {/if}
  </span>

  <span class="pulse__k pulse__k--next">{t('pulse.next', locale)}</span>
  <div class="pulse__next">
    {#if !settled || !nextSlip}
      <span class="pulse__dash">—</span>
    {:else}
      <span class="pulse__slip">
        <Slip
          slip={nextSlip}
          {kindLabel}
          stateLabel={() => null}
          showCountry
          ground="bare"
          placing="cell"
          guess={nextGuess}
        />
      </span>
      {#if nextDay || nextCall}
        <span class="pulse__note">
          {#if nextDay}{nextDay}{/if}{#if nextDay && nextCall}<i class="pulse__sep">·</i>{/if}{#if nextCall}<span
              class="pulse__lab">{t('pulse.call', locale)}</span
            >
            {nextCall}{/if}
        </span>
      {/if}
      {#if canAnswer}
        <span class="pulse__answer">
          <button type="button" class="pulse__btn" onclick={() => answer('going')}
            >{t('pulse.going', locale)}</button
          ><i class="pulse__sep">·</i><button
            type="button"
            class="pulse__btn"
            onclick={() => answer('not_going')}>{t('pulse.not_going', locale)}</button
          >
        </span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .pulse {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: baseline;
    column-gap: var(--space-s);
    padding-inline: var(--space-xs);
  }
  /* The air goes BETWEEN the two sentences, not inside one. */
  .pulse__k--next,
  .pulse__next {
    margin-block-start: var(--space-xs);
    /* AND THE SECOND ROW DOES NOT SIT ON A BASELINE. Every child of this
       grid measured identically in both states and the block still grew two
       pixels when the answer landed — because a baseline-aligned row is as
       tall as its items' baselines make it, and a lone dash puts its first
       baseline nowhere near a slip's 9px head. Top-aligned, the row is the
       height of its tallest item and nothing else, which is the only version
       of it that cannot move. */
    align-self: start;
  }
  /* The rail's own micro-label voice — the same one .side-sec__h and the
     clock's date already speak (uppercase mono, faint, loose). */
  .pulse__k {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .pulse__v {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 var(--space-xs);
    min-inline-size: 0;
    /* Same reserve as the NEXT area, one line of it: a lone dash makes a
       shorter line box than a figure with a margin word beside it, and those
       two pixels were the whole block settling when the answer landed. Stated
       here so the two states share a line-height instead of inheriting two. */
    font-size: var(--text-s);
    line-height: 1.55;
    min-block-size: 1lh;
  }
  .pulse__next {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    /* THE ANSWER'S SPACE IS HELD BEFORE THE ANSWER ARRIVES, so the dash sits
       in it rather than collapsing the block and pulling the scopes up the
       rail while a query lands.

       AND IT IS HELD IN FIXED UNITS, because what it holds is fixed. Measured
       on the deployed runtime at 1024, 1280 and 1600 wide: the slip is 33.94px
       at ALL THREE — its lines are 12 / 13.41 / 9.53 and the type clamps carry
       so little vw that they never move — and the margin line under it (the
       day, the call) adds 10.8. So the ordinary answer is 44.72px, flat.
       A reserve stated in `lh` followed the ELEMENT's font instead, which does
       scale, so it matched at 1600 and fell 4.64px short at 1280: green on the
       machine it was built on, red the first time the spec ran at another
       size. `tests/pulse.spec.ts` is the guard.

       A row that brings an extra line of its own — a venue abroad adds the
       slip's timezone gloss — grows the block. That is content, not settling,
       and the spec says so where it checks.

       THE LINE-HEIGHT IS LOAD-BEARING, not decoration: the slip's city and
       the margin line set no line-height of their own, so they inherit from
       here. Dropping it while «fixing» the reserve let them inherit the
       body's 1.55 and the answer grew from 44.7 to 54.1 — the reserve was
       right and the content had moved under it. Measured, twice.

       AND THE 44.72 ABOVE WAS ONE KIND'S ANSWER, NOT THE TALLEST ONE. It was
       measured on a slip whose name is 11px; a `show` draws its name at 13px
       (Slip § «the gig keeps its step»), so that line is 15.86 and not 13.41.
       The old reserve covered a one-line show by 0.01px and nobody knew,
       because the rail only ever draws the kind that happens to be next.

       On 2026-08-27 it was a show — FiraTàrrega — and THE NAME WRAPPED:
       `.slip__n` clamps at three lines and 13.25rem does not hold a festival's
       name. The rail jumped 72.19 → 88.03 and `tests/pulse.spec.ts` caught it,
       sixteen days after the deploy, because the next thing on file had
       changed. Nothing in the code had.

       So the budget is now STATED rather than hoped for: the rail narrows the
       slip to one line of name and one of city (`--slip-name-lines`), which
       makes the tallest possible answer a show at 12 + 15.86 + 9.53 + 10.8.
       Measured with that clamp on the deployed runtime: 47.03 / 47.17 / 47.23
       at 1024 / 1280 / 1600 — the margin line drifts a little with width, the
       slip does not. 2.95rem is 47.2, still short at 1600 by exactly the kind
       of hair that made this comment necessary. 3rem is 48. */
    font-size: var(--text-s);
    line-height: 1.06;
    min-block-size: 3rem;
  }
  /* The slip is measured, never declared (see Slip's header): the rail is
     its cell, and it gives 13.25rem.

     WHAT THE RAIL DOES DECLARE IS HOW MANY LINES IT CAN AFFORD. Everywhere
     else a long name may wrap — a month cell has three lines for it. Here it
     may not, because this block sits above the scope list and ADR-096 says it
     must not change height when the answer lands. One line each, ellipsis by
     the Slip's own treatment. */
  .pulse__slip {
    container-type: inline-size;
    display: block;
    min-inline-size: 0;
    --slip-name-lines: 1;
    --slip-city-lines: 1;
  }
  /* What you are in — the only figure NOW carries. Mono, because it is read
     as data, and at the same size as the slip's name below it. */
  .pulse__doing {
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--heading-color);
  }
  /* Everything that qualifies a figure — until, call, the day — is margin
     voice: it must never compete with the figure it qualifies. */
  .pulse__note {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    color: var(--text-faint);
    white-space: nowrap;
  }
  /* ONLY THE LABEL SHOUTS. `until` and `call` are labels and go up in caps
     with the rest of the rail's furniture; the hour they introduce is a
     VALUE and keeps the planner's own clock, where the `h` is lowercase and
     part of the number. Uppercasing the whole note turned 11h into 11H. */
  .pulse__lab {
    text-transform: uppercase;
  }
  /* ADR-103 — the answer to a guess speaks in the margin's voice: it is a
     question the rail asks, not a call to action. */
  .pulse__answer {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .pulse__btn {
    all: unset;
    cursor: pointer;
    color: var(--text-muted);
  }
  .pulse__btn:hover {
    color: var(--text-color);
  }
  .pulse__btn:focus-visible {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: var(--focus-offset);
  }
  .pulse__sep {
    font-style: normal;
    margin-inline: 0.35em;
  }
  .pulse__dash {
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--text-faint);
  }
</style>
