<script module lang="ts">
  /**
   * THE SEASON (ADR-117) — the Planner's portada. «How is the calendar
   * shaped» over twelve weeks from today, in six blocks: the census in one
   * line, the strip (12 weeks × 7 days in the certainty grammar), what to
   * decide, what is not closed, the holes worth selling, and who is out.
   *
   * Pure presentation, like DecisionBand: the page owns the feeds, the engine
   * ($lib/planner-engine), the scope and the writes, and hands down rows that
   * are already decided. The arithmetic is $lib/season; the words are here.
   *
   * Two rules from ADR-096 §6 and the proposal:
   * · THE HEIGHT NEVER JUMPS. The strip's grid is drawn from the first frame,
   *   and every block keeps its title and a `–` while the feeds load. A block
   *   that appears late reads as «it didn't load».
   * · AN EMPTY BLOCK STAYS, IN ONE LINE. A block that disappears reads the
   *   same as one that failed.
   */

  export type SeasonCellVM = {
    iso: string;
    past: boolean;
    today: boolean;
    /** Short month word when the day is the 1st — the strip's only month mark. */
    monthWord: string | null;
    mark: 'firm' | 'option' | 'date' | null;
    /** Up to two gigs, firm first — the app's one card (`Slip`), placed compact. */
    slips: SlipVM[];
    more: number;
    /** A non-gig date's word (rehearsal, residency…), when that is all there is. */
    dateWord: string | null;
    travel: 'out' | 'back' | null;
    /** On tour — always deduced from two travel legs. */
    tour: boolean;
    /** The company is closed: for sure, or maybe. A person's absence is not
        drawn here (it is in «Fuera»). */
    away: 'firm' | 'tent' | null;
    /** Something «Choques» lists: the only red dot. */
    clash: boolean;
    /** A call between two options that «Por decidir» holds. */
    decide: boolean;
  };

  import type { Slip as SlipVM } from '$lib/month-events';

  export type SeasonUnclosedVM = {
    id: string;
    day: string;
    venue: string;
    city: string | null;
    href: string | null;
    /** i18n keys of what is missing (facts). */
    missing: string[];
    travelGuess: boolean;
    /** Within the next two weeks: the only rows whose gaps take the amber. */
    soon: boolean;
  };

  export type SeasonGapVM = {
    from: string;
    to: string;
    nights: number;
    /** Who is out on some of these nights: a hole with a performer away is
        not a hole you can sell as it is (uso #9). */
    away: Array<{ key: string; who: string; from: string; to: string; tentative: boolean }>;
  };

  export type SeasonAwayVM = {
    key: string;
    from: string;
    to: string;
    who: string;
    /** A second word: the note of an absence, the place of a tour. */
    what: string | null;
    tentative: boolean;
    /** Deduced (a tour from its legs): the inference voice. */
    guess: boolean;
    legs: string | null;
  };

  export type SeasonClashVM = { key: string; day: string; title: string; body: string };

  export type SeasonFactsVM = {
    perfs: number;
    confirmed: number;
    holds: number;
    clashes: number;
    unclosed: number;
    free: number;
  };
</script>

