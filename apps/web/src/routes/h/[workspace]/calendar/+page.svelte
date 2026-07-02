<script lang="ts">
  /**
   * Calendar lens — Phase 0.2. Month grid over the two event sources:
   * `performance` (performed_at, day-level truth) and `date` (rehearsals,
   * travel days, residencies, press — timestamptz, bucketed into the
   * viewer's day; all-day rows keep their stored date).
   *
   * The sidebar selection is the filter (ADR-038): events come from the
   * union of selected workspaces/projects, or everything RLS allows when
   * nothing is selected (same contract as LineList — the [workspace] URL
   * segment is browsing context, not a filter, per ADR-039). While a
   * selection exists but its slugs haven't resolved to ids yet (caches
   * loading, or a parked project), the feed stays disabled rather than
   * silently fetching unfiltered.
   *
   * Desktop-first (mobile polish lands in Phase 0.4 with the rest of the
   * lens set).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { page } from '$app/state';
  import { fetchJSON } from '$lib/api';
  import { useSelection } from '$lib/stores/selection.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { addDaysIso, addMonths, dayKeyInTz, monthGrid } from '$lib/calendar';
  import { performanceStatusTone } from '$lib/performance';

  type WorkspaceLite = { id: string; slug: string; name: string };
  type ProjectLite = {
    id: string;
    slug: string;
    name: string;
    accent?: string | null;
    workspace_id: string;
  };

  type PerformanceEvent = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    venue_name: string | null;
    city: string | null;
    project: ProjectLite | null;
    venue: { name: string; city: string | null } | null;
  };

  type DateEvent = {
    id: string;
    kind: string;
    status: string;
    title: string | null;
    starts_at: string;
    all_day: boolean;
    venue_name: string | null;
    city: string | null;
    project: ProjectLite | null;
  };

  const selection = useSelection();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  let ym = $state({ year: now.getFullYear(), month: now.getMonth() + 1 });
  let todayIso = dayKeyInTz(now.toISOString(), viewerTz);

  let weeks = $derived(monthGrid(ym.year, ym.month));
  let gridFrom = $derived(weeks[0][0].iso);
  let gridTo = $derived(weeks[weeks.length - 1][6].iso);

  // ── Selection → ids (LineList pattern: resolve against shared caches) ──
  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });
  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectLite[] }>('/api/projects?status=active', signal),
  });

  let workspacesBySlug = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.slug, w])),
  );
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let projectsBySlug = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.slug, p])),
  );

  let filterIds = $derived.by(() => {
    const projectIds: string[] = [];
    const workspaceIds: string[] = [];
    for (const slug of selection.effectiveProjects()) {
      const p = projectsBySlug.get(slug);
      if (p) projectIds.push(p.id);
    }
    for (const slug of selection.effectiveWorkspaces()) {
      const w = workspacesBySlug.get(slug);
      if (w) workspaceIds.push(w.id);
    }
    return { projectIds: projectIds.sort(), workspaceIds: workspaceIds.sort() };
  });

  // A selection that resolves to zero ids must NOT fall through to the
  // unfiltered everything-feed — hold the queries until it resolves.
  let selectionUnresolved = $derived(
    selection.hasAnySelection() &&
      filterIds.projectIds.length === 0 &&
      filterIds.workspaceIds.length === 0,
  );

  // ── Event feeds ──────────────────────────────────────────────────────
  const feedKey = toStore(() => ({
    from: gridFrom,
    to: gridTo,
    unresolved: selectionUnresolved,
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

  let performancesByDay = $derived.by(() => {
    const map = new Map<string, PerformanceEvent[]>();
    for (const p of $perfQuery.data?.items ?? []) {
      const key = p.performed_at.slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return map;
  });

  let datesByDay = $derived.by(() => {
    const map = new Map<string, DateEvent[]>();
    for (const d of $datesQuery.data?.items ?? []) {
      // All-day rows are calendar dates, not instants — keep the stored day.
      const key = d.all_day ? d.starts_at.slice(0, 10) : dayKeyInTz(d.starts_at, viewerTz);
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return map;
  });

  // Count what lands on visible cells (the padded dates window can fetch
  // an off-grid event or two).
  let monthEventCount = $derived.by(() => {
    let n = 0;
    for (const week of weeks) {
      for (const day of week) {
        n +=
          (performancesByDay.get(day.iso)?.length ?? 0) +
          (datesByDay.get(day.iso)?.length ?? 0);
      }
    }
    return n;
  });

  let monthLabel = $derived(
    new Date(Date.UTC(ym.year, ym.month - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
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

  function perfHref(p: PerformanceEvent): string | null {
    if (!p.slug || !p.project) return null;
    const ws = workspaceSlugById.get(p.project.workspace_id) ?? page.params.workspace;
    return `/h/${ws}/performance/${p.slug}`;
  }

  function perfLabel(p: PerformanceEvent): string {
    return p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  }

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
        <button class="btn--outline btn--s" onclick={prevMonth} aria-label="Previous month">←</button>
        <button class="btn--outline btn--s" onclick={thisMonth}>Today</button>
        <button class="btn--outline btn--s" onclick={nextMonth} aria-label="Next month">→</button>
      </div>
    </div>
    {#if !loading && !errorMsg}
      <p class="cal__count">
        {monthEventCount === 1 ? '1 event' : `${monthEventCount} events`}
        {#if selection.hasAnySelection()}in current filter{/if}
      </p>
    {/if}
  </header>

  {#if errorMsg}
    <p class="cal__state cal__state--danger">{errorMsg}</p>
  {:else}
    <div class="cal__grid" class:cal__grid--loading={loading} aria-label={monthLabel}>
      {#each WEEKDAYS as wd (wd)}
        <div class="cal__weekday">{wd}</div>
      {/each}
      {#each weeks as week, wi (wi)}
        {#each week as day (day.iso)}
          {@const perfs = performancesByDay.get(day.iso) ?? []}
          {@const dates = datesByDay.get(day.iso) ?? []}
          <div
            class="cal__day"
            class:cal__day--out={!day.inMonth}
            class:cal__day--today={day.iso === todayIso}
          >
            <span class="cal__day-num">{Number(day.iso.slice(8, 10))}</span>
            {#each perfs as p (p.id)}
              {@const href = perfHref(p)}
              {#if href}
                <a
                  class="cal__event cal__event--perf"
                  data-tone={performanceStatusTone(p.status)}
                  style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
                  {href}
                  title={`${perfLabel(p)} — ${p.status}`}
                >
                  <span class="cal__event-dot" aria-hidden="true"></span>
                  {perfLabel(p)}
                </a>
              {:else}
                <span
                  class="cal__event cal__event--perf"
                  data-tone={performanceStatusTone(p.status)}
                  title={`${perfLabel(p)} — ${p.status}`}
                >
                  <span class="cal__event-dot" aria-hidden="true"></span>
                  {perfLabel(p)}
                </span>
              {/if}
            {/each}
            {#each dates as d (d.id)}
              <span
                class="cal__event cal__event--date"
                style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
                title={d.title ?? d.kind.replace(/_/g, ' ')}
              >
                {d.title ?? d.kind.replace(/_/g, ' ')}
              </span>
            {/each}
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</section>

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

    .cal__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .cal__state--danger {
      color: var(--danger);
    }

    .cal__grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-l);
      overflow: hidden;
      background: var(--border-color-light);
      gap: 1px;
      transition: opacity var(--transition);
    }

    .cal__grid--loading {
      opacity: 0.6;
    }

    .cal__weekday {
      background: var(--bg-light);
      padding: var(--space-xs) var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .cal__day {
      background: var(--bg);
      min-block-size: 6.5rem;
      padding: var(--space-xs);
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }

    .cal__day--out {
      background: var(--bg-light);
    }
    .cal__day--out .cal__day-num {
      color: var(--text-faint);
    }

    .cal__day--today .cal__day-num {
      color: var(--bg);
      background: var(--text-color);
      border-radius: var(--radius-circle);
      inline-size: 1.5rem;
      block-size: 1.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .cal__day-num {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    /* Event chip. Project accent on the left rail (--c), status tone on
       the dot (--state-color via the base.css data-tone contract). */
    .cal__event {
      display: flex;
      align-items: center;
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      line-height: 1.3;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-s);
      border-inline-start: 2px solid var(--c, var(--border-color-dark));
      background: var(--bg-ultra-light);
      color: var(--text-color);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    a.cal__event:hover {
      background: var(--bg-hover, var(--bg-light));
    }

    .cal__event--date {
      color: var(--text-muted);
      font-style: italic;
    }

    .cal__event-dot {
      inline-size: 6px;
      block-size: 6px;
      border-radius: var(--radius-circle);
      flex-shrink: 0;
      background: var(--state-color, var(--text-faint));
    }
  }
</style>
