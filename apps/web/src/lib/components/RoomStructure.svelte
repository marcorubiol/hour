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
   * Room header + empty state until that data arrives. Empty home (no Room
   * selected) shows the prompt placeholder.
   *
   * Endpoints `/api/runs` and `/api/gigs` are roadmap Phase 0.1 trabajo
   * #6 — not built yet. This component fetches them lazily once they
   * exist; for now it short-circuits to the empty-runs state when a Room
   * is selected.
   */

  import { page } from '$app/state';
  import { useSelection } from '$lib/stores/selection.svelte';

  const selection = useSelection();

  let activeRoomSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/room\/([^/]+)/);
    return m?.[1] ?? '';
  });

  let activeWorkspaceSlug = $derived(page.params.workspace ?? '');
  let hasRoom = $derived(activeRoomSlug.length > 0);
</script>

<aside class="room-structure" aria-label="Room structure">
  {#if hasRoom}
    <header class="room-structure__header">
      <small class="room-structure__eyebrow">Room</small>
      <strong>{activeRoomSlug}</strong>
    </header>
    <p class="room-structure__empty">No runs yet.</p>
  {:else}
    <p class="room-structure__empty room-structure__empty--prompt">
      Select a Room to see its structure
    </p>
  {/if}
</aside>

<style>
  @layer components {
    .room-structure {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-start: var(--space-m);
      border-block-start: var(--divider);
    }

    .room-structure__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .room-structure__eyebrow {
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .room-structure__empty {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-dark-muted);
    }

    .room-structure__empty--prompt {
      font-style: italic;
      text-align: center;
    }
  }
</style>