<script lang="ts">
  import { localeDayMonth, localeWeekdayShort } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { isoWeek } from '$lib/planner';
  import Slip from '$lib/components/planner/Slip.svelte';
  import DecisionBand, {
    type ConcurrenceVM,
    type DecisionVM,
  } from '$lib/components/planner/DecisionBand.svelte';
  import { GAP_MIN_NIGHTS, SEASON_WEEKS, UNCLOSED_WEEKS } from '$lib/season';

  interface Props {
    locale: Locale;
    localeTag: string;
    /** Feeds still in flight: every number and list shows a `–`. */
    loading: boolean;
    facts: SeasonFactsVM;
    weeks: SeasonCellVM[][];
    decisions: DecisionVM[];
    concurrences: ConcurrenceVM[];
    /** The decisions feed is absent (pre-migration DB): the block is not drawn. */
    decisionsAbsent: boolean;
    clashes: SeasonClashVM[];
    unclosed: SeasonUnclosedVM[];
    /** Confirmed gigs in the «sin cerrar» horizon — the denominator. */
    firmAhead: number;
    gaps: SeasonGapVM[];
    away: SeasonAwayVM[];
    pendingId: string | null;
    onConfirm: (perfId: string) => void;
    onDay: (iso: string) => void;
    onWeek: (monday: string) => void;
    onGap: (iso: string) => void;
    onCreate: () => void;
  }

  let {
    locale,
    localeTag,
    loading,
    facts,
    weeks,
    decisions,
    concurrences,
    decisionsAbsent,
    clashes,
    unclosed,
    firmAhead,
    gaps,
    away,
    pendingId,
    onConfirm,
    onDay,
    onWeek,
    onGap,
    onCreate,
  }: Props = $props();

  const DASH = '–';
  /** Monday-first narrow weekday letters, in the reader's language. */
  let dows = $derived.by(() => {
    const fmt = new Intl.DateTimeFormat(localeTag, { weekday: 'narrow', timeZone: 'UTC' });
    // 2026-10-12 is a Monday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 9, 12 + i))));
  });

  let empty = $derived(
    !loading && weeks.every((w) => w.every((c) => c.past || (c.mark === null && !c.travel))),
  );

  function range(from: string, to: string): string {
    return from === to
      ? localeDayMonth(from, localeTag)
      : `${localeDayMonth(from, localeTag)} → ${localeDayMonth(to, localeTag)}`;
  }
  /** «vie 16 oct» — a row's day needs its date, not only its weekday. */
  function day(iso: string): string {
    return `${localeWeekdayShort(iso, localeTag)} ${localeDayMonth(iso, localeTag)}`;
  }
  /** Rows that are on the list only for the trip guess: they do not count as
      «sin cerrar», and the head says so instead of the list disagreeing with
      it (uso #14: «2 de 6» over four rows). */
  let travelOnly = $derived(unclosed.filter((u) => u.missing.length === 0 && u.travelGuess).length);
  function n(v: number): string {
    return loading ? DASH : String(v);
  }
</script>

