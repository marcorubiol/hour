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
  import { tick, untrack } from 'svelte';
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
  import DecisionBand, {
    type ConcurrenceVM,
    type DecisionOptionVM,
    type DecisionVM,
  } from '$lib/components/planner/DecisionBand.svelte';
  import CarrilsStrip, {
    type ConnectorVM,
    type LaneBandVM,
    type LanePipVM,
    type LaneVM,
    type LoomGroupVM,
  } from '$lib/components/planner/CarrilsStrip.svelte';
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
    decisionsFor,
    monthGrid,
    resolvePlannerView,
    type PlannerEvent,
    type PlannerView,
    type Conflict,
    type DecisionPerformance,
    type DecisionSide,
  } from '$lib/planner';
  import {
    loomThreads,
    prepRuns,
    resolveCarrilsGroup,
    type CarrilsGroup,
    type LoomCommitment,
    type PrepDay,
  } from '$lib/carrils';
  import type { AvailabilityItem } from '$lib/availability';
  import type { DateRow } from '$lib/date';
  import { timeInTz } from '$lib/datetime';
  import {
    holdRankKey,
    isHoldStatus,
    performanceStatusFamily,
    performanceStatusLabel,
  } from '$lib/performance';
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
  // Carrils grouping (ADR-080 §8) — same persistence chain as the
  // projection: ?group= → localStorage → 'espai'. The URL only carries
  // &group= while the projection is carrils (it means nothing elsewhere).
  const GROUP_STORAGE_KEY = 'hour:calendar:group';
  function storedGroup(): string | null {
    try {
      return localStorage.getItem(GROUP_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  let carrilsGroup = $state<CarrilsGroup>(
    resolveCarrilsGroup(new URL(location.href).searchParams.get('group'), storedGroup()),
  );

  /** Rewrite the address bar (the truth) with the current view/group. */
  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    if (view === 'carrils') url.searchParams.set('group', carrilsGroup);
    else url.searchParams.delete('group');
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
  function setGroup(g: CarrilsGroup) {
    if (carrilsGroup === g) return;
    carrilsGroup = g;
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, g);
    } catch {
      // Storage disabled — in-session state still works.
    }
    syncUrl();
  }
  // Inbound navigation carrying an explicit ?view=/&group= (pasted link,
  // back/forward). page.url is only the trigger; location.href the truth.
  $effect(() => {
    void page.url;
    const params = new URL(location.href).searchParams;
    const raw = params.get('view');
    if (
      (raw === 'month' || raw === 'agenda' || raw === 'carrils') &&
      raw !== untrack(() => view)
    ) {
      view = raw;
    }
    const rawGroup = params.get('group');
    if (
      (rawGroup === 'espai' || rawGroup === 'projecte' || rawGroup === 'persona') &&
      rawGroup !== untrack(() => carrilsGroup)
    ) {
      carrilsGroup = rawGroup;
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

  // The API's hard cap on ?limit (maxValue in its QuerySchema) — one page.
  const FEED_LIMIT = 200;

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
    params.set('limit', String(FEED_LIMIT));
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

  // ── Decisions window (ADR-080 §4) — cross-month: holds live in
  // [today, today+90d], not just the visible month. Same scope filter as
  // the month feed; ?notice=1 opts into hold_notice_days (ADR-080 §2) and
  // is what exposes this fetch to a pre-migration DB — so it degrades to
  // `absent` (contract § Graceful absence: band + decision segments of the
  // pulse simply stay off, zero errors surfaced). ─────────────────────────
  const DECISIONS_WINDOW_DAYS = 90;
  const decisionsTo = addDaysIso(todayIso, DECISIONS_WINDOW_DAYS);

  type DecisionPerfItem = PerformanceEvent & { hold_notice_days?: number | null };

  const decisionsPerfOptions = toStore(() => {
    const k = $feedKey;
    return {
      // Same family as the month feed on purpose: one optimistic write
      // (setQueriesData over the prefix) and one invalidate reach both.
      queryKey: [
        'calendar-performances',
        {
          window: 'decisions',
          unresolved: k.unresolved,
          projectIds: k.projectIds,
          workspaceIds: k.workspaceIds,
        },
      ] as const,
      enabled: !k.unresolved,
      queryFn: async ({
        signal,
      }: {
        signal: AbortSignal;
      }): Promise<{ items: DecisionPerfItem[]; absent?: boolean }> => {
        try {
          // The API caps `limit` at 200 — sized for a one-month grid,
          // while this window spans 90 days across the whole scope. Page
          // with a day cursor (rows arrive performed_at.asc; the boundary
          // day is re-fetched and deduped) so the queue and the pulse's
          // "per decidir" never under-report silently (ADR-080 §1/§6:
          // every figure maps to fetched rows — ALL of them).
          const seen = new Set<string>();
          const items: DecisionPerfItem[] = [];
          let from = todayIso;
          for (;;) {
            const batch = await fetchJSON<{ items: DecisionPerfItem[] }>(
              `/api/performances?status=any&rosters=1&notice=1&${feedParams(k, from, decisionsTo)}`,
              signal,
            );
            for (const it of batch.items) {
              if (!seen.has(it.id)) {
                seen.add(it.id);
                items.push(it);
              }
            }
            if (batch.items.length < FEED_LIMIT) break;
            const lastDay = batch.items[batch.items.length - 1].performed_at.slice(0, 10);
            // A single day carrying a full page cannot advance the cursor
            // — stop rather than loop (implausible at this scale).
            if (lastDay === from) break;
            from = lastDay;
          }
          return { items };
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] decisions feed absent:', err);
          return { items: [] as DecisionPerfItem[], absent: true };
        }
      },
    };
  });
  // No availability feed for this window: blackouts only ever yield
  // single-event severities, which decisionsFor cannot consume (pairs
  // only) — it doesn't take them as input.

  const perfQuery = createQuery(perfOptions);
  const datesQuery = createQuery(datesOptions);
  const availabilityQuery = createQuery(availabilityOptions);
  const teamQuery = createQuery(teamOptions);
  const decisionsPerfQuery = createQuery(decisionsPerfOptions);

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
      const vm = clashVM(c);
      if (!vm) continue;
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(vm);
    }
    return byDay;
  });

  // ── Carrils VMs (ADR-080 §7/§8) — the ribbon speaks day-of-month
  // numbers. Pips/bands follow the status filter like the other two
  // projections; connectors read the truth-level conflict engine, same
  // rule as the month marks. ────────────────────────────────────────────
  let monthKey = $derived(monthFirst.slice(0, 7));
  function inMonthDay(iso: string): number | null {
    return iso.slice(0, 7) === monthKey ? Number(iso.slice(8, 10)) : null;
  }
  /** Clip an inclusive ISO range to the visible month (null = outside). */
  function clipToMonth(from: string, to: string): { from: number; to: number } | null {
    if (to < monthFirst || from > monthLast) return null;
    return {
      from: from < monthFirst ? 1 : Number(from.slice(8, 10)),
      to: to > monthLast ? monthDays.length : Number(to.slice(8, 10)),
    };
  }

  type ProjectRef = {
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
  function projectAccent(id: string): string {
    const p = projectById.get(id);
    return p ? accentVarFor(p) : 'var(--accent-1)';
  }
  function blackoutLabel(b: AvailabilityItem): string {
    if (b.person_id === null) return workspaceNameById.get(b.workspace_id) ?? '—';
    const person = b.person?.full_name ?? personNames.get(b.person_id);
    return t('planner.band_person', locale, { person: person ?? '—' });
  }

  /** Rehearsal/residency rows render as quiet run-bands, not pips. */
  const PREP_KINDS = new Set(['rehearsal', 'residency']);
  let prepRunsIso = $derived.by(() => {
    const days: PrepDay[] = [];
    for (const d of shownDates) {
      if (!PREP_KINDS.has(d.kind) || d.status === 'cancelled' || !d.project) continue;
      const day = dateDayKey(d, viewerTz);
      if (day.slice(0, 7) !== monthKey) continue;
      days.push({ project_id: d.project.id, day, label: d.title ?? kindLabel(d.kind) });
    }
    return prepRuns(days);
  });

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

  let carrilsLanes = $derived.by((): LaneVM[] => {
    if (view !== 'carrils' || carrilsGroup === 'persona') return [];
    const byProject = carrilsGroup === 'projecte';
    const lanes = new Map<string, LaneVM>();
    const laneFor = (projectId: string | null, workspaceId: string | null): LaneVM | null => {
      const key = byProject ? projectId : workspaceId;
      if (!key) return null;
      let lane = lanes.get(key);
      if (!lane) {
        lane = {
          key,
          label: byProject
            ? (projectNameById.get(key) ?? '—')
            : (workspaceNameById.get(key) ?? '—'),
          accent: byProject ? projectAccent(key) : workspaceAccent(key),
          pips: [],
          bands: [],
        };
        lanes.set(key, lane);
      }
      return lane;
    };

    // Pips, chronological — insertion order = first-appearance lane order.
    const perfs = [...shownPerfs].sort((a, b) => (perfDayKey(a) < perfDayKey(b) ? -1 : 1));
    for (const p of perfs) {
      if (p.status === 'cancelled' || !p.project) continue;
      const day = inMonthDay(perfDayKey(p));
      if (day === null) continue;
      const lane = laneFor(p.project.id, p.project.workspace_id);
      if (!lane) continue;
      const venue = p.venue?.name ?? p.venue_name ?? p.city ?? p.project.name;
      const city = p.venue?.city ?? p.city;
      lane.pips.push({
        id: p.id,
        day,
        kind: 'perf',
        state: performanceStatusFamily(p.status) === 'confirmed' ? 'confirmed' : 'hold',
        label: venue,
        time: p.start_at ? timeInTz(p.start_at, p.venue?.timezone || viewerTz) : null,
        accent: accentVarFor(p.project),
        title: `${p.project.name} · ${venue}${city ? `, ${city}` : ''} · ${performanceStatusLabel(p.status)}`,
        href: p.slug
          ? `/h/${workspaceSlugById.get(p.project.workspace_id) ?? defaultWorkspaceSlug}/performance/${p.slug}`
          : null,
      });
    }
    const dates = [...shownDates].sort((a, b) =>
      dateDayKey(a, viewerTz) < dateDayKey(b, viewerTz) ? -1 : 1,
    );
    for (const d of dates) {
      if (d.status === 'cancelled' || !d.project || PREP_KINDS.has(d.kind)) continue;
      const day = inMonthDay(dateDayKey(d, viewerTz));
      if (day === null) continue;
      const lane = laneFor(d.project.id, d.project.workspace_id);
      if (!lane) continue;
      if (d.kind === 'travel_day') {
        // Mono "→ City" — direction is the arrow (ADR-080 §7).
        const place = d.city ?? d.title ?? d.venue_name ?? kindLabel(d.kind);
        const arrow = d.travel_direction === 'return' ? '←' : '→';
        lane.pips.push({
          id: d.id,
          day,
          kind: 'travel',
          label: `${arrow} ${place}`,
          accent: accentVarFor(d.project),
          title: `${d.project.name} · ${kindLabel(d.kind)} · ${place}`,
        });
      } else {
        lane.pips.push({
          id: d.id,
          day,
          kind: 'date',
          label: kindLabel(d.kind),
          accent: accentVarFor(d.project),
          title: `${d.project.name} · ${d.title ?? kindLabel(d.kind)}`,
        });
      }
    }
    // Prep runs — quiet in-lane bands, project accent, hatched.
    for (const run of prepRunsIso) {
      const lane = laneFor(run.project_id, projectById.get(run.project_id)?.workspace_id ?? null);
      const range = clipToMonth(run.from, run.to);
      if (!lane || !range) continue;
      lane.bands.push({
        id: `prep:${run.project_id}:${run.from}`,
        ...range,
        kind: 'prep',
        label: run.label,
        accent: projectAccent(run.project_id),
      });
    }
    // Derived away bands — dotted, quieter than everything (ADR-078 §6).
    for (const band of aways) {
      const lane = laneFor(band.project_id, projectById.get(band.project_id)?.workspace_id ?? null);
      const range = clipToMonth(band.from, band.to);
      if (!lane || !range) continue;
      lane.bands.push({
        id: `away:${band.project_id}:${band.from}`,
        ...range,
        kind: 'away',
        label: t('planner.away', locale, {
          project: projectNameById.get(band.project_id) ?? '—',
        }),
      });
    }
    // Blackouts. Per espai they own (and may create) their workspace lane
    // — a closed month with no gigs is still a fact. Per projecte a
    // blackout has no project of its own: a person block rides the lanes
    // whose rosters name the person, a company block rides every existing
    // lane of its workspace.
    for (const b of visibleBlackouts) {
      const range = clipToMonth(b.starts_on, b.ends_on);
      if (!range) continue;
      const vm: LaneBandVM = {
        id: `blk:${b.id}`,
        ...range,
        kind: 'blackout',
        company: b.person_id === null,
        tentative: b.certainty === 'tentative',
        label: blackoutLabel(b),
        title: b.note ? `${blackoutLabel(b)} · ${b.note}` : blackoutLabel(b),
      };
      if (!byProject) {
        laneFor(null, b.workspace_id)?.bands.push(vm);
      } else {
        for (const lane of lanes.values()) {
          const belongs =
            b.person_id === null
              ? projectById.get(lane.key)?.workspace_id === b.workspace_id
              : (projectRosters.get(lane.key)?.has(b.person_id) ?? false);
          if (belongs) lane.bands.push({ ...vm, id: `${vm.id}:${lane.key}` });
        }
      }
    }
    return [...lanes.values()];
  });

  // Cross-lane conflict connectors (ADR-080 §7): people = red !, possible
  // = quiet ? — the two cross-project severities the engine emits here.
  // The id IS the decision pair id, so a click lands on the band's card.
  let eventById = $derived(new Map(engineEvents.map((e) => [e.id, e])));
  let carrilsConnectors = $derived.by((): ConnectorVM[] => {
    if (view !== 'carrils' || carrilsGroup === 'persona') return [];
    const byProject = carrilsGroup === 'projecte';
    const out: ConnectorVM[] = [];
    const seen = new Set<string>();
    for (const c of conflicts) {
      if ((c.severity !== 'people' && c.severity !== 'possible') || c.event_ids.length !== 2) {
        continue;
      }
      const a = eventById.get(c.event_ids[0]);
      const b = eventById.get(c.event_ids[1]);
      if (!a || !b) continue;
      const aKey = byProject ? a.project_id : a.workspace_id;
      const bKey = byProject ? b.project_id : b.workspace_id;
      if (aKey === bKey) continue;
      const day = inMonthDay(a.day);
      if (day === null) continue;
      const dedup = `${day}:${[aKey, bKey].sort().join('|')}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      out.push({
        id: `${a.day}:${[a.id, b.id].sort().join('+')}`,
        day,
        aKey,
        bKey,
        severity: c.severity,
        label: t('planner.conn_jump', locale, { day }),
      });
    }
    return out;
  });

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
  let loomGroups = $derived.by((): LoomGroupVM[] => {
    if (view !== 'carrils' || carrilsGroup !== 'persona') return [];
    const team = ($teamQuery.data?.items ?? []).filter(
      (i) => scopeWorkspaceIds === null || scopeWorkspaceIds.has(i.workspace_id),
    );
    const commitments: LoomCommitment[] = [];
    for (const p of shownPerfs) {
      if (p.status === 'cancelled' || !p.project || !p.person_ids) continue;
      const day = perfDayKey(p);
      if (day.slice(0, 7) !== monthKey) continue;
      const state =
        performanceStatusFamily(p.status) === 'confirmed' ? ('confirmed' as const) : ('hold' as const);
      for (const person_id of p.person_ids) {
        commitments.push({ person_id, day, project_id: p.project.id, state });
      }
    }
    const knots: Array<{ day: string; person_ids: string[] }> = [];
    for (const c of conflicts) {
      if (c.severity !== 'people') continue;
      const day = eventDayById.get(c.event_ids[0]);
      if (day && day.slice(0, 7) === monthKey) knots.push({ day, person_ids: c.person_ids });
    }
    const dayNum = (iso: string) => Number(iso.slice(8, 10));
    return loomThreads({
      team,
      commitments,
      preps: prepRunsIso,
      blackouts: visibleBlackouts,
      knots,
      monthFrom: monthFirst,
      monthTo: monthLast,
    }).map((g) => ({
      key: g.key,
      label:
        g.kind === 'project'
          ? (projectNameById.get(g.key) ?? '—')
          : (workspaceNameById.get(g.key) ?? '—'),
      accent: g.kind === 'project' ? projectAccent(g.key) : workspaceAccent(g.key),
      threads: g.threads.map((th) => ({
        person_id: th.person_id,
        name: th.name,
        shared: th.shared,
        ghost: th.ghost,
        segments: th.segments.map((s) => ({
          from: dayNum(s.from),
          to: dayNum(s.to),
          state: s.state,
          accent: projectAccent(s.project_id),
          title: `${projectNameById.get(s.project_id) ?? '—'} · ${
            s.from === s.to ? s.from : `${s.from} → ${s.to}`
          }`,
        })),
        outs: th.outs.map((o) => ({
          from: dayNum(o.from),
          to: dayNum(o.to),
          tentative: o.tentative,
        })),
        knots: th.knots.map(dayNum),
      })),
    }));
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
        time: p.start_at ? timeInTz(p.start_at, p.venue?.timezone || viewerTz) : null,
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
        };
      };
      return { id: c.id, day: c.day, a: side(c.a), b: side(c.b) };
    }),
  );
  let urgentCount = $derived(decisionVMs.filter((d) => d.urgent).length);

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
  function pulseDayLabel(iso: string): string {
    const mon = new Intl.DateTimeFormat(localeTag, { month: 'short', timeZone: 'UTC' })
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(/\.+$/, '');
    return `${Number(iso.slice(8, 10))} ${mon}`;
  }
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
      <!-- Pulse strip (ADR-080 §6) — replaces the flat stats row. Every
           figure maps to fetched rows; a segment whose feed is absent (or
           whose count is zero) drops instead of lying. -->
      <p class="cal__stats" class:cal__stats--loading={loading}>
        {#if !decisionsAbsent && decisionVMs.length > 0}
          <button type="button" class="cal__pulse-decide" onclick={jumpToDecisions}>
            <!-- {' · '} — explicit separator: Svelte trims the block-leading
                 whitespace, which glued the count to the urgent segment. -->
            {t('planner.pulse_decide', locale, { n: decisionVMs.length })}{#if urgentCount > 0}{' · '}{urgentCount ===
              1
                ? t('planner.pulse_urgent_one', locale)
                : t('planner.pulse_urgent', locale, { m: urgentCount })}{/if}
          </button>
        {/if}
        {#if !decisionsAbsent && pulseNext}
          <span class="cal__stat cal__stat--soft"
            >{t('planner.pulse_next', locale, {
              day: pulseDayLabel(pulseNext.day),
              venue: pulseNext.venue,
            })}</span
          >
        {/if}
        <span class="cal__stat"><b>{stats.confirmed}</b> {t('planner.stat_confirmed', locale)}</span>
        <span class="cal__stat"><b>{stats.holds}</b> {t('planner.stat_holds', locale)}</span>
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
      </p>
    {/if}
  </header>

  {#if !errorMsg && !decisionsAbsent && (decisionVMs.length > 0 || concurrenceVMs.length > 0)}
    <!-- Decision band (ADR-080 §4) — shared by all projections. Mounted
         for concurrences alone too: the quiet tier is "es VEU, no crida"
         (§3), so it must be seeable even when nothing is per decidir —
         it still never counts, never marks, never turns urgent. -->
    <DecisionBand
      decisions={decisionVMs}
      concurrences={concurrenceVMs}
      open={decisionsOpen}
      onToggle={setDecisionsOpen}
      onConfirm={(id) => $decideMutation.mutate({ id, status: 'confirmed' })}
      onRelease={(id) => $decideMutation.mutate({ id, status: 'cancelled' })}
      pendingId={decisionPendingId}
      {locale}
      {localeTag}
      id="cal-decisions"
    />
  {/if}

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
    <div class="cal__tabs" role="group" aria-label={t('planner.view_label', locale)}>
      <button
        type="button"
        class="cal__tab"
        class:cal__tab--on={view === 'month'}
        aria-pressed={view === 'month'}
        onclick={() => setView('month')}>{t('planner.view_month', locale)}</button
      >
      <button
        type="button"
        class="cal__tab"
        class:cal__tab--on={view === 'agenda'}
        aria-pressed={view === 'agenda'}
        onclick={() => setView('agenda')}>{t('planner.view_agenda', locale)}</button
      >
      <button
        type="button"
        class="cal__tab"
        class:cal__tab--on={view === 'carrils'}
        aria-pressed={view === 'carrils'}
        onclick={() => setView('carrils')}>{t('planner.view_carrils', locale)}</button
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

  {#if view === 'carrils'}
    <!-- Agrupa per (ADR-080 §8) — its own row, left-aligned; carrils only. -->
    <div class="cal__grouprow" role="group" aria-label={t('planner.group_label', locale)}>
      <span class="cal__group-lead">{t('planner.group_label', locale)}</span>
      <div class="cal__tabs">
        {#each ['espai', 'projecte', 'persona'] as const as g (g)}
          <button
            type="button"
            class="cal__tab"
            class:cal__tab--on={carrilsGroup === g}
            aria-pressed={carrilsGroup === g}
            onclick={() => setGroup(g)}>{t(`planner.group_${g}`, locale)}</button
          >
        {/each}
      </div>
    </div>
  {/if}

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
      holdRankLabel={(status) => {
        const key = holdRankKey(status);
        return key ? t(key, locale) : null;
      }}
      legendConfirmedLabel={t('planner.legend_confirmed', locale)}
      legendHoldLabel={t('planner.legend_hold', locale)}
    />
  {:else if view === 'agenda'}
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
  {:else}
    <!-- Carrils (ADR-080 §7/§8) — desktop-first; at 390px the strip
         itself scrolls horizontally, never the page. -->
    <CarrilsStrip
      {monthDays}
      {todayIso}
      group={carrilsGroup}
      lanes={carrilsLanes}
      loom={loomGroups}
      connectors={carrilsConnectors}
      onConnectorJump={jumpToDecisionCard}
      {locale}
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
    /* Pulse "per decidir" — the one red figure; a jump, not a decoration. */
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

    /* Agrupa per (ADR-080 §8) — its own row under the toolbar, left-aligned. */
    .cal__grouprow {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .cal__group-lead {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      white-space: nowrap;
    }

    /* Named projection toggle + Agrupa per — text tabs, active underlined
       (ADR-076: nunca un icono). Lighter than a pill: the word is the tab. */
    .cal__tabs {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .cal__tab {
      border: none;
      background: none;
      padding: 0;
      font-family: inherit;
      font-size: var(--text-s);
      line-height: 1.3;
      color: var(--text-faint);
      cursor: pointer;
      white-space: nowrap;
      border-block-end: 1.5px solid transparent;
      transition: color var(--transition);
    }
    .cal__tab:hover {
      color: var(--text-muted);
    }
    .cal__tab--on {
      color: var(--text-color);
      font-weight: 500;
      border-block-end-color: var(--text-color);
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
