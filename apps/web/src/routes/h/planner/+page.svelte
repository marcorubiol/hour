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
  import { toStore } from 'svelte/store';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import LensSwitcher from '$lib/components/LensSwitcher.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import MonthGrid, {
    dateDayKey,
    monthName,
    perfDayKey,
    type AwayBandVM,
    type BlackoutBandVM,
    type ClashVM,
    type DateEvent,
    type PerformanceEvent,
  } from '$lib/components/MonthGrid.svelte';
  import AgendaList from '$lib/components/AgendaList.svelte';
  import CreateEventDialog from '$lib/components/create/CreateEventDialog.svelte';
  import CreateBlackoutDialog from '$lib/components/create/CreateBlackoutDialog.svelte';
  import type { CreatedPerformance } from '$lib/components/PerformanceForm.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
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
    monthGrid,
    resolvePlannerView,
    type PlannerEvent,
    type PlannerView,
    type Conflict,
  } from '$lib/planner';
  import type { AvailabilityItem } from '$lib/availability';
  import type { DateRow } from '$lib/date';
  import { performanceStatusFamily, performanceStatusLabel } from '$lib/performance';
  import { dateStatusFamily } from '$lib/date';
  import { accentVarFor } from '$lib/utils/accent';

  type WorkspaceLite = { id: string; slug: string; name: string };
  type TeamItem = { person_id: string; workspace_id: string; slug: string; full_name: string };

  const pins = usePins();
  const locale = detectLocale(navigator.language);
  const localeTag = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' }[locale];

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
    const url = new URL(location.href);
    url.searchParams.set('view', v);
    replaceState(url, {});
  }
  // Inbound navigation carrying an explicit ?view= (pasted link,
  // back/forward). page.url is only the trigger; location.href the truth.
  $effect(() => {
    void page.url;
    const raw = new URL(location.href).searchParams.get('view');
    if ((raw === 'month' || raw === 'agenda') && raw !== untrack(() => view)) {
      view = raw;
    }
  });

  // ── Client-side status filter (ADR-078 §12: Tot | Holds | Confirmats) ─
  type CalFilter = 'all' | 'holds' | 'confirmed';
  let filter = $state<CalFilter>('all');

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspacesBySlug = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.slug, w])),
  );
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceNameById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.name])),
  );
  // Browsing context for link-building only (ADR-067): lens routes carry no
  // space segment; entity links borrow the default (first) workspace.
  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');

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
  let spacesInView = $derived(
    scopeWorkspaceIds === null
      ? ($workspacesQuery.data?.items ?? []).length
      : scopeWorkspaceIds.size,
  );

  // ── Event feeds ──────────────────────────────────────────────────────
  const feedKey = toStore(() => ({
    from: gridFrom,
    to: gridTo,
    unresolved: scopeUnresolved,
    ...filterIds,
  }));

  function feedParams(
    k: { projectIds: string[]; workspaceIds: string[] },
    from: string,
    to: string,
  ): string {
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    if (k.projectIds.length > 0) params.set('project_ids', k.projectIds.join(','));
    if (k.workspaceIds.length > 0) params.set('workspace_ids', k.workspaceIds.join(','));
    params.set('limit', '200');
    return params.toString();
  }

  const perfOptions = toStore(() => {
    const k = $feedKey;
    return {
      queryKey: ['planner-performances', k] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: PerformanceEvent[] }>(
          `/api/performances?status=any&rosters=1&${feedParams(k, k.from, k.to)}`,
          signal,
        ),
    };
  });
  // The dates window is padded ±1 day: `date` rows are timestamptz and get
  // bucketed into their venue's (or the viewer's) day, which can fall
  // outside the UTC-bounded fetch window at the grid edges. Off-grid
  // buckets simply find no cell.
  const datesOptions = toStore(() => {
    const k = $feedKey;
    return {
      queryKey: ['planner-dates', k] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: DateEvent[] }>(
          `/api/dates?${feedParams(k, addDaysIso(k.from, -1), addDaysIso(k.to, 1))}`,
          signal,
        ),
    };
  });
  // Blackouts — NO workspace filter: the engine wants every block RLS lets
  // through (a shared person's block from another space still collides,
  // ADR-078 §5). Graceful absence (contract §6): a pre-migration DB 502s —
  // render no blackouts, surface nothing. The `absent` marker is what
  // hides the blackout-creation entry points (no write UI over a missing
  // table).
  const availabilityOptions = toStore(() => {
    const k = $feedKey;
    return {
      queryKey: ['planner-availability', { from: k.from, to: k.to }] as const,
      enabled: !k.unresolved,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: AvailabilityItem[]; absent?: boolean }>(
            `/api/availability?from=${k.from}&to=${k.to}&limit=500`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] availability feed absent:', err);
          return { items: [] as AvailabilityItem[], absent: true };
        }
      },
    };
  });
  // Team of every visible workspace — person names for clash cards and
  // rail labels. Works against the live DB today; still fails quiet.
  const teamOptions = toStore(() => {
    const ids = ($workspacesQuery.data?.items ?? []).map((w) => w.id);
    return {
      queryKey: ['planner-team', ids] as const,
      enabled: ids.length > 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: TeamItem[]; absent?: boolean }>(
            `/api/team?workspace_ids=${ids.join(',')}`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] team feed absent:', err);
          return { items: [] as TeamItem[], absent: true };
        }
      },
    };
  });

  const perfQuery = createQuery(perfOptions);
  const datesQuery = createQuery(datesOptions);
  const availabilityQuery = createQuery(availabilityOptions);
  const teamQuery = createQuery(teamOptions);

  // isLoading (isPending && isFetching) — a disabled query is pending but
  // not loading, so an unresolved selection reads as empty, not stuck.
  let loading = $derived($perfQuery.isLoading || $datesQuery.isLoading);
  let errorMsg = $derived(
    $perfQuery.error instanceof Error
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

  let scopedPerfs = $derived(($perfQuery.data?.items ?? []).filter((p) => perfInScope(p)));
  let scopedDates = $derived(($datesQuery.data?.items ?? []).filter((d) => dateInScope(d)));

  let allBlackouts = $derived($availabilityQuery.data?.items ?? []);
  // The bands/rail show the scope's workspaces only; the engine reads all.
  let visibleBlackouts = $derived(
    allBlackouts.filter((b) => scopeWorkspaceIds === null || scopeWorkspaceIds.has(b.workspace_id)),
  );

  // ── Status filter (display only — conflicts stay truth-level) ────────
  function perfPassesFilter(p: PerformanceEvent): boolean {
    if (filter === 'all') return true;
    const family = performanceStatusFamily(p.status);
    return filter === 'holds' ? family === 'hold' : family === 'confirmed';
  }
  function datePassesFilter(d: DateEvent): boolean {
    if (filter === 'all') return true;
    const family = dateStatusFamily(d.status);
    return filter === 'holds' ? family === 'hold' : family === 'confirmed';
  }
  let shownPerfs = $derived(scopedPerfs.filter(perfPassesFilter));
  let shownDates = $derived(scopedDates.filter(datePassesFilter));

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
    return KIND_KEYS.has(kind) ? t(`calendar.kind_${kind}`, locale) : kind.replace(/_/g, ' ');
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
        label: company
          ? (workspaceNameById.get(b.workspace_id) ?? '—')
          : t('planner.band_person', locale, { person: personName ?? '—' }),
        note: b.note,
      };
    }),
  );
  let awayVMs = $derived.by((): AwayBandVM[] =>
    aways.map((b) => ({
      from: b.from,
      to: b.to,
      label: t('planner.away', locale, {
        project: projectNameById.get(b.project_id) ?? '—',
      }),
    })),
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

  function clashVM(c: Conflict): ClashVM {
    const rows = c.event_ids
      .map((id) => eventSummaryById.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (c.severity === 'people') {
      const people = c.person_ids.map((id) => personNames.get(id) ?? '?').join(', ');
      return {
        severity: c.severity,
        glyph: '!',
        title: t('planner.clash_people_title', locale),
        body: t('planner.clash_people_body', locale, { people }),
        rows,
      };
    }
    if (c.severity === 'possible') {
      return {
        severity: c.severity,
        glyph: '?',
        title: t('planner.clash_possible_title', locale),
        body: t('planner.clash_possible_body', locale),
        rows,
      };
    }
    const tentative = c.severity === 'blackout-tentative';
    const block = c.availability_block_id ? blackoutById.get(c.availability_block_id) : undefined;
    const company = c.person_ids.length === 0;
    const person = company ? '' : (personNames.get(c.person_ids[0]) ?? '—');
    const workspace = block ? (workspaceNameById.get(block.workspace_id) ?? '—') : '—';
    return {
      severity: c.severity,
      glyph: tentative ? '?' : '!',
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
    };
  }

  let clashesByDay = $derived.by(() => {
    const byDay = new Map<string, ClashVM[]>();
    for (const c of conflicts) {
      const day = eventDayById.get(c.event_ids[0]);
      if (!day) continue;
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(clashVM(c));
    }
    return byDay;
  });

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
    return { confirmed, holds, conflicts: conflictCount, blackouts: blackoutCount };
  });

  let monthTitle = $derived(monthName(ym.year, ym.month, localeTag));
  let eyebrowSpaces = $derived(
    spacesInView === 1
      ? t('planner.eyebrow_spaces_one', locale)
      : t('planner.eyebrow_spaces', locale, { n: spacesInView }),
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
    createDate = dayIso ?? todayIso;
    createOpen = true;
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

  // ── Calendar feed links (ADR-054) — entry now lives in the "⋯" menu. ──
  type FeedShare = { id: string; token: string; workspace_id: string; created_at: string };

  let feedOpen = $state(false);
  let feedWs = $state('');

  let feedWsOptions = $derived(
    ($workspacesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name })),
  );

  function openFeed() {
    if (!feedWs) {
      const current = workspacesBySlug.get(defaultWorkspaceSlug);
      feedWs = current?.id ?? feedWsOptions[0]?.value ?? '';
    }
    feedOpen = true;
  }

  const feedSharesOptions = toStore(() => {
    const ws = feedWs;
    return {
      queryKey: ['calendar-shares', ws] as const,
      enabled: feedOpen && Boolean(ws),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: FeedShare[] }>(
          `/api/calendar-shares?workspace_id=${encodeURIComponent(ws)}`,
          signal,
        ),
    };
  });
  const feedSharesQuery = createQuery(feedSharesOptions);
  let feedShares = $derived($feedSharesQuery.data?.items ?? []);

  function feedUrl(token: string): string {
    return `${location.origin}/api/public/calendar/${token}`;
  }

  async function copyFeedUrl(token: string, scheme: 'https' | 'webcal') {
    const url =
      scheme === 'webcal' ? feedUrl(token).replace(/^https?:/, 'webcal:') : feedUrl(token);
    await navigator.clipboard.writeText(url);
    addToast({ tone: 'success', message: `${scheme === 'webcal' ? 'webcal' : 'https'} link copied.` });
  }

  const createFeed = createMutation({
    mutationFn: () =>
      mutateJSON<{ share: FeedShare }>('POST', '/api/calendar-shares', {
        workspace_id: feedWs,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar-shares'] });
      addToast({ tone: 'success', message: 'Feed link created.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Feed not created',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  const revokeFeed = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/calendar-shares/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar-shares'] });
      addToast({ tone: 'success', message: 'Feed link revoked — subscribers stop updating now.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not revoked',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });
</script>

<svelte:head>
  <title>Calendar — Hour</title>
</svelte:head>

<section class="cal">
  <header class="cal__head">
    <div class="cal__toprow">
      <p class="eyebrow">{t('lens.planner', locale)} · {eyebrowSpaces}</p>
      <LensSwitcher />
    </div>
    <h1 class="cal__month"><em>{monthTitle}</em> {ym.year}</h1>
    {#if !errorMsg}
      <p class="cal__stats" class:cal__stats--loading={loading}>
        <span class="cal__stat"><b>{stats.confirmed}</b> {t('planner.stat_confirmed', locale)}</span>
        <span class="cal__stat"><b>{stats.holds}</b> {t('planner.stat_holds', locale)}</span>
        <span class="cal__stat"><b>{stats.conflicts}</b> {t('planner.stat_conflicts', locale)}</span>
        <span class="cal__stat cal__stat--soft"
          ><b>{stats.blackouts}</b> {t('planner.stat_blackouts', locale)}</span
        >
      </p>
    {/if}
  </header>

  <div class="cal__toolbar">
    <div class="cal__nav-buttons">
      <Button variant="outline" size="s" onclick={prevMonth} label={t('planner.prev_month', locale)}
        >←</Button
      >
      <span class="cal__tbmonth">{monthTitle} {ym.year}</span>
      <Button variant="outline" size="s" onclick={nextMonth} label={t('planner.next_month', locale)}
        >→</Button
      >
      <Button variant="outline" size="s" onclick={thisMonth}>{t('planner.today', locale)}</Button>
    </div>
    <div class="cal__spacer"></div>
    <div class="cal__filter" role="group" aria-label={t('planner.filter_label', locale)}>
      <button
        type="button"
        class="cal__filter-btn"
        class:cal__filter-btn--on={filter === 'all'}
        aria-pressed={filter === 'all'}
        onclick={() => (filter = 'all')}>{t('planner.filter_all', locale)}</button
      >
      <button
        type="button"
        class="cal__filter-btn"
        class:cal__filter-btn--on={filter === 'holds'}
        aria-pressed={filter === 'holds'}
        onclick={() => (filter = 'holds')}>{t('planner.filter_holds', locale)}</button
      >
      <button
        type="button"
        class="cal__filter-btn"
        class:cal__filter-btn--on={filter === 'confirmed'}
        aria-pressed={filter === 'confirmed'}
        onclick={() => (filter = 'confirmed')}>{t('planner.filter_confirmed', locale)}</button
      >
    </div>
    <div class="cal__seg" role="group" aria-label={t('planner.view_label', locale)}>
      <button
        type="button"
        class="cal__seg-btn"
        class:cal__seg-btn--on={view === 'month'}
        aria-pressed={view === 'month'}
        onclick={() => setView('month')}>{t('planner.view_month', locale)}</button
      >
      <button
        type="button"
        class="cal__seg-btn"
        class:cal__seg-btn--on={view === 'agenda'}
        aria-pressed={view === 'agenda'}
        onclick={() => setView('agenda')}>{t('planner.view_agenda', locale)}</button
      >
    </div>
    <Button size="s" onclick={() => openCreate()} label={t('planner.new', locale)}>+</Button>
    <Menu
      align="end"
      label={t('planner.more', locale)}
      items={[
        { label: t('planner.feed', locale), onclick: openFeed },
        ...(canBlackout
          ? [
              {
                label: t('planner.blackout_menu', locale),
                // Direct menu path: no day context — drop any stale preset
                // from a cancelled day-cell create (the dialog defaults to
                // today). The create-dialog footer path keeps its day.
                onclick: () => {
                  createDate = null;
                  openBlackout();
                },
              },
            ]
          : []),
      ]}
    >
      {#snippet trigger()}⋯{/snippet}
    </Menu>
  </div>

  {#if errorMsg}
    <p class="cal__state cal__state--danger">{errorMsg}</p>
  {:else if view === 'month'}
    <MonthGrid
      year={ym.year}
      month={ym.month}
      performances={shownPerfs}
      dates={shownDates}
      workspaceSlug={defaultWorkspaceSlug}
      {loading}
      onDayCreate={(iso) => openCreate(iso)}
      blackouts={blackoutVMs}
      aways={awayVMs}
      {clashesByDay}
      locale={localeTag}
      dateKindLabel={kindLabel}
      createLabel={(iso) => t('planner.new_on', locale, { day: iso })}
    />
  {:else}
    <AgendaList
      {monthDays}
      performances={shownPerfs}
      dates={shownDates}
      workspaceSlug={defaultWorkspaceSlug}
      {loading}
      blackouts={blackoutVMs}
      aways={awayVMs}
      {clashesByDay}
      locale={localeTag}
      dateKindLabel={kindLabel}
      viewerTimeLabel={(time) => t('planner.viewer_time', locale, { time })}
      emptyLabel={t('planner.empty_month', locale)}
      blackoutsToggleLabel={t('planner.blackouts_toggle', locale)}
    />
  {/if}
</section>

<CreateEventDialog
  bind:open={createOpen}
  {presetProjectId}
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

<Dialog bind:open={feedOpen} title="Calendar feed" size="m">
  <p class="cal__feed-hint">
    Subscribe from Google/Apple Calendar: confirmed gigs and dates stay in
    sync — no copying by hand. The link is the key: anyone holding it sees
    the feed (never money, never notes) until you revoke it.
  </p>
  <Select label="Workspace" options={feedWsOptions} bind:value={feedWs} />
  {#if $feedSharesQuery.isPending && feedWs}
    <p class="cal__feed-hint">Loading…</p>
  {:else if feedShares.length === 0}
    <p class="cal__feed-hint">No feed links yet for this workspace.</p>
  {:else}
    <ul class="cal__feed-list" role="list">
      {#each feedShares as share (share.id)}
        <li class="cal__feed-row">
          <code class="cal__feed-token">…{share.token.slice(-8)}</code>
          <Button variant="outline" size="xs" onclick={() => copyFeedUrl(share.token, 'https')}>
            Copy link
          </Button>
          <Button variant="outline" size="xs" onclick={() => copyFeedUrl(share.token, 'webcal')}>
            Copy webcal
          </Button>
          <Button
            variant="outline"
            tone="warn"
            size="xs"
            loading={$revokeFeed.isPending}
            onclick={() => $revokeFeed.mutate(share.id)}
          >
            Revoke
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (feedOpen = false)}>Close</Button>
    <Button
      onclick={() => $createFeed.mutate()}
      loading={$createFeed.isPending}
      disabled={!feedWs}
    >
      New feed link
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cal {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .cal__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .cal__toprow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      /* The lens switcher is wider than a phone viewport — let it wrap
         under the eyebrow instead of forcing horizontal page overflow. */
      flex-wrap: wrap;
    }

    .cal__month {
      font-family: var(--font-display);
      font-size: clamp(1.6rem, 2.5vw, 2.1rem);
      font-weight: 400;
      letter-spacing: -0.02em;
      color: var(--text-color);
    }
    .cal__month em {
      font-style: italic;
      text-transform: capitalize;
    }

    /* Masthead stats — verdad-solo-datos: every figure maps to rows. */
    .cal__stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-m);
      font-size: var(--text-s);
      color: var(--text-muted);
      transition: opacity var(--transition);
    }
    .cal__stats--loading {
      opacity: 0.5;
    }
    .cal__stat b {
      font-family: var(--font-mono);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--text-color);
      margin-inline-end: var(--space-2xs);
    }
    .cal__stat--soft b {
      color: var(--text-muted);
    }

    /* Toolbar: ‹ month › · today · [filter] · [projection] · + · ⋯ */
    .cal__toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      flex-wrap: wrap;
    }
    .cal__nav-buttons {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .cal__tbmonth {
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 500;
      min-inline-size: 7.5rem;
      text-align: center;
      text-transform: capitalize;
    }
    .cal__spacer {
      flex: 1;
    }

    .cal__filter {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
    }
    .cal__filter-btn {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-m);
      background: none;
      border: none;
      cursor: pointer;
      transition: color var(--transition), background var(--transition);
    }
    .cal__filter-btn:hover {
      color: var(--text-color);
    }
    .cal__filter-btn--on {
      color: var(--text-color);
      background: var(--bg-light);
    }

    /* Named projection toggle (ADR-076: nunca un icono). */
    .cal__seg {
      display: inline-flex;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      overflow: hidden;
    }
    .cal__seg-btn {
      border: none;
      background: none;
      padding: var(--space-2xs) var(--space-m);
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--transition), color var(--transition);
    }
    .cal__seg-btn--on {
      background: var(--text-color);
      color: var(--bg);
    }

    .cal__feed-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .cal__feed-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-s);
    }

    .cal__feed-row {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .cal__feed-token {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      flex: 1;
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
