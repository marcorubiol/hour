<script lang="ts">
  /**
   * Plaza — user-scoped sidebar tree.
   *
   * Shows ALL Houses the user is a member of, each followed by its Rooms.
   * Single-select per Room via URL navigation. Multi-house simultaneous
   * display is the architectural backbone for freelancers and multi-hat
   * users (`research/profiles/99-patterns.md §5`; ADR-029).
   *
   * Phase 0 reality: Marco belongs to two Houses — `marco-rubiol` (personal,
   * empty) and `mamemi` (team, holds the 154-engagement difusión project).
   * Both render here side by side.
   *
   * Offline cache via IDB deferred to Phase 0.2 batch with TanStack Query
   * persister; this iteration is memory-cache only.
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';

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

  // Active scope from URL: which workspace and which room (if any).
  let activeWorkspaceSlug = $derived(page.params.workspace ?? '');
  let activeRoomSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/room\/([^/]+)/);
    return m?.[1] ?? '';
  });

  let houses = $derived($housesQuery.data?.items ?? []);
  let rooms = $derived($roomsQuery.data?.items ?? []);

  // Group rooms under their parent House. Houses with zero active rooms
  // still render with their header so the user knows the House exists and
  // can be navigated into.
  let tree = $derived(
    houses.map((house) => ({
      house,
      rooms: rooms.filter((r) => r.workspace_id === house.id),
    })),
  );

  let loading = $derived($housesQuery.isPending || $roomsQuery.isPending);
  let errored = $derived($housesQuery.isError || $roomsQuery.isError);
</script>

<nav class="plaza" aria-label="Houses and rooms">
  {#if loading}
    <p class="plaza__state">Loading…</p>
  {:else if errored}
    <p class="plaza__state plaza__state--danger">Couldn't load houses.</p>
  {:else if tree.length === 0}
    <p class="plaza__state">No houses yet.</p>
  {:else}
    {#each tree as { house, rooms: houseRooms } (house.id)}
      {@const isUrlHouse = house.slug === activeWorkspaceSlug}
      {@const isActiveHouse = isUrlHouse && activeRoomSlug === ''}
      {@const isOnHousePath = isUrlHouse && activeRoomSlug !== ''}
      <section class="plaza__house">
        <a
          class={[
            'plaza__house-link',
            isActiveHouse && 'plaza__house-link--active',
            isOnHousePath && 'plaza__house-link--on-path',
          ]
            .filter(Boolean)
            .join(' ')}
          href={`/h/${house.slug}/`}
          aria-current={isActiveHouse ? 'page' : undefined}
        >
          <input type="checkbox" disabled aria-hidden="true" tabindex="-1" />
          <strong>{house.name}</strong>
        </a>

        {#if houseRooms.length > 0}
          <ul class="plaza__rooms">
            {#each houseRooms as room (room.id)}
              {@const isActiveRoom =
                room.slug === activeRoomSlug && house.slug === activeWorkspaceSlug}
              <li>
                <a
                  class={['plaza__room', isActiveRoom && 'plaza__room--active']
                    .filter(Boolean)
                    .join(' ')}
                  href={`/h/${house.slug}/room/${room.slug}`}
                  aria-current={isActiveRoom ? 'page' : undefined}
                >{room.name}</a>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="plaza__rooms-empty">No rooms yet</p>
        {/if}
      </section>
    {/each}
  {/if}
</nav>

<style>
  @layer components {
    .plaza {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .plaza__house {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .plaza__house-link {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-radius: var(--radius-s);
      color: var(--text-color);
      text-decoration: none;
      transition: background-color 120ms ease-out;
    }

    .plaza__house-link:hover {
      background: color-mix(in oklch, var(--neutral) 6%, transparent);
    }

    .plaza__house-link:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    .plaza__house-link--active {
      color: var(--primary);
    }

    /* Cross-highlight UP: when a Room of this House is the current page,
       the House label gets primary color too — softer than --active, no
       background — so the hierarchy is visible at a glance. */
    .plaza__house-link--on-path {
      color: var(--primary);
    }

    .plaza__house-link input[type='checkbox'] {
      margin: 0;
      pointer-events: none;
      opacity: 0.6;
    }

    .plaza__rooms {
      list-style: none;
      padding: 0;
      margin: 0;
      padding-inline-start: var(--space-l);
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    /* Empty placeholder for Houses with zero active Rooms. Tells the user
       the House is intentionally empty instead of hiding the fact and
       leaving an ambiguous gap below the header. */
    .plaza__rooms-empty {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline-start: var(--space-l);
      font-size: var(--text-s);
      font-style: italic;
      color: var(--text-dark-muted);
    }

    .plaza__room {
      --plaza-room-color: var(--text-color);
      --plaza-room-bg: transparent;
      display: block;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-radius: var(--radius-s);
      color: var(--plaza-room-color);
      background: var(--plaza-room-bg);
      text-decoration: none;
      font-size: var(--text-s);
      transition: background-color 120ms ease-out;
    }

    .plaza__room:hover {
      --plaza-room-bg: color-mix(in oklch, var(--neutral) 10%, transparent);
    }

    .plaza__room:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    .plaza__room--active {
      --plaza-room-color: var(--primary);
      --plaza-room-bg: color-mix(in oklch, var(--primary) 14%, transparent);
      font-weight: 500;
    }

    .plaza__state {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-dark-muted);
    }

    .plaza__state--danger {
      color: var(--danger);
    }
  }
</style>
