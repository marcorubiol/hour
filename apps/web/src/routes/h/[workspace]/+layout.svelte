<script lang="ts">
  /**
   * Workspace shell (ADR-029) — user-scoped sidebar with simultaneous
   * houses + lens nav as horizontal pills at the top of main.
   *
   * - Sidebar upper: <Plaza /> (multi-house tree, user-scoped).
   * - Sidebar lower: <RoomStructure /> (runs+gigs of selected Room).
   * - Top of main: horizontal lens pills + "All" chip placeholder.
   * - Main content: routed page (`/h/[workspace]/+page.svelte` for the
   *   empty home, or entity sub-pages).
   *
   * The URL still carries one workspace (ADR-022 path-prefix); the sidebar
   * shows all the user's houses regardless of the URL workspace.
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import type { Snippet } from 'svelte';
  import { onDestroy, onMount } from 'svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Plaza from '$lib/components/Plaza.svelte';
  import RoomStructure from '$lib/components/RoomStructure.svelte';
  import PresenceBadge from '$lib/components/PresenceBadge.svelte';
  import { isReservedWorkspaceSlug } from '$lib/reserved-slugs';
  import { provideLens, type Lens } from '$lib/stores/lens.svelte';
  import { provideSelection } from '$lib/stores/selection.svelte';
  import { saveMasterViewPath } from '$lib/master-view';
  import {
    provideNetworkPresence,
    provideRealtime,
    type NetworkPresenceStore,
    type RealtimeHandle,
  } from '$lib/realtime';
  import { createQuery } from '@tanstack/svelte-query';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let blocked = $derived(isReservedWorkspaceSlug(workspaceSlug));

  $effect(() => {
    if (blocked) goto('/', { replaceState: true });
  });

  const selection = provideSelection();
  const lens = provideLens('rooms');

  $effect(() => {
    selection.setWorkspace(workspaceSlug);
  });

  $effect(() => {
    const path = page.url.pathname;
    const m = path.match(/^\/h\/[^/]+\/(room|gig|engagement|person|run|venue|asset|invoice)\/([^/]+)/);
    if (m) {
      selection.setEntity({ type: m[1] as never, slug: m[2] });
    } else {
      selection.clear();
    }
  });

  // Master View — remember the path each time we navigate, but only if
  // the user opted in via /settings. Helper short-circuits when feature
  // is off or the path isn't saveable (e.g. /settings itself).
  $effect(() => {
    saveMasterViewPath(page.url.pathname);
  });

  // Hybrid presence model B (ADR-029 follow-up 2026-05-18, per Marco's
  // call): the topbar shows NETWORK presence — distinct users connected
  // across ALL workspaces this user is a member of. Per-Room / per-
  // RoadSheet contextual presence will layer on top in Phase 0.2.
  //
  // $state so PresenceBadge re-renders when these get assigned inside
  // onMount (browser-only providers).
  let rt = $state<RealtimeHandle | null>(null);
  let networkPresence = $state<NetworkPresenceStore | null>(null);

  // Drive the network presence subscriptions from the houses list (same
  // query key as Plaza — TanStack caches by key, so this hits the cache
  // and the badge connects as soon as Plaza's data lands).
  type HouseLite = { id: string; slug: string; name: string };
  const housesQuery = createQuery({
    queryKey: ['houses'],
    queryFn: async ({ signal }) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) throw new Error('Missing JWT');
      const res = await fetch('/api/houses', {
        signal,
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return (await res.json()) as { items: HouseLite[] };
    },
  });

  onMount(() => {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt || !env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return;
    try {
      rt = provideRealtime(
        {
          PUBLIC_SUPABASE_URL: env.PUBLIC_SUPABASE_URL,
          PUBLIC_SUPABASE_ANON_KEY: env.PUBLIC_SUPABASE_ANON_KEY,
        },
        jwt,
      );
      networkPresence = provideNetworkPresence();
    } catch (e) {
      console.warn('[realtime] init failed, continuing without presence:', e);
    }
  });

  // Sync the subscribed channel set as the houses list changes (initial
  // load, future invitations, etc.). Idempotent — setWorkspaces handles
  // diff + dispose internally.
  $effect(() => {
    const slugs = $housesQuery.data?.items.map((h) => h.slug) ?? [];
    if (networkPresence && slugs.length > 0) {
      networkPresence.setWorkspaces(slugs);
    }
  });

  onDestroy(() => {
    networkPresence?.dispose();
    rt?.dispose();
  });

  let sidebarOpen = $state(true);

  const lensOptions: { id: Lens; label: string }[] = [
    { id: 'rooms', label: 'Rooms' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'money', label: 'Money' },
  ];

  function logout() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }
</script>

{#if !blocked}
  <div class="workspace-shell">
    <Sidebar bind:open={sidebarOpen} label="Houses and rooms">
      {#snippet header()}
        <label class="workspace-shell__brand">
          <input type="checkbox" disabled aria-hidden="true" tabindex="-1" />
          <strong>Hour</strong>
        </label>
      {/snippet}
      {#snippet children()}
        <Plaza />
        <RoomStructure />
      {/snippet}
      {#snippet footer()}
        <Avatar size="s" name={workspaceSlug} tone="primary" />
        <span class="text--s workspace-shell__footer-id">{workspaceSlug}</span>
        <a class="btn--outline btn--xs" href={`/h/${workspaceSlug}/settings`}>
          Settings
        </a>
        <button type="button" class="btn--outline btn--xs" onclick={logout}>
          Sign out
        </button>
      {/snippet}
    </Sidebar>

    <main class="workspace-shell__main">
      <header class="workspace-shell__topbar">
        <button
          type="button"
          class="btn--outline btn--s workspace-shell__toggle"
          onclick={() => (sidebarOpen = !sidebarOpen)}
          aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'}
        >☰</button>

        <nav class="workspace-shell__lenses" aria-label="Lens">
          {#each lensOptions as opt (opt.id)}
            <button
              type="button"
              class={['workspace-shell__lens', lens.current === opt.id && 'workspace-shell__lens--active']
                .filter(Boolean)
                .join(' ')}
              aria-current={lens.current === opt.id ? 'true' : undefined}
              onclick={() => lens.set(opt.id)}
            >{opt.label}</button>
          {/each}
        </nav>

        <PresenceBadge count={networkPresence?.count ?? null} />

        <label class="workspace-shell__all">
          <input type="checkbox" disabled aria-hidden="true" tabindex="-1" />
          <span class="text--s">All</span>
        </label>
      </header>

      <div class="workspace-shell__content">
        {#if children}{@render children()}{/if}
      </div>
    </main>
  </div>
{/if}

<style>
  /* Component-scoped styles. Svelte adds a hash class to every selector for
     isolation; we don't wrap in `@layer components` because component CSS
     scoping plus higher selector specificity is enough to win over the
     reset's `button { background: none; border: 0; padding: 0 }`. The
     `@layer` wrapper interacts badly with HMR ordering in some setups. */

  .workspace-shell {
    display: flex;
    min-block-size: 100vh;
  }

  .workspace-shell__brand {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .workspace-shell__brand input[type='checkbox'] {
    margin: 0;
    pointer-events: none;
    opacity: 0.6;
  }

  .workspace-shell__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  .workspace-shell__topbar {
    display: flex;
    align-items: center;
    gap: var(--space-m);
    padding-block: var(--space-s);
    padding-inline: var(--gutter);
    border-block-end: var(--divider);
    background: var(--base);
  }

  .workspace-shell__toggle {
    padding-inline: var(--space-s);
  }

  .workspace-shell__lenses {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex: 1;
    justify-content: center;
  }

  .workspace-shell__lens {
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    border-radius: 999px;
    border: 1px solid var(--neutral-light);
    background: transparent;
    color: var(--text-color);
    font-family: inherit;
    font-size: var(--text-s);
    line-height: 1.2;
    cursor: pointer;
    transition: background-color 120ms ease-out, color 120ms ease-out,
      border-color 120ms ease-out;
  }

  .workspace-shell__lens:hover {
    background: var(--neutral-ultra-light);
  }

  .workspace-shell__lens:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .workspace-shell__lens--active {
    background: var(--text-dark);
    color: var(--base);
    border-color: var(--text-dark);
  }

  .workspace-shell__lens--active:hover {
    background: var(--text-dark);
  }

  .workspace-shell__all {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    border-radius: 999px;
    border: 1px solid var(--neutral-light);
    font-size: var(--text-s);
  }

  .workspace-shell__all input[type='checkbox'] {
    margin: 0;
    pointer-events: none;
    opacity: 0.6;
  }

  .workspace-shell__content {
    flex: 1;
    padding: var(--space-l);
  }
</style>
