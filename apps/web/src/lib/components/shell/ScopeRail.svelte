<script lang="ts">
  /**
   * The rail: the clock (the way home), calm, the pulse, and you at its foot
   * (ADR-140, enmienda del 20-10). Since tarea 132 it holds nothing else: the
   * search and the scope live in the frame's one field (ADR-202 § 12), whose
   * palette lists the saved scopes and the recents. Narrower for it
   * (`--rail-width`).
   *
   * Only beside the page, from 48 rem. On a phone there is no rail since
   * ADR-202 § 10: the clock and calm went to the top bar, the pulse is Hoy's
   * piece, and the sheet that hung from the clock is gone.
   */
  import type { Snippet } from 'svelte';
  import { appLocale, LOCALE_TAG, t } from '$lib/i18n';
  import CalmMark from './CalmMark.svelte';
  import RailPulse from './RailPulse.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';

  interface Props {
    /** THE SHELL'S ONE CLOCK, ticking in the layout: on a phone the same
        time is drawn in the top bar, and two timers could disagree about
        the minute. `clockTime` is its HH:MM, formatted once for both. */
    clockNow: Date;
    clockTime: string;
    /** In Settings the pulse (Ahora / Siguiente) says nothing about what is
        on screen: you came to change one thing, not to plan. */
    inSettings?: boolean;
    /** You, at the foot of the rail (ADR-140, enmienda del 20-10): the
        account menu and the presence, as Linear, Slack or Notion put them.
        The layout owns both, so it hands them in. */
    me?: Snippet;
  }

  let { clockNow, clockTime, inSettings = false, me }: Props = $props();

  // Session locale — feeds both Intl (rail clock) and the dictionary (lens
  // labels). /h is client-only (ssr = false), so navigator is safe at init.
  const locale = appLocale();

  // "dilluns · 13 jul" — CSS mono-caps does the shouting; strip the
  // abbreviation dot some locales append to the short month.
  let clockDate = $derived(
    `${new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: 'long' }).format(clockNow)} · ${clockNow.getDate()} ${new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'short' }).format(clockNow).replace(/\.$/, '')}`,
  );
</script>

<aside id="shell-rail" class="shell__side" aria-label={t('shell.rail_aria', locale)}>
  <div class="side-clock">
    <!-- THE CLOCK IS THE WAY HOME. It took the door the wordmark used to
         hold: «here, now» is already what it says, and a clock you can press
         to get back to the top of the app is a smaller promise than a logo
         that navigates. -->
    <a class="side-clock__now" href="/h/desk" aria-label={t('lens.desk', locale)}>
      <time class="side-clock__time" datetime={clockTime}>{clockTime}</time>
      <p class="side-clock__date">{clockDate}</p>
    </a>
    <!-- Calm and its «i» are one thing at the clock's other end. -->
    <span class="side-calm-row">
      <!-- The mark, the same as the phone's top bar (ADR-202 § 11). -->
      <CalmMark />
      <ConceptHint concept="calm" />
    </span>
  </div>
  <!-- THE PULSE reads the clock's own tick: one timer in the rail, and the
       two can never disagree about what minute it is. It is not filtered by
       the scope — see RailPulse. -->
  {#if !inSettings}
    <RailPulse now={clockNow} {locale} />
  {/if}
  {#if me}
    <div class="side-me">{@render me()}</div>
  {/if}
</aside>

<style>
  /* ── the rail: clock, calm, pulse, you (tarea 132). The scopes it listed
     since Scope v2 live in the frame's field and its palette now. */
  .shell__side {
    inline-size: var(--rail-width);
    display: flex;
    flex-direction: column;
    gap: var(--space-l);
    /* No top padding: the clock block owns the top offset so it can match
       the header's wordmark exactly (see .side-clock). */
    padding-block: 0 var(--space-l);
    padding-inline: var(--space-m);
  }
  /* Only where there is room for it: on a phone there is no rail. */
  @media (max-width: 47.999rem) {
    .shell__side {
      display: none;
    }
  }
  @media (min-width: 48rem) {
    .shell__side {
      border-inline-end: var(--line-hairline) solid var(--border-color-light);
      background: var(--bg-light);
      grid-column: 1;
      grid-row: 1 / -1;
      position: sticky;
      inset-block-start: 0;
      align-self: start;
      z-index: var(--z-sticky);
      min-block-size: 100vh;
    }
  }
  /* The clock takes the rail's whole width and calm sits over its top-right
     corner, beside the time: the date runs on one line underneath, instead
     of folding in the column the button left it. One cell, two layers. */
  .side-clock {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    padding-inline: var(--space-xs);
    /* Same top offset as the header's wordmark, by construction: the
       BrandMark (size m = --text-xl, line-height 1) centers inside the
       --header-height band, so its top sits at (band − type)/2. */
    padding-block-start: calc((var(--header-height) - var(--text-xl)) / 2);
  }
  .side-clock__now {
    grid-area: 1 / 1 / 2 / 3;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    text-decoration: none;
    color: inherit;
  }
  .side-clock__now:hover .side-clock__time {
    color: var(--text-color);
  }
  .side-calm-row {
    grid-area: 1 / 2;
    /* Above the clock's link, which runs under it. */
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
  }
  /* The rail's HH:MM, under the date's line. One step down the scale from
     --text-xl: here the clock states the day, it does not head the page.
     (The phone's clock is the top bar's, in the display face: ADR-202 § 10.) */
  .side-clock__time {
    font-family: var(--font-mono);
    font-size: var(--text-l);
    font-weight: 400;
    line-height: 1;
    letter-spacing: var(--tracking-xs);
    color: var(--heading-color);
  }
  /* One line, always: a locale whose date outgrows the rail is cut, not
     folded. */
  .side-clock__date {
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }

  /* You, at the very foot: the auto margin takes what the clock and the
     pulse leave. Sticky to the bottom of the screen, so a rail longer than
     the screen never pushes the account out of reach; it wears the rail's
     ground to pass over the pulse under it. The monogram lands on the same
     inset as the clock. */
  .side-me {
    display: none;
    margin-block-start: auto;
  }
  @media (min-width: 48rem) {
    .side-me {
      position: sticky;
      inset-block-end: 0;
      display: flex;
      align-items: center;
      gap: var(--space-s);
      padding-block: var(--space-s) var(--space-l);
      padding-inline: var(--space-2xs);
      background: var(--bg-light);
    }
    .shell__side {
      padding-block-end: 0;
    }
  }
</style>
