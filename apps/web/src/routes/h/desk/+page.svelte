<script lang="ts">
  /**
   * Desk view (ADR-065; "Agenda" until the rename) — the full, uncapped
   * timeline behind the Home's "+N more" link. Home shows the next 7 days
   * capped at 10 rows; this shows every conversation with a next action, in
   * the same pinned scope (empty pins = everything the user can see; a pinned
   * space scopes to its workspace; a pinned line scopes through its project).
   * Reachable from the Home link and from ⌘K.
   *
   * The `['engagements','today']` query key below is shared with HomeView on
   * purpose — same data, one cache entry. Rename it in both or in neither.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { fetchJSON } from '$lib/api';
  import DeskBoard from '$lib/components/DeskBoard.svelte';
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
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import type { DeskEngagement } from '$lib/components/DeskBoard.svelte';

  type Engagement = DeskEngagement & { workspace_id: string };

  const pins = usePins();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  // Browsing context for link-building only (ADR-066): lens routes carry no
  // space segment; entity links borrow the default (first) workspace.
  let workspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const engagementsQuery = createQuery({
    queryKey: ['engagements', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Engagement[] }>('/api/engagements?status=any&limit=100', signal),
  });

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let engagements = $derived<Engagement[]>($engagementsQuery.data?.items ?? []);

  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  let scopedProjectIds = $derived(new Set(scope.projectIds));

  function engInScope(e: Engagement): boolean {
    if (scope.isEmpty) return true;
    if (scope.workspaceIds.includes(e.workspace_id)) return true;
    if (e.project && scopedProjectIds.has(e.project.id)) return true;
    return false;
  }
  let scopedEngagements = $derived(engagements.filter(engInScope));

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function openProject(project: NavProject) {
    void goto(projectUrl(project));
  }
</script>

<svelte:head><title>Desk — Hour</title></svelte:head>

<section class="agenda">
  <header class="agenda__head">
    <p class="eyebrow">Desk</p>
    <p class="agenda__sub">Everything with a next action, in your current scope.</p>
  </header>

  <DeskBoard
    engagements={scopedEngagements}
    {workspaceSlug}
    cap={null}
    loading={$engagementsQuery.isPending}
    error={$engagementsQuery.isError}
  />
</section>

<style>
  @layer components {
    .agenda {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .agenda__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .agenda__sub {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
  }
</style>
