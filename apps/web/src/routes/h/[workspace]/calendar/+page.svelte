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

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fetchJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { resolveSelectionIds } from '$lib/selection-filter';
  import { useSelection } from '$lib/stores/selection.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { addDaysIso, addMonths, dayKeyInTz, monthGrid } from '$lib/calendar';
  import {
    performanceStatusLabel,
    performanceStatusTone,
    type PerformanceCreate,
  } from '$lib/performance';

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

  let resolved = $derived(resolveSelectionIds(selection, projectsBySlug, workspacesBySlug));
  let filterIds = $derived({
    projectIds: resolved.projectIds,
    workspaceIds: resolved.workspaceIds,
  });
  let selectionUnresolved = $derived(resolved.unresolved);

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

  // ── New performance (ADR-043) ───────────────────────────────────────────
  const queryClient = useQueryClient();

  let createOpen = $state(false);
  let cProject = $state('');
  let cDay = $state('');
  let cVenue = $state('');
  let cCity = $state('');
  let cStatus = $state('proposed');

  const CREATE_STATUSES = ['proposed', 'hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed'];
  let statusOptions = $derived(
    CREATE_STATUSES.map((s) => ({ value: s, label: performanceStatusLabel(s) })),
  );
  let projectOptions = $derived(
    ($projectsQuery.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
  );

  function openCreate(dayIso?: string) {
    cDay = dayIso ?? todayIso;
    // Pre-select when the sidebar filter collapses to one project.
    if (!cProject) {
      const selected = [...selection.effectiveProjects()];
      if (selected.length === 1) {
        cProject = projectsBySlug.get(selected[0])?.id ?? '';
      } else if (projectOptions.length === 1) {
        cProject = projectOptions[0].value;
      }
    }
    createOpen = true;
  }

  const createMutationQ = createMutation({
    mutationFn: async (input: PerformanceCreate) => {
      const res = await fetch('/api/performances', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('hour_jwt')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      const body = (await res.json().catch(() => ({}))) as {
        performance?: { slug: string | null; workspace_id: string };
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.performance) {
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }
      return body.performance;
    },
    onSuccess: async (perf) => {
      createOpen = false;
      cVenue = '';
      cCity = '';
      void queryClient.invalidateQueries({ queryKey: ['calendar-performances'] });
      const ws = workspaceSlugById.get(perf.workspace_id) ?? page.params.workspace;
      if (perf.slug) await goto(`/h/${ws}/performance/${perf.slug}`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not created',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
  });

  function submitCreate() {
    if (!cProject) {
      addToast({ tone: 'warning', message: 'Pick a project.' });
      return;
    }
    if (!cDay) {
      addToast({ tone: 'warning', message: 'Pick a date.' });
      return;
    }
    $createMutationQ.mutate({
      project_id: cProject,
      performed_at: cDay,
      venue_name: cVenue.trim() || null,
      city: cCity.trim() || null,
      status: cStatus as PerformanceCreate['status'],
    });
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
        <Button size="s" onclick={() => openCreate()}>New performance</Button>
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
            <span class="cal__day-head">
              <span class="cal__day-num">{Number(day.iso.slice(8, 10))}</span>
              <button
                type="button"
                class="cal__day-add"
                aria-label={`New performance on ${day.iso}`}
                onclick={() => openCreate(day.iso)}
              >+</button>
            </span>
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

<Dialog bind:open={createOpen} title="New performance" size="s">
  <div class="cal__form">
    <Select
      label="Project"
      placeholder="Pick a project…"
      options={projectOptions}
      bind:value={cProject}
      required
    />
    <Input label="Date" type="date" bind:value={cDay} required />
    <Input label="Venue" bind:value={cVenue} placeholder="Venue name (optional)" />
    <Input label="City" bind:value={cCity} placeholder="City (optional)" />
    <Select label="Status" options={statusOptions} bind:value={cStatus} />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
    <Button onclick={submitCreate} loading={$createMutationQ.isPending}>Create</Button>
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

    .cal__day-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Quiet add affordance — visible on cell hover (and on focus). */
    .cal__day-add {
      opacity: 0;
      font-family: var(--font-mono);
      font-size: var(--text-s);
      line-height: 1;
      color: var(--text-faint);
      padding: 0 var(--space-2xs);
      transition: opacity var(--transition), color var(--transition);
    }
    .cal__day:hover .cal__day-add,
    .cal__day-add:focus-visible {
      opacity: 1;
    }
    .cal__day-add:hover {
      color: var(--text-color);
    }

    .cal__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
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
