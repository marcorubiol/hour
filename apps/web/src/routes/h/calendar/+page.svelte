<script lang="ts">
  /**
   * Calendar lens — Phase 0.2. Month grid over the two event sources:
   * `performance` (performed_at, day-level truth) and `date` (rehearsals,
   * travel days, residencies, press — timestamptz, bucketed into the
   * viewer's day; all-day rows keep their stored date).
   *
   * PINS are the filter (ADR-057; projects ADR-060): events come from the
   * union of pinned spaces/projects/lines, or everything RLS allows when
   * nothing is pinned (the [workspace] URL segment is browsing context,
   * not a filter, per ADR-039). While pins exist but haven't resolved to
   * ids yet (caches loading), the feed stays disabled rather than silently
   * fetching unfiltered.
   *
   * The page owns the feeds, the pins scoping, and the Feed/ICS dialog;
   * MonthGrid renders the grid, PerformanceCreateDialog owns creation.
   *
   * Desktop-first (mobile polish lands in Phase 0.4 with the rest of the
   * lens set).
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import MonthGrid, {
    dateDayKey,
    formatMonthLabel,
    perfDayKey,
    type DateEvent,
    type PerformanceEvent,
  } from '$lib/components/MonthGrid.svelte';
  import PerformanceCreateDialog, {
    type CreatedPerformance,
  } from '$lib/components/PerformanceCreateDialog.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    lineUrl,
    projectUrl,
    type NavLine,
    type NavProject,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { addDaysIso, addMonths, dayKeyInTz, monthGrid } from '$lib/calendar';

  type WorkspaceLite = { id: string; slug: string; name: string };

  const pins = usePins();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  let ym = $state({ year: now.getFullYear(), month: now.getMonth() + 1 });
  let todayIso = dayKeyInTz(now.toISOString(), viewerTz);

  let weeks = $derived(monthGrid(ym.year, ym.month));
  let gridFrom = $derived(weeks[0][0].iso);
  let gridTo = $derived(weeks[weeks.length - 1][6].iso);

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

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function openProject(project: NavProject) {
    void goto(projectUrl(project));
  }

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
      queryKey: ['calendar-performances', k] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: PerformanceEvent[] }>(
          `/api/performances?status=any&${feedParams(k, k.from, k.to)}`,
          signal,
        ),
    };
  });
  // The dates window is padded ±1 day: `date` rows are timestamptz and get
  // bucketed into the viewer's day, which can fall outside the UTC-bounded
  // fetch window at the grid edges. Off-grid buckets simply find no cell.
  const datesOptions = toStore(() => {
    const k = $feedKey;
    return {
      queryKey: ['calendar-dates', k] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: DateEvent[] }>(
          `/api/dates?${feedParams(k, addDaysIso(k.from, -1), addDaysIso(k.to, 1))}`,
          signal,
        ),
    };
  });

  const perfQuery = createQuery(perfOptions);
  const datesQuery = createQuery(datesOptions);

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
  // which admits the whole project. Dates carry no line_id, so project and
  // line pins both show their project's dates.
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

  // Count what lands on visible cells (the padded dates window can fetch
  // an off-grid event or two). The grid is the contiguous ISO-day range
  // gridFrom..gridTo, so "has a cell" === bucket key within that range.
  let monthEventCount = $derived.by(() => {
    let n = 0;
    for (const p of scopedPerfs) {
      const key = perfDayKey(p);
      if (key >= gridFrom && key <= gridTo) n++;
    }
    for (const d of scopedDates) {
      const key = dateDayKey(d, viewerTz);
      if (key >= gridFrom && key <= gridTo) n++;
    }
    return n;
  });

  let monthLabel = $derived(formatMonthLabel(ym.year, ym.month));

  function prevMonth() {
    ym = addMonths(ym.year, ym.month, -1);
  }
  function nextMonth() {
    ym = addMonths(ym.year, ym.month, 1);
  }
  function thisMonth() {
    ym = { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  // ── New performance (ADR-043) ───────────────────────────────────────────
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

  // ── Calendar feed links (ADR-054) ────────────────────────────────────
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
    <p class="eyebrow">Calendar</p>
    <div class="cal__nav">
      <h1 class="cal__month">{monthLabel}</h1>
      <div class="cal__nav-buttons">
        <Button variant="outline" size="s" onclick={prevMonth} label="Previous month">←</Button>
        <Button variant="outline" size="s" onclick={thisMonth}>Today</Button>
        <Button variant="outline" size="s" onclick={nextMonth} label="Next month">→</Button>
        <Button variant="outline" size="s" onclick={openFeed}>Feed</Button>
        <Button size="s" onclick={() => openCreate()}>New performance</Button>
      </div>
    </div>
    {#if !loading && !errorMsg}
      <p class="cal__count">
        {monthEventCount === 1 ? '1 event' : `${monthEventCount} events`}
        {#if !scope.isEmpty}in current pins{/if}
      </p>
    {/if}
  </header>

  {#if errorMsg}
    <p class="cal__state cal__state--danger">{errorMsg}</p>
  {:else}
    <MonthGrid
      year={ym.year}
      month={ym.month}
      performances={scopedPerfs}
      dates={scopedDates}
      workspaceSlug={defaultWorkspaceSlug}
      {loading}
      onDayCreate={(iso) => openCreate(iso)}
    />
  {/if}
</section>

<PerformanceCreateDialog
  bind:open={createOpen}
  {presetProjectId}
  {presetLineId}
  presetDate={createDate}
  onCreated={handleCreated}
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

    .cal__nav {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-m);
      flex-wrap: wrap;
    }

    .cal__month {
      font-family: var(--font-display);
      font-size: clamp(1.6rem, 2.5vw, 2.1rem);
      font-weight: 400;
      letter-spacing: -0.02em;
      color: var(--text-color);
    }

    .cal__nav-buttons {
      display: flex;
      gap: var(--space-xs);
    }

    .cal__count {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
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
