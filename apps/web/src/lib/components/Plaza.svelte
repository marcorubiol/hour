<script lang="ts">
  /**
   * Plaza — sidebar upper section showing House (workspace) and its Rooms
   * (projects). Single-select via native link navigation; the URL is the
   * source of truth for which room is active. SelectionStore is synced from
   * the URL one level up (in the workspace layout).
   *
   * Phase 0 renders a flat list: one House (`marco-rubiol`) + its active
   * Rooms (one for now: `mamemi`). The data shape supports multi-House for
   * Phase 1 without changing the component contract.
   *
   * Roadmap Phase 0.1 trabajo #1. DoD note: offline cache via IDB is
   * intentionally deferred — Phase 0.0 closure parked TanStack Query
   * persisted cache to Phase 0.2+. Plaza fetches live and uses the
   * QueryClient memory cache only.
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';

  type House = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
    timezone: string | null;
    country: string | null;
  };

  type Room = {
    id: string;
    slug: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    workspace_id: string;
    starts_on: string | null;
    ends_on: string | null;
    updated_at: string;
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

  let workspaceSlug = $derived(page.params.workspace ?? '');

  // Active room slug is derived from the URL. The pathname matches
  // /h/:workspace/room/:slug exactly — children further down (asset-tabs,
  // gig sub-views) don't override the room context.
  let activeRoomSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/room\/([^/]+)/);
    return m?.[1] ?? '';
  });

  let house = $derived($housesQuery.data?.items[0] ?? null);
  let rooms = $derived($roomsQuery.data?.items ?? []);
  let loading = $derived($housesQuery.isPending || $roomsQuery.isPending);
  let errored = $derived($housesQuery.isError || $roomsQuery.isError);
</script>

<nav class="plaza" aria-label="Workspace rooms">
  <header class="plaza__house">
    <small class="plaza__house-eyebrow">House</small>
    {#if house}
      <strong>{house.name}</strong>
    {:else if loading}
      <span class="plaza__skeleton" aria-hidden="true">·····</span>
    {:else}
      <span class="text--dark-muted">{workspaceSlug}</span>
    {/if}
  </header>

  {#if loading}
    <p class="plaza__state">Loading rooms…</p>
  {:else if errored}
    <p class="plaza__state plaza__state--danger">Couldn't load rooms.</p>
  {:else if rooms.length === 0}
    <p class="plaza__state">No rooms yet.</p>
  {:else}
    <ul class="plaza__rooms">
      {#each rooms as room (room.id)}
        {@const isActive = room.slug === activeRoomSlug}
        <li>
          <a
            class={['plaza__room', isActive && 'plaza__room--active']
              .filter(Boolean)
              .join(' ')}
            href={`/h/${workspaceSlug}/room/${room.slug}`}
            aria-current={isActive ? 'page' : undefined}
          >{room.name}</a>
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

    .plaza__house {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-end: var(--space-xs);
      border-block-end: var(--divider);
    }

    .plaza__house-eyebrow {
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .plaza__skeleton {
      color: var(--text-dark-muted);
      letter-spacing: 0.2em;
    }

    .plaza__rooms {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
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
