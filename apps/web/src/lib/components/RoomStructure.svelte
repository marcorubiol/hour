<script lang="ts">
  /**
   * RoomStructure — sidebar lower section.
   *
   * Shows the internal structure of the currently-selected Room: its Lines
   * (project subdivisions) and the Shows hanging off each Line. Replaces
   * the `<Desk>` component the original roadmap planned (ADR-029).
   *
   * Three queries:
   *   1. `['rooms', { status: 'active' }]` — shared cache with Plaza + Room
   *      detail. Reads the active room's display name and id without a
   *      slug-vs-name drift between views.
   *   2. `['lines', { project_id }]` — lines of the active project,
   *      ordered by start_date.
   *   3. `['shows', { project_id }]` — all shows of the active project
   *      (regardless of line), grouped client-side by line_id to avoid
   *      N+1 fetches. Embeds venue for sidebar label.
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

  type VenueLite = {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
  };

  type Show = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    venue_id: string | null;
    venue_name: string | null;
    city: string | null;
    country: string | null;
    project_id: string;
    line_id: string | null;
    venue: VenueLite | null;
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

  async function fetchShows(
    projectId: string,
    signal: AbortSignal,
  ): Promise<{ items: Show[] }> {
    const jwt = requireJwt();
    const res = await fetch(
      `/api/shows?project_id=${encodeURIComponent(projectId)}`,
      { signal, headers: { Authorization: `Bearer ${jwt}` } },
    );
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Show[] };
  }

  // Compact date label: "17 Oct"
  function showDateLabel(iso: string): string {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  }

  // City fallback chain: embedded venue.city > denormalized show.city
  function showCityLabel(show: Show): string {
    return show.venue?.city ?? show.city ?? '';
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

  // project_id store: shared trigger for both lines and shows queries.
  // Using writable + derived queryOptions so inner queries refetch when
  // navigating between rooms without remounting the component.
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

  const showsQueryOptions: Readable<{
    queryKey: readonly ['shows', { project_id: string | null }];
    queryFn: (ctx: { signal: AbortSignal }) => Promise<{ items: Show[] }>;
    enabled: boolean;
  }> = derived(projectIdStore, ($projectId) => ({
    queryKey: ['shows', { project_id: $projectId }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchShows($projectId!, signal),
    enabled: $projectId !== null,
  }));

  const linesQuery = createQuery(linesQueryOptions);
  const showsQuery = createQuery(showsQueryOptions);

  let lines = $derived($linesQuery.data?.items ?? []);
  let shows = $derived($showsQuery.data?.items ?? []);
  let isLoading = $derived(
    ($linesQuery.isPending || $showsQuery.isPending) && activeRoom !== null,
  );
  let isError = $derived($linesQuery.isError || $showsQuery.isError);

  // Group shows by line_id. Shows without a line go into the 'orphan' bucket.
  let showsByLine = $derived.by(() => {
    const map = new Map<string, Show[]>();
    const orphans: Show[] = [];
    for (const sh of shows) {
      if (sh.line_id === null) {
        orphans.push(sh);
      } else {
        const arr = map.get(sh.line_id) ?? [];
        arr.push(sh);
        map.set(sh.line_id, arr);
      }
    }
    return { map, orphans };
  });
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
        Error loading structure.
      </p>
    {:else if lines.length === 0 && showsByLine.orphans.length === 0}
      <p class="project-structure__empty">No lines yet.</p>
    {:else}
      <ul class="project-structure__list" >
        {#each lines as line (line.id)}
          {@const lineShows = showsByLine.map.get(line.id) ?? []}
          <li class="project-structure__group" >
            <div class="project-structure__line">
              <span class="project-structure__name">{line.name}</span>
              <span class="project-structure__kind">{line.kind}</span>
            </div>
            {#if lineShows.length > 0}
              <ul class="project-structure__shows" >
                {#each lineShows as show (show.id)}
                  <li class="project-structure__show">
                    <span class="project-structure__show-date">
                      {showDateLabel(show.performed_at)}
                    </span>
                    <span class="project-structure__show-city">
                      {showCityLabel(show)}
                    </span>
                    <span class="project-structure__show-status">{show.status}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
        {#if showsByLine.orphans.length > 0}
          <li class="project-structure__group project-structure__group--orphan" >
            <div class="project-structure__line">
              <span class="project-structure__name project-structure__name--orphan">
                Unscoped shows
              </span>
            </div>
            <ul class="project-structure__shows" >
              {#each showsByLine.orphans as show (show.id)}
                <li class="project-structure__show">
                  <span class="project-structure__show-date">
                    {showDateLabel(show.performed_at)}
                  </span>
                  <span class="project-structure__show-city">
                    {showCityLabel(show)}
                  </span>
                  <span class="project-structure__show-status">{show.status}</span>
                </li>
              {/each}
            </ul>
          </li>
        {/if}
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
      gap: var(--space-s);
    }

    .project-structure__group {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .project-structure__line {
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

    .project-structure__name--orphan {
      font-style: italic;
      color: var(--text-faint);
    }

    .project-structure__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .project-structure__shows {
      list-style: none;
      margin: 0;
      padding-inline-start: var(--space-m);
      display: flex;
      flex-direction: column;
    }

    .project-structure__show {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: baseline;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .project-structure__show-date {
      font-family: var(--font-mono);
      color: var(--text-color);
    }

    .project-structure__show-city {
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .project-structure__show-status {
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
