<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { useTheme } from '$lib/theme.svelte';
  import { clearSession, session } from '$lib/session.svelte';

  interface Props {
    /** Current URL's workspace segment — Avatar-name fallback of last resort. */
    workspaceSlug: string;
    /** Workspace the settings/notifications links point at (URL's, else the
        user's first workspace). */
    menuWorkspaceSlug: string;
    inSettings: boolean;
    /** Shared with the shell's scope model — the working combo registers in
        Recent before the session dies (see the /h layout). */
    rememberWorkingScope: () => void;
  }

  let { workspaceSlug, menuWorkspaceSlug, inSettings, rememberWorkingScope }: Props = $props();

  const theme = useTheme();

  // Identity from the session store (display name → email local-part).
  // The JWT is httpOnly now — the server decoded it in /api/auth/session.
  let userEmail = $derived(session.user?.email ?? '');
  let userDisplayName = $derived(
    session.user?.name ?? session.user?.email?.split('@')[0] ?? '',
  );

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

  async function logout() {
    rememberWorkingScope();
    // Server-side: clears the httpOnly cookies + revokes the refresh
    // token at Supabase. Await so the gates can't race a live cookie.
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* offline logout still clears local state */
    }
    clearSession();
    goto('/login', { replaceState: true });
  }
</script>

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

<style>
  /* ── account menu chrome (unchanged from the previous shell) ──
     :global because this markup renders inside <Menu>'s snippet. */

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
</style>
