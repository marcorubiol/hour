<script lang="ts">
  /**
   * Agenda — the Home (ADR-057 nav redesign; projects-first grid ADR-060).
   * The logo lands here; there is no "Today"/"Home" pill (that would just
   * repeat the logo). A single quiet column: greeting, the next-7-days
   * agenda (capped, with a "+N more" link to the full Agenda view), and the
   * PROJECTS grid — every production the user can see, pinned ones first.
   *
   * The project is the unit of thought (the show); the space is context on
   * each card (mono chip + accent dot), not the container — spaces with no
   * projects render nothing. Calendar and Money are the other views of the
   * same pinned scope, reachable from ⌘K.
   *
   * Scope: empty pins = everything the user can see; a pinned space scopes
   * to its workspace; pinned projects and lines scope through
   * `scope.projectIds` (engagement rows are filtered by project).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { lineKindGlyph } from '$lib/utils/line-kind';
  import { decodeJwtClaim } from '$lib/realtime';
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
  import AgendaBoard from '$lib/components/AgendaBoard.svelte';
  import { goto } from '$app/navigation';

  const pins = usePins();
  const creation = useCreation();
  let workspaceSlug = $derived(page.params.workspace ?? '');

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
  let scopedEngagements = $derived(engagements.filter(engInScope));

  // ── Greeting + date ───────────────────────────────────────────────────
  let now = $derived(new Date());
  let greetWord = $derived.by(() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
  });
  let dateLabel = $derived(
    now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  );

  let jwtName = $state<string | null>(null);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    const full =
      decodeJwtClaim(jwt, 'user_metadata.full_name') || decodeJwtClaim(jwt, 'user_metadata.name');
    if (full) {
      jwtName = full.split(/\s+/)[0] ?? full;
      return;
    }
    const email = decodeJwtClaim(jwt, 'email');
    if (email) {
      const local = email.split('@')[0] ?? '';
      const first = local.split(/[._-]+/)[0];
      if (first && first.length < local.length) {
        jwtName = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
      }
    }
  });
  let firstName = $derived.by(() => {
    if (jwtName) return jwtName;
    const personal = workspaces.find((h) => h.kind === 'personal');
    return personal ? (personal.name.split(/\s+/)[0] ?? personal.name) : 'there';
  });

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

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function openProject(project: NavProject) {
    void goto(projectUrl(project));
  }
</script>

<svelte:head><title>Agenda — Hour</title></svelte:head>

<div class="home">
  <h1 class="home__greet">{greetWord}, <em>{firstName}</em>.</h1>
  <p class="home__date">{dateLabel} · a quiet start — pin what you live in and it comes forward</p>

  <ScopeStrip onOpenLine={openLine} onOpenProject={openProject} />

  <div class="home__toolbar"><span class="eyebrow">Next 7 days</span></div>
  <AgendaBoard
    engagements={scopedEngagements}
    {workspaceSlug}
    cap={10}
    next7Days
    moreHref={`/h/${workspaceSlug}/agenda`}
    loading={$engagementsQuery.isPending}
    error={$engagementsQuery.isError}
  />

  {#if orderedProjects.length > 0 || projectsSettled}
    <div class="home__projects-head">
      <span class="eyebrow">Projects</span>
      {#if pins.pins.length === 0}
        <span class="home__projects-hint">nothing pinned — browse everything, pin what you live in</span>
      {/if}
      <button type="button" class="creator home__new-space" onclick={() => creation.openWorkspace()}>
        + New space
      </button>
    </div>
    <div class="home__projects">
      {#each orderedProjects as unit (unit.id)}
        {@const pinned = pins.has(projectPin(unit.id))}
        <article class="pcard" class:pcard--pinned={pinned} style={`--c: ${unit.accent}`}>
          <div class="pcard__space">
            <span class="dot" aria-hidden="true"></span>
            <span class="pcard__ws">{unit.workspaceName}</span>
            <button
              type="button"
              class="pill--sm pill--mono pcard__pin"
              class:pill--on={pinned}
              onclick={() => pins.toggle(projectPin(unit.id))}
              title={pinned ? 'Unpin this project' : 'Pin this project'}
            >{pinned ? 'pinned' : 'pin'}</button>
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
      <button type="button" class="pcard pcard--ghost" onclick={() => creation.openProject()}>
        + New project
      </button>
    </div>
  {/if}
</div>

<style>
  @layer components {
    /* .home is a plain <div> (not <section>) so it dodges base.css's section
       defaults (big padding-block + a space-l flex gap between children); the
       vertical rhythm here is controlled by each element's own margin. */
    .home {
      max-inline-size: var(--page-width-reading);
      margin-inline: auto;
    }

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
