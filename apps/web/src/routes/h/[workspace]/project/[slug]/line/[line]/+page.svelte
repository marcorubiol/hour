<script lang="ts">
  /**
   * Line detail — /h/[workspace]/project/[slug]/line/[line]/
   *
   * ADR-056: the page is a STACK OF MODULES, each a line-scoped view of an
   * existing entity/lens, never a data silo. ADR-162: the stack is the
   * line's KIND's, in a fixed order (`modulesForKind`, $lib/line-templates).
   * Nobody adds, removes or moves a module; `line.modules` is not read.
   * ADR-145 § 1 on the stack: a module that is only a reading (Road sheets,
   * a projection of the line's performances) is not drawn while empty; one
   * where something is written keeps its empty line, the gap is the place.
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

  import { docTitle } from '$lib/doc-title';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { lineKindGlyph, lineKindLabel } from '$lib/utils/line-kind';
  import { accentVar } from '$lib/utils/accent';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import MissingBand from '$lib/components/MissingBand.svelte';
  import { stepsDueBand, type StepsDueRow } from '$lib/steps-due-band';
  import { stepsDue } from '$lib/record-missing';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import { fmtMoneyCompact } from '$lib/money';
  import { dayMonth, dayMonthYear, localDayISO } from '$lib/datetime';
  import { moduleLabel, modulesForKind, type ModuleKey } from '$lib/line-templates';
  import { blockDrawn } from '$lib/dashboard-blocks';
  import { appLocale, t } from '$lib/i18n';
  import { workspacesQueryOptions, activeProjectsQueryOptions } from '$lib/nav-queries';
  import PlannerModule from '$lib/components/line/PlannerModule.svelte';
  import ConversationsModule from '$lib/components/line/ConversationsModule.svelte';
  import RoadsheetsModule from '$lib/components/line/RoadsheetsModule.svelte';
  import NotesModule from '$lib/components/line/NotesModule.svelte';
  import MaterialsModule from '$lib/components/line/MaterialsModule.svelte';
  import MoneyModule from '$lib/components/line/MoneyModule.svelte';
  import TeamModule from '$lib/components/line/TeamModule.svelte';
  import TasksModule from '$lib/components/line/TasksModule.svelte';

  type Line = {
    id: string;
    slug: string | null;
    name: string;
    kind: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    project_id: string;
    workspace_id: string;
  };

  const locale = appLocale();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let projectSlug = $derived(page.params.slug ?? '');
  let lineParam = $derived(page.params.line ?? '');

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());

  // Slug + workspace — project slugs are only unique per workspace
  // (ADR-024), so slug alone could resolve another space's project.
  let routeWorkspaceId = $derived(
    $workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.id ?? null,
  );
  let activeProject = $derived(
    routeWorkspaceId
      ? ($projectsQuery.data?.items.find(
          (p) => p.slug === projectSlug && p.workspace_id === routeWorkspaceId,
        ) ?? null)
      : null,
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

  // Address: Space › Project › Línea (the title names which).
  let crumbs = $derived<Crumb[]>([
    spaceCrumb($workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name, workspaceSlug),
    { label: activeProject?.name ?? projectSlug, href: `/h/${workspaceSlug}/project/${projectSlug}/` },
    { label: t('create.line', locale) },
  ]);

  // ── Module stack (ADR-162: the kind's, fixed) ─────────────────────────
  let kindStack = $derived<ModuleKey[]>(activeLine ? modulesForKind(activeLine.kind) : []);
  // Sibling lines of this project — "where am I among peers" (the same list
  // that drives the module stack query, so no extra fetch).
  let siblings = $derived($linesQuery.data?.items ?? []);

  const REGISTRY = {
    planner: PlannerModule,
    conversations: ConversationsModule,
    roadsheets: RoadsheetsModule,
    notes: NotesModule,
    materials: MaterialsModule,
    money: MoneyModule,
    team: TeamModule,
    tasks: TasksModule,
  } as const;

  // ── Per-kind header stats (shared query keys with the modules) ────────
  const BOOKING_KINDS = new Set(['campaign', 'comms']);
  const TOUR_KINDS = new Set(['tour', 'season', 'circuit', 'residency']);
  let isBooking = $derived(activeLine !== null && BOOKING_KINDS.has(activeLine.kind));
  let isTour = $derived(activeLine !== null && TOUR_KINDS.has(activeLine.kind));

  type EngStats = { total: number; holds: number; confirmed: number; items: StepsDueRow[] };
  const engStatsOptions = toStore(() => {
    const id = activeLine?.id ?? null;
    return {
      queryKey: ['line-eng-stats', id] as const,
      enabled: id !== null && isBooking,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<EngStats> => {
        const base = `/api/conversations?line_id=${id}`;
        const [all, confirmed, holds] = await Promise.all([
          fetchJSON<{ total: number; items: StepsDueRow[] }>(
            `${base}&status=any&limit=100`,
            signal,
          ),
          fetchJSON<{ total: number }>(`${base}&status=confirmed&limit=1`, signal),
          fetchJSON<{ total: number }>(`${base}&status=hold&limit=1`, signal),
        ]);
        return { total: all.total, confirmed: confirmed.total, holds: holds.total, items: all.items };
      },
    };
  });
  const engStatsQuery = createQuery(engStatsOptions);

  // «Falta» (ADR-139 § 2): the line's conversations whose next step is due,
  // read from the page the stats already fetch. The «overdue» figure counts
  // the same rule, so the strip and the figure never disagree.
  const today = localDayISO();
  let engRows = $derived($engStatsQuery.data?.items ?? []);
  let overdue = $derived(stepsDue(engRows, today).length);
  let missingItems = $derived(
    stepsDueBand(engRows, {
      today,
      total: $engStatsQuery.data?.total,
      workspaceSlug,
      moreHref: kindStack.includes('conversations') ? '#mod-conversations' : null,
      locale,
    }),
  );

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

  // ADR-145 § 1: Road sheets is only a reading (nothing is written there),
  // so with no performance it is not drawn. It sits only in tour kinds, the
  // ones that read `perfStatsQuery`, so it asks the same read.
  let stack = $derived<ModuleKey[]>(
    kindStack.filter(
      (key) =>
        key !== 'roadsheets' ||
        blockDrawn({
          count: $perfStatsQuery.data?.items.length ?? 0,
          loading: $perfStatsQuery.isPending,
          errored: $perfStatsQuery.isError,
        }),
    ),
  );

  type LineFee = { fee_amount: number | null; status: string };
  const feeStatsOptions = toStore(() => {
    const id = activeLine?.id ?? null;
    return {
      queryKey: ['line-money-fees', id] as const,
      enabled: id !== null && isTour,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: LineFee[] }>(
          `/api/money/bolos?line_ids=${id}&limit=500`,
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

  /* Line lifecycle → badge tone (open = alive, everything closed = faint). */
  const LINE_STATUS_TONE: Record<string, 'success' | 'faint'> = {
    open: 'success',
    closed: 'faint',
    archived: 'faint',
  };

  /** Line status in the viewer's language; an unknown value shows as itself. */
  function lineStatusLabel(status: string): string {
    if (status === 'open') return t('line.status_open', locale);
    if (status === 'closed') return t('line.status_closed', locale);
    if (status === 'archived') return t('line.status_archived', locale);
    return status;
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
  // Also notFound when the PROJECT itself doesn't resolve (unknown slug,
  // draft/archived project) — otherwise the page renders nothing at all
  // (review 2026-07-12).
  let notFound = $derived(
    !isLoading && !isError && (activeProject === null || activeLine === null),
  );

  function formatDateRange(start: string | null, end: string | null): string {
    if (!start && !end) return '';
    if (start && end) return `${dayMonthYear(start)} → ${dayMonthYear(end)}`;
    if (start) return t('line.from', locale, { date: dayMonthYear(start) });
    return t('line.until', locale, { date: dayMonthYear(end!) });
  }
</script>

<svelte:head>
  <title>{activeLine ? docTitle(activeLine.name, activeProject?.name) : docTitle(t('create.line', locale))}</title>
</svelte:head>

<article class="record line-detail" aria-busy={isLoading}>
  {#if isLoading}
    <EmptyLine text={t('desk.loading', locale)} busy />
  {:else if isError}
    <p class="load-fail" role="alert">{t('line.load_error', locale)}</p>
  {:else if notFound}
    <RecordHead {crumbs} title={lineParam} />
    <EmptyLine
      text={activeProject ? t('line.missing_in', locale, { name: activeProject.name }) : t('line.missing', locale)}
    >
      <a class="empty-line__act" href={`/h/${workspaceSlug}/project/${projectSlug}/`}
        >{activeProject ? t('line.back_to', locale, { name: activeProject.name }) : t('line.back_to_project', locale)}</a
      >
    </EmptyLine>
  {:else if activeLine}
    <RecordHead {crumbs} title={activeLine.name}>
      {#snippet facts()}
        <span class="line-detail__kind">{lineKindGlyph(activeLine!.kind)} {lineKindLabel(activeLine!.kind)}</span>
        <StateBadge label={lineStatusLabel(activeLine!.status)} tone={LINE_STATUS_TONE[activeLine!.status] ?? 'neutral'} />
        {#if formatDateRange(activeLine!.start_date, activeLine!.end_date)}
          <span>{formatDateRange(activeLine!.start_date, activeLine!.end_date)}</span>
        {/if}
      {/snippet}
      {#snippet band()}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    {#if isBooking && $engStatsQuery.data}
      {@const st = $engStatsQuery.data}
      <p class="line-detail__stats">
        <span class="line-detail__stat"><b class:figure--zero={st.total === 0}>{st.total}</b> {t('line.stat_conversations', locale)}</span>
        <span class="line-detail__stat"><b class:figure--zero={st.holds === 0}>{st.holds}</b> {t('line.stat_holds', locale)}</span>
        <span class="line-detail__stat"><b class:figure--zero={st.confirmed === 0}>{st.confirmed}</b> {t('line.stat_confirmed', locale)}</span>
        {#if overdue > 0}
          <span class="line-detail__stat line-detail__stat--danger"
            ><b>{overdue}</b> {t('line.stat_overdue', locale)}</span
          >
        {/if}
      </p>
    {:else if isTour && $perfStatsQuery.data}
      {@const st = tourStats}
      <p class="line-detail__stats">
        {#if st.next}
          <span class="line-detail__stat">
            {t('line.stat_next', locale)} <b>{dayMonth(st.next.performed_at)}</b>
            {st.next.venue?.name ?? st.next.venue_name ?? ''}
          </span>
        {/if}
        <span class="line-detail__stat"><b class:figure--zero={st.confirmed === 0}>{st.confirmed}</b> {t('line.stat_confirmed', locale)}</span>
        <span class="line-detail__stat"><b class:figure--zero={st.holds === 0}>{st.holds}</b> {t('line.stat_holds', locale)}</span>
        {#if st.hasFees && st.pipeline > 0}
          <span class="line-detail__stat"
            ><b>{fmtMoneyCompact(st.pipeline)}</b> {t('line.stat_in_progress', locale)}</span
          >
        {/if}
      </p>
    {/if}

    {#if siblings.length > 1}
      <nav class="line-detail__siblings" aria-label={t('line.siblings', locale)}>
        <p class="eyebrow eyebrow--sub">{t('line.siblings', locale)}</p>
        <div class="line-detail__sib-row">
          {#each siblings as l (l.id)}
            {#if l.id === activeLine.id}
              <span class="line-detail__sib line-detail__sib--on">
                <span class="line-detail__sib-dot" style={`--c: ${accentVar(workspaceSlug)}`}></span>
                {l.name}
                <span class="line-detail__sib-kind">{lineKindLabel(l.kind)}</span>
              </span>
            {:else}
              <a
                class="line-detail__sib"
                href={`/h/${workspaceSlug}/project/${projectSlug}/line/${l.slug ?? l.id}`}
              >
                <span class="line-detail__sib-dot line-detail__sib-dot--off"></span>
                {l.name}
                <span class="line-detail__sib-kind">{lineKindLabel(l.kind)}</span>
              </a>
            {/if}
          {/each}
        </div>
      </nav>
    {/if}

    {#if stack.length > 1}
      <nav class="line-detail__chips" aria-label={t('line.modules', locale)}>
        {#each stack as key (key)}
          <a class="pill--sm pill--mono line-detail__chip" href={`#mod-${key}`}>{moduleLabel(key, locale)}</a>
        {/each}
      </nav>
    {/if}

    <div class="line-detail__stack">
      {#each stack as key (key)}
        {@const Module = REGISTRY[key]}
        <section class="line-detail__module" id={`mod-${key}`}>
          <BlockHead title={moduleLabel(key, locale)} />
          <Module line={activeLine} {workspaceSlug} />
        </section>
      {/each}
    </div>
  {/if}
</article>

<style>
  @layer components {

    .line-detail__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      text-transform: lowercase;
      letter-spacing: var(--tracking-s);
      color: var(--text-muted);
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

    /* Sibling lines — where this line sits among its peers. Current is
       ink-bordered + accent dot; peers are quiet links. */
    .line-detail__siblings {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .line-detail__sib-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-s);
    }
    .line-detail__sib {
      display: inline-flex;
      align-items: center;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-m);
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius-l);
      background: transparent;
      font-size: var(--text-s);
      color: var(--text-muted);
      text-decoration: none;
      transition: border-color var(--transition), color var(--transition);
    }
    .line-detail__sib:hover {
      border-color: var(--border-color-dark);
      color: var(--text-color);
    }
    .line-detail__sib--on {
      border-color: var(--text-color);
      background: var(--bg-ultra-light);
      color: var(--heading-color);
      font-weight: 500;
    }
    .line-detail__sib-dot {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      flex: none;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
    }
    .line-detail__sib-dot--off {
      background: var(--border-color-dark);
    }
    .line-detail__sib-kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
    }

    /* Anchor chips — sticky under the shell top bar. --header-height is the
       bar's real height (declared on .shell, true by construction); module
       sections carry scroll-margin so #hash jumps land below both. */
    .line-detail__chips {
      position: sticky;
      inset-block-start: var(--header-height);
      z-index: calc(var(--z-sticky) - 10);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      padding-block: var(--space-xs);
      background: color-mix(in oklch, var(--bg) 92%, transparent);
      backdrop-filter: blur(6px);
    }
    /* Typography/border via the shared .pill--sm .pill--mono contract;
       only the tighter block padding is local. */
    .line-detail__chip {
      --pill-padding-block: var(--space-2xs);
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
      /* Clear the shell bar + the sticky chips row on #hash jumps. */
      scroll-margin-block-start: calc(var(--header-height) + 3rem);
    }

  }
</style>
