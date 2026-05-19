<script lang="ts">
  /**
   * LineList — sidebar lower section ("Lines"). Always visible.
   *
   * Refactored 2026-05-19 to be filter-aware (SelectionStore):
   *   - Empty selection      → all accessible lines, ordered by last-used
   *   - 1+ workspaces        → all lines of those workspaces' projects
   *   - 1+ projects          → lines of those projects (union)
   *   - Mix                  → union of both filters
   *
   * Each line is clickable: navigates to its detail page (canonical URL
   * /h/[ws]/project/[slug]/line/[line]/). Active line highlighted by URL.
   *
   * Per-line subtitle "in <project>" shown when multiple projects are in
   * scope, to disambiguate. Hidden when only one project is visible.
   *
   * Previously RoomStructure / project-scoped only. Naming + scope shift
   * 2026-05-19 (ADR-038 sidebar filter system).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { derived, writable, type Readable } from 'svelte/store';
  import { useSelection } from '$lib/stores/selection.svelte';

  type Project = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  type ProjectLite = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
  };

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
    last_navigated_at: string | null;
    project: ProjectLite | null;
  };

  function requireJwt(): string {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      goto('/login', { replaceState: true });
      throw new Error('Missing JWT');
    }
    return jwt;
  }

  async function fetchProjects(signal: AbortSignal): Promise<{ items: Project[] }> {
    const jwt = requireJwt();
    const res = await fetch('/api/projects?status=active', {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Project[] };
  }

  async function fetchWorkspaces(
    signal: AbortSignal,
  ): Promise<{ items: Array<{ id: string; slug: string }> }> {
    const jwt = requireJwt();
    const res = await fetch('/api/workspaces', {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Array<{ id: string; slug: string }> };
  }

  async function fetchLines(
    projectIds: string[],
    workspaceIds: string[],
    signal: AbortSignal,
  ): Promise<{ items: Line[] }> {
    const jwt = requireJwt();
    const params = new URLSearchParams();
    if (projectIds.length) params.set('project_ids', projectIds.join(','));
    if (workspaceIds.length) params.set('workspace_ids', workspaceIds.join(','));
    const qs = params.toString();
    const res = await fetch(`/api/lines${qs ? `?${qs}` : ''}`, {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Line[] };
  }

  const selection = useSelection();

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }) => fetchWorkspaces(signal),
  });

  // Active line slug from URL (for highlight when on /h/[ws]/project/[p]/line/[l]/)
  let activeLineSlug = $derived.by(() => {
    const m = page.url.pathname.match(
      /^\/h\/[^/]+\/project\/[^/]+\/line\/([^/]+)/,
    );
    return m?.[1] ?? '';
  });

  // Resolve selection slugs → ids. SelectionStore stores slugs; the API
  // wants ids. We look up the cached projects/workspaces.
  let filterIds = $derived.by(() => {
    const projectsBySlug = new Map(
      ($projectsQuery.data?.items ?? []).map((p) => [p.slug, p]),
    );
    const workspacesBySlug = new Map(
      ($workspacesQuery.data?.items ?? []).map((w) => [w.slug, w]),
    );
    // Use the SelectionStore's "effective" accessors so focus mode wins:
    // when a workspace is focused, effectiveWorkspaces=[focusedSlug] and
    // effectiveProjects=[] regardless of the underlying selection sets.
    // Outside focus, these return the real selection.workspaces /
    // selection.projects sets.
    const projectIds: string[] = [];
    for (const slug of selection.effectiveProjects()) {
      const p = projectsBySlug.get(slug);
      if (p) projectIds.push(p.id);
    }
    const workspaceIds: string[] = [];
    for (const slug of selection.effectiveWorkspaces()) {
      const w = workspacesBySlug.get(slug);
      if (w) workspaceIds.push(w.id);
    }
    return { projectIds, workspaceIds };
  });

  // Store filterIds in writable so the lines query rebuilds on selection change.
  const filterStore = writable<{ projectIds: string[]; workspaceIds: string[] }>({
    projectIds: [],
    workspaceIds: [],
  });
  $effect(() => {
    filterStore.set({
      projectIds: filterIds.projectIds,
      workspaceIds: filterIds.workspaceIds,
    });
  });

  const linesQueryOptions: Readable<{
    queryKey: readonly ['lines', { projects: string; workspaces: string }];
    queryFn: (ctx: { signal: AbortSignal }) => Promise<{ items: Line[] }>;
    enabled: boolean;
  }> = derived(filterStore, ($filter) => ({
    queryKey: [
      'lines',
      {
        projects: $filter.projectIds.sort().join(','),
        workspaces: $filter.workspaceIds.sort().join(','),
      },
    ] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchLines($filter.projectIds, $filter.workspaceIds, signal),
    // Always enabled — empty filter means "fetch all"
    enabled: true,
  }));

  const linesQuery = createQuery(linesQueryOptions);

  let lines = $derived($linesQuery.data?.items ?? []);
  let isLoading = $derived($linesQuery.isPending);
  let isError = $derived($linesQuery.isError);

  // Show per-line "in <project>" subtitle when multiple projects are
  // represented in the visible set (>1 distinct project_ids).
  let showProjectContext = $derived.by(() => {
    const seen = new Set<string>();
    for (const l of lines) {
      seen.add(l.project_id);
      if (seen.size > 1) return true;
    }
    return false;
  });

  // Build href per line — needs workspace slug. We get it from the cached
  // workspace by id (each line carries workspace_id).
  let workspaceSlugById = $derived(
    new Map(
      ($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug]),
    ),
  );

  function hrefFor(line: Line): string | null {
    if (!line.slug || !line.project?.slug) return null;
    const wsSlug = workspaceSlugById.get(line.workspace_id);
    if (!wsSlug) return null;
    return `/h/${wsSlug}/project/${line.project.slug}/line/${line.slug}`;
  }
</script>

<aside class="line-list" aria-label="Lines">
  <header class="line-list__header">
    <span class="eyebrow">Lines</span>
  </header>
  {#if isLoading}
    <p class="line-list__empty">Loading…</p>
  {:else if isError}
    <p class="line-list__empty line-list__empty--error">Error loading lines.</p>
  {:else if lines.length === 0}
    <p class="line-list__empty">No lines yet.</p>
  {:else}
    <ul class="line-list__items">
      {#each lines as line (line.id)}
        {@const isActive = line.slug !== null && line.slug === activeLineSlug}
        {@const href = hrefFor(line)}
        <li class="line-list__item">
          {#if href}
            <a
              class={['line-list__row', isActive && 'line-list__row--active']
                .filter(Boolean)
                .join(' ')}
              {href}
              aria-current={isActive ? 'page' : undefined}
            >
              <span class="line-list__main">
                <span class="line-list__name">{line.name}</span>
                {#if showProjectContext && line.project?.name}
                  <span class="line-list__context">in {line.project.name}</span>
                {/if}
              </span>
              <span class="line-list__kind">{line.kind}</span>
            </a>
          {:else}
            <span class="line-list__row line-list__row--disabled">
              <span class="line-list__main">
                <span class="line-list__name">{line.name}</span>
                {#if showProjectContext && line.project?.name}
                  <span class="line-list__context">in {line.project.name}</span>
                {/if}
              </span>
              <span class="line-list__kind">{line.kind}</span>
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  @layer components {
    .line-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-start: var(--space-m);
      margin-block-start: var(--space-m);
      border-block-start: var(--divider-light);
    }

    .line-list__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-inline: var(--space-s);
    }

    .line-list__items {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .line-list__item {
      display: block;
    }

    .line-list__row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: baseline;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
      border-radius: var(--radius);
      transition: background-color var(--transition);
    }

    .line-list__row:hover {
      background: var(--bg-hover);
    }

    .line-list__row:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: -2px;
    }

    .line-list__row--active {
      background: var(--bg-active);
    }

    .line-list__row--active .line-list__name {
      color: var(--primary);
    }

    .line-list__row--disabled {
      cursor: default;
      color: var(--text-faint);
    }

    .line-list__main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-inline-size: 0;
    }

    .line-list__name {
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .line-list__context {
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .line-list__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .line-list__empty {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .line-list__empty--error {
      color: var(--danger);
    }
  }
</style>
