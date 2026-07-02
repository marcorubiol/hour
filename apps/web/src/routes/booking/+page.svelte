<script lang="ts">
  /**
   * /booking — legacy full-list view of the MaMeMi difusión 2026-27.
   * Thin wrapper over EngagementTable since the Contacts lens landed
   * (ADR-044); kept for muscle memory and old bookmarks. The lens at
   * /h/[ws]/contacts is the canonical surface.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import EngagementTable from '$lib/components/EngagementTable.svelte';
  import { clearAuthAndBounce } from '$lib/api';

  onMount(() => {
    if (!localStorage.getItem('hour_jwt')) {
      goto('/login', { replaceState: true });
    }
  });

  function logout() {
    clearAuthAndBounce();
  }
</script>

<svelte:head>
  <title>Booking 2026-27 — Hour</title>
</svelte:head>

<header class="app-header">
  <h1 class="h4">
    Hour <span class="text--dark-muted">/ Booking 2026-27</span>
  </h1>
  <button class="btn--outline" onclick={logout}>Sign out</button>
</header>

<div class="booking-body">
  <EngagementTable
    filters={{ projectSlug: 'mamemi', season: '2026-27', status: 'any' }}
    personBase="/h/muk-cia/person"
  />
</div>

<style>
  @layer components {
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      border-block-end: var(--divider);
    }

    .booking-body {
      padding-inline: var(--gutter);
    }
  }
</style>
