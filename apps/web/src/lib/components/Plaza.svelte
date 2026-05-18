<script lang="ts">
  /**
   * Plaza — user-scoped sidebar tree.
   *
   * Shows ALL workspaces the user is a member of as flat "project" rows
   * (editorial-sobrio v0.5 design). Each row carries an accent rail
   * (hashed from slug), the workspace name in display serif, a subtitle,
   * and a count of active rooms. Clicking a row navigates to the workspace
   * home; the internal structure (lines + shows) then appears in the
   * sidebar lower via <RoomStructure />.
   *
   * Rooms are still fetched in the same query so the count is real and
   * the cache is warm for RoomStructure / Today view.
   *
   * Phase 0 reality: Marco belongs to two workspaces — `marco-rubiol`
   * (personal, empty) and `mamemi` (team, holds the 154-engagement
   * difusión project). Both render here side by side.
   */

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

  let projectRows = $derived(
    houses.map((house) => ({
      house,
      count: rooms.filter((r) => r.workspace_id === house.id).length,
      subtitle:
        house.kind === 'personal' ? 'Personal workspace' : 'Team workspace',
    })),
  );

  let loading = $derived($housesQuery.isPending || $roomsQuery.isPending);
  let errored = $derived($housesQuery.isError || $roomsQuery.isError);
</script>

<nav class="plaza" aria-label="Projects">
  <p class="eyebrow plaza__eyebrow">Projects</p>

  {#if loading}
    <p class="plaza__state">Loading…</p>
  {:else if errored}
    <p class="plaza__state plaza__state--danger">Couldn't load projects.</p>
  {:else if projectRows.length === 0}
    <p class="plaza__state">No projects yet.</p>
  {:else}
    <ul class="plaza__list" role="list">
      {#each projectRows as { house, count, subtitle } (house.id)}
        {@const isUrlHouse = house.slug === activeWorkspaceSlug}
        {@const isActive = isUrlHouse && activeRoomSlug === ''}
        {@const isOnPath = isUrlHouse && activeRoomSlug !== ''}
        <li>
          <a
            class={[
              'plaza__row',
              isActive && 'plaza__row--active',
              isOnPath && 'plaza__row--on-path',
            ]
              .filter(Boolean)
              .join(' ')}
            href={`/h/${house.slug}/`}
            aria-current={isActive ? 'page' : undefined}
            style={`--c: ${accentVar(house.slug)}`}
          >
            <span class="plaza__row-rail" aria-hidden="true"></span>
            <span class="plaza__row-body">
              <span class="plaza__row-name">{house.name}</span>
              <span class="plaza__row-sub">{subtitle}</span>
            </span>
            <span class="plaza__row-count">{count}</span>
          </a>
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
      gap: var(--pad-sm);
    }

    .plaza__eyebrow {
      margin: 0;
      padding-inline: var(--pad-sm);
    }

    .plaza__list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .plaza__row {
      display: grid;
      grid-template-columns: 3px 1fr auto;
      gap: var(--pad);
      align-items: center;
      padding-block: var(--pad-sm);
      padding-inline: var(--pad-sm);
      color: var(--text-color);
      text-decoration: none;
      border-radius: var(--radius);
      transition: background-color var(--transition);
    }

    .plaza__row:hover {
      background: var(--bg-hover);
    }

    .plaza__row:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: -2px;
    }

    .plaza__row--active {
      background: var(--bg-active);
    }

    .plaza__row--on-path .plaza__row-name {
      color: var(--text-color);
    }

    .plaza__row-rail {
      inline-size: 3px;
      block-size: 28px;
      background: var(--c, var(--text-muted));
      border-radius: 2px;
      align-self: center;
    }

    .plaza__row-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-inline-size: 0;
    }

    .plaza__row-name {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      letter-spacing: -0.01em;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__row-sub {
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__row-count {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }

    .plaza__state {
      margin: 0;
      padding-block: var(--pad-xs);
      padding-inline: var(--pad-sm);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .plaza__state--danger {
      color: var(--danger);
    }
  }
</style>
