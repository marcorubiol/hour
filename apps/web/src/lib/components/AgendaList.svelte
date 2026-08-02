<script module lang="ts">
  /**
   * One inline contested-hold band (ADR-080 §4 surfaced in the book): the
   * two competing performance ids and a pre-localized reason header. The
   * pick/release actions stay in the DecisionBand above — the agenda only
   * *shows* the tension, it never duplicates the write UI.
   */
  export type AgendaDecision = {
    /** The two performance ids in tension — both rows are wrapped. */
    ids: [string, string];
    /** Localized reason ("… a dues reserves el mateix dia", "Sense dades…"). */
    reason: string;
    severity: 'people' | 'possible' | 'double';
  };
</script>

<script lang="ts">
  /**
   * Agenda projection of the Calendar lens (ADR-076) — the same fetched
   * rows as the month grid, regrouped as a continuous multi-month BOOK:
   * a serif month divider opens each month, every day of the span gets a
   * row (empty days a hairline, kept ones their events), and the reader
   * scrolls to summon more months (an end sentinel asks the page to extend
   * the span; a top "earlier" action prepends with scroll-anchoring).
   *
   * Each day: a weekday+number header column, one row per event
   * (meta[time·status | kind badge] · title · place · project chip),
   * clash banners leading a conflicted day, contested holds wrapped under
   * a reason band, and the blackout/festival rail on the right.
   *
   * The page owns the feeds, the conflict/decision engines, the i18n and
   * the multi-month span; this component is pure presentation. Days are
   * given whole (`days`) — the "days with events" inclusion rule is gone,
   * the book shows the calendar entire.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import {
    dateDayKey,
    perfDayKey,
    type AwayBandVM,
    type BlackoutBandVM,
    type ClashVM,
    type DateEvent,
    type PerformanceEvent,
  } from '$lib/month-events';
  import { assignBandLanes, dayKeyInTz, isoWeek } from '$lib/planner';
  import { SvelteSet } from 'svelte/reactivity';
  import { dualTime, hourMark, localeWeekdayShort } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import Slip from '$lib/components/planner/Slip.svelte';
  import { performanceSlip, dateSlip } from '$lib/month-events';
  import { performanceStatusFamily, performanceStatusLabel } from '$lib/performance';
  import { dateStatusFamily } from '$lib/date';

  interface Props {
    /** Ordered ISO days across the whole agenda span (multi-month). */
    days: string[];
    /** Already scope-filtered rows — same feed as the month grid. */
    performances: PerformanceEvent[];
    dates: DateEvent[];
    /** Fallback slug for row hrefs when a perf's workspace isn't resolvable. */
    workspaceSlug: string;
    loading?: boolean;
    blackouts?: BlackoutBandVM[];
    aways?: AwayBandVM[];
    clashesByDay?: Map<string, ClashVM[]>;
    /** Contested holds per day (ADR-080 §4) — reason + the two perf ids. */
    decisionsByDay?: Map<string, AgendaDecision[]>;
    /** Today's day key (viewer tz) — the accented number. */
    todayIso?: string;
    /** BCP47/locale tag for the day-header/divider labels. */
    locale?: string;
    /** i18n hooks — the page passes t()-backed fns/strings. */
    dateKindLabel?: (kind: string) => string;
    viewerTimeLabel?: (time: string) => string;
    statusLabel?: (status: string) => string;
    travelDirLabel?: (dir: string) => string;
    emptyLabel?: string;
    blackoutsToggleLabel?: string;
    decideLabel?: string;
    /** Header of the right-hand dot-grid notes column. */
    notesLabel?: string;
    /** «show» — the kind word a performance row carries in its pack. */
    showWord?: string;
    /** «let go» — the word a released row carries. */
    releasedWord?: string;
    /** «no hour» — a hold nobody has timed. NEVER a dash. */
    noHourWord?: string;
    /** «all day» — a row that lasts the day, which is not the same as no hour. */
    allDayWord?: string;
    /** Scroll reached the end → page appends the next month. */
    /** «week 29», «2 confirmed · 4 options · 1 night free», «5 days free»,
        «show» — the diary's own summary vocabulary. */
    weekLabel?: (n: number) => string;
    weekRange?: (from: string, to: string) => string;
    weekTally?: (firm: number, held: number, free: number) => string;
    runLabel?: (n: number) => string;
    showLabel?: string;
    onReachEnd?: () => void;
    /** Top "earlier months" action → page prepends (scroll-anchored). */
    onReachStart?: () => void;
    /** Jump to the DecisionBand (where the pick/release actions live). */
    onDecideJump?: () => void;
    /**
     * Date row click — opens the page's edit dialog. Absent ⇒ the rows
     * stay inert divs, as the book has always rendered them. A gig row
     * keeps its link: a performance has a page, a date does not.
     */
    onDateOpen?: (d: DateEvent) => void;
  }

  let {
    days,
    performances,
    dates,
    workspaceSlug,
    loading = false,
    blackouts = [],
    aways = [],
    clashesByDay,
    decisionsByDay,
    locale = 'en-GB',
    todayIso = dayKeyInTz(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone),
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    viewerTimeLabel = (time: string) => `${time}`,
    statusLabel = performanceStatusLabel,
    travelDirLabel = (dir: string) => dir,
    emptyLabel = 'Nothing this month.',
    blackoutsToggleLabel = 'blackouts',
    decideLabel = 'decide ↑',
    notesLabel = 'NOTES',
    showWord = 'show',
    releasedWord = 'let go',
    noHourWord = 'no hour',
    allDayWord = 'all day',
    weekLabel = (n: number) => `week ${n}`,
    weekRange = (from: string, to: string) => `${from} → ${to}`,
    weekTally = (firm: number, held: number, free: number) =>
      [firm ? `${firm} confirmed` : '', held ? `${held} options` : '', free ? `${free} nights free` : '']
        .filter(Boolean)
        .join(' · '),
    runLabel = (n: number) => `${n} days free`,
    showLabel = 'show',
    onReachEnd,
    onReachStart,
    onDecideJump,
    onDateOpen,
  }: Props = $props();

  /**
   * The shell a date row renders as. `svelte:element` swaps the tag; the
   * button-only attributes ride as a spread so a plain div never carries a
   * stray type="button". IdentityMark is a span, so unlike the month chip
   * there is no nested interactive content to work around here.
   */
  function rowShellProps(d: DateEvent): Record<string, unknown> {
    return onDateOpen ? { type: 'button', onclick: () => onDateOpen(d) } : {};
  }

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceTzById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.timezone])),
  );
  /** ADR-002 — the hold convention, per workspace: `1st hold` only means
      something where the company runs a priority queue. */
  let workspaceModeById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.booking_mode ?? 'simple'])),
  );

  // ── Rows per day ───────────────────────────────────────────────────────
  type Row =
    | { kind: 'perf'; sort: string; perf: PerformanceEvent }
    | { kind: 'date'; sort: string; date: DateEvent };

  let rowsByDay = $derived.by(() => {
    const map = new Map<string, Row[]>();
    const push = (key: string, row: Row) => {
      (map.get(key) ?? map.set(key, []).get(key)!).push(row);
    };
    for (const p of performances) {
      push(perfDayKey(p), { kind: 'perf', sort: perfSortKey(p), perf: p });
    }
    for (const d of dates) {
      push(dateDayKey(d, viewerTz), { kind: 'date', sort: dateSortKey(d), date: d });
    }
    for (const rows of map.values()) {
      /* TIMED FIRST, then the un-timed — the running order of the day.
         It used to be the other way round: the empty sort key sorted before
         every clock, so a hold nobody had timed opened the day above the gig
         that actually happens at 20h. A day reads forwards. */
      rows.sort((a, b) => {
        const ra = a.sort ? 0 : 1;
        const rb = b.sort ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;
      });
    }
    return map;
  });

  // The book shows every day of the span — no inclusion filter.
  /* ONE NORMALISER FOR THE WHOLE PLANNER. The diary hands its two primitives
     to the same `performanceSlip` / `dateSlip` the month uses, so a field can
     never mean one thing here and another there. */
  let slipCtx = $derived({
    workspaceSlug,
    workspaceSlugById,
    workspaceTzById,
    workspaceModeById,
    viewerTz,
    kindLabel: (k: string) => dateKindLabel(k),
    dualTime,
  });
  /** Released says `let go`; a hold says its rank and, if the clock is
      running, when. A firm gig and a proposal both say nothing — the
      geometry carries them (ADR-095 §4). */
  function slipState(sl: ReturnType<typeof dateSlip>): string | null {
    if (sl.cert === 'released') return releasedWord;
    if (sl.cert === 'hold' && sl.hold) {
      const rank = sl.hold.rank ? statusLabel(`hold_${sl.hold.rank}`) : statusLabel('hold');
      return sl.hold.expires ? `${rank} · ${localeWeekdayShort(sl.hold.expires, locale)}` : rank;
    }
    return null;
  }
  /** The pair a clash names — the same test the month uses, so the rule and
      the day mark can never disagree about how bad it is. */
  function clashOf(row: Row): { clash: 'none' | 'soft' | 'hard'; people: boolean } {
    const id = row.kind === 'perf' ? row.perf.id : row.date.id;
    const day = row.kind === 'perf' ? perfDayKey(row.perf) : dateDayKey(row.date, viewerTz);
    const list = clashesByDay?.get(day) ?? [];
    const mine = list.filter((c) => c.event_ids?.includes(id));
    if (mine.length === 0) return { clash: 'none', people: false };
    const confirmed =
      row.kind === 'perf' && performanceStatusFamily(row.perf.status) === 'confirmed';
    return {
      clash: confirmed ? 'hard' : 'soft',
      people: mine.some((c) => c.severity === 'people' || c.severity === 'blackout'),
    };
  }

  let shownDays = $derived(days);

  /* ── THE WEEK IS A BAND, AND A QUIET RUN IS ONE LINE ───────────────────
     Two facts the diary could not say. A week has a SHAPE — «2 confirmed · 4
     options · 1 night free» — and reading it day by day is arithmetic the eye
     should not be doing; the month draws that shape in its gutter and the
     diary drew nothing. And a diary that prints every empty day between two
     gigs makes the reader scroll through a fortnight of blank rows to reach
     the next thing that happens: the run of free days is ONE fact («5 days
     free, 3 aug → 7 aug») and it opens if you want the days themselves.

     Both are derived here, from the same `days` the diary already renders —
     nothing new is fetched, and an empty week still draws its band, because
     «nothing this week» is an answer. */
  let openRuns = $state(new SvelteSet<string>());

  type Chunk =
    | { t: 'week'; key: string; n: number; from: string; to: string; firm: number; held: number; free: number }
    | { t: 'day'; key: string; day: string }
    | { t: 'run'; key: string; from: string; to: string; n: number }
    | { t: 'month'; key: string; day: string };

  /** A day nobody has written anything on. Away bands do not count: they are
      about a person, not about the company's calendar. */
  function isFree(day: string): boolean {
    return (rowsByDay.get(day) ?? []).length === 0 && !(clashesByDay?.get(day)?.length);
  }
  const RUN_MIN = 3; // two blank rows are cheaper to read than a control

  let chunks = $derived.by((): Chunk[] => {
    const out: Chunk[] = [];
    let wk = -1;
    let i = 0;
    while (i < shownDays.length) {
      const day = shownDays[i];
      // The month opens BEFORE its first week band: a serif `August 2026`
      // arriving under `week 31` reads as a footnote to the week.
      if (monthBreaks.has(day)) out.push({ t: 'month', key: `m${day}`, day });
      const n = isoWeek(day);
      if (n !== wk) {
        wk = n;
        const rest = shownDays.slice(i);
        const last = rest.find((d, k) => k + 1 === rest.length || isoWeek(rest[k + 1]) !== n) ?? day;
        let firm = 0;
        let held = 0;
        let free = 0;
        for (let d = i; d < shownDays.length && isoWeek(shownDays[d]) === n; d++) {
          const rows = rowsByDay.get(shownDays[d]) ?? [];
          if (rows.length === 0) free++;
          for (const r of rows) {
            if (r.kind !== 'perf') continue;
            const f = performanceStatusFamily(r.perf.status);
            if (f === 'confirmed') firm++;
            else if (f === 'hold' || f === 'proposed') held++;
          }
        }
        out.push({ t: 'week', key: `w${day}`, n, from: day, to: last, firm, held, free });
      }
      // A run of quiet days inside this week collapses to one line.
      if (isFree(day)) {
        let j = i;
        while (j + 1 < shownDays.length && isFree(shownDays[j + 1]) && isoWeek(shownDays[j + 1]) === n)
          j++;
        const len = j - i + 1;
        const key = `r${day}`;
        // A RUN NEVER SWALLOWS TODAY. Today is usually a free day, so the
        // collapse I just added could remove the one row `Now` navigates to —
        // and then the button silently did nothing, which is exactly what
        // Marco hit. A day you can be sent to has to exist.
        const holdsToday = day <= todayIso && todayIso <= shownDays[j];
        // A WEEK THAT IS ENTIRELY FREE SAYS IT ONCE. Its band already reads
        // «7 nights free»; a run under it reading «7 days free» is the same
        // sentence twice, and it was the loudest pattern in the whole diary
        // — every quiet week printed two identical lines.
        const wholeWeek = out[out.length - 1]?.t === 'week' && len >= 7;
        if (len >= RUN_MIN && !holdsToday && !wholeWeek && !openRuns.has(key)) {
          out.push({ t: 'run', key, from: day, to: shownDays[j], n: len });
          i = j + 1;
          continue;
        }
        if (wholeWeek && !holdsToday && !openRuns.has(key)) {
          // …and it draws no day rows at all: the band was the answer.
          i = j + 1;
          continue;
        }
      }
      out.push({ t: 'day', key: day, day });
      i++;
    }
    return out;
  });

  // First day of each month → where the serif divider opens.
  let monthBreaks = $derived.by(() => {
    const s = new Set<string>();
    let prev = '';
    for (const d of days) {
      const mk = d.slice(0, 7);
      if (mk !== prev) {
        s.add(d);
        prev = mk;
      }
    }
    return s;
  });

  // ── Render items per day: loose rows, with contested holds folded into a
  // band at the position of their first member (both members must be
  // present — a status filter can hide one, then it just reads as a row). ─
  type ContestGroup = { dec: AgendaDecision; a: Row; b: Row };
  type RenderItem = { contest: ContestGroup } | { row: Row };

  function dayItems(day: string): RenderItem[] {
    const rows = rowsByDay.get(day) ?? [];
    const decs = decisionsByDay?.get(day);
    if (!decs || decs.length === 0) return rows.map((row) => ({ row }));

    const rowByPerf = new Map<string, Row>();
    for (const r of rows) if (r.kind === 'perf') rowByPerf.set(r.perf.id, r);

    const grouped = new Set<string>();
    const firstMember = new Map<string, ContestGroup>();
    for (const dec of decs) {
      if (grouped.has(dec.ids[0]) || grouped.has(dec.ids[1])) continue;
      const a = rowByPerf.get(dec.ids[0]);
      const b = rowByPerf.get(dec.ids[1]);
      if (!a || !b) continue;
      const g: ContestGroup = { dec, a, b };
      grouped.add(dec.ids[0]);
      grouped.add(dec.ids[1]);
      firstMember.set(rows.indexOf(a) <= rows.indexOf(b) ? dec.ids[0] : dec.ids[1], g);
    }
    if (grouped.size === 0) return rows.map((row) => ({ row }));

    const out: RenderItem[] = [];
    for (const r of rows) {
      const pid = r.kind === 'perf' ? r.perf.id : null;
      if (pid && grouped.has(pid)) {
        const g = firstMember.get(pid);
        if (g) out.push({ contest: g });
        continue;
      }
      out.push({ row: r });
    }
    return out;
  }

  // ── Time rendering (timezone rule — same as MonthGrid) ────────────────
  function perfTz(p: PerformanceEvent): string | null {
    return p.venue?.timezone ?? workspaceTzById.get(p.project?.workspace_id ?? '') ?? null;
  }
  function perfInstant(p: PerformanceEvent): string | null {
    return p.load_in_at ?? p.start_at;
  }
  function perfDual(p: PerformanceEvent): { primary: string; secondary: string | null } | null {
    const at = perfInstant(p);
    if (!at) return null;
    const t = dualTime(at, perfTz(p), viewerTz);
    return { primary: t.primary, secondary: t.secondary };
  }
  /* THE SORT KEY STAYS ON THE WIRE CLOCK. `hourMark` is a reading, not an
     ordering: `9h` sorts above `20h30` by codepoint, so the day's running
     order would invert the moment the hour lost its leading zero. Formatting
     happens where it is printed and nowhere else. */
  function perfSortKey(p: PerformanceEvent): string {
    return perfDual(p)?.primary ?? '';
  }
  function dateDual(d: DateEvent): { primary: string; secondary: string | null } | null {
    if (d.all_day) return null;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    return { primary: t.primary, secondary: t.secondary };
  }
  function dateSortKey(d: DateEvent): string {
    return dateDual(d)?.primary ?? '';
  }

  function perfHref(p: PerformanceEvent): string | null {
    if (!p.slug || !p.project) return null;
    const ws = workspaceSlugById.get(p.project.workspace_id) ?? workspaceSlug;
    return `/h/${ws}/performance/${p.slug}`;
  }
  function perfName(p: PerformanceEvent): string {
    return p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  }
  function perfCity(p: PerformanceEvent): string | null {
    return p.venue?.city ?? p.city;
  }
  function dateText(d: DateEvent): string {
    // `other` names itself with its custom label (badge), so the body shows
    // the real title (+ place) — e.g. "Mescla · Tamarit", badge "ESTUDI".
    if (d.kind === 'other') {
      return [d.title ?? d.label, d.city].filter(Boolean).join(' · ') || dateKindLabel(d.kind);
    }
    if (d.kind === 'day_off') {
      const base = dateKindLabel(d.kind);
      return d.city ? `${base} · ${d.city}` : (d.title ?? base);
    }
    return d.title ?? d.city ?? dateKindLabel(d.kind);
  }
  // The meta badge: `other` shows its custom label (custom_fields.label,
  // ADR-078 §8) uppercased; every other kind shows the kind name.
  function dateBadge(d: DateEvent): string {
    if (d.kind === 'other' && d.label) return d.label;
    return dateKindLabel(d.kind);
  }
  function travelText(d: DateEvent): string {
    const place = d.city ?? d.title ?? d.venue_name ?? dateKindLabel(d.kind);
    const dir = d.travel_direction ? travelDirLabel(d.travel_direction) : null;
    return dir ? `✈ ${place} · ${dir}` : `✈ ${place}`;
  }

  // ── Day header + month divider labels ──────────────────────────────────
  function headWeekday(iso: string): string {
    return localeWeekdayShort(iso, locale).toLowerCase();
  }
  function monthDivName(iso: string): string {
    const raw = new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'long',
      timeZone: 'UTC',
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  function monthDivYear(iso: string): string {
    return iso.slice(0, 4);
  }

  // ── Blackout rail — shared lane system for capsules + away threads. ───
  type RailItem = {
    from: string;
    to: string;
    away: boolean;
    company: boolean;
    tentative: boolean;
    label: string;
  };
  let railItems = $derived.by((): RailItem[] => [
    ...blackouts.map((b) => ({
      from: b.from,
      to: b.to,
      away: false,
      company: b.company,
      tentative: b.tentative,
      label: b.label,
    })),
    ...aways.map((a) => ({
      from: a.from,
      to: a.to,
      away: true,
      company: false,
      tentative: false,
      label: a.label,
    })),
  ]);
  let railLanes = $derived(assignBandLanes(railItems));
  /** First shown day covering each item — where its vertical name lives. */
  let railLabelDay = $derived(
    railItems.map((it) => shownDays.find((d) => d >= it.from && d <= it.to) ?? it.from),
  );

  // Narrow frames (<~560px) collapse the rail to threads by default; the
  // pill expands the named panel as an overlay (ADR-078 / converged mock).
  let narrow = $state(false);
  let panelOpen = $state(false);
  $effect(() => {
    const mq = matchMedia('(max-width: 560px)');
    const apply = () => {
      narrow = mq.matches;
      if (!mq.matches) panelOpen = false;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });

  let railMode = $derived(narrow ? (panelOpen ? 'panel' : 'threads') : 'side');
  let capW = $derived(railMode === 'threads' ? 3 : railMode === 'panel' ? 20 : 22);
  let laneGap = $derived(railMode === 'threads' ? 4 : 7);
  // The NOTES column (dot grid) lives on the right at wide sizes; the rail
  // floats OVER it (ADR mock — "blackouts encima"), so content reserves
  // nothing there. Narrow collapses the notes away and the rail reserves
  // a thread strip inside the content like before.
  let notesW = $derived(narrow ? 0 : 240);
  /** Content reserve — 0 at side (rail over notes); threads/panel reserve. */
  let reservedW = $derived.by(() => {
    const n = railLanes.laneCount;
    if (n === 0 || railMode === 'side') return 0;
    const w = railMode === 'panel' ? 3 : capW;
    const g = railMode === 'panel' ? 4 : laneGap;
    return g + n * (w + g);
  });

  function railSegs(day: string): Array<{ item: RailItem; lane: number; i: number }> {
    const out: Array<{ item: RailItem; lane: number; i: number }> = [];
    railItems.forEach((item, i) => {
      if (day >= item.from && day <= item.to) {
        out.push({ item, lane: railLanes.lanes[i], i });
      }
    });
    return out;
  }

  /* ── THE DIARY LOADS AT BOTH EDGES ────────────────────────────────────
     A sentinel above the first day and one below the last: come within
     800px of either and the page is asked for another month. Re-observed on
     every span change, so a sentinel still in view after one extension fires
     again and fills the viewport.

     BACKWARDS USED TO BE A BUTTON («↑ earlier months»), and a button is the
     wrong shape for a diary: forwards flowed and backwards asked permission,
     so the same gesture — keep reading — worked in one direction and stopped
     in the other.

     BUT BACKWARDS ONLY GROWS WHEN THE READER GOES LOOKING, and that is not a
     nicety. The diary opens AT today, so its first day is on screen and the
     top sentinel is intersecting from the first frame: with no gate it asked
     for a month, the span changed, this effect re-ran, a fresh observer fired
     immediately on the still-visible sentinel, and the loop only stopped
     against the page's 24-month floor. Measured on 2026-08-02: 822 days and
     two years of history fetched before the reader had touched anything.
     Forwards has no such problem — it opens at the top of its own span. */
  let readerMoved = $state(false);
  let endSentinel = $state<HTMLElement>();
  let startSentinel = $state<HTMLElement>();
  /**
   * FORWARDS LOOKS AHEAD; BACKWARDS DOES NOT.
   *
   * 800px of anticipation is right at the foot: you are travelling that way,
   * and the next month should already be there when you arrive. At the head
   * it is a trap — a quiet month of empty day rows is about 850px tall, so a
   * prepend barely clears the margin and the sentinel is immediately inside
   * it again. One flick of the wheel walked the diary to its 24-month floor,
   * 822 days, three times through three different theories of why.
   * Backwards loads when the top is actually REACHED. The prepend is
   * anchored to the reader's own row, so there is no gap to pre-empt.
   */
  const REACH_END = 800;
  const REACH_START = 80;
  /**
   * THE CALLBACK RE-MEASURES; IT DOES NOT TRUST ITS OWN ENTRY.
   *
   * An IntersectionObserver delivers the state it saw when it observed, and
   * it delivers it LATER — after the page has prepended a month and pinned
   * the reader back to their row. So the entry says «still at the top» about
   * a layout that no longer exists, the page is asked for another month, and
   * the diary walks to its floor: 822 days on one flick of the wheel,
   * measured 2026-08-02, twice, through two different anchoring bugs.
   * Asking the element where it actually is costs one layout read and cannot
   * be stale.
   */
  function watch(el: HTMLElement | undefined, fire: (() => void) | undefined, reach: number) {
    if (!el || !fire) return;
    const io = new IntersectionObserver(
      () => {
        const r = el.getBoundingClientRect();
        if (r.bottom > -reach && r.top < window.innerHeight + reach) fire();
      },
      { rootMargin: `${reach}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }
  $effect(() => {
    void days.length;
    return watch(endSentinel, onReachEnd, REACH_END);
  });
  $effect(() => {
    void days.length;
    if (!readerMoved) return;
    return watch(startSentinel, onReachStart, REACH_START);
  });
  $effect(() => {
    if (readerMoved) return;
    const arm = () => (readerMoved = true);
    // `once` so it costs one listener and nothing per frame afterwards.
    window.addEventListener('scroll', arm, { once: true, passive: true });
    window.addEventListener('wheel', arm, { once: true, passive: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('scroll', arm);
      window.removeEventListener('wheel', arm);
      window.removeEventListener('keydown', arm);
    };
  });
</script>

<div
  class="ag"
  class:ag--loading={loading}
  class:ag--panel={railMode === 'panel'}
  data-rail={railMode}
  style={`--ag-rail-reserve: ${reservedW}px; --ag-cap-w: ${capW}px; --ag-lane-gap: ${laneGap}px; --ag-notes-w: ${notesW}px;`}
>
  {#if notesW > 0}
    <!-- The dot-grid notes margin (mock) — a real bullet-journal column;
         the blackout rail floats over its left edge ("blackouts encima"). -->
    <aside class="ag__notes">
      <span class="ag__notes-head">{notesLabel}</span>
    </aside>
  {/if}

  {#if narrow && railItems.length > 0}
    <div class="ag__railbar">
      <button
        type="button"
        class="ag__railtoggle"
        class:ag__railtoggle--on={panelOpen}
        aria-pressed={panelOpen}
        onclick={() => (panelOpen = !panelOpen)}
      >
        <span class="ag__railtoggle-dot" aria-hidden="true"></span>
        {blackoutsToggleLabel}
      </button>
    </div>
  {/if}

  {#if shownDays.length === 0}
    <p class="ag__empty">{emptyLabel}</p>
  {:else}
    {#if onReachStart}
      <div class="ag__sentinel" bind:this={startSentinel} aria-hidden="true"></div>
    {/if}

    {#each chunks as ch (ch.key)}
      {#if ch.t === 'month'}
        <h2 class="ag__monthdiv">
          <span class="ag__monthdiv-name">{monthDivName(ch.day)}</span>
          <span class="ag__monthdiv-year">{monthDivYear(ch.day)}</span>
        </h2>
      {:else if ch.t === 'week'}
        <!-- THE WEEK'S OWN LINE. Its shape, once, instead of seven days of
             arithmetic — the same three counts the month draws in its gutter. -->
        <div class="ag__week">
          <span class="ag__week-n">{weekLabel(ch.n)}</span>
          <span class="ag__week-r">{weekRange(ch.from, ch.to)}</span>
          <span class="ag__week-t">{weekTally(ch.firm, ch.held, ch.free)}</span>
        </div>
      {:else if ch.t === 'run'}
        <!-- A RUN OF QUIET DAYS IS ONE FACT. Printing them one by one makes
             the reader scroll a fortnight of blank rows to reach the next
             thing that happens — and «free» is the number this trade sells. -->
        <div class="ag__run">
          <span class="ag__run-n">{runLabel(ch.n)}</span>
          <span class="ag__run-r">{weekRange(ch.from, ch.to)}</span>
          <button type="button" class="ag__run-do" onclick={() => openRuns.add(ch.key)}
            >{showLabel}</button
          >
        </div>
      {:else}
        {@const day = ch.day}
      {@const items = dayItems(day)}
      {@const banners = clashesByDay?.get(day) ?? []}
      {@const segs = railSegs(day)}
      {@const empty = items.length === 0 && banners.length === 0}
      <section
        class="ag__day"
        class:ag__day--empty={empty}
        class:ag__day--today={day === todayIso}
        data-day={day}
      >
        <header class="ag__head">
          <span class="ag__wd">{headWeekday(day)}</span>
          <span class="ag__num">{Number(day.slice(8, 10))}</span>
        </header>
        <div class="ag__rows">
          <!-- NO BANNER BOXES. A clash used to print a grey slab per pair
               above the day — «! No team data — could clash.» twice over —
               while the two rows it was about sat underneath saying nothing.
               The rule down the pair says WHICH two, in place, and the margin
               card says what to do about it. Three tellings became one. -->
          {#each items as it, ii (ii)}
            {#if 'contest' in it}
              <div class="ag__contest" data-severity={it.contest.dec.severity}>
                <p class="ag__contest-head">
                  <span
                    class="ag__contest-mark"
                    data-severity={it.contest.dec.severity}
                    aria-hidden="true">{it.contest.dec.severity === 'possible' ? '?' : '!'}</span
                  >
                  <span class="ag__contest-reason">{it.contest.dec.reason}</span>
                  {#if onDecideJump}<button
                      type="button"
                      class="ag__contest-jump"
                      onclick={onDecideJump}>{decideLabel}</button
                    >{/if}
                </p>
                {@render eventRow(it.contest.a)}
                {@render eventRow(it.contest.b)}
              </div>
            {:else}
              {@render eventRow(it.row)}
            {/if}
          {/each}
        </div>
        {#each segs as seg (seg.i)}
          <span
            class="ag__cap"
            class:ag__cap--away={seg.item.away}
            class:ag__cap--company={seg.item.company}
            class:ag__cap--tentative={seg.item.tentative}
            class:ag__cap--start={day === seg.item.from}
            class:ag__cap--end={day === seg.item.to}
            style={`--lane: ${seg.lane};`}
            title={seg.item.label}
            aria-hidden="true"
          >
            {#if railMode !== 'threads' && day === railLabelDay[seg.i]}
              <span class="ag__cap-name">{seg.item.label}</span>
            {/if}
          </span>
        {/each}
      </section>
      {/if}
    {/each}

    {#if onReachEnd}<div class="ag__sentinel" bind:this={endSentinel} aria-hidden="true"></div>{/if}
  {/if}
</div>

{#snippet eventRow(row: Row)}
  <!-- THE DIARY DRAWS THE MONTH'S SLIP. It used to draw `ag__row`, a
       hand-built lookalike that had already drifted: no country code, a
       different released treatment, its own hold wording, no clash rule, and
       a verbs column that was reserved and never filled. That is exactly the
       history ADR-095 §0 exists to end — «three implementations of one card
       is how the month came to print a country code the board could not».
       One object, one vocabulary; the diary only asks for the `row` PLACING,
       where the clock sits under the pack so hours align down the page. -->
  {@const slip =
    row.kind === 'perf'
      ? performanceSlip(row.perf, slipCtx)
      : dateSlip(row.date, slipCtx)}
  {@const flags = clashOf(row)}
  <Slip
    {slip}
    placing="row"
    kindLabel={(k) => (k === 'show' ? showWord : dateKindLabel(k))}
    stateLabel={slipState}
    stateUrgent={false}
    showCountry={true}
    clash={flags.clash}
    clashPeople={flags.people}
    onOpen={row.kind === 'date' && onDateOpen ? () => onDateOpen?.(row.date) : undefined}
  />
{/snippet}


<style>
  @layer components {
.ag {
      /* One neutral availability accent for every person (never per-person
         hues); company blackouts sink to ink. */
      --ag-black-accent: var(--cal-accent, var(--warning));
      position: relative;
      display: grid;
      grid-template-columns: 1fr var(--ag-notes-w, 0px);
      align-content: start;
      transition: opacity var(--transition);
    }
/* The book stacks in column 1; the notes margin spans every row in 2. */
    .ag > :not(.ag__notes) {
      grid-column: 1;
      min-inline-size: 0;
    }
.ag--loading {
      opacity: 0.6;
    }
/* ── NOTES margin — a dot-grid bullet-journal column on the right. ── */
    .ag__notes {
      grid-column: 2;
      grid-row: 1 / -1;
      position: relative;
      border-inline-start: 1px solid var(--border-color-light);
      background-image: radial-gradient(
        circle,
        color-mix(in oklch, var(--text-faint) 45%, transparent) 1px,
        transparent 1.5px
      );
      background-size: 22px 22px;
      background-position: 18px 44px;
      z-index: 0;
    }
.ag__notes-head {
      position: sticky;
      top: 0;
      display: block;
      padding: var(--space-m) var(--space-s) var(--space-s) var(--space-l);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
.ag__empty {
      padding-block: var(--space-xl);
      text-align: center;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-faint);
    }
/* Top "earlier months" — quiet, centered, prepends with anchoring. */

    /* ── Serif month divider — the book's chapter head. ── */
    /* ── THE WEEK'S BAND · number, range, shape ───────────────────────
       All mono, all margin voice: this is the machine reporting on a stretch
       of the diary, not a thing that happens in it. The tally goes right, so
       seven days of shape line up down the page and can be scanned without
       reading a word of them. */
    .ag__week {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      padding: var(--space-s) 0 var(--space-2xs);
      border-block-start: 1px solid var(--border-color-light);
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
.ag__week-n {
      color: var(--text-muted);
    }
.ag__week-t {
      margin-inline-start: auto;
      text-align: end;
    }
/* ── A RUN OF QUIET DAYS · one line, and a door back to the days ───── */
    .ag__run {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      padding: var(--space-xs) 0;
      border-block-start: 1px dotted var(--border-color-light);
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
.ag__run-n {
      color: var(--text-muted);
    }
.ag__run-do {
      margin-inline-start: auto;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      color: var(--text-faint);
      cursor: pointer;
    }
.ag__run-do:hover {
      color: var(--text-color);
    }
.ag__monthdiv {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      margin-block: var(--space-l) var(--space-2xs);
      padding-inline-start: var(--space-xs);
      font-weight: 400;
    }
.ag__monthdiv:first-child {
      margin-block-start: var(--space-2xs);
    }
.ag__monthdiv-name {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      color: var(--text-color);
    }
.ag__monthdiv-year {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }
/* ── Day group: header column + rows, a ledger rule beneath. ── */
    .ag__day {
      position: relative;
      display: grid;
      grid-template-columns: 6rem 1fr;
      align-items: start;
      border-block-end: 1px solid var(--border-color-light);
    }
.ag__day--empty {
      min-block-size: 2.5rem;
    }
.ag__head {
      display: flex;
      flex-direction: column;
      padding: var(--space-s) 0 var(--space-xs) var(--space-xs);
    }
.ag__day--empty .ag__head {
      padding-block: var(--space-xs);
    }
.ag__wd {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
.ag__num {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      line-height: 1.05;
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
      margin-block-start: var(--space-2xs);
    }
.ag__day--empty .ag__num {
      font-size: var(--text-l);
      color: var(--text-muted);
    }
.ag__day--today .ag__wd,
    .ag__day--today .ag__num {
      color: var(--ag-black-accent);
    }
.ag__rows {
      padding-block: var(--space-s);
      padding-inline-end: calc(var(--ag-rail-reserve) + var(--space-s));
      min-inline-size: 0;
    }
.ag__day:not(.ag__day--empty) .ag__rows {
      border-inline-start: 1px solid var(--border-color-light);
    }
.ag__day--empty .ag__rows {
      padding-block: var(--space-xs);
      min-block-size: 0;
    }
/* An openable date row is a <button>: undo the widget defaults the
       grid layout above assumes (font, centred text, intrinsic width,
/* NO VIEW TRUNCATES A NAME (ADR-095). A row is allowed to grow, and
       «Teatre Nacional de Cataluny…» is a name you cannot look up. The
       ellipsis was not arbitrary — the name used to be `nowrap` with VISIBLE
       overflow and printed over the row's actions — but wrapping fixes that
       too: inside a `minmax(0, 1fr)` column a wrapped name cannot leave its
/* ── THE ROW · three columns (ADR-095) ────────────────────────────
       identity (fixed) · the name · a slot reserved for the verbs, so the row
/* One hour, one size, one colour. It used to grow and darken when a date
       became firm, so certainty was said twice in the clock on top of every
/* RELEASED — the fourth certainty (ADR-095 §0). Kept as memory: struck
       through at the faintest ink, in the row exactly as on the month slip.
       Without this rule a released row inherits the plain title, which is the
/* THE CITY SITS UNDER THE NAME — one line for what it is, one for where
       it is — and it is QUIETER: the name is the assertion, the place is the
       gloss. It used to ride inline behind the name, where it inherited the
/* ── Contested holds — a heavier clash band wrapping the two rows. ── */
    .ag__contest {
      margin: var(--space-2xs) var(--space-s) var(--space-xs) var(--space-m);
      border: 1px solid color-mix(in oklch, var(--danger) 22%, var(--border-color-light));
      border-radius: var(--radius-m);
      background: color-mix(in oklch, var(--danger) 4%, transparent);
      overflow: hidden;
    }
.ag__contest[data-severity='possible'] {
      border-color: var(--border-color-dark);
      background: var(--bg-light);
    }
.ag__contest-head {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: var(--space-xs) var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
      border-block-end: 1px solid color-mix(in oklch, var(--danger) 12%, var(--border-color-light));
    }
.ag__contest[data-severity='possible'] .ag__contest-head {
      border-block-end-color: var(--border-color-light);
    }
.ag__contest-mark {
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: var(--radius-circle);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      line-height: 1;
      background: var(--danger);
      color: var(--bg);
      flex: none;
    }
.ag__contest-mark[data-severity='possible'] {
      background: var(--bg);
      color: var(--text-faint);
      border: 1px dashed var(--border-color-dark);
    }
.ag__contest-reason {
      min-inline-size: 0;
      flex: 1;
    }
.ag__contest-jump {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      background: none;
      border: none;
      cursor: pointer;
      flex: none;
      white-space: nowrap;
    }
.ag__contest-jump:hover {
      color: var(--text-muted);
    }
/* ── Blackout / festival rail — per-day segments; contiguity comes
       free because every day inside a stored blackout is included. ── */
    .ag__cap {
      position: absolute;
      top: 0;
      bottom: 0;
      /* Negative → the capsule crosses the book/notes boundary and floats
         OVER the dot-grid notes column ("blackouts encima"). Narrow mode
         flips this back to a positive in-content reserve (media query). */
      inset-inline-end: calc(
        -1 * (var(--ag-lane-gap) + var(--lane) * (var(--ag-cap-w) + var(--ag-lane-gap)) + var(--ag-cap-w))
      );
      inline-size: var(--ag-cap-w);
      background: color-mix(in oklch, var(--ag-black-accent) 26%, var(--bg));
      border-inline: 1px solid color-mix(in oklch, var(--ag-black-accent) 45%, var(--border-color-light));
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: hidden;
      z-index: 3;
    }
.ag__cap--start {
      border-start-start-radius: var(--radius-circle);
      border-start-end-radius: var(--radius-circle);
      border-block-start: 1px solid color-mix(in oklch, var(--ag-black-accent) 45%, var(--border-color-light));
      padding-block-start: var(--space-s);
      top: var(--space-xs);
    }
.ag__cap--end {
      border-end-start-radius: var(--radius-circle);
      border-end-end-radius: var(--radius-circle);
      border-block-end: 1px solid color-mix(in oklch, var(--ag-black-accent) 45%, var(--border-color-light));
      bottom: var(--space-xs);
    }
.ag__cap--tentative {
      background: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--ag-black-accent) 30%, var(--bg)) 0 5px,
        color-mix(in oklch, var(--ag-black-accent) 11%, var(--bg)) 5px 10px
      );
    }
.ag__cap--company {
      background: color-mix(in oklch, var(--text-color) 12%, var(--bg));
      border-color: var(--border-color-dark);
    }
.ag__cap--away {
      background: none;
      border-inline: none;
      border-inline-end: 2px dotted color-mix(in oklch, var(--ag-black-accent) 55%, var(--border-color-dark));
      border-radius: 0;
    }
.ag__cap-name {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      font-family: var(--font-mono);
      font-size: 0.6rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: color-mix(in oklch, var(--ag-black-accent) 42%, var(--text-color));
      white-space: nowrap;
    }
.ag__cap--company .ag__cap-name {
      color: var(--text-muted);
    }
.ag--panel .ag__cap:not(.ag__cap--away) {
      box-shadow: -12px 0 18px -10px color-mix(in oklch, var(--text-color) 35%, transparent);
    }
.ag__sentinel {
      block-size: 1px;
    }
/* ── Narrow toggle pill. ── */
    .ag__railbar {
      display: flex;
      justify-content: flex-end;
      padding-block-end: var(--space-xs);
    }
.ag__railtoggle {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
      background: none;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      padding: var(--space-2xs) var(--space-s);
      cursor: pointer;
    }
.ag__railtoggle-dot {
      inline-size: 7px;
      block-size: 7px;
      border-radius: var(--radius-circle);
      background: var(--border-color-dark);
    }
.ag__railtoggle--on .ag__railtoggle-dot {
      background: var(--ag-black-accent);
    }
@media (max-width: 560px) {
      .ag__day {
        grid-template-columns: 4.25rem 1fr;
      }
      .ag__contest {
        margin-inline: var(--space-xs);
      }
      /* No notes column here — the rail reserves a thread strip in-content. */
      .ag__cap {
        inset-inline-end: calc(
          var(--ag-lane-gap) + var(--lane) * (var(--ag-cap-w) + var(--ag-lane-gap))
        );
      }
    }
}
</style>
