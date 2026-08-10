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

  /**
   * What the margin writer hands back (ADR-093). At most one of the two
   * anchor ids is set — a day's own entry the writer chose. Neither set
   * means the note falls to the page's fallback (pinned scope → company).
   */
  export type NoteDraft = {
    body: string;
    on_day: string;
    performance_id?: string;
    date_id?: string;
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
    type NoteEvent,
    type PerformanceEvent,
  } from '$lib/month-events';
  import { assignBandLanes, dayKeyInTz } from '$lib/planner';
  import { agendaChunks, emptyTailMonths, type AgendaDayStats } from '$lib/agenda-chunks';
  import { SvelteMap } from 'svelte/reactivity';
  import { dualTime, hourMark, localeDayMonth, localeWeekdayShort } from '$lib/datetime';
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
    /** Scroll nears the foot → the page grows the book forward (it probes
        and jumps to the next planned month, or answers with `endLabel`). */
    /** «week 29», «2 confirmed · 4 options · 1 night free», «5 days free»,
        «show» — the diary's own summary vocabulary. */
    weekLabel?: (n: number) => string;
    weekRange?: (from: string, to: string) => string;
    weekTally?: (firm: number, held: number, free: number) => string;
    /**
     * THE VERBS, on the row itself. A hold is a question the diary is asking
     * you; answering it belonged three clicks away in a drawer, so the row
     * that poses the question could not resolve it.
     */
    onConfirm?: (perfId: string) => void;
    onRelease?: (perfId: string) => void;
    /** Performance id with a write in flight. */
    pendingId?: string | null;
    confirmLabel?: string;
    releaseLabel?: string;
    /** «until», «5 days left», «back tomorrow» — the absence's own words. */
    awayUntilWord?: string;
    awayLeftWord?: string;
    awayLeftOneWord?: string;
    awayBackWord?: string;
    /** The day's own number is a door to that day's drawing — the same door
        the month's number is. A diary tells you a date has weight; the next
        question is always what that day looks like. */
    onDayOpen?: (isoDate: string) => void;
    /** «to decide» — the margin card's own eyebrow. */
    decideCardLabel?: string;
    /** My post-its (ADR-093), keyed by on_day. */
    notesByDay?: Map<string, NoteEvent[]>;
    /** Absent ⇒ the margin only reads (pre-migration DB hides the writer). */
    onNoteCreate?: (draft: NoteDraft) => Promise<boolean>;
    onNoteDelete?: (id: string) => void;
    /** Where an anchorless note falls — «the company» or the pinned scope. */
    noteFallbackLabel?: string;
    /** That fallback is a SPACE (not a project/line): it comes down already
        lowercase, so the anchor's mono-caps register must stand aside. */
    noteFallbackIsSpace?: boolean;
    notePlaceholder?: string;
    noteAddLabel?: string;
    noteDeleteLabel?: string;
    onReachEnd?: () => void;
    /** The past, on request: fired by the head's «earlier» line and by the
        overpull gesture at the very top. Absent (page at its floor) ⇒ both
        disappear — an act that can do nothing is not drawn. Awaited, so
        the door can wear «loading…» while the jump is in flight. */
    onReachStart?: () => void | Promise<void>;
    /** «↑ earlier months» — the head line's own words. */
    earlierLabel?: string;
    /** «loading…» — the door's promised/in-flight state. */
    loadingLabel?: string;
    /** «nothing further back» — shown at the head instead of the door once
        the page knows the past holds nothing (or the floor is reached). */
    noEarlierLabel?: string;
    /** The book's tail went quiet: the sentinel is off, and the page is
        asked to look ahead ONCE — jump the gap to the next planned month,
        or declare the plan finished by passing `endLabel`. */
    onPlanEnds?: () => void;
    /** «nothing more planned» — the book's honest end, printed only when
        the page's look-ahead came back empty. */
    endLabel?: string;
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
    awayUntilWord = 'until',
    awayLeftWord = '{n} days left',
    awayLeftOneWord = '1 day left',
    awayBackWord = 'back tomorrow',
    onDayOpen,
    decideCardLabel = 'to decide',
    notesByDay,
    onNoteCreate,
    onNoteDelete,
    noteFallbackLabel = 'the company',
    noteFallbackIsSpace = false,
    notePlaceholder = 'Write a note…',
    noteAddLabel = 'Add a note',
    noteDeleteLabel = 'Delete note',
    onConfirm,
    onRelease,
    pendingId = null,
    confirmLabel = 'confirm',
    releaseLabel = 'let go',
    onReachEnd,
    onReachStart,
    earlierLabel = '↑ earlier months',
    loadingLabel = 'loading…',
    noEarlierLabel,
    onPlanEnds,
    endLabel,
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

  /* ── MONTH > WEEK > DAY — every level a door (Marco, 2026-08-03) ───────
     The book's structure lives in $lib/agenda-chunks, pure and tested;
     this file only hands it the day facts and holds the reader's toggles.
     What died here: the run-of-quiet-days line (an open week now prints
     every day it has, and the collapsed week above does the run's old
     job), and the day-walked month divider — which a free week straddling
     the month turn could swallow whole, hanging May's weeks under April.
     Session state only, like every open/closed in this book (ADR-080 §5). */
  const monthOverride = new SvelteMap<string, boolean>();
  const weekOverride = new SvelteMap<string, boolean>();

  /* `Now` RESETS THE BOOK (Marco, 2026-08-03): the page snaps the span's
     start back to today, and the diary notices its first day JUMPING
     FORWARD — loading only ever moves it back — and returns to its
     first-load shape: doors to their defaults, the past's line hidden
     until it is asked for again. */
  let prevStart = '';
  $effect(() => {
    const start = days[0] ?? '';
    if (prevStart && start > prevStart) {
      earlierRevealed = false;
      monthOverride.clear();
      weekOverride.clear();
    }
    prevStart = start;
  });

  /** The day's facts, in the chunker's vocabulary. `free` is a night the
      trade can sell (no rows); `marked` is a clash or a note — not a
      booking, but reason enough to keep the day's containers open. Away
      bands count for neither: they are about a person, not the calendar. */
  function dayStats(day: string): AgendaDayStats {
    const rows = rowsByDay.get(day) ?? [];
    let firm = 0;
    let held = 0;
    for (const r of rows) {
      if (r.kind !== 'perf') continue;
      const f = performanceStatusFamily(r.perf.status);
      if (f === 'confirmed') firm++;
      else if (f === 'hold' || f === 'proposed') held++;
    }
    return {
      free: rows.length === 0,
      marked:
        Boolean(clashesByDay?.get(day)?.length) || Boolean(notesByDay?.get(day)?.length),
      firm,
      held,
    };
  }

  let chunks = $derived(
    agendaChunks({ days: shownDays, todayIso, dayStats, monthOverride, weekOverride }),
  );

  /* ── THE BOOK STOPS GROWING WHERE THE PLAN STOPS (Marco, 2026-08-03) ──
     A collapsed chapter is ~36px, so the end sentinel never left its own
     800px reach and one scroll milled out months of quiet future. When the
     tail goes quiet the sentinel goes OFF and the page is asked to look
     ahead once — jump the gap to the next planned month, or come back with
     `endLabel` and the book ends with a sentence instead of a treadmill.
     Deliberate travel (the ‹ › arrows) still walks past the end. */
  let endStop = $derived(emptyTailMonths(shownDays, todayIso, dayStats) >= 1);
  $effect(() => {
    void days.length;
    if (endStop) onPlanEnds?.();
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

  /**
   * The absence, as a sentence for one day: «Mia away · until 20 jul · 5 days
   * left», and «back tomorrow» on the last one. Derived from the same rail
   * items — nothing new is fetched, and when the rail is off they are still
   * here, because an absence is a fact about the day and not a decoration.
   */
  /**
   * THE CALL, IN THE MARGIN OF THE DAY THAT CAUSES IT.
   *
   * The drawer at the head of the page lists every call in the window; this
   * says the same thing where it happens, beside the two rows it is about.
   * They are not a duplicate: the drawer is the QUEUE (what is left to
   * decide, in order) and this is the ANNOTATION (why this day is loud).
   *
   * The margin only exists on days that have one. An empty margin is worse
   * than no margin — it makes the page look half-loaded, which is exactly
   * why the notes column came out.
   */
  function marginCards(day: string) {
    const decs = decisionsByDay?.get(day) ?? [];
    if (decs.length === 0) return [];
    const rows = rowsByDay.get(day) ?? [];
    const byId = new Map(rows.filter((r) => r.kind === 'perf').map((r) => [r.perf.id, r]));
    return decs.map((d, i) => ({
      key: `${day}:${i}`,
      reason: d.reason,
      severity: d.severity,
      sides: d.ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((r) => {
          const sl = performanceSlip(r!.perf, slipCtx);
          return { id: sl.id, name: sl.name, time: sl.time?.primary ?? null, project: sl.project };
        }),
    }));
  }

  /* ── THE POST-IT'S WRITER (ADR-093) ────────────────────────────────────
     A note is about SOMETHING (§1): a day with one entry pre-fills that
     anchor, a day with several asks which, and an empty day says where it
     will fall — the page's fallback (pinned scope → the company). The
     component only ever answers with an entry of the day it can see;
     resolving the fallback into ids is the page's business. */
  type NoteAnchorOption = { key: string; label: string; performance_id?: string; date_id?: string };
  function noteAnchorOptions(day: string): NoteAnchorOption[] {
    const out: NoteAnchorOption[] = [];
    for (const r of rowsByDay.get(day) ?? []) {
      if (r.kind === 'perf') {
        const sl = performanceSlip(r.perf, slipCtx);
        out.push({ key: `p:${r.perf.id}`, label: sl.name, performance_id: r.perf.id });
      } else {
        const sl = dateSlip(r.date, slipCtx);
        out.push({ key: `d:${r.date.id}`, label: sl.name, date_id: r.date.id });
      }
    }
    return out;
  }
  let writingDay = $state<string | null>(null);
  let noteDraft = $state('');
  /** '' = the fallback (company/scope); otherwise a NoteAnchorOption key. */
  let noteAnchorKey = $state('');
  let notePending = $state(false);
  function openNoteWriter(day: string) {
    writingDay = day;
    noteDraft = '';
    noteAnchorKey = noteAnchorOptions(day)[0]?.key ?? '';
  }
  function closeNoteWriter() {
    writingDay = null;
    noteDraft = '';
    notePending = false;
  }
  async function saveNote(day: string) {
    if (!onNoteCreate || notePending) return;
    const body = noteDraft.trim();
    if (!body) return;
    const opt = noteAnchorOptions(day).find((o) => o.key === noteAnchorKey);
    notePending = true;
    const ok = await onNoteCreate({
      body,
      on_day: day,
      ...(opt?.performance_id ? { performance_id: opt.performance_id } : {}),
      ...(opt?.date_id ? { date_id: opt.date_id } : {}),
    });
    notePending = false;
    if (ok) closeNoteWriter();
  }
  function noteKeydown(e: KeyboardEvent, day: string) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveNote(day);
    } else if (e.key === 'Escape') {
      closeNoteWriter();
    }
  }

  function awayLines(day: string) {
    const out: Array<{ key: string; who: string; rest: string; tentative: boolean }> = [];
    railItems.forEach((item, i) => {
      if (day < item.from || day > item.to) return;
      const left = daysBetween(day, item.to);
      const rest =
        left === 0
          ? awayBackWord
          : `${awayUntilWord} ${localeDayMonth(item.to, locale)} · ${
              left === 1 ? awayLeftOneWord : awayLeftWord.replace('{n}', String(left))
            }`;
      out.push({ key: `${i}:${day}`, who: item.label, rest, tentative: Boolean(item.tentative) });
    });
    return out;
  }
  /** Whole days from a to b, both ISO, b >= a. */
  function daysBetween(a: string, b: string): number {
    return Math.round(
      (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
    );
  }

  function railSegs(day: string): Array<{ item: RailItem; lane: number; i: number }> {
    const out: Array<{ item: RailItem; lane: number; i: number }> = [];
    railItems.forEach((item, i) => {
      if (day >= item.from && day <= item.to) {
        out.push({ item, lane: railLanes.lanes[i], i });
      }
    });
    return out;
  }

  /* ── THE DIARY LOADS FORWARDS BY ITSELF, AND BACKWARDS ON PURPOSE ─────
     One sentinel below the last day: come within 800px of the foot and the
     page is asked for another month — you are travelling that way, and the
     next month should already be there when you arrive.

     THE HEAD HAS NO SENTINEL ANY MORE, and this is the second reversal of
     that decision, so here is the whole of it. Backwards began as a button;
     the button became a sentinel on the argument that one gesture — keep
     reading — should work in both directions. But UP is not the mirror of
     DOWN. Above the book sits the page's chrome, so the same flick means
     «more past» on one day and «let me out» on another, and the diary
     cannot tell which; with an anchored prepend the trap completes itself —
     every approach to the top inserts a month above the reader and pins
     them where they were, so the top RECEDES as you reach for it. The
     runaway of 2026-08-02 (822 days on one flick) was patched with gates
     and floors, and the gates treated the symptom: the disease was that
     reaching the top and loading the past were one gesture.

     So backwards is an ACT again, in two forms: the quiet line at the head
     of the book («↑ earlier months»), and the overpull — already at the
     very top, a second deliberate pull asks for one month (below). Reaching
     the top now costs nothing and loads nothing. */
  let endSentinel = $state<HTMLElement>();
  const REACH_END = 800;
  /* The callback re-measures instead of trusting its entry: an observer
     delivers the state it SAW, later — stale by one layout whenever the
     span just changed. One layout read, and it cannot lie. */
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

  /* ── THE OVERPULL · a second gesture at the top asks for one month ────
     The flick that ARRIVES at the top must not count: on a trackpad its
     momentum tail keeps emitting upward deltas after the page has stopped,
     which is exactly the auto-load this replaces. A deliberate second pull
     is a NEW gesture, and the seam between two gestures is a pause in the
     event stream — so the counter only arms after a quiet gap, and a tail
     (continuous, ~16ms apart) never arms it. One month per pull: the
     anchored prepend leaves the reader below the new month, so the next
     pull travels through it before it can ask again. */
  const OVERPULL_PX = 120;
  const GESTURE_GAP_MS = 160;
  /** Quiet on the wheel stream for this long = the hand came off. The
      browser exposes NO touch state for wheel gestures — no mouseup, no
      contact phase — so a resting hand and a lifted one emit exactly the
      same silence, and quiet-time is the only release there is. 400ms
      keeps a mid-gesture breather from firing; a deliberate half-second
      hold still will, and cannot not. */
  const RELEASE_QUIET_MS = 400;
  let pullArmed = false;
  let pullAcc = 0;
  let lastPullAt = 0;
  let pullTimer: ReturnType<typeof setTimeout> | undefined;
  /** The «↑ earlier months» line hides until the reader tries to scroll
      past the top (Marco, 2026-08-03) — the gesture that needs the door is
      the one that draws it. Session-sticky once shown. */
  let earlierRevealed = $state(false);
  /** Threshold crossed, hand still on the wheel — the load is PROMISED. */
  let pullPending = $state(false);
  /** The jump itself is in flight (released, or the line was clicked). */
  let pullLoading = $state(false);
  async function fireEarlier() {
    if (!onReachStart || pullLoading) return;
    pullLoading = true;
    try {
      await onReachStart();
    } finally {
      pullLoading = false;
    }
  }
  /* THE LOAD WAITS FOR THE HAND TO COME OFF (Marco, 2026-08-04). Firing
     mid-gesture moved the book under fingers that were still pulling —
     and with the primed jump landing whole months at once, that read as
     the page misbehaving. Crossing the threshold now only PROMISES the
     load (the line turns to «loading…»); the fetch fires when the stream
     goes quiet, because a wheel has no mouseup — quiet IS the release.
     Pulling back down before the quiet cancels the promise. */
  $effect(() => {
    if (!onReachStart) return;
    const release = () => {
      if (!pullPending) return;
      pullPending = false;
      pullArmed = false;
      pullAcc = 0;
      void fireEarlier();
    };
    const onWheel = (e: WheelEvent) => {
      // deltaMode 1 = lines (a notched wheel on some browsers) → ~16px each.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const gap = performance.now() - lastPullAt;
      lastPullAt = performance.now();
      if (dy >= 0 || window.scrollY > 0) {
        pullArmed = false;
        pullAcc = 0;
        if (pullPending) {
          pullPending = false; // the reader pulled back — promise cancelled
          clearTimeout(pullTimer);
        }
        return;
      }
      if (!pullArmed) {
        if (gap < GESTURE_GAP_MS) return; // the arriving flick's tail
        pullArmed = true;
        pullAcc = 0;
        earlierRevealed = true; // the attempt itself summons the door
      } else if (gap > GESTURE_GAP_MS && !pullPending) {
        pullAcc = 0; // a new pull, still deliberate — it starts fresh
      }
      pullAcc += -dy;
      if (pullAcc >= OVERPULL_PX) pullPending = true;
      if (pullPending) {
        clearTimeout(pullTimer);
        pullTimer = setTimeout(release, RELEASE_QUIET_MS);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      clearTimeout(pullTimer);
    };
  });
</script>

<div
  class="ag"
  class:ag--loading={loading}
>
  <!-- THE NOTES COLUMN AND THE ABSENCE RAIL ARE GONE (Marco, 2026-08-03).

       The notes column reserved 240px of every diary to draw a dot grid and
       the word NOTES. There is nothing to put in it: the `note` table is
       ADR-093's, committed and not applied, so the column was a promise the
       app could not keep — and an empty margin is worse than no margin,
       because it makes the page look like it failed to load. It comes back
       when it has something to hold.

       The rail drew each absence as a vertical capsule off to the right, with
       the person's name set sideways. It was already redundant the moment an
       absence became a SENTENCE inside the day it affects — «Mia away · until
       20 jul · 5 days left» — and what was left was a stray `MEMI` running
       vertically down the margin of a day that had nothing to do with it. Two
       drawings of one fact, and the one that survives is the one you can
       read. -->
  {#if shownDays.length === 0}
    <p class="ag__empty">{emptyLabel}</p>
  {:else}
    <!-- THE HEAD IS AN ACT, NOT AN EDGE. This line is the past's door, and
         the overpull gesture is its shortcut — the same callback, two ways
         in. It HIDES until the reader tries to scroll past the top: the
         gesture that needs it is the one that draws it. Still in the DOM
         (focus reveals it — the keyboard's way up), and it vanishes with
         the callback at the page's floor. -->
    {#if onReachStart}
      <button
        type="button"
        class="ag__earlier"
        class:ag__earlier--in={earlierRevealed}
        disabled={pullLoading}
        onclick={() => void fireEarlier()}
        >{pullPending || pullLoading ? loadingLabel : earlierLabel}</button
      >
    {:else if noEarlierLabel}
      <!-- The head's honest end: the past was asked for and holds nothing
           (or the floor is reached). A fact, not a door. -->
      <p class="ag__end">{noEarlierLabel}</p>
    {/if}

    {#each chunks as ch (ch.key)}
      {#if ch.t === 'month'}
        <!-- THE CHAPTER HEAD IS A DOOR. Shut, it carries the month's whole
             shape on its own line — the same three counts its week bands
             would have said — and the word that opens it. An empty month
             arrives shut in both directions, so two years of quiet history
             prepend as chapter heads, not as 850px each. `data-month` is
             the page's scroll target when the days inside are not drawn. -->
        <h2 class="ag__monthdiv" data-month={ch.mk}>
          <button
            type="button"
            class="ag__monthdiv-btn"
            aria-expanded={!ch.collapsed}
            onclick={() => monthOverride.set(ch.mk, ch.collapsed)}
          >
            <span class="ag__monthdiv-name">{monthDivName(ch.day)}</span>
            <span class="ag__monthdiv-year">{monthDivYear(ch.day)}</span>
            <!-- No door word: «show» is what this trade calls a gig, so the
                 verb read as a noun. The whole head is the handle; the tally
                 alone is the shut month's sentence. -->
            {#if ch.collapsed}
              <span class="ag__monthdiv-t">{weekTally(ch.firm, ch.held, ch.free)}</span>
            {/if}
          </button>
        </h2>
      {:else if ch.t === 'week'}
        <!-- THE WEEK'S OWN LINE — and a door. Shut, the band IS the fact
             («7 nights free» needs no seven rows under it); open, it prints
             every day it has, empty ones included — the run line died for
             this. A straddling week appears once per month it touches. -->
        <button
          type="button"
          class="ag__week"
          class:ag__week--shut={!ch.open}
          aria-expanded={ch.open}
          onclick={() => weekOverride.set(ch.key, !ch.open)}
        >
          <span class="ag__week-n">{weekLabel(ch.n)}</span>
          <span class="ag__week-r">{weekRange(ch.from, ch.to)}</span>
          <span class="ag__week-t">{weekTally(ch.firm, ch.held, ch.free)}</span>
        </button>
      {:else}
        {@const day = ch.day}
      {@const items = dayItems(day)}
      {@const banners = clashesByDay?.get(day) ?? []}
      {@const empty = items.length === 0 && banners.length === 0}
      <section
        class="ag__day"
        class:ag__day--empty={empty}
        class:ag__day--today={day === todayIso}
        data-day={day}
      >
        <!-- TWO BRANCHES, NOT `<svelte:element>`: a real `<button>` carries
             the role, the keyboard and the focus ring for free, and a
             dynamic tag cannot be checked for any of the three. -->
        {#if onDayOpen}
          <button type="button" class="ag__head" onclick={() => onDayOpen?.(day)}>
            <span class="ag__wd">{headWeekday(day)}</span>
            <span class="ag__num">{Number(day.slice(8, 10))}</span>
          </button>
        {:else}
          <header class="ag__head">
            <span class="ag__wd">{headWeekday(day)}</span>
            <span class="ag__num">{Number(day.slice(8, 10))}</span>
          </header>
        {/if}
        <div class="ag__rows">
          <!-- NO BANNER BOXES. A clash used to print a grey slab per pair
               above the day — «! No team data — could clash.» twice over —
               while the two rows it was about sat underneath saying nothing.
               The rule down the pair says WHICH two, in place, and the margin
               card says what to do about it. Three tellings became one. -->
          {#each items as it, ii (ii)}
            {#if 'contest' in it}
              <!-- THE PAIR STAYS TOGETHER AND SAYS NOTHING EXTRA. It used to
                   wear a grey head — «? No team data — they could clash.» with
                   a `DECIDE ↑` — which is now the THIRD telling of one fact:
                   the dotted rule marks exactly the two rows, and the margin
                   card beside them says why and what to do. The wrapper keeps
                   the two rows adjacent; the words are gone. -->
              <div class="ag__pair">
                {@render eventRow(it.contest.a)}
                {@render eventRow(it.contest.b)}
              </div>
            {:else}
              {@render eventRow(it.row)}
            {/if}
          {/each}
          <!-- AN ABSENCE IS A LINE INSIDE THE DAY IT AFFECTS, not a capsule
               in a rail off to the side. The rail draws a shape you have to
               decode against a legend; the line says the sentence — who,
               until when, and how much of it is left — in the day where it
               matters, which is where you are already looking.

               AND IT GOES AT THE FOOT (Marco, 2026-08-10). Over the rows it
               read as a heading — as if the day were ABOUT the absence — and
               on an empty day it was the only thing there, at the top, which
               made a quiet day look like an event. The board already sits
               its band on the row's floor; the diary does the same. An
               absence is the condition the day ends under. -->
          {#each awayLines(day) as a (a.key)}
            <p class="away-line ag__away" class:away-line--tent={a.tentative}>
              <span class="away-line__who">{a.who}</span>{a.rest}
            </p>
          {/each}
        </div>
          <!-- THE MARGIN IS A COLUMN OF THE DIARY, not a thing that appears.
               It was drawn only on days that had a call, so the page's right
               edge moved from day to day and the rule that separates reading
               from annotating came and went. What had to go was the DECORATION
               it used to hold — a dot grid and the word NOTES over nothing —
               not the column. An empty margin is fine; a jumping one is not. -->
          <aside class="ag__marg">
            {#each marginCards(day) as card (card.key)}
                <div class="ag__card" data-severity={card.severity}>
                  <p class="ag__card-eyebrow">{decideCardLabel}</p>
                  <p class="ag__card-say">{card.reason}</p>
                  {#each card.sides as side (side.id)}
                    <p class="ag__card-side">
                      {#if side.project}<IdentityMark
                          mini
                          accent={accentVarFor(side.project)}
                          name={side.project.name}
                          initials={side.project.initials}
                        />{/if}
                      <span class="ag__card-venue">{side.name}</span>
                      {#if side.time}<span class="ag__card-time">{side.time}</span>{/if}
                    </p>
                  {/each}
                </div>
            {/each}
            <!-- THE POST-ITS (ADR-093). Mine, always private: serif italic —
                 marginalia voice, a hand in the margin, not the machine — and
                 the delete waits under the pointer like every verb here. -->
            {#each notesByDay?.get(day) ?? [] as n (n.id)}
              <div class="ag__note">
                <p class="ag__note-body">{n.body}</p>
                {#if onNoteDelete}
                  <button
                    type="button"
                    class="ag__note-x"
                    aria-label={noteDeleteLabel}
                    onclick={() => onNoteDelete?.(n.id)}>×</button
                  >
                {/if}
              </div>
            {/each}
            {#if onNoteCreate}
              {#if writingDay === day}
                {@const opts = noteAnchorOptions(day)}
                <div class="ag__note ag__note--edit">
                  <!-- svelte-ignore a11y_autofocus — the writer exists because
                       the reader just asked to write; focus IS the answer. -->
                  <textarea
                    class="ag__note-input"
                    rows="2"
                    autofocus
                    placeholder={notePlaceholder}
                    bind:value={noteDraft}
                    disabled={notePending}
                    onkeydown={(e) => noteKeydown(e, day)}
                  ></textarea>
                  {#if opts.length > 1}
                    <select class="ag__note-anchor" bind:value={noteAnchorKey} disabled={notePending}>
                      {#each opts as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
                      <option value="" class:ag__note-anchor--space={noteFallbackIsSpace}
                        >{noteFallbackLabel}</option
                      >
                    </select>
                  {:else}
                    <p
                      class="ag__note-anchorword"
                      class:ag__note-anchor--space={!opts[0] && noteFallbackIsSpace}
                    >{opts[0]?.label ?? noteFallbackLabel}</p>
                  {/if}
                </div>
              {:else}
                <button
                  type="button"
                  class="ag__note-add"
                  aria-label={noteAddLabel}
                  onclick={() => openNoteWriter(day)}>＋</button
                >
              {/if}
            {/if}
          </aside>
      </section>
      {/if}
    {/each}

    <!-- The sentinel yields to the VERDICT, not just to a quiet tail: with
         content in today's month the tail is never quiet, yet the plan can
         still be finished — the line must win over the sentinel then. -->
    {#if endLabel}
      <p class="ag__end">{endLabel}</p>
    {:else if onReachEnd && !endStop}
      <div class="ag__sentinel" bind:this={endSentinel} aria-hidden="true"></div>
    {/if}
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
  >
    {#snippet actions()}
      {#if row.kind === 'perf' && onConfirm}
        {@const fam = performanceStatusFamily(row.perf.status)}
        {#if fam === 'hold' || fam === 'proposed'}
          <button
            type="button"
            class="ag__do"
            disabled={pendingId === row.perf.id}
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onConfirm?.(row.perf.id);
            }}>{confirmLabel}</button
          >
        {:else if fam === 'confirmed' && onRelease}
          <button
            type="button"
            class="ag__do ag__do--quiet"
            disabled={pendingId === row.perf.id}
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRelease?.(row.perf.id);
            }}>{releaseLabel}</button
          >
        {/if}
      {/if}
    {/snippet}
  </Slip>
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
      /* ONE CONTINUOUS RULE DOWN THE MARGIN, drawn by the diary and not by each
     day. On the day it worked, but only days that render rows have a margin
     box — and most of this page is week bands and collapsed runs, so the line
     came in dashes wherever something happened and vanished in between. A
     column is a column all the way down or it is not a column, which is what
     Marco kept reporting as «no existe». */
  background-image: linear-gradient(to right, var(--border-color-dark) 0 1px, transparent 1px);
  background-size: 1px 100%;
  background-position: right 15rem top;
  background-repeat: no-repeat;
}
/* The book stacks in column 1; the notes margin spans every row in 2. */
    .ag > :not(.ag__notes) {
      grid-column: 1;
      min-inline-size: 0;
    }
.ag--loading {
      opacity: 0.6;
    }
.ag__empty {
      padding-block: var(--space-xl);
      text-align: center;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-faint);
    }
/* Top «↑ earlier months» — margin voice, centred on the book's text column
   (the 15rem stops at the margin rule, same as the week bands). Hidden and
   heightless until summoned by the overpull's first armed gesture, or by
   keyboard focus; never display:none, so it stays reachable by tab. */
    .ag__earlier {
      max-block-size: 0;
      padding-block: 0;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      /* Tucked under the row above; the reveal slides it out from beneath. */
      transform: translateY(-0.5rem);
      padding-inline-end: 15rem;
      border: 0;
      background: none;
      text-align: center;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      cursor: pointer;
      transition:
        max-block-size 0.3s ease,
        padding-block 0.3s ease,
        transform 0.3s ease,
        opacity 0.25s;
    }
    .ag__earlier--in,
    .ag__earlier:focus-visible {
      max-block-size: 3rem;
      padding-block: var(--space-s);
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
    .ag__earlier:hover {
      color: var(--text-color);
    }
    .ag__earlier:disabled {
      cursor: default;
    }
/* The book's honest ends — «nothing more planned» · «nothing further
   back». Margin voice, centred on the text column like the door above. */
    .ag__end {
      margin: 0;
      padding-block: var(--space-s);
      padding-inline-end: 15rem;
      text-align: center;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      overflow: hidden;
      /* Mounted by an {#if}, so it POPPED. It slides out from beneath the
         row above instead — same motion as the door it often replaces. */
      animation: ag-endrise 0.3s ease-out;
    }
    @keyframes ag-endrise {
      from {
        max-block-size: 0;
        padding-block: 0;
        opacity: 0;
        transform: translateY(-0.5rem);
      }
      to {
        max-block-size: 3rem;
        padding-block: var(--space-s);
        opacity: 1;
        transform: none;
      }
    }

    /* ── Serif month divider — the book's chapter head. ── */
    /* ── THE WEEK'S BAND · number, range, shape ───────────────────────
       All mono, all margin voice: this is the machine reporting on a stretch
       of the diary, not a thing that happens in it. The tally goes right, so
       seven days of shape line up down the page and can be scanned without
       reading a word of them. */
    /* A DOOR, whole-row: the band was a <div>, now a bare <button>. */
    .ag__week {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      inline-size: 100%;
      padding: var(--space-s) 0 var(--space-2xs);
      border: 0;
      border-block-start: 1px solid var(--border-color-light);
      background: none;
      text-align: start;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      /* Stops BEFORE the margin's rule: the tally belongs to the days, not
     to the column that annotates them — and 15rem exactly is where the
     rule itself is drawn, so without the extra step the words touch it. */
  padding-inline-end: calc(15rem + var(--space-s));
}
.ag__week-n {
      color: var(--text-muted);
    }
.ag__week-t {
      margin-inline-start: auto;
      text-align: end;
    }
/* SHUT IS A VISIBLE STATE, NOT AN INFERENCE (Marco, 2026-08-03). Two
   identical bands in a row read as a stuttered heading — one is a drawer,
   the other the title of the days on show, and nothing said which. The
   code is the house's own, learned from the dead run line: DOTTED holds
   folded days, SOLID heads visible ones. The drawer also breathes a step
   more and its number drops to the faint ink of the rest of its line. */
.ag__week--shut {
      border-block-start-style: dotted;
      padding-block: var(--space-s);
    }
.ag__week--shut .ag__week-n {
      color: var(--text-faint);
    }
.ag__week:hover .ag__week-n {
      color: var(--text-color);
    }
.ag__week:hover .ag__week-t {
      color: var(--text-muted);
    }
.ag__monthdiv {
      margin-block: var(--space-l) var(--space-2xs);
      font-weight: 400;
    }
.ag__monthdiv:first-child {
      margin-block-start: var(--space-2xs);
    }
/* The chapter head is the door's handle — full row, bare button. */
.ag__monthdiv-btn {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      inline-size: 100%;
      padding: 0;
      padding-inline: var(--space-xs) calc(15rem + var(--space-s));
      border: 0;
      background: none;
      text-align: start;
      cursor: pointer;
      font: inherit;
    }
/* The shut month's shape — margin voice, ending where its bands would. */
.ag__monthdiv-t {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      text-align: end;
    }
.ag__monthdiv-btn:hover .ag__monthdiv-t,
.ag__monthdiv-btn:hover .ag__monthdiv-year {
      color: var(--text-muted);
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
/* A landing (`Now`, the ‹ › steps) goes under TWO stuck bars now — the
   shell's and the toolbar's. `scrollIntoView` reads this; the line page
   set the precedent for the shape of the calc. */
    .ag__day,
    .ag__monthdiv,
    .ag__end {
      scroll-margin-block-start: calc(var(--header-height) + 3rem);
    }
/* ── Day group: header column + rows, a ledger rule beneath. ── */
    .ag__day {
      position: relative;
      display: grid;
      /* Three columns: the date, the day, and a margin that only draws when
         the day has a call to make. `auto` collapses to nothing on the days
         that do not — no reserved emptiness. */
      grid-template-columns: 6rem minmax(0, 1fr) 15rem;
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
/* THE VERB WAITS TO BE NEEDED. It is the only thing on a diary row that
   writes, so it stays in the margin voice and appears under the pointer — a
   column of `CONFIRM` down a page of options reads as a demand, and most of
   what you do here is read. */
/* The absence's line is `.away-line` (styles/absence.css) — one voice for
   every view. What belongs to the DIARY is only where it sits: at the foot
   of the day's rows, on the rows' own indent. */
.ag__away {
  padding: 3px 8px 1px;
}

button.ag__head {
  padding: 0;
  border: 0;
  background: none;
  text-align: start;
  cursor: pointer;
}
button.ag__head:hover .ag__num {
  color: var(--text-color);
}

.ag__marg {
  padding: var(--space-xs) 0 var(--space-xs) var(--space-s);
  /* THE SAME 9% NEUTRAL THAT WAS INVISIBLE ON THE CARD IS INVISIBLE HERE,
     and for the same reason plus one: a SHORT VERTICAL hairline reads far
     weaker than a long horizontal one, so the day dividers get away with 9%
     and this does not. The column measured 240px wide on every day and Marco
     still reported it missing — because the only thing that says a column is
     there is the line down its edge. */
}
/* An accent RULE along the top, not a box: the app draws no dashed
   containers, and a filled card here would outweigh the two rows it is
   annotating. */
.ag__card {
  padding-block-start: var(--space-2xs);
  border-block-start: 1.5px solid var(--info);
}
.ag__card[data-severity='people'] {
  border-block-start-color: var(--danger);
}
.ag__card + .ag__card {
  margin-block-start: var(--space-s);
}
.ag__card-eyebrow {
  margin: 0 0 3px;
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--info);
}
.ag__card[data-severity='people'] .ag__card-eyebrow {
  color: var(--danger);
}
.ag__card-say {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-s);
  line-height: 1.35;
  color: var(--text-color);
}
.ag__card-side {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 2px;
  min-inline-size: 0;
}
.ag__card-venue {
  font-size: var(--text-s);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ag__card-time {
  margin-inline-start: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── THE POST-IT (ADR-093) · marginalia voice ──────────────────────────
   Serif italic, a hand writing in the margin — the cards above are the
   machine annotating; this is the reader. No box, no fill: the margin IS
   the paper. */
.ag__note {
  position: relative;
  padding-block: var(--space-2xs);
}
.ag__card + .ag__note {
  margin-block-start: var(--space-s);
}
.ag__note-body {
  margin: 0;
  padding-inline-end: 14px; /* room for the × */
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--text-s);
  line-height: 1.4;
  color: var(--text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ag__note-x {
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: var(--space-2xs);
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  line-height: 1;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s;
}
.ag__note:hover .ag__note-x,
.ag__note-x:focus-visible {
  opacity: 1;
}
.ag__note-x:hover {
  color: var(--text-color);
}
/* The writer: a bare seam, not a widget. Same voice as the note it becomes. */
.ag__note-input {
  display: block;
  inline-size: 100%;
  padding: 0;
  border: 0;
  background: none;
  resize: none;
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--text-s);
  line-height: 1.4;
  color: var(--text-color);
}
.ag__note-input:focus {
  outline: none;
}
.ag__note-input::placeholder {
  color: var(--text-faint);
}
/* The anchor line under the box — margin voice, like the card eyebrow.
   A word when the day answered it, a select when the day asks. */
.ag__note-anchor,
.ag__note-anchorword {
  margin: 2px 0 0;
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.ag__note-anchor {
  cursor: pointer;
  max-inline-size: 100%;
}
/* The label register is caps — except when the anchor IS a space, which is
   written lowercase. The letter-spacing stays; only the case steps aside. */
.ag__note-anchor--space {
  text-transform: none;
}
/* `＋` waits to be needed, like the verbs on the rows. */
.ag__note-add {
  padding: 0;
  border: 0;
  background: none;
  font-size: 12px;
  line-height: 1;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s;
}
.ag__day:hover .ag__note-add,
.ag__note-add:focus-visible {
  opacity: 1;
}
.ag__note-add:hover {
  color: var(--text-color);
}

.ag__pair {
  display: contents;
}

.ag__do {
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s;
}
:global(.slip:hover) .ag__do,
.ag__do:focus-visible {
  opacity: 1;
}
.ag__do:hover {
  color: var(--text-color);
}
.ag__do:disabled {
  cursor: default;
  opacity: 0.4;
}

.ag__sentinel {
      block-size: 1px;
    }
@media (max-width: 560px) {
      .ag__day {
        grid-template-columns: 4.25rem 1fr;
      }
      /* On a phone the margin has nowhere to go: the annotation falls under
         the day it annotates rather than squeezing the reading to a gutter. */
      .ag__marg {
        grid-column: 1 / -1;
        padding-inline-start: 4.25rem;
        border-inline-start: 0;
      }
      .ag__marg:empty {
        display: none;
      }
      /* No hover on glass: the `＋` is simply there. */
      .ag__note-add {
        opacity: 1;
      }
    }
}
</style>
