<script lang="ts">
  /**
   * Plaza — user-scoped sidebar tree, 2 levels.
   *
   * Renders ALL workspaces the user is a member of, with their projects
   * nested below. Each workspace row has a chevron (toggle collapse) and
   * a clickable name (navigate to workspace home). Each project row links
   * to the project detail (currently the room/[slug] route).
   *
   * Active state:
   *   - Project row matches URL → `--project-active` (filled background)
   *   - Workspace contains the active project → `--workspace-on-path`
   *     (primary tint on workspace name; ADR-029 trabajo #8 cross-highlight)
   *   - Workspace matches URL but no project selected → `--workspace-active`
   *
   * Collapse:
   *   - Default: all workspaces expanded
   *   - User toggle persisted in localStorage key
   *     `plaza_collapsed_workspaces` (array of workspace_ids)
   *   - Collapsed workspace hides its projects but keeps the row + chevron
   *
   * Lines (3rd level) live in <RoomStructure /> sidebar lower, not here —
   * separates navigation (Plaza) from active project context (Lines).
   */

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';

  type House = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
  };

  type Room = {
    id: string;
    slug: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    workspace_id: string;
  };

  const COLLAPSE_KEY = 'plaza_collapsed_workspaces';

  function clearAuthAndBounce() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }

  async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      clearAuthAndBounce();
      throw new Error('Missing JWT');
    }
    const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status === 401) {
      clearAuthAndBounce();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      throw new Error(body.detail || body.error || `Error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  const housesQuery = createQuery({
    queryKey: ['houses'],
    queryFn: ({ signal }) => fetchJSON<{ items: House[] }>('/api/houses', signal),
  });

  const roomsQuery = createQuery({
    queryKey: ['rooms', { status: 'active' }],
    queryFn: ({ signal }) =>
      fetchJSON<{ items: Room[] }>('/api/rooms?status=active', signal),
  });

  let activeWorkspaceSlug = $derived(page.params.workspace ?? '');
  let activeRoomSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/room\/([^/]+)/);
    return m?.[1] ?? '';
  });

  let houses = $derived($housesQuery.data?.items ?? []);
  let rooms = $derived($roomsQuery.data?.items ?? []);

  let tree = $derived(
    houses.map((house) => ({
      house,
      projects: rooms.filter((r) => r.workspace_id === house.id),
    })),
  );

  let loading = $derived($housesQuery.isPending || $roomsQuery.isPending);
  let errored = $derived($housesQuery.isError || $roomsQuery.isError);

  // Collapse state — set of workspace ids that are collapsed.
  let collapsedIds = $state<Set<string>>(new Set());

  onMount(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
          collapsedIds = new Set(arr);
        }
      }
    } catch {
      // Bad payload — ignore, fall back to default (all expanded).
    }
  });

  function toggleCollapse(workspaceId: string) {
    const next = new Set(collapsedIds);
    if (next.has(workspaceId)) next.delete(workspaceId);
    else next.add(workspaceId);
    collapsedIds = next;
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Storage full or disabled — collapse state still works in-session.
    }
  }
</script>

<nav class="plaza" aria-label="Projects">
  <p class="eyebrow plaza__eyebrow">Projects</p>

  {#if loading}
    <p class="plaza__state">Loading…</p>
  {:else if errored}
    <p class="plaza__state plaza__state--danger">Couldn't load projects.</p>
  {:else if tree.length === 0}
    <p class="plaza__state">No projects yet.</p>
  {:else}
    <ul class="plaza__list" role="list">
      {#each tree as { house, projects } (house.id)}
        {@const isCollapsed = collapsedIds.has(house.id)}
        {@const isWorkspaceUrl = house.slug === activeWorkspaceSlug}
        {@const hasActiveProject = isWorkspaceUrl && activeRoomSlug.length > 0}
        {@const isWorkspaceActive = isWorkspaceUrl && activeRoomSlug.length === 0}
        {@const hasProjects = projects.length > 0}
        <li class="plaza__house">
          <div
            class={[
              'plaza__house-row',
              isWorkspaceActive && 'plaza__house-row--active',
              hasActiveProject && 'plaza__house-row--on-path',
            ]
              .filter(Boolean)
              .join(' ')}
            style={`--c: ${accentVar(house.slug)}`}
          >
            <span class="plaza__house-rail" aria-hidden="true"></span>
            {#if hasProjects}
              <button
                type="button"
                class={['plaza__chevron', isCollapsed && 'plaza__chevron--collapsed']
                  .filter(Boolean)
                  .join(' ')}
                aria-label={isCollapsed
                  ? `Expand ${house.name}`
                  : `Collapse ${house.name}`}
                aria-expanded={!isCollapsed}
                onclick={() => toggleCollapse(house.id)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="10"
                  height="10"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M5 3 L11 8 L5 13 Z" />
                </svg>
              </button>
            {:else}
              <span class="plaza__chevron plaza__chevron--placeholder" aria-hidden="true"></span>
            {/if}
            <a
              class="plaza__house-link"
              href={`/h/${house.slug}/`}
              aria-current={isWorkspaceActive ? 'page' : undefined}
            >
              <span class="plaza__house-name">{house.name}</span>
              <span class="plaza__house-sub">
                {house.kind === 'personal' ? 'Personal workspace' : 'Team workspace'}
              </span>
            </a>
          </div>

          {#if !isCollapsed && hasProjects}
            <ul class="plaza__projects" role="list">
              {#each projects as project (project.id)}
                {@const isProjectActive =
                  isWorkspaceUrl && project.slug === activeRoomSlug}
                <li>
                  <a
                    class={[
                      'plaza__project',
                      isProjectActive && 'plaza__project--active',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    href={`/h/${house.slug}/room/${project.slug}`}
                    aria-current={isProjectActive ? 'page' : undefined}
                  >
                    <span class="plaza__project-name">{project.name}</span>
                  </a>
                </li>
              {/each}
            </ul>
          {:else if !hasProjects}
            <p class="plaza__empty">No projects yet.</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  @layer components {
    .plaza {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .plaza__eyebrow {
      margin: 0;
      padding-inline: var(--space-s);
    }

    .plaza__list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .plaza__house {
      display: flex;
      flex-direction: column;
    }

    .plaza__house-row {
      display: grid;
      grid-template-columns: 3px auto 1fr;
      gap: var(--space-xs);
      align-items: center;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-radius: var(--radius);
      transition: background-color var(--transition);
    }

    .plaza__house-row:hover {
      background: var(--bg-hover);
    }

    .plaza__house-row--active {
      background: var(--bg-active);
    }

    .plaza__house-row--on-path .plaza__house-name {
      color: var(--primary);
    }

    .plaza__house-rail {
      inline-size: 3px;
      block-size: 28px;
      background: var(--c, var(--text-muted));
      border-radius: 2px;
      align-self: center;
    }

    .plaza__chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 14px;
      block-size: 14px;
      padding: 0;
      background: transparent;
      border: 0;
      cursor: pointer;
      color: var(--text-faint);
      border-radius: var(--radius);
      transition: color var(--transition), transform var(--transition);
    }

    .plaza__chevron:hover {
      color: var(--text-color);
    }

    .plaza__chevron:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .plaza__chevron svg {
      transform: rotate(90deg);
      transition: transform var(--transition);
    }

    .plaza__chevron--collapsed svg {
      transform: rotate(0deg);
    }

    .plaza__chevron--placeholder {
      inline-size: 14px;
      block-size: 14px;
    }

    .plaza__house-link {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-inline-size: 0;
      color: var(--text-color);
      text-decoration: none;
    }

    .plaza__house-link:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
      border-radius: var(--radius);
    }

    .plaza__house-name {
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 500;
      letter-spacing: -0.01em;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__house-sub {
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__projects {
      list-style: none;
      margin: 0;
      padding-inline-start: calc(3px + var(--space-xs) + 14px + var(--space-xs));
      padding-block-start: var(--space-xs);
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .plaza__project {
      display: block;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      color: var(--text-color);
      text-decoration: none;
      border-radius: var(--radius);
      transition: background-color var(--transition);
    }

    .plaza__project:hover {
      background: var(--bg-hover);
    }

    .plaza__project:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: -2px;
    }

    .plaza__project--active {
      background: var(--bg-active);
    }

    .plaza__project--active .plaza__project-name {
      color: var(--primary);
    }

    .plaza__project-name {
      font-size: var(--text-s);
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__empty {
      margin: 0;
      padding-inline-start: calc(3px + var(--space-xs) + 14px + var(--space-xs));
      padding-block: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-style: italic;
    }

    .plaza__state {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .plaza__state--danger {
      color: var(--danger);
    }
  }
</style>
