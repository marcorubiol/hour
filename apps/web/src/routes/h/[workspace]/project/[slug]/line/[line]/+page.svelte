<script lang="ts">
  /**
   * Line detail — /h/[workspace]/project/[slug]/line/[line]/
   *
   * ADR-056: the page is a COMPOSITION OF MODULES — an ordered stack where
   * each module is a line-scoped view of an existing entity/lens, never a
   * data silo. `line.modules` (jsonb array) drives the stack; NULL falls
   * back to kind defaults ($lib/line-templates). The stack is editable in
   * place: per-module overflow menu (move/remove) + a quiet "Add module"
   * at the end — composition yes, schema no (the Airtable guardrail).
   *
   * Header: name + kind metadata + per-kind stats (booking kinds get the
   * funnel + overdue actions; tour kinds get next gig / confirmed / €
   * pipeline). Anchor chips under the header jump to each module.
   *
   * Data: projects → lines two-step against ['lines', { project_id }]
   * (cache shared with creation invalidations via the ['lines'] prefix).
   * The route param matches slug OR id — lines created before the slug
   * backfill are id-addressed (lineUrl falls back to id).
   */

  import { page } from '$app/state';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { lineKindGlyph, lineKindLabel } from '$lib/utils/line-kind';
  import {
    MODULE_KEYS,
    MODULE_LABELS,
    MODULE_DESCRIPTIONS,
    modulesForLine,
    type ModuleKey,
  } from '$lib/line-templates';
  import CalendarModule from '$lib/components/line/CalendarModule.svelte';
  import ContactsModule from '$lib/components/line/ContactsModule.svelte';
  import RoadsheetsModule from '$lib/components/line/RoadsheetsModule.svelte';
  import NotesModule from '$lib/components/line/NotesModule.svelte';
  import MaterialsModule from '$lib/components/line/MaterialsModule.svelte';
  import MoneyModule from '$lib/components/line/MoneyModule.svelte';
  import PeopleModule from '$lib/components/line/PeopleModule.svelte';

  type Project = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  type Line = {
    id: string;
    slug: string | null;
    name: string;
    kind: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    modules: ModuleKey[] | null;
    project_id: string;
    workspace_id: string;
  };

  const queryClient = useQueryClient();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let projectSlug = $derived(page.params.slug ?? '');
  let lineParam = $derived(page.params.line ?? '');

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Project[] }>('/api/projects?status=active', signal),
  });

  let activeProject = $derived(
    $projectsQuery.data?.items.find((p) => p.slug === projectSlug) ?? null,
  );

  const linesOptions = toStore(() => {
    const projectId = activeProject?.id ?? null;
    return {
      queryKey: ['lines', { project_id: projectId }] as const,
      enabled: projectId !== null,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: Line[] }>(
          `/api/lines?project_id=${encodeURIComponent(projectId!)}`,
          signal,
        ),
    };
  });
  const linesQuery = createQuery(linesOptions);

  // Slug OR id: lines created before the create_line slug fix are
  // id-addressed (nav falls back to the uuid).
  let activeLine = $derived(
    $linesQuery.data?.items.find((l) => l.slug === lineParam || l.id === lineParam) ?? null,
  );

  // ── Module stack ──────────────────────────────────────────────────────
  // Optimistic local override so add/move/remove feel instant; the PATCH
  // invalidation refreshes the cache underneath.
  let localModules = $state<ModuleKey[] | null>(null);
  let lastLineId = $state('');
  $effect(() => {
    if (activeLine && activeLine.id !== lastLineId) {
      lastLineId = activeLine.id;
      localModules = null;
    }
  });
  let stack = $derived.by<ModuleKey[]>(() => {
    if (!activeLine) return [];
    return localModules ?? modulesForLine(activeLine);
  });
  let missingModules = $derived(MODULE_KEYS.filter((k) => !stack.includes(k)));

  const REGISTRY = {
    calendar: CalendarModule,
    contacts: ContactsModule,
    roadsheets: RoadsheetsModule,
    notes: NotesModule,
    materials: MaterialsModule,
    money: MoneyModule,
    people: PeopleModule,
  } as const;

  const modulesMutation = createMutation({
    mutationFn: ({ id, modules }: { id: string; modules: ModuleKey[] }) =>
      mutateJSON('PATCH', `/api/lines/${id}`, { modules }),
    onError: (err) => {
      localModules = null;
      addToast({
        tone: 'danger',
        title: 'Could not save modules',
        message: err instanceof ApiError ? err.message : String(err),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['lines'] });
    },
  });

  function saveStack(next: ModuleKey[]) {
    if (!activeLine) return;
    localModules = next;
    $modulesMutation.mutate({ id: activeLine.id, modules: next });
  }
  function addModule(key: ModuleKey) {
    saveStack([...stack, key]);
  }
  function removeModule(key: ModuleKey) {
    saveStack(stack.filter((k) => k !== key));
  }
  function moveModule(key: ModuleKey, dir: -1 | 1) {
    const i = stack.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stack.length) return;
    const next = [...stack];
    [next[i], next[j]] = [next[j], next[i]];
    saveStack(next);
  }

  // ── Per-kind header stats (shared query keys with the modules) ────────
  const BOOKING_KINDS = new Set(['campaign', 'comms']);
  const TOUR_KINDS = new Set(['tour', 'season', 'circuit', 'residency']);
  let isBooking = $derived(activeLine !== null && BOOKING_KINDS.has(activeLine.kind));
  let isTour = $derived(activeLine !== null && TOUR_KINDS.has(activeLine.kind));

  type EngStats = { total: number; overdue: number; holds: number; confirmed: number };
  const engStatsOptions = toStore(() => {
    const id = activeLine?.id ?? null;
    return {
      queryKey: ['line-eng-stats', id] as const,
      enabled: id !== null && isBooking,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<EngStats> => {
        const base = `/api/engagements?line_id=${id}`;
        const [all, confirmed, holds] = await Promise.all([
          fetchJSON<{ total: number; items: { next_action_at: string | null }[] }>(
            `${base}&status=any&limit=100`,
            signal,
          ),
          fetchJSON<{ total: number }>(`${base}&status=confirmed&limit=1`, signal),
          fetchJSON<{ total: number }>(`${base}&status=hold&limit=1`, signal),
        ]);
        const now = Date.now();
        const overdue = all.items.filter(
          (e) => e.next_action_at && new Date(e.next_action_at).getTime() < now,
        ).length;
        return { total: all.total, overdue, confirmed: confirmed.total, holds: holds.total };
      },
    };
  });
  const engStatsQuery = createQuery(engStatsOptions);

  type LinePerf = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    venue_name: string | null;
    city: string | null;
    venue: { name: string; city: string | null } | null;
  };
  const perfStatsOptions = toStore(() => {
    const id = activeLine?.id ?? null;
    return {
      queryKey: ['line-performances', id] as const,
      enabled: id !== null && isTour,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: LinePerf[] }>(
          `/api/performances?line_id=${id}&status=any&limit=200`,
          signal,
        ),
    };
  });
  const perfStatsQuery = createQuery(perfStatsOptions);

  type LineFee = { fee_amount: number | null; status: string };
  const feeStatsOptions = toStore(() => {
    const id = activeLine?.id ?? null;
    return {
      queryKey: ['line-money-fees', id] as const,
      enabled: id !== null && isTour,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: LineFee[] }>(
          `/api/money/performances?line_ids=${id}&limit=500`,
          signal,
        ),
    };
  });
  const feeStatsQuery = createQuery(feeStatsOptions);

  let tourStats = $derived.by(() => {
    const perfs = $perfStatsQuery.data?.items ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = perfs.filter((p) => p.performed_at >= today && p.status !== 'cancelled');
    const next = upcoming[0] ?? null;
    const confirmed = perfs.filter((p) =>
      ['confirmed', 'done', 'invoiced', 'paid'].includes(p.status),
    ).length;
    const holds = perfs.filter((p) => p.status.startsWith('hold')).length;
    const fees = $feeStatsQuery.data?.items ?? [];
    const withFee = fees.filter((f) => f.fee_amount !== null);
    const pipeline = withFee
      .filter((f) => ['confirmed', 'done'].includes(f.status))
      .reduce((sum, f) => sum + (f.fee_amount ?? 0), 0);
    return { next, confirmed, holds, pipeline, hasFees: withFee.length > 0 };
  });

  const numFmt = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  function fmtDay(iso: string): string {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  }

  // ── Visit touch (last_navigated_at ordering) ──────────────────────────
  let lastTouchedLineId = '';
  $effect(() => {
    const id = activeLine?.id;
    if (!id || id === lastTouchedLineId) return;
    lastTouchedLineId = id;
    void touchLineVisit(id);
  });
  async function touchLineVisit(id: string): Promise<void> {
    try {
      await mutateJSON('POST', '/api/lines/visit', { line_id: id });
    } catch (err) {
      console.warn('[line-detail] touch_line_visit failed:', err);
    }
  }

  let isLoading = $derived(
    $projectsQuery.isPending || ($linesQuery.isPending && activeProject !== null),
  );
  let isError = $derived($projectsQuery.isError || $linesQuery.isError);
  let notFound = $derived(
    !isLoading && !isError && activeProject !== null && activeLine === null,
  );

  function formatDateRange(start: string | null, end: string | null): string {
    if (!start && !end) return '';
    const fmt = (iso: string) =>
      new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    if (start && end) return `${fmt(start)} → ${fmt(end)}`;
    if (start) return `From ${fmt(start)}`;
    return `Until ${fmt(end!)}`;
  }
