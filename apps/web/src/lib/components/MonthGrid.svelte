<script lang="ts">
  /**
   * Month grid presentation for the Calendar lens — weeks × days with
   * performance/date chips, day numbers, and the quiet per-day "+"
   * affordance. Calendar v2 (ADR-072/076/078) adds the chip grammar
   * (solid = commitment, outline = hold, dashed = possibility), travel
   * direction chips, blackout/away bands and conflict day-marks with the
   * clash-card popover. Pure presentation over already-scoped rows: the
   * page owns the feeds, the pins filtering, the conflict engine and the
   * i18n — this component owns bucketing + layout. Grid math stays in
   * $lib/planner.
   *
   * Class names keep the original `cal__` block from the calendar page —
   * the e2e specs select `.cal__grid` / `.cal__weekday` (Svelte scoping
   * keeps them collision-free anyway).
   *
   * Split (2026-07-24): the event types + pure day/label helpers live in
   * $lib/month-events; everything that happens draws as `Slip`, and the
   * clash popover is `ClashCard`. There is no second card grammar left in
   * this file to fork from the first.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { bookingModeOf } from '$lib/booking-mode';
  import type { Attachment } from 'svelte/attachments';
  import { isFreeSpace, longPress } from '$lib/cell-create';
  import { dayKeyInTz, monthUnderStrip } from '$lib/planner';
  import { dayMonthLong, weekdayLabels, localeMonthShort, localeDayMonth, localeWeekdayShort, viewerTimeZone } from '$lib/datetime';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import type { IdentitySibling } from '$lib/utils/identity';
  import IdentityQuickPanel from '$lib/components/IdentityQuickPanel.svelte';
  import { performanceStatusFamily, statusFootKey } from '$lib/performance';
  import { appLocale, appLocaleTag, t, tradeFor, type Voice } from '$lib/i18n';
  import { statusWord } from '$lib/planner';
  import { dualTime } from '$lib/datetime';
  import {
    performanceSlip,
    perfWorkspaceId,
    dateSlip,
    type Slip as SlipVM,
    perfDayKey,
    seriesDayMap,
    isMultiDayRun,
    dateDayKey,
    deducedPhrase,
    formatMonthLabel,
    perfInstant,
    travelOriginFinder,
    type ProjectLite,
    type PerformanceEvent,
    type DateEvent,
    type BlackoutBandVM,
    type AwayBandVM,
    type ClashVM,
  } from '$lib/month-events';
  import ClashCard from '$lib/components/planner/ClashCard.svelte';
  import Slip from '$lib/components/planner/Slip.svelte';

  interface Props {
    /** THE CONTINUOUS MONTH (ADR-209): weeks Monday→Sunday across several
        months, no page break (`monthSpanWeeks`). Every day is a door. */
    rows: string[][];
    /** The month on screen — the grid's name for a screen reader. */
    shownMonth: { year: number; month: number };
    /** Free runs of three nights or more (`gapWindows`): hatched, and
        named on their first day. */
    gaps?: Array<{ from: string; to: string; nights: number }>;
    gapLabel?: (nights: number) => string;
    gapShortLabel?: (nights: number) => string;
    /** The paper's foot came into view: the page adds a month. */
    onReachEnd?: () => void;
    /** The month that holds the reader's eye changed (scrolling). */
    onMonthShown?: (m: { year: number; month: number }) => void;
    /** The picked day's door, on a phone: «Día →». */
    openDayWord?: string;
    /** Already scope-filtered rows — the grid only buckets and renders. */
    performances: PerformanceEvent[];
    dates: DateEvent[];
    /** Fallback slug for chip hrefs when a perf's workspace isn't resolvable. */
    workspaceSlug: string;
    /** Dims the grid while the page's feeds refetch. */
    loading?: boolean;
    /** When given, each day shows a "+" that reports its ISO date. */
    onDayCreate?: (isoDate: string) => void;
    /** When given, date chips open — the page owns the edit dialog. */
    onDateOpen?: (d: DateEvent) => void;
    /**
     * The day NUMBER is a door to that day's own drawing.
     *
     * The month answers «what is this month shaped like»; the moment you have
     * found the day you were looking for, the next question is always «what
     * does that day look like», and the number is the thing your eye is
     * already on. Out-of-month numbers stay inert — they are orientation, and
     * the sheet does not own days it is not drawing.
     */
    onDayOpen?: (isoDate: string) => void;
    /** Stored blackouts to paint as day-cell bands (page-scoped VMs). */
    blackouts?: BlackoutBandVM[];
    /** Derived away bands — quieter than any blackout, display-only. */
    aways?: AwayBandVM[];
    /** Conflicts per ISO day — the day marks + clash-card popovers. */
    clashesByDay?: Map<string, ClashVM[]>;
    /**
     * «QUIÉN FALTA» (tarea 165): the people's absences are not on the sheet
     * until the reader asks. Off, a person's blackout draws nothing; on, it
     * is a bar with the person's name over the days they are out. A company
     * closure is not a person and draws either way.
     */
    showAbsences?: boolean;
    /** The confirmed gigs a person with a written absence was booked on:
        their monogram takes the red edge while «Quién falta» is on. */
    absenceHitIds?: ReadonlySet<string>;
    /** «compañía cerrada» / «cerrado» — the closure bar, long and short. */
    closedWord?: string;
    closedShortWord?: string;
    /** «+2 más» — the absences past the week's cap. */
    moreAbsentLabel?: (n: number) => string;
    /** BCP47/locale tag for weekday + month labels. */
    locale?: string;
    /** i18n hooks — the page passes t()-backed fns; defaults follow the session language. */
    dateKindLabel?: (kind: string, voice?: Voice) => string;
    createLabel?: (isoDate: string) => string;
    /** Qué dice el número del día, que ES la puerta al Día. Sin nombre, un
        número en una esquina no se lee como control ni lo anuncia un lector
        de pantalla. */
    openDayLabel?: (isoDate: string) => string;
    /**
     * The word on a card's FOOT — "confirmat", "1r hold", "proposat".
     * EVERY card carries one: without it a confirmed gig is a row shorter
     * than a hold, so the most important thing on the grid reads as the
     * smallest (Marco, 2026-07-19). Holds show their rank — the family
     * folds hold_1..3 into one SHAPE (ADR-072 §5), the rank is what is
     * actually being decided between.
     */
    stateLabel?: (status: string) => string | null;
    /** «more» — the word after the +N door on a full cell. */
    moreLabel?: string;
    /** «let go» — the word a released slip carries. */
    releasedLabel?: string;
    /** «expires Mon» — the deadline phrase, given the decide-by ISO day. */
    expiresLabel?: (isoDay: string) => string;
    /** The word a tour's bar opens with: «gira». */
    tourWord?: string;
  }

  /** Defaults in the session's language; the page passes its own t(). */
  const L = appLocale();

  let {
    rows,
    shownMonth,
    gaps = [],
    gapLabel = (n: number) => `${n} ${t('planner.stat_free', L)}`,
    gapShortLabel = (n: number) => t('planner.month_gap_short', L, { n }),
    onReachEnd,
    onMonthShown,
    openDayWord = t('planner.view_day', L),
    performances,
    dates,
    workspaceSlug,
    loading = false,
    onDayCreate,
    onDateOpen,
    onDayOpen,
    blackouts = [],
    aways = [],
    clashesByDay,
    showAbsences = false,
    absenceHitIds,
    closedWord = t('planner.bar_closed', L),
    closedShortWord = t('planner.bar_closed_short', L),
    moreAbsentLabel = (n: number) => t('planner.bar_more_absent', L, { n }),
    locale = appLocaleTag(),
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    createLabel = (iso: string) => t('planner.new_on', L, { day: dayMonthLong(iso, appLocaleTag()) }),
    openDayLabel = (iso: string) => t('planner.open_day', L, { day: `${localeWeekdayShort(iso, appLocaleTag())} ${localeDayMonth(iso, appLocaleTag())}` }),
    stateLabel = (status: string) => {
      const key = statusFootKey(status);
      return key ? t(key, L) : null;
    },
    moreLabel = t('planner.more_n', L),
    releasedLabel = t('planner.released', L),
    expiresLabel = (iso: string) => t('planner.expires_on', L, { day: `${iso.slice(8, 10)}/${iso.slice(5, 7)}` }),
    tourWord = t('planner.bar_tour', L),
  }: Props = $props();

  // ── Identity quick-edit (ADR-081): a monogram click opens the editor at a
  // fixed rect so it escapes the month cells' overflow:hidden. The event stays
  // a link; the monogram intercepts its own click (preventDefault/stop).
  let markPop = $state<{ project: ProjectLite; rect: DOMRect } | null>(null);
  let markPopEl: HTMLElement | undefined = $state();
  let markSiblings = $derived.by(() => {
    const m = new Map<string, IdentitySibling>();
    const add = (p: ProjectLite) =>
      m.set(p.id, {
        id: p.id,
        initials: p.initials,
        slug: p.slug,
        name: p.name,
        accent: p.accent,
      });
    for (const p of performances) if (p.project) add(p.project);
    for (const d of dates) if (d.project) add(d.project);
    return [...m.values()];
  });
  function openMark(e: MouseEvent, project: ProjectLite | null) {
    if (!project) return;
    e.preventDefault();
    e.stopPropagation();
    markPop = { project, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() };
  }
  function markPopStyle(rect: DOMRect): string {
    const w = 240;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(rect.left, vw - w - 8));
    return `top: ${rect.bottom + 4}px; left: ${left}px`;
  }
  $effect(() => {
    if (!markPop) return;
    const onDown = (e: MouseEvent) => {
      if (!markPopEl?.contains(e.target as Node)) markPop = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') markPop = null;
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  const viewerTz = viewerTimeZone();
  const todayIso = dayKeyInTz(new Date().toISOString(), viewerTz);

  /** The state line: released says `let go`, a hold says its rank and its
      deadline. A FIRM SHOW AND A PROPOSED ONE BOTH SAY NOTHING — the geometry
      already carries them, and the `?` on the kind word carries the option. */
  function slipState(sl: SlipVM): string | null {
    if (sl.cert === 'released') return releasedLabel;
    if (sl.cert === 'hold' && sl.hold) {
      const rank = sl.hold.rank ? stateLabel(`hold_${sl.hold.rank}`) : stateLabel('hold');
      if (!sl.hold.expires) return rank;
      // THE MONTH SAYS THE WEEKDAY, NOT THE DATE. `hold · expires 25 jun` is
      // 21 characters in a 76px box: it wrapped to two lines and then printed
      // `HOLD · EXPIRES 25/0…`, clipping the one thing on a held card that is
      // not a maybe. `hold · Thu` is nine, fits on one line, and is the more
      // useful reading anyway — a deadline inside the next week is a weekday,
      // and the full date is on the card and in the title.
      return `${rank} · ${expiresLabel(sl.hold.expires)}`;
    }
    return null;
  }

  // Same cache key the shell/nav keeps warm — resolves each chip's href to
  // its own workspace (a perf can belong to a non-current one).
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceTzById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.timezone])),
  );
  /**
   * ADR-002 — the hold convention this workspace follows. The month can show
   * several workspaces at once, so the mode is resolved PER CHIP from its
   * own project's workspace, never once for the whole view.
   */
  let workspaceModeById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, bookingModeOf(w)])),
  );

  /* ── ONE OBJECT, NOT TWO CHIPS (ADR-095 §0) ────────────────────────────
     The cell renders `Slip`, and both primitives reach it through the same
     normaliser. `PerfChip` and `DateChip` are both gone — the run of days
     that was `DateChip`'s last excuse is a band now, not a stack of chips.

     THE CELL CAPS AT THREE, and the rest becomes `+N more`. Without the cap
     the row height is set by the fullest day, and that day can hold nine
     things — so a quiet week could never look short, which is half of what
     the month is for. */
  /* Where a leg began: the one finder ($lib/month-events), the Agenda's too. */
  let travelOrigin = $derived(travelOriginFinder(performances, dates, viewerTz));
  let slipCtx = $derived({
    workspaceSlug,
    workspaceSlugById,
    workspaceTzById,
    workspaceModeById,
    viewerTz,
    kindLabel: (k: string) => dateKindLabel(k),
    statusLabel: (s: string) => statusWord(s, L),
    viewerTimeLabel: (time: string) => t('planner.viewer_time', L, { time }),
    fallbackName: (voice: Voice) => t('create.type_performance', L, undefined, voice),
    dualTime,
    originOf: travelOrigin,
  });

  const CELL_CAP = 3;
  /** On a phone: two monograms and a «+N» (ADR-209). */
  const CELL_CAP_NARROW = 2;

  /**
   * The cell's contents in ONE ordered list, because a cap that only counts
   * gigs is a cap that lets a day with four rehearsals grow anyway.
   *
   * Order is the running order of the day: things with an hour first, by the
   * clock; things without an hour after them. A hold nobody has timed is the
   * normal case, not an error, so it sorts last rather than to 00:00.
   *
   * A multi-day SERIES still renders through `DateChip` — it is a band, not a
   * slip, and turning it into one element that spans columns is the next step.
   */
  function cellSlips(
    perfs: PerformanceEvent[],
    groups: DateEvent[][],
    /** The picked day under its week lists the run's row of that day too:
        there it is the day read whole, not the sheet. */
    withRuns = false,
  ): Array<{
    key: string;
    slip: SlipVM;
    dateGroup?: DateEvent[];
    dateRow?: DateEvent;
    sortAt: string;
  }> {
    const out: Array<{
      key: string;
      slip: SlipVM;
      dateGroup?: DateEvent[];
      dateRow?: DateEvent;
      sortAt: string;
    }> = [];
    for (const p of perfs) {
      // Una tanda salió de la celda: ahora es la banda de la semana, dibujada
      // UNA vez sobre los días que cubre. Sin esto se dibujaría dos veces.
      // Y la ley que esto NO rompe: dos funciones DISTINTAS el mismo día
      // siguen siendo dos cards — solo se va la que comparte serie.
      if (!withRuns && isRun(p.series_id)) continue;
      const slip = performanceSlip(p, slipCtx);
      out.push({ key: p.id, slip, sortAt: perfInstant(p) ?? '~' });
    }
    for (const g of groups) {
      // A multi-day run left the cell: it is the week's band now, drawn once
      // over the days it covers with each day's own hours under it.
      if (!withRuns && isSeriesBand(g)) continue;
      out.push({
        key: g[0].id,
        slip: dateSlip(g[0], slipCtx),
        dateRow: g[0],
        sortAt: g[0].all_day ? '~' : g[0].starts_at,
      });
    }
    // `~` sorts after every digit, so the un-timed fall to the bottom without
    // a second comparator and without pretending to be midnight.
    //
    // NOT `localeCompare`, and this is not a style preference: locale collation
    // reorders punctuation, so `'~'.localeCompare('2')` is -1 and every un-timed
    // hold jumped to the TOP of its day, above the gig that actually has an
    // hour. Caught on screen, 2026-07-31. These are ISO strings and a sentinel;
    // codepoint order is the order we mean.
    return out.sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : 0));
  }

  /* ── WHICH TWO COLLIDE ────────────────────────────────────────────────
     `ClashVM.event_ids` names the pair. It was added to the VM for exactly
     this and then never read: the month could say THAT something clashed —
     the `!` on the day number — and never which two, which is the half of the
     message you can act on.

     A RULE THAT POINTS AT TWO AND SHOWS ONE IS A LIE. Narrow the scope so
     that only one half of the pair is on the sheet and the rule leaves with
     it; the mark on the day number stays, because it never asked the filter,
     and it is the honest thing left to say. */
  function clashFlags(
    lead: Array<{ slip: SlipVM }>,
    clashes: ClashVM[],
  ): { on: boolean[]; hard: boolean[]; people: boolean[] } {
    const ids = new Set(clashes.flatMap((c) => c.event_ids));
    const on = lead.map((e) => ids.has(e.slip.id));
    const none = on.map(() => false);
    if (on.filter(Boolean).length < 2) return { on: none, hard: none, people: none };
    /* THE RULE SPEAKS ABOUT THE CARD IT IS DRAWN ON. Solid when THIS thing is
       real, dashed while it is still an option.

       Two wrong answers came before it. The first asked «is anything on this
       date confirmed?», so a day holding one real gig drew every other
       collision on it as settled — two holds colliding with each other were
       reported as a hard problem because a third, unrelated thing beside them
       was inked. The second asked «is the OTHER half of the pair confirmed?»,
       which inverted the day: the confirmed gig came out dashed and the two
       holds around it came out solid.

       The answer Marco asked for is the one the rest of this drawing already
       uses: geometry states the certainty, per object. A solid red rule on a
       dashed-edged option card is two claims about one thing. */
    const hard = lead.map((e, i) => on[i] && e.slip.cert === 'confirmed');
    /* RED IS BOUND TO THE MARK'S OWN TEST. The `!` on the day number goes red
       for `people` and `blackout` — a real human double-booked, or booked
       across an absence they wrote down — and the rule beside it must use the
       same test or the same day prints two levels of alarm about one fact.
       That contradiction is exactly what Marco read on 9 July: a blue mark
       next to a red rule. */
    const people = lead.map(
      (e, i) =>
        on[i] &&
        clashes.some(
          (c) =>
            (c.severity === 'people' || c.severity === 'blackout') &&
            c.event_ids.includes(e.slip.id),
        ),
    );
    return { on, hard, people };
  }

  /** verb-cal only while the clock is actually running (ADR-080 §2). */
  function isUrgentHold(sl: SlipVM): boolean {
    return Boolean(sl.hold?.expires && sl.hold.expires <= todayIso);
  }

  let weeks = $derived(rows.map((w) => w.map((iso) => ({ iso }))));
  let label = $derived(formatMonthLabel(shownMonth.year, shownMonth.month, locale));
  let wkLabels = $derived(weekdayLabels(locale));

  /* ── THE PAPER RUNS ON (ADR-209) ─────────────────────────────────────
     Months follow each other without a page break. What separates them is
     the GROUND (every other month a step darker, `--month-alt-ground`) and
     the NAME: the 1st carries the month instead of its number, long where
     the cell gives room, short where it does not. */
  const MONTH_LONG = $derived(new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }));
  function monthWords(iso: string): { long: string; short: string } {
    const long = MONTH_LONG.format(new Date(`${iso}T00:00:00Z`));
    return { long: `${long.charAt(0).toUpperCase()}${long.slice(1)}`, short: localeMonthShort(iso, locale) };
  }
  /** Every other month on the darker ground: even months, so a month keeps
      its tone however the paper grows. */
  function altMonth(iso: string): boolean {
    return Number(iso.slice(5, 7)) % 2 === 0;
  }
  /** Each free night of a hole, and the length on its first one. */
  let gapByDay = $derived.by(() => {
    const m = new Map<string, number>();
    for (const g of gaps) {
      for (let d = g.from, i = 0; d <= g.to; d = nextIso(d), i++) m.set(d, i === 0 ? g.nights : 0);
    }
    return m;
  });
  function nextIso(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  /* ON A PHONE THE DAY IS READ UNDER ITS WEEK (ADR-209). A cell there is
     ~50px: room for two monograms and a «+1», never for a card. Tapping a
     day selects it, and the day is drawn whole under its week row; the
     door to the Day is there. Opens on today. */
  let narrow = $state(false);
  $effect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(max-width: 47.999rem)');
    narrow = mq.matches;
    const on = () => (narrow = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  let picked = $state<string | null>(todayIso);
  function pick(iso: string) {
    picked = picked === iso ? null : iso;
  }
  /** The column of a month's 1st in this week, or -1 (the ink stair). */
  function firstCol(week: readonly { iso: string }[]): number {
    return week.findIndex((d) => d.iso.endsWith('-01'));
  }
  function openOrPick(iso: string) {
    if (narrow) pick(iso);
    else onDayOpen?.(iso);
  }
  function pickedEntries(iso: string) {
    return cellSlips(performancesByDay.get(iso) ?? [], groupDates(datesByDay.get(iso) ?? []), true);
  }

  /* THE FOOT ASKS FOR MORE, AND THE EYE NAMES THE MONTH. A sentinel under the
     last week asks the page for another month before the reader gets there;
     the first week read under the stuck strip names the month on screen
     (`monthUnderStrip`: a week holding a 1st names the new month, the week
     holding today names today's). */
  let footEl = $state<HTMLElement>();
  $effect(() => {
    if (!footEl || !onReachEnd || typeof IntersectionObserver === 'undefined') return;
    // A NEW OBSERVER PER PAPER: one only reports a CHANGE of crossing, so a
    // foot still in view after a month was added never asked again and the
    // paper stopped growing at the reader's feet. Re-made with every `rows`,
    // its first report is the current one.
    void rows;
    const reach = onReachEnd;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && reach(), {
      rootMargin: '0px 0px 300px 0px',
    });
    io.observe(footEl);
    return () => io.disconnect();
  });
  $effect(() => {
    if (!gridEl || !onMonthShown) return;
    const grid = gridEl;
    const tell = onMonthShown;
    let raf = 0;
    const read = () => {
      raf = 0;
      const foot = grid.querySelector('.cal__wkh')?.getBoundingClientRect().bottom ?? 0;
      const weeks = [...grid.querySelectorAll<HTMLElement>('.cal__wk')].map((wk) => {
        const r = wk.getBoundingClientRect();
        return { monday: wk.dataset.mon ?? '', top: r.top, bottom: r.bottom };
      });
      const m = monthUnderStrip(weeks, foot, todayIso);
      if (m) tell(m);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  });

  // Off-grid buckets (the page's padded dates window can fetch an event a
  // day outside the grid) simply find no cell.
  // Gigs lead the cell (they render before dates), and inside them the
  // SETTLED one leads: a confirmed gig is what the day actually is, a hold
  // or a proposal is a maybe — a maybe must never sit above the real thing
  // (Marco, 2026-07-19). Ties break on the working time so the order is
  // stable rather than feed order.
  const PERF_RANK: Record<string, number> = { confirmed: 0, hold: 1, proposed: 2 };
  let performancesByDay = $derived.by(() => {
    const map = new Map<string, PerformanceEvent[]>();
    for (const p of performances) {
      const key = perfDayKey(p);
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    for (const list of map.values())
      list.sort((a, b) => {
        const ra = PERF_RANK[performanceStatusFamily(a.status)] ?? 9;
        const rb = PERF_RANK[performanceStatusFamily(b.status)] ?? 9;
        if (ra !== rb) return ra - rb;
        return (perfInstant(a) ?? '').localeCompare(perfInstant(b) ?? '');
      });
    return map;
  });

  let datesByDay = $derived.by(() => {
    const map = new Map<string, DateEvent[]>();
    for (const d of dates) {
      const key = dateDayKey(d, viewerTz);
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return map;
  });

  // ── Multi-day blocks (ADR-084 §1) ────────────────────────────────────
  // A block is N rows sharing a series_id. The BAND is a rendering of those
  // rows: which day is an edge is derived here on every paint, never stored.
  // That is the whole reason for per-day rows — confirm one day of a run and
  // it simply shows as itself inside the band; there is no stored span to
  // fall out of sync with the days it claims to cover.
  // ADR-084 §1 — las funciones también duran varios días desde
  // `20260829100000`: una tanda es una serie que toca dos días o más, sea de
  // ensayos o de bolos. La cuenta vive en `seriesDayMap` (la comparte el Desk).
  let seriesDays = $derived(seriesDayMap(dates, (d) => dateDayKey(d, viewerTz), performances));

  /** ¿Esta serie es una tanda de verdad? Dos días o más. */
  function isRun(sid: string | null | undefined): boolean {
    return isMultiDayRun(seriesDays, sid);
  }

  /**
   * Sessions of ONE block on one day collapse into a single chip with a
   * count; anything else stays its own chip.
   *
   * A rehearsal day holds a morning and an afternoon and both matter, but a
   * card cannot grow — so the card shows the first hour and says how many
   * more there are, and the hover carries all of them. Two different gigs on
   * a day are NOT this case: those are two things, and both names have to be
   * readable (Marco, 2026-07-20).
   */
  function groupDates(list: DateEvent[]): DateEvent[][] {
    const out: DateEvent[][] = [];
    const bySeries = new Map<string, DateEvent[]>();
    for (const d of list) {
      if (!d.series_id) {
        out.push([d]);
        continue;
      }
      const g = bySeries.get(d.series_id);
      if (g) g.push(d);
      else {
        const started = [d];
        bySeries.set(d.series_id, started);
        out.push(started);
      }
    }
    // Clock order, so "the first hour" means the earliest one.
    for (const g of out) if (g.length > 1) g.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    return out;
  }

  /** True while these rows are a real multi-day run — the test the cell uses
      to hand the group to the band instead of drawing it as a slip. */
  function isSeriesBand(g: DateEvent[]): boolean {
    return isRun(g[0]?.series_id);
  }

  /* ── A RUN OF DAYS IS ONE BAND, NOT N LOOSE CARDS ──────────────────────
     A block of rehearsals is not one thing lasting five days: it is five
     entries that share a name, each with its own real hours (the 8th is
     10–18, the 10th is 10–13). Repeating the same empty card five times is
     noise; repeating it with DIFFERENT INFORMATION is telling the truth.

     So the run draws once — name, project and place said one time — with a
     seven-column strip under it carrying each day's own sessions. That strip
     is the entire argument for per-day rows, and until now the month threw it
     away: the group rendered as a chip in the first day's cell and the other
     days got an orphan time box with no name attached to it (seen on screen,
     2026-07-31 — a bare `12:00–16:00` floating in Sunday).

     A session is a LINE. Two sessions in one day are two lines, never one
     line with a separator: at a 72px column `10h–14h · 16h–18h` needs 93px
     and the cell hides its overflow, so it printed `10h–14h · 16h—` and lost
     an hour. A clipped hour is the one thing this drawing will not do. */
  /**
   * UNA CELDA DE BANDA NO SABE DE QUÉ ESTÁ HECHA (ADR-084 §1).
   *
   * La banda dibujaba solo tandas de `date`. Desde `20260829100000` una
   * FUNCIÓN también puede durar varios días, y la ley de arriba —«una tanda es
   * un elemento, y lleva las horas de cada día»— no cambia por el tipo de fila.
   * Así que la celda deja de llevar un `DateEvent` y lleva lo que el dibujo
   * necesita: si hay algo ese día, sus horas, y QUÉ HACE al pulsarla.
   *
   * Y ahí está la única asimetría real: una fecha no tiene página y abre su
   * diálogo (`onDateOpen`), una función SÍ la tiene y es un enlace. Por eso
   * hay `open` y `href`, y no un solo callback: convertir el enlace de una
   * función en un botón le quitaría el clic central, el copiar-enlace y el
   * foco que trae gratis.
   */
  type SeriesCell = {
    iso: string;
    hours: SlipVM['time'][];
    /** Hay fila ese día. Un hueco en medio de la tanda es un día sin nada. */
    filled: boolean;
    open: (() => void) | null;
    href: string | null;
  };
  type WeekSeries = {
    key: string;
    /** The row this run sits on, 0-based — packed, not stacked. */
    lane: number;
    colStart: number;
    colEnd: number;
    project: ProjectLite | null;
    kindWord: string;
    label: string;
    city: string | null;
    cert: SlipVM['cert'];
    title: string;
    /** La tanda sigue antes / después de esta semana: el lado se dibuja
        ABIERTO, porque una caja cerrada en los dos lados afirma un final que
        la tanda no tiene ahí (Marco, 2026-08-30). */
    cutLeft: boolean;
    cutRight: boolean;
    cells: SeriesCell[];
  };
  /** Una fila de tanda, ya normalizada: el mínimo que la banda dibuja. */
  type RunRow = {
    sid: string;
    iso: string;
    /** Para ordenar dentro de un día. Las fechas traen instante; las
        funciones, la hora que el slip resuelva. */
    at: string;
    time: SlipVM['time'];
    open: (() => void) | null;
    href: string | null;
  };

  function weekSeries(week: { iso: string }[]): WeekSeries[] {
    const grouped = new Map<
      string,
      { rows: RunRow[]; cols: number[]; head: SlipVM; project: ProjectLite | null; kindWord: string }
    >();
    week.forEach((day, ci) => {
      const push = (r: RunRow, head: SlipVM, project: ProjectLite | null, kindWord: string) => {
        const g = grouped.get(r.sid) ?? { rows: [], cols: [], head, project, kindWord };
        g.rows.push(r);
        if (!g.cols.includes(ci)) g.cols.push(ci);
        grouped.set(r.sid, g);
      };
      for (const d of datesByDay.get(day.iso) ?? []) {
        if (!isRun(d.series_id)) continue;
        const sl = dateSlip(d, slipCtx);
        push(
          {
            sid: d.series_id!,
            iso: day.iso,
            at: d.starts_at,
            time: sl.time,
            open: onDateOpen ? () => onDateOpen?.(d) : null,
            href: null,
          },
          sl,
          d.project,
          dateKindLabel(d.kind),
        );
      }
      for (const p of performancesByDay.get(day.iso) ?? []) {
        if (!isRun(p.series_id)) continue;
        const sl = performanceSlip(p, slipCtx);
        push(
          {
            sid: p.series_id!,
            iso: day.iso,
            at: perfInstant(p) ?? '~',
            time: sl.time,
            open: null,
            href: sl.href ?? null,
          },
          sl,
          p.project,
          // La misma resolución que el resto del mes usa para cualquier slip
          // (`slipCtx.kindLabel`): un bolo dice «show» con la palabra del
          // vocabulario, no con una segunda opinión propia de esta banda.
          dateKindLabel(sl.kind, tradeFor(perfWorkspaceId(p))),
        );
      }
    });
    const out: WeekSeries[] = [];
    for (const [sid, g] of grouped) {
      const a = Math.min(...g.cols);
      const b = Math.max(...g.cols);
      const head = g.head;
      const cells: SeriesCell[] = [];
      for (let c = a; c <= b; c++) {
        const iso = week[c].iso;
        const rows = g.rows
          .filter((r) => r.iso === iso)
          .sort((x, y) => (x.at < y.at ? -1 : 1));
        cells.push({
          iso,
          hours: rows.map((r) => r.time),
          filled: rows.length > 0,
          open: rows[0]?.open ?? null,
          href: rows[0]?.href ?? null,
        });
      }
      // Los días de la SERIE ENTERA, no los de esta semana: la tanda continúa
      // si tiene algún día fuera del tramo que esta hoja dibuja aquí.
      const all = [...(seriesDays.get(sid) ?? [])].sort();
      const cutL = Boolean(all.length) && all[0] < week[a].iso;
      const cutR = Boolean(all.length) && all[all.length - 1] > week[b].iso;
      out.push({
        key: `${sid}:${week[0].iso}`,
        lane: 0,
        colStart: a + 1,
        colEnd: b + 2,
        cutLeft: cutL,
        cutRight: cutR,
        project: g.project,
        kindWord: g.kindWord,
        label: head.name,
        city: head.city,
        cert: head.cert,
        title: head.title,
        cells,
      });
    }
    out.sort((x, y) => x.colStart - y.colStart);
    /* LANES ARE PACKED, NOT STACKED. Nth-in-the-list was the row, so a run on
       Saturday sat on the third row because two unrelated runs earlier in the
       week had taken the first two — two empty lanes above it, and its own
       days pushed a third of a cell down for nothing. Two runs that do not
       share a column share a row. (Unlike a BAND, whose lane is reserved for
       the whole week precisely so it cannot jump.) */
    const ends: number[] = [];
    for (const s of out) {
      let lane = ends.findIndex((e) => e <= s.colStart);
      if (lane === -1) lane = ends.length;
      ends[lane] = s.colEnd;
      s.lane = lane;
    }
    return out;
  }

  /**
   * HOW MANY RUN ROWS ACTUALLY SIT OVER THIS DAY — the day's contents start
   * under the last one, and NOT under the last one of the week.
   *
   * The run rows used to be reserved for the whole week: every cell began
   * below every band, so a Monday with no run at all opened with forty pixels
   * of nothing between its number and its first card, and a run two days long
   * put that hole in the other five days (Marco, day 10). A lane is reserved
   * for a BAND, which must keep its height across the days it spans; a run is
   * one element on one row, and the days it does not cross owe it nothing.
   */
  function runRowsOver(series: readonly { lane: number; colStart: number; colEnd: number }[], di: number): number {
    let n = 0;
    for (const s of series) {
      if (s.colStart <= di + 1 && di + 1 < s.colEnd) n = Math.max(n, s.lane + 1);
    }
    return n;
  }

  /** How many run rows the week needs at all — one more than its last lane. */
  function runRowCount(series: readonly { lane: number }[]): number {
    let n = 0;
    for (const s of series) n = Math.max(n, s.lane + 1);
    return n;
  }

  /* THE LEGEND IS NOT A FILTER ANY MORE (ADR-095 §3). Its project entries were
     the month's own narrowing machine — a second one, a hundred pixels under
     the scope bar that already does exactly this. What the legend keeps is the
     part the drawing cannot say on its own (solid / dashed / `!`), and even
     that leaves the sheet: its subject is the grammar of all four views, not
     the month, and the foot of a drawing three screens tall is where nobody
     who needs teaching will ever arrive. */

  /* ── ONE RULE FOR WHAT LASTS (tarea 165, the drawing of 16-11) ────────
     «Lo que pasa en un día es una línea dentro del día. Lo que dura es una
     barra que cruza los días, siempre en el mismo sitio: debajo de los
     números y encima de las líneas.»

     There used to be four kinds of band, each with its own drawing and its
     own words, at two different heights: the run of days with its per-day
     hours under the numbers, and absences and tours at the FOOT of the week
     with dates, arrows and «inferred · out · back». Now every one of them is
     the same one-line bar in the same rows: a run of days, a tour, a company
     closure and — only while «Quién falta» is on — a person's absence. The
     bar says once what it is, where it starts; its length says how long. A
     bar that comes from last week enters cut on the left, one that goes on
     leaves cut on the right. */
  type WeekBand = {
    key: string;
    kind: 'closed' | 'absence' | 'tour';
    colStart: number;
    colEnd: number;
    /** Who (a person), where (a tour), or whose (a closure). */
    subject: string;
    /** The whole sentence: the title keeps what the bar no longer prints. */
    label: string;
    tentative: boolean;
    /** The person was booked on a confirmed gig inside the absence. */
    hit: boolean;
    accent: string | null;
    initials: string | null;
    projectName: string | null;
    cutLeft: boolean;
    cutRight: boolean;
  };
  /* ONE CLOSURE, NOT FIVE. A company that wrote down «maintenance», «a
     workshop» and «a festival» over the same fortnight is closed over that
     fortnight: overlapping or touching closures of one company draw as one
     bar, and the title keeps every reason. Seen on real data (the demo
     space, 9–19 Nov: five bars stacked over one week). It is «not sure»
     only if every closure in it is. */
  let closures = $derived.by((): BlackoutBandVM[] => {
    const list = blackouts.filter((b) => b.company).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const out: BlackoutBandVM[] = [];
    for (const b of list) {
      const whose = (o: BlackoutBandVM) => o.workspaceId ?? o.subject;
      const prev = out.findLast((o) => whose(o) === whose(b));
      if (prev && b.from <= nextIso(prev.to)) {
        if (b.to > prev.to) prev.to = b.to;
        prev.tentative = prev.tentative && b.tentative;
        prev.note = [prev.note, b.note].filter(Boolean).join(' · ') || null;
      } else {
        out.push({ ...b });
      }
    }
    return out;
  });
  function weekBands(week: { iso: string }[]): WeekBand[] {
    const first = week[0].iso;
    const last = week[6].iso;
    const out: WeekBand[] = [];
    const clip = (from: string, to: string) => {
      if (to < first || from > last) return null;
      const a = week.findIndex((d) => d.iso === (from < first ? first : from)) + 1;
      const b = week.findIndex((d) => d.iso === (to > last ? last : to)) + 2;
      return a < 1 || b < 2 ? null : { a, b, cutLeft: from < first, cutRight: to > last };
    };
    [...closures, ...blackouts.filter((b) => !b.company)].forEach((bo, i) => {
      if (!bo.company && !showAbsences) return;
      const c = clip(bo.from, bo.to);
      if (!c) return;
      out.push({
        key: `bo:${bo.id ?? i}:${first}`,
        kind: bo.company ? 'closed' : 'absence',
        colStart: c.a,
        colEnd: c.b,
        subject: bo.subject ?? bo.label,
        label: bo.note ? `${bo.label} · ${bo.note}` : bo.label,
        tentative: bo.tentative,
        hit: Boolean(bo.hit) && !bo.tentative,
        accent: null,
        initials: null,
        projectName: null,
        cutLeft: c.cutLeft,
        cutRight: c.cutRight,
      });
    });
    aways.forEach((aw, i) => {
      const c = clip(aw.from, aw.to);
      if (!c) return;
      out.push({
        key: `tour:${aw.project_id}:${i}:${first}`,
        kind: 'tour',
        colStart: c.a,
        colEnd: c.b,
        // A tour names its PLACE; when nobody wrote it down, nothing is invented.
        subject: aw.place ?? '',
        // That it was deduced, and from which two trips, stays in the title.
        label: `${aw.label}${aw.place ? ` · ${aw.place}` : ''} · ${deducedPhrase(aw.deduced)}`,
        tentative: false,
        hit: false,
        accent: aw.accent,
        initials: aw.initials,
        projectName: aw.projectName,
        cutLeft: c.cutLeft,
        cutRight: c.cutRight,
      });
    });
    return out.sort((a, b) => a.colStart - b.colStart || b.colEnd - a.colEnd);
  }

  /** Two absences a week, then «+N más» (Marco, «Sí, las siete», 16-11): a big
      cast with many absences would otherwise stack five bars over the week. */
  const ABSENCE_CAP = 2;

  type Bar =
    | { kind: 'run'; key: string; lane: number; colStart: number; colEnd: number; run: WeekSeries }
    | { kind: 'band'; key: string; lane: number; colStart: number; colEnd: number; band: WeekBand }
    | { kind: 'more'; key: string; lane: number; colStart: number; colEnd: number; n: number; title: string };

  /**
   * LANES ARE PACKED, NOT STACKED: two bars that do not share a day share a
   * row. The work of the company (closures, runs, tours) packs first; the
   * absences pack in the rows under it, so «who is out» never slips between
   * a residency and the tour beside it.
   */
  function packLanes(list: Bar[], from: number): number {
    const rows: Array<Array<[number, number]>> = [];
    for (const b of list) {
      let lane = rows.findIndex((r) => r.every(([a, z]) => b.colEnd <= a || b.colStart >= z));
      if (lane === -1) lane = rows.push([]) - 1;
      rows[lane].push([b.colStart, b.colEnd]);
      b.lane = from + lane;
    }
    return from + rows.length;
  }

  function weekBars(week: { iso: string }[]): Bar[] {
    const bands = weekBands(week);
    const work: Bar[] = [
      ...bands
        .filter((b) => b.kind === 'closed')
        .map((band): Bar => ({ kind: 'band', key: band.key, lane: 0, colStart: band.colStart, colEnd: band.colEnd, band })),
      ...weekSeries(week).map((run): Bar => ({ kind: 'run', key: run.key, lane: 0, colStart: run.colStart, colEnd: run.colEnd, run })),
      ...bands
        .filter((b) => b.kind === 'tour')
        .map((band): Bar => ({ kind: 'band', key: band.key, lane: 0, colStart: band.colStart, colEnd: band.colEnd, band })),
    ];
    const next = packLanes(work, 0);
    const absent = bands.filter((b) => b.kind === 'absence');
    const shown: Bar[] = absent
      .slice(0, ABSENCE_CAP)
      .map((band): Bar => ({ kind: 'band', key: band.key, lane: 0, colStart: band.colStart, colEnd: band.colEnd, band }));
    const rest = absent.slice(ABSENCE_CAP);
    if (rest.length > 0) {
      shown.push({
        kind: 'more',
        key: `more:${week[0].iso}`,
        lane: 0,
        colStart: Math.min(...rest.map((b) => b.colStart)),
        colEnd: Math.max(...rest.map((b) => b.colEnd)),
        n: rest.length,
        title: rest.map((b) => b.label).join('\n'),
      });
    }
    packLanes(shown, next);
    return [...work, ...shown];
  }

  /** Lanes in use across a whole week row — every cell reserves this many
   *  slots so a lane sits at the same height in every day of the week. */
  /* THE DENSITY ROW IS GONE, and it went by Marco's own hand: «sé que estos
     puntos estaban en el diseño, pero no veo que realmente funcionen».

     Seven marks per week in four textures — solid, ring, rule, faint dot —
     asked the reader to hold a four-symbol legend in order to learn what the
     SEVEN CELLS BESIDE THEM already say at full size, in words, with names on
     them. It is a miniature of the drawing it is printed next to, and a month
     is not a chart that needs a sparkline. The counts it summarised survive
     where they are read: the meta band, once, for the whole window.

     `tourDays` went with it — it had no other reader — and so did the four
     count words that only its tooltip needed. */

  /**
   * The week is as tall as its FULLEST day, so a quiet week is visibly short
   * without drawing anything to say so. Four steps, and the cap is what makes
   * them mean something (see CELL_CAP).
   *
   * Out-of-month days count too, on purpose: without them a week whose only
   * slip falls on the 1st of the next month asks for 32% of a cell and the
   * slip comes out taller than the row.
   */
  const WEEK_FILL = [0.34, 0.62, 0.85, 1];
  function weekFill(week: { iso: string }[]): number {
    let max = 0;
    for (const d of week) {
      // A run of days is NOT in the cell — it is the week's own band, on its
      // own row. Counting it here asked for a full-height cell to hold
      // nothing, so a week whose only content was one rehearsal block drew as
      // tall as the busiest week of the month (seen on screen, 2026-07-31).
      const inCell = (datesByDay.get(d.iso) ?? []).filter((x) => !isSeriesBand([x])).length;
      const perfsInCell = (performancesByDay.get(d.iso) ?? []).filter(
        (x) => !isRun(x.series_id),
      ).length;
      const n = perfsInCell + inCell;
      max = Math.max(max, Math.min(n, CELL_CAP));
    }
    return WEEK_FILL[max];
  }

  /* THE HOVERED DAY, in state and not in CSS. A cell is TWO grid items — the
     number row and the contents, with any run of days between them — so no
     single element can carry a `:hover` that means «this day» without also
     lighting the other six. One string, set by both halves. */
  let hoverDay = $state<string | null>(null);

  /* CREAR EN EL HUECO (ADR-139, después). El clic suelto sigue sin abrir nada;
     el doble clic y la pulsación larga en el hueco libre de un día de esta
     hoja van a la misma puerta que su «+» (`$lib/cell-create`). Las dos
     mitades de la celda —la fila del número y el contenido— responden igual,
     como ya comparten el hover. */
  type GridDay = { iso: string };
  function createHere(e: MouseEvent, day: GridDay) {
    if (!onDayCreate || !isFreeSpace(e.target, e.currentTarget as Element)) return;
    window.getSelection()?.removeAllRanges();
    onDayCreate(day.iso);
  }
  /** The second press of a double click would select the nearest word. */
  function keepSelection(e: MouseEvent, day: GridDay) {
    if (onDayCreate && e.detail > 1 && isFreeSpace(e.target, e.currentTarget as Element)) {
      e.preventDefault();
    }
  }
  function cellPress(day: GridDay): Attachment<HTMLElement> | undefined {
    if (!onDayCreate) return undefined;
    const create = onDayCreate;
    return longPress(() => create(day.iso));
  }

  // ── Clash-card popover — one open at a time, keyed by day. ──────────────
  let openClash = $state<string | null>(null);
  let gridEl: HTMLElement | undefined = $state();

  function toggleClash(iso: string) {
    openClash = openClash === iso ? null : iso;
  }
  /** Red before blue: a person double-booked or booked across an absence
      outranks a tentative absence, which outranks a maybe. */
  const SEVERITY_RANK: Record<ClashVM['severity'], number> = {
    people: 0,
    blackout: 1,
    'blackout-tentative': 2,
    possible: 3,
  };
  function worstSeverity(list: ClashVM[]): ClashVM['severity'] {
    return list.reduce((w, c) => (SEVERITY_RANK[c.severity] < SEVERITY_RANK[w] ? c.severity : w), list[0].severity);
  }

  $effect(() => {
    if (!openClash || !gridEl) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.cal__clashcard') && !t.closest('.cal__mark')) openClash = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openClash = null;
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<!-- THE CELL IS NOT A DOOR ANY MORE (Marco, 2026-07-31), and this is a
     simplification with teeth. It used to be: click anywhere the click did not
     land on something else, and a create dialog opened. That makes every
     harmless gesture in the sheet — a stray click while reading, a click to
     dismiss a popover, a drag that ends nowhere — a request to make a gig.
     An affordance that fires on «you did not hit anything» is not an
     affordance, it is a tripwire.
     The invitation is now ONE explicit control, in the cell's header, and it
     is the only thing a single click opens the dialog with. The deliberate
     gestures (a double click or a long press on the free space, `N` on a
     focused day) reach the same door: none of them can happen by accident. -->
<div
  class="cal__grid"
  class:cal__grid--loading={loading}
  role="group"
  tabindex="-1"
  aria-label={label}
  bind:this={gridEl}
>
  <!-- THE WEEKDAY AXIS NEVER GOES. It costs fourteen pixels once for the whole
       sheet, and there is no weekend wash by law — in this trade Saturday is
       the best working day — so without the names you cannot tell which column
       is Saturday except by counting from a number. The axis is the reading. -->
  <div class="cal__wkh">
    {#each wkLabels as wd, i (i)}
      <span class="cal__weekday"><span class="cal__wd--l">{wd}</span><span class="cal__wd--s">{wd.slice(0, 1)}</span></span>
    {/each}
  </div>
  {#each weeks as week, wi (wi)}
    {@const bars = weekBars(week)}
    {@const m1 = firstCol(week)}
    {@const m0 = wi > 0 ? firstCol(weeks[wi - 1]) : -1}
    <!-- A ROW OF THE MONTH IS A WEEK, with no gutter and no number
         (ADR-209): the week is the stronger rule above its Monday. -->
    <div class="cal__wk" style="--wf: {weekFill(week)}" data-mon={week[0].iso}>
      <!-- ONE GRID PER WEEK, THREE BANDS OF ROWS: the day numbers on row 1,
           the runs of days under them, and the day cells on the last row —
           all of them placed, none of them auto-flowed. A run belongs
           BETWEEN the number and the day's own contents: above the number it
           reads as a header for the week, below the contents it lands under
           the `+N more` door. It is the frame the days sit inside. -->
      <!-- EL CUERPO DE LA SEMANA: las celdas y su pie, dentro del mismo
           reglado. Las siete verticales eran un gradiente sobre `.cal__wkc`,
           que es solo la fila de celdas, así que las líneas morían encima de
           la banda y una ausencia se leía como algo pegado por debajo del mes
           en vez de como parte de los días que mide (Marco, en pantalla,
           2026-08-29). La regla sube aquí: no se duplica, se muda. -->
      <div
        class="cal__wkbody"
        class:cal__wkbody--m1={m1 >= 0}
        class:cal__wkbody--m0={m0 > 0}
        style="--m1: {m1}; --m0: {m0}"
      >
      <div class="cal__wkc">
        {#each week as day, di (day.iso)}
          {@const clashes = clashesByDay?.get(day.iso) ?? []}
          <div
            class="cal__num"
            class:cal__day--today={day.iso === todayIso}
            class:cal__day--alt={altMonth(day.iso)}
            class:cal__day--past={day.iso < todayIso}
            class:cal__day--sel={narrow && picked === day.iso}
            data-month-start={day.iso.endsWith('-01') ? day.iso.slice(0, 7) : undefined}
            data-hover={hoverDay === day.iso ? '' : undefined}
            style="grid-row: 1; grid-column: {di + 1}"
            data-day={day.iso}
            onmouseenter={() => (hoverDay = day.iso)}
            onmouseleave={() => (hoverDay = hoverDay === day.iso ? null : hoverDay)}
            onmousedown={(e) => keepSelection(e, day)}
            ondblclick={(e) => createHere(e, day)}
            {@attach cellPress(day)}
            role="presentation"
          >
            <span class="cal__day-head">
              <!-- A DAY OUTSIDE THE MONTH DRAWS ITS CONTENT AND NEVER ITS
                   NUMBER (ADR-095). It used to do the opposite — number and
                   grey wash, the noise without the information. The ABSENCE
                   of the number is the whole of the mark, and there is no
                   fade: a weaker CLAIM is not fainter INK. -->
              <!-- THREE SLOTS, ALWAYS, so the middle one is a real centre and
                   not «whatever is left». A quiet day draws no mark but keeps
                   its column. -->
              <!-- THE 1ST CARRIES ITS MONTH, not its number (ADR-209). -->
              {#snippet dayWord()}{#if day.iso.endsWith('-01')}{@const mw = monthWords(day.iso)}<span
                    class="cal__mname cal__mname--l">{mw.long}</span
                  ><span class="cal__mname cal__mname--s">{mw.short}</span>{:else}{Number(day.iso.slice(8, 10))}{/if}{/snippet}
              {#if onDayOpen}
                <button
                  type="button"
                  class="cal__day-num"
                  title={openDayLabel(day.iso)}
                  aria-label={openDayLabel(day.iso)}
                  onclick={() => openOrPick(day.iso)}>{@render dayWord()}</button
                >
              {:else}
                <span class="cal__day-num">{@render dayWord()}</span>
              {/if}
              {#if onDayCreate}
                <button
                  type="button"
                  class="cal__new"
                  aria-label={createLabel(day.iso)}
                  onclick={() => onDayCreate?.(day.iso)}>+</button
                >
              {:else}
                <span></span>
              {/if}
              <!-- ONE MARK A DAY, AT MOST (tarea 165): its colour is the worst
                   of the day's clashes, and it opens all of them. Six red and
                   blue dots on one number said less than one. -->
              <span class="cal__marks">
                {#if clashes.length > 0}
                  <button
                    type="button"
                    class="cal__mark"
                    data-severity={worstSeverity(clashes)}
                    aria-label={clashes.map((c) => c.title).join(' · ')}
                    aria-expanded={openClash === day.iso}
                    onclick={() => toggleClash(day.iso)}></button
                  >
                {/if}
              </span>
            </span>
            {#if openClash === day.iso}
              <!-- Bottom rows open upward: a downward card would run off
                   the foot of the sheet. -->
              <ClashCard list={clashes} up={wi >= weeks.length - 2} flip={di >= 5} />
            {/if}
          </div>
        {/each}
        <!-- THE BARS: everything that lasts, under the numbers and over the
             day's lines, one line each. -->
        {#each bars as bar (bar.key)}
          {@const style = `grid-row: ${bar.lane + 2}; grid-column: ${bar.colStart} / ${bar.colEnd}`}
          {#if bar.kind === 'run'}
            {@const s = bar.run}
            <!-- EACH DAY OF THE BAR IS ITS OWN DOOR. The bar is one line, but a
                 run is per-day rows: a press on Friday opens Friday's row —
                 a link for a gig (it has a page), the dialog for a date. -->
            <span
              class="cal__bar cal__run"
              class:cal__bar--cutl={s.cutLeft}
              class:cal__bar--cutr={s.cutRight}
              data-family={s.cert}
              {style}
              title={s.title}
            >
              {#if s.project}
                <IdentityMark
                  mini
                  accent={accentVarFor(s.project)}
                  name={s.project.name}
                  initials={s.project.initials}
                />
              {/if}
              <b class="cal__bar-n">{s.label}</b>
              {#if s.city}<span class="cal__bar-p">{s.city}</span>{/if}
              <span class="cal__bar-doors" style="grid-template-columns: repeat({s.cells.length}, minmax(0, 1fr))">
                {#each s.cells as c (c.iso)}
                  {#if c.filled && c.href}
                    <a class="cal__bar-door" href={c.href} aria-label="{s.label} · {c.iso}" title="{s.title} · {c.iso}"></a>
                  {:else if c.filled && c.open}
                    <button
                      type="button"
                      class="cal__bar-door"
                      aria-label="{s.label} · {c.iso}"
                      title="{s.title} · {c.iso}"
                      onclick={c.open}
                    ></button>
                  {:else}
                    <span></span>
                  {/if}
                {/each}
              </span>
            </span>
          {:else if bar.kind === 'band'}
            {@const b = bar.band}
            <span
              class="cal__bar cal__bar--{b.kind}"
              class:cal__bar--cutl={b.cutLeft}
              class:cal__bar--cutr={b.cutRight}
              class:cal__bar--tent={b.tentative}
              class:cal__bar--hit={b.hit}
              data-testid="month-bar-{b.kind}"
              style="{style}{b.accent ? `; --c: ${b.accent}` : ''}"
              title={b.label}
            >
              {#if b.kind === 'tour'}
                {#if b.accent}
                  <IdentityMark mini accent={b.accent} name={b.projectName} initials={b.initials} />
                {/if}
                <span class="cal__bar-w">{tourWord}</span>
                {#if b.subject}<span class="cal__bar-p">{b.subject}</span>{/if}
              {:else if b.kind === 'closed'}
                <span class="cal__bar-w cal__bar-w--l">{closedWord}{#if b.tentative}?{/if}</span><span
                  class="cal__bar-w cal__bar-w--s">{closedShortWord}{#if b.tentative}?{/if}</span
                >
              {:else}
                <span class="cal__bar-n">{b.subject}{#if b.tentative}?{/if}</span>
              {/if}
            </span>
          {:else}
            <span class="cal__bar cal__bar--more" data-testid="month-bar-more" {style} title={bar.title}
              >{moreAbsentLabel(bar.n)}</span
            >
          {/if}
        {/each}
    {#each week as day, di (day.iso)}
      {@const perfs = performancesByDay.get(day.iso) ?? []}
      {@const runRows = runRowsOver(bars, di)}
      {@const runLanes = runRowCount(bars)}
      {@const dateGroups = groupDates(datesByDay.get(day.iso) ?? [])}
      {@const entries = cellSlips(perfs, dateGroups)}
      {@const overflow = entries.length - CELL_CAP}
      {@const lead = entries.slice(0, CELL_CAP)}
      {@const cf = clashFlags(lead, clashesByDay?.get(day.iso) ?? [])}
      <!-- A DATE IS A PLACE, SO A NEW DATE IS MADE AT THE PLACE (ADR-095 §7).
           THE CELL ITSELF is the door — not a button laid over its foot. The
           old `+` was absolute, reserved 16px of a foot that reserves 10, and
           covered the bottom half of anything below it: clicks meant for one
           control fired the other. `opacity: 0` hides a thing; it does not stop
           it being hit. The hint is a `::after` with no pointer-events, and the
           handler only fires when the click landed on nothing else.
           And the door is THIS MONTH'S only: you cannot point at a day that is
           not on this sheet and mean it. -->
      <div
        class="cal__day"
        class:cal__day--today={day.iso === todayIso}
        class:cal__day--alt={altMonth(day.iso)}
        class:cal__day--past={day.iso < todayIso}
        class:cal__day--sel={narrow && picked === day.iso}
        style="grid-row: {runRows + 2} / {runLanes + 3}; grid-column: {di + 1}"
        data-day={day.iso}
        onmouseenter={() => (hoverDay = day.iso)}
        onmouseleave={() => (hoverDay = hoverDay === day.iso ? null : hoverDay)}
        onmousedown={(e) => keepSelection(e, day)}
        ondblclick={(e) => createHere(e, day)}
        {@attach cellPress(day)}
        onclick={(e) => {
          if (narrow && !(e.target as HTMLElement).closest('button, a')) pick(day.iso);
        }}
        role="presentation"
      >
        {#if gapByDay.get(day.iso)}
          {@const n = gapByDay.get(day.iso) ?? 0}
          <span class="cal__gap"
            ><span class="cal__gap--l">{gapLabel(n)}</span><span class="cal__gap--s">{gapShortLabel(n)}</span></span
          >
        {/if}
        <!-- Three, then a door. The cap is what lets a quiet week look short:
             the row is as tall as its fullest day, and without it that day can
             hold nine things. -->
        {#each lead as entry, ei (entry.key)}
          <!-- MONOGRAMS ALWAYS (ADR-209): with the city where the cell gives
               room, the monogram alone (stacked) where it does not. -->
          <Slip
            slip={entry.slip}
            placing="compact"
            ground="bare"
            kindLabel={(k, voice) => dateKindLabel(k, voice)}
            stateLabel={slipState}
            stateUrgent={isUrgentHold(entry.slip)}
            showCountry={false}
            clash={cf.on[ei] ? (cf.hard[ei] ? 'hard' : 'soft') : 'none'}
            clashPeople={cf.people[ei]}
            absent={showAbsences && Boolean(absenceHitIds?.has(entry.slip.id))}
            onMarkOpen={openMark}
            onOpen={entry.dateRow && onDateOpen ? () => onDateOpen?.(entry.dateRow!) : undefined}
          />
        {/each}
        {#if overflow > 0}
          <!-- The door is the Day, like the steps' below: the rest of a full
               cell is read there, not added to (it opened the quick add). -->
          <button
            type="button"
            class="cal__more cal__more--l"
            data-testid="month-more"
            disabled={!onDayOpen}
            onclick={() => onDayOpen?.(day.iso)}>+{overflow} {moreLabel}</button
          >
        {/if}
        <!-- Two and «+1» on a phone: the third slip steps aside (CSS). -->
        {#if entries.length > CELL_CAP_NARROW}
          <span class="cal__more cal__more--s" aria-hidden="true">+{entries.length - CELL_CAP_NARROW}</span>
        {/if}

      </div>
    {/each}
      </div>
      </div>
    </div>
    {#if narrow && picked && week.some((d) => d.iso === picked)}
      {@const iso = picked}
      {@const list = pickedEntries(iso)}
      <!-- The picked day, whole, under its week (ADR-209). -->
      <div class="cal__pick" data-testid="month-pick">
        <h3 class="cal__pick-h">
          {localeWeekdayShort(iso, locale)} {Number(iso.slice(8, 10))} {localeMonthShort(iso, locale)}
          {#if onDayOpen}
            <button type="button" class="cal__pick-go" onclick={() => onDayOpen?.(iso)}
              aria-label={openDayLabel(iso)}
              >{openDayWord} →</button
            >
          {/if}
        </h3>
        {#each list as entry (entry.key)}
          <Slip
            slip={entry.slip}
            placing="row"
            absent={showAbsences && Boolean(absenceHitIds?.has(entry.slip.id))}
            kindLabel={(k, voice) => dateKindLabel(k, voice)}
            stateLabel={slipState}
            stateUrgent={isUrgentHold(entry.slip)}
            onOpen={entry.dateRow && onDateOpen ? () => onDateOpen?.(entry.dateRow!) : undefined}
          />
        {/each}
      </div>
    {/if}
  {/each}
  <div class="cal__foot" bind:this={footEl} aria-hidden="true"></div>
</div>

{#if markPop}
  <div class="cal__markpop" bind:this={markPopEl} style={markPopStyle(markPop.rect)}>
    <IdentityQuickPanel
      project={markPop.project}
      siblings={markSiblings}
      onclose={() => (markPop = null)}
    />
  </div>
{/if}

<style>
  @layer components {
    /* THE SHEET · a stack of week blocks, not one flat grid of 42 cells.
       A row of the month IS a week, and a week that has to carry a gutter, a
       density row and a band spanning columns cannot be seven loose cells of
       somebody else's grid. */
    /* THE SHEET IS NOT A WIDGET. It had a 1px border, a large radius,
       `overflow: hidden` and a card fill — a rounded panel sitting on the
       page, which is the shape of a component and not the shape of a month.
       The design draws PAPER: the rules of the grid are the only lines, the
       ground is the page's own, and nothing is clipped at a corner. The fill
       also broke the column ruling — the cells painted `--card` OVER the
       gradient that draws the seven verticals (see `.cal__wkc`). */
    /* LA REJILLA NO ANIMA SU COLOR, Y ESTO ARREGLA EL FLASH.
       `:where(html, body, *)` en base.css da a TODO elemento
       `transition: background-color, color, border-color` — pensado para que
       un cambio de tema funda en vez de saltar. El efecto colateral: cada
       hairline anima su color cuando cambia por cualquier motivo, incluido que
       Svelte reutilice el elemento al pasar de mes. La interpolación arranca
       en tinta plena y baja hasta el 9% del token, así que durante ~0,2s se
       pinta una regla SEIS VECES más oscura cruzando la hoja entera. Marco lo
       vio tres veces y no se reproducía: es un transitorio, y solo apareció
       ralentizando la CPU a 1/8 y midiendo píxeles —el DOM decía «0.547 de
       alfa en oklab», que es una interpolación en vuelo—.
       Una pauta de calendario es ESTRUCTURA, no estado: no tiene nada que
       fundir. El apagado es local a propósito; estrechar la regla global es
       otra conversación (`_tasks.md § 39`). */
    .cal__wk,
    .cal__wkh,
    .cal__wkbody,
    .cal__wkc,
    .cal__day {
      transition: none;
    }

    .cal__grid {
      /* A compact card is one line (ADR-209): three of them and the number
         make a full day. Lines and not boxes since the drawing of 16-11, so
         the full day is three lines of the body's small step and its foot. */
      --cal-cell-h: 4rem;
      /* The air between a card and the column rule beside it. One number,
         because the day cell and the run that crosses it have to agree —
         they are siblings of the week grid, not parent and child. */
      /* Measured: at 5px the cell keeps a slip above its 142px step (the end
         hour stays); a step of the space scale crossed it. Exact, in rem. */
      --cal-cell-pad: 0.3125rem;
      display: flex;
      flex-direction: column;
      transition: opacity var(--transition);
    }
    /* THE SHEET IS CLOSED ON BOTH SIDES (the drawing, 16-11): the column
       rules sit on each day's right edge, so the first column had none on
       its left and the month read open there. The axis and every week carry
       the left edge; the axis shares the day rules, so its words sit in the
       columns they name. Its foot is the first week's own top rule. */
    .cal__wkh {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      margin-block-start: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
      /* THE AXIS STAYS, under the stuck title (Marco, 16-11): mid-month the
         title says which month and the axis which column is Saturday. The
         page measures where it sticks; the weeks pass under it. */
      position: sticky;
      inset-block-start: var(--month-axis-top, var(--header-height));
      z-index: 2;
      background-color: var(--bg);
    }
    .cal__wkh,
    .cal__wkbody {
      border-inline-start: var(--line-hairline) solid var(--border-color-light);
      background-image: linear-gradient(to right, var(--border-color-light) 0 1px, transparent 1px);
      background-size: calc(100% / 7) 100%;
      background-position: -1px 0;
      background-repeat: repeat-x;
    }
    /* THE WEEK IS A RULE, NOT A COLUMN (ADR-209): the line above each
       Monday is one step stronger than the day rules. */
    .cal__wk {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      border-block-start: var(--line-hairline) solid var(--border-color-dark);
    }
    /* The seven days. The 1px rules ARE the grid — a background-image column
       ruling, so a cell can never be pushed out of alignment by a border. */
    .cal__num {
      position: relative;
      min-inline-size: 0;
      padding: var(--space-xs) var(--space-xs) var(--space-2xs);
    }

    /* ── THE BAR · everything that lasts, one line (tarea 165) ──────────
       A run of days, a tour, a company closure and a person's absence draw
       the same object in the same rows: under the numbers, over the day's
       lines. The bar says once what it is, where it starts, and its length
       says how long. Its air is the cell's own, so a bar and a line on the
       day beside it begin on the same edge. */
    .cal__bar {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      min-inline-size: 0;
      margin: var(--line-hairline) var(--cal-cell-pad) var(--space-2xs);
      padding: var(--line-hairline) var(--space-xs);
      border: var(--line-hairline) solid transparent;
      border-radius: var(--radius-xs);
      font: inherit;
      font-size: var(--text-xs);
      line-height: 1.3;
      color: var(--text-color);
      text-align: start;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
    }
    .cal__run {
      position: relative;
    }
    .cal__bar-doors {
      position: absolute;
      inset: 0;
      display: grid;
    }
    .cal__bar-door {
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
    }
    .cal__bar-door:hover {
      background: color-mix(in oklch, var(--text-color) 6%, transparent);
    }
    .cal__bar-door:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: calc(-1 * var(--focus-width));
    }
    .cal__bar :global(.mark) {
      flex: none;
    }
    .cal__bar-n {
      font-weight: 400;
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cal__bar-p {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: var(--text-2xs);
      color: var(--text-muted);
    }
    .cal__bar-w {
      flex: 0 1 auto;
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
    }
    /* A BAR THAT GOES ON IS OPEN ON THAT SIDE (Marco, 2026-08-30): closing
       both halves of a ten-day run claims two ends that do not exist. The
       margin goes with the edge, so the open side meets the column rule. */
    .cal__bar--cutr {
      margin-inline-end: 0;
      border-inline-end-width: 0;
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }
    .cal__bar--cutl {
      margin-inline-start: 0;
      border-inline-start-width: 0;
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }

    /* The work that lasts: the slip's own paper and edge, because a run IS a
       slip with a longer life. */
    .cal__run {
      background: var(--bg-ultra-light);
      border-color: color-mix(in oklch, var(--text-color) 15%, var(--border-color-light));
    }
    /* …and the same certainty grammar, so a tentative run says «not sure» at
       exactly the volume a tentative gig does. */
    .cal__run[data-family='hold'],
    .cal__run[data-family='proposed'] {
      border-style: dashed;
      border-color: color-mix(in oklch, var(--text-color) 13%, var(--border-color-light));
    }
    .cal__run[data-family='hold'] .cal__bar-n,
    .cal__run[data-family='proposed'] .cal__bar-n {
      font-style: italic;
      color: var(--text-muted);
    }
    .cal__run[data-family='released'] {
      border-style: dotted;
      background: transparent;
    }
    .cal__run[data-family='released'] .cal__bar-n {
      text-decoration: line-through;
      color: var(--text-faint);
    }

    /* A tour wears its company's colour: a tinted ground and a stronger edge
       where it starts. It was deduced from two trips, and the title says so. */
    .cal__bar--tour {
      --c: var(--text-muted);
      background: color-mix(in oklch, var(--c) 14%, var(--bg));
      border-inline-start: var(--line-thick) solid var(--c);
    }
    .cal__bar--tour.cal__bar--cutl {
      border-inline-start-width: 0;
    }

    /* The company is closed: the hatch is kept for this and only this, and it
       draws whichever question you are asking — it affects them all. */
    .cal__bar--closed {
      background: repeating-linear-gradient(
        135deg,
        var(--bg) 0 4px,
        var(--border-color-light) 4px 5px
      );
      border-color: var(--border-color-light);
      color: var(--text-muted);
    }
    .cal__bar-w--s {
      display: none;
    }
    .cal__bar--closed.cal__bar--tent {
      border-style: dashed;
      border-color: var(--text-muted);
      font-style: italic;
    }

    /* A person who is out: their name on a quiet ground. Not sure yet, and
       the bar leans, dashes and asks «?». Booked on a confirmed gig, and it
       goes red (Marco, «Sí, en rojo», 16-11). */
    .cal__bar--absence {
      background: var(--border-color-light);
      border-color: var(--border-color-light);
    }
    .cal__bar--absence.cal__bar--tent {
      background: none;
      border-style: dashed;
      border-color: var(--text-muted);
      color: var(--text-muted);
      font-style: italic;
    }
    .cal__bar--absence.cal__bar--hit {
      border-color: var(--danger);
      color: var(--danger);
      background: color-mix(in oklch, var(--danger) 10%, var(--bg));
    }
    .cal__bar--more {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-m);
      color: var(--text-muted);
    }

    /* Las siete verticales viven AQUÍ y no en la fila de celdas, para que
       lleguen hasta abajo del día — el pie de la semana es parte del día que
       mide, no una tira suelta debajo del mes. */
    .cal__wkbody {
      min-inline-size: 0;
    }
    .cal__wkc {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      align-items: stretch;
    }

    .cal__grid--loading {
      opacity: 0.6;
    }

    /* The weekday axis is a LABEL, not a header bar: a filled band turns the
       row into a table chrome the month does not have. One hairline under it
       is the whole of the separation. */
    /* Its inset is the day number's, so the word and the number under it
       start on one line. A phone's cell takes the initial (the drawing). */
    .cal__weekday {
      padding: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-xl);
      color: var(--text-faint);
      text-transform: uppercase;
    }

    .cal__day {
      /* The CELL decides what a slip can afford — measured, never declared. */
      container-type: inline-size;
      position: relative;
      min-block-size: calc(var(--cal-cell-h) * var(--wf, 1));
      min-inline-size: 0;
      display: flex;
      flex-direction: column;
      /* THE FOOT RESERVES THE HINT, it does not lend it space. The hint is
         10px tall at `bottom: 1px` — eleven — and the foot only held back
         nine, so on a full cell it printed straight over the last card.
         An affordance that covers the thing it is offered beside is worse
         than no affordance: you cannot read what is already there.
         (Marco asked to see this exact case before trusting it. He was
         right to: 2026-07-31, day 9, two gigs and a clash.) */
      padding: var(--line-hairline) var(--cal-cell-pad) var(--space-s);
      row-gap: var(--space-2xs);
      overflow: hidden;
    }

    /* ── THE INVITATION · one `+`, dead centre, only under the pointer ─
       Three placings were tried before this one. Laid over the FOOT with a
       `::after` it printed across the last card on a full day — an affordance
       that covers the thing it is offered beside is worse than none, because
       you can no longer read what is already there. In flow at the foot it
       stopped overlapping but sat under the day's contents, which is not
       where you point. At the header's right edge it queued behind the marks.

       The number row is the one strip of a cell that is ALWAYS reserved and
       never fills: a number, and at most two marks. The middle of it is empty
       in every cell of every month, so that is where the `+` goes — and it is
       a bare glyph, no box, because a chip in a header full of 9px marks
       reads as a fourth kind of badge. */
    .cal__new {
      justify-self: center;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-s);
      line-height: 1;
      /* THE LINE TOKEN, not an ink one — and it is a token, not a bespoke
         mix. `--border-color-dark` is the neutral at 18% alpha: the value
         this app uses for «a line you can just see», which is the whole
         register of a glyph that only has to be findable. It is an OFFER
         sitting in a row of FACTS (the date, the marks), so it must be the
         quietest thing there even while it is the only one that moves. */
      color: var(--border-color-dark);
      cursor: pointer;
      /* Unseen, NOT unreachable (móvil #2): `visibility: hidden` also took it
         out of the keyboard, so `:focus-visible` below could never fire. */
      opacity: 0;
      transition: color var(--duration-fast);
    }
    .cal__num[data-hover] .cal__new,
    .cal__num:focus-within .cal__new,
    .cal__new:focus-visible {
      opacity: 1;
    }
    /* A finger has no hover: an invisible target is a tripwire there. On
       touch a day is made by a long press on its free space
       (`$lib/cell-create`), or from the Day view or «+ date». */
    @media (pointer: coarse) {
      .cal__new {
        display: none;
      }
    }
    .cal__new:hover {
      color: var(--text-color);
    }

    .cal__more {
      align-self: flex-start;
      margin-block-start: var(--space-2xs);
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__more:hover {
      color: var(--text-muted);
    }
    .cal__more:disabled {
      cursor: default;
      color: var(--text-faint);
    }
    /* ── THE MONTH'S OWN MARKS (ADR-209) ─────────────────────────────── */
    /* Every other month on a ground one step darker. The ground is
       translucent, so the day rules under it (`.cal__wkbody`) show through:
       a rule of its own doubled them. */
    .cal__day--alt {
      background-color: var(--month-alt-ground);
    }
    /* A hole to sell is SAID, not hatched (tarea 165): its length, in the
       margin voice, where it starts. The hatch is the closed company's. */
    .cal__gap {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-m);
      text-transform: uppercase;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .cal__gap--s,
    .cal__mname--s,
    .cal__more--s,
    .cal__wd--s {
      display: none;
    }
    @media (max-width: 47.999rem) {
      .cal__wd--l,
      .cal__bar-w--l,
      .cal__bar-p {
        display: none;
      }
      .cal__bar-w--s {
        display: inline;
      }
      .cal__bar {
        padding-inline: var(--space-2xs);
        gap: var(--space-2xs);
      }
      .cal__wd--s {
        display: inline;
      }
    }
    /* On a phone the short label may take two lines: «4 / libres». */
    .cal__gap--s {
      white-space: normal;
    }
    /* A day already lived stays a door, in its own ink; only what is on it
       steps back (the number keeps 4.5:1). */
    .cal__day--past :global(.slip) {
      opacity: 0.62;
    }
    /* ONE FRAME ROUND THE PICKED DAY. Its number and its contents are two
       cells of the week's grid, and an outline on each drew two boxes with a
       rule between them; each draws its three sides. */
    .cal__num.cal__day--sel {
      box-shadow:
        inset 0 var(--line-hairline) var(--text-color),
        inset var(--line-hairline) 0 var(--text-color),
        inset calc(-1 * var(--line-hairline)) 0 var(--text-color);
    }
    .cal__day.cal__day--sel {
      box-shadow:
        inset 0 calc(-1 * var(--line-hairline)) var(--text-color),
        inset var(--line-hairline) 0 var(--text-color),
        inset calc(-1 * var(--line-hairline)) 0 var(--text-color);
    }
    /* The month's name is a step OVER the numbers, not beside them: it is
       what the eye finds when the month changes (the drawing, 16-11). */
    .cal__mname {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: var(--month-name-weight);
      line-height: 1;
      color: var(--text-color);
    }
    /* THE BORDER BETWEEN TWO MONTHS IS A STAIR IN INK (Marco, 16-11: «el
       primer día de mes que tiene el nombre se debería destacar»): over the
       new month's days in the week of its 1st, down the 1st's left edge, and
       over the days of the next week that still sit under the old month.
       Lines over the tone and the hatch, never a ground: neither is covered,
       and the cell keeps its width. */
    .cal__wkbody {
      position: relative;
    }
    .cal__wkbody--m1::before,
    .cal__wkbody--m0::after {
      content: '';
      position: absolute;
      inset-block-start: 0;
      border-block-start: var(--line-hairline) solid var(--month-rule);
      pointer-events: none;
    }
    .cal__wkbody--m1::before {
      inset-block-end: 0;
      inset-inline: calc(100% / 7 * var(--m1)) 0;
      /* A 1st on a Monday has the sheet's edge for its left side. */
      border-inline-start: calc(min(var(--m1), 1) * var(--line-hairline)) solid var(--month-rule);
    }
    .cal__wkbody--m0::after {
      inset-inline-start: 0;
      inline-size: calc(100% / 7 * var(--m0));
    }
    /* The cell decides what it can say: below a phone's cell, the short
       month, two monograms and «+N». */
    @container (max-width: 5rem) {
      .cal__gap--l,
      .cal__more--l,
      .cal__day > :global(.slip:nth-child(n + 3)) {
        display: none;
      }
      .cal__gap--s,
      .cal__more--s {
        display: inline;
      }
    }
    .cal__num {
      container-type: inline-size;
    }
    @container (max-width: 5rem) {
      .cal__mname--l {
        display: none;
      }
      .cal__mname--s {
        display: inline;
      }
    }
    @media (max-width: 47.999rem) {
      /* On a phone a tap on the day picks it; the slips are read under the
         week, where they are whole. */
      .cal__day :global(.slip) {
        pointer-events: none;
      }
    }
    .cal__pick {
      display: grid;
      gap: var(--space-2xs);
      padding: var(--space-s) 0;
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .cal__pick-h {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 400;
    }
    .cal__pick-go {
      margin-inline-start: auto;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    /* TODAY IS INK AND A WASH — never a filled pill. The pill was the loudest
       object on the whole sheet: a black disc that outranked every gig on it,
       to say something the reader already knows (it is the one date they did
       not have to look up). Colour is project identity and nothing else, and
       the same law governs all four drawings: today is the cell's 4% wash and
       one step of weight on its number. */
    .cal__day--today {
      background-color: var(--today-wash);
    }
    /* And underlined, as the drawing marks it: the wash alone is 4%. */
    .cal__day--today .cal__day-num {
      font-weight: var(--today-weight);
      color: var(--today-ink);
      text-decoration: underline;
      text-decoration-thickness: var(--line-hairline);
      text-underline-offset: 3px;
    }

    /* The number is the size of what the day holds, not over it: in the
       drawing it is a margin figure and the places are the reading. */
    .cal__day-num {
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-s);
      line-height: 1;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    /* The door to the day was 9×15px under a finger (móvil #2, WCAG 2.5.8):
       on touch it takes a 24px target, around the same number. */
    @media (pointer: coarse) {
      button.cal__day-num {
        min-inline-size: 1.5rem;
        min-block-size: 1.5rem;
        text-align: start;
      }
    }
    /* EL NÚMERO ES LA PUERTA AL DÍA, y hasta hoy no lo parecía.
       Solo se oscurecía al pasar, que es lo que hace la tinta cuando algo se
       enfoca — no dice «esto se pulsa». El subrayado sí, y es el registro más
       callado que hay para decirlo: no añade forma, no compite con las cards,
       y desaparece cuando no hace falta. Nada de píldoras — hoy mismo es una
       tinta y un lavado, no un disco. */
    button.cal__day-num {
      cursor: pointer;
      text-decoration: underline solid transparent var(--line-hairline);
      text-underline-offset: 3px;
      transition:
        color var(--duration-fast),
        text-decoration-color var(--duration-fast);
    }
    button.cal__day-num:hover {
      color: var(--text-color);
      text-decoration-color: currentColor;
    }
    button.cal__day-num:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
      border-radius: var(--radius-xs);
    }

    /* THREE COLUMNS, so the middle is a TRUE centre: the number holds the
       left, the marks hold the right, and the invitation sits on the cell's
       own axis whatever their widths. `space-between` on a flex row cannot do
       this — it centres between the neighbours, so the invitation would slide
       sideways on any day that happens to carry a mark. */
    .cal__day-head {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: var(--space-xs);
      min-block-size: 1rem;
    }
    .cal__day-head > :first-child {
      justify-self: start;
    }
    .cal__day-head > :last-child {
      justify-self: end;
    }

    /* Quiet add affordance — visible on cell hover (and on focus). */

    /* ══ ONE MARK, ONE MEANING ══════════════════════════════════════════
       There is something to DECIDE on this day. That is the whole message.

       It used to be four badges — a filled red disc, a dashed circle with a
       `?`, a red ring, an amber dashed ring — which read as four different
       KINDS of problem when there is one problem seen at four moments. Worse,
       the `!`/`?` fork said «this one is urgent» in a slot that cannot carry
       urgency: WHEN a hold's clock runs out is said by the hold chip inside
       the slip, in words, where you can act on it. The number's mark only
       says THAT there is a call to make.

       And the circles were the loudest objects in a cell full of gigs, for a
       flag. Now it is a glyph: red when people actually collide, verb-cal
       when they do not — the one colour law the Planner already declares
       (red is conflict and only conflict; verb-cal is a call to make). */
    .cal__marks {
      display: inline-flex;
      gap: var(--space-2xs);
      margin-inline-start: auto;
    }
    /* THE CLASH IS A DOT (ADR-209): the same red point the Agenda will
       carry, small enough never to reach the next day's number. */
    .cal__grid :global(.cal__mark) {
      --mark-fg: var(--info);
      flex: none;
      inline-size: var(--dot-m);
      block-size: var(--dot-m);
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--mark-fg);
      cursor: pointer;
    }
    .cal__grid :global(.cal__mark:hover) {
      outline: var(--line-hairline) solid var(--mark-fg);
      outline-offset: var(--line-hairline);
    }
    /* Red is a REAL clash of people, and nothing else earns it. */
    .cal__grid :global(.cal__mark[data-severity='people']),
    .cal__grid :global(.cal__mark[data-severity='blackout']) {
      --mark-fg: var(--danger);
    }
    .cal__grid :global(.cal__mark--static) {
      cursor: default;
    }

    .cal__markpop {
      position: fixed;
      z-index: var(--z-sticky);
    }

    /* ── Event chip — the hold grammar (ADR-072 §5): project accent on
       the left rail (--c); the STATUS family redeclares the chip
       variables (solid tint = confirmed, outline = hold, dashed =
       possibility), never the properties.
       The chips render in PerfChip/DateChip (styleless children) — every
       .cal__event* rule stays HERE, anchored :global under .cal__grid, so
       the hand-tuned card grammar remains ONE rule-set for all cards. */
    .cal__grid :global(.cal__event) {
      --chip-bg: var(--bg-ultra-light);
      /* Hold's hatch rides as an IMAGE so the family still only redeclares
         variables, never properties (philosophy §3). */
      --chip-bg-image: none;
      --chip-fg: var(--text-color);
      /* The project accent IS the whole border of the card — no left rail —
         and it is ONE mix for every family (Marco, 2026-07-19). The border
         says WHOSE this is; settledness is said by the fill, the dash and
         the radius. Mixing it differently per family made two cards of the
         same project read as two different colours. */
      --chip-border-color: color-mix(
        in oklch,
        var(--c, var(--border-color-dark)) 45%,
        var(--border-color-light)
      );
      --chip-border-style: solid;
      /* Square until settled — see the radius rule below. */
      --chip-radius: var(--radius-none);
      /* Flat by default; only the settled gig earns lift (see below). */
      --chip-shadow: none;
      display: flex;
      flex-direction: column;
      gap: var(--line-hairline);
      font-size: var(--text-xs);
      line-height: 1.3;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--chip-radius);
      border: var(--line-hairline) var(--chip-border-style) var(--chip-border-color);
      box-shadow: var(--chip-shadow);
      background-color: var(--chip-bg);
      background-image: var(--chip-bg-image);
      color: var(--chip-fg);
      text-decoration: none;
      overflow: hidden;
      min-inline-size: 0;
    }

    /* The radius is EARNED. Only a settled thing gets rounded corners; a
       hold, a proposal, a tentative rehearsal keeps square ones — propose
       five weeks of rehearsals and the three that never get confirmed keep
       reading as unsettled without anyone having to read the word (Marco,
       2026-07-19). One rule for gigs and dates alike: the family is the
       whole story, so the shape stays true wherever the grammar is used. */
    .cal__grid :global(.cal__event[data-family='confirmed']) {
      --chip-radius: var(--radius-s);
    }

    /* Card rows: name + monogram on top, place + time under, state at the
       foot. Monogram and time never shrink; the name and city take the
       squeeze so a long venue can't push the meta out of the cell. */
    .cal__grid :global(.cal__event-top),
    .cal__grid :global(.cal__event-line) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .cal__grid :global(.cal__event-line) {
      color: var(--text-muted);
    }
    .cal__grid :global(.cal__event-city) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }
    /* The ISO code rides INSIDE the city span so the two ellipsis together
       as one place — a truncated "Barcelo…" must not leave a stranded "FR"
       claiming to be somewhere it isn't. */
    .cal__grid :global(.cal__event-cc) {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      margin-inline-start: 0.35em;
    }
    /* The chip's foot — hold rank on a gig, kind word on a date. */
    .cal__grid :global(.cal__event-foot),
    .cal__grid :global(.cal__event-kind) {
      margin-block-start: var(--line-hairline);
      padding-block-start: var(--line-hairline);
      border-block-start: var(--line-hairline) solid
        color-mix(in oklch, var(--c, var(--border-color-dark)) 16%, var(--border-color-light));
    }
    .cal__grid :global(.cal__event-foot) {
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }
    .cal__grid :global(a.cal__event:hover),
    .cal__grid :global(.cal__event--openable:hover) {
      filter: brightness(0.97);
    }

    /* A date chip that can be opened (task 15). The hit target is a bare
       button stretched over the card — see DateChip for why it is a
       sibling and not a wrapper. It sits UNDER the monogram and OVER the
       text, which is inert anyway. */
    .cal__grid :global(.cal__event--openable) {
      position: relative;
      cursor: pointer;
    }
    .cal__grid :global(.cal__event-hit) {
      all: unset;
      position: absolute;
      inset: 0;
      cursor: pointer;
    }
    .cal__grid :global(.cal__event-hit:focus-visible) {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: -2px;
    }

    /* The settled gig is the day's anchor: it leads the cell AND lifts off
       it. Lift is earned like the radius — a hold stays flat on the page. */
    .cal__grid :global(.cal__event--perf[data-family='confirmed']) {
      --chip-bg: color-mix(in oklch, var(--c, var(--border-color-dark)) 13%, var(--bg-ultra-light));
      --chip-shadow: var(--box-shadow-lift);
    }
    /* Lift needs room to land: the cell's 2px gap is thinner than the
       shadow, so whatever follows a lifted gig would sit inside it. Only
       the chip actually behind one pays the extra space — a lone gig, or
       the last in the cell, keeps the tight rhythm (Marco, 2026-07-19). */
    .cal__grid :global(.cal__event--perf[data-family='confirmed'] + .cal__event) {
      margin-block-start: var(--space-xs);
    }
    /* Options — held or proposed, gig or date — are ONE card (Marco
       2026-07-23): the family ALONE drives the "not settled" grammar, so a
       held gig and a tentative rehearsal share the exact same rule, texture
       and dashed edge — no per-type branch to drift apart. Solid fill stays
       reserved for settled things. (Travel carries no family, so it keeps its
       bare form; tentative blackout bands keep their own accent hatch.) */
    .cal__grid :global(.cal__event[data-family='hold']),
    .cal__grid :global(.cal__event[data-family='proposed']) {
      --chip-bg: var(--bg-ultra-light);
      /* The "not settled" texture: a faint neutral dot stipple — pencilled in,
         not inked. Grey, never the project accent; colour lives in the dashed
         border and the monogram, so the month reads calm, not multicolour. */
      --chip-bg-image: radial-gradient(
        color-mix(in oklch, var(--text-color) 11%, transparent) 1px,
        transparent 1.3px
      );
      background-size: 7px 7px;
      --chip-border-style: dashed;
    }
    /* Ink is the one axis that still steps by depth: held a shade quieter, and
       proposed — the least committed — the faintest, and the SAME on a gig or
       a date. A gig's base ink is full strength (the settled tint needs it),
       so held gigs are pulled to muted here; dates already sit muted. */
    .cal__grid :global(.cal__event--perf[data-family='hold']) {
      --chip-fg: var(--text-muted);
    }
    .cal__grid :global(.cal__event[data-family='proposed']) {
      --chip-fg: var(--text-faint);
    }
    /* RELEASED — was real, isn't any more (ADR-095 §0, the fourth certainty).
       It is kept as MEMORY, not dropped: what you let go of is the thing you
       most need to see when you look back at the month. Struck through and at
       the faintest ink, with a dotted edge — dotted is a fourth line style, so
       it can never be confused with held/proposed (dashed) or firm (solid).
       Before this rule existed `cancelled` fell into `proposed`, and then into
       the BASE chip style once it stopped being proposed — which is the
       confirmed look. A gig the company lost would have drawn as real. */
    .cal__grid :global(.cal__event[data-family='released']) {
      --chip-fg: var(--text-faint);
      --chip-bg: transparent;
      --chip-border-style: dotted;
    }
    .cal__grid :global(.cal__event[data-family='released'] .cal__event-name),
    .cal__grid :global(.cal__event[data-family='released'] .cal__event-time),
    .cal__grid :global(.cal__event[data-family='released'] .cal__event-city) {
      text-decoration: line-through;
      text-decoration-thickness: var(--line-hairline);
    }

    .cal__grid :global(.cal__event-name) {
      /* The chip's title — bold on EVERY kind (gig, rehearsal, residency,
         press, day-off) so it reads apart from its city/time line and foot.
         Settled-vs-held is said by fill, dash, hatch and radius, not weight. */
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }

    /* Date chip — quieter ink than a gig, mono small-caps kind label at the
       foot. Tentative dates read as possibility through the shared option
       grammar above (dashed + square + dot texture); a held date keeps this
       base muted ink and a proposed one drops to the faintest via the shared
       proposed rule; confirmed stays the quiet solid form. */
    .cal__grid :global(.cal__event--date) {
      --chip-fg: var(--text-muted);
    }

    /* A multi-day block reads as one strip across the cells. The join is
       VISUAL only — every day is still its own row carrying its own state,
       so a confirmed day inside a tentative run shows as itself and the
       strip tells the truth about a half-confirmed week. The chip bleeds
       into the cell padding so the run crosses the grid's hairline. */
    /* THE RUN NO LONGER BLEEDS INTO ITS NEIGHBOUR. It used to simulate a band
       with negative inline margins, which worked while the sheet was ONE flat
       grid of 42 cells: the bleed landed inside the next cell of the same grid.
       Now that a week is its own block, the bleed escapes the week and prints
       past the right edge of the sheet — visible on 2026-07-31 with a Sat→Sun
       rehearsal.
       The real fix is the law this drawing still owes: a thing that lasts more
       than a day is ONE element that spans columns (`grid-column: a / b`), not
       N chips glued edge to edge. Until that lands the run stays inside its own
       day, which is honest and does not lie about where the week ends. */
    .cal__grid :global(.cal__event--run) {
      margin-inline: 0;
      border-radius: 0;
    }
    .cal__grid :global(.cal__event--run-first) {
      margin-inline-start: 0;
      border-inline-start: var(--line-hairline) var(--chip-border-style) var(--chip-border-color);
      border-start-start-radius: var(--chip-radius);
      border-end-start-radius: var(--chip-radius);
    }
    .cal__grid :global(.cal__event--run-last) {
      margin-inline-end: 0;
      border-inline-end: var(--line-hairline) var(--chip-border-style) var(--chip-border-color);
      border-start-end-radius: var(--chip-radius);
      border-end-end-radius: var(--chip-radius);
    }
    /* Continuation day: its hours sit at the run's right edge, so the times
       line up down the week instead of drifting with each label. */
    .cal__grid :global(.cal__event-line--cont) {
      justify-content: flex-end;
    }
    .cal__grid :global(.cal__event--off) {
      --chip-fg: var(--text-faint);
      border-inline-start-style: dotted;
    }

    .cal__grid :global(.cal__event-kind) {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      flex: none;
    }

    /* Travel chip — shares the SAME container as every other option (Marco
       2026-07-23): it carries a data-family, so the shared grammar above gives
       it the chip fill, the dashed edge when tentative and the earned radius
       when confirmed — no bare exception. Only its CONTENT stays its own: mono
       text where the direction arrows carry the meaning, on one row. */
    .cal__grid :global(.cal__event--travel) {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: color-mix(in oklch, var(--c, var(--text-muted)) 55%, var(--text-muted));
      /* Row so the monogram pins RIGHT like every other chip (Marco,
         2026-07-23). The text span takes the squeeze and ellipsizes — the
         base chip's column flex + a bare text node defeated text-overflow,
         which is why this used to be display:block with the mark inline-left. */
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .cal__grid :global(.cal__travel-text) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }

    /* Venue wall time on the chip (timezone rule) — quiet mono prefix;
       the viewer's clock rides as a fainter courtesy when it differs. */
    .cal__grid :global(.cal__event-time) {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-style: normal;
      color: var(--text-faint);
      flex: none;
    }
    .cal__grid :global(.cal__event-time i) {
      font-style: normal;
      color: color-mix(in oklch, var(--text-faint) 62%, transparent);
      /* Svelte trims the leading space inside <i> — restore the gap here. */
      margin-inline-start: var(--space-2xs);
    }
    /* "+2" — the day holds more sessions than the card can print. It reads as
       part of the time rather than as a badge, because it is the same fact
       continued: the hover carries the hours themselves. */
    .cal__grid :global(.cal__event-time i.cal__event-more) {
      color: color-mix(in oklch, var(--text-faint) 85%, var(--text-color));
      margin-inline-start: 0.3em;
    }

    /* ── Blackout bands (ADR-078 §4/§5): company = full-width quiet ink,
       person = availability-accent tint + name, tentative = hatched +
       dashed. Derived away band (§6) is QUIETER still — transparent,
       dotted top border, faint mono label. Bands sit at the cell floor,
       full-bleed across the cell padding. */
    /* Reserved-but-empty lane: invisible, holds height only so the bands
       above/below keep their row across every day of the week. */
  }
</style>
