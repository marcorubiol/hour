<script lang="ts">
  /**
   * Agenda view — the full, uncapped timeline behind the Home's "+N more"
   * link. Home shows the next 7 days capped at 10 rows; this shows every
   * conversation with a next action, in the same pinned scope (empty pins =
   * everything the user can see; a pinned space scopes to its workspace; a
   * pinned line scopes through its project). Reachable from the Home link and
   * from ⌘K.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { fetchJSON } from '$lib/api';
  import ScopeStrip from '$lib/components/ScopeStrip.svelte';
  import AgendaBoard from '$lib/components/AgendaBoard.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    resolveScope,
    lineUrl,
    type NavLine,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { workspacesQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import type { AgendaEngagement } from '$lib/components/AgendaBoard.svelte';

  type Engagement = AgendaEngagement & { workspace_id: string };

  const pins = usePins();
  let workspaceSlug = $derived(page.params.workspace ?? '');

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const engagementsQuery = createQuery({
    queryKey: ['engagements', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Engagement[] }>('/api/engagements?status=any&limit=100', signal),
  });

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let engagements = $derived<Engagement[]>($engagementsQuery.data?.items ?? []);

  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex));
  let pinnedProjectIds = $derived(new Set(scope.lines.map((l) => l.projectId)));

  function engInScope(e: Engagement): boolean {
    if (scope.isEmpty) return true;
    if (scope.workspaceIds.includes(e.workspace_id)) return true;
    if (e.project && pinnedProjectIds.has(e.project.id)) return true;
    return false;
  }
  let scopedEngagements = $derived(engagements.filter(engInScope));

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
</script>

<svelte:head><title>Agenda — Hour</title></svelte:head>

<section class="agenda">
  <header class="agenda__head">
    <p class="eyebrow">Agenda</p>
    <ScopeStrip onOpenLine={openLine} compact />
    <p class="agenda__sub">Everything with a next action, in your current scope.</p>
  </header>

  <AgendaBoard
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
