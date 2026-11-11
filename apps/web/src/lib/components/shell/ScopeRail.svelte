<script lang="ts">
  /**
   * The rail: the clock (the way home), calm, the pulse, and you at its foot
   * (ADR-140, enmienda del 20-10). Since tarea 132 it holds nothing else: the
   * search lives in the top bar (ADR-178) and the scope only in each lens's
   * pill (ADR-152), which now also keeps the saved scopes and the recents
   * that used to be listed here, with «∑ Todo». Narrower for it
   * (`--rail-width`).
   */
  import type { Snippet } from 'svelte';
  import { appLocale, LOCALE_TAG, t } from '$lib/i18n';
  import { useCalm } from '$lib/stores/calm.svelte';
  import RailPulse from './RailPulse.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';

  interface Props {
    /** On a phone the rail is a drawer (base.css § Drawer) and the layout
        owns whether it is out: the menu button lives in the top bar. On a
        desktop this changes nothing — the rail is always there. */
    open?: boolean;
    onclose?: () => void;
    /** THE SHELL'S ONE CLOCK, ticking in the layout: on a phone the same
        time is drawn in the top bar as the door to this drawer, and two
        timers could disagree about the minute. `clockTime` is its HH:MM,
        formatted once for both faces. */
    clockNow: Date;
    clockTime: string;
    /** In Settings the pulse (Ahora / Siguiente) says nothing about what is
        on screen: you came to change one thing, not to plan. */
    inSettings?: boolean;
    /** You, at the foot of the rail (ADR-140, enmienda del 20-10): the
        account menu and the presence, as Linear, Slack or Notion put them.
        The layout owns both, so it hands them in. A phone does not draw it
        here: there the rail is a drawer, and you stay in the top bar. */
    me?: Snippet;
  }

  let { open = false, onclose, clockNow, clockTime, inSettings = false, me }: Props = $props();

  const calm = useCalm();

  // Session locale — feeds both Intl (rail clock) and the dictionary (lens
  // labels). /h is client-only (ssr = false), so navigator is safe at init.
  const locale = appLocale();

  // "dilluns · 13 jul" — CSS mono-caps does the shouting; strip the
  // abbreviation dot some locales append to the short month.
  let clockDate = $derived(
    `${new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: 'long' }).format(clockNow)} · ${clockNow.getDate()} ${new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'short' }).format(clockNow).replace(/\.$/, '')}`,
  );
</script>

{#if open}
  <button
    type="button"
    class="drawer__backdrop"
    aria-label={t('shell.menu_close', locale)}
    onclick={() => onclose?.()}
  ></button>
{/if}
<aside id="shell-rail" class="shell__side drawer" data-open={open || undefined} aria-label={t('shell.rail_aria', locale)}>
  <div class="side-clock">
    <!-- THE CLOCK IS THE WAY HOME. It took the door the wordmark used to
         hold: «here, now» is already what it says, and a clock you can press
         to get back to the top of the app is a smaller promise than a logo
         that navigates. -->
    <a class="side-clock__now" href="/h/desk" aria-label={t('lens.desk', locale)}>
      <time class="side-clock__time clock-face" datetime={clockTime}>{clockTime}</time>
      <p class="side-clock__date">{clockDate}</p>
    </a>
    <!-- Calm and its «i» are one thing at the clock's other end. -->
    <span class="side-calm-row">
      <button
        type="button"
        class="side-calm"
        class:is-on={calm.on}
        aria-pressed={calm.on}
        title={t('desk.calm', locale)}
        aria-keyshortcuts="C"
        onclick={() => calm.toggle()}
      >
        <!-- The key is a hint for the eye; its name stays «calma», not «calmaC». -->
        <span>{t('desk.calm', locale)}</span><span class="keys" aria-hidden="true"><span class="side-calm__k">C</span></span>
      </button>
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
     since Scope v2 live in the lens's pill now. */
  .shell__side {
    inline-size: var(--rail-width);
    display: flex;
    flex-direction: column;
    gap: var(--space-l);
    /* No top padding: the clock block owns the top offset so it can match
       the header's wordmark exactly (see .side-clock). */
    padding-block: 0 var(--space-l);
    padding-inline: var(--space-m);
    border-inline-end: var(--line-hairline) solid var(--border-color-light);
    background: var(--bg-light);
  }
  /* In the flow only where there is room for it. Below 48rem `.drawer`
     (base.css) places it instead: off-canvas until the menu opens it. These
     are the only rules the two places disagree on, so they are the only
     ones fenced — everything inside the rail draws the same in both. */
  @media (min-width: 48rem) {
    .shell__side {
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
  /* Calm toggle — the mode control lives by the clock (spec § Desk · Calm).
     outline = available / a firmer stroke = active, so it reads as a control. */
  .side-calm {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    /* NO FILL WHEN IT IS OFF (Marco, 2026-07-31). The outline alone says
       «available»; a fill on a control that is not doing anything reads as a
       state. `.is-on` takes only the rail's soft selected ground. */
    background: none;
    /* Desk lens button shape (sans, --space-2xs/--space-m, radius-circle) but
       a micro-label one step under the smallest named step — 9px is the
       Planner's own margin voice, and this is furniture beside a clock. */
    font-family: var(--font-sans);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-s);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
  }
  .side-calm-row {
    grid-area: 1 / 2;
    /* Above the clock's link, which runs under it. */
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .side-calm:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
  /* ON IS A SOFT STROKE, NOT A BLACK PILL (ADR-139 § 5): the switch to
     quiet must not be the loudest mark on the rail. The edge firms up, the
     word takes ink, and the ground is the rail's own selected scope's
     (`.srow.is-on`). The mode shows in the page's composition, not here. */
  .side-calm.is-on {
    background: var(--bg-ultra-light);
    border-color: var(--text-muted);
    color: var(--text-color);
  }
  .side-calm.is-on .side-calm__k {
    opacity: 1;
  }
  .side-calm__k {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.35em;
    block-size: 1.35em;
    border: var(--line-hairline) solid currentColor;
    border-radius: var(--radius-s);
    /* The key stays mono even though the label is now sans. */
    font-family: var(--font-mono);
    font-size: 0.85em;
    opacity: 0.6;
    text-transform: none;
  }
  /* The face itself is `.clock-face` (base.css): the top bar draws the same
     time on a phone, and one face cannot have two type rules. */
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
