<script lang="ts">
  /**
   * Calendar lens — ONE door, two first-class projections (ADR-076):
   * month grid and agenda list, both over the same fetched rows. The
   * projection travels in the URL (`?view=month|agenda`, no /h/agenda
   * alias — ADR-078 §10), persists per device (localStorage) and defaults
   * by form factor (narrow → agenda, wide → month).
   *
   * Event sources: `performance` (performed_at, day-level truth, fetched
   * with ?rosters=1 for the conflict engine) and `date` (rehearsals,
   * travel, residencies, press, day off, other — timestamptz, bucketed
   * into the linked venue's day per the timezone rule). Calendar v2 adds
   * `availability_block` (blackouts) — fetched WITHOUT a workspace filter
   * so cross-space person blocks feed the engine (ADR-078 §5); the bands/
   * rail render only the scope's workspaces. All three new feeds follow
   * the contract's § Graceful absence: a pre-migration DB answers 502 and
   * the features simply stay off — zero errors surfaced.
   *
   * PINS are the filter (ADR-057; projects ADR-060): events come from the
   * union of pinned spaces/projects/lines, or everything RLS allows when
   * nothing is pinned. While pins exist but haven't resolved to ids yet
   * (caches loading), the feed stays disabled rather than silently
   * fetching unfiltered.
   *
   * The page owns the feeds, the pins scoping, the conflict/away engines,
   * the i18n and the Feed/ICS dialog (now behind the "⋯" overflow);
   * MonthGrid and AgendaList render. Creation is the UNIFIED dialog
   * (ADR-078 §1): every "+" — toolbar and day cells — opens
   * CreateEventDialog with the day/scope presets; the blackout dialog
   * hangs off its quiet footer action and the "⋯" overflow, and hides
   * itself while the availability/team feeds are absent.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import MonthGrid from '$lib/components/MonthGrid.svelte';
  import {
    dateDayKey,
    monthName,
    perfDayKey,
    type AwayBandVM,
    type BlackoutBandVM,
    type ClashVM,
    type DateEvent,
    type NoteEvent,
    type PerformanceEvent,
    performanceSlip,
    dateSlip,
    type Slip as SlipVM,
  } from '$lib/month-events';
  import AgendaList, { type AgendaDecision, type NoteDraft } from '$lib/components/AgendaList.svelte';
  import DecisionBand, {
    type ConcurrenceVM,
    type DecisionOptionVM,
    type DecisionVM,
  } from '$lib/components/planner/DecisionBand.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import CarrilsStrip from '$lib/components/planner/CarrilsStrip.svelte';
  import {
    activeDaySet,
    boardLaneCount,
    buildColumns,
    laneEvents,
    normalizeAway,
    personGroups,
    scopeGroups,
    type AwayRun,
    type BoardClash,
    type BoardColumn,
    type BoardEventIn,
    type BoardGroup,
    type LaneTally,
  } from '$lib/board-lanes';
  import CalToolbar from '$lib/components/planner/CalToolbar.svelte';
  import Button from '$lib/components/Button.svelte';
  import CalLegend from '$lib/components/planner/CalLegend.svelte';
  import DayStrip from '$lib/components/planner/DayStrip.svelte';
  import DayFoot, { type DayNextVM } from '$lib/components/planner/DayFoot.svelte';
  import { performanceThread, dateThread, stripWindow, hourOf } from '$lib/day-strip';
  import Dialog from '$lib/components/Dialog.svelte';
  import FeedDialog from '$lib/components/planner/FeedDialog.svelte';
  import CreateEventDialog from '$lib/components/create/CreateEventDialog.svelte';
  import EditDateDialog from '$lib/components/planner/EditDateDialog.svelte';
  import CreateBlackoutDialog from '$lib/components/create/CreateBlackoutDialog.svelte';
  import type { CreatedPerformance } from '$lib/components/PerformanceForm.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import { detectLocale, t } from '$lib/i18n';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import {
    addDaysIso,
    addMonths,
    awayBands,
    conflictsFor,
    dayKeyInTz,
    decisionsFor,
    monthGrid,
    resolvePlannerView,
    type PlannerEvent,
    type PlannerView,
    type Conflict,
    type DecisionPerformance,
    type DecisionSide,
    normalizePlannerView,
    nightsFree,
    daysCoveredBy,
    isoWeek,} from '$lib/planner';
  import { buildPersonScope } from '$lib/people';
  import { createPlannerFeeds, primeAgendaWindow } from '$lib/planner-feeds.svelte';
  import { normalizeLaneAxis, resolveLaneAxis, type LaneAxis } from '$lib/carrils';
  import type { AvailabilityItem } from '$lib/availability';
  import type { DateRow } from '$lib/date';
  import { localeDayMonth, localeWeekdayShort, timeInTz, hourMark, dualTime } from '$lib/datetime';
  import {
    isHoldStatus,
    performanceStatusFamily,
    performanceStatusLabel,
    READINESS_KEYS,
    readinessLabelKey,
    statusFootKey,
  } from '$lib/performance';
  import { dateStatusFamily } from '$lib/date';
  import { accentVarFor } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';

  type WorkspaceLite = { id: string; slug: string; name: string };

  const pins = usePins();
  const calm = useCalm();
  // «Reading the marks» — the grammar key, out of the sheet and into the head
  // (ADR-095 §3), so it is reachable from all four drawings and not from the
  // foot of one of them.
  let marksOpen = $state(false);
  /**
   * THE DAY the Day view is looking at. In the URL like everything else
   * (ADR-095 §9) — a day you are reading is exactly the kind of thing you send
   * somebody. Defaults to today, which is where a diary starts.
   */
  let dayIso = $state(
    (() => {
      const raw = new URL(location.href).searchParams.get('d');
      return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    })(),
  );
  const locale = detectLocale(navigator.language);
  const localeTag = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' }[locale];
  /** The ghost row's word: «nobody is on this» is an answer, not a hole. */
  const noCastWord = t('planner.no_cast', locale);

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  let ym = $state({ year: now.getFullYear(), month: now.getMonth() + 1 });
  let todayIso = dayKeyInTz(now.toISOString(), viewerTz);

  let weeks = $derived(monthGrid(ym.year, ym.month));
  let gridFrom = $derived(weeks[0][0].iso);
  let gridTo = $derived(weeks[weeks.length - 1][6].iso);

  // The visible month's own days (agenda range + masthead stats window).
  let monthFirst = $derived(`${ym.year}-${String(ym.month).padStart(2, '0')}-01`);
  let monthDays = $derived.by(() => {
    const out: string[] = [];
    let d = monthFirst;
    while (d.slice(0, 7) === monthFirst.slice(0, 7)) {
      out.push(d);
      d = addDaysIso(d, 1);
    }
    return out;
  });
  let monthLast = $derived(monthDays[monthDays.length - 1]);

  // ── Agenda span (ADR-076 continuous book) — the agenda projection is a
  // multi-month scroll, INDEPENDENT of `ym` (which stays the single-month
  // truth for Month/Carrils). Seed = today's month; every growth — scroll,
  // door, arrows — goes through the probes (jump-to-planned or honest
  // end), so no path ever mints a month the plan does not contain. The whole
  // downstream engine reads the agenda window only while view === 'agenda'
  // (the source-switch below), so nothing here perturbs the other two. ──
  function firstOfMonth(m: { year: number; month: number }): string {
    return `${m.year}-${String(m.month).padStart(2, '0')}-01`;
  }
  // The book OPENS on today (not the 1st) — a diary starts where you are.
  // "Earlier" probes down to where history begins and jumps there.
  // The seed is TODAY'S MONTH ALONE (Marco, 2026-08-03): it used to be +2,
  // and with honest ends those two months surfaced as empty chapters
  // between the last gig and «nothing more planned». The forward probe
  // pulls the future in only where it exists.
  let agendaFromIso = $state(todayIso);
  let agendaEnd = $state(addMonths(now.getFullYear(), now.getMonth() + 1, 0));
  let agendaToIso = $derived(
    addDaysIso(firstOfMonth(addMonths(agendaEnd.year, agendaEnd.month, 1)), -1),
  );
  // Every ISO day across the span — the agenda renders ALL of them (empty
  // days included), so this replaces the "days with events" rule entirely.
  let agendaDays = $derived.by(() => {
    const out: string[] = [];
    let d = agendaFromIso;
    while (d <= agendaToIso) {
      out.push(d);
      d = addDaysIso(d, 1);
    }
    return out;
  });
  // The blind one-month steppers (`extendAgendaStart`/`extendAgendaEnd`)
  // died 2026-08-03: every way the window grows now goes through the
  // probes, so the book never mints a month the plan does not contain.

  // ── Projection (ADR-076 + ADR-078 §10) ───────────────────────────────
  // Resolution: explicit ?view= → localStorage (per device) → form factor.
  const VIEW_STORAGE_KEY = 'hour:calendar:view';
  function storedView(): string | null {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  let view = $state<PlannerView>(
    resolvePlannerView(
      new URL(location.href).searchParams.get('view'),
      storedView(),
      matchMedia('(max-width: 640px)').matches,
    ),
  );
  // The Board's lane axis (ADR-094, ADR-095 §9) — same persistence chain
  // as the projection: ?lanes= → localStorage → 'scope'. The dial says
  // «by scope | person» now; the entity generation (workspace/project) and
  // the Catalan one are translated once on entry by resolveLaneAxis, so a
  // stored old word in this key lands on the current vocabulary and the
  // first write replaces it.
  const GROUP_STORAGE_KEY = 'hour:calendar:group';
  function storedGroup(): string | null {
    try {
      return localStorage.getItem(GROUP_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  let laneAxis = $state<LaneAxis>(
    resolveLaneAxis(
      // `group` is the previous generation of this parameter; read once.
      new URL(location.href).searchParams.get('lanes') ??
        new URL(location.href).searchParams.get('group'),
      storedGroup(),
    ),
  );

  /**
   * Rewrite the address bar (the truth) with view · lanes · the month.
   *
   * THE DIALS ARE WRITTEN ONLY BY THE VIEW THAT HAS THEM (ADR-095 §9): a URL
   * carrying `lanes=person` over the Month is a URL that lies. And the MONTH
   * goes in, which it never did — `ym` was component state, so with the title
   * about to become the date, a link you sent showed the reader a different
   * window from the one you were looking at. The agenda is exempt: it is a
   * continuous book with no single month to name.
   *
   * Legacy parameters are dropped here, never rewritten — they were already
   * translated on the way in.
   */
  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    if (view === 'board') url.searchParams.set('lanes', laneAxis);
    else url.searchParams.delete('lanes');
    // A horizon has no month: the two book-window drawings carry no ym.
    if (view === 'agenda' || view === 'board') url.searchParams.delete('ym');
    else url.searchParams.set('ym', `${ym.year}-${String(ym.month).padStart(2, '0')}`);
    if (view === 'day') url.searchParams.set('d', dayIso ?? todayIso);
    else url.searchParams.delete('d');
    url.searchParams.delete('group');
    replaceState(url, {});
  }
  function setView(v: PlannerView) {
    if (view === v) return;
    view = v;
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      // Storage disabled — in-session state still works.
    }
    // The address bar is the truth: replaceState (shallow routing) never
    // updates the reactive page.url (see tests/scope-url.spec.ts), so both
    // read and write go through location.href.
    syncUrl();
  }
  function setLaneAxis(g: LaneAxis) {
    if (laneAxis === g) return;
    laneAxis = g;
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, g);
    } catch {
      // Storage disabled — in-session state still works.
    }
    syncUrl();
  }
  // Inbound navigation carrying an explicit ?view=/&lanes=/&ym= (pasted link,
  // back/forward). page.url is only the trigger; location.href the truth.
  // Every legacy generation is translated HERE, once, and never written back.
  $effect(() => {
    void page.url;
    const params = new URL(location.href).searchParams;
    const nextView = normalizePlannerView(params.get('view'));
    if (nextView && nextView !== untrack(() => view)) view = nextView;

    const nextLanes = normalizeLaneAxis(params.get('lanes') ?? params.get('group'));
    if (nextLanes && nextLanes !== untrack(() => laneAxis)) laneAxis = nextLanes;

    /* AND THE TRANSLATION IS WRITTEN BACK, ONCE. Reading a legacy address and
       silently keeping it in the bar is half a translation: the state moved to
       `board`, the URL still said `carrils`, so copying the link handed the
       next person the old vocabulary again — forever. Rewriting here is what
       makes «translated once on entry» true.
       Caught by the ported `calAudit` law on its FIRST run (2026-07-31), which
       is exactly what that suite is for. */
    const legacy =
      (params.get('view') && params.get('view') !== nextView) ||
      params.has('group') ||
      (params.get('lanes') && params.get('lanes') !== nextLanes);
    if (legacy) syncUrl();

    const rawD = params.get('d');
    if (rawD && /^\d{4}-\d{2}-\d{2}$/.test(rawD) && rawD !== untrack(() => dayIso)) dayIso = rawD;

    const rawYm = params.get('ym');
    const m = rawYm?.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const cur = untrack(() => ym);
      if (month >= 1 && month <= 12 && (year !== cur.year || month !== cur.month)) {
        ym = { year, month };
      }
    }
  });

  /* ── THE PLANNER HAS NO FILTER (ADR-095 §3) ───────────────────────────
     Because the app already has one and it is called scope. Both narrowed by
     project, and both lived in the same hundred pixels: the scope bar says
     WHAT YOU ARE LOOKING AT one line above, and a second machine for the same
     act right underneath teaches that this lens reasons differently from the
     rest of the tool. One grammar for narrowing, everywhere.

     What survives is CALM, and it survives as a WORD, not a switch: it lives
     in the Desk (global, non-destructive) and the Planner draws
     `calm · confirmed only` on the facts side of the state line. A filter you
     cannot see is a filter that lies.

     TWO PREDICATES, ON PURPOSE. `vis` is the narrowing axis and governs
     COUNTING; `dvis` adds calm and governs DRAWING. So the counters keep
     saying `6 confirmed · 7 options · 12 nights free` whether or not calm is
     on — they count the WINDOW, not the drawing — and the word is what
     explains why only six are on the paper. */

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceNameById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.name])),
  );
  // Browsing context for link-building only (ADR-067): lens routes carry no
  // space segment; entity links borrow the default (first) workspace.
  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
  // The two maps the slip normaliser needs: a venue-less gig reads its home
  // space's clock, and the hold convention is resolved per workspace.
  let workspaceTzById = $derived(
    new Map(
      ($workspacesQuery.data?.items ?? []).map((w) => [
        w.id,
        (w as { timezone?: string }).timezone,
      ]),
    ),
  );
  let workspaceModeById = $derived(
    new Map(
      ($workspacesQuery.data?.items ?? []).map((w) => [
        w.id,
        (w as { booking_mode?: string }).booking_mode ?? 'simple',
      ]),
    ),
  );

  let projectIndex = $derived(
    buildProjectIndex(($workspacesQuery.data?.items ?? []) as NavWorkspace[], $projectsQuery.data?.items ?? []),
  );
  let lineIndex = $derived(
    buildLineIndex(($workspacesQuery.data?.items ?? []) as NavWorkspace[], ($linesQuery.data?.items as RawLine[]) ?? []),
  );
  let scope = $derived(resolveScope(pins.pins, ($workspacesQuery.data?.items ?? []) as NavWorkspace[], lineIndex, projectIndex));
  // Project and line pins scope through project ids (the endpoint filters
  // by project_ids ∪ workspace_ids); the exact-line narrowing happens
  // client-side.
  let filterIds = $derived({
    projectIds: scope.projectIds,
    workspaceIds: scope.workspaceIds,
  });
  // Hold the feed while project/line pins exist but their caches haven't
  // resolved them yet (avoids flashing the unscoped everything-view).
  let scopeUnresolved = $derived(
    (pins.lineIds().length > 0 && scope.lines.length !== pins.lineIds().length) ||
      (pins.projectIds().length > 0 && scope.projects.length !== pins.projectIds().length),
  );

  // Workspaces the scope reaches (pinned spaces ∪ homes of pinned
  // projects/lines) — what the blackout bands/rail show. null = everything.
  let scopeWorkspaceIds = $derived.by(() => {
    if (scope.isEmpty) return null;
    const ids = new Set(scope.workspaceIds);
    for (const p of scope.projects) ids.add(p.workspaceId);
    for (const l of scope.lines) ids.add(l.workspaceId);
    return ids;
  });
  // ── Event feeds — the whole query layer lives in $lib/planner-feeds
  // (grid + team + decisions window + agenda book). Reactive inputs are
  // passed as getters so the option stores keep tracking this page's
  // state; called synchronously so the query-client context resolves. ──
  const {
    perfQuery,
    datesQuery,
    availabilityQuery,
    teamQuery,
    decisionsPerfQuery,
    agendaPerfQuery,
    agendaDatesQuery,
    agendaAvailabilityQuery,
    agendaNotesQuery,
    dayNotesQuery,
  } = createPlannerFeeds({
    view: () => view,
    gridFrom: () => gridFrom,
    gridTo: () => gridTo,
    agendaFrom: () => agendaFromIso,
    agendaTo: () => agendaToIso,
    scopeUnresolved: () => scopeUnresolved,
    filterIds: () => filterIds,
    teamWorkspaceIds: () => ($workspacesQuery.data?.items ?? []).map((w) => w.id),
    selectedDay: () => dayIso ?? todayIso,
    todayIso,
  });

  // isLoading (isPending && isFetching) — a disabled query is pending but
  // not loading, so an unresolved selection reads as empty, not stuck.
  let loading = $derived(
    view === 'agenda' || view === 'board'
      ? $agendaPerfQuery.isLoading || $agendaDatesQuery.isLoading
      : $perfQuery.isLoading || $datesQuery.isLoading,
  );
  let errorMsg = $derived(
    view === 'agenda' || view === 'board'
      ? $agendaPerfQuery.error instanceof Error
        ? $agendaPerfQuery.error.message
        : $agendaDatesQuery.error instanceof Error
          ? $agendaDatesQuery.error.message
          : ''
      : $perfQuery.error instanceof Error
        ? $perfQuery.error.message
        : $datesQuery.error instanceof Error
          ? $datesQuery.error.message
          : '',
  );

  // Exact-line narrowing: the endpoint returns the whole project of a
  // pinned line, so drop performances of that project whose line isn't the
  // pinned one — unless the project itself (or its space) is also pinned,
  // which admits the whole project. Dates carry project scope, so project
  // and line pins both show their project's dates.
  let directProjectIds = $derived(new Set(scope.projects.map((p) => p.id)));
  let scopedProjectIds = $derived(new Set(scope.projectIds));
  function perfInScope(p: PerformanceEvent): boolean {
    if (scope.isEmpty) return true;
    const ws = p.project?.workspace_id;
    if (ws && scope.workspaceIds.includes(ws)) return true;
    if (p.project && directProjectIds.has(p.project.id)) return true;
    if (p.line_id && scope.lineIds.includes(p.line_id)) return true;
    return false;
  }
  function dateInScope(d: DateEvent): boolean {
    if (scope.isEmpty) return true;
    const ws = d.project?.workspace_id;
    if (ws && scope.workspaceIds.includes(ws)) return true;
    if (d.project && scopedProjectIds.has(d.project.id)) return true;
    return false;
  }


  // ── Source-switch (ADR-076) — the agenda projection reads its OWN
  // multi-month window; Month/Carrils read the single-month grid window.
  // Only these three source arrays branch on `view`; EVERYTHING downstream
  // (scope filter, conflict/decision/away engines, VMs, stats) recomputes
  // over whichever window is active with zero duplication. The two windows
  // are byte-identical shapes, so when view !== 'agenda' the engine sees
  // exactly what it saw before this change. ─────────────────────────────
  /* THE BOARD SHARES THE BOOK'S WINDOW (plan step 4): a horizon that grows
     is the agenda's own machinery — same span state, same probes, same
     honest end — so switching between the two drawings keeps the loaded
     stretch. Month/Carrils-era single-month feeds stay for Month alone. */
  let onBookWindow = $derived(view === 'agenda' || view === 'board');
  let activePerfRows = $derived(
    onBookWindow ? ($agendaPerfQuery.data?.items ?? []) : ($perfQuery.data?.items ?? []),
  );
  let activeDateRows = $derived(
    onBookWindow ? ($agendaDatesQuery.data?.items ?? []) : ($datesQuery.data?.items ?? []),
  );
  let activeBlackoutRows = $derived(
    onBookWindow
      ? ($agendaAvailabilityQuery.data?.items ?? [])
      : ($availabilityQuery.data?.items ?? []),
  );

  // ── The person axis (scope, never a display filter) ───────────────────
  // A person is not a container, so `resolveScope` only carries the ids and
  // the narrowing happens here, where a roster can actually be resolved: a
  // performance brings its own (`?rosters=1`), a date brings none and is
  // judged by its project's cast minus whoever is away that day.
  //
  // It sits at the SCOPE level deliberately. Scope narrows what the conflict
  // engine sees; the status filter below deliberately does not, so that
  // hiding chips can never hide a real clash. Pinning a person is the first
  // kind, not the second: you are changing what you are looking at.
  //
  // Declared HERE, after the source-switch, because it reads
  // `activeBlackoutRows` — and those are the UNFILTERED rows on purpose:
  // calm hides bands from the page, it does not make anybody available.
  let personScope = $derived(
    buildPersonScope({
      pinnedPersonIds: scope.personIds,
      team: $teamQuery.data?.items ?? [],
      blocks: activeBlackoutRows,
    }),
  );
  function perfPersonVerdict(p: PerformanceEvent) {
    return personScope.verdict({
      projectId: p.project?.id ?? null,
      day: perfDayKey(p),
      roster: p.person_ids,
    });
  }
  function datePersonVerdict(d: DateEvent) {
    return personScope.verdict({
      projectId: d.project?.id ?? null,
      day: dateDayKey(d, viewerTz),
    });
  }

  let scopedPerfs = $derived(
    activePerfRows.filter((p) => perfInScope(p) && perfPersonVerdict(p) !== 'no'),
  );
  let scopedDates = $derived(
    activeDateRows.filter((d) => dateInScope(d) && datePersonVerdict(d) !== 'no'),
  );

  let allBlackouts = $derived(activeBlackoutRows);
  // The bands/rail show the scope's workspaces only; the engine reads all.
  // Calm hides the blackout bands/lanes entirely (and, via pulseAwayPersons,
  // the "away" pulse) — but the conflict engine reads allBlackouts, so a real
  // clash against an unavailability still surfaces.
  let visibleBlackouts = $derived(
    calm.on
      ? []
      : allBlackouts.filter((b) => scopeWorkspaceIds === null || scopeWorkspaceIds.has(b.workspace_id)),
  );

  // `dvis` — the DRAWING predicate: scope, plus calm. Counting uses the
  // scoped rows directly (`vis`), which is why the numbers never move.
  function perfDrawn(p: PerformanceEvent): boolean {
    return !calm.on || performanceStatusFamily(p.status) === 'confirmed';
  }
  function dateDrawn(d: DateEvent): boolean {
    return !calm.on || dateStatusFamily(d.status) === 'confirmed';
  }
  let shownPerfs = $derived(scopedPerfs.filter(perfDrawn));
  let shownDates = $derived(scopedDates.filter(dateDrawn));

  // ── Conflict engine (ADR-072 §1) — over the UNFILTERED scoped rows:
  // hiding chips behind the status filter never hides a real clash. ─────
  let engineEvents = $derived.by(() => {
    const out: PlannerEvent[] = [];
    for (const p of scopedPerfs) {
      if (p.status === 'cancelled' || !p.project) continue;
      out.push({
        id: p.id,
        day: perfDayKey(p),
        project_id: p.project.id,
        workspace_id: p.project.workspace_id,
      });
    }
    for (const d of scopedDates) {
      if (d.status === 'cancelled' || !d.project) continue;
      out.push({
        id: d.id,
        day: dateDayKey(d, viewerTz),
        project_id: d.project.id,
        workspace_id: d.project.workspace_id,
      });
    }
    return out;
  });
  let rosters = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const p of scopedPerfs) {
      if (p.person_ids) map[p.id] = p.person_ids;
    }
    return map;
  });
  let conflicts = $derived(conflictsFor(engineEvents, rosters, allBlackouts));
  let eventDayById = $derived(new Map(engineEvents.map((e) => [e.id, e.day])));

  // ── Derived away bands (ADR-078 §6) — display-only inference. ────────
  let ownEventDays = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const e of engineEvents) {
      (map[e.project_id] ??= []).push(e.day);
    }
    return map;
  });
  let aways = $derived.by(() => {
    const travels: Array<
      Pick<DateRow, 'id' | 'project_id' | 'line_id' | 'kind' | 'travel_direction' | 'starts_at'>
    > = [];
    for (const d of scopedDates) {
      if (d.kind !== 'travel_day' || d.status === 'cancelled' || !d.project) continue;
      travels.push({
        id: d.id,
        project_id: d.project.id,
        line_id: d.line_id ?? null,
        kind: 'travel_day',
        travel_direction: d.travel_direction ?? null,
        starts_at: d.starts_at,
      });
    }
    return awayBands(travels, ownEventDays);
  });

  // ── Names for labels/cards ────────────────────────────────────────────
  let personNames = $derived.by(() => {
    const m = new Map<string, string>();
    for (const item of $teamQuery.data?.items ?? []) m.set(item.person_id, item.full_name);
    for (const b of allBlackouts) if (b.person) m.set(b.person.id, b.person.full_name);
    return m;
  });
  let projectNameById = $derived.by(() => {
    const m = new Map<string, string>();
    for (const p of $projectsQuery.data?.items ?? []) m.set(p.id, p.name);
    for (const p of scopedPerfs) if (p.project) m.set(p.project.id, p.project.name);
    for (const d of scopedDates) if (d.project) m.set(d.project.id, d.project.name);
    return m;
  });

  const KIND_KEYS = new Set(['rehearsal', 'residency', 'travel_day', 'press', 'other', 'day_off']);
  function kindLabel(kind: string): string {
    return KIND_KEYS.has(kind) ? t(`planner.kind_${kind}`, locale) : kind.replace(/_/g, ' ');
  }

  // ── View models for the two projections ──────────────────────────────
  let blackoutVMs = $derived.by((): BlackoutBandVM[] =>
    visibleBlackouts.map((b) => {
      const company = b.person_id === null;
      const personName = b.person?.full_name ?? (b.person_id ? personNames.get(b.person_id) : null);
      return {
        id: b.id,
        from: b.starts_on,
        to: b.ends_on,
        company,
        tentative: b.certainty === 'tentative',
        // The one place a company absence is named: month band, its tooltip
        // and the agenda's away line all read from here.
        label: company
          ? spaceName(workspaceNameById.get(b.workspace_id) ?? '—')
          : t('planner.band_person', locale, { person: personName ?? '—' }),
        subject: company
          ? spaceName(workspaceNameById.get(b.workspace_id) ?? '—')
          : (personName ?? '—'),
        note: b.note,
      };
    }),
  );
  /**
   * Where a tour IS. The band is inferred from a pair of travel legs, so its
   * place is the destination of the leg that opened it: the latest outbound
   * travel day for that project on or before the band's first day.
   *
   * Null is a real answer and stays null — «on tour» with an invented place
   * would be the drawing asserting something nobody wrote down, which is the
   * one thing the whole certainty grammar exists to prevent.
   */
  function tourPlaceFor(band: { from: string; project_id: string }): string | null {
    let best: { day: string; place: string } | null = null;
    for (const d of scopedDates) {
      if (d.kind !== 'travel_day' || d.status === 'cancelled') continue;
      if (d.project?.id !== band.project_id) continue;
      if (d.travel_direction !== 'outbound') continue;
      const day = d.starts_at.slice(0, 10);
      if (day > band.from) continue;
      const place = d.city ?? d.venue_name ?? null;
      if (!place) continue;
      if (!best || day > best.day) best = { day, place };
    }
    return best?.place ?? null;
  }

  // The band travels with its project and its place (ADR-095): at one column
  // wide the monogram is all that survives, and «on tour» with no place cannot
  // tell London from anywhere at all. The label stays for the surfaces that
  // only have room for a sentence.
  let awayVMs = $derived.by((): AwayBandVM[] =>
    aways.map((b) => {
      const proj = projectById.get(b.project_id) ?? null;
      return {
        from: b.from,
        to: b.to,
        label: t('planner.away', locale, {
          project: projectNameById.get(b.project_id) ?? '—',
        }),
        project_id: b.project_id,
        accent: proj ? accentVarFor(proj) : null,
        initials: proj?.initials ?? null,
        projectName: proj?.name ?? null,
        place: tourPlaceFor(b),
      };
    }),
  );

  let blackoutById = $derived(new Map(allBlackouts.map((b) => [b.id, b])));
  let eventSummaryById = $derived.by(() => {
    const m = new Map<string, { label: string; status: string; accent: string | null }>();
    for (const p of scopedPerfs) {
      const name = p.venue?.name ?? p.venue_name ?? p.city ?? 'Performance';
      m.set(p.id, {
        label: p.project ? `${p.project.name} · ${name}` : name,
        status: performanceStatusLabel(p.status),
        accent: p.project ? accentVarFor(p.project) : null,
      });
    }
    for (const d of scopedDates) {
      const name = d.title ?? kindLabel(d.kind);
      m.set(d.id, {
        label: d.project ? `${d.project.name} · ${name}` : name,
        status: d.status,
        accent: d.project ? accentVarFor(d.project) : null,
      });
    }
    return m;
  });

  function clashVM(c: Conflict): ClashVM | null {
    // Status-aware severities (ADR-080 §3) have no cell mark here yet:
    // this page feeds the engine without statuses, so they cannot occur —
    // the decisions build renders them (double via the queue, concurrence
    // deliberately silent, never a mark).
    if (c.severity === 'double' || c.severity === 'concurrence') return null;
    const rows = c.event_ids
      .map((id) => eventSummaryById.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (c.severity === 'people') {
      const people = c.person_ids.map((id) => personNames.get(id) ?? '?').join(', ');
      return {
        severity: c.severity,
        title: t('planner.clash_people_title', locale),
        body: t('planner.clash_people_body', locale, { people }),
        rows,
        event_ids: c.event_ids,
      };
    }
    if (c.severity === 'possible') {
      return {
        severity: c.severity,
        title: t('planner.clash_possible_title', locale),
        body: t('planner.clash_possible_body', locale),
        rows,
        event_ids: c.event_ids,
      };
    }
    const tentative = c.severity === 'blackout-tentative';
    const block = c.availability_block_id ? blackoutById.get(c.availability_block_id) : undefined;
    const company = c.person_ids.length === 0;
    const person = company ? '' : (personNames.get(c.person_ids[0]) ?? '—');
    // Lowercase the VALUE, never the sentence it lands mid-way through.
    const workspace = spaceName(block ? (workspaceNameById.get(block.workspace_id) ?? '—') : '—');
    return {
      severity: c.severity,
      title: t(tentative ? 'planner.clash_blackout_t_title' : 'planner.clash_blackout_title', locale),
      body: company
        ? t(
            tentative
              ? 'planner.clash_blackout_t_company_body'
              : 'planner.clash_blackout_company_body',
            locale,
            { workspace },
          )
        : t(tentative ? 'planner.clash_blackout_t_body' : 'planner.clash_blackout_body', locale, {
            person,
          }),
      rows,
      event_ids: c.event_ids,
    };
  }

  let clashesByDay = $derived.by(() => {
    const byDay = new Map<string, ClashVM[]>();
    for (const c of conflicts) {
      const day = eventDayById.get(c.event_ids[0]);
      if (!day) continue;
      const vm = clashVM(c);
      if (!vm) continue;
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(vm);
    }
    return byDay;
  });

  type ProjectRef = {
    initials?: string | null;
    slug: string | null;
    name: string;
    accent?: string | null;
    workspace_id: string;
  };
  let projectById = $derived.by(() => {
    const m = new Map<string, ProjectRef>();
    for (const p of $projectsQuery.data?.items ?? []) m.set(p.id, p);
    for (const p of scopedPerfs) if (p.project) m.set(p.project.id, p.project);
    for (const d of scopedDates) if (d.project) m.set(d.project.id, d.project);
    return m;
  });
  function workspaceAccent(id: string): string {
    return accentVarFor({ slug: workspaceSlugById.get(id) ?? null });
  }

  // Person ↔ project attribution (roster-derived) — where a person block
  // lands under Agrupa per Projecte, and the loom's prep attribution.
  let projectRosters = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    for (const p of scopedPerfs) {
      if (!p.project || !p.person_ids) continue;
      const set = m.get(p.project.id) ?? m.set(p.project.id, new Set()).get(p.project.id)!;
      for (const id of p.person_ids) set.add(id);
    }
    return m;
  });

  /* ── THE BOARD IS ONE DRAWING ON TWO AXES (ADR-094, ADR-095 §2) ────────
     `by person` is the SAME board — same columns, same cells, same slips —
     with one row per person. The page's job here is ASSEMBLY only: it owns
     the feeds, so it feeds the engine ($lib/board-lanes) and hands the
     result down. Every count, placement, fold and clash weight has ONE
     writer over there; every word is t()-backed here. The old carrilsLanes/
     carrilsConnectors builders — the interim shim that still drew the month
     ribbon — died with this block. This step keeps the board on the month
     window (`monthFirst..monthLast`); the board spans the BOOK's window (agendaFromIso..agendaToIso),
     and nothing below assumes an end date. */

  /** The scope, expanded to project ids — null = Everything. One writer
      for «what is on the sheet», shared by both axes. */
  let boardScopeProjectIds = $derived.by((): string[] | null => {
    if (scope.isEmpty) return null;
    const ids = new Set(scope.projectIds);
    for (const [id, p] of projectById) {
      if (scope.workspaceIds.includes(p.workspace_id)) ids.add(id);
    }
    return [...ids];
  });
  /** Canonical project order — the app's, never token-add order (law 7). */
  let boardProjects = $derived.by(() =>
    [...projectById.entries()].map(([id, p]) => ({
      id,
      workspace_id: p.workspace_id,
      name: p.name,
      accent: accentVarFor(p),
      initials: p.initials ?? null,
    })),
  );
  /** The inference pool per project — the team feed's `project_ids`
      inverted, the SAME source `personGroups` builds lanes from, so an
      inferred placement always lands on a lane that exists. */
  let boardCast = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const member of $teamQuery.data?.items ?? []) {
      for (const pid of member.project_ids ?? []) {
        (m.get(pid) ?? m.set(pid, []).get(pid)!).push(member.person_id);
      }
    }
    return m;
  });
  /** A person on file in MORE THAN ONE workspace is a shared identity —
      the portable person, present in two dossiers. The dossier didn't
      define the word; this derivation is the honest reading of the feed. */
  let sharedPersonIds = $derived.by(() => {
    const spaces = new Map<string, Set<string>>();
    for (const member of $teamQuery.data?.items ?? []) {
      (spaces.get(member.person_id) ?? spaces.set(member.person_id, new Set()).get(member.person_id)!).add(
        member.workspace_id,
      );
    }
    return new Set([...spaces].filter(([, ws]) => ws.size > 1).map(([id]) => id));
  });
  /** Who is recorded as away on each day — the door the inference stops
      at (ADR-092 §3): the engine subtracts these from a date's cast. */
  let boardAwayByDay = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    if (view !== 'board') return m;
    // D · THE GATE READS THE UNFILTERED FACTS: calm hides bands, it never
    // makes anybody available (the same rule personScope already keeps) —
    // and the clamp is the BOOK's window, which is the board's.
    for (const b of allBlackouts) {
      if (!b.person_id) continue;
      const from = b.starts_on < agendaFromIso ? agendaFromIso : b.starts_on;
      const to = b.ends_on > agendaToIso ? agendaToIso : b.ends_on;
      for (let d = from; d <= to; d = addDaysIso(d, 1)) {
        (m.get(d) ?? m.set(d, new Set()).get(d)!).add(b.person_id);
      }
    }
    return m;
  });

  /** Every calendar row as the board consumes it — THE SLIP travels inside
      (ADR-095: the board renders the app's one card, never a lookalike). */
  let boardEvents = $derived.by((): BoardEventIn[] => {
    if (view !== 'board') return [];
    const out: BoardEventIn[] = [];
    for (const p of shownPerfs) {
      const day = perfDayKey(p);
      if (day < agendaFromIso || day > agendaToIso) continue;
      out.push({
        id: p.id,
        day,
        project_id: p.project?.id ?? null,
        kind: 'perf',
        cert: performanceStatusFamily(p.status),
        roster: p.person_ids ?? null,
        // This feed carries no venue id, so the tally's gig identity falls
        // back to the slip's name — the engine's own documented fallback.
        venue_id: null,
        slip: performanceSlip(p, slipCtxPage),
      });
    }
    for (const d of shownDates) {
      const day = dateDayKey(d, viewerTz);
      if (day < agendaFromIso || day > agendaToIso) continue;
      out.push({
        id: d.id,
        day,
        project_id: d.project?.id ?? null,
        kind: d.kind === 'travel_day' ? 'travel' : 'date',
        cert: dateStatusFamily(d.status),
        roster: null,
        venue_id: null,
        slip: dateSlip(d, slipCtxPage),
      });
    }
    return out;
  });

  /** Groups + cells in ONE call — lane-birth and placement share a writer
      (a nocast lane is born the moment an event resolves to nobody). */
  let boardBase = $derived.by(() => {
    const groups =
      view !== 'board'
        ? []
        : laneAxis === 'person'
          ? personGroups({
              projects: boardProjects,
              visibleProjectIds: new Set(boardScopeProjectIds ?? boardProjects.map((p) => p.id)),
              team: $teamQuery.data?.items ?? [],
              personNames,
              sharedPersonIds,
            })
          : scopeGroups({
              scopeProjectIds: boardScopeProjectIds,
              workspaces: ($workspacesQuery.data?.items ?? []).map((w) => ({
                id: w.id,
                name: w.name,
              })),
              projects: boardProjects,
            });
    return laneEvents({
      axis: laneAxis,
      groups,
      events: boardEvents,
      castByProject: boardCast,
      awayByDay: boardAwayByDay,
    });
  });

  /* AN ABSENCE BELONGS TO A PERSON, and each axis says so in its own rows:
     on the person axis a personal blackout rides that person's lane in
     every group that has them and a company one rides every person lane of
     its workspace; on the scope axis a person block rides the project lanes
     whose rosters name the person, a company block rides every lane of its
     workspace, and a derived tour rides its own project's lane. Lane KEYS
     are read off the built groups — the key grammar has one writer (the
     engine) and this page never re-spells it. */
  let boardAwayRuns = $derived.by((): AwayRun[] => {
    if (view !== 'board') return [];
    const runs: AwayRun[] = [];
    const inWindow = (from: string, to: string) => to >= agendaFromIso && from <= agendaToIso;
    const subject = (b: AvailabilityItem): string =>
      b.person_id === null
        ? spaceName(workspaceNameById.get(b.workspace_id) ?? '—')
        : (b.person?.full_name ?? personNames.get(b.person_id) ?? '—');
    for (const b of visibleBlackouts) {
      if (!inWindow(b.starts_on, b.ends_on)) continue;
      for (const g of boardBase.groups) {
        for (const lane of g.lanes) {
          let belongs = false;
          if (laneAxis === 'person') {
            belongs = b.person_id
              ? lane.id === b.person_id
              : lane.kind === 'person' && projectById.get(g.id)?.workspace_id === b.workspace_id;
          } else if (lane.kind === 'project' && lane.id) {
            belongs = b.person_id
              ? (projectRosters.get(lane.id)?.has(b.person_id) ?? false)
              : projectById.get(lane.id)?.workspace_id === b.workspace_id;
          }
          if (belongs) {
            runs.push(
              normalizeAway(
                {
                  starts_on: b.starts_on,
                  ends_on: b.ends_on,
                  certainty: b.certainty,
                  who: subject(b),
                },
                lane.key,
              ),
            );
          }
        }
      }
    }
    if (laneAxis === 'scope') {
      // The derived tour (two travel legs) is the project's own absence.
      for (const band of aways) {
        if (!inWindow(band.from, band.to)) continue;
        for (const g of boardBase.groups) {
          const lane = g.lanes.find((l) => l.kind === 'project' && l.id === band.project_id);
          if (lane) {
            runs.push(
              normalizeAway(
                {
                  from: band.from,
                  to: band.to,
                  who: projectNameById.get(band.project_id) ?? '—',
                },
                lane.key,
              ),
            );
          }
        }
      }
    }
    return runs;
  });

  /** The folded timeline. Today is seeded ACTIVE by this page — whether
      today may fold is the caller's claim, and this caller says never. */
  let boardColumns = $derived.by((): BoardColumn[] => {
    if (view !== 'board') return [];
    const active = activeDaySet({
      axis: laneAxis,
      cells: boardBase.cells,
      prepDays: [],
      awayRuns: boardAwayRuns,
    });
    if (todayIso >= agendaFromIso && todayIso <= agendaToIso) active.add(todayIso);
    return buildColumns({ baseIso: agendaFromIso, endIso: agendaToIso, active, todayIso });
  });
  /** The engine's month register is unlocalised ('aug' is the fact); the
      page re-words the whole-month fold label. The italic month-start name
      goes through the `monthWord` prop instead — same writer, one word. */
  function boardMonthWord(iso: string): string {
    return new Date(`${iso}T00:00:00Z`)
      .toLocaleDateString(localeTag, { month: 'short', timeZone: 'UTC' })
      .replace(/\.$/, '')
      .toLowerCase();
  }
  let boardWordedColumns = $derived(
    boardColumns.map((c) => ({
      ...c,
      gapLabel:
        c.kind === 'gap' && c.gapLabel && /^[a-z]+$/.test(c.gapLabel)
          ? boardMonthWord(c.from)
          : c.gapLabel,
    })),
  );

  /** The month's clashes with their ISO day. The full by-day book, not the
      drawn cells' — the head '!' never asks the filter (law 22). */
  let boardClashes = $derived.by((): BoardClash[] => {
    if (view !== 'board') return [];
    const out: BoardClash[] = [];
    for (const [day, list] of clashesByDay) {
      if (day < agendaFromIso || day > agendaToIso) continue;
      for (const vm of list) out.push({ ...vm, day });
    }
    return out;
  });

  /** Minutes since midnight, viewer clock — the board's now line. Null
      when today is off the sheet (the mark is only drawn where it is true). */
  /** Fold state — hoisted so the meta's lane count and the rendered rows
      share one writer. Furniture: session-only, never the URL. */
  const boardShut = new SvelteSet<string>();

  let boardNowMinutes = $derived.by((): number | null => {
    void minuteTick;
    if (view !== 'board') return null;
    if (todayIso < agendaFromIso || todayIso > agendaToIso) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  /* ── the board's words (the component is t()-free) ─────────────────── */
  function boardTallyCounts(confirmed: number, options: number, notCast: number): string {
    const parts: string[] = [];
    if (confirmed > 0) parts.push(`${confirmed} ${t('planner.week_confirmed', locale)}`);
    if (options > 0) {
      parts.push(
        `${options} ${t(options === 1 ? 'planner.week_option_one' : 'planner.week_options', locale)}`,
      );
    }
    if (notCast > 0) parts.push(`${notCast} ${t('planner.no_cast', locale)}`);
    return parts.join(' · ');
  }
  /** The three silences are three different facts (law 9), worded here. */
  function boardLaneTallyText(ta: LaneTally): string {
    if (ta.silence === 'dash') return '—';
    if (ta.silence === 'no_dates') return t('planner.board_no_dates', locale);
    if (ta.silence === 'no_data_yet') return t('planner.board_no_data', locale);
    return boardTallyCounts(ta.confirmed, ta.options, ta.notCast);
  }
  function boardGroupTallyText(g: {
    units: number;
    confirmed: number;
    options: number;
    notCast: number;
  }): string {
    const unitKey =
      laneAxis === 'person'
        ? g.units === 1
          ? 'planner.board_person_one'
          : 'planner.board_people'
        : g.units === 1
          ? 'planner.board_project_one'
          : 'planner.board_projects';
    const counts = boardTallyCounts(g.confirmed, g.options, g.notCast);
    const head = `${g.units} ${t(unitKey, locale)}`;
    return counts ? `${head} · ${counts}` : head;
  }
  /** The slip's state line — the month's own wording, said by this caller
      too: a board is a different placing, never a different law. */
  function boardSlipState(sl: SlipVM): string | null {
    if (sl.cert === 'released') return t('planner.released', locale);
    if (sl.cert === 'hold' && sl.hold) {
      const key = statusFootKey(sl.hold.rank ? `hold_${sl.hold.rank}` : 'hold');
      const rank = key ? t(key, locale) : performanceStatusLabel('hold');
      if (!sl.hold.expires) return rank;
      return `${rank} · ${localeWeekdayShort(sl.hold.expires, localeTag)}`;
    }
    return null;
  }

  /* ── the board's gestures ──────────────────────────────────────────── */
  /** The '+' door already knows its day AND its lane's project — nothing
      is chosen twice (law 28). The person axis passes null: the dialog
      asks (ADR-094 §3b). `openCreate` clears the preset first, so the
      toolbar's own «+ date» never inherits a stale lane. */
  let boardPresetProjectId = $state<string | null>(null);
  function openBoardCreate(iso: string, projectId: string | null) {
    openCreate(iso);
    boardPresetProjectId = projectId;
  }
  /** The head's '!' lands on that day's decision card — the same door the
      old connectors used (jumpToDecisionCard), the band as fallback. */
  function openClashDay(iso: string) {
    const d = decisionVMs.find((x) => x.day === iso);
    if (d) void jumpToDecisionCard(d.id);
    else jumpToDecisions();
  }
  /** A date slip has no page of its own — its edit dialog opens here,
      exactly as it does from the month and the agenda. */
  function openBoardDate(dateId: string) {
    const d = shownDates.find((x) => x.id === dateId);
    if (d) openDate(d);
  }
  /** Connector gesture — open the band scrolled to that card (§7). */
  async function jumpToDecisionCard(pairId: string) {
    setDecisionsOpen(true);
    await tick();
    const el =
      document.getElementById(`cal-decisions-card-${pairId}`) ??
      document.getElementById('cal-decisions');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── The Loom (Agrupa per Persona — ADR-080 §8) ────────────────────────
  let selectedDay = $derived(dayIso ?? todayIso);
  /** Same normaliser the month uses — one shape for both primitives. */
  let slipCtxPage = $derived({
    workspaceSlug: defaultWorkspaceSlug,
    workspaceSlugById,
    workspaceTzById,
    workspaceModeById,
    viewerTz,
    kindLabel,
    dualTime,
  });
  /** The pair's rule for one event of the day — soft while both are
      options, hard the moment one of the two is ink. */
  function dayClashOf(
    id: string,
    confirmed: boolean,
  ): { clash: 'soft' | 'hard'; people: boolean } | null {
    const mine = (clashesByDay?.get(selectedDay) ?? []).filter((c) => c.event_ids?.includes(id));
    if (mine.length === 0) return null;
    return {
      clash: confirmed ? 'hard' : 'soft',
      people: mine.some((c) => c.severity === 'people' || c.severity === 'blackout'),
    };
  }
  /* One walk, two ledgers: the threads the strip can PLACE, and the
     asked-for dates it cannot — a hold without an hour has no position,
     but it counts and the day's card must say it (design law: «no hour»,
     at the end, implying nothing about what sits above). */
  let dayWalk = $derived.by(() => {
    const threads = [];
    const unplaced = [];
    for (const p of shownPerfs) {
      if (perfDayKey(p) !== selectedDay) continue;
      const sl = performanceSlip(p, slipCtxPage);
      const t = performanceThread(p, viewerTz, sl.name, sl.city, sl.cert);
      const ws = p.project ? workspaceSlugById.get(p.project.workspace_id) : undefined;
      const cl = dayClashOf(p.id, performanceStatusFamily(p.status) === 'confirmed');
      const shared = {
        project: p.project,
        // THE CARD TRAVELS WHOLE: the label renders this very slip, so the
        // day and the agenda cannot drift again (ADR-095).
        slip: sl,
        // Data or the honest word — the project-team inference is not drawn
        // here (design law: four people affirmed at a radio at 10h).
        cast: (p.person_ids ?? [])
          .map((id) => personNames.get(id))
          .filter((n): n is string => Boolean(n)),
        roadSheetHref: p.slug && ws ? `/h/${ws}/performance/${p.slug}/roadsheet` : null,
        clash: cl?.clash ?? null,
        clashPeople: cl?.people ?? false,
      };
      if (t) threads.push({ ...t, ...shared });
      else
        unplaced.push({
          id: p.id,
          kind: sl.kind,
          cert: sl.cert,
          name: sl.name,
          city: sl.city ?? null,
          ...shared,
        });
    }
    for (const d of shownDates) {
      if (dateDayKey(d, viewerTz) !== selectedDay) continue;
      const sl = dateSlip(d, slipCtxPage);
      const t = dateThread(d, viewerTz, sl.name, sl.city, sl.cert);
      const cl = dayClashOf(d.id, false);
      const shared = {
        project: d.project,
        slip: sl,
        cast: null,
        roadSheetHref: null,
        clash: cl?.clash ?? null,
        clashPeople: cl?.people ?? false,
      };
      if (t) threads.push({ ...t, ...shared });
      else
        unplaced.push({
          id: d.id,
          kind: sl.kind,
          cert: sl.cert,
          name: sl.name,
          city: sl.city ?? null,
          ...shared,
        });
    }
    return { threads, unplaced };
  });
  let dayThreads = $derived(dayWalk.threads);
  let dayUnplaced = $derived(dayWalk.unplaced);
  /* THE DAY DRAGS ITS MONTH. The feeds are windowed by `ym`, so a Day view
     pointing at 3 August while `ym` still said July fetched a month that does
     not contain the day being drawn — the strip came up with one thread and
     silently dropped the rest. Seen on screen, 2026-07-31.
     The window follows the day, never the other way round: the day is what you
     asked for. */
  $effect(() => {
    if (view !== 'day') return;
    const y = Number(selectedDay.slice(0, 4));
    const m = Number(selectedDay.slice(5, 7));
    const cur = untrack(() => ym);
    if (y !== cur.year || m !== cur.month) ym = { year: y, month: m };
  });

  /** The Day's title IS its date — the whole day, spelled out. */
  let dayLabel = $derived(
    new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString(localeTag, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }),
  );
  let dayWin = $derived(stripWindow(dayThreads));
  /* WRITING THE RIGHT HOUR IS NEVER OPTIONAL (design law): the now mark
     follows the minute. The interval only ticks a counter; the derived
     below re-reads the clock. No ticking while the tab is hidden — the
     visibility handler catches the mark up the moment anyone looks. */
  let minuteTick = $state(0);
  $effect(() => {
    if (view !== 'day' && view !== 'board') return;
    const bump = () => {
      if (!document.hidden) minuteTick++;
    };
    const iv = setInterval(bump, 15_000);
    document.addEventListener('visibilitychange', bump);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', bump);
    };
  });
  let dayNow = $derived.by(() => {
    void minuteTick;
    return selectedDay === todayIso ? hourOf(new Date().toISOString(), viewerTz) : null;
  });
  /** «06h → 02h» — where the day's plan begins and ends, for the meta. */
  let daySpanLabel = $derived.by(() => {
    if (dayThreads.length === 0) return null;
    const f = (h: number) => {
      const hh = String(Math.floor(((h % 24) + 24) % 24)).padStart(2, '0');
      const mm = Math.round((h % 1) * 60);
      return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
    };
    return `${f(dayWin.from)} → ${f(dayWin.to)}`;
  });
  /** The reason no bar can say — the pair's sentence, pre-localized in the
      clash VM. One line per pair, above the drawing. */
  let dayClashLines = $derived.by(() => {
    const seen = new Set<string>();
    const out: Array<{ key: string; body: string }> = [];
    for (const c of clashesByDay?.get(selectedDay) ?? []) {
      if (seen.has(c.body)) continue; // one reason, said once
      seen.add(c.body);
      out.push({ key: `c${out.length}`, body: c.body });
    }
    return out;
  });

  // ── The Day's foot: notes + next (the design's margin, risen into the
  // flow), and the absence as a line above the drawing. ─────────────────
  let dayNotes = $derived($dayNotesQuery.data?.items ?? []);
  let dayNotesAbsent = $derived(Boolean($dayNotesQuery.data?.absent));
  /** The absences covering this day, as sentences — same voice as the
      agenda's away lines: who, until when, how much is left. */
  let dayAwayLines = $derived.by(() => {
    const out: Array<{ key: string; who: string; rest: string }> = [];
    [...blackoutVMs, ...awayVMs].forEach((it, i) => {
      if (selectedDay < it.from || selectedDay > it.to) return;
      const left = Math.round(
        (Date.parse(`${it.to}T00:00:00Z`) - Date.parse(`${selectedDay}T00:00:00Z`)) / 86400000,
      );
      const rest =
        left === 0
          ? t('planner.away_back', locale)
          : `${t('planner.away_until', locale)} ${localeDayMonth(it.to, localeTag)} · ${
              left === 1
                ? t('planner.away_left_one', locale)
                : t('planner.away_left', locale, { n: String(left) })
            }`;
      const who = 'subject' in it && it.subject ? it.subject : it.label;
      out.push({ key: `${i}:${it.from}`, who, rest });
    });
    return out;
  });
  /** What comes after this day — the decisions window already holds every
      performance in [today, +90d], so next is a pick, not a fetch. */
  let dayNextVMs = $derived.by((): DayNextVM[] => {
    const items = ($decisionsPerfQuery.data?.items ?? [])
      .filter((p) => {
        if (perfDayKey(p) <= selectedDay) return false;
        const fam = performanceStatusFamily(p.status);
        return fam === 'confirmed' || fam === 'hold' || fam === 'proposed';
      })
      .sort((a, b) => (a.performed_at < b.performed_at ? -1 : 1))
      .slice(0, 4);
    return items.map((p) => {
      const sl = performanceSlip(p, slipCtxPage);
      const fam = performanceStatusFamily(p.status);
      const held = fam !== 'confirmed';
      const ws = p.project ? workspaceSlugById.get(p.project.workspace_id) : undefined;
      return {
        id: p.id,
        day: localeDayMonth(perfDayKey(p), localeTag),
        kind: held
          ? `${t('planner.kind_show', locale)}?`
          : t('planner.kind_show', locale),
        name: sl.name,
        city: sl.city ?? null,
        country: p.country ?? null,
        project: p.project,
        href: p.slug && ws ? `/h/${ws}/performance/${p.slug}` : null,
        held,
      };
    });
  });
  /** §23's anchor rule, the Day's half: exactly one calendar entry on the
      day pre-fills the anchor; anything else falls to the page's fallback. */
  async function createDayNote(body: string): Promise<boolean> {
    const perfs = shownPerfs.filter((p) => perfDayKey(p) === selectedDay);
    const dates = shownDates.filter((d) => dateDayKey(d, viewerTz) === selectedDay);
    const single = perfs.length + dates.length === 1;
    return createNote({
      body,
      on_day: selectedDay,
      ...(single && perfs.length === 1 ? { performance_id: perfs[0].id } : {}),
      ...(single && dates.length === 1 ? { date_id: dates[0].id } : {}),
    });
  }

  // ── Masthead stats — counts of the visible month, every figure a real
  // row (ADR-078 §12; no read:money gate — nothing monetary here). ──────
  let stats = $derived.by(() => {
    let confirmed = 0;
    let holds = 0;
    for (const p of scopedPerfs) {
      const day = perfDayKey(p);
      if (day < monthFirst || day > monthLast) continue;
      const family = performanceStatusFamily(p.status);
      if (family === 'confirmed') confirmed++;
      else if (family === 'hold') holds++;
    }
    let conflictCount = 0;
    for (const c of conflicts) {
      const day = eventDayById.get(c.event_ids[0]);
      if (day && day >= monthFirst && day <= monthLast) conflictCount++;
    }
    let blackoutCount = 0;
    for (const b of visibleBlackouts) {
      if (b.starts_on <= monthLast && b.ends_on >= monthFirst) blackoutCount++;
    }

    /* NIGHTS FREE — inventory unsold, and the only figure here that is about
       the business rather than the calendar.
       Two things it must get right, and both are easy to miss:
       · Availability IGNORES the narrowing. Nobody is free because you hid the
         project that is occupying them — so this walks `activePerfRows` and
         `activeDateRows`, the rows as they arrive, not `scopedPerfs`.
       · A NIGHT ON TOUR IS NOT A FREE NIGHT: between an outbound leg and its
         return there is nothing of its own on the calendar and still nothing
         to sell, because the company is 1.200km from home.
       HONEST LIMIT, written where the cost goes: with project pins set, the
       server already filtered the unpinned rows out before they reached the
       browser (`/api/performances` narrows by project_ids ∪ workspace_ids), so
       what arrives is the widest set this page CAN see, not the widest that
       exists. The counter can therefore still read high under a project pin.
       The fix is an unfiltered availability feed — the precedent is right here
       in this file, where blackouts are already fetched without a workspace
       filter for exactly this reason. */
    const occupied = new Set<string>();
    for (const p of activePerfRows) {
      if (p.status === 'cancelled') continue;
      occupied.add(perfDayKey(p));
    }
    for (const d of activeDateRows) {
      if (d.status === 'cancelled') continue;
      occupied.add(dateDayKey(d, viewerTz));
    }
    const free = nightsFree(monthDays, occupied, daysCoveredBy(aways));

    return { confirmed, holds, conflicts: conflictCount, blackouts: blackoutCount, free };
  });

  // ── Decisions queue (ADR-080 §1/§4) — derived, nothing stored. ───────
  let decisionsAbsent = $derived(Boolean($decisionsPerfQuery.data?.absent));
  let decisionPerfs = $derived(
    ($decisionsPerfQuery.data?.items ?? []).filter((p) => perfInScope(p)),
  );
  let decisionPerfById = $derived(new Map(decisionPerfs.map((p) => [p.id, p])));
  let decisionRosters = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const p of decisionPerfs) {
      if (p.person_ids) map[p.id] = p.person_ids;
    }
    return map;
  });
  let decisionInput = $derived.by((): DecisionPerformance[] => {
    const rows: DecisionPerformance[] = [];
    for (const p of decisionPerfs) {
      if (!p.project) continue;
      rows.push({
        id: p.id,
        day: perfDayKey(p),
        project_id: p.project.id,
        workspace_id: p.project.workspace_id,
        status: p.status,
        hold_notice_days: p.hold_notice_days ?? null,
        project: p.project.name,
        venue: p.venue?.name ?? p.venue_name,
        city: p.venue?.city ?? p.city,
        time: p.start_at ? hourMark(timeInTz(p.start_at, p.venue?.timezone || viewerTz)) : null,
      });
    }
    return rows;
  });
  let decisionQueue = $derived(
    decisionsFor({
      performances: decisionInput,
      rosters: decisionRosters,
      today: todayIso,
    }),
  );

  function decisionOptionVM(side: DecisionSide): DecisionOptionVM {
    const perf = decisionPerfById.get(side.id);
    return {
      id: side.id,
      project: side.project,
      accent: perf?.project ? accentVarFor(perf.project) : 'var(--accent-1)',
      initials: perf?.project?.initials ?? null,
      venue: side.venue ?? side.city ?? side.project,
      city: side.venue ? side.city : null,
      time: side.time,
      statusLabel: performanceStatusLabel(side.status),
      hold: isHoldStatus(side.status),
      confirmed: performanceStatusFamily(side.status) === 'confirmed',
    };
  }
  let decisionVMs = $derived.by((): DecisionVM[] =>
    decisionQueue.decisions.map((d) => {
      // 'possible' = ≥1 roster unknown; name the side missing team data
      // when only one is (the honest "add the team to confirm" pointer).
      const aKnown = (decisionRosters[d.a.id] ?? []).length > 0;
      const bKnown = (decisionRosters[d.b.id] ?? []).length > 0;
      const missingTeam =
        d.level === 'possible' && aKnown !== bKnown
          ? (aKnown ? d.b : d.a).project
          : null;
      return {
        id: d.id,
        day: d.day,
        level: d.level,
        kind: d.kind,
        urgent: d.urgent,
        decideBy: d.decideBy,
        people: (d.people ?? []).map((id) => personNames.get(id) ?? '—'),
        missingTeam,
        a: decisionOptionVM(d.a),
        b: decisionOptionVM(d.b),
      };
    }),
  );
  let concurrenceVMs = $derived.by((): ConcurrenceVM[] =>
    decisionQueue.concurrences.map((c) => {
      const side = (s: DecisionSide) => {
        const perf = decisionPerfById.get(s.id);
        return {
          venue: s.venue ?? s.city ?? s.project,
          project: s.project,
          accent: perf?.project ? accentVarFor(perf.project) : 'var(--accent-1)',
          initials: perf?.project?.initials ?? null,
        };
      };
      return { id: c.id, day: c.day, a: side(c.a), b: side(c.b) };
    }),
  );
  let urgentCount = $derived(decisionVMs.filter((d) => d.urgent).length);

  // ── Inline decision bands for the agenda book (ADR-080 §4 surfaced at
  // the day) — the SAME derived queue the DecisionBand renders, indexed by
  // day and pre-localized so AgendaList stays t()-free. The agenda wraps
  // the two contested holds under a reason header; the pick/release
  // actions stay in the DecisionBand above (no duplicate write UI). ──────
  let agendaDecisionsByDay = $derived.by(() => {
    const m = new Map<string, AgendaDecision[]>();
    for (const d of decisionVMs) {
      const reason =
        d.level === 'people'
          ? t('planner.clash_people_body', locale, { people: d.people.join(', ') })
          : d.level === 'double'
            ? t('planner.dec_double_reason', locale)
            : d.missingTeam
              ? t('planner.dec_possible_reason', locale, { project: d.missingTeam })
              : t('planner.dec_possible_reason_generic', locale);
      (m.get(d.day) ?? m.set(d.day, []).get(d.day)!).push({
        ids: [d.a.id, d.b.id],
        reason,
        severity: d.level,
      });
    }
    return m;
  });

  // Agenda status foot: confirmed → "confirmat", holds → "1r/2n/3r hold"
  // (statusFootKey already maps both); anything else keeps the plain label.
  function agendaStatusLabel(status: string): string {
    const key = statusFootKey(status);
    return key ? t(key, locale) : performanceStatusLabel(status);
  }

  // Prepend an earlier month with scroll-anchoring so the viewport stays
  // pixel-stable (inserting days above would otherwise shove content down).
  /* PREPENDING IS ANCHORED TO A ROW, NOT TO A HEIGHT.
     
     It measured `document.scrollHeight` before and after and scrolled by the
     difference — which is right in principle and wrong in practice: `tick()`
     resolves when Svelte has updated the DOM, not when the browser has laid
     it out, so «after» was frequently the same number as «before» and the
     correction was zero. The reader was then silently thrown up by a month,
     which left the top sentinel still in view, which asked for another month.
     That is the whole of the runaway: on 2026-08-02 the diary fetched 822
     days and two years of history before anyone had touched it.

     Pinning a REAL ROW is immune to the timing: remember which day is at the
     top of the viewport and how far down it sits, then put it back exactly
     there once the new rows have been laid out. Plus a latch (one prepend in
     flight) and a floor, because nobody plans two years backwards. */
  let prepending = false;
  const AGENDA_FLOOR = 24; // months back from today
  // The floor is a fact the UI needs too: at it, the head's «earlier» act
  // is not passed down at all, so the line and the gesture disappear
  // instead of lying.
  let agendaFloorIso = $derived(
    firstOfMonth(addMonths(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)), -AGENDA_FLOOR)),
  );
  /** The anchored-growth shell both loaders share: pin the reader's row,
      mutate the window, put the row back exactly where it was. */
  async function anchoredGrow(mutate: () => void) {
    if (prepending) return;
    if (agendaFromIso <= agendaFloorIso) return;
    prepending = true;
    // The anchor may be a SHUT chapter's head (no day rows exist there) —
    // `agendaPlaceEl` pins whichever element the place actually draws.
    const anchor = visibleAgendaDay();
    const was = anchor ? (agendaPlaceEl(anchor)?.getBoundingClientRect().top ?? null) : null;
    mutate();
    await tick();
    await new Promise(requestAnimationFrame);
    if (anchor && was !== null) {
      const now = agendaPlaceEl(anchor)?.getBoundingClientRect().top;
      // INSTANT, AND THIS IS THE WHOLE BUG. `html` carries
      // `scroll-behavior: smooth`, so `scrollBy` ANIMATES — and an anchoring
      // correction is not a journey, it is compensation for content that
      // appeared above the reader. Animated, it had not finished before the
      // next prepend measured, so no correction ever landed: the reader stayed
      // pinned at the top, the sentinel stayed in view, and one flick of the
      // wheel walked the diary 24 months to its floor. Three wrong theories
      // (stale observer entries, short months, reach margins) died before the
      // trace showed `y: 0` on all 25 calls.
      if (now !== undefined) window.scrollBy({ top: now - was, behavior: 'instant' });
    }
    prepending = false;
  }
  /* ── THE BOOK ENDS WHERE THE PLAN ENDS, BOTH WAYS (Marco, 2026-08-03) ──
     A collapsed chapter is ~36px, so blind growth in either direction
     mills out mountains of quiet months (the forward sentinel never left
     its own 800px reach; the backward door gulped 24 months of nothing).
     Before growing past quiet, the page LOOKS once: a 1-row scoped fetch
     for the nearest planned thing in the unloaded stretch. Found → the
     window jumps straight to its month, and the nothing in between is
     never loaded. Not found → the book ends with a sentence. Deliberate
     travel (the ‹ › arrows) still walks anywhere.
     The verdicts are monotonic while the data stands still — «nothing
     beyond X» covers every later X — and reset on Now and on scope
     change; a far event created mid-session shows after either. */
  let agendaExhausted = $state(false); // forward: nothing planned ahead
  let pastExhausted = $state(false); // backward: nothing further back
  let probing = false;
  let agendaHorizonIso = $derived(
    addDaysIso(
      firstOfMonth(
        addMonths(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)), AGENDA_FLOOR + 1),
      ),
      -1,
    ),
  );
  $effect(() => {
    void filterIds;
    agendaExhausted = false;
    pastExhausted = false;
  });
  /** Earliest planned day in [from, to] under the current scope, or null.
      Both feeds return ascending, so `limit=1` IS the earliest. */
  async function probePlan(from: string, to: string): Promise<string | null> {
    if (from > to) return null;
    const base = new URLSearchParams({ from, to, limit: '1' });
    if (filterIds.projectIds.length > 0) base.set('project_ids', filterIds.projectIds.join(','));
    if (filterIds.workspaceIds.length > 0)
      base.set('workspace_ids', filterIds.workspaceIds.join(','));
    const pparams = new URLSearchParams(base);
    pparams.set('status', 'any');
    const [perfs, dates] = await Promise.all([
      fetchJSON<{ items: Array<{ performed_at: string }> }>(`/api/performances?${pparams}`),
      fetchJSON<{ items: Array<{ starts_at: string }> }>(`/api/dates?${base}`),
    ]);
    const found = [perfs.items[0]?.performed_at, dates.items[0]?.starts_at]
      .filter((s): s is string => Boolean(s))
      .map((s) => s.slice(0, 10));
    return found.sort()[0] ?? null;
  }
  /** The tail went quiet (the diary's sentinel is off): look ahead once.
      The window only moves AFTER its rows are primed — an unprimed jump
      rendered the new months empty, dimmed the book, then popped the rows
      in under the reader, which read as an error (Marco, 2026-08-03). */
  async function probePlanAhead() {
    if (probing || agendaExhausted) return;
    probing = true;
    try {
      const next = await probePlan(addDaysIso(agendaToIso, 1), agendaHorizonIso);
      if (!next) {
        agendaExhausted = true;
        return;
      }
      const y = Number(next.slice(0, 4));
      const m = Number(next.slice(5, 7));
      const newTo = addDaysIso(firstOfMonth(addMonths(y, m, 1)), -1);
      await primeAgendaWindow(queryClient, {
        newFrom: agendaFromIso,
        newTo,
        oldFrom: agendaFromIso,
        oldTo: agendaToIso,
        unresolved: scopeUnresolved,
        filterIds,
      });
      agendaEnd = { year: y, month: m };
    } catch (err) {
      // A DEAD NETWORK IS NOT A VERDICT: no growth, and above all no
      // «nothing more planned» — the sentinel simply asks again later.
      console.warn('[calendar] plan probe failed:', err);
    } finally {
      probing = false;
    }
  }
  /**
   * The past's door: open history down to where it BEGINS. It briefly
   * jumped blind to the 24-month floor — the mirror of the forward
   * treadmill, just in one gulp. Probing first means the quiet stretch
   * before the company's first-ever date is never loaded at all; nothing
   * back there → the head line becomes the fact instead of the door.
   */
  async function loadAllEarlier() {
    if (probing || pastExhausted) return;
    probing = true;
    try {
      const first = await probePlan(agendaFloorIso, addDaysIso(agendaFromIso, -1));
      if (!first) {
        pastExhausted = true;
        return;
      }
      const newFrom = `${first.slice(0, 7)}-01`;
      // Rows in hand BEFORE the window moves — see probePlanAhead.
      await primeAgendaWindow(queryClient, {
        newFrom,
        newTo: agendaToIso,
        oldFrom: agendaFromIso,
        oldTo: agendaToIso,
        unresolved: scopeUnresolved,
        filterIds,
      });
      await anchoredGrow(() => (agendaFromIso = newFrom));
      // The probe's answer covers this too: `first` was the EARLIEST thing
      // in the whole stretch down to the floor, so behind the month it
      // lives in there is nothing — say so with the same pull, not on a
      // second ask (Marco had to pull twice to hear it, 2026-08-03).
      pastExhausted = true;
    } catch (err) {
      // A dead network is not «nothing further back»: no verdict, no
      // uncaught rejection — the door stays and the pull can retry.
      console.warn('[calendar] earlier probe failed:', err);
    } finally {
      probing = false;
    }
  }

  // ── The margin's post-its (ADR-093) — my notes over the book's window. ──
  let notesByDay = $derived.by(() => {
    const map = new Map<string, NoteEvent[]>();
    for (const n of $agendaNotesQuery.data?.items ?? []) {
      (map.get(n.on_day) ?? map.set(n.on_day, []).get(n.on_day)!).push(n);
    }
    return map;
  });
  // Pre-migration DB → the feed marks itself absent → the margin reads
  // empty and the writer is simply not passed down (no write UI over a
  // missing table — same convention as blackouts).
  let notesAbsent = $derived(Boolean($agendaNotesQuery.data?.absent));
  /**
   * Where an anchorless note falls (_tasks §23): exactly one pinned
   * container → that container; anything else → «the company», which is a
   * workspace-anchored note in the pinned space or the default one. The
   * margin writer only asks when the day itself offers a choice; this is
   * the answer for every other day.
   */
  let noteFallback = $derived.by(
    (): { label: string; project_id?: string; line_id?: string; workspace_id?: string } => {
      const solo =
        scope.projects.length + scope.lines.length + scope.workspaceIds.length === 1;
      if (solo && scope.projects.length === 1) {
        const p = scope.projects[0];
        return { label: p.name, project_id: p.id };
      }
      if (solo && scope.lines.length === 1) {
        const l = scope.lines[0];
        return { label: l.name, line_id: l.id };
      }
      const wss = ($workspacesQuery.data?.items ?? []) as NavWorkspace[];
      const pinned = solo ? wss.find((w) => w.id === scope.workspaceIds[0]) : undefined;
      const home = pinned ?? wss.find((w) => w.slug === defaultWorkspaceSlug) ?? wss[0];
      if (home) return { label: spaceName(home.name), workspace_id: home.id };
      return { label: t('planner.note_company', locale) };
    },
  );
  async function createNote(draft: NoteDraft): Promise<boolean> {
    const anchored = Boolean(draft.performance_id || draft.date_id);
    try {
      await mutateJSON('POST', '/api/notes', {
        body: draft.body,
        on_day: draft.on_day,
        ...(draft.performance_id ? { performance_id: draft.performance_id } : {}),
        ...(draft.date_id ? { date_id: draft.date_id } : {}),
        ...(!anchored && noteFallback.project_id ? { project_id: noteFallback.project_id } : {}),
        ...(!anchored && noteFallback.line_id ? { line_id: noteFallback.line_id } : {}),
        ...(!anchored && !noteFallback.project_id && !noteFallback.line_id && noteFallback.workspace_id
          ? { workspace_id: noteFallback.workspace_id }
          : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ['planner-agenda-notes'] });
      void queryClient.invalidateQueries({ queryKey: ['planner-day-notes'] });
      return true;
    } catch (err) {
      addToast({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Could not save the note.',
      });
      return false;
    }
  }
  async function deleteNote(id: string) {
    try {
      await mutateJSON('DELETE', `/api/notes/${encodeURIComponent(id)}`);
    } catch (err) {
      addToast({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Could not delete the note.',
      });
    }
    void queryClient.invalidateQueries({ queryKey: ['planner-agenda-notes'] });
    void queryClient.invalidateQueries({ queryKey: ['planner-day-notes'] });
  }

  // Band open/collapsed — UI state only (ADR-080 §5: "Deixa-ho obert"
  // never persists anything in the DB).
  const DECISIONS_STORAGE_KEY = 'hour:calendar:decisions';
  let decisionsOpen = $state.raw(
    (() => {
      try {
        return localStorage.getItem(DECISIONS_STORAGE_KEY) === 'open';
      } catch {
        return false;
      }
    })(),
  );
  function setDecisionsOpen(open: boolean) {
    decisionsOpen = open;
    try {
      localStorage.setItem(DECISIONS_STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
      // Storage disabled — in-session state still works.
    }
  }
  function jumpToDecisions() {
    setDecisionsOpen(true);
    document.getElementById('cal-decisions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Decision actions (ADR-080 §5 — AI=UI parity, two explicit
  // gestures): Confirma → PATCH confirmed · Allibera → PATCH cancelled.
  // Optimistic over every calendar-performances cache (month + window),
  // rollback + toast on error, refetch on settle — the derived queue then
  // re-emits itself (a choose-card mutates into a release-card alone). ───
  const decideMutation = createMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'cancelled' }) =>
      mutateJSON('PATCH', `/api/performances/${encodeURIComponent(id)}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['calendar-performances'] });
      const pages = queryClient
        .getQueriesData<{ items: PerformanceEvent[] }>({ queryKey: ['calendar-performances'] })
        .filter(([, d]) => d?.items.some((it) => it.id === id));
      for (const [key, data] of pages) {
        if (!data) continue;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((it) => (it.id === id ? { ...it, status } : it)),
        });
      }
      return { pages };
    },
    onError: (err, _vars, ctx) => {
      for (const [key, data] of ctx?.pages ?? []) {
        queryClient.setQueryData(key, data);
      }
      addToast({
        tone: 'danger',
        title: t('planner.dec_not_saved', locale),
        message: t('planner.dec_try_again', locale, {
          message: err instanceof Error ? err.message : 'Unexpected error',
        }),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar-performances'] });
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
  });
  let decisionPendingId = $derived(
    $decideMutation.isPending ? ($decideMutation.variables?.id ?? null) : null,
  );

  // ── Pulse strip (ADR-080 §6) — every figure maps to fetched rows;
  // segments whose feed is absent simply drop. ──────────────────────────
  // Next confirmed gig from today — the decisions window rows (scope-
  // filtered, [today, +90d]) already hold exactly that horizon.
  let pulseNext = $derived.by(() => {
    let best: { day: string; venue: string } | null = null;
    for (const p of decisionPerfs) {
      if (performanceStatusFamily(p.status) !== 'confirmed') continue;
      const day = perfDayKey(p);
      if (day < todayIso) continue;
      if (best === null || day < best.day) {
        best = { day, venue: p.venue?.name ?? p.venue_name ?? p.city ?? '—' };
      }
    }
    return best;
  });
  // Distinct persons with a blackout overlapping the visible month
  // (person-level blocks of the scope's workspaces — company closures are
  // not a person count).
  let pulseAwayPersons = $derived.by(() => {
    const ids = new Set<string>();
    for (const b of visibleBlackouts) {
      if (b.person_id && b.starts_on <= monthLast && b.ends_on >= monthFirst) ids.add(b.person_id);
    }
    return ids.size;
  });
  /**
   * Rows the person filter admitted on an INFERENCE, not a fact — a date of
   * a project the pinned person is on file for, with nobody actually cast on
   * it (there is no date↔person table to be cast in).
   *
   * It has to be said out loud. Including them is the right call — excluding
   * them would hide a person's own rehearsals — but a guess that looks like a
   * fact is the one thing the person axis must not do, and the scope chip
   * only says WHO is pinned, not on what evidence. Drops to nothing when the
   * axis is inactive or everything matched a real roster, like every other
   * segment of this strip.
   */
  let pulseInferred = $derived.by(() => {
    if (!personScope.active) return 0;
    let n = 0;
    for (const p of shownPerfs) if (perfPersonVerdict(p) === 'inferred') n++;
    for (const d of shownDates) if (datePersonVerdict(d) === 'inferred') n++;
    return n;
  });

  let pulseTrips = $derived.by(() => {
    let n = 0;
    for (const d of scopedDates) {
      if (d.kind !== 'travel_day' || d.status === 'cancelled') continue;
      const day = dateDayKey(d, viewerTz);
      if (day >= monthFirst && day <= monthLast) n++;
    }
    return n;
  });

  let monthTitle = $derived(monthName(ym.year, ym.month, localeTag));
  // Capitalized "Julio 2026" — LensTitle then keeps the month italic and the
  // year upright (the title rule). (Month names are lowercase in es/ca.)
  let monthLabel = $derived(
    `${monthTitle.charAt(0).toUpperCase()}${monthTitle.slice(1)} ${ym.year}`,
  );

  function prevMonth() {
    ym = addMonths(ym.year, ym.month, -1);
  }
  function nextMonth() {
    ym = addMonths(ym.year, ym.month, 1);
  }
  function thisMonth() {
    ym = { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  // Agenda "Avui" scrolls the book to today's day header instead of moving
  // the single-month window (which the agenda no longer uses).
  /**
   * `Now` HAS TO LAND. A smooth scroll across a diary is a long animation,
   * and the diary is loading while it runs — one anchoring correction landing
   * mid-flight leaves the reader thousands of pixels short of today with no
   * sign anything went wrong. Measured: 5.760px short.
   *
   * So it is asked twice: the smooth journey, and then a check a beat later
   * that finishes the job instantly if something moved under it. The second
   * pass is a no-op in the ordinary case.
   */
  /**
   * `Now` IS A JUMP, NOT A JOURNEY — and therefore instant.
   *
   * It was a smooth `scrollIntoView` plus a correction a beat later. Two ways
   * that fails, both reported: across a diary of months the animation is
   * still running when the correction lands and simply carries on over the
   * top of it; and while it runs the diary may prepend, which moves the
   * target under the animation. Months of travel is not a nice transition
   * anyway — it is a long ride through days nobody asked to see.
   *
   * If today is not rendered the diary is asked to grow towards it first.
   */
  async function scrollToToday() {
    // THE PRESENT CLOSES THE PAST (Marco, 2026-08-03). `Now` is not a
    // scroll — the book goes back to its first-load shape: opened at
    // today, loaded history released, future back to the seed. The diary
    // sees its first day JUMP FORWARD (the one move loading can never
    // make) and resets its own furniture: doors to defaults, the past's
    // line hidden again.
    agendaFromIso = todayIso;
    agendaEnd = addMonths(now.getFullYear(), now.getMonth() + 1, 0);
    agendaExhausted = false;
    pastExhausted = false;
    await tick();
    // The reset guarantees today's row: the book starts at today, and
    // today's month and week always default open.
    const at = () => document.querySelector(`[data-day="${todayIso}"]`);
    // Today's month and week default open, but the reader can shut them by
    // hand — then the day row does not exist and the chapter head is the
    // honest landing (`data-month` on the divider).
    const el = at() ?? document.querySelector(`[data-month="${todayIso.slice(0, 7)}"]`);
    if (!el) return;
    // `scrollIntoView`, not `scrollBy`: only it reads the day's
    // scroll-margin, and the day must land BELOW the stuck chrome.
    el.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  /** `T` — one verb, and each projection knows what "today" means for it. */
  /** The window steps by whatever the drawing's window IS. */
  /**
   * THE ARROWS BELONG TO ANY WINDOW YOU CAN STEP — all four drawings.
   *
   * The agenda carried `today` and nothing else, on the argument that a
   * control which can never fire is not drawn. That was true only while the
   * agenda ran forwards: it loads BACKWARDS too (through the probes), so
   * its start is a thing you can move, and the arrows move it exactly as
   * they move the month. The title says where the window BEGINS, and these
   * two move that beginning — which is the whole reason they belong beside
   * it. At the plan's end in either direction they answer with the end
   * line instead of minting empty months.
   */
  function stepBack() {
    if (view === 'day') {
      void stepDayToPlanned(-1);
    } else if (view === 'agenda') scrollAgendaMonth(-1);
    else if (view === 'board') panBoard(-1);
    else prevMonth();
  }
  function stepNext() {
    if (view === 'day') {
      void stepDayToPlanned(1);
    } else if (view === 'agenda') scrollAgendaMonth(1);
    else if (view === 'board') panBoard(1);
    else nextMonth();
  }
  /**
   * ON A DIARY THE ARROWS MOVE YOU, THEY DO NOT CROP THE WINDOW.
   *
   * They used to edit `agendaFromIso` — back loaded a month, forward THREW
   * ONE AWAY — so on the drawing that has no edges the one control that
   * looks like «go back» quietly deleted history, and «go forward» appeared
   * to do nothing because the reader stayed put while the data under them
   * changed. A diary's window is everything it has loaded; what you move is
   * your place in it.
   *
   * Landing on a month it has not loaded yet asks for it and tries again on
   * the next frame — the diary grows towards you rather than refusing.
   */
  /** THE DAY'S ARROWS TRAVEL TO PLAN (Marco, 2026-08-08): the next or the
      previous day that HOLDS something — never a minted empty day, the
      same law the book and the board already keep. The loaded window
      answers first; beyond it, the probes. Nothing found = the arrow
      rests: there is no more plan that way. */
  async function stepDayToPlanned(step: -1 | 1) {
    const days = [
      ...new Set([
        ...shownPerfs.map((p) => perfDayKey(p)),
        ...shownDates.map((d) => dateDayKey(d, viewerTz)),
      ]),
    ].sort();
    const inWindow =
      step > 0 ? days.find((d) => d > selectedDay) : days.findLast((d) => d < selectedDay);
    if (inWindow) {
      dayIso = inWindow;
      syncUrl();
      return;
    }
    if (step > 0) {
      // Forwards the ascending probe IS the answer: the earliest planned
      // day beyond this one, scoped, one row.
      const next = await probePlan(addDaysIso(selectedDay, 1), agendaHorizonIso);
      if (next) {
        dayIso = next;
        syncUrl();
      }
      return;
    }
    // Backwards needs the LATEST day before this one, and the feeds only
    // speak ascending — so widen a window and walk each page's tail.
    for (const span of [45, 180, 730]) {
      const from0 = addDaysIso(selectedDay, -span);
      const from = from0 < agendaFloorIso ? agendaFloorIso : from0;
      const last = await lastPlannedDay(from, addDaysIso(selectedDay, -1));
      if (last) {
        dayIso = last;
        syncUrl();
        return;
      }
      if (from <= agendaFloorIso) return;
    }
  }
  /** Latest planned day in [from, to] under the current scope — ascending
      feeds cursor-walked to their tail (a capped page truncates the LATE
      end, which is exactly the end this caller wants). */
  async function lastPlannedDay(from: string, to: string): Promise<string | null> {
    if (from > to) return null;
    const mk = (extra: Record<string, string>) => {
      const q = new URLSearchParams({ from, to, limit: '200', ...extra });
      if (filterIds.projectIds.length > 0) q.set('project_ids', filterIds.projectIds.join(','));
      if (filterIds.workspaceIds.length > 0)
        q.set('workspace_ids', filterIds.workspaceIds.join(','));
      return q;
    };
    let latest: string | null = null;
    const walk = async (path: string, q: URLSearchParams, dayOf: (r: never) => string) => {
      let cursor = from;
      for (;;) {
        q.set('from', cursor);
        const batch = await fetchJSON<{ items: never[] }>(`${path}?${q}`);
        if (batch.items.length === 0) break;
        const d = dayOf(batch.items[batch.items.length - 1]);
        if (!latest || d > latest) latest = d;
        if (batch.items.length < 200 || d <= cursor) break;
        cursor = d;
      }
    };
    await walk(
      '/api/performances',
      mk({ status: 'any' }),
      (r: { performed_at: string }) => r.performed_at.slice(0, 10),
    );
    await walk('/api/dates', mk({}), (r: { starts_at: string }) => r.starts_at.slice(0, 10));
    return latest;
  }

  /** ON THE BOARD THE ARROWS PAN — a screenful at a time. The horizon has
      no pages and no month steps: growing is the scroll's job (the strip
      asks the agenda's own probe when the pan reaches the rim). */
  function panBoard(step: -1 | 1) {
    const wrap = document.querySelector<HTMLElement>('.board__wrap');
    wrap?.scrollBy({ left: step * wrap.clientWidth * 0.8, behavior: 'smooth' });
  }
  function boardToToday() {
    const wrap = document.querySelector<HTMLElement>('.board__wrap');
    const today = wrap?.querySelector<HTMLElement>('.board__head:not(.gap).today');
    if (wrap && today)
      wrap.scrollTo({
        left: Math.max(0, today.offsetLeft - wrap.clientWidth * 0.4),
        behavior: 'smooth',
      });
  }

  async function scrollAgendaMonth(step: -1 | 1) {
    const here = visibleAgendaDay() ?? todayIso;
    const target = firstOfMonth(
      addMonths(Number(here.slice(0, 4)), Number(here.slice(5, 7)), step),
    );
    for (let tries = 0; tries < 3; tries++) {
      // A collapsed month draws no day rows — its chapter head is the stop.
      const el = agendaPlaceEl(target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // The target is beyond the loaded span. The arrows do not mint empty
      // months past the plan (Marco, 2026-08-03): they grow toward planned
      // content only — the probes jump the gaps for them.
      if (step < 0) await loadAllEarlier();
      else await probePlanAhead();
      await tick();
    }
    // Nothing appeared: the plan is finished that way, and the stop IS the
    // message — the press answers by showing it instead of doing nothing.
    if (step < 0 ? pastExhausted : agendaExhausted) {
      const lines = document.querySelectorAll('.ag__end');
      const line = step < 0 ? lines[0] : lines[lines.length - 1];
      line?.scrollIntoView({ behavior: 'smooth', block: step < 0 ? 'start' : 'end' });
    }
  }
  /**
   * The first day-or-chapter row at or below the viewport's top edge. A
   * shut month draws no day rows, so its chapter head has to count as a
   * place — without it the arrows lose their bearings inside a stack of
   * shut chapters (null → fell back to today → ‹ › teleported the reader
   * to the present instead of stepping from where they stood).
   */
  function visibleAgendaDay(): string | null {
    // The reading edge is the STUCK toolbar's underside, not the viewport's
    // 0: a row can sit behind the chrome with bottom > 0, and taking it as
    // "where the reader is" makes the next ‹ › step a no-op.
    const bar = document.querySelector('.cal__toolbar');
    const edge = bar ? bar.getBoundingClientRect().bottom : 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-day], [data-month]')) {
      if (el.getBoundingClientRect().bottom > edge) {
        return el.dataset.day ?? `${el.dataset.month}-01`;
      }
    }
    return null;
  }
  /** The element a place resolves to: its day row, or — when the month is
      shut and the row does not exist — its chapter head. */
  function agendaPlaceEl(place: string): Element | null {
    return (
      document.querySelector(`[data-day="${place}"]`) ??
      document.querySelector(`[data-month="${place.slice(0, 7)}"]`)
    );
  }

  function goToday() {
    if (view === 'agenda') scrollToToday();
    else if (view === 'day') {
      dayIso = todayIso;
      syncUrl();
    } else if (view === 'board') boardToToday();
    else thisMonth();
  }

  /* ── THE KEYBOARD (ADR-095) ───────────────────────────────────────────
     Views by number, in the SAME ORDER AS THE WORDS ON SCREEN — that is the
     rule, not the specific digits, so when the Day view lands and becomes the
     first word it becomes `1` and the rest shift with it.

     `T` today · `← →` move the window · `N` a new date on the day you are
     looking at. `N` IS THE ONLY KEY THAT WRITES, and it goes through the same
     door as the three buttons — one call, and they cannot drift apart.

     ONE LISTENER, and the reason is written in the prototype's own scars:
     there were two global keydowns at once (one moving the selection by hand,
     the other clicking the DOM arrow), so a single `→` advanced TWO days.
     `preventDefault()` does not stop a sibling listener — deleting it does.
     The shell already owns `c` (calm) and the palette owns ⌘K; this handler
     claims only the keys above and never fires while you are typing. */
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          (el as HTMLElement).isContentEditable)
      ) {
        return;
      }
      // A dialog is open: it owns the keyboard until it closes.
      if (createOpen || editOpen || marksOpen) return;

      // The SAME order as the words on screen (CalToolbar's VIEW_ORDER).
      const views: PlannerView[] = ['day', 'agenda', 'month', 'board'];
      const n = Number(e.key);
      if (n >= 1 && n <= views.length) {
        e.preventDefault();
        setView(views[n - 1]);
        return;
      }
      switch (e.key) {
        case 't':
        case 'T':
          e.preventDefault();
          goToday();
          return;
        case 'ArrowLeft':
          // ONE DOOR: keys go through the same verbs as the ‹ › buttons —
          // day travels to plan, agenda scrolls its month, board pans.
          e.preventDefault();
          stepBack();
          return;
        case 'ArrowRight':
          e.preventDefault();
          stepNext();
          return;
        case 'n':
        case 'N':
          e.preventDefault();
          openCreate();
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Creation — the unified dialog (ADR-078 §1) behind every "+". ─────
  const queryClient = useQueryClient();

  let createOpen = $state(false);
  let createDate = $state<string | null>(null);

  // A single pinned line pre-selects its project — and its line. With no
  // line pins, a single pinned project pre-selects itself.
  let presetProjectId = $derived.by(() => {
    if (scope.lines.length === 1) return scope.lines[0].projectId;
    if (scope.lines.length === 0 && scope.projects.length === 1) return scope.projects[0].id;
    return null;
  });
  let presetLineId = $derived(scope.lines.length === 1 ? scope.lines[0].id : null);

  function openCreate(dayIso?: string) {
    // Every door resets the board's lane preset — only openBoardCreate
    // re-arms it, AFTER this runs, so a toolbar «+ date» never inherits
    // the last cell's project.
    boardPresetProjectId = null;
    createDate = dayIso ?? todayIso;
    createOpen = true;
  }

  // ── Editing a date (task 15) — both projections open the same dialog.
  // A date has no page of its own (no slug, no road sheet), so the edit
  // is a dialog over the calendar, exactly where creation happens.
  let editOpen = $state(false);
  let editDate = $state<DateEvent | null>(null);

  /** True when other loaded rows share this row's series (ADR-084 §1). */
  let editInSeries = $derived.by(() => {
    const sid = editDate?.series_id;
    if (!sid) return false;
    return shownDates.filter((d) => d.series_id === sid).length > 1;
  });

  function openDate(d: DateEvent) {
    editDate = d;
    editOpen = true;
  }

  async function handleCreated(perf: CreatedPerformance) {
    const ws = workspaceSlugById.get(perf.workspace_id) ?? defaultWorkspaceSlug;
    if (perf.slug) await goto(`/h/${ws}/performance/${perf.slug}`);
  }

  // ── Blackout dialog (ADR-078 §4/§5) — entry points hide while the
  // availability or team feed is absent (contract § Graceful absence). ──
  let blackoutOpen = $state(false);

  let canBlackout = $derived(
    Boolean(
      $availabilityQuery.data &&
        !$availabilityQuery.data.absent &&
        $teamQuery.data &&
        !$teamQuery.data.absent,
    ),
  );
  // Preset the space when the pinned scope collapses to one workspace (or
  // only one exists) — the select stays for every other case. ONE
  // workspace always: a blackout never fans out.
  let blackoutPresetWs = $derived.by(() => {
    if (scopeWorkspaceIds !== null && scopeWorkspaceIds.size === 1) {
      return [...scopeWorkspaceIds][0];
    }
    const all = $workspacesQuery.data?.items ?? [];
    return all.length === 1 ? all[0].id : null;
  });

  function openBlackout() {
    createOpen = false;
    blackoutOpen = true;
  }

  // ── Calendar feed links (ADR-054) — entry now lives in the "⋯" menu;
  // FeedDialog owns the workspace pick, the shares query and the
  // create/revoke mutations. The page only holds the open flag.
  let feedOpen = $state(false);

  function openFeed() {
    feedOpen = true;
  }
</script>

<svelte:head>
  <title>Calendar — Hour</title>
</svelte:head>

<section class="cal">
  <LensHeader>
    {#snippet title()}<LensTitle text={view === 'day' ? dayLabel : monthLabel} />{/snippet}
  </LensHeader>




  <!-- THE META SITS ABOVE THE ROW OF CONTROLS — the order Marco's prototype
       fixes, and he is the one who spent the hours on it.

       Top to bottom the head reads answer → report → controls: the window
       states the date, the machine reports on THAT window in 9.5px mono, and
       the controls that change it close the band. With the meta underneath,
       the line summarising July sat below the buttons that leave July. -->
  <p class="cal__meta">
      <!-- Pulse strip (ADR-080 §6) — every figure maps to fetched rows; a
           segment whose feed is absent (or count is zero) drops instead of
           lying. The shared .lenshead__sub inserts the · between items. -->
      {#if !errorMsg}
        <!-- CALM IS A WORD, ON THE FACTS SIDE (ADR-095 §3). It lives in the
             Desk — global and non-destructive — and the Planner does not draw
             its switch: it draws what it DOES. An active filter you cannot see
             is a filter that lies, and this one hides two thirds of the month.
             The counters beside it do not move: they count the WINDOW, not the
             drawing, so the word is what explains why only one is on paper. -->
        {#if calm.on}
          <span class="cal__stat cal__stat--soft">{t('planner.calm_state', locale)}</span>
        {/if}
        <!-- CALM QUIETS VOLUME, NOT OBLIGATIONS. This control was gated on
             `!calm.on`, so the one line on the page that says «you have to
             decide something» disappeared in the mode people leave switched
             on — which is why Marco never saw the drawer and reported it as
             unbuilt. Calm already removes the counters' noise; the call to
             make is not noise. -->
        {#if !decisionsAbsent && decisionVMs.length > 0}
          <button
            type="button"
            class="cal__pulse-decide"
            aria-expanded={decisionsOpen}
            aria-controls="cal-decisions"
            onclick={() => setDecisionsOpen(!decisionsOpen)}
          >
            {t('planner.pulse_decide', locale, { n: decisionVMs.length })}{#if urgentCount > 0}{' · '}{urgentCount ===
              1
                ? t('planner.pulse_urgent_one', locale)
                : t('planner.pulse_urgent', locale, { m: urgentCount })}{/if}<i
              class="cal__pulse-chev"
              aria-hidden="true">{decisionsOpen ? '▴' : '▾'}</i
            >
          </button>
        {/if}
        {#if !decisionsAbsent && pulseNext}
          <span class="cal__stat cal__stat--soft"
            >{t('planner.pulse_next', locale, {
              day: localeDayMonth(pulseNext.day, localeTag),
              venue: pulseNext.venue,
            })}</span
          >
        {/if}
        <!-- COUNTERS FOLLOW THE GEOMETRY, NOT THE WORD (ADR-095).
             A BOUNDED drawing that announces a range has to count it; a drawing
             whose horizon grows as you scroll can NAME its horizon but must not
             count it. The agenda is a continuous book — it has no last day — so
             printing `N confirmed` there was neither the agenda's truth nor the
             month's: the numbers were July's window computed over a feed that
             starts today, so a July with nine occupied days announced `0
             confirmed · 31 nights free`. Caught on screen, 2026-07-31. -->
        <!-- A WINDOW WITH NO END NAMES WHERE IT BEGINS, AND SAYS SO. The
             agenda cannot count — its horizon grows as you scroll — but it can
             say what it IS: a book opened at a day. Without this the band went
             silent when the counters were gated, which is honest and mute; the
             law asks for honest and legible. -->
        <!-- BAND 3 · THE META, and it opens with the GRAIN. `weeks 27 → 31` is
             the one thing that says a row of the month is a WEEK without
             announcing it: the range proves what a row is. The Day has no
             range to give — a day counts itself — and the agenda's horizon
             grows, so neither prints one. -->
        <!-- Weeks range: BOUNDED drawings only — the board grew a horizon
             and what grows is never counted. -->
        {#if view === 'month'}
          <span class="cal__stat cal__stat--soft"
            >{t('planner.week_range', locale, {
              a: String(isoWeek(monthFirst)),
              b: String(isoWeek(monthLast)),
            })}</span
          >
        {/if}
        {#if view === 'agenda'}
          <span class="cal__stat cal__stat--soft"
            >{t('planner.agenda_from', locale, {
              day: localeDayMonth(agendaFromIso, localeTag),
            })}</span
          >
        {/if}
        <!-- The board names its grain and its horizon: a window that grows
             names where it begins and says NO END — what grows is never
             counted (law: el horizonte del tablero). Lanes from the one
             writer (boardLaneCount); folding is furniture and the meta
             does not chase it. -->
        {#if view === 'board'}
          <span class="cal__stat cal__stat--soft"
            >{t('planner.agenda_from', locale, {
              day: localeDayMonth(agendaFromIso, localeTag),
            })}</span
          >
          <span class="cal__stat cal__stat--soft">{t('planner.board_no_end', locale)}</span>
          <span class="cal__stat cal__stat--soft">{t('planner.board_grain', locale)}</span>
          <span class="cal__stat cal__stat--soft"
            >{t('planner.board_lanes_n', locale, {
              n: String(boardLaneCount(boardBase.groups, boardShut)),
            })}</span
          >
        {/if}
        <!-- The Day names its span — where the plan begins and where it
             lets go (first call → last out). A day with nothing says nothing. -->
        {#if view === 'day' && daySpanLabel}
          <span class="cal__stat cal__stat--soft">{daySpanLabel}</span>
        {/if}
        {#if view !== 'agenda' && view !== 'board'}
        <span class="cal__stat"><b>{stats.confirmed}</b> {t('planner.stat_confirmed', locale)}</span>
        <!-- `1 holds` was printing on every single-hold month. The design's own
             word for this counter is `option`, and it agrees in number. -->
        <span class="cal__stat"
          ><b>{stats.holds}</b>
          {t(stats.holds === 1 ? 'planner.stat_holds_one' : 'planner.stat_holds', locale)}</span
        >
        <!-- The number about the business, not the calendar. It counts the
             WINDOW and never the drawing, so calm does not move it. -->
        <span class="cal__stat"
          ><b>{stats.free}</b>
          {t(stats.free === 1 ? 'planner.stat_free_one' : 'planner.stat_free', locale)}</span
        >
        {/if}
        {#if pulseAwayPersons > 0}
          <span class="cal__stat cal__stat--soft"
            >{pulseAwayPersons === 1
              ? t('planner.pulse_away_one', locale)
              : t('planner.pulse_away', locale, { z: pulseAwayPersons })}</span
          >
        {/if}
        {#if pulseTrips > 0}
          <span class="cal__stat cal__stat--soft"
            >{pulseTrips === 1
              ? t('planner.pulse_trips_one', locale)
              : t('planner.pulse_trips', locale, { w: pulseTrips })}</span
          >
        {/if}
        {#if pulseInferred > 0}
          <!-- The person filter is showing rows nobody is cast on. Say so:
               a guess must never read as a fact. -->
          <span class="cal__stat cal__stat--soft"
            >{t('planner.pulse_inferred', locale, { n: String(pulseInferred) })}</span
          >
        {/if}
      {/if}
    </p>
  <!-- THE DRAWER OPENS UNDER THE LINE THAT COUNTS IT — the meta says
       `3 to decide · 1 urgent`, and what it names unfolds directly beneath,
       above the controls. -->
  {#if !errorMsg && !decisionsAbsent}
    <DecisionBand
      decisions={decisionVMs}
      concurrences={concurrenceVMs}
      open={decisionsOpen}
      onConfirm={(id) => $decideMutation.mutate({ id, status: 'confirmed' })}
      onJump={(iso) => {
        dayIso = iso;
        setView('day');
      }}
      pendingId={decisionPendingId}
      {locale}
      {localeTag}
      id="cal-decisions"
    />
  {/if}

  <CalToolbar
    onReadMarks={() => (marksOpen = true)}
    {view}
    {laneAxis}
    calm={calm.on}
    {canBlackout}
    {locale}
    onStepBack={stepBack}
    onStepNext={stepNext}
    onNow={goToday}
    onSetView={setView}
    onSetLaneAxis={setLaneAxis}
    onCreate={() => openCreate()}
    onFeed={openFeed}
    onBlackout={() => {
      // Direct menu path: no day context — drop any stale preset from a
      // cancelled day-cell create (the dialog defaults to today). The
      // create-dialog footer path keeps its day.
      createDate = null;
      openBlackout();
    }}
  />


  {#if errorMsg}
    <p class="cal__state cal__state--danger">{errorMsg}</p>
  {:else if view === 'day'}
    <!-- The absence is a LINE above the drawing, not a band of its own —
         the Day compresses (design: la composición del Day). -->
    {#if dayAwayLines.length > 0 || dayClashLines.length > 0}
      <div class="cal__aways">
        <!-- The reason no bar can draw: a rule on two rows says THAT they
             relate, never why — the why is a sentence, and it lives here. -->
        {#each dayClashLines as c (c.key)}
          <p class="cal__clashline">{c.body}</p>
        {/each}
        {#each dayAwayLines as a (a.key)}
          <p class="cal__awayline">
            <span class="cal__awayline-who">{a.who}</span>
            <span>{a.rest}</span>
          </p>
        {/each}
      </div>
    {/if}
    <DayStrip
      threads={dayThreads}
      win={dayWin}
      now={dayNow}
      kindLabel={(k) => kindLabel(k)}
      stateLabel={boardSlipState}
      stateUrgent={(sl) => Boolean(sl.hold?.expires && sl.hold.expires <= todayIso)}
      stepLabel={(k) => t(`desk.anchor_${k === 'load_in' ? 'loadin' : k}`, locale)}
      hourLabel={(h) => {
        // The house register («22h30», «10h») — the day's hour must read
        // exactly as the agenda's, or the two drawings drift by a colon.
        const hh = Math.floor(((h % 24) + 24) % 24);
        const mm = Math.round((h % 1) * 60);
        return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
      }}
      emptyLabel={t('planner.day_empty', locale)}
      axisLabel={t('planner.day_axis', locale)}
      noCastWord={t('planner.no_cast', locale)}
      roadSheetWord={t('desk.roadsheet', locale)}
      unplaced={dayUnplaced}
      noHourWord={t('planner.no_hour', locale)}
    />
    <DayFoot
      notes={dayNotes}
      canWrite={!dayNotesAbsent}
      onCreate={createDayNote}
      onDelete={deleteNote}
      next={dayNextVMs}
      notesWord={t('planner.agenda_notes', locale)}
      nextWord={t('planner.day_next', locale)}
      emptyWord={t('planner.lid_empty', locale)}
      privateWord={t('planner.note_private', locale)}
      placeholder={t('planner.note_placeholder', locale)}
      deleteLabel={t('planner.note_delete', locale)}
    />
  {:else if view === 'month'}
    <MonthGrid
      year={ym.year}
      month={ym.month}
      performances={shownPerfs}
      dates={shownDates}
      workspaceSlug={defaultWorkspaceSlug}
      {loading}
      onDayCreate={(iso) => openCreate(iso)}
      onDateOpen={openDate}
      onDayOpen={(iso) => {
        dayIso = iso;
        setView('day');
      }}
      blackouts={blackoutVMs}
      aways={awayVMs}
      {clashesByDay}
      locale={localeTag}
      dateKindLabel={kindLabel}
      createLabel={(iso) => t('planner.new_on', locale, { day: iso })}
      stateLabel={(status) => {
        const key = statusFootKey(status);
        return key ? t(key, locale) : null;
      }}
      isoWeekLabel={(n) => `${t('planner.week_n', locale)} ${n}`}
      moreLabel={t('planner.more_n', locale)}
      releasedLabel={t('planner.released', locale)}
      expiresLabel={(iso) => localeWeekdayShort(iso, localeTag)}
      awayWord={t('planner.band_away', locale)}
      tourWord={t('planner.band_tour', locale)}
      untilLabel={(day) => t('planner.band_until', locale, { day })}
      readinessItems={READINESS_KEYS.map((k) => ({
        key: k,
        label: t(readinessLabelKey(k), locale),
      }))}
    />
  {:else if view === 'agenda'}
    <AgendaList
      days={agendaDays}
      performances={shownPerfs}
      dates={shownDates}
      workspaceSlug={defaultWorkspaceSlug}
      {loading}
      blackouts={blackoutVMs}
      aways={awayVMs}
      {clashesByDay}
      decisionsByDay={agendaDecisionsByDay}
      {todayIso}
      locale={localeTag}
      dateKindLabel={kindLabel}
      statusLabel={agendaStatusLabel}
      viewerTimeLabel={(time) => t('planner.viewer_time', locale, { time })}
      travelDirLabel={(dir) => t(`planner.travel_${dir}`, locale)}
      emptyLabel={t('planner.empty_month', locale)}
      blackoutsToggleLabel={t('planner.blackouts_toggle', locale)}
      decideLabel={t('planner.agenda_decide', locale)}
      notesLabel={t('planner.agenda_notes', locale)}
      showWord={t('planner.kind_show', locale)}
      releasedWord={t('planner.released', locale)}
      noHourWord={t('planner.no_hour', locale)}
      allDayWord={t('planner.all_day', locale)}
      onReachEnd={probePlanAhead}
      onReachStart={agendaFromIso <= agendaFloorIso || pastExhausted ? undefined : loadAllEarlier}
      earlierLabel={t('planner.agenda_earlier', locale)}
      loadingLabel={t('planner.agenda_loading', locale)}
      noEarlierLabel={agendaFromIso <= agendaFloorIso || pastExhausted
        ? t('planner.agenda_no_earlier', locale)
        : undefined}
      onPlanEnds={probePlanAhead}
      endLabel={agendaExhausted ? t('planner.agenda_end', locale) : undefined}
      weekLabel={(n) => `${t('planner.week_n', locale)} ${n}`}
      weekRange={(from, to) => `${localeDayMonth(from, localeTag)} → ${localeDayMonth(to, localeTag)}`}
      weekTally={(firm, held, free) =>
        [
          firm ? `${firm} ${t('planner.week_confirmed', locale)}` : '',
          // ONE IS NOT «1 OPTIONS». The month's gutter kept its counts in a
          // tooltip, so nobody had ever read them as a sentence.
          held ? `${held} ${t(held === 1 ? 'planner.week_option_one' : 'planner.week_options', locale)}` : '',
          free ? `${free} ${t(free === 1 ? 'planner.week_free_one' : 'planner.week_free', locale)}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || t('planner.week_nothing', locale)}
      onDayOpen={(iso) => {
        dayIso = iso;
        setView('day');
      }}
      decideCardLabel={t('planner.dec_card', locale)}
      awayUntilWord={t('planner.away_until', locale)}
      awayLeftWord={t('planner.away_left', locale, { n: '{n}' })}
      awayLeftOneWord={t('planner.away_left_one', locale)}
      awayBackWord={t('planner.away_back', locale)}
      onConfirm={(id) => $decideMutation.mutate({ id, status: 'confirmed' })}
      onRelease={(id) => $decideMutation.mutate({ id, status: 'cancelled' })}
      pendingId={decisionPendingId}
      confirmLabel={t('planner.dec_confirm_short', locale)}
      releaseLabel={t('planner.released', locale)}
      onDecideJump={jumpToDecisions}
      onDateOpen={openDate}
      {notesByDay}
      onNoteCreate={notesAbsent ? undefined : createNote}
      onNoteDelete={notesAbsent ? undefined : deleteNote}
      noteFallbackLabel={noteFallback.label}
      noteFallbackIsSpace={Boolean(noteFallback.workspace_id)}
      notePlaceholder={t('planner.note_placeholder', locale)}
      noteAddLabel={t('planner.note_add', locale)}
      noteDeleteLabel={t('planner.note_delete', locale)}
    />
  {:else}
    <!-- The Board (ADR-094/ADR-095) — one grid, the Slip in its cells; the
         strip scrolls sideways inside itself, never the page. -->
    <CarrilsStrip
      axis={laneAxis}
      columns={boardWordedColumns}
      groups={boardBase.groups}
      cells={boardBase.cells}
      awayRuns={boardAwayRuns}
      clashes={boardClashes}
      axisWord={t(`planner.lanes_${laneAxis}`, locale)}
      todayWord={t('planner.today', locale)}
      weekdayWord={(iso) => localeWeekdayShort(iso, localeTag)}
      monthWord={boardMonthWord}
      laneTallyText={boardLaneTallyText}
      groupTallyText={boardGroupTallyText}
      sharedWord={t('planner.board_shared', locale)}
      teamWord={t('planner.board_team', locale)}
      noCastWord={t('planner.no_cast', locale)}
      awayWord={t('planner.band_away', locale)}
      untilLabel={(iso) => t('planner.band_until', locale, { day: localeDayMonth(iso, localeTag) })}
      emptyLabel={t('planner.empty_month', locale)}
      createLabel={(iso) => t('planner.new_on', locale, { day: iso })}
      clashDayLabel={(iso) => t('planner.conn_jump', locale, { day: Number(iso.slice(8, 10)) })}
      kindLabel={(k) => kindLabel(k)}
      stateLabel={boardSlipState}
      stateUrgent={(sl) => Boolean(sl.hold?.expires && sl.hold.expires <= todayIso)}
      onDayCreate={openBoardCreate}
      onClashDay={openClashDay}
      onDateOpen={openBoardDate}
      nowMinutes={boardNowMinutes}
      onReachEnd={probePlanAhead}
      shut={boardShut}
      {loading}
    />
    <!-- DEFERRED, said where it costs: the lane tallies count the DRAWN
         events, so calm (which hides options from the drawing) also thins
         the counts. The window-counting version needs a drawn-flag through
         the engine — noted in the review, not smuggled in. -->
  {/if}
</section>

<CreateEventDialog
  bind:open={createOpen}
  presetProjectId={boardPresetProjectId ?? presetProjectId}
  {presetLineId}
  presetDate={createDate}
  showBlackoutAction={canBlackout}
  onBlackout={openBlackout}
  onCreatedPerformance={handleCreated}
/>

<CreateBlackoutDialog
  bind:open={blackoutOpen}
  presetWorkspaceId={blackoutPresetWs}
  presetDate={createDate}
/>

<EditDateDialog bind:open={editOpen} date={editDate} inSeries={editInSeries} />

<FeedDialog bind:open={feedOpen} workspaces={$workspacesQuery.data?.items ?? []} />

<style>
  @layer components {
    .cal {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    /* BAND 3 · the machine. Mono 9.5px in caps — one of the three scales the
       head runs on (window 29px serif · view 21px serif · meta 9.5px mono). */
    .cal__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      margin: 0 0 var(--space-s);
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__meta :global(.cal__stat) {
      white-space: nowrap;
    }
    /* Each part is its own nowrap unit, and the `·` is inserted BETWEEN them —
       so a part that drops (no trips, no urgent) takes its separator with it. */
    .cal__meta :global(.cal__stat + .cal__stat)::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--border-color-dark);
    }
    .cal__meta :global(.cal__stat b) {
      font-weight: 400;
      color: var(--text-muted);
    }

    /* The masthead (title + switcher + stats) is now the shared LensHeader
       (global .lenshead* classes). Only the stat-item styling stays here. */
    .cal__stat b {
      font-family: var(--font-mono);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--text-color);
      margin-inline-end: var(--space-2xs);
    }
    /* Pulse "per decidir" — the one red figure; a jump, not a decoration. */
    .cal__pulse-chev {
      font-style: normal;
      margin-inline-start: 5px;
      font-size: 8px;
      vertical-align: 1px;
    }
    .cal__pulse-decide {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--danger);
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      border-block-end: 1px solid color-mix(in oklch, var(--danger) 40%, transparent);
      transition: color var(--transition), border-color var(--transition);
    }
    .cal__pulse-decide:hover {
      color: var(--danger-dark);
      border-color: var(--danger);
    }

    /* The absence's line above the Day's drawing — same voice as the
       agenda's away sentences: who, then the rest, quieter. */
    .cal__aways {
      margin-block-end: var(--space-s);
    }
    .cal__awayline {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      color: var(--text-faint);
    }
    .cal__awayline-who {
      color: var(--text-muted);
      margin-inline-end: 7px;
    }
    /* Red is conflict, and only conflict. */
    .cal__clashline {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      color: var(--danger);
    }

    .cal__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .cal__state--danger {
      color: var(--danger);
    }
  }
</style>

<!-- READING THE MARKS — the grammar of all four drawings, said once, in the
     head's overflow. It used to sit at the foot of the month, which is three
     screens down: the place nobody who needs teaching ever reaches. -->
<Dialog bind:open={marksOpen} title={t('planner.read_marks', locale)} size="s">
  <CalLegend
    confirmedLabel={t('planner.marks_firm', locale)}
    holdLabel={t('planner.marks_held', locale)}
    clashLabel={t('planner.marks_clash', locale)}
  />
</Dialog>