<div class="ov">
  <!-- 1 · THE CENSUS lives in the head's window line (the page), in the one
       strip and the one style every drawing counts in. -->
  <div class="ov__grid">
    <!-- 2 · THE STRIP. Drawn from the first frame, empty, so nothing below
         it moves when the rows arrive. -->
    <section class="blk ov__strip" aria-label={t('planner.season_strip', locale, { n: SEASON_WEEKS })}>
      <div class="blk__h">
        <h2 class="blk__t">{t('planner.season_strip', locale, { n: SEASON_WEEKS })}</h2>
      </div>
      <div class="strip">
        <div class="strip__row strip__dow" aria-hidden="true">
          <span></span>
          {#each dows as d, i (i)}<span>{d}</span>{/each}
        </div>
        {#each weeks as week (week[0].iso)}
          <div class="strip__row">
            <button
              type="button"
              class="wk"
              title={t('planner.season_open_month', locale)}
              onclick={() => onWeek(week[0].iso)}
              >{t('planner.season_week_short', locale)}{isoWeek(week[0].iso)}<b
                >{localeDayMonth(week[0].iso, localeTag)}</b
              ></button
            >
            {#each week as c (c.iso)}
              <button
                type="button"
                class="d"
                class:d--past={c.past}
                class:d--today={c.today}
                class:d--away={c.away === 'firm'}
                class:d--away-tent={c.away === 'tent'}
                data-day={c.iso}
                data-mark={c.mark ?? ''}
                title={day(c.iso)}
                onclick={() => onDay(c.iso)}
              >
                <span class="d__n">{Number(c.iso.slice(8))}{#if c.monthWord}<i>{c.monthWord}</i>{/if}</span>
                {#each c.slips as sl (sl.id)}
                  <Slip slip={sl} placing="compact" kindLabel={() => ''} stateLabel={() => null} />
                {/each}
                {#if c.more > 0}<span class="ev__more">+{c.more}</span>{/if}
                {#if c.slips.length === 0 && c.dateWord}<span class="ev ev--date">{c.dateWord}</span>{/if}
                {#if c.travel}<span class="d__travel" aria-hidden="true">{c.travel === 'out' ? '↗' : '↙'}</span>{/if}
                {#if c.clash}<span class="d__clash" title={t('planner.season_key_clash', locale)}></span>{/if}
                {#if c.decide}<span class="d__decide" class:d__decide--beside={c.clash} title={t('planner.season_key_decide', locale)}></span>{/if}
                {#if c.tour}<span class="d__tour" title={t('planner.season_key_tour', locale)}></span>{/if}
              </button>
            {/each}
          </div>
        {/each}
      </div>
      <p class="strip__key">
        <span><i class="k k--firm"></i>{t('planner.season_key_firm', locale)}</span>
        <span><i class="k k--option grain"></i>{t('planner.season_key_option', locale)}</span>
        <span class="guess"><i class="k k--tour"></i>{t('planner.season_key_tour', locale)}</span>
        <span><i class="k k--away"></i>{t('planner.season_key_away', locale)}</span>
        <span><i class="k k--decide"></i>{t('planner.season_key_decide', locale)}</span>
        <span><i class="k k--clash"></i>{t('planner.season_key_clash', locale)}</span>
      </p>
      {#if empty}
        <p class="blk__empty">
          {t('planner.season_empty', locale, { n: SEASON_WEEKS })}
          <button type="button" class="ov__add" onclick={onCreate}>＋ {t('planner.date_word', locale)}</button>
        </p>
      {/if}
    </section>

    <!-- 3 · TO DECIDE — the queue OPEN, deciding in place (ADR-095 §6: an act
         is exercised where you are looking). Then the clashes that are not a
         choice between two holds. -->
    {#if !decisionsAbsent}
      <section class="blk ov__decide">
        <div class="blk__h">
          <h2 class="blk__t">{t('planner.season_b_decide', locale)}</h2>
          <span class="blk__n" class:ov__red={decisions.length > 0}>{n(decisions.length)}</span>
        </div>
        {#if loading}
          <p class="blk__empty">{DASH}</p>
        {:else if decisions.length === 0 && concurrences.length === 0}
          <p class="blk__empty">{t('planner.season_none_decide', locale)}</p>
        {:else}
          <DecisionBand
            {decisions}
            {concurrences}
            open={true}
            {onConfirm}
            onJump={onDay}
            {pendingId}
            {locale}
            {localeTag}
            id="season-decisions"
          />
        {/if}
        <div class="blk__h">
          <h2 class="blk__t">{t('planner.season_b_clashes', locale)}</h2>
          <span class="blk__n" class:ov__red={clashes.length > 0}>{n(clashes.length)}</span>
        </div>
        {#if loading}
          <p class="blk__empty">{DASH}</p>
        {:else if clashes.length === 0}
          <p class="blk__empty">{t('planner.season_none_clashes', locale)}</p>
        {:else}
          {#each clashes as c (c.key)}
            <button type="button" class="row" onclick={() => onDay(c.day)}>
              <span class="row__when">{day(c.day)}</span>
              <span class="row__what row__what--sans">{c.body}</span>
            </button>
          {/each}
        {/if}
      </section>
    {/if}

    <div class="ov__lists">
      <!-- 4 · NOT CLOSED — confirmed, and something is still empty. Facts as
           chips; the trip is a guess and says so in the inference voice. -->
      <section class="blk">
        <div class="blk__h">
          <h2 class="blk__t">{t('planner.season_b_unclosed', locale)}</h2>
          <span class="blk__n"
            >{loading
              ? DASH
              : t('planner.season_unclosed_meta', locale, {
                  n: facts.unclosed,
                  m: firmAhead,
                  w: UNCLOSED_WEEKS,
                }) + (travelOnly > 0 ? ` · ${t('planner.season_unclosed_guess', locale, { n: travelOnly })}` : '')}</span
          >
        </div>
        {#if loading}
          <p class="blk__empty">{DASH}</p>
        {:else if unclosed.length === 0}
          <p class="blk__empty">{t('planner.season_none_unclosed', locale, { n: UNCLOSED_WEEKS })}</p>
        {:else}
          {#each unclosed as u (u.id)}
            <a class="row" class:row--soon={u.soon} href={u.href ?? undefined} data-perf={u.id}>
              <span class="row__when">{day(u.day)}</span>
              <span class="row__what">{u.venue}{#if u.city}<small>{u.city}</small>{/if}</span>
              <span class="row__miss">
                {#each u.missing as m (m)}<span class="miss">{t(m, locale)}</span>{/each}
                {#if u.travelGuess}<span class="miss miss--guess guess">{t('planner.season_miss_travel', locale)}</span>{/if}
              </span>
            </a>
          {/each}
        {/if}
      </section>

      <!-- 5 · HOLES — free runs of three nights or more, to sell. -->
      <section class="blk">
        <div class="blk__h">
          <h2 class="blk__t">{t('planner.season_b_gaps', locale)}</h2>
          <span class="blk__n">{t('planner.season_gaps_meta', locale, { n: GAP_MIN_NIGHTS })}</span>
        </div>
        {#if loading}
          <p class="blk__empty">{DASH}</p>
        {:else if gaps.length === 0}
          <p class="blk__empty">{t('planner.season_none_gaps', locale, { n: GAP_MIN_NIGHTS })}</p>
        {:else}
          {#each gaps as g (g.from)}
            <button type="button" class="row" onclick={() => onGap(g.from)}>
              <span class="row__when">{range(g.from, g.to)}</span>
              <span class="row__what">{t('planner.season_nights', locale, { n: g.nights })}</span>
              {#each g.away as a (a.key)}
                <span class="row__note" class:guess={a.tentative}
                  >{t(a.tentative ? 'planner.season_gap_away_t' : 'planner.season_gap_away', locale, {
                    who: a.who,
                    when: range(a.from, a.to),
                  })}</span
                >
              {/each}
            </button>
          {/each}
        {/if}
      </section>

      <!-- 6 · OUT — absences and tours that touch the twelve weeks. -->
      <section class="blk">
        <div class="blk__h">
          <h2 class="blk__t">{t('planner.season_b_away', locale)}</h2>
        </div>
        {#if loading}
          <p class="blk__empty">{DASH}</p>
        {:else if away.length === 0}
          <p class="blk__empty">{t('planner.season_none_away', locale)}</p>
        {:else}
          {#each away as a (a.key)}
            <button type="button" class="row" onclick={() => onDay(a.from)}>
              <span class="row__when">{range(a.from, a.to)}</span>
              <span class="row__what" class:row__what--tent={a.tentative}
                >{a.who}{#if a.tentative}?{/if}{#if a.what}<small>{a.what}</small>{/if}{#if a.legs}<small class="guess"
                    >{a.legs}</small
                  >{/if}</span
              >
            </button>
          {/each}
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  @layer components {
    .ov {
      container-type: inline-size;
      display: grid;
      gap: var(--space-m);
      margin-block-start: var(--space-s);
    }
    .ov__red {
      color: var(--danger-semi-dark);
    }
    .ov__grid {
      display: grid;
      gap: var(--space-l);
      grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
      grid-template-areas: 'strip decide' 'lists lists';
      align-items: start;
    }
    .ov__strip {
      grid-area: strip;
    }
    .ov__decide {
      grid-area: decide;
    }
    .ov__lists {
      grid-area: lists;
      display: grid;
      gap: var(--space-l);
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: start;
    }

    .blk {
      display: grid;
      gap: var(--space-xs);
      align-content: start;
      min-width: 0;
    }
    .blk__h {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      border-block-end: 1px solid color-mix(in oklch, var(--text-color) 12%, transparent);
      padding-block-end: 4px;
    }
    .blk__h:not(:first-child) {
      margin-block-start: var(--space-s);
    }
    .blk__t {
      font-family: var(--font-mono);
      font-size: 9.5px;
      font-weight: 400;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-color);
      margin: 0;
    }
    .blk__n {
      font-family: var(--font-mono);
      font-size: 9.5px;
      color: var(--text-muted);
    }
    .blk__empty {
      font-size: var(--text-s);
      color: var(--text-muted);
      margin: 0;
    }
    .ov__add {
      font: inherit;
      color: var(--text-color);
      background: none;
      border: 0;
      padding: 0;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }

    /* ── The strip ──────────────────────────────────────────────────── */
    .strip {
      display: grid;
      gap: 3px;
    }
    .strip__row {
      display: grid;
      grid-template-columns: 4.2rem repeat(7, minmax(0, 1fr));
      gap: 3px;
    }
    .strip__dow span {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding-inline-start: 4px;
    }
    .wk {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
      text-align: start;
      align-self: center;
      line-height: 1.2;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
    }
    .wk b {
      color: var(--text-color);
      font-weight: 500;
      display: block;
    }
    .d {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      align-items: stretch;
      min-height: 3.4rem;
      min-width: 0;
      padding: 3px 4px 6px;
      text-align: start;
      font: inherit;
      color: inherit;
      background: color-mix(in oklch, var(--text-color) 3%, transparent);
      border: 0;
      border-radius: 2px;
      cursor: pointer;
      overflow: hidden;
    }
    .d:hover {
      background: color-mix(in oklch, var(--text-color) 7%, transparent);
    }
    .d--past {
      opacity: 0.45;
    }
    .d--away {
      background-image: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--text-color) 9%, transparent) 0 1px,
        transparent 1px 5px
      );
    }
    /* A maybe closes the company more faintly, and dashed: the geometry of
       doubt, like the option's edge. */
    .d--away-tent {
      background-image: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--text-color) 7%, transparent) 0 1px,
        transparent 1px 8px
      );
    }
    .d__n {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
    }
    .d__n i {
      font-style: normal;
      margin-inline-start: 3px;
      color: var(--text-color);
    }
    .d--today {
      background-color: var(--today-wash);
    }
    .d--today .d__n {
      color: var(--today-ink);
      font-weight: var(--today-weight);
    }
    .ev {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 10.5px;
      line-height: 1.15;
      border-radius: 2px;
      padding: 1px 3px;
      min-width: 0;
      white-space: nowrap;
    }
    .ev--date {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
      padding-inline: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ev__more {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
    }
    .d__travel {
      position: absolute;
      inset-block-start: 2px;
      inset-inline-end: 12px;
      font-size: 10px;
      color: var(--text-muted);
    }
    .d__clash {
      position: absolute;
      inset-block-start: 4px;
      inset-inline-end: 4px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--danger);
    }
    /* A call to make, not a collision: the dot's outline, in ink. Red stays
       for what «Choques» counts. */
    .d__decide {
      position: absolute;
      inset-block-start: 4px;
      inset-inline-end: 4px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      border: 1px solid var(--text-muted);
    }
    .d__decide--beside {
      inset-inline-end: 12px;
    }
    .d__tour {
      position: absolute;
      inset-inline: 0;
      inset-block-end: 0;
      height: 3px;
      /* Always deduced from two travel legs: the dotted rule is the voice of
         a guess in a box too narrow for italics. */
      background: repeating-linear-gradient(
        90deg,
        color-mix(in oklch, var(--text-color) 45%, transparent) 0 4px,
        transparent 4px 6px
      );
    }
    .strip__key {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      font-size: var(--text-xs);
      color: var(--text-muted);
      margin: 4px 0 0;
    }
    .k {
      display: inline-block;
      width: 14px;
      height: 9px;
      vertical-align: -1px;
      margin-inline-end: 4px;
      border-radius: 2px;
    }
    /* The key draws the slip's own edges and paper (Slip.svelte § certainty). */
    .k--firm {
      background: var(--bg-ultra-light);
      border: 1px solid color-mix(in oklch, var(--text-color) 15%, var(--border-color-light));
    }
    .k--option {
      background: var(--bg-ultra-light);
      border: 1px dashed color-mix(in oklch, var(--text-color) 13%, var(--border-color-light));
    }
    .k--tour {
      height: 3px;
      vertical-align: 2px;
      background: repeating-linear-gradient(
        90deg,
        color-mix(in oklch, var(--text-color) 45%, transparent) 0 4px,
        transparent 4px 6px
      );
    }
    .k--away {
      background-image: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--text-color) 30%, transparent) 0 1px,
        transparent 1px 4px
      );
    }
    .k--decide {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      border: 1px solid var(--text-muted);
      vertical-align: 1px;
    }
    .k--clash {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--danger);
      vertical-align: 1px;
    }

    /* ── Lists ──────────────────────────────────────────────────────── */
    .row {
      display: grid;
      grid-template-columns: 5.4rem minmax(0, 1fr);
      gap: 2px var(--space-s);
      padding-block: 5px;
      text-decoration: none;
      color: inherit;
      font: inherit;
      text-align: start;
      background: none;
      border: 0;
      border-block-end: 1px solid color-mix(in oklch, var(--text-color) 6%, transparent);
      cursor: pointer;
      width: 100%;
    }
    .row:hover .row__what {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .row__when {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      padding-block-start: 2px;
    }
    .row__what {
      font-family: var(--font-display);
      font-size: var(--text-m);
      min-width: 0;
    }
    .row__what--sans {
      font-family: var(--font-sans);
      font-size: var(--text-s);
    }
    .row__what--tent {
      color: var(--text-muted);
      font-style: italic;
    }
    .row__what small {
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--text-muted);
      margin-inline-start: 6px;
    }
    .row__note {
      grid-column: 2;
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }
    .row__miss {
      grid-column: 2;
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    /* MUTED BY DEFAULT (diseño B8): «hotel», «técnica» on every row in
       amber made the least urgent thing the loudest on the page. The amber is
       kept for what falls in the next two weeks, where a missing hotel is a
       call to make today. */
    .miss {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      border: 1px solid color-mix(in oklch, var(--text-color) 18%, transparent);
      border-radius: 2px;
      padding: 0 4px;
    }
    .row--soon .miss:not(.miss--guess) {
      color: var(--warning-dark);
      border-color: color-mix(in oklch, var(--warning) 45%, transparent);
    }
    .miss--guess {
      color: var(--text-muted);
      border-style: dotted;
      border-color: color-mix(in oklch, var(--text-color) 30%, transparent);
    }

    /* ── Narrow: one column, the queue above the strip (the thumb's job),
       the strip as marks only. Measured on the ELEMENT (ADR-095 §8). ─── */
    @container (max-width: 640px) {
      .ov__grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: 'decide' 'strip' 'lists';
      }
      .ov__lists {
        grid-template-columns: minmax(0, 1fr);
      }
      .strip__row {
        grid-template-columns: 2.2rem repeat(7, minmax(0, 1fr));
        gap: 2px;
      }
      .wk b {
        display: none;
      }
      .d {
        min-height: 2.2rem;
        padding: 2px 2px 5px;
      }
      .d :global(.slip) {
        padding: 0;
        height: 8px;
      }
      .d :global(.slip > *),
      .ev__more,
      .ev--date,
      .d__travel {
        display: none;
      }
    }
    @container (min-width: 641px) and (max-width: 900px) {
      .ov__grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: 'strip' 'decide' 'lists';
      }
    }
  }
</style>
