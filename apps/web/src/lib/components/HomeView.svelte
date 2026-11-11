<script lang="ts">
  /**
   * Space portada — the `/h/[workspace]/` surface (ADR-062 edit surface #1;
   * portada-only since 2026-07-17): space masthead (kicker · name · about,
   * with its edit) over its projects and their lines. The figures and the
   * «Próximos 7 días» agenda went with § 70 (the ADR that amends ADR-154
   * § 11-12): Hoy and the lenses already say both.
   *
   * This used to double as the cross-space home digest; that surface died
   * when the hall landed (`/h`, now the Desk itself, ADR-137) and the
   * manual pin UI (card PIN chips, ScopeStrip) was removed — scopes are
   * built in the left rail and ⌘K only. The pins STORE remains the scope
   * engine; this page just no longer grows UI for it.
   *
   * The project is the unit of thought (the show); cards are ordered by
   * activity (confirmed + holds ahead).
   */

  import { docTitle } from '$lib/doc-title';
  import { createQuery } from '@tanstack/svelte-query';
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
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();
  import { accentVar } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import EditWorkspaceDialog from '$lib/components/EditWorkspaceDialog.svelte';
  import { goto } from '$app/navigation';
  import { isGuestIn, writesSpaceIn } from '$lib/workspace-role';

  interface Props {
    /** The space this portada is about (the /h/[slug]/ segment). */
    workspaceSlug?: string;
  }
  let { workspaceSlug = '' }: Props = $props();

  const creation = useCreation();

  // Space portada: the edit-space dialog (opened from the masthead pencil).
  let editOpen = $state(false);

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
  // A guest of this space (a bolo invitation) edits nothing of it and makes
  // no project here (`$lib/workspace-role`): neither door is drawn.
  let guestHere = $derived(isGuestIn(currentWorkspace));
  let makesProjects = $derived(currentWorkspace ? writesSpaceIn(currentWorkspace) : true);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let performances = $derived<Performance[]>($performancesQuery.data?.items ?? []);

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
  /** Card stat: confirmed/holds (upcoming performances). Zeros are
   *  omitted, never fabricated. */
  function projectStatLabel(project: NavProject): string {
    const parts: string[] = [];
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

  // Busiest first: project.updated_at (the API order) goes stale because
  // working the show touches its dates and lines, never the project row. Sort
  // is stable, so zero-activity ties keep the API order.
  function activityOf(p: NavProject): number {
    const st = statOf(perfsForProject(p.id));
    return st.confirmed + st.holds;
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

  // Masthead kicker: the home base, a real field (ADR-062). The discipline
  // left with tarea 135: the trade in Ajustes is what says how Hour speaks.
  let spaceKicker = $derived(currentWorkspace?.city ?? '');

  // The space is the root of its records: its address is the kind alone,
  // with the space's dot (RecordHead).
  let crumbs = $derived(
    currentWorkspace ? [{ label: t('workspace.label', locale), accent: accentVar(currentWorkspace.slug) }] : [],
  );

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
</script>

<svelte:head><title>{docTitle(currentWorkspace ? spaceName(currentWorkspace.name) : null)}</title></svelte:head>

<!-- Plain <div> (not <section>) so it dodges base.css's section defaults (big
     padding-block + a space-l flex gap between children); the vertical rhythm
     here is controlled by each element's own margin. Width: .shell__content. -->
<div class="home">
  {#if currentWorkspace}
    <RecordHead
      {crumbs}
      title={spaceName(currentWorkspace.name)}
      tools={guestHere ? [] : [{ label: t('person.edit', locale), onclick: () => (editOpen = true), testid: 'space-edit' }]}
    >
      {#snippet facts()}
        {#if spaceKicker}<span>{spaceKicker}</span>{/if}
      {/snippet}
    </RecordHead>
    {#if currentWorkspace.description}
      <p class="space-head__about">{currentWorkspace.description}</p>
    {/if}
  {/if}
  {#if currentWorkspace}
    <EditWorkspaceDialog bind:open={editOpen} workspace={currentWorkspace} />
  {/if}

  {#if visibleProjects.length > 0 || projectsSettled}
    <div class="home__projects-head"><BlockHead title={t('hall.projects', locale)} /></div>
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
              <EmptyLine text={t('hall.no_lines', locale)} />
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
      {#if makesProjects}
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
      {/if}
    </div>
  {/if}
</div>

<style>
  @layer components {
    /* ── space portada masthead ── */
    .space-head__about {
      max-inline-size: 40rem;
      margin-block: var(--space-s) 0;
      font-size: var(--text-m);
      line-height: 1.55;
      color: var(--text-muted);
    }

    /* ── projects grid ── */
    .home__projects-head {
      margin-block: var(--space-l) var(--space-s);
    }
    .home__projects {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: var(--space-m);
    }

    .pcard {
      border: var(--line-hairline) solid var(--border-color-light);
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
      border-inline-start: var(--line-thick) solid var(--c, var(--border-color-dark));
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
      border-block-start: var(--line-hairline) solid var(--border-color-light);
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

    /* Creation affordances (ADR-056) — quiet by design. */
    .pcard__new {
      display: flex;
      gap: var(--space-s);
      padding-block-start: var(--space-2xs);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
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
