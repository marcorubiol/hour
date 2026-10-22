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
   *   and every block keeps its title, a `–` for its figure and the
   *   dashboards' one skeleton (`.ghost-line`) for its rows while the feeds
   *   load (ADR-130 § 3). A block that appears late reads as «it didn't load».
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
    /** Next steps that wait on the day (ADR-138 § 6): a number, never a card.
        The cell is already the door to the Day. */
    steps?: number;
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
  import { localeDayMonth, localeWeekdayShort, weekdayLabels } from '$lib/datetime';
  import { DASH } from '$lib/glyphs';
  import { t, type Locale } from '$lib/i18n';
  import { isoWeek } from '$lib/planner';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import CalmLine from '$lib/components/CalmLine.svelte';
  import { shows } from '$lib/calm';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import FirstTimeNote from '$lib/components/FirstTimeNote.svelte';
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
    /** Absent: whoever looks cannot write the plan. */
    onCreate?: () => void;
    /** Calm (ADR-139 § 5, `$lib/calm`): the strip and «Por decidir» stay;
        the key and the three lists fold into one line that leaves calm. */
    calm?: boolean;
    onLeaveCalm?: () => void;
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
    calm = false,
    onLeaveCalm,
  }: Props = $props();

  /** Monday-first weekday words — the month's own (diseño B3: one shape
      for a day's head in every drawing). */
  let dows = $derived(weekdayLabels(localeTag));

  let empty = $derived(
    !loading && weeks.every((w) => w.every((c) => c.past || (c.mark === null && !c.travel && !c.steps))),
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
  /** The strip's one tab stop: row:col, col 0 is the week's label. Starts on
      today (or the first day when today is not drawn). */
  let focusAt = $state('');
  $effect(() => {
    if (focusAt) return;
    weeks.forEach((w, wi) =>
      w.forEach((c, di) => {
        if (c.today) focusAt = `${wi}:${di + 1}`;
      }),
    );
    if (!focusAt) focusAt = '0:1';
  });
  function onStripKey(e: KeyboardEvent) {
    const [r, c] = focusAt.split(':').map(Number);
    let nr = r;
    let nc = c;
    if (e.key === 'ArrowRight') nc = c + 1;
    else if (e.key === 'ArrowLeft') nc = c - 1;
    else if (e.key === 'ArrowDown') nr = r + 1;
    else if (e.key === 'ArrowUp') nr = r - 1;
    else if (e.key === 'Home') nc = 0;
    else if (e.key === 'End') nc = 7;
    else return;
    // Days run on across weeks: → from Sunday is next Monday.
    if (nc > 7) {
      nc = 1;
      nr += 1;
    } else if (nc < 0) {
      nc = 7;
      nr -= 1;
    }
    if (nr < 0 || nr >= weeks.length) return;
    e.preventDefault();
    e.stopPropagation();
    focusAt = `${nr}:${nc}`;
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-cell="${focusAt}"]`)?.focus();
  }
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
    <section class="blk ov__strip" data-help-step="planner-strip" aria-label={t('planner.season_strip', locale, { n: SEASON_WEEKS })}>
      <BlockHead title={t('planner.season_strip', locale, { n: SEASON_WEEKS })} />
      <!-- ONE TAB STOP, ARROWS INSIDE (móvil #8, WCAG 2.4.3): 84 days and 12
           weeks were 96 stops between the head and «Por decidir». The strip
           is one stop that lands on today; ← → walk days, ↑ ↓ weeks, Home
           goes to the week's label, End to its Sunday. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="strip" onkeydown={onStripKey}>
        <div class="strip__row strip__dow" aria-hidden="true">
          <span></span>
          {#each dows as d, i (i)}<span>{d}</span>{/each}
        </div>
        {#each weeks as week, wi (week[0].iso)}
          <div class="strip__row">
            <button
              type="button"
              class="wk"
              tabindex={focusAt === `${wi}:0` ? 0 : -1}
              data-cell={`${wi}:0`}
              onfocus={() => (focusAt = `${wi}:0`)}
              title={t('planner.season_open_month', locale)}
              onclick={() => onWeek(week[0].iso)}
              ><!-- One label for a week-row in every drawing: «semana 42»
                   (diseño B2); the Season adds the Monday under it. --><span class="wk__w"
                >{t('planner.week_n', locale)}</span
              >
              {isoWeek(week[0].iso)}<b
                >{localeDayMonth(week[0].iso, localeTag)}</b
              ></button
            >
            {#each week as c, di (c.iso)}
              <button
                type="button"
                tabindex={focusAt === `${wi}:${di + 1}` ? 0 : -1}
                data-cell={`${wi}:${di + 1}`}
                onfocus={() => (focusAt = `${wi}:${di + 1}`)}
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
                {#if c.steps}<span class="ev__more" data-testid="season-steps"
                    >{c.steps === 1 ? t('planner.steps_one', locale) : t('planner.steps_n', locale, { n: c.steps })}</span
                  >{/if}
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
      {#if shows('planner', 'legend', calm)}
        <p class="strip__key">
          <span><i class="k k--firm"></i>{t('planner.season_key_firm', locale)}</span>
          <span><i class="k k--option grain"></i>{t('planner.season_key_option', locale)}<ConceptHint concept="hold" /></span>
          <span><i class="k k--tour"></i><span class="guess">{t('planner.season_key_tour', locale)}</span><ConceptHint concept="guess" /></span>
          <span><i class="k k--away"></i>{t('planner.season_key_away', locale)}</span>
          <span><i class="k k--decide"></i>{t('planner.season_key_decide', locale)}</span>
          <span><i class="k k--clash"></i>{t('planner.season_key_clash', locale)}</span>
        </p>
      {/if}
      {#if empty}
        <p class="blk__empty">
          {t('planner.season_empty', locale, { n: SEASON_WEEKS })}
          {#if onCreate}<button type="button" class="ov__add" onclick={onCreate}>＋ {t('planner.date_word', locale)}</button>{/if}
        </p>
      {/if}
    </section>

    <!-- 3 · TO DECIDE — the queue OPEN, deciding in place (ADR-095 §6: an act
         is exercised where you are looking). Then the clashes that are not a
         choice between two holds. -->
    {#if !decisionsAbsent}
      <section class="blk ov__decide" data-help-step="planner-decide">
        <BlockHead title={t('planner.season_b_decide', locale)} concept="decide" count={n(decisions.length)} alert={decisions.length > 0} />
        <FirstTimeNote event="first_hold_due" when={!loading && decisions.some((d) => d.urgent)} />
        {#if loading}
          <p class="blk__empty" aria-hidden="true"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></p>
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
        <BlockHead title={t('planner.season_b_clashes', locale)} concept="clashes" count={n(clashes.length)} alert={clashes.length > 0} />
        <FirstTimeNote event="first_clash" when={!loading && clashes.length > 0} />
        {#if loading}
          <p class="blk__empty" aria-hidden="true"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></p>
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

    {#if !shows('planner', 'season_lists', calm)}
      <div class="ov__lists ov__lists--calm">
        <CalmLine text={t('planner.calm_season_rest', locale)} action={t('calm.see_all', locale)} onclick={() => onLeaveCalm?.()} />
      </div>
    {:else}
    <div class="ov__lists" data-help-step="planner-lists">
      <!-- 4 · NOT CLOSED — confirmed, and something is still empty. Facts as
           chips; the trip is a guess and says so in the inference voice. -->
      <section class="blk">
        <BlockHead
          title={t('planner.season_b_unclosed', locale)}
          concept="unclosed"
          count={loading
              ? DASH
              : t('planner.season_unclosed_meta', locale, {
                  n: facts.unclosed,
                  m: firmAhead,
                  w: UNCLOSED_WEEKS,
                }) + (travelOnly > 0 ? ` · ${t('planner.season_unclosed_guess', locale, { n: travelOnly })}` : '')}
        />
        <FirstTimeNote event="first_trip_guess" when={!loading && unclosed.some((u) => u.travelGuess)} />
        {#if loading}
          <p class="blk__empty" aria-hidden="true"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></p>
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
        <BlockHead title={t('planner.season_b_gaps', locale)} concept="gaps" count={t('planner.season_gaps_meta', locale, { n: GAP_MIN_NIGHTS })} />
        {#if loading}
          <p class="blk__empty" aria-hidden="true"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></p>
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
        <BlockHead title={t('planner.season_b_away', locale)} />
        {#if loading}
          <p class="blk__empty" aria-hidden="true"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></p>
        {:else if away.length === 0}
          <p class="blk__empty">{t('planner.season_none_away', locale)}</p>
        {:else}
          {#each away as a (a.key)}
            <button type="button" class="row" onclick={() => onDay(a.from)}>
              <span class="row__when">{range(a.from, a.to)}</span>
              <span class="row__what" class:row__what--tent={a.tentative}
                >{a.who}{#if a.tentative}?{/if}{#if a.what}<small>{a.what}</small>{/if}{#if a.legs}<small class="guess row__legs"
                    >{a.legs}</small
                  >{/if}</span
              >
            </button>
          {/each}
        {/if}
      </section>
    </div>
    {/if}
  </div>
</div>

<style>
  @layer components {
    .ov {
      /* Named: the day cells are containers too (for the slip), and an
         unnamed query below would measure the cell instead of the season. */
      container: season / inline-size;
      display: grid;
      gap: var(--space-m);
      margin-block-start: var(--space-s);
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
    .ov__lists--calm {
      display: block;
    }

    .blk {
      display: grid;
      gap: var(--space-xs);
      align-content: start;
      min-width: 0;
    }
    /* The head is the dashboards' one (BlockHead); a second head inside a
       block (the clashes under «to decide») keeps its breath above. */
    .blk > :global(.block-head:not(:first-child)) {
      margin-block-start: var(--space-s);
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
      gap: var(--space-2xs);
    }
    .strip__row {
      display: grid;
      grid-template-columns: 4.2rem repeat(7, minmax(0, 1fr));
      gap: var(--space-2xs);
    }
    .strip__dow span {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: var(--tracking-l);
      padding-inline-start: var(--space-xs);
    }
    .wk {
      min-block-size: var(--touch-target);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      text-align: start;
      align-self: center;
      line-height: 1.2;
      letter-spacing: var(--tracking-m);
      text-transform: uppercase;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
    }
    .wk__w {
      font-size: var(--text-2xs);
    }
    .wk b {
      color: var(--text-color);
      font-weight: 500;
      display: block;
    }
    .d {
      /* The cell is the slip's size container: below a measured width the
         compact card keeps only its monogram (ADR-095 §8, diseño M10). */
      container-type: inline-size;
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      align-items: stretch;
      min-height: 3.4rem;
      min-width: 0;
      padding: var(--space-2xs) var(--space-xs) var(--space-xs);
      text-align: start;
      font: inherit;
      color: inherit;
      background: color-mix(in oklch, var(--text-color) 3%, transparent);
      border: 0;
      border-radius: var(--radius-xs);
      cursor: pointer;
      overflow: hidden;
    }
    .d:hover {
      background: color-mix(in oklch, var(--text-color) 7%, transparent);
    }
    /* Past days stay doors (a day already lived is still worth opening), so
       they keep their ink: 45% opacity put the number at 1.8:1 (móvil #7,
       WCAG 1.4.3). They lose their GROUND instead — no cell, just the day. */
    .d--past {
      background: none;
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
    /* What is READ takes an 11px floor (móvil #6): the day's number and the
       week's. 9px stays for what is only a key. */
    .d__n {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .d__n i {
      font-style: normal;
      margin-inline-start: var(--space-2xs);
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
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      line-height: 1.15;
      border-radius: var(--radius-xs);
      padding: var(--line-hairline) var(--space-2xs);
      min-width: 0;
      white-space: nowrap;
    }
    .ev--date {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--text-muted);
      padding-inline: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ev__more {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--text-muted);
    }
    .d__travel {
      position: absolute;
      inset-block-start: 2px;
      inset-inline-end: 0.75rem;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .d__clash {
      position: absolute;
      inset-block-start: 0.25rem;
      inset-inline-end: 0.25rem;
      width: var(--dot-m);
      height: var(--dot-m);
      border-radius: 50%;
      background: var(--danger);
    }
    /* A call to make, not a collision: the dot's outline, in ink. Red stays
       for what «Choques» counts. */
    .d__decide {
      position: absolute;
      inset-block-start: 0.25rem;
      inset-inline-end: 0.25rem;
      width: var(--dot-m);
      height: var(--dot-m);
      border-radius: 50%;
      border: var(--line-hairline) solid var(--text-muted);
    }
    .d__decide--beside {
      inset-inline-end: 0.75rem;
    }
    .d__tour {
      position: absolute;
      inset-inline: 0;
      inset-block-end: 0;
      height: var(--dot-xs);
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
      gap: var(--space-xs) var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
      margin: var(--space-xs) 0 0;
    }
    .k {
      display: inline-block;
      width: 0.875rem;
      height: 0.5625rem;
      vertical-align: -1px;
      margin-inline-end: var(--space-xs);
      border-radius: var(--radius-xs);
    }
    /* The key draws the slip's own edges and paper (Slip.svelte § certainty). */
    .k--firm {
      background: var(--bg-ultra-light);
      border: var(--line-hairline) solid color-mix(in oklch, var(--text-color) 15%, var(--border-color-light));
    }
    .k--option {
      background: var(--bg-ultra-light);
      border: var(--line-hairline) dashed color-mix(in oklch, var(--text-color) 13%, var(--border-color-light));
    }
    .k--tour {
      height: var(--dot-xs);
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
      width: var(--dot-m);
      height: var(--dot-m);
      border-radius: 50%;
      border: var(--line-hairline) solid var(--text-muted);
      vertical-align: 1px;
    }
    .k--clash {
      width: var(--dot-m);
      height: var(--dot-m);
      border-radius: 50%;
      background: var(--danger);
      vertical-align: 1px;
    }

    /* ── Lists ──────────────────────────────────────────────────────── */
    .row {
      display: grid;
      /* Wide enough for the longest short range («24 oct → 25 oct»), and the
         range never wraps: rows of one list keep one height (diseño B7). */
      grid-template-columns: 6.8rem minmax(0, 1fr);
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-xs);
      text-decoration: none;
      color: inherit;
      font: inherit;
      text-align: start;
      background: none;
      border: 0;
      border-block-end: var(--line-hairline) solid color-mix(in oklch, var(--text-color) 6%, transparent);
      cursor: pointer;
      width: 100%;
    }
    .row:hover .row__what {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .row__when {
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      padding-block-start: var(--space-2xs);
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
      margin-inline-start: var(--space-xs);
    }
    /* Where a tour came from is its own line, so its «·» never hangs at the
       end of the name's line. */
    .row__what .row__legs {
      display: block;
      margin-inline-start: 0;
    }
    .row__note {
      grid-column: 2;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-muted);
    }
    .row__miss {
      grid-column: 2;
      display: flex;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }
    /* MUTED BY DEFAULT (diseño B8): «hotel», «técnica» on every row in
       amber made the least urgent thing the loudest on the page. The amber is
       kept for what falls in the next two weeks, where a missing hotel is a
       call to make today. */
    .miss {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-muted);
      border: var(--line-hairline) solid color-mix(in oklch, var(--text-color) 18%, transparent);
      border-radius: var(--radius-xs);
      padding: 0 var(--space-xs);
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
    @container season (max-width: 40rem) {
      .ov__grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: 'decide' 'strip' 'lists';
      }
      .ov__lists {
        grid-template-columns: minmax(0, 1fr);
      }
      .strip__row {
        grid-template-columns: 2.2rem repeat(7, minmax(0, 1fr));
        gap: var(--space-2xs);
      }
      .wk b,
      .wk__w {
        display: none;
      }
      .d {
        min-height: 2.2rem;
        padding: var(--space-2xs) var(--space-2xs) var(--space-xs);
      }
      .d :global(.slip) {
        padding: 0;
        height: var(--dot-l);
      }
      .d :global(.slip > *),
      .ev__more,
      .ev--date,
      .d__travel {
        display: none;
      }
    }
    @container season (min-width: 40.0625rem) and (max-width: 56.25rem) {
      .ov__grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: 'strip' 'decide' 'lists';
      }
    }
  }
</style>
