<script lang="ts">
  /**
   * LineList — sidebar lower section ("Lines").
   *
   * Always shows the lines (operational frames) of the currently-selected
   * project. Separation of concerns: Plaza (sidebar upper) handles
   * navigation across workspaces + projects; this component handles the
   * active project's context (its lines).
   *
   * Previously called RoomStructure — renamed when "room" was dropped as
   * UI/code vocabulary (ADR-008 → ADR-033 → cleanup 2026-05-19).
   *
   * Performances (gigs) hanging from lines were removed earlier today —
   * too much density for a navigation surface. Performances surface in
   * dedicated views (Phase 0.2 road sheet UI, calendar lens).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { derived, writable, type Readable } from 'svelte/store';

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
    project_id: string;
    workspace_id: string;
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

  async function fetchLines(
    projectId: string,
    signal: AbortSignal,
  ): Promise<{ items: Line[] }> {
    const jwt = requireJwt();
    const res = await fetch(
      `/api/lines?project_id=${encodeURIComponent(projectId)}`,
      { signal, headers: { Authorization: `Bearer ${jwt}` } },
    );
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Line[] };
  }

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  let activeWorkspaceSlug = $derived(page.params.workspace ?? '');

  let activeProjectSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/project\/([^/]+)/);
    return m?.[1] ?? '';
  });

  // Line slug from URL when on /h/[ws]/project/[slug]/line/[line]/...
  let activeLineSlug = $derived.by(() => {
    const m = page.url.pathname.match(
      /^\/h\/[^/]+\/project\/[^/]+\/line\/([^/]+)/,
    );
    return m?.[1] ?? '';
  });

  let activeProject = $derived(
    $projectsQuery.data?.items.find((p) => p.slug === activeProjectSlug) ?? null,
  );

  let hasProject = $derived(activeProjectSlug.length > 0);

  const projectIdStore = writable<string | null>(null);
  $effect(() => {
    projectIdStore.set(activeProject?.id ?? null);
  });

  const linesQueryOptions: Readable<{
    queryKey: readonly ['lines', { project_id: string | null }];
    queryFn: (ctx: { signal: AbortSignal }) => Promise<{ items: Line[] }>;
    enabled: boolean;
  }> = derived(projectIdStore, ($projectId) => ({
    queryKey: ['lines', { project_id: $projectId }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchLines($projectId!, signal),
    enabled: $projectId !== null,
  }));

  const linesQuery = createQuery(linesQueryOptions);

  let lines = $derived($linesQuery.data?.items ?? []);
  let isLoading = $derived($linesQuery.isPending && activeProject !== null);
  let isError = $derived($linesQuery.isError);
</script>

<aside class="line-list" aria-label="Project structure">
  {#if hasProject}
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
          {@const href = line.slug
            ? `/h/${activeWorkspaceSlug}/project/${activeProjectSlug}/line/${line.slug}`
            : null}
          <li class="line-list__item">
            {#if href}
              <a
                class={['line-list__row', isActive && 'line-list__row--active']
                  .filter(Boolean)
                  .join(' ')}
                {href}
                aria-current={isActive ? 'page' : undefined}
              >
                <span class="line-list__name">{line.name}</span>
                <span class="line-list__kind">{line.kind}</span>
              </a>
            {:else}
              <span class="line-list__row line-list__row--disabled">
                <span class="line-list__name">{line.name}</span>
                <span class="line-list__kind">{line.kind}</span>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="line-list__empty line-list__empty--prompt">
      Select a project to see its structure
    </p>
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
      gap: var(--space-xs);
    }

    .line-list__item {
      display: block;
    }

    .line-list__row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
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

    .line-list__name {
      color: var(--text-color);
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

    .line-list__empty--prompt {
      font-style: italic;
      text-align: center;
    }

    .line-list__empty--error {
      color: var(--danger);
    }
  }
</style>
