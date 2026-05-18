<script lang="ts">
  /**
   * Room detail — Phase 0.1.
   *
   * Header (Room display name + meta) + Relationships block (showing
   * engagements in this Room). Stub sections for Runs/Gigs, Assets, Team
   * are intentionally minimal until the corresponding data exists or the
   * later Phase 0.x trabajos build their UI.
   *
   * Display name is read from the rooms TanStack Query cache (same key as
   * Plaza) — both views share state without a refetch.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import RelationshipStub from '$lib/components/RelationshipStub.svelte';

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
      throw new Error(`Error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  // Reuse Plaza's query key — TanStack caches by key, so this hits the
  // cache when arriving from Plaza and only fires a fetch on direct URL
  // entry.
  const roomsQuery = createQuery({
    queryKey: ['rooms', { status: 'active' }],
    queryFn: ({ signal }) =>
      fetchJSON<{ items: Room[] }>('/api/rooms?status=active', signal),
  });

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let roomSlug = $derived(page.params.slug ?? '');

  let room = $derived(
    $roomsQuery.data?.items.find((r) => r.slug === roomSlug) ?? null,
  );

  let displayName = $derived(room?.name ?? roomSlug);
  let roomLoading = $derived($roomsQuery.isPending && !room);
</script>

<svelte:head>
  <title>{displayName} — Hour</title>
</svelte:head>

<article class="room">
  <header class="room__header">
    <p class="room__eyebrow">Room</p>
    <h1 class="room__title">
      {#if roomLoading}<span class="room__skeleton" aria-hidden="true">…</span>{:else}{displayName}{/if}
    </h1>
    {#if room}
      <p class="room__meta">
        <span>Status: {room.status}</span>
        {#if room.starts_on}<span>· From {room.starts_on}</span>{/if}
        {#if room.ends_on}<span>· To {room.ends_on}</span>{/if}
      </p>
    {/if}
  </header>

  <RelationshipStub projectSlug={roomSlug} />

  <section class="room__stubs" aria-label="Pending sections">
    <div class="room__stub">
      <h3 class="room__stub-title">Runs &amp; Gigs</h3>
      <p class="room__stub-body">No runs yet. Will appear here when the first show is confirmed (Phase 0.1 trabajo #6 + production).</p>
    </div>
    <div class="room__stub">
      <h3 class="room__stub-title">Assets</h3>
      <p class="room__stub-body">Riders, dossiers, stage plots — Phase 0.5 (asset upload).</p>
    </div>
    <div class="room__stub">
      <h3 class="room__stub-title">Team</h3>
      <p class="room__stub-body">Project members &amp; permissions — Phase 0.3.</p>
    </div>
  </section>
</article>

<style>
  .room {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
    max-inline-size: 56rem;
  }

  .room__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .room__eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-dark-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .room__title {
    margin: 0;
    font-size: var(--text-xxl);
    font-weight: 500;
    line-height: 1.1;
  }

  .room__skeleton {
    color: var(--text-dark-muted);
  }

  .room__meta {
    margin: 0;
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
    font-size: var(--text-s);
    color: var(--text-dark-muted);
  }

  .room__stubs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-m);
  }

  .room__stub {
    padding: var(--space-m);
    border: 1px dashed var(--neutral-light);
    border-radius: var(--radius);
    background: transparent;
  }

  .room__stub-title {
    margin: 0;
    margin-block-end: var(--space-xs);
    font-size: var(--text-s);
    font-weight: 500;
    color: var(--text-color);
  }

  .room__stub-body {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-dark-muted);
  }
</style>