</script>

<svelte:head>
  <title>
    {activeLine ? `${activeLine.name} · ${activeProject?.name ?? ''}` : 'Line'}
  </title>
</svelte:head>

<article class="line-detail">
  {#if isLoading}
    <p class="line-detail__state">Loading…</p>
  {:else if isError}
    <p class="line-detail__state line-detail__state--danger">
      Couldn't load line.
    </p>
  {:else if notFound}
    <div class="line-detail__missing">
      <p class="eyebrow">Line</p>
      <h1 class="line-detail__missing-title">{lineParam}</h1>
      <p class="line-detail__state">
        This line doesn't exist in {activeProject?.name ?? 'this project'}.
      </p>
      <a
        class="line-detail__back"
        href={`/h/${workspaceSlug}/project/${projectSlug}/`}
      >
        ← Back to {activeProject?.name ?? 'project'}
      </a>
    </div>
  {:else if activeLine}
    <header class="line-detail__header">
      <p class="eyebrow">Line</p>
      <h1 class="line-detail__title">{activeLine.name}</h1>
      <p class="line-detail__meta">
        <span class="line-detail__kind">
          {lineKindGlyph(activeLine.kind)} {lineKindLabel(activeLine.kind)}
        </span>
        <span class="line-detail__sep">·</span>
        <StateBadge label={activeLine.status} />
        {#if formatDateRange(activeLine.start_date, activeLine.end_date)}
          <span class="line-detail__sep">·</span>
          <span class="line-detail__dates">
            {formatDateRange(activeLine.start_date, activeLine.end_date)}
          </span>
        {/if}
        <span class="line-detail__sep">·</span>
        <a
          class="line-detail__project-link"
          href={`/h/${workspaceSlug}/project/${projectSlug}/`}
        >
          in {activeProject?.name ?? projectSlug}
        </a>
      </p>

      {#if isBooking && $engStatsQuery.data}
        {@const st = $engStatsQuery.data}
        <p class="line-detail__stats">
          <span class="line-detail__stat"><b>{st.total}</b> conversations</span>
          <span class="line-detail__stat"><b>{st.holds}</b> holds</span>
          <span class="line-detail__stat"><b>{st.confirmed}</b> confirmed</span>
          {#if st.overdue > 0}
            <span class="line-detail__stat line-detail__stat--danger"><b>{st.overdue}</b> overdue</span>
          {/if}
        </p>
      {:else if isTour && $perfStatsQuery.data}
        {@const st = tourStats}
        <p class="line-detail__stats">
          {#if st.next}
            <span class="line-detail__stat">
              next <b>{fmtDay(st.next.performed_at)}</b>
              {st.next.venue?.name ?? st.next.venue_name ?? ''}
            </span>
          {/if}
          <span class="line-detail__stat"><b>{st.confirmed}</b> confirmed</span>
          <span class="line-detail__stat"><b>{st.holds}</b> holds</span>
          {#if st.hasFees && st.pipeline > 0}
            <span class="line-detail__stat"><b>{numFmt.format(st.pipeline)}</b> pipeline</span>
          {/if}
        </p>
      {/if}
    </header>

    {#if stack.length > 1}
      <nav class="line-detail__chips" aria-label="Modules">
        {#each stack as key (key)}
          <a class="line-detail__chip" href={`#mod-${key}`}>{MODULE_LABELS[key]}</a>
        {/each}
      </nav>
    {/if}

    <div class="line-detail__stack">
      {#each stack as key (key)}
        {@const Module = REGISTRY[key]}
        <section class="line-detail__module" id={`mod-${key}`}>
          <header class="line-detail__module-head">
            <p class="eyebrow">{MODULE_LABELS[key]}</p>
            <Menu direction="down" align="end" label={`Module actions — ${MODULE_LABELS[key]}`}>
              {#snippet trigger()}
                <span class="line-detail__module-kebab" aria-hidden="true">⋯</span>
              {/snippet}
              {#snippet children({ close }: { close: (focus?: boolean) => void })}
                <li role="none">
                  <button type="button" role="menuitem" class="menu__item" onclick={() => { close(false); moveModule(key, -1); }}>
                    Move up
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" class="menu__item" onclick={() => { close(false); moveModule(key, 1); }}>
                    Move down
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" class="menu__item menu__item--danger" onclick={() => { close(false); removeModule(key); }}>
                    Remove module
                  </button>
                </li>
              {/snippet}
            </Menu>
          </header>
          <Module line={activeLine} {workspaceSlug} />
        </section>
      {/each}
    </div>

    {#if missingModules.length > 0}
      <div class="line-detail__addwrap">
        <Menu direction="up" align="start" label="Add module">
          {#snippet trigger()}
            <span class="line-detail__add">+ Add module</span>
          {/snippet}
          {#snippet children({ close }: { close: (focus?: boolean) => void })}
            {#each missingModules as key (key)}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  class="menu__item line-detail__add-item"
                  onclick={() => { close(false); addModule(key); }}
                >
                  <span class="line-detail__add-name">{MODULE_LABELS[key]}</span>
                  <span class="line-detail__add-desc">{MODULE_DESCRIPTIONS[key]}</span>
                </button>
              </li>
            {/each}
          {/snippet}
        </Menu>
      </div>
    {/if}
  {/if}
</article>

<style>
  @layer components {
    .line-detail {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      padding-block: var(--space-l);
      padding-inline: var(--space-m);
      max-inline-size: 64rem;
      margin-inline: auto;
    }

    .line-detail__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .line-detail__title {
      font-family: var(--font-display);
      font-size: var(--text-2xl, var(--text-xl));
      font-weight: 400;
      letter-spacing: -0.02em;
      margin: 0;
      color: var(--text-color);
    }

    .line-detail__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .line-detail__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      text-transform: lowercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .line-detail__sep {
      color: var(--text-faint);
    }

    .line-detail__dates {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .line-detail__project-link {
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition);
    }
    .line-detail__project-link:hover {
      color: var(--text-color);
    }

    .line-detail__stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-m);
      margin: 0;
      margin-block-start: var(--space-xs);
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .line-detail__stat b {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      color: var(--text-color);
    }
    .line-detail__stat--danger,
    .line-detail__stat--danger b {
      color: var(--danger);
    }

    /* Anchor chips — sticky under the shell top bar. The inset clears the
       bar's content-driven height; module sections carry scroll-margin so
       #hash jumps land below both. */
    .line-detail__chips {
      position: sticky;
      inset-block-start: 3.4rem;
      z-index: calc(var(--z-sticky) - 10);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      padding-block: var(--space-xs);
      background: color-mix(in oklch, var(--bg) 92%, transparent);
      backdrop-filter: blur(6px);
    }
    .line-detail__chip {
      padding-block: var(--space-2xs);
      padding-inline: var(--space-s);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-circle);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition), border-color var(--transition);
    }
    .line-detail__chip:hover {
      color: var(--text-color);
      border-color: var(--border-color-dark);
    }

    .line-detail__stack {
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
    }

    .line-detail__module {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      scroll-margin-block-start: 6.5rem;
    }

    .line-detail__module-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      border-block-end: 1px solid var(--border-color-light);
      padding-block-end: var(--space-xs);
    }
    .line-detail__module-head .eyebrow {
      margin: 0;
    }
    .line-detail__module-kebab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: var(--control-size-s);
      block-size: var(--control-size-s);
      border-radius: var(--radius-s);
      color: var(--text-faint);
      font-size: var(--text-m);
      line-height: 1;
    }
    .line-detail__module-kebab:hover {
      color: var(--text-color);
      background: var(--bg-light);
    }

    .line-detail__addwrap {
      display: flex;
    }
    .line-detail__add {
      display: inline-flex;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border: 1px dashed var(--border-color-light);
      border-radius: var(--radius-m);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      cursor: pointer;
      transition: color var(--transition), border-color var(--transition);
    }
    .line-detail__add:hover {
      color: var(--text-color);
      border-color: var(--border-color-dark);
    }
    .line-detail__add-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
    }
    .line-detail__add-name {
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .line-detail__add-desc {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .line-detail__missing {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .line-detail__missing-title {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-weight: 400;
      margin: 0;
      color: var(--text-faint);
    }

    .line-detail__back {
      align-self: flex-start;
      color: var(--text-muted);
      text-decoration: none;
      font-size: var(--text-s);
      transition: color var(--transition);
    }
    .line-detail__back:hover {
      color: var(--text-color);
    }

    .line-detail__state {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .line-detail__state--danger {
      color: var(--danger);
    }
  }
</style>
