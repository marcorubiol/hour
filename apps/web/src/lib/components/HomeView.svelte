<script lang="ts">
  /**
   * Home / Agenda digest (ADR-057 nav redesign; projects-first grid ADR-060).
   * Extracted from the route page so it can render at BOTH `/h/` (space-less
   * home — the rail's ∑) and `/h/[workspace]/` (same digest, browsing a
   * space). The content is global: empty pins = everything the user can see.
   *
   * A single quiet column: greeting, the next-7-days agenda (capped, with a
   * "+N more" link to the full Agenda view), and the PROJECTS grid — every
   * production the user can see, pinned ones first.
   *
   * The project is the unit of thought (the show); the space is context on
   * each card (mono chip + accent dot), not the container — spaces with no
   * projects render nothing. Calendar and Money are the other views of the
   * same pinned scope, reachable from ⌘K.
   *
   * `workspaceSlug` is *browsing context only* — it feeds URL construction
   * for the agenda "more" link and person links, never the data. At `/h/`
   * the caller passes the default (first) workspace; the digest is identical
   * whichever space is in the segment.
   *
   * Scope: empty pins = everything the user can see; a pinned space scopes
   * to its workspace; pinned projects and lines scope through
   * `scope.projectIds` (engagement rows are filtered by project).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { lineKindGlyph } from '$lib/utils/line-kind';
  import { session } from '$lib/session.svelte';
  import { usePins, projectPin, linePin } from '$lib/stores/pins.svelte';
  import { useCreation } from '$lib/stores/creation.svelte';
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
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import ScopeStrip from '$lib/components/ScopeStrip.svelte';
  import DeskBoard from '$lib/components/DeskBoard.svelte';
  import { accentVar } from '$lib/utils/accent';
  import { useBreadcrumb } from '$lib/stores/breadcrumb.svelte';
  import EditWorkspaceDialog from '$lib/components/EditWorkspaceDialog.svelte';
  import { goto } from '$app/navigation';

  interface Props {
    /** Browsing-context workspace for agenda/person link URLs. Optional — the
        home content is global; this only feeds URL construction. */
    workspaceSlug?: string;
    /** When true, render the per-space portada (the /h/[slug]/ surface): a
        space masthead + stats, with the agenda and projects scoped to this
        workspace. When false, the space-less cross-space home (/h/). */
    asSpace?: boolean;
  }
  let { workspaceSlug = '', asSpace = false }: Props = $props();

  const pins = usePins();
  const creation = useCreation();
  const breadcrumb = useBreadcrumb();

  // Space portada: the edit-space dialog (opened from the masthead pencil).
  let editOpen = $state(false);

  type EngagementStatus =
    | 'contacted'
    | 'in_conversation'
    | 'hold'
    | 'confirmed'
    | 'declined'
    | 'dormant'
    | 'recurring';
  type Engagement = {
    id: string;
    status: EngagementStatus;
    next_action_at: string | null;
    next_action_note: string | null;
    updated_at: string;
    workspace_id: string;
    custom_fields: Record<string, unknown> | null;
    person: { full_name: string | null; organization_name: string | null; slug: string | null } | null;
    project: { id: string; slug: string; name: string } | null;
  };
  type Performance = {
    id: string;
    status: string;
    performed_at: string | null;
    line_id: string | null;
    project: { id: string; slug: string; name: string; workspace_id: string } | null;
  };

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const engagementsQuery = createQuery({
    queryKey: ['engagements', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Engagement[] }>('/api/engagements?status=any&limit=100', signal),
  });
  const performancesQuery = createQuery({
    queryKey: ['today-performances'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Performance[] }>(
        `/api/performances?status=any&from=${new Date().toISOString().slice(0, 10)}&limit=200`,
        signal,
      ),
  });

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  // Space portada: the workspace this /h/[slug]/ page is about (null on the
  // home, or while the workspaces list is still loading).
  let currentWorkspace = $derived(
    asSpace ? (workspaces.find((w) => w.slug === workspaceSlug) ?? null) : null,
  );
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let engagements = $derived<Engagement[]>($engagementsQuery.data?.items ?? []);
  let performances = $derived<Performance[]>($performancesQuery.data?.items ?? []);

  // Conversations per project — the card's honest activity number. One
  // count-only request per visible project (exact `total`, no rows).
  const engTotalsOptions = toStore(() => {
    const ids = projectIndex.map((p) => p.id);
    return {
      queryKey: ['project-eng-totals', ids] as const,
      enabled: ids.length > 0,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Record<string, number>> => {
        const entries = await Promise.all(
          ids.map(async (id) => {
            const r = await fetchJSON<{ total: number }>(
              `/api/engagements?project_ids=${id}&status=any&limit=1`,
              signal,
            );
            return [id, r.total] as const;
          }),
        );
        return Object.fromEntries(entries);
      },
    };
  });
  const engTotalsQuery = createQuery(engTotalsOptions);
  let engTotals = $derived<Record<string, number>>($engTotalsQuery.data ?? {});

  // ── Scope resolution ──────────────────────────────────────────────────
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  let scopedProjectIds = $derived(new Set(scope.projectIds));

  function engInScope(e: Engagement): boolean {
    if (scope.isEmpty) return true;
    if (scope.workspaceIds.includes(e.workspace_id)) return true;
    if (e.project && scopedProjectIds.has(e.project.id)) return true;
    return false;
  }
  // On a space portada the agenda is that space's; on the home it follows the
  // user's pins (empty pins = everything). The space filter is a local view
  // scope — it never touches the pins store.
  let scopedEngagements = $derived(
    asSpace && currentWorkspace
      ? engagements.filter((e) => e.workspace_id === currentWorkspace.id)
      : engagements.filter(engInScope),
  );

  // ── Greeting + date ───────────────────────────────────────────────────
  let now = $derived(new Date());
  let greetWord = $derived.by(() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
  });
  let dateLabel = $derived(
    now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  );

  // Greeting name comes from the signed-in user only (display name → email
  // local part) — never a "personal workspace" lookup. personal/team is not a
  // meaningful space distinction (ADR-064); it just read the wrong axis.
  let sessionName = $derived.by(() => {
    const full = session.user?.name;
    if (full) return full.split(/\s+/)[0] ?? full;
    const email = session.user?.email;
    if (email) {
      const local = email.split('@')[0] ?? '';
      const first = local.split(/[._-]+/)[0] || local;
      return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : null;
    }
    return null;
  });
  let firstName = $derived(sessionName ?? 'there');

  // ── Project cards ─────────────────────────────────────────────────────
  function perfsForLine(lineId: string): Performance[] {
    return performances.filter((p) => p.line_id === lineId);
  }
  function perfsForProject(projectId: string): Performance[] {
    return performances.filter((p) => p.project?.id === projectId);
  }
  function statOf(list: Performance[]) {
    const confirmed = list.filter((p) => ['confirmed', 'done', 'invoiced', 'paid'].includes(p.status)).length;
    const holds = list.filter((p) => p.status.startsWith('hold')).length;
    return { confirmed, holds };
  }
  /** Per-line one-liner from its performances. Real data only — a line with
   *  no dates gets no stat (never fabricate a funnel we don't track). */
  function lineStatLabel(line: NavLine): string {
    const st = statOf(perfsForLine(line.id));
    const parts: string[] = [];
    if (st.confirmed) parts.push(`${st.confirmed} confirmed`);
    if (st.holds) parts.push(st.holds === 1 ? '1 hold' : `${st.holds} holds`);
    return parts.join(' · ');
  }
  /** Card stat: conversations (exact count) + confirmed/holds (upcoming
   *  performances). Zeros are omitted, never fabricated. */
  function projectStatLabel(project: NavProject): string {
    const parts: string[] = [];
    const conv = engTotals[project.id];
    if (conv) parts.push(conv === 1 ? '1 conversation' : `${conv} conversations`);
    const st = statOf(perfsForProject(project.id));
    if (st.confirmed) parts.push(`${st.confirmed} confirmed`);
    if (st.holds) parts.push(st.holds === 1 ? '1 hold' : `${st.holds} holds`);
    return parts.join(' · ');
  }

  function linesOfProject(projectId: string): NavLine[] {
    return lineIndex.filter((l) => l.projectId === projectId);
  }

  // Pinned first; a project holding a pinned line floats too (you pinned
  // something you live in — its show comes forward). Within a rank, busiest
  // first — project.updated_at (the API order) goes stale because working
  // the show touches engagements/lines, never the project row. Sort is
  // stable, so zero-activity ties keep the API order.
  let pinnedLineProjectIds = $derived(new Set(scope.lines.map((l) => l.projectId)));
  function pinRank(p: NavProject): number {
    if (pins.has(projectPin(p.id))) return 0;
    if (pinnedLineProjectIds.has(p.id)) return 1;
    return 2;
  }
  function activityOf(p: NavProject): number {
    const st = statOf(perfsForProject(p.id));
    return (engTotals[p.id] ?? 0) + st.confirmed + st.holds;
  }
  let orderedProjects = $derived(
    [...projectIndex].sort(
      (a, b) => pinRank(a) - pinRank(b) || activityOf(b) - activityOf(a),
    ),
  );
  let projectsSettled = $derived(!$projectsQuery.isPending && !$workspacesQuery.isPending);

  // Space portada: narrow the grid to this space's projects. Local view scope
  // — does NOT touch the user's pins. The home shows everything.
  let visibleProjects = $derived(
    asSpace && currentWorkspace
      ? orderedProjects.filter((p) => p.workspaceId === currentWorkspace.id)
      : orderedProjects,
  );

  // Masthead stats — aggregated from the same real data the cards show
  // (upcoming performances + exact conversation counts). Zeros stay zero,
  // never fabricated.
  let spaceStats = $derived.by(() => {
    if (!asSpace || !currentWorkspace) return null;
    let confirmed = 0;
    let holds = 0;
    let conversations = 0;
    for (const p of visibleProjects) {
      const st = statOf(perfsForProject(p.id));
      confirmed += st.confirmed;
      holds += st.holds;
      conversations += engTotals[p.id] ?? 0;
    }
    return { projects: visibleProjects.length, confirmed, holds, conversations };
  });

  const DOMAIN_LABELS: Record<string, string> = {
    theatre: 'Theatre',
    dance: 'Dance',
    circus: 'Circus',
    music: 'Music',
    mixed: 'Mixed',
    other: 'Space',
  };
  // Masthead kicker: discipline · home base — both real fields (ADR-062).
  // No kind fallback: discipline and personal/team are orthogonal axes, so an
  // unset domain shows only the city (or nothing) — never a faked label.
  let spaceKicker = $derived.by(() => {
    const ws = currentWorkspace;
    if (!ws) return '';
    const discipline = ws.domain ? (DOMAIN_LABELS[ws.domain] ?? 'Space') : '';
    return [discipline, ws.city].filter(Boolean).join(' · ');
  });

  // Space portada publishes its address (● space name) to the shell
  // breadcrumb bar. The home (asSpace=false) owns no breadcrumb.
  $effect(() => {
    if (!asSpace || !currentWorkspace) return;
    breadcrumb.set([
      {
        label: currentWorkspace.name,
        href: `/h/${currentWorkspace.slug}/`,
        kind: 'space',
        accent: accentVar(currentWorkspace.slug),
      },
    ]);
    return () => breadcrumb.clear();
  });

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function openProject(project: NavProject) {
    void goto(projectUrl(project));
  }
