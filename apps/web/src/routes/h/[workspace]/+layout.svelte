<script lang="ts">
  /**
   * Workspace shell (ADR-029) — user-scoped sidebar with simultaneous
   * workspaces + lens nav as horizontal pills at the top of main.
   *
   * - Sidebar upper: <Plaza /> (multi-workspace project list, user-scoped).
   * - Sidebar lower: <RoomStructure /> (lines+shows of selected project).
   * - Top of main: horizontal lens pills + breadcrumb + search.
   * - Main content: routed page (Today on the empty home, or entity sub-pages).
   *
   * The URL still carries one workspace (ADR-022 path-prefix); the sidebar
   * shows all the user's workspaces regardless of the URL workspace.
   *
   * Visual refresh 2026-05-18 (ADR-033): editorial v0.5. Newsreader display
   * wordmark, Inter pills, mono breadcrumb + kbd. Plum retired.
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
  import Pill from '$lib/components/Pill.svelte';
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
  const lens = provideLens('today');

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

  $effect(() => {
    saveMasterViewPath(page.url.pathname);
  });

  let rt = $state<RealtimeHandle | null>(null);
  let networkPresence = $state<NetworkPresenceStore | null>(null);

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
  let allActive = $state(false);

  const lensOptions: { id: Lens; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'money', label: 'Money' },
  ];

  let breadcrumbDate = $derived.by(() => {
    const d = new Date();
    return d
      .toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
      .toUpperCase();
  });

  function logout() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }
</script>

{#if !blocked}
  <div class="workspace-shell">
    <Sidebar bind:open={sidebarOpen} label="Projects">
      {#snippet header()}
        <a class="workspace-shell__brand" href={`/h/${workspaceSlug}/`}>
          hour
        </a>
      {/snippet}
      {#snippet children()}
        <Plaza />
        <RoomStructure />
      {/snippet}
      {#snippet footer()}
        <Avatar size="s" name={workspaceSlug} accentSlug={workspaceSlug} />
        <span class="workspace-shell__footer-id">{workspaceSlug}</span>
        <a
          class="workspace-shell__footer-link"
          href={`/h/${workspaceSlug}/settings`}
        >
          Settings
        </a>
        <button
          type="button"
          class="workspace-shell__footer-link"
          onclick={logout}
        >
          Sign out
        </button>
      {/snippet}
    </Sidebar>

    <main class="workspace-shell__main">
      <header class="workspace-shell__topbar">
        <button
          type="button"
          class="workspace-shell__toggle"
          onclick={() => (sidebarOpen = !sidebarOpen)}
          aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'}
        >☰</button>

        <nav class="workspace-shell__lenses" aria-label="Lens">
          {#each lensOptions as opt (opt.id)}
            <Pill
              active={lens.current === opt.id}
              ariaCurrent={lens.current === opt.id ? 'true' : undefined}
              onclick={() => lens.set(opt.id)}
            >
              {opt.label}
            </Pill>
          {/each}
        </nav>

        <span class="workspace-shell__crumb">
          {workspaceSlug.toUpperCase()} · {breadcrumbDate}
        </span>

        <div class="workspace-shell__right">
          <label class="workspace-shell__search">
            <input
              type="search"
              placeholder="Search or jump…"
              aria-label="Search"
            />
            <kbd class="kbd">⌘K</kbd>
          </label>

          <PresenceBadge count={networkPresence?.count ?? null} />

          <Pill
            all
            active={allActive}
            onclick={() => (allActive = !allActive)}
            ariaLabel="Toggle scope to all projects"
          >
            All
          </Pill>
        </div>
      </header>

      <div class="workspace-shell__content">
        {#if children}{@render children()}{/if}
      </div>
    </main>
  </div>
{/if}

<style>
  .workspace-shell {
    display: flex;
    min-block-size: 100vh;
    background: var(--bg);
  }

  /* The sidebar root is set via :global because Sidebar.svelte is a child
     component; we widen it here for the desktop frame. */
  .workspace-shell :global(.sidebar) {
    --sidebar-width: var(--sidebar-width, 264px);
    background: var(--bg);
    border-inline-end: 1px solid var(--border-color);
  }

  .workspace-shell :global(.sidebar__header) {
    padding-block: var(--pad-lg);
    padding-inline: var(--pad-lg);
    border-block-end: 0;
  }

  .workspace-shell :global(.sidebar__body) {
    padding-block: var(--pad);
    padding-inline: var(--pad-sm);
    gap: var(--pad);
  }

  .workspace-shell :global(.sidebar__footer) {
    padding-block: var(--pad);
    padding-inline: var(--pad-lg);
    border-block-start: 1px solid var(--border-color-soft);
    gap: var(--pad-sm);
  }

  .workspace-shell__brand {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-xl);
    font-weight: 400;
    color: var(--text-color);
    text-decoration: none;
    letter-spacing: -0.01em;
  }

  .workspace-shell__footer-id {
    flex: 1;
    font-size: var(--text-s);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-shell__footer-link {
    font-size: var(--text-xs);
    color: var(--text-faint);
    text-decoration: none;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
    transition: color var(--transition);
  }

  .workspace-shell__footer-link:hover {
    color: var(--text-color);
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
    gap: var(--pad);
    padding-block: var(--pad-sm);
    padding-inline: var(--pad-lg);
    border-block-end: 1px solid var(--border-color-soft);
    background: var(--bg);
  }

  .workspace-shell__toggle {
    inline-size: 32px;
    block-size: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background var(--transition), color var(--transition),
      border-color var(--transition);
  }

  .workspace-shell__toggle:hover {
    background: var(--bg-hover);
    color: var(--text-color);
  }

  .workspace-shell__lenses {
    display: flex;
    align-items: center;
    gap: var(--pad-xs);
  }

  .workspace-shell__crumb {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xxs);
    color: var(--text-faint);
    letter-spacing: 0.16em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-shell__right {
    display: flex;
    align-items: center;
    gap: var(--pad-sm);
  }

  .workspace-shell__search {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-xs);
    padding-block: 4px;
    padding-inline: var(--pad-sm);
    background: var(--bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    transition: border-color var(--transition);
    min-inline-size: 220px;
  }

  .workspace-shell__search:focus-within {
    border-color: var(--text-muted);
  }

  .workspace-shell__search input {
    flex: 1;
    min-inline-size: 0;
    background: transparent;
    border: 0;
    outline: none;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-color);
  }

  .workspace-shell__search input::placeholder {
    color: var(--text-faint);
  }

  .workspace-shell__content {
    flex: 1;
    padding-block: var(--pad-2xl);
    padding-inline: var(--pad-2xl);
  }

  @media (max-width: 47.999rem) {
    .workspace-shell__crumb {
      display: none;
    }
    .workspace-shell__search {
      min-inline-size: 140px;
    }
    .workspace-shell__content {
      padding-inline: var(--pad-lg);
    }
  }
</style>
