<script lang="ts">
  /**
   * Workspace shell (ADR-029) — user-scoped sidebar with simultaneous
   * workspaces + lens nav as horizontal pills at the top of main.
   *
   * - Sidebar upper: <Plaza /> (multi-workspace project list, user-scoped).
   * - Sidebar lower: <LineList /> (lines+shows of selected project).
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
  import PlazaRail from '$lib/components/PlazaRail.svelte';
  import LineList from '$lib/components/LineList.svelte';
  import PresenceBadge from '$lib/components/PresenceBadge.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { useTheme } from '$lib/theme.svelte';
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

  // Hydrate selection from URL on every navigation. Idempotent — the store
  // bails if parsed state matches current state.
  $effect(() => {
    selection.hydrateFromUrl(page.url);
  });

  $effect(() => {
    saveMasterViewPath(page.url.pathname);
  });

  let rt = $state<RealtimeHandle | null>(null);
  let networkPresence = $state<NetworkPresenceStore | null>(null);

  type WorkspaceLite = { id: string; slug: string; name: string };
  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: async ({ signal }) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) throw new Error('Missing JWT');
      const res = await fetch('/api/workspaces', {
        signal,
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return (await res.json()) as { items: WorkspaceLite[] };
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
    const slugs = $workspacesQuery.data?.items.map((h) => h.slug) ?? [];
    if (networkPresence && slugs.length > 0) {
      networkPresence.setWorkspaces(slugs);
    }
  });

  onDestroy(() => {
    networkPresence?.dispose();
    rt?.dispose();
  });

  const theme = useTheme();

  let sidebarOpen = $state(true);
  let sidebarCollapsed = $state(false);
  let allActive = $state(false);

  // Persist the collapsed/expanded preference across sessions. Width
  // (when expanded) is persisted independently by <Sidebar>.
  const SIDEBAR_COLLAPSED_KEY = 'hour_sidebar_collapsed';
  onMount(() => {
    try {
      sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      // Storage disabled — start expanded.
    }
  });
  function toggleCollapsed() {
    sidebarCollapsed = !sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }

  // Decode the user's email from the JWT payload. Phase 0: identity surfaces
  // as the email since user_metadata has no display_name yet. When a profile
  // entity exists (Phase 0.9+), swap this for the name.
  let userEmail = $state('');
  onMount(() => {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]));
      userEmail = payload.email ?? '';
    } catch { /* malformed jwt — leave empty */ }
  });

  // Theme style picker — accordion inside the account menu. Five style
  // identities; selecting one calls theme.setTheme() which writes the
  // data-theme attribute (or removes it for the default 'editorial-sobrio')
  // and persists to localStorage. Orthogonal to the light/dark toggle that
  // sits next to the accordion header and applies to every style.
  // Style identities won't actually paint anything until each one's tokens
  // ship in tokens.css under :root[data-theme="<id>"].
  type ThemeStyle = { id: string; name: string };
  const themeStyles: ThemeStyle[] = [
    { id: 'editorial-sobrio', name: 'Editorial Sober' },
    { id: 'brutalist-mono', name: 'Brutalist Mono' },
    { id: 'neon-noctambulo', name: 'Neon Nightshade' },
    { id: 'serif-quiet', name: 'Serif Quiet' },
    { id: 'archival-cream', name: 'Archival Cream' },
  ];
  let activeThemeStyleId = $derived(theme.theme);
  let themeStyleExpanded = $state(false);
  let activeThemeStyle = $derived(
    themeStyles.find((t) => t.id === activeThemeStyleId) ?? themeStyles[0],
  );

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
    <Sidebar
      bind:open={sidebarOpen}
      collapsed={sidebarCollapsed}
      label="Projects"
      resizable
      storageKey="hour_sidebar_width"
      minWidth={200}
      maxWidth={480}
      onCollapse={() => {
        sidebarCollapsed = true;
        try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1'); } catch {}
      }}
      onExpand={() => {
        sidebarCollapsed = false;
        try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '0'); } catch {}
      }}
    >
      {#snippet header()}
        <div
          class="workspace-shell__brand"
          class:workspace-shell__brand--rail={sidebarCollapsed}
        >
          <BrandMark
            size="m"
            compact={sidebarCollapsed}
            href={`/h/${workspaceSlug}/`}
          />
        </div>
        <button
          type="button"
          class="workspace-shell__toggle workspace-shell__toggle--in-sidebar"
          onclick={toggleCollapsed}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            {#if sidebarCollapsed}
              <path d="M6 3 L10 7 L6 11" />
              <path d="M2 3 L6 7 L2 11" />
            {:else}
              <path d="M8 3 L4 7 L8 11" />
              <path d="M12 3 L8 7 L12 11" />
            {/if}
          </svg>
        </button>
      {/snippet}
      {#snippet children()}
        {#if sidebarCollapsed}
          <PlazaRail />
        {:else}
          <Plaza />
          <LineList />
        {/if}
      {/snippet}
      {#snippet footer()}
        <Menu
          direction="up"
          align="start"
          label="Open account menu"
          triggerClass="workspace-shell__user"
          onclose={() => (themeStyleExpanded = false)}
        >
          {#snippet trigger()}
            <Avatar
              size="xs"
              name={userEmail || workspaceSlug}
              accentSlug={userEmail || workspaceSlug}
            />
            <span class="workspace-shell__user-id">{userEmail}</span>
          {/snippet}
          {#snippet children({ close })}
            <li role="none">
              <a
                role="menuitem"
                href={`/h/${workspaceSlug}/settings`}
                class="menu__item"
                tabindex="0"
                onclick={() => close(false)}
              >
                Settings
              </a>
            </li>
            <li role="none" class="theme-accordion">
              <div class="theme-accordion__header">
                <button
                  type="button"
                  class="theme-accordion__expand"
                  aria-expanded={themeStyleExpanded}
                  onclick={() => (themeStyleExpanded = !themeStyleExpanded)}
                >
                  <span class="theme-accordion__label">Theme style</span>
                  <span class="theme-accordion__current">
                    <span class="theme-accordion__current-name"
                      >{activeThemeStyle.name}</span
                    >
                    <span
                      class="theme-accordion__chevron"
                      data-expanded={themeStyleExpanded || undefined}
                      aria-hidden="true"
                    >›</span>
                  </span>
                </button>
                <ThemeToggle variant="plain" />
              </div>
              {#if themeStyleExpanded}
                <ul class="theme-accordion__list" role="list">
                  {#each themeStyles as t (t.id)}
                    <li class="theme-accordion__item">
                      <button
                        type="button"
                        class="theme-accordion__select"
                        aria-pressed={t.id === activeThemeStyleId}
                        data-active={t.id === activeThemeStyleId || undefined}
                        onclick={() => theme.setTheme(t.id)}
                      >
                        {t.name}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
            <li role="none">
              <button
                role="menuitem"
                type="button"
                class="menu__item menu__item--danger"
                tabindex="0"
                onclick={() => {
                  logout();
                  close(false);
                }}
              >
                Sign out
              </button>
            </li>
          {/snippet}
        </Menu>
      {/snippet}
    </Sidebar>

    <main class="workspace-shell__main">
      <header class="workspace-shell__topbar">
        {#if !sidebarOpen}
          <button
            type="button"
            class="workspace-shell__toggle"
            onclick={() => (sidebarOpen = true)}
            aria-label="Show navigation"
          >
            <svg
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M6 3 L10 7 L6 11" />
              <path d="M2 3 L6 7 L2 11" />
            </svg>
          </button>
        {/if}

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

  /* Sidebar skeleton + width token live in base.css. We just paint the
     background and the inline-end border to match the shell palette. */
  .workspace-shell :global(.sidebar) {
    background: var(--bg);
    border-inline-end: 1px solid var(--border-color-dark);
  }

  /* Desktop: width truly fixed (flex item won't grow OR shrink with
     content), sidebar viewport-locked (header pinned, body scrolls
     internally, footer always visible). Mobile drawer keeps its own
     position: fixed rules from base.css. */
  @media (min-width: 48rem) {
    .workspace-shell :global(.sidebar) {
      flex: 0 0 var(--sidebar-width);
      min-inline-size: var(--sidebar-width);
      max-inline-size: var(--sidebar-width);
      position: sticky;
      inset-block-start: 0;
      block-size: 100vh;
      align-self: flex-start;
    }
  }

  .workspace-shell :global(.sidebar__header) {
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-block-end: 0;
    justify-content: space-between;
  }

  /* Rail mode adjustments — narrower padding, stack header + footer
     contents vertically, hide the email next to the user avatar. The
     account dropdown trigger remains an avatar-only button (the menu
     itself keeps its full content width via .menu's min-inline-size). */
  .workspace-shell :global(.sidebar--collapsed .sidebar__header) {
    flex-direction: column;
    gap: var(--space-xs);
    padding-inline: var(--space-xs);
    align-items: center;
    justify-content: center;
  }

  .workspace-shell :global(.sidebar--collapsed .sidebar__body) {
    padding-inline: var(--space-xs);
  }

  .workspace-shell :global(.sidebar--collapsed .sidebar__footer) {
    flex-direction: column;
    gap: var(--space-xs);
    padding-inline: var(--space-xs);
    align-items: center;
  }

  /* In rail mode, the user-menu wrapper sizes to its content (avatar
     only), undoing the `flex: 1` override above. The dropdown still
     opens at min-inline-size: 12rem so it reads fine despite the tiny
     trigger. */
  .workspace-shell :global(.sidebar--collapsed .sidebar__footer .menu-wrapper) {
    flex: 0 0 auto;
    min-inline-size: 0;
    inline-size: auto;
  }

  .workspace-shell :global(.sidebar--collapsed .workspace-shell__user) {
    inline-size: auto;
    padding-inline: var(--space-xs);
    gap: 0;
  }

  .workspace-shell :global(.sidebar--collapsed .workspace-shell__user-id) {
    display: none;
  }

  .workspace-shell :global(.sidebar__body) {
    padding-block: var(--space-s);
    padding-inline: var(--space-s);
    gap: var(--space-s);
  }

  .workspace-shell :global(.sidebar__footer) {
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-block-start: 1px solid var(--border-color-light);
    gap: var(--space-s);
  }

  /* Hook only — styling lives in <BrandMark />. The wrapper exists so
     the sidebar header layout (mark + collapse toggle on the right)
     can flex them apart. */
  .workspace-shell__brand {
    display: inline-flex;
  }

  /* The Menu wrapper fills the footer's content area so the dropdown
     (which inherits inline-size: 100% of the wrapper) opens at the full
     footer width instead of just the trigger's content width — keeps
     menu and footer optically aligned. The trigger itself stays
     content-sized so its hover background still hugs the avatar+email
     cluster. */
  .workspace-shell :global(.sidebar__footer .menu-wrapper) {
    flex: 1;
    min-inline-size: 0;
  }

  /* Account menu trigger: behaves like a single clickable row (avatar +
     email) — no button box. The menu opens upward (footer-anchored) from
     here. Hit area + hover background fills the wrapper (inline-size:
     100%) so it matches the dropdown's width exactly when it opens —
     no optical mismatch between the closed-state highlight and the
     open menu. Content stays left-aligned via inline-flex defaults. */
  .workspace-shell :global(.workspace-shell__user) {
    inline-size: 100%;
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-xs);
    padding-inline: var(--space-xs);
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    color: var(--text-color);
    cursor: pointer;
    text-align: start;
    font-family: inherit;
    transition: background var(--transition);
    min-inline-size: 0;
  }

  .workspace-shell :global(.workspace-shell__user:hover),
  .workspace-shell :global(.workspace-shell__user[aria-expanded='true']) {
    background: var(--bg-hover);
  }

  .workspace-shell__user-id {
    font-size: var(--text-s);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-inline-size: 0;
    max-inline-size: 16rem;
  }

  /* Theme accordion inside the account menu. Two orthogonal controls:
     the expand button (label + current style + chevron) opens the list;
     the ThemeToggle to its right flips light/dark globally regardless of
     which style is selected. The list below shows style names only — no
     per-item mode. */
  :global(.theme-accordion) {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* Hover/active background lives on the row (header), not on the expand
     button alone — so the toggle is included in the highlighted area.
     Matches the full-width hover behaviour of the other menu items. */
  :global(.theme-accordion__header) {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding-inline-end: var(--space-xs);
    border-radius: var(--radius-s);
    transition: background var(--transition);
  }

  :global(.theme-accordion__header):hover,
  :global(.theme-accordion__header):has(.theme-accordion__expand[aria-expanded='true']) {
    background: var(--bg-ultra-light);
  }

  /* Expand button stacks label (line 1) over the current style + chevron
     (line 2). The ThemeToggle to its right stays vertically centered
     against the two-line stack. */
  :global(.theme-accordion__expand) {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    font-family: inherit;
    color: var(--text-color);
    text-align: start;
    cursor: pointer;
    transition: background var(--transition);
    min-inline-size: 0;
  }


  :global(.theme-accordion__label) {
    font-size: var(--text-s);
    color: var(--text-color);
    line-height: 1.3;
  }

  :global(.theme-accordion__current) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    max-inline-size: 100%;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.3;
    min-inline-size: 0;
  }

  :global(.theme-accordion__current-name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-inline-size: 0;
  }

  :global(.theme-accordion__chevron) {
    color: var(--text-faint);
    line-height: 1;
    transition: transform var(--transition);
    flex-shrink: 0;
  }

  :global(.theme-accordion__chevron[data-expanded]) {
    transform: rotate(90deg);
  }

  :global(.theme-accordion__list) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-inline-start: var(--space-s);
  }

  :global(.theme-accordion__item) {
    display: flex;
  }

  :global(.theme-accordion__select) {
    flex: 1;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-align: start;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }

  :global(.theme-accordion__select):hover {
    background: var(--bg-ultra-light);
    color: var(--heading-color);
  }

  :global(.theme-accordion__select[data-active]) {
    background: var(--bg-ultra-light);
    color: var(--heading-color);
    font-weight: 500;
  }

  .workspace-shell__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  .workspace-shell__topbar {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-block-end: 1px solid var(--border-color-light);
    background: var(--bg);
  }

  /* Borderless icon button — just the chevron. Hit area comes from the
     SVG size + padding, color shifts on hover; no box, no background. */
  .workspace-shell__toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-xs);
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    transition: color var(--transition);
  }

  .workspace-shell__toggle svg {
    inline-size: var(--text-s);
    block-size: var(--text-s);
  }

  .workspace-shell__toggle:hover {
    color: var(--text-color);
  }

  .workspace-shell__lenses {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .workspace-shell__crumb {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    letter-spacing: 0.16em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-shell__right {
    display: flex;
    align-items: center;
    gap: var(--space-s);
  }

  .workspace-shell__search {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    padding-inline: var(--space-xs);
    background: var(--bg);
    border: 1px solid var(--border-color-dark);
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
    padding: 0;
    background: transparent;
    border: 0;
    outline: none;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1.2;
    color: var(--text-color);
  }

  .workspace-shell__search input::placeholder {
    color: var(--text-faint);
  }

  .workspace-shell__content {
    flex: 1;
    padding-block: var(--space-l);
    padding-inline: var(--space-l);
  }

  @media (max-width: 47.999rem) {
    .workspace-shell__crumb {
      display: none;
    }
    .workspace-shell__search {
      min-inline-size: 140px;
    }
    .workspace-shell__content {
      padding-inline: var(--space-m);
    }
  }
</style>
