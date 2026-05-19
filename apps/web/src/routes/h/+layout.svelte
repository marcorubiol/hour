<script lang="ts">
  /**
   * App shell (ADR-029 + ADR-038 + ADR-039) — user-scoped sidebar +
   * lens nav. Lives at /h/+layout so /h/ itself can render the empty-
   * selection state without ambiguity (`/h/[ws]/` would round-trip
   * "browsing context" vs "1 workspace selected" through the same URL).
   *
   * - /h/                                    → empty selection
   * - /h/[ws]/                               → 1 workspace selected
   * - /h/[ws]/project/[slug]/                → 1 project selected
   * - /h/[ws]/project/[slug]/line/[line]/    → line detail
   * - /h/[ws]/?ws=a,b&project=c,d            → multi-select form
   *
   * Sidebar upper: <Plaza /> (multi-workspace project list, multi-select
   * filter). Sidebar lower: <LineList /> (always-visible, filter-aware).
   * Top of main: horizontal lens pills + breadcrumb + search.
   * Main content: routed page (workspace home, project detail, line
   * detail, or /h/+page empty state).
   *
   * Auth: redirects to /login if no JWT (was the responsibility of the
   * now-deleted /h/+layout.svelte stub).
   *
   * Visual refresh 2026-05-18 (ADR-033): editorial v0.5. Newsreader display
   * wordmark, Inter pills, mono breadcrumb + kbd.
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
  import SettingsNav from '$lib/components/SettingsNav.svelte';
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
  let hasWorkspace = $derived(workspaceSlug.length > 0);
  // Reserved-slug guard: a URL like /h/login/ shouldn't try to render a
  // "login workspace". Only check when a workspace segment is actually
  // present; empty (at /h/) bypasses this.
  let blocked = $derived(hasWorkspace && isReservedWorkspaceSlug(workspaceSlug));

  $effect(() => {
    if (blocked) goto('/', { replaceState: true });
  });

  // Auth check — redirect to /login if no JWT. Was in the previous
  // /h/+layout stub (now merged here). Shell only renders after the
  // check passes to avoid flashing empty UI on logged-out hits.
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

  // Settings + Notifications in the account menu need a workspace context
  // to build their hrefs. When the user is at /h/ root (no workspace
  // selected), fall back to the first workspace from the loaded list so
  // the menu still works without requiring a selection.
  let defaultWorkspaceSlug = $derived(
    $workspacesQuery.data?.items[0]?.slug ?? '',
  );
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

  // Vertical split between Plaza and LineList inside the sidebar body.
  // Ratio is the fraction of the body height taken by the Plaza pane
  // (0..1). `null` = default 50/50. Persisted across sessions.
  const PANE_SPLIT_KEY = 'hour_pane_split';
  let panePlazaRatio = $state<number | null>(null);
  onMount(() => {
    try {
      const raw = localStorage.getItem(PANE_SPLIT_KEY);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0 && n < 1) panePlazaRatio = n;
      }
    } catch {
      // Storage disabled — start at default split.
    }
  });
  let panePlazaStyle = $derived(
    panePlazaRatio !== null
      ? `flex: 0 0 ${(panePlazaRatio * 100).toFixed(2)}%;`
      : undefined,
  );

  function startPaneResize(event: MouseEvent) {
    event.preventDefault();
    const divider = event.currentTarget as HTMLElement;
    const body = divider.parentElement;
    if (!body) return;

    // Reference everything against the body's CONTENT box, not its
    // border-box rect. Plaza's `flex: 0 0 X%` is interpreted relative
    // to the flex container's content height, and the divider also
    // takes a couple of pixels off the pane budget — both have to be
    // accounted for or the Lines header gets clipped at the extreme.
    const bodyRect = body.getBoundingClientRect();
    const bodyStyles = getComputedStyle(body);
    const padTop = parseFloat(bodyStyles.paddingBlockStart) || 0;
    const padBottom = parseFloat(bodyStyles.paddingBlockEnd) || 0;
    const contentTop = bodyRect.top + padTop;
    const contentHeight = bodyRect.height - padTop - padBottom;
    const dividerH = divider.getBoundingClientRect().height;

    // Min/max determined by the actual rendered height of each sticky
    // header — collapsing a pane just leaves its title visible, no
    // hard-coded pixel floor. Measured once per drag (cheap; layout
    // doesn't shift mid-drag).
    const plazaHeader = body.querySelector('.plaza__header');
    const linesHeader = body.querySelector('.line-list__header');
    const plazaHeaderH = plazaHeader?.getBoundingClientRect().height ?? 0;
    const linesHeaderH = linesHeader?.getBoundingClientRect().height ?? 0;
    const minRatio = contentHeight > 0 ? plazaHeaderH / contentHeight : 0;
    const maxRatio =
      contentHeight > 0
        ? 1 - (linesHeaderH + dividerH) / contentHeight
        : 1;

    const onMove = (e: MouseEvent) => {
      const offset = e.clientY - contentTop;
      const ratio = offset / contentHeight;
      panePlazaRatio = Math.max(minRatio, Math.min(maxRatio, ratio));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (panePlazaRatio !== null) {
        try {
          localStorage.setItem(PANE_SPLIT_KEY, String(panePlazaRatio));
        } catch {
          // ignore
        }
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function resetPaneSplit() {
    panePlazaRatio = null;
    try {
      localStorage.removeItem(PANE_SPLIT_KEY);
    } catch {
      // ignore
    }
  }

  // Decode identity from the JWT. Display name comes from Supabase
  // user_metadata (set on signup/oauth/edit). Fallback chain:
  // display_name → full_name → name → local-part of email. Email is
  // kept as a secondary fallback if metadata is empty. When a profile
  // entity ships (Phase 0.9+), swap for profile.display_name.
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
        meta.display_name ??
        meta.full_name ??
        meta.name ??
        userEmail.split('@')[0] ??
        '';
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

  // Settings takes over the sidebar body: Plaza + LineList are replaced
  // by SettingsNav while the user is inside /settings. Header (brand)
  // and footer (avatar menu) stay put — settings is a "mode" of the
  // same shell, not a separate page.
  let inSettings = $derived(
    /^\/h\/[^/]+\/settings(\b|\/|$)/.test(page.url.pathname),
  );

  // Do Not Disturb — quick toggle in the account menu. Persisted to
  // localStorage so a muted state survives refresh. Phase 0 hook is
  // visual-only (the bell flips); actual notification suppression wires
  // up when the notification system ships. The detailed setup (digest,
  // channels, quiet hours, per-event toggles) lives inside Settings →
  // Notifications; this is the "30 seconds before going on stage" shortcut.
  const DND_KEY = 'hour_dnd';
  let dnd = $state(false);
  onMount(() => {
    try {
      dnd = localStorage.getItem(DND_KEY) === '1';
    } catch {
      // Storage disabled — start unmuted.
    }
  });
  function toggleDnd() {
    dnd = !dnd;
    try {
      localStorage.setItem(DND_KEY, dnd ? '1' : '0');
    } catch {
      // ignore
    }
  }

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

{#if authChecked && !blocked}
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
        {#if sidebarCollapsed}
          <button
            type="button"
            class="workspace-shell__brand-toggle"
            onclick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <BrandMark size="m" compact />
          </button>
        {:else}
          <div class="workspace-shell__brand">
            <BrandMark size="m" href="/h/" />
          </div>
        {/if}
      {/snippet}
      {#snippet children()}
        {#if sidebarCollapsed}
          <div class="workspace-shell__pane">
            <PlazaRail />
          </div>
        {:else if inSettings}
          <div class="workspace-shell__pane">
            <SettingsNav />
          </div>
        {:else}
          <div
            class="workspace-shell__pane workspace-shell__pane--plaza"
            style={panePlazaStyle}
          >
            <Plaza />
          </div>
          <button
            type="button"
            class="workspace-shell__pane-divider"
            aria-label="Resize panes"
            title="Drag to resize · double-click to reset"
            onmousedown={startPaneResize}
            ondblclick={resetPaneSplit}
          ></button>
          <div class="workspace-shell__pane workspace-shell__pane--lines">
            <LineList />
          </div>
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
              name={userDisplayName || userEmail || workspaceSlug}
            />
            <span class="workspace-shell__user-id"
              >{userDisplayName || userEmail}</span
            >
            <span class="workspace-shell__user-kebab" aria-hidden="true">
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="3.5" cy="8" r="1.2" />
                <circle cx="8" cy="8" r="1.2" />
                <circle cx="12.5" cy="8" r="1.2" />
              </svg>
            </span>
          {/snippet}
          {#snippet children({ close })}
            <li role="presentation" class="menu-header">
              <div class="menu-header__identity">
                <Avatar
                  size="s"
                  name={userDisplayName || userEmail || workspaceSlug}
                />
                <div class="menu-header__id">
                  <span class="menu-header__name"
                    >{userDisplayName || userEmail}</span
                  >
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
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <!-- door frame on the left -->
                  <path d="M9 2 H4 a1 1 0 0 0 -1 1 V13 a1 1 0 0 0 1 1 H9" />
                  <!-- arrow exiting to the right -->
                  <path d="M7 8 H14" />
                  <path d="M11 5 L14 8 L11 11" />
                </svg>
              </button>
            </li>
            <li role="none">
              <a
                role="menuitem"
                href={inSettings
                  ? `/h/${menuWorkspaceSlug}/`
                  : `/h/${menuWorkspaceSlug}/settings`}
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
                aria-label={dnd
                  ? 'Notifications muted — click to unmute'
                  : 'Notifications on — click to mute'}
                aria-pressed={dnd}
                title={dnd ? 'Muted' : 'On — click to mute'}
                onclick={toggleDnd}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <!-- bell body -->
                  <path d="M4 11 C 4 9.8 4.5 9.3 4.5 8 C 4.5 5.8 6 4 8 4 C 10 4 11.5 5.8 11.5 8 C 11.5 9.3 12 9.8 12 11 Z" />
                  <!-- rim -->
                  <path d="M3.5 11 H 12.5" />
                  <!-- clapper -->
                  <path d="M7 13 C 7.2 13.6 7.5 14 8 14 C 8.5 14 8.8 13.6 9 13" />
                  <!-- top -->
                  <path d="M8 2.5 V 4" />
                  {#if dnd}
                    <!-- mute slash -->
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
          {hasWorkspace ? `${workspaceSlug.toUpperCase()} · ` : ''}{breadcrumbDate}
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
     background and the inline-end border to match the shell palette.
     Stacked above the topbar so the resize handle, which extends 2px
     beyond the sidebar edge, isn't obscured by the topbar's sticky
     layer — that overlap was the cause of the apparent double line. */
  .workspace-shell :global(.sidebar) {
    background: var(--bg);
    border-inline-end: 1px solid var(--border-color-dark);
    z-index: calc(var(--z-sticky) + 1);
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

  /* Rail mode adjustments — narrower padding, hide the email next to the
     user avatar. The account dropdown trigger remains an avatar-only
     button (the menu itself keeps its full content width via .menu's
     min-inline-size). Header is a single element (the brand doubles as
     the expand control), so it stays a centred row, not a stack. */
  .workspace-shell :global(.sidebar--collapsed .sidebar__header) {
    padding-inline: var(--space-xs);
    align-items: center;
    justify-content: center;
  }

  /* Square hit + hover area for the brand-as-toggle (collapsed mode).
     A single italic "h" at text-xl + padding-xs is naturally taller
     than wide; locking both axes to the same computed value keeps the
     hover surface visibly square. Click expands the sidebar — the
     tooltip + cursor carry the affordance, no extra icon needed. */
  .workspace-shell__brand-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: calc(var(--text-xl) + 2 * var(--space-xs));
    block-size: calc(var(--text-xl) + 2 * var(--space-xs));
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
    color: inherit;
    transition: background var(--transition);
  }

  .workspace-shell__brand-toggle:hover {
    background: var(--bg-hover);
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
    /* No inline padding on the body itself — every meaningful child
       inside (eyebrows, rows, LineList headers) already owns its
       padding-inline, so the body adding more on top just stacks
       indent. The divider is full-bleed for free now. */
    padding-inline: 0;
    /* When the body hosts two panes (Plaza + Lines), let each one own
       its scroll instead of scrolling the whole body. The divider lives
       between them as a row-resize handle; no body gap so the divider
       is the only line. min-block-size: 0 on the panes allows them to
       shrink below their content. */
    gap: 0;
    overflow: hidden;
    min-block-size: 0;
  }

  .workspace-shell__pane {
    flex: 1 1 50%;
    min-block-size: 0;
    overflow-y: auto;
  }

  /* LineList renders its own top divider + spacing for the standalone
     case. Inside the sidebar shell the pane-divider above already owns
     that line, AND the sticky header has its own padding-block. Strip
     all the wrapper's top spacing — otherwise the header gets pushed
     down off the pane's top: 0 anchor and is clipped at the pane's
     bottom edge when the pane is collapsed. */
  .workspace-shell__pane--lines :global(.line-list) {
    margin-block-start: 0;
    padding-block-start: 0;
    border-block-start: 0;
  }

  /* Pane headers stay pinned to the top of their pane while content
     below scrolls. The sticky must live on the header WRAPPER, not on
     the eyebrow inside it: position: sticky is constrained within the
     element's direct parent, so a sticky eyebrow inside a tiny
     plaza__header parent would unstick almost immediately. The header
     wrapper's parent is the full-height plaza nav (or line-list), so
     it has the room it needs to actually stay pinned. */
  .workspace-shell__pane :global(.plaza__header),
  .workspace-shell__pane :global(.line-list__header) {
    position: sticky;
    inset-block-start: 0;
    background: var(--bg);
    padding-block: var(--space-xs);
    z-index: 1;
  }

  /* Row between the two panes, draggable to redistribute their heights.
     Spans edge-to-edge naturally now that the body has no inline padding.
     Slightly thicker than a 1px hairline to register as an intentional
     divider. Hit area is widened via ::after so the user doesn't have
     to land on the literal strip. Same visual language as the
     inline-end resize handle: subtle by default, primary on hover/drag. */
  .workspace-shell__pane-divider {
    position: relative;
    block-size: 2px;
    background: var(--border-color-light);
    border: 0;
    padding: 0;
    cursor: row-resize;
    flex-shrink: 0;
    transition: background var(--transition);
  }

  .workspace-shell__pane-divider::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    inset-block: -3px;
  }

  .workspace-shell__pane-divider:hover,
  .workspace-shell__pane-divider:active {
    background: var(--primary);
  }

  .workspace-shell__pane-divider:focus,
  .workspace-shell__pane-divider:focus-visible {
    outline: none;
  }

  .workspace-shell :global(.sidebar__footer) {
    position: relative;
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
  }

  /* Identity header inside the account menu (first li in source order =
     top of the upward-opening dropdown = furthest from the cursor that
     just clicked the trigger). Composition: avatar + identity column
     (display name on top, email subtitle when distinct) on the left,
     sign-out icon button at the trailing edge. Separated from the
     navigation items below by a hairline border, so the visual reads
     as "identity zone" vs "configuration zone". The sign-out button
     intentionally omits role="menuitem" so the menu's initial-focus and
     arrow-key navigation skip it — keyboard users reach the safe items
     first, mouse users still click it directly.

     Padding-inline asymmetry: the LEFT pad matches the menu items'
     padding-inline (space-s) so the avatar lines up with the items' text
     start. The RIGHT pad is 0 so the sign-out icon sits flush with the
     bell (.settings-row__action) and ThemeToggle that live in
     subsequent rows — every trailing icon column lines up on the same
     vertical. */
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
  /* Sign-out: same skeleton as .settings-row__action (32×32, neutral
     idle) so it sits in the same trailing-icon column as the DND bell
     and ThemeToggle below. align-self: flex-start anchors it to the
     header's top so it aligns with the name's baseline (the identity's
     primary line), not with the centre of the avatar + 2-line block. */
  :global(.menu-header__logout) {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    inline-size: 32px;
    block-size: 32px;
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

  /* Kebab indicator at the trailing edge of the trigger. Always visible
     so the row reads as clickable — communicates "menu lives here".
     Faint by default; on hover/open of the trigger, slightly stronger.
     Sign out lives inside the menu now (no longer floating over the
     trigger tail), so the kebab owns this slot uncontested. */
  .workspace-shell__user-kebab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-inline-start: auto;
    color: var(--text-faint);
    transition: color var(--transition);
  }
  :global(.workspace-shell__user:hover) .workspace-shell__user-kebab,
  :global(.workspace-shell__user[aria-expanded='true'])
    .workspace-shell__user-kebab {
    color: var(--text-muted);
  }
  /* Rail mode: only the avatar shows; kebab + name both hide. */
  :global(.sidebar--collapsed) .workspace-shell__user-kebab {
    display: none;
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

  /* Settings row = link/control + icon-action button side by side.
     Same composition as .theme-accordion__header (label + ThemeToggle).
     Each side owns its own hover so they don't double-highlight.
     align-items: flex-start anchors the action to the TOP of the row,
     so the icon column stays on the same baseline whether the row is
     single-line (Notifications) or multi-line (Theme style ‧ Editorial
     Sober ›). Centring would drift the icon downward as rows grow. */
  :global(.settings-row) {
    display: flex;
    align-items: flex-start;
    gap: 1px;
  }
  :global(.settings-row__link) {
    flex: 1;
  }

  /* Single skeleton for every icon-action sitting at the row's right
     edge — logout, DND bell, and (via matching --toggle-size) the
     ThemeToggle. Square 32×32 means each icon's centre lands at the
     same x/y across rows, so they read as one column.
     Modifiers redeclare variables only (philosophy.md). */
  :global(.settings-row__action) {
    --action-color: var(--text-faint);
    --action-color-hover: var(--text-color);
    --action-bg-hover: var(--bg-ultra-light);

    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 32px;
    block-size: 32px;
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

  /* Stateful toggle — DND bell. ON paints in ink, muted dims to faint
     (the SVG also draws a slash for unmistakable read). Hover stays
     neutral; muting isn't destructive. */
  :global(.settings-row__action--toggle) {
    --action-color: var(--text-color);
  }
  :global(.settings-row__action--toggle.is-muted) {
    --action-color: var(--text-faint);
  }

  /* Mirrors .settings-row exactly — same composition, same alignment.
     flex-start anchors ThemeToggle to the row's TOP so it sits on the
     same baseline as the bell / logout in sibling single-line rows.
     The "Editorial Sober ›" line falls below; the toggle reads as
     "action of the row" not "anchored to the centre of a 2-line stack". */
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
    background: var(--bg-ultra-light);
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

  /* Square chevron button using the same logic as the brand-toggle:
     content size + 2 * space-xs. Content here is text-s (the chevron
     svg), so the resulting square is smaller than the brand-toggle's
     square (which wraps a text-xl "h") — keeps each button optically
     aligned with whatever it contains. Idle: subtle (faint + 0.5
     opacity, no box). Hover: full opacity + bg-hover. */
  .workspace-shell__toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: calc(var(--text-s) + 2 * var(--space-xs));
    block-size: calc(var(--text-s) + 2 * var(--space-xs));
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    color: var(--text-faint);
    opacity: 0.5;
    cursor: pointer;
    transition:
      opacity var(--transition), color var(--transition),
      background var(--transition);
  }

  .workspace-shell__toggle svg {
    inline-size: var(--text-s);
    block-size: var(--text-s);
  }

  .workspace-shell__toggle:hover {
    color: var(--text-muted);
    opacity: 1;
    background: var(--bg-hover);
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