</script>

<svelte:head><title>Desk — Hour</title></svelte:head>

<!-- Plain <div> (not <section>) so it dodges base.css's section defaults (big
     padding-block + a space-l flex gap between children); the vertical rhythm
     here is controlled by each element's own margin. Width: .shell__content. -->
<div class="home">
  {#if asSpace}
    <header class="space-head">
      {#if currentWorkspace}
        {#if spaceKicker}
          <div class="space-head__kick">
            <span class="space-head__dot" style={`--c: ${accentVar(currentWorkspace.slug)}`} aria-hidden="true"></span>
            {spaceKicker}
          </div>
        {/if}
        <div class="space-head__namerow">
          <h1 class="space-head__name">{currentWorkspace.name}</h1>
          <button
            type="button"
            class="space-head__edit"
            onclick={() => (editOpen = true)}
            title="Edit space"
            aria-label="Edit space"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          </button>
        </div>
        {#if currentWorkspace.description}
          <p class="space-head__about">{currentWorkspace.description}</p>
        {/if}
      {/if}
    </header>
    {#if spaceStats}
      <div class="space-stats">
        <div class="space-stat"><b>{spaceStats.projects}</b><span>projects</span></div>
        <div class="space-stat"><b>{spaceStats.confirmed}</b><span>confirmed</span></div>
        <div class="space-stat"><b>{spaceStats.holds}</b><span>holds</span></div>
        <div class="space-stat"><b>{spaceStats.conversations}</b><span>conversations</span></div>
      </div>
    {/if}
    {#if currentWorkspace}
      <EditWorkspaceDialog bind:open={editOpen} workspace={currentWorkspace} />
    {/if}
  {:else}
    <h1 class="home__greet">{greetWord}, <em>{firstName}</em>.</h1>
    <p class="home__date">{dateLabel} · a quiet start — pin what you live in and it comes forward</p>

    <ScopeStrip onOpenLine={openLine} onOpenProject={openProject} />
  {/if}

  <div class="home__toolbar"><span class="eyebrow">Next 7 days</span></div>
  <DeskBoard
    engagements={scopedEngagements}
    {workspaceSlug}
    cap={10}
    next7Days
    moreHref="/h/desk"
    loading={$engagementsQuery.isPending}
    error={$engagementsQuery.isError}
  />

  {#if visibleProjects.length > 0 || projectsSettled}
    <div class="home__projects-head">
      <span class="eyebrow">Projects</span>
      {#if asSpace && currentWorkspace}
        <span class="home__projects-hint">everything {currentWorkspace.name} is running</span>
      {:else if pins.pins.length === 0}
        <span class="home__projects-hint">nothing pinned — browse everything, pin what you live in</span>
      {/if}
      {#if !asSpace}
        <button type="button" class="creator home__new-space" onclick={() => creation.openWorkspace()}>
          + New space
        </button>
      {/if}
    </div>
    <div class="home__projects">
      {#each visibleProjects as unit (unit.id)}
        {@const pinned = pins.has(projectPin(unit.id))}
        <article class="pcard" class:pcard--pinned={pinned} class:pcard--accent={asSpace} style={`--c: ${unit.accent}`}>
          <div class="pcard__space">
            {#if asSpace}
              <span class="pcard__tag">Project</span>
            {:else}
              <span class="dot" aria-hidden="true"></span>
              <span class="pcard__ws">{unit.workspaceName}</span>
              <button
                type="button"
                class="pill--sm pill--mono pcard__pin"
                class:pill--on={pinned}
                onclick={() => pins.toggle(projectPin(unit.id))}
                title={pinned ? 'Unpin this project' : 'Pin this project'}
              >{pinned ? 'pinned' : 'pin'}</button>
            {/if}
          </div>
          <a class="pcard__name" href={projectUrl(unit)}>{unit.name}</a>
          <p class="pcard__meta">{projectStatLabel(unit) || 'no activity yet'}</p>
          <div class="pcard__lines">
            {#each linesOfProject(unit.id) as line (line.id)}
              {@const lPinned = pins.has(linePin(line.id))}
              <button type="button" class="pcard__line" onclick={() => openLine(line)}>
                <span class="pcard__g">{lineKindGlyph(line.kind)}</span>
                <span class="pcard__ln">{line.name}</span>
                {#if lPinned}<span class="pcard__line-pin">pinned</span>{/if}
                {#if lineStatLabel(line)}<span class="pcard__line-stat">{lineStatLabel(line)}</span>{/if}
                <span class="pcard__go" aria-hidden="true">→</span>
              </button>
            {:else}
              <p class="pcard__empty">No lines on this project yet.</p>
            {/each}
            <div class="pcard__new">
              <button
                type="button"
                class="creator"
                onclick={() => creation.openLine({ workspaceId: unit.workspaceId, projectId: unit.id })}
              >+ New line</button>
            </div>
          </div>
        </article>
      {/each}
      <button
        type="button"
        class="pcard pcard--ghost"
        onclick={() =>
          creation.openProject(
            asSpace && currentWorkspace ? { workspaceId: currentWorkspace.id } : undefined,
          )}
      >
        + New project
      </button>
    </div>
  {/if}
</div>

<style>
  @layer components {
    /* Masthead typography via base.css h1 defaults. */
    .home__greet {
      margin: 0 0 var(--space-2xs);
      color: var(--text-color);
    }
    .home__greet em {
      font-style: italic;
    }
    .home__date {
      font-size: var(--text-m);
      color: var(--text-muted);
      margin: 0 0 var(--space-s);
    }

    /* ── space portada masthead (asSpace) ── */
    .space-head {
      margin-block-end: var(--space-s);
    }
    .space-head__kick {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .space-head__dot {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      flex: none;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
    }
    .space-head__namerow {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      margin-block-start: var(--space-2xs);
    }
    /* .space-head__name is an <h1> → base.css display size; just reset here. */
    .space-head__name {
      margin: 0;
      color: var(--heading-color);
    }
    .space-head__edit {
      display: inline-grid;
      place-items: center;
      flex: none;
      inline-size: var(--control-size-s);
      block-size: var(--control-size-s);
      padding: 0;
      border: 0;
      border-radius: var(--radius-s);
      background: transparent;
      color: var(--text-faint);
      cursor: pointer;
      transition: color var(--transition), background var(--transition);
    }
    .space-head__edit:hover:not(:disabled) {
      color: var(--text-color);
      background: var(--bg-light);
    }
    .space-head__edit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .space-head__about {
      max-inline-size: 40rem;
      margin-block: var(--space-s) 0;
      font-size: var(--text-m);
      line-height: 1.55;
      color: var(--text-muted);
    }

    .space-stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-l);
      margin-block: var(--space-m) 0;
      padding-block: var(--space-s);
      border-block: 1px solid var(--border-color-light);
    }
    .space-stat b {
      display: block;
      font-family: var(--font-display);
      font-size: 1.5rem;
      font-weight: 500;
      line-height: 1.1;
      color: var(--heading-color);
    }
    .space-stat span {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .home__toolbar {
      margin-block: var(--space-s) var(--space-2xs);
    }
    .dot {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
      flex: none;
    }

    /* ── projects grid ── */
    .home__projects-head {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      flex-wrap: wrap;
      margin-block: var(--space-l) var(--space-s);
    }
    .home__projects-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-style: italic;
      font-family: var(--font-display);
    }
    .home__new-space {
      margin-inline-start: auto;
    }
    .home__projects {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: var(--space-m);
    }

    .pcard {
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-xl);
      background: var(--bg-ultra-light);
      overflow: hidden;
      display: grid;
      align-content: start;
      transition: border-color var(--transition);
    }
    .pcard--pinned {
      border-color: var(--border-color-dark);
    }
    /* On a space portada every card is the same space, so the space chip is
       dropped for a quiet "Project" tag + the space accent as a left rule. */
    .pcard--accent {
      border-inline-start: 3px solid var(--c, var(--border-color-dark));
    }
    .pcard__tag {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }

    /* Space = context, not container: a quiet mono chip with the space's
       accent dot. The card belongs to the show; the space just says where. */
    .pcard__space {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding-block-start: var(--space-s);
      padding-inline: var(--space-m);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pcard__ws {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pcard__pin {
      margin-inline-start: auto;
      --pill-padding-block: var(--space-2xs);
    }
    .pcard__name {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      color: var(--text-color);
      text-decoration: none;
      margin-block-start: var(--space-xs);
      margin-inline: var(--space-m);
      justify-self: start;
    }
    .pcard__name:hover {
      text-decoration: underline;
      text-underline-offset: 0.15em;
    }
    .pcard__meta {
      margin-block: var(--space-2xs) var(--space-s);
      margin-inline: var(--space-m);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .pcard__lines {
      border-block-start: 1px solid var(--border-color-light);
      padding: var(--space-xs);
    }
    .pcard__line {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      inline-size: 100%;
      padding-block: var(--space-s);
      padding-inline: var(--space-s);
      border: 0;
      border-radius: var(--radius-m);
      background: none;
      text-align: start;
      cursor: pointer;
      font-family: inherit;
    }
    .pcard__line:hover {
      background: var(--bg-light);
    }
    .pcard__g {
      inline-size: 1.1rem;
      text-align: center;
      color: var(--c, var(--text-muted));
      font-size: var(--text-s);
    }
    .pcard__ln {
      flex: 1;
      min-inline-size: 0;
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pcard__line-pin {
      flex: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--c, var(--text-muted));
    }
    .pcard__line-stat {
      flex: none;
      font-size: var(--text-xs);
      color: var(--text-faint);
      white-space: nowrap;
    }
    .pcard__go {
      color: var(--text-faint);
      opacity: 0;
      flex: none;
    }
    .pcard__line:hover .pcard__go {
      opacity: 1;
    }
    .pcard__empty {
      margin: 0;
      padding: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    /* Creation affordances (ADR-056) — quiet by design. */
    .pcard__new {
      display: flex;
      gap: var(--space-s);
      padding-block-start: var(--space-2xs);
      border-block-start: 1px solid var(--border-color-light);
      margin-block-start: var(--space-2xs);
    }
    /* Creators via the shared .creator class (base.css). */
    .pcard--ghost {
      display: flex;
      align-items: center;
      justify-content: center;
      min-block-size: 6rem;
      border-style: dashed;
      border-color: var(--border-color-dark);
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
      transition: color var(--transition), border-color var(--transition);
    }
    .pcard--ghost:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }
  }
</style>
