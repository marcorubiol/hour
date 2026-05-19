<script lang="ts">
  /**
   * RoomStructure — sidebar lower section ("Lines").
   *
   * Always shows the lines (operational frames) of the currently-selected
   * project. Separation of concerns: Plaza (sidebar upper) handles
   * navigation across workspaces + projects; this component handles the
   * active project's context (its lines).
   *
   * Shows hanging from lines were removed (2026-05-19) — too much density
   * for a navigation surface. Shows surface in dedicated views (Phase 0.2
   * road sheet UI, calendar lens).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { derived, writable, type Readable } from 'svelte/store';

  type Room = {
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

  async function fetchRooms(signal: AbortSignal): Promise<{ items: Room[] }> {
    const jwt = requireJwt();
    const res = await fetch('/api/rooms?status=active', {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Room[] };
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

  const roomsQuery = createQuery({
    queryKey: ['rooms', { status: 'active' }],
    queryFn: ({ signal }) => fetchRooms(signal),
  });

  let activeRoomSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/room\/([^/]+)/);
    return m?.[1] ?? '';
  });

  let activeRoom = $derived(
    $roomsQuery.data?.items.find((r) => r.slug === activeRoomSlug) ?? null,
  );

  let hasRoom = $derived(activeRoomSlug.length > 0);

  const projectIdStore = writable<string | null>(null);
  $effect(() => {
    projectIdStore.set(activeRoom?.id ?? null);
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
  let isLoading = $derived($linesQuery.isPending && activeRoom !== null);
  let isError = $derived($linesQuery.isError);
</script>

<aside class="project-structure" aria-label="Project structure">
  {#if hasRoom}
    <header class="project-structure__header">
      <span class="eyebrow">Lines</span>
    </header>
    {#if isLoading}
      <p class="project-structure__empty">Loading…</p>
    {:else if isError}
      <p class="project-structure__empty project-structure__empty--error">
        Error loading lines.
      </p>
    {:else if lines.length === 0}
      <p class="project-structure__empty">No lines yet.</p>
    {:else}
      <ul class="project-structure__list">
        {#each lines as line (line.id)}
          <li class="project-structure__item">
            <span class="project-structure__name">{line.name}</span>
            <span class="project-structure__kind">{line.kind}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="project-structure__empty project-structure__empty--prompt">
      Select a project to see its structure
    </p>
  {/if}
</aside>

<style>
  @layer components {
    .project-structure {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-start: var(--space-m);
      margin-block-start: var(--space-m);
      border-block-start: var(--divider-light);
    }

    .project-structure__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-inline: var(--space-s);
    }

    .project-structure__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .project-structure__item {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
    }

    .project-structure__name {
      color: var(--text-color);
    }

    .project-structure__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .project-structure__empty {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .project-structure__empty--prompt {
      font-style: italic;
      text-align: center;
    }

    .project-structure__empty--error {
      color: var(--danger);
    }
  }
</style>
