<script lang="ts">
  /**
   * App shell — Adaptive Digest (ADR-055 nav redesign). The persistent
   * sidebar (Plaza + LineList) is gone; scope is expressed by PINS placed
   * on the content by each lens (see <ScopeStrip>), and ⌘K jumps to any
   * line or space. The top bar is: brand · lenses (Today · Calendar ·
   * Money) · Clean|My home (Today only) · ⌘K search · account menu.
   *
   * Settings stays a "mode" of the shell: when inside /settings a slim
   * <SettingsNav> aside returns, so the settings surface is unaffected.
   *
   * Preserved from the previous shell: auth gate, selection/lens providers
   * (pages still read selection), realtime + network presence, theme +
   * DND account menu, master-view restore.
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import type { Snippet } from 'svelte';
  import { onDestroy, onMount, untrack } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import PresenceBadge from '$lib/components/PresenceBadge.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import { useTheme } from '$lib/theme.svelte';
  import { isReservedWorkspaceSlug } from '$lib/reserved-slugs';
  import { provideLens, type Lens } from '$lib/stores/lens.svelte';
  import { provideSelection } from '$lib/stores/selection.svelte';
  import { providePins, spacePin } from '$lib/stores/pins.svelte';
  import { lineUrl, type NavLine, type NavWorkspace } from '$lib/nav';
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
  let hasWorkspace = $derived(workspaceSlug.length > 0);
  let blocked = $derived(hasWorkspace && isReservedWorkspaceSlug(workspaceSlug));

  $effect(() => {
    if (blocked) goto('/', { replaceState: true });
  });

  let authChecked = $state(false);
  onMount(() => {
    if (!localStorage.getItem('hour_jwt')) {
      goto('/login', { replaceState: true });
      return;
    }
    authChecked = true;
  });

  const selection = provideSelection();
  const lens = provideLens('today');
  const pins = providePins();

  // Hydrate selection from URL (pages still read it). Idempotent.
  $effect(() => {
    selection.hydrateFromUrl(page.url);
  });

  onMount(() => {
    selection.hydrateFromUrl(page.url);
    selection.restoreFocusFromLocalStorage();
    lens.restoreFromLocalStorage();
    pins.restoreFromLocalStorage();
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

  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
  let menuWorkspaceSlug = $derived(workspaceSlug || defaultWorkspaceSlug);

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

  // Identity from JWT (display name → email local-part).
  let userEmail = $state('');
  let userDisplayName = $state('');
  onMount(() => {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]));
      userEmail = payload.email ?? '';
      const meta = payload.user_metadata ?? {};
      userDisplayName =
        meta.display_name ?? meta.full_name ?? meta.name ?? userEmail.split('@')[0] ?? '';
    } catch {
      /* malformed jwt — leave empty */
    }
  });

  // Theme style picker — accordion inside the account menu.
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

  // The logo IS the home = Agenda. No top-nav buttons at all (ADR-055,
  // final): Calendar and Money are reachable from ⌘K. Home lands on the
  // default-workspace agenda (the agenda is cross-workspace anyway; the
  // segment is just browsing context).
  let homeHref = $derived(menuWorkspaceSlug ? `/h/${menuWorkspaceSlug}/` : '/h/');

  let inSettings = $derived(/^\/h\/[^/]+\/settings(\b|\/|$)/.test(page.url.pathname));

  // Which routed lens (if any) the current URL is showing.
  let routedLens = $derived.by<Lens | null>(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/(calendar|contacts|money)\/?$/);
    return (m?.[1] as Lens | undefined) ?? null;
  });


  // Keep the pill state honest when navigation happens outside the pills.
  $effect(() => {
    const current = untrack(() => lens.current);
    if (routedLens) {
      if (current !== routedLens) lens.set(routedLens);
    } else if (current !== 'today') {
      lens.set('today');
    }
  });

  // Do Not Disturb — quick toggle in the account menu.
  const DND_KEY = 'hour_dnd';
  let dnd = $state(false);
  onMount(() => {
    try {
      dnd = localStorage.getItem(DND_KEY) === '1';
    } catch {
      /* storage disabled */
    }
  });
  function toggleDnd() {
    dnd = !dnd;
    try {
      localStorage.setItem(DND_KEY, dnd ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // ⌘K command palette.
  let paletteOpen = $state(false);
  function onPickLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function onPickSpace(ws: NavWorkspace) {
    pins.add(spacePin(ws.slug));
    lens.set('today');
    void goto(`/h/${ws.slug}/`);
  }
  function onPickView(view: 'agenda' | 'calendar' | 'contacts' | 'money') {
    const ws = workspaceSlug || defaultWorkspaceSlug;
    if (!ws) return;
    // Agenda is the full view of the home timeline — same "today" lens, not
    // its own pill; Calendar, Contacts and Money are the routed lenses.
    lens.set(view === 'agenda' ? 'today' : view);
    void goto(`/h/${ws}/${view}`);
  }

  function logout() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }
</script>

{#if authChecked && !blocked}
  <div class="shell" class:shell--settings={inSettings}>
    {#if inSettings}
      <aside class="shell__settings-nav">
        <SettingsNav />
      </aside>
    {/if}

    <main class="shell__main">
      <header class="shell__top">
        <div class="shell__left">
          <a class="shell__brand" href={homeHref} aria-label="Hour — home">
            <BrandMark size="m" />
          </a>
        </div>

        <button
          type="button"
          class="shell__search"
          onclick={() => (paletteOpen = true)}
          aria-label="Search or jump to a line"
        >
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <circle cx="6.2" cy="6.2" r="4.2" />
            <path d="M9.4 9.4 12 12" />
          </svg>
          <span class="shell__search-label">Search or jump to a line…</span>
          <kbd class="kbd">⌘K</kbd>
        </button>

        <div class="shell__right">
        <PresenceBadge count={networkPresence?.count ?? null} />

        <Menu
          direction="down"
          align="end"
          label="Open account menu"
          triggerClass="account-row__kebab"
          onclose={() => (themeStyleExpanded = false)}
        >
          {#snippet trigger()}
            <Avatar size="xs" name={userDisplayName || userEmail || workspaceSlug} />
          {/snippet}
          {#snippet children({ close })}
            <li role="presentation" class="menu-header">
              <div class="menu-header__identity">
                <Avatar size="s" name={userDisplayName || userEmail || workspaceSlug} />
                <div class="menu-header__id">
                  <span class="menu-header__name">{userDisplayName || userEmail}</span>
                  {#if userDisplayName && userEmail && userDisplayName !== userEmail}
                    <span class="menu-header__email">{userEmail}</span>
                  {/if}
                </div>
              </div>
              <button
                type="button"
                class="menu-header__logout"
                aria-label="Sign out"
                title="Sign out"
                onclick={() => {
                  close(false);
                  logout();
                }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 2 H4 a1 1 0 0 0 -1 1 V13 a1 1 0 0 0 1 1 H9" />
                  <path d="M7 8 H14" />
                  <path d="M11 5 L14 8 L11 11" />
                </svg>
              </button>
            </li>
            <li role="none">
              <a
                role="menuitem"
                href={inSettings ? `/h/${menuWorkspaceSlug}/` : `/h/${menuWorkspaceSlug}/settings`}
                class="menu__item"
                tabindex="0"
                onclick={() => close(false)}
              >
                {inSettings ? 'Dashboard' : 'All settings'}
              </a>
            </li>
            <li role="none" class="settings-row">
              <a
                role="menuitem"
                href={`/h/${menuWorkspaceSlug}/settings?section=notifications`}
                class="menu__item settings-row__link"
                tabindex="0"
                onclick={() => close(false)}
              >
                Notifications
              </a>
              <button
                type="button"
                class="settings-row__action settings-row__action--toggle"
                class:is-muted={dnd}
                aria-label={dnd ? 'Notifications muted — click to unmute' : 'Notifications on — click to mute'}
                aria-pressed={dnd}
                title={dnd ? 'Muted' : 'On — click to mute'}
                onclick={toggleDnd}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 11 C 4 9.8 4.5 9.3 4.5 8 C 4.5 5.8 6 4 8 4 C 10 4 11.5 5.8 11.5 8 C 11.5 9.3 12 9.8 12 11 Z" />
                  <path d="M3.5 11 H 12.5" />
                  <path d="M7 13 C 7.2 13.6 7.5 14 8 14 C 8.5 14 8.8 13.6 9 13" />
                  <path d="M8 2.5 V 4" />
                  {#if dnd}
                    <path d="M2.5 2.5 L 13.5 13.5" />
                  {/if}
                </svg>
              </button>
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
                    <span class="theme-accordion__current-name">{activeThemeStyle.name}</span>
                    <span class="theme-accordion__chevron" data-expanded={themeStyleExpanded || undefined} aria-hidden="true">›</span>
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
          {/snippet}
        </Menu>
        </div>
      </header>

      <div class="shell__content">
        {#if children}{@render children()}{/if}
      </div>
    </main>
  </div>

  <CommandPalette bind:open={paletteOpen} {onPickLine} {onPickSpace} {onPickView} />
{/if}

<style>
  .shell {
    display: flex;
    min-block-size: 100vh;
    background: var(--bg);
  }

  .shell__settings-nav {
    flex: 0 0 var(--sidebar-width);
    min-inline-size: var(--sidebar-width);
    max-inline-size: var(--sidebar-width);
    border-inline-end: 1px solid var(--border-color-dark);
    position: sticky;
    inset-block-start: 0;
    block-size: 100vh;
    align-self: flex-start;
    overflow-y: auto;
    padding-block: var(--space-s);
  }

  .shell__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  .shell__top {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-m);
    padding-block: var(--space-s);
    padding-inline: var(--space-l);
    background: color-mix(in oklch, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border-block-end: 1px solid var(--border-color-light);
  }

  .shell__left {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    min-inline-size: 0;
  }
  .shell__right {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
  }

  .shell__brand {
    display: inline-flex;
    flex: none;
    text-decoration: none;
  }

  .shell__search {
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: min(30rem, 100%);
    min-inline-size: 14rem;
    padding-block: var(--space-xs);
    padding-inline: var(--space-m) var(--space-s);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: var(--bg-ultra-light);
    color: var(--text-faint);
    cursor: text;
    font-family: inherit;
    transition: border-color var(--transition);
  }
  .shell__search:hover {
    border-color: var(--text-muted);
  }
  .shell__search-label {
    flex: 1;
    text-align: start;
    font-size: var(--text-s);
    color: var(--text-faint);
  }

  .shell__content {
    flex: 1;
    padding-block: var(--space-s) var(--space-xxl);
    padding-inline: var(--space-l);
  }

  /* ── account menu chrome (unchanged from the previous shell) ── */

  :global(.account-row__kebab) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-circle);
    color: var(--text-faint);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.account-row__kebab:hover),
  :global(.account-row__kebab[aria-expanded='true']) {
    background: var(--bg-light);
    color: var(--text-color);
  }
  :global(.account-row__kebab:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }

  :global(.menu-header) {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline-start: var(--space-s);
    padding-inline-end: 0;
    border-block-end: 1px solid var(--border-color-light);
    margin-block-end: var(--space-xs);
  }
  :global(.menu-header__identity) {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    flex: 1;
    min-inline-size: 0;
  }
  :global(.menu-header__id) {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }
  :global(.menu-header__name) {
    font-size: var(--text-s);
    color: var(--text-color);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.menu-header__email) {
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.menu-header__logout) {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    color: var(--text-faint);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.menu-header__logout:hover) {
    background: var(--danger-ultra-light);
    color: var(--danger);
  }
  :global(.menu-header__logout:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }

  :global(.theme-accordion) {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  :global(.settings-row) {
    display: flex;
    align-items: flex-start;
    gap: 1px;
  }
  :global(.settings-row__link) {
    flex: 1;
  }
  :global(.settings-row__action) {
    --action-color: var(--text-faint);
    --action-color-hover: var(--text-color);
    --action-bg-hover: var(--bg-light);

    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    color: var(--action-color);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.settings-row__action:hover) {
    background: var(--action-bg-hover);
    color: var(--action-color-hover);
  }
  :global(.settings-row__action:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }
  :global(.settings-row__action--toggle) {
    --action-color: var(--text-color);
  }
  :global(.settings-row__action--toggle.is-muted) {
    --action-color: var(--text-faint);
  }

  :global(.theme-accordion__header) {
    display: flex;
    align-items: flex-start;
    gap: 1px;
  }
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
  :global(.theme-accordion__expand:hover),
  :global(.theme-accordion__expand[aria-expanded='true']) {
    background: var(--bg-light);
  }
  :global(.theme-accordion__expand:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
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
    background: var(--bg-light);
    color: var(--heading-color);
  }
  :global(.theme-accordion__select[data-active]) {
    background: var(--bg-light);
    color: var(--heading-color);
    font-weight: 500;
  }

  @media (max-width: 47.999rem) {
    .shell__search {
      min-inline-size: 0;
    }
    .shell__search-label {
      display: none;
    }
    .shell__content {
      padding-inline: var(--space-m);
    }
    .shell__settings-nav {
      display: none;
    }
  }
</style>
