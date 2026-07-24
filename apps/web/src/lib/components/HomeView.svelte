<script lang="ts">
  /**
   * Space portada — the `/h/[workspace]/` surface (ADR-062 edit surface #1;
   * portada-only since 2026-07-17): space masthead (kicker · name · about ·
   * stats) over the space's next-7-days agenda and its projects grid.
   *
   * This used to double as the cross-space home digest; that surface died
   * when the hall landed (`/h` greets, the door goes to `/h/desk`) and the
   * manual pin UI (card PIN chips, ScopeStrip) was removed — scopes are
   * built in the left rail and ⌘K only. The pins STORE remains the scope
   * engine; this page just no longer grows UI for it.
   *
   * The project is the unit of thought (the show); cards are ordered by
   * activity (conversations + confirmed + holds).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { lineKindGlyph } from '$lib/utils/line-kind';
  import { useCreation } from '$lib/stores/creation.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
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
  import DeskBoard from '$lib/components/DeskBoard.svelte';
  import { detectLocale, t } from '$lib/i18n';

  const locale = detectLocale(navigator.language);
  import { accentVar } from '$lib/utils/accent';
  import { useBreadcrumb } from '$lib/stores/breadcrumb.svelte';
  import EditWorkspaceDialog from '$lib/components/EditWorkspaceDialog.svelte';
  import { goto } from '$app/navigation';

  interface Props {
    /** The space this portada is about (the /h/[slug]/ segment). */
    workspaceSlug?: string;
  }
  let { workspaceSlug = '' }: Props = $props();

  const creation = useCreation();
  const breadcrumb = useBreadcrumb();

  // Space portada: the edit-space dialog (opened from the masthead pencil).
  let editOpen = $state(false);

  type ConversationStatus =
    | 'contacted'
    | 'in_conversation'
    | 'hold'
    | 'confirmed'
    | 'declined'
    | 'dormant'
    | 'recurring';
  type Conversation = {
    id: string;
    status: ConversationStatus;
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
  const conversationsQuery = createQuery({
    queryKey: ['conversations', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Conversation[] }>('/api/conversations?status=any&limit=100', signal),
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
  // The workspace this portada is about (null while the list is loading).
  let currentWorkspace = $derived(
    workspaces.find((w) => w.slug === workspaceSlug) ?? null,
  );
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let conversations = $derived<Conversation[]>($conversationsQuery.data?.items ?? []);
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
              `/api/conversations?project_ids=${id}&status=any&limit=1`,
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

  // The portada's agenda is this space's — a local view scope that never
  // touches the pins store.
  let scopedConversations = $derived(
    currentWorkspace
      ? conversations.filter((e) => e.workspace_id === currentWorkspace.id)
      : [],
  );

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
    if (st.confirmed) parts.push(t('hall.stat_confirmed_n', locale, { n: st.confirmed }));
    if (st.holds)
      parts.push(
        st.holds === 1 ? t('hall.stat_hold_one', locale) : t('hall.stat_hold_many', locale, { n: st.holds }),
      );
    return parts.join(' · ');
  }
  /** Card stat: conversations (exact count) + confirmed/holds (upcoming
   *  performances). Zeros are omitted, never fabricated. */
  function projectStatLabel(project: NavProject): string {
    const parts: string[] = [];
    const conv = engTotals[project.id];
    if (conv)
      parts.push(
        conv === 1 ? t('hall.stat_conv_one', locale) : t('hall.stat_conv_many', locale, { n: conv }),
      );
    const st = statOf(perfsForProject(project.id));
    if (st.confirmed) parts.push(t('hall.stat_confirmed_n', locale, { n: st.confirmed }));
    if (st.holds)
      parts.push(
        st.holds === 1 ? t('hall.stat_hold_one', locale) : t('hall.stat_hold_many', locale, { n: st.holds }),
      );
    return parts.join(' · ');
  }

  function linesOfProject(projectId: string): NavLine[] {
    return lineIndex.filter((l) => l.projectId === projectId);
  }

  // Busiest first — project.updated_at (the API order) goes stale because
  // working the show touches conversations/lines, never the project row. Sort
  // is stable, so zero-activity ties keep the API order.
  function activityOf(p: NavProject): number {
    const st = statOf(perfsForProject(p.id));
    return (engTotals[p.id] ?? 0) + st.confirmed + st.holds;
  }
  let orderedProjects = $derived(
    [...projectIndex].sort((a, b) => activityOf(b) - activityOf(a)),
  );
  let projectsSettled = $derived(!$projectsQuery.isPending && !$workspacesQuery.isPending);

  // This space's projects only.
  let visibleProjects = $derived(
    currentWorkspace
      ? orderedProjects.filter((p) => p.workspaceId === currentWorkspace.id)
      : [],
  );

  // Masthead stats — aggregated from the same real data the cards show
  // (upcoming performances + exact conversation counts). Zeros stay zero,
  // never fabricated.
  let spaceStats = $derived.by(() => {
    if (!currentWorkspace) return null;
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

  const DOMAIN_KEYS: Record<string, string> = {
    theatre: 'hall.domain_theatre',
    dance: 'hall.domain_dance',
    circus: 'hall.domain_circus',
    music: 'hall.domain_music',
    mixed: 'hall.domain_mixed',
    other: 'hall.domain_space',
  };
  // Masthead kicker: discipline · home base — both real fields (ADR-062).
  // No kind fallback: discipline and personal/team are orthogonal axes, so an
  // unset domain shows only the city (or nothing) — never a faked label.
  let spaceKicker = $derived.by(() => {
    const ws = currentWorkspace;
    if (!ws) return '';
    const discipline = ws.domain
      ? t(DOMAIN_KEYS[ws.domain] ?? 'hall.domain_space', locale)
      : '';
    return [discipline, ws.city].filter(Boolean).join(' · ');
  });

  // The portada publishes its address (● space name) to the shell
  // breadcrumb bar.
  $effect(() => {
    if (!currentWorkspace) return;
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
</script>

<svelte:head><title>{currentWorkspace ? `${currentWorkspace.name} — Hour` : 'Hour'}</title></svelte:head>

<!-- Plain <div> (not <section>) so it dodges base.css's section defaults (big
     padding-block + a space-l flex gap between children); the vertical rhythm
     here is controlled by each element's own margin. Width: .shell__content. -->
<div class="home">
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
            title={t('hall.edit_space', locale)}
            aria-label={t('hall.edit_space', locale)}
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
      <div class="space-stat"><b>{spaceStats.projects}</b><span>{t('hall.stat_projects', locale)}</span></div>
      <div class="space-stat"><b>{spaceStats.confirmed}</b><span>{t('hall.stat_confirmed', locale)}</span></div>
      <div class="space-stat"><b>{spaceStats.holds}</b><span>{t('hall.stat_holds', locale)}</span></div>
      <div class="space-stat"><b>{spaceStats.conversations}</b><span>{t('hall.stat_conversations', locale)}</span></div>
    </div>
  {/if}
  {#if currentWorkspace}
    <EditWorkspaceDialog bind:open={editOpen} workspace={currentWorkspace} />
  {/if}

  <div class="home__toolbar"><span class="eyebrow">{t('hall.next7', locale)}</span></div>
  <DeskBoard
    conversations={scopedConversations}
    {workspaceSlug}
    cap={10}
    next7Days
    moreHref="/h/desk"
    loading={$conversationsQuery.isPending}
    error={$conversationsQuery.isError}
  />

  {#if visibleProjects.length > 0 || projectsSettled}
    <div class="home__projects-head">
      <span class="eyebrow">{t('hall.projects', locale)}</span>
      {#if currentWorkspace}
        <span class="home__projects-hint">{t('hall.projects_hint', locale, { name: currentWorkspace.name })}</span>
      {/if}
    </div>
    <div class="home__projects">
      {#each visibleProjects as unit (unit.id)}
        <article class="pcard pcard--accent" style={`--c: ${unit.accent}`}>
          <div class="pcard__space">
            <span class="pcard__tag">{t('hall.project_tag', locale)}</span>
          </div>
          <a class="pcard__name" href={projectUrl(unit)}>{unit.name}</a>
          <p class="pcard__meta">{projectStatLabel(unit) || t('hall.no_activity', locale)}</p>
          <div class="pcard__lines">
            {#each linesOfProject(unit.id) as line (line.id)}
              <button type="button" class="pcard__line" onclick={() => openLine(line)}>
                <span class="pcard__g">{lineKindGlyph(line.kind)}</span>
                <span class="pcard__ln">{line.name}</span>
                {#if lineStatLabel(line)}<span class="pcard__line-stat">{lineStatLabel(line)}</span>{/if}
                <span class="pcard__go" aria-hidden="true">→</span>
              </button>
            {:else}
              <p class="pcard__empty">{t('hall.no_lines', locale)}</p>
            {/each}
            <div class="pcard__new">
              <button
                type="button"
                class="creator"
                onclick={() => creation.openLine({ workspaceId: unit.workspaceId, projectId: unit.id })}
              >{t('hall.new_line', locale)}</button>
            </div>
          </div>
        </article>
      {/each}
      <button
        type="button"
        class="pcard pcard--ghost"
        onclick={() =>
          creation.openProject(
            currentWorkspace ? { workspaceId: currentWorkspace.id } : undefined,
          )}
      >
        {t('hall.new_project', locale)}
      </button>
    </div>
  {/if}
</div>

<style>
  @layer components {
    /* ── space portada masthead ── */
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
    /* Every card is this space, so a quiet "Project" tag + the space accent
       as a left rule. */
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
