<script lang="ts">
  /**
   * RoomStructure — sidebar lower section.
   *
   * Shows the internal structure of the currently-selected Room: its Runs
   * (collapsible) and their Gigs. Replaces the `<Desk>` component the
   * original roadmap planned — naming + scope absorbed into the Rooms lens
   * + this tree (ADR-029).
   *
   * Phase 0 reality: no runs/gigs exist in DB yet. Component renders the
   * Room display name + empty state until that data arrives. Empty home
   * (no Room selected) shows the prompt placeholder.
   *
   * Room display name is read from the rooms TanStack Query cache (same
   * `['rooms', { status: 'active' }]` key as Plaza + Room detail) — no
   * extra fetch, no slug-vs-name drift between the three views.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';

  type Room = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  async function fetchRooms(signal: AbortSignal): Promise<{ items: Room[] }> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      goto('/login', { replaceState: true });
      throw new Error('Missing JWT');
    }
    const res = await fetch('/api/rooms?status=active', {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Room[] };
  }

  const roomsQuery = createQuery({
    queryKey: ['rooms', { status: 'active' }],
    queryFn: ({ signal }) => fetchRooms(signal),
  });

  let activeRoomSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/room\/([^/]+)/);
    return m?.[1] ?? '';
  });

  let hasRoom = $derived(activeRoomSlug.length > 0);

  let activeRoom = $derived(
    $roomsQuery.data?.items.find((r) => r.slug === activeRoomSlug) ?? null,
  );

  // Display name with sensible fallbacks: cached row > slug while loading >
  // raw slug if the room isn't visible (shouldn't happen given RLS, but
  // keeps the empty state honest).
  let displayName = $derived(activeRoom?.name ?? activeRoomSlug);
</script>

<aside class="project-structure" aria-label="Project structure">
  {#if hasRoom}
    <header class="project-structure__header">
      <span class="eyebrow">Lines</span>
    </header>
    <p class="project-structure__empty">No lines yet.</p>
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
      padding-block-start: var(--pad-lg);
      margin-block-start: var(--pad-lg);
      border-block-start: var(--divider-light);
    }

    .project-structure__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-inline: var(--pad-sm);
    }

    .project-structure__empty {
      margin: 0;
      padding-block: var(--pad-xs);
      padding-inline: var(--pad-sm);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .project-structure__empty--prompt {
      font-style: italic;
      text-align: center;
    }
  }
</style>
