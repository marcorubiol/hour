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
  import { addDaysIso, dayKeyInTz, isoWeek, monthGrid, assignBandLanes } from '$lib/planner';
  import { weekdayLabels, localeMonthShort } from '$lib/datetime';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import type { IdentitySibling } from '$lib/utils/identity';
  import IdentityQuickPanel from '$lib/components/IdentityQuickPanel.svelte';
  import { performanceStatusFamily } from '$lib/performance';
  import { dualTime } from '$lib/datetime';
  import {
    performanceSlip,
    dateSlip,
    type Slip as SlipVM,
    perfDayKey,
    dateDayKey,
    formatMonthLabel,
    perfInstant,
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
    year: number;
    /** 1-12, same contract as $lib/planner. */
    month: number;
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
    /** Stored blackouts to paint as day-cell bands (page-scoped VMs). */
    blackouts?: BlackoutBandVM[];
    /** Derived away bands — quieter than any blackout, display-only. */
    aways?: AwayBandVM[];
    /** Conflicts per ISO day — the day marks + clash-card popovers. */
    clashesByDay?: Map<string, ClashVM[]>;
    /** BCP47/locale tag for weekday + month labels. */
    locale?: string;
    /** i18n hooks — the page passes t()-backed fns; defaults stay English. */
    dateKindLabel?: (kind: string) => string;
    createLabel?: (isoDate: string) => string;
    /**
     * The word on a card's FOOT — "confirmat", "1r hold", "proposat".
     * EVERY card carries one: without it a confirmed gig is a row shorter
     * than a hold, so the most important thing on the grid reads as the
     * smallest (Marco, 2026-07-19). Holds show their rank — the family
     * folds hold_1..3 into one SHAPE (ADR-072 §5), the rank is what is
     * actually being decided between.
     */
    stateLabel?: (status: string) => string | null;
    /**
     * The readiness checklist a CONFIRMED gig shows on its foot, in display
     * order (ADR-084 §3). A settled gig's foot answers "is it sorted?"
     * instead of restating "confirmed" — which the fill already says. Items
     * always print; the tick is what varies, so the foot never collapses.
     */
    readinessItems?: { key: string; label: string }[];
    /** «more» — the word after the +N door on a full cell. */
    moreLabel?: string;
    /** «week 27» — the gutter's own label. */
    isoWeekLabel?: (n: number) => string;
    /** Words for the density row's tooltip; the sheet itself stays wordless. */
    confirmedWord?: string;
    optionWord?: string;
    freeWord?: string;
    nothingWord?: string;
    /** «let go» — the word a released slip carries. */
    releasedLabel?: string;
    /** «expires Mon» — the deadline phrase, given the decide-by ISO day. */
    expiresLabel?: (isoDay: string) => string;
    /** The kind word a band carries: an absence says «away», a tour says
        «on tour». They are two different claims and never the same word —
        an absence is a fact somebody wrote down, a tour is inferred. */
    awayWord?: string;
    tourWord?: string;
    /** «until 20 jul» — a band that opened before this week. */
    untilLabel?: (day: string) => string;
  }

  /** English fallbacks for the card foot; the page overrides these with t(). */
  const EN_STATE_WORDS: Record<string, string> = {
    hold_1: '1st hold',
    hold_2: '2nd hold',
    hold_3: '3rd hold',
    hold: 'hold',
    confirmed: 'confirmed',
    proposed: 'proposed',
    invoiced: 'invoiced',
    paid: 'paid',
    done: 'done',
  };

  let {
    year,
    month,
    performances,
    dates,
    workspaceSlug,
    loading = false,
    onDayCreate,
    onDateOpen,
    blackouts = [],
    aways = [],
    clashesByDay,
    locale = 'en-GB',
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    createLabel = (iso: string) => `New performance on ${iso}`,
    stateLabel = (status: string) => EN_STATE_WORDS[status] ?? null,
    readinessItems = [
      { key: 'hotel', label: 'hotel' },
      { key: 'technical', label: 'technical' },
    ],
    moreLabel = 'more',
    isoWeekLabel = (n: number) => `week ${n}`,
    confirmedWord = 'confirmed',
    optionWord = 'options',
    freeWord = 'nights free',
    nothingWord = 'nothing yet',
    releasedLabel = 'let go',
    expiresLabel = (iso: string) => `expires ${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
    awayWord = 'away',
    tourWord = 'on tour',
    untilLabel = (day: string) => `until ${day}`,
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

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.booking_mode ?? 'simple'])),
  );

  /* ── ONE OBJECT, NOT TWO CHIPS (ADR-095 §0) ────────────────────────────
     The cell renders `Slip`, and both primitives reach it through the same
     normaliser. `PerfChip` and `DateChip` are both gone — the run of days
     that was `DateChip`'s last excuse is a band now, not a stack of chips.

     THE CELL CAPS AT THREE, and the rest becomes `+N more`. Without the cap
     the row height is set by the fullest day, and that day can hold nine
     things — so a quiet week could never look short, which is half of what
     the month is for. */
  let slipCtx = $derived({
    workspaceSlug,
    workspaceSlugById,
    workspaceTzById,
    workspaceModeById,
    viewerTz,
    kindLabel: (k: string) => dateKindLabel(k),
    dualTime,
  });
  const CELL_CAP = 3;

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
      const slip = performanceSlip(p, slipCtx);
      out.push({ key: p.id, slip, sortAt: perfInstant(p) ?? '~' });
    }
    for (const g of groups) {
      // A multi-day run left the cell: it is the week's band now, drawn once
      // over the days it covers with each day's own hours under it.
      if (isSeriesBand(g)) continue;
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

  /** verb-cal only while the clock is actually running (ADR-080 §2). */
  function isUrgentHold(sl: SlipVM): boolean {
    return Boolean(sl.hold?.expires && sl.hold.expires <= todayIso);
  }

  let weeks = $derived(monthGrid(year, month));
  let label = $derived(formatMonthLabel(year, month, locale));
  let wkLabels = $derived(weekdayLabels(locale));

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
  let seriesDays = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    for (const d of dates) {
      if (!d.series_id) continue;
      const day = dateDayKey(d, viewerTz);
      (m.get(d.series_id) ?? m.set(d.series_id, new Set<string>()).get(d.series_id)!).add(day);
    }
    return m;
  });

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
    const sid = g[0]?.series_id;
    return Boolean(sid && (seriesDays.get(sid)?.size ?? 0) >= 2);
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
  type SeriesCell = { iso: string; row: DateEvent | null; hours: SlipVM['time'][] };
  type WeekSeries = {
    key: string;
    colStart: number;
    colEnd: number;
    project: ProjectLite | null;
    kindWord: string;
    label: string;
    city: string | null;
    cert: SlipVM['cert'];
    title: string;
    cells: SeriesCell[];
  };
  function weekSeries(week: { iso: string }[]): WeekSeries[] {
    const grouped = new Map<string, { rows: DateEvent[]; cols: number[] }>();
    week.forEach((day, ci) => {
      for (const d of datesByDay.get(day.iso) ?? []) {
        if (!isSeriesBand([d])) continue;
        const g = grouped.get(d.series_id!) ?? { rows: [], cols: [] };
        g.rows.push(d);
        if (!g.cols.includes(ci)) g.cols.push(ci);
        grouped.set(d.series_id!, g);
      }
    });
    const out: WeekSeries[] = [];
    for (const [sid, g] of grouped) {
      const a = Math.min(...g.cols);
      const b = Math.max(...g.cols);
      const head = dateSlip(g.rows[0], slipCtx);
      const cells: SeriesCell[] = [];
      for (let c = a; c <= b; c++) {
        const iso = week[c].iso;
        const rows = g.rows
          .filter((r) => dateDayKey(r, viewerTz) === iso)
          .sort((x, y) => (x.starts_at < y.starts_at ? -1 : 1));
        cells.push({
          iso,
          row: rows[0] ?? null,
          hours: rows.map((r) => dateSlip(r, slipCtx).time),
        });
      }
      out.push({
        key: `${sid}:${week[0].iso}`,
        colStart: a + 1,
        colEnd: b + 2,
        project: g.rows[0].project,
        kindWord: dateKindLabel(g.rows[0].kind),
        label: head.name,
        city: head.city,
        cert: head.cert,
        title: head.title,
        cells,
      });
    }
    return out.sort((x, y) => x.colStart - y.colStart);
  }

  /* THE LEGEND IS NOT A FILTER ANY MORE (ADR-095 §3). Its project entries were
     the month's own narrowing machine — a second one, a hundred pixels under
     the scope bar that already does exactly this. What the legend keeps is the
     part the drawing cannot say on its own (solid / dashed / `!`), and even
     that leaves the sheet: its subject is the grammar of all four views, not
     the month, and the foot of a drawing three screens tall is where nobody
     who needs teaching will ever arrive. */

  type BandSlot =
    | { kind: 'blackout'; band: BlackoutBandVM; from: string; to: string }
    | { kind: 'away'; band: AwayBandVM; from: string; to: string };

  // Every band gets ONE stable lane for its whole span (Marco 2026-07-19):
  // a multi-day band must sit on the same row across all its days and never
  // reorder when a neighbouring day carries an extra band — otherwise a
  // continuing band appears to "jump lanes" (the day-21 black hole).
  // Blackouts listed before aways so aways settle into the lower lanes.
  let laneBands = $derived.by(() => {
    const combined: BandSlot[] = [
      ...blackouts.map((b) => ({ kind: 'blackout' as const, band: b, from: b.from, to: b.to })),
      ...aways.map((a) => ({ kind: 'away' as const, band: a, from: a.from, to: a.to })),
    ];
    const { lanes } = assignBandLanes(combined);
    return { combined, lanes };
  });

  /**
   * A BAND IS ONE ELEMENT THAT SPANS COLUMNS (ADR-095), not N slices glued
   * edge to edge — and it lives at the FOOT of its week, which is where the
   * design puts absences and tours.
   *
   * Before this it was a per-cell lane system: every day of the week reserved
   * an empty slot for every lane so the pieces would line up, and the label
   * was reprinted on the first day of each week. That kept seven copies of one
   * fact in the DOM and could never draw a terminus — an arrowhead only means
   * something on an element that has an end.
   *
   * Clipping is per ISO week because a band that runs past Sunday does not end
   * there: it loses its arrowhead and says `until <date>` instead, so the
   * geometry never claims something the calendar cannot show.
   */
  type WeekBand = {
    key: string;
    kind: 'blackout' | 'away';
    colStart: number;
    colEnd: number;
    /**
     * THREE FIELDS IN THREE VOICES, never one composed sentence. `word` is
     * what kind of band this is (mono, the margin voice), `subject` is who or
     * where (text, full ink — it is the thing you are reading), `span` is when
     * (mono again, quietest).
     *
     * It was `away · MaMeMi` in one 9px mono string, which drew the SUBJECT —
     * the only part you actually look for — at the size and weight of its own
     * label. The design's band has had the three-part shape from the start.
     */
    word: string;
    subject: string;
    span: string | null;
    /** Tours travel with their project: at one column wide the coloured
        monogram is the only thing that survives. */
    project: ProjectLite | null;
    label: string;
    note?: string | null;
    tentative: boolean;
    /** The band continues past this week's edge — no terminus on that side. */
    cutLeft: boolean;
    cutRight: boolean;
    lane: number;
  };
  /** «15 jul → 20 jul», or «until 20 jul» when the band opened before this
      week: an arrowhead cannot claim a start the sheet is not showing. */
  function bandSpan(from: string, to: string, cutLeft: boolean): string {
    const d = (iso: string) => `${Number(iso.slice(8, 10))} ${localeMonthShort(iso, locale)}`;
    return cutLeft ? untilLabel(d(to)) : `${d(from)} → ${d(to)}`;
  }
  function weekBands(week: { iso: string }[]): WeekBand[] {
    const first = week[0].iso;
    const last = week[6].iso;
    const out: WeekBand[] = [];
    const { combined, lanes } = laneBands;
    combined.forEach((slot, i) => {
      if (slot.to < first || slot.from > last) return;
      const from = slot.from < first ? first : slot.from;
      const to = slot.to > last ? last : slot.to;
      const colStart = week.findIndex((d) => d.iso === from) + 1;
      const colEnd = week.findIndex((d) => d.iso === to) + 2;
      if (colStart < 1 || colEnd < 2) return;
      const isBlackout = slot.kind === 'blackout';
      const cutLeft = slot.from < first;
      const bo = slot.band as BlackoutBandVM;
      const aw = slot.band as AwayBandVM;
      out.push({
        key: `${slot.kind}:${i}:${first}`,
        kind: slot.kind,
        colStart,
        colEnd,
        word: isBlackout ? awayWord : tourWord,
        // An absence names a PERSON; a tour names a PLACE — and when nobody
        // wrote the place down it names the project instead of inventing one.
        subject: isBlackout ? (bo.subject ?? bo.label) : (aw.place ?? aw.projectName ?? ''),
        // A tour says no dates: it is inferred from two travel legs, and the
        // legs are already drawn on the sheet as the days they are.
        span: isBlackout ? bandSpan(slot.from, slot.to, cutLeft) : null,
        project: isBlackout
          ? null
          : aw.project_id
            ? {
                id: aw.project_id,
                slug: '',
                name: aw.projectName ?? '',
                accent: aw.accent,
                initials: aw.initials,
                workspace_id: '',
              }
            : null,
        label: slot.band.label,
        note: isBlackout ? bo.note : null,
        tentative: isBlackout ? bo.tentative : false,
        cutLeft,
        cutRight: slot.to > last,
        lane: lanes[i] ?? 0,
      });
    });
    return out.sort((a, b) => a.lane - b.lane || a.colStart - b.colStart);
  }

  /** Lanes in use across a whole week row — every cell reserves this many
   *  slots so a lane sits at the same height in every day of the week. */
  /**
   * THE WEEK'S GUTTER — the row that counts the week without words.
   *
   * One mark per day: solid for a confirmed gig, a ring for an option, a rule
   * for a working day that is not a gig, a faint dot for a night still free.
   * Three numbers became one row you read at a glance, and the words survive
   * in the tooltip.
   *
   * `free` here is the same law as the header's counter: a night with anything
   * of its own is not free, and neither is a night on tour.
   */
  type DayMark = 'firm' | 'held' | 'busy' | 'free' | 'out';
  function weekMarks(week: { iso: string; inMonth: boolean }[]): DayMark[] {
    return week.map((d) => {
      if (!d.inMonth) return 'out';
      const perfs = performancesByDay.get(d.iso) ?? [];
      const dates = datesByDay.get(d.iso) ?? [];
      let firm = false;
      let held = false;
      for (const p of perfs) {
        const fam = performanceStatusFamily(p.status);
        if (fam === 'confirmed') firm = true;
        else if (fam === 'hold') held = true;
      }
      if (firm) return 'firm';
      if (held) return 'held';
      if (perfs.length > 0 || dates.length > 0) return 'busy';
      return tourDays.has(d.iso) ? 'busy' : 'free';
    });
  }
  /** Days covered by an away band — a tour night is never a free night. */
  let tourDays = $derived.by(() => {
    const out = new Set<string>();
    for (const b of aways) {
      let d = b.from;
      for (let i = 0; d <= b.to && i < 400; i++) {
        out.add(d);
        d = addDaysIso(d, 1);
      }
    }
    return out;
  });

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
  /** The words for the density row live in the tooltip, not on the sheet. */
  function weekMarksTitle(marks: DayMark[]): string {
    const n = (k: DayMark) => marks.filter((m) => m === k).length;
    const parts = [
      n('firm') ? `${n('firm')} ${confirmedWord}` : '',
      n('held') ? `${n('held')} ${optionWord}` : '',
      n('free') ? `${n('free')} ${freeWord}` : '',
    ].filter(Boolean);
    return parts.join(' · ') || nothingWord;
  }
  function weekFill(week: { iso: string }[]): number {
    let max = 0;
    for (const d of week) {
      // A run of days is NOT in the cell — it is the week's own band, on its
      // own row. Counting it here asked for a full-height cell to hold
      // nothing, so a week whose only content was one rehearsal block drew as
      // tall as the busiest week of the month (seen on screen, 2026-07-31).
      const inCell = (datesByDay.get(d.iso) ?? []).filter((x) => !isSeriesBand([x])).length;
      const n = (performancesByDay.get(d.iso) ?? []).length + inCell;
      max = Math.max(max, Math.min(n, CELL_CAP));
    }
    return WEEK_FILL[max];
  }

  function weekLaneCount(week: { iso: string }[]): number {
    const { combined, lanes } = laneBands;
    let max = -1;
    for (const day of week) {
      combined.forEach((c, i) => {
        if (day.iso >= c.from && day.iso <= c.to) max = Math.max(max, lanes[i]);
      });
    }
    return max + 1;
  }

  /** The band occupying each lane on a given day (null = reserved spacer). */
  function laneSlotsOn(iso: string, count: number): (BandSlot | null)[] {
    const slots: (BandSlot | null)[] = new Array(count).fill(null);
    const { combined, lanes } = laneBands;
    combined.forEach((c, i) => {
      if (iso >= c.from && iso <= c.to && lanes[i] < count) slots[lanes[i]] = c;
    });
    return slots;
  }

  // ── Clash-card popover — one open at a time, keyed day:index. ──────────
  let openClash = $state<string | null>(null);
  let gridEl: HTMLElement | undefined = $state();

  function toggleClash(iso: string, i: number) {
    const key = `${iso}:${i}`;
    openClash = openClash === key ? null : key;
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

<!-- ONE DISPATCHER, on the grid. The cell carries only `data-cal-new`; the
     handler fires only when the click landed on the cell ITSELF, so the slips,
     the +N door and the day marks keep their own clicks. Reading the target
     rather than giving every cell a role is also what keeps 42 cells out of the
     tab order — the keyboard path to «a new date» is `N` on the page, which is
     the same door (ADR-095 §7). -->
<div
  class="cal__grid"
  class:cal__grid--loading={loading}
  role="grid"
  tabindex="-1"
  onclick={(e) => {
    const el = e.target as HTMLElement;
    const iso = el?.dataset?.calNew;
    if (iso) onDayCreate?.(iso);
  }}
  onkeydown={(e) => {
    // The grid itself is not the keyboard path — `N` on the page is (one
    // door, three handles). This exists so the click handler is not a
    // mouse-only affordance, and it fires on the same target rule.
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target as HTMLElement;
    const iso = el?.dataset?.calNew;
    if (!iso) return;
    e.preventDefault();
    onDayCreate?.(iso);
  }}
  aria-label={label}
  bind:this={gridEl}
>
  <!-- THE WEEKDAY AXIS NEVER GOES. It costs fourteen pixels once for the whole
       sheet, and there is no weekend wash by law — in this trade Saturday is
       the best working day — so without the names you cannot tell which column
       is Saturday except by counting from a number. The axis is the reading. -->
  <div class="cal__wkh">
    <span></span>
    {#each wkLabels as wd (wd)}
      <span class="cal__weekday">{wd}</span>
    {/each}
  </div>
  {#each weeks as week, wi (wi)}
    {@const wlc = weekLaneCount(week)}
    {@const marks = weekMarks(week)}
    {@const bands = weekBands(week)}
    {@const series = weekSeries(week)}
    <!-- A ROW OF THE MONTH IS A WEEK, and each week is its own block: a gutter
         that counts it, then its seven days. -->
    <div class="cal__wk" style="--wf: {weekFill(week)}">
      <div class="cal__wkg">
        <span class="cal__wkn">{isoWeekLabel(isoWeek(week[0].iso))}</span>
        <span class="cal__wkd" title={weekMarksTitle(marks)}>
          {#each marks as m, mi (mi)}<i class="cal__wkm" data-mark={m}></i>{/each}
        </span>
      </div>
      <!-- ONE GRID PER WEEK, THREE BANDS OF ROWS: the day numbers on row 1,
           the runs of days under them, and the day cells on the last row —
           all of them placed, none of them auto-flowed. A run belongs
           BETWEEN the number and the day's own contents: above the number it
           reads as a header for the week, below the contents it lands under
           the `+N more` door. It is the frame the days sit inside. -->
      <div class="cal__wkc" style="--cr: {series.length + 2}">
        {#each week as day, di (day.iso)}
          {@const clashes = clashesByDay?.get(day.iso) ?? []}
          <div
            class="cal__num"
            class:cal__day--out={!day.inMonth}
            class:cal__day--today={day.iso === todayIso}
            style="grid-row: 1; grid-column: {di + 1}"
          >
            <span class="cal__day-head">
              <!-- A DAY OUTSIDE THE MONTH DRAWS ITS CONTENT AND NEVER ITS
                   NUMBER (ADR-095). It used to do the opposite — number and
                   grey wash, the noise without the information. The ABSENCE
                   of the number is the whole of the mark, and there is no
                   fade: a weaker CLAIM is not fainter INK. -->
              {#if day.inMonth}
                <span class="cal__day-num">{Number(day.iso.slice(8, 10))}</span>
              {/if}
              {#if clashes.length > 0}
                <span class="cal__marks">
                  {#each clashes as c, i (i)}
                    <button
                      type="button"
                      class="cal__mark"
                      data-severity={c.severity}
                      aria-label={c.title}
                      aria-expanded={openClash === `${day.iso}:${i}`}
                      onclick={() => toggleClash(day.iso, i)}>!</button
                    >
                  {/each}
                </span>
              {/if}
            </span>
            {#each clashes as c, i (i)}
              {#if openClash === `${day.iso}:${i}`}
                <!-- Bottom rows open upward: a downward card would run off
                     the foot of the sheet. -->
                <ClashCard {c} up={wi >= weeks.length - 2} flip={di >= 5} />
              {/if}
            {/each}
          </div>
        {/each}
        {#each series as s, si (s.key)}
          <div
            class="cal__run"
            data-family={s.cert}
            style="grid-row: {si + 2}; grid-column: {s.colStart} / {s.colEnd}{s.project
              ? `; --c: ${accentVarFor(s.project)}`
              : ''}"
            title={s.title}
          >
              <span class="cal__run-h">
                <span class="cal__run-k">
                  {#if s.project}
                    <IdentityMark
                      accent={accentVarFor(s.project)}
                      name={s.project.name}
                      initials={s.project.initials}
                    />
                  {/if}
                  <span class="cal__run-w">{s.kindWord}</span>
                </span>
                <b>{s.label}</b>
                {#if s.city}<span class="cal__run-c">{s.city}</span>{/if}
              </span>
              <!-- Each day's OWN hours. This strip is the whole reason a run
                   is stored as per-day rows rather than a span. -->
              <span
                class="cal__run-g"
                style="grid-template-columns: repeat({s.cells.length}, minmax(0, 1fr))"
              >
                {#each s.cells as c (c.iso)}
                  {#if c.row && onDateOpen}
                    <button
                      type="button"
                      class="cal__run-d"
                      onclick={() => onDateOpen?.(c.row!)}
                      title={c.iso}
                    >
                      {#each c.hours as h, hi (hi)}
                        <i>{h?.primary ?? '·'}{#if h?.end}<u>–{h.end}</u>{/if}</i>
                      {/each}
                    </button>
                  {:else}
                    <span class="cal__run-d" class:cal__run-d--off={!c.row}>
                      {#if c.row}
                        {#each c.hours as h, hi (hi)}
                          <i>{h?.primary ?? '·'}{#if h?.end}<u>–{h.end}</u>{/if}</i>
                        {/each}
                      {:else}<i>–</i>{/if}
                    </span>
                  {/if}
                {/each}
              </span>
            </div>
        {/each}
    {#each week as day, di (day.iso)}
      {@const perfs = performancesByDay.get(day.iso) ?? []}
      {@const dateGroups = groupDates(datesByDay.get(day.iso) ?? [])}
      {@const entries = cellSlips(perfs, dateGroups)}
      {@const overflow = entries.length - CELL_CAP}
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
        class:cal__day--out={!day.inMonth}
        class:cal__day--today={day.iso === todayIso}
        data-cal-new={day.inMonth && onDayCreate ? day.iso : undefined}
        style="grid-row: var(--cr); grid-column: {di + 1}"
      >
        <!-- Three, then a door. The cap is what lets a quiet week look short:
             the row is as tall as its fullest day, and without it that day can
             hold nine things. -->
        {#each entries.slice(0, CELL_CAP) as entry (entry.key)}
          <Slip
            slip={entry.slip}
            kindLabel={(k) => dateKindLabel(k)}
            stateLabel={slipState}
            stateUrgent={isUrgentHold(entry.slip)}
            showCountry={false}
            onMarkOpen={openMark}
            onOpen={entry.dateRow && onDateOpen ? () => onDateOpen?.(entry.dateRow!) : undefined}
          />
        {/each}
        {#if overflow > 0}
          <button type="button" class="cal__more" onclick={() => onDayCreate?.(day.iso)}
            >+{overflow} {moreLabel}</button
          >
        {/if}
      </div>
    {/each}
      </div>
      {#if bands.length > 0}
        <!-- The foot of the week: absences and tours, each ONE element measured
             over the days it covers. -->
        <div class="cal__wkb">
          {#each bands as b (b.key)}
            <span
              class="cal__band"
              class:cal__band--away={b.kind === 'away'}
              class:cal__band--tent={b.tentative}
              class:cal__band--cutl={b.cutLeft}
              class:cal__band--cutr={b.cutRight}
              style="grid-column: {b.colStart} / {b.colEnd}"
              title={b.note ? `${b.label} · ${b.note}` : b.label}
            >
              <span class="cal__band-k">
                {#if b.project}
                  <IdentityMark
                    accent={accentVarFor(b.project)}
                    name={b.project.name}
                    initials={b.project.initials}
                  />
                {/if}
                <span class="cal__band-w">{b.word}</span>
              </span>
              {#if b.subject}<span class="cal__band-n">{b.subject}</span>{/if}
              {#if b.span}<em class="cal__band-s">{b.span}</em>{/if}
              <!-- The rule with its terminus. It is not drawn when the band runs
                   past the week's edge: an arrowhead there would claim an end
                   the calendar cannot show. -->
              <span class="cal__band-r"></span>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
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
    .cal__grid {
      --cal-wk-gutter: 66px;
      --cal-cell-h: 128px;
      display: flex;
      flex-direction: column;
      transition: opacity var(--transition);
    }
    .cal__wkh {
      display: grid;
      grid-template-columns: var(--cal-wk-gutter) repeat(7, minmax(0, 1fr));
      margin-block-start: 12px;
      border-block-end: 1px solid var(--border-color-light);
    }
    .cal__wk {
      display: grid;
      grid-template-columns: var(--cal-wk-gutter) minmax(0, 1fr);
      border-block-end: 1px solid var(--border-color-light);
    }
    .cal__wk:last-child {
      border-block-end: 0;
    }
    /* The gutter counts the week WITHOUT WORDS. */
    .cal__wkg {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      padding: 9px 9px 10px 0;
      border-inline-end: 1px solid var(--border-color-light);
      /* The gutter spans the WHOLE week block — the run strip, the days and
         the foot bands are three rows in column 2, and without this the
         gutter would take one of them and the days would fall to column 1. */
      grid-column: 1;
      grid-row: 1 / -1;
    }
    .cal__wkn {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      /* One step above the marks it labels: the number is read, the marks are
         seen. */
      color: var(--text-muted);
    }
    .cal__wkd {
      display: flex;
      align-items: center;
      gap: 3px;
      margin-block-start: 5px;
    }
    /* solid = a confirmed gig · ring = an option · rule = a working day that is
       not a gig · faint dot = a night still free. */
    .cal__wkm {
      flex: none;
      inline-size: 5px;
      block-size: 5px;
      border-radius: 50%;
    }
    .cal__wkm[data-mark='firm'] {
      background: var(--text-muted);
    }
    .cal__wkm[data-mark='held'] {
      box-shadow: 0 0 0 1px var(--text-faint) inset;
    }
    .cal__wkm[data-mark='busy'] {
      inline-size: 5px;
      block-size: 1px;
      border-radius: 0;
      background: color-mix(in oklch, var(--text-faint) 60%, transparent);
    }
    .cal__wkm[data-mark='free'] {
      inline-size: 3px;
      block-size: 3px;
      background: color-mix(in oklch, var(--text-faint) 40%, transparent);
    }
    .cal__wkm[data-mark='out'] {
      background: none;
    }
    /* The seven days. The 1px rules ARE the grid — a background-image column
       ruling, so a cell can never be pushed out of alignment by a border. */
    /* THE FOOT OF THE WEEK · absences and tours. */
    .cal__wkb {
      /* The week block is `gutter | content`; without this the band row lands
         in the GUTTER column and every band draws under the week number
         instead of over the days it measures. Seen on screen, 2026-07-31. */
      grid-column: 2;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px 0;
      padding: 2px 0 5px;
    }
    /* THE RULE BELONGS TO THE BAND, NOT TO THE ROW. A `border-block-start` on
       the container drew a hairline the full width of the week whenever ANY
       band existed — a line that measures seven days for a fact that lasts
       two. The band's own top border spans exactly the columns it covers,
       which is the whole point of measuring it. */
    .cal__band {
      display: flex;
      align-items: center;
      gap: 9px;
      min-inline-size: 0;
      padding: 1px 8px 2px;
      border-block-start: 1px solid var(--border-color-light);
      overflow: visible;
      white-space: nowrap;
    }
    .cal__band-k {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .cal__band-w {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    /* The subject is the thing you are reading, so it is TEXT, not a label:
       the one field on the band drawn in the body voice. */
    .cal__band-n {
      flex: none;
      font-size: 11px;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cal__band-s {
      flex: none;
      font-family: var(--font-mono);
      font-style: normal;
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    /* A rule with a terminus — never a box. An absence is a stretch of days,
       and a box says «a thing that happened», which is what it is not. */
    .cal__band-r {
      flex: 1;
      min-inline-size: 12px;
      position: relative;
      block-size: 0;
      border-block-start: 1px solid color-mix(in oklch, var(--text-color) 45%, transparent);
    }
    .cal__band-r::after {
      content: '';
      position: absolute;
      inset-inline-end: -1px;
      inset-block-start: -2.5px;
      inline-size: 5px;
      block-size: 5px;
      border-block-start: 1px solid color-mix(in oklch, var(--text-color) 58%, transparent);
      border-inline-end: 1px solid color-mix(in oklch, var(--text-color) 58%, transparent);
      transform: rotate(45deg);
    }
    /* Runs past the week's edge: no terminus on that side. */
    .cal__band--cutr .cal__band-r::after {
      display: none;
    }
    /* ON TOUR is QUIETER THAN AN ABSENCE: an absence is a fact somebody wrote
       down, this is deduced from two travel legs, and they cannot weigh the
       same. Dotted where away is solid, and one ink lighter. */
    .cal__band--away {
      border-block-start-style: dotted;
    }
    .cal__band--away .cal__band-n {
      font-size: 10.5px;
      color: var(--text-faint);
    }
    .cal__band--away .cal__band-w {
      color: var(--text-faint);
    }
    .cal__band--away .cal__band-r {
      border-block-start-style: dotted;
      border-block-start-color: color-mix(in oklch, var(--text-color) 16%, transparent);
    }
    .cal__band--away .cal__band-r::after {
      display: none;
    }
    /* An absence that is settled is ink; one that is not is faint and leans —
       the certainty axis, same as everywhere else. */
    .cal__band--tent {
      border-block-start-style: dashed;
    }
    .cal__band--tent .cal__band-n {
      color: var(--text-faint);
      font-style: italic;
    }
    .cal__band--tent .cal__band-r {
      border-block-start-style: dotted;
    }

    /* The day NUMBER is its own cell on row 1 of the week's grid, so a run of
       days can sit between it and the day's contents. It also means the
       numbers line up across a week whose days hold different things. */
    .cal__num {
      position: relative;
      min-inline-size: 0;
      padding: 6px 8px 2px;
    }

    /* ── THE RUN · one band, its days' hours under it ─────────────────── */
    /* The same box as a slip — a run IS a slip with a longer life, and giving
       it its own shape is how a fifth vocabulary gets invented. */
    .cal__run {
      position: relative;
      isolation: isolate;
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      margin: 4px 0 1px;
      padding: 3px 8px;
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-s);
    }
    /* …and the same certainty grammar, so a tentative run says «not sure» at
       exactly the volume a tentative gig does. */
    .cal__run[data-family='hold'],
    .cal__run[data-family='proposed'] {
      border-style: dashed;
      border-color: color-mix(in oklch, var(--text-color) 13%, var(--border-color-light));
    }
    .cal__run[data-family='released'] {
      border-style: dotted;
      background: transparent;
    }
    .cal__run[data-family='released'] b {
      text-decoration: line-through;
      color: var(--text-faint);
    }
    .cal__run-h {
      display: flex;
      align-items: center;
      gap: 8px;
      min-inline-size: 0;
      white-space: nowrap;
      overflow: hidden;
      line-height: 1.1;
    }
    .cal__run-k {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .cal__run-w {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__run-h b {
      font-weight: 400;
      font-size: 11px;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cal__run-c {
      font-size: 9px;
      color: var(--text-faint);
      white-space: nowrap;
    }
    /* EVERY HOUR HANGS AT THE RIGHT OF THE DAY IT BELONGS TO — the same edge
       as the day column above it, so the strip reads as a row of the grid and
       not as a sentence. */
    .cal__run-g {
      display: grid;
      align-items: center;
      font-family: var(--font-mono);
      font-size: 9px;
      line-height: 1.15;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .cal__run-d {
      padding: 0 6px 0 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
    }
    button.cal__run-d {
      cursor: pointer;
    }
    button.cal__run-d:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    /* A session is a LINE. Two sessions in one day are two lines — never one
       line with a separator, which is how an hour got clipped in a 72px cell. */
    .cal__run-d i {
      display: block;
      font-style: normal;
    }
    .cal__run-d u {
      text-decoration: none;
    }
    .cal__run-d--off {
      color: var(--text-faint);
      opacity: 0.6;
    }

    .cal__wkc {
      grid-column: 2;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      align-items: stretch;
      background-image: linear-gradient(to right, var(--border-color-light) 0 1px, transparent 1px);
      background-size: calc(100% / 7) 100%;
      background-position: -1px 0;
      background-repeat: repeat-x;
    }

    .cal__grid--loading {
      opacity: 0.6;
    }

    /* The weekday axis is a LABEL, not a header bar: a filled band turns the
       row into a table chrome the month does not have. One hairline under it
       is the whole of the separation. */
    .cal__weekday {
      padding: 7px 9px;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.14em;
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
      padding: 1px 5px 9px;
      overflow: hidden;
    }

    /* The invitation appears WHERE YOU POINT, and it is the cell's own empty
       space — no element, so nothing can cover another control. */
    .cal__day[data-cal-new]::after {
      /* The hint says WHAT it will make. A bare `+` in a calendar cell is the
         one glyph that could mean anything the app can create. */
      content: '+ date';
      position: absolute;
      inset-inline: 5px;
      inset-block-end: 1px;
      block-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 8.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      border: 1px dashed color-mix(in oklch, var(--text-color) 14%, transparent);
      border-radius: 2px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.1s;
    }
    .cal__day[data-cal-new]:hover::after,
    .cal__day[data-cal-new]:focus-visible::after {
      opacity: 1;
    }
    .cal__more {
      align-self: flex-start;
      margin-block-start: 3px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__more:hover {
      color: var(--text-muted);
    }
    /* NO WASH ON A DAY THAT IS NOT THIS MONTH. It was legible while the cell
       held nothing but a grey number; now that it holds slips it would put a
       venue behind a tint, and the law is already written elsewhere in this
       project: a weaker CLAIM is not fainter INK. The missing day number is
       the whole of the mark. */
    .cal__day--out .cal__day-num {
      color: var(--text-faint);
    }

    /* TODAY IS INK AND A WASH — never a filled pill. The pill was the loudest
       object on the whole sheet: a black disc that outranked every gig on it,
       to say something the reader already knows (it is the one date they did
       not have to look up). Colour is project identity and nothing else, and
       the same law governs all four drawings: today is the cell's 4% wash and
       one step of weight on its number. */
    .cal__day--today {
      background: color-mix(in oklch, var(--text-color) 4%, transparent);
    }
    .cal__day--today .cal__day-num {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-color);
    }

    .cal__day-num {
      font-family: var(--font-mono);
      font-size: 15px;
      line-height: 1;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    /* The number, then the slack, then the marks. `space-between` parked a
       lone note dot in the middle of the cell — whatever comes SECOND takes
       the slack, and anything after it sits beside it. */
    .cal__day-head {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      margin-block-end: 4px;
      min-block-size: 16px;
    }
    .cal__day-head > :nth-child(2) {
      margin-inline-start: auto;
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
      gap: 3px;
      margin-inline-start: auto;
    }
    .cal__grid :global(.cal__mark) {
      --mark-fg: var(--info);
      flex: none;
      padding: 0 0 0 1px;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      color: var(--mark-fg);
      cursor: pointer;
    }
    .cal__grid :global(.cal__mark:hover) {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    /* Red is a REAL clash of people, and nothing else earns it. */
    .cal__grid :global(.cal__mark[data-severity='people']),
    .cal__grid :global(.cal__mark[data-severity='blackout']) {
      --mark-fg: var(--danger);
    }
    .cal__grid :global(.cal__mark--static) {
      cursor: default;
    }

    /* Monogram as its own click zone inside the event link (ADR-081): opens
       the identity editor instead of following the chip's href. */
    .cal__grid :global(.cal__markbtn) {
      all: unset;
      display: inline-flex;
      cursor: pointer;
      border-radius: calc(var(--mark, 14px) * 0.28);
    }
    .cal__grid :global(.cal__markbtn:focus-visible) {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 1px;
    }
    .cal__markpop {
      position: fixed;
      z-index: 200;
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
      --mark: 14px;
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: var(--text-xs);
      line-height: 1.3;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--chip-radius);
      border: 1px var(--chip-border-style) var(--chip-border-color);
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
      margin-block-start: 1px;
      padding-block-start: 1px;
      border-block-start: 1px solid
        color-mix(in oklch, var(--c, var(--border-color-dark)) 16%, var(--border-color-light));
    }
    .cal__grid :global(.cal__event-foot) {
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }
    /* Readiness ticks: the WORD always prints, only the ✓ varies. "Not
       sorted" then reads as a visible absence rather than as nothing at
       all — and the settled gig's foot never collapses to empty. */
    .cal__grid :global(.cal__event-foot--ready) {
      display: flex;
      gap: var(--space-xs);
      letter-spacing: var(--mono-letter-spacing);
      min-inline-size: 0;
    }
    .cal__grid :global(.cal__ready) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cal__grid :global(.cal__ready--on) {
      color: var(--text-muted);
    }
    .cal__grid :global(.cal__ready--on::before) {
      content: '✓';
      margin-inline-end: 0.2em;
      color: var(--success, currentColor);
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
      outline: 2px solid var(--focus-ring, var(--text-color));
      outline-offset: -2px;
    }
    /* The monogram keeps its own click through the hit layer. */
    .cal__grid :global(.cal__event--openable .cal__markbtn) {
      position: relative;
      z-index: 1;
    }

    /* The settled gig is the day's anchor: it leads the cell AND lifts off
       it. Lift is earned like the radius — a hold stays flat on the page. */
    .cal__grid :global(.cal__event--perf[data-family='confirmed']) {
      --chip-bg: color-mix(in oklch, var(--c, var(--border-color-dark)) 13%, var(--bg-ultra-light));
      --chip-shadow:
        0 1px 2px color-mix(in oklch, var(--text-color) 10%, transparent),
        0 2px 5px color-mix(in oklch, var(--text-color) 6%, transparent);
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
      text-decoration-thickness: 1px;
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
      border-inline-start: 1px var(--chip-border-style) var(--chip-border-color);
      border-start-start-radius: var(--chip-radius);
      border-end-start-radius: var(--chip-radius);
    }
    .cal__grid :global(.cal__event--run-last) {
      margin-inline-end: 0;
      border-inline-end: 1px var(--chip-border-style) var(--chip-border-color);
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
