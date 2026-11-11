<script lang="ts">
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { clearSession, session } from '$lib/session.svelte';
  import { commitDone } from '$lib/chat-done.svelte';
  import { commitCall } from '$lib/call-log-pending';
  import { appLocale, t } from '$lib/i18n';
  import { createQuery } from '@tanstack/svelte-query';
  import { meQueryOptions } from '$lib/nav-queries';
  import { userDisplayName as displayNameFor } from '$lib/utils/identity';

  interface Props {
    /** Current URL's workspace segment — Avatar-name fallback of last resort. */
    workspaceSlug: string;
    /** Workspace the settings link points at (URL's, else the
        user's first workspace). */
    menuWorkspaceSlug: string;
    inSettings: boolean;
    /** Shared with the shell's scope model — the working combo registers in
        Recent before the session dies (see the /h layout). */
    rememberWorkingScope: () => void;
    /** Where the menu opens from its monogram: down from the phone's top
        bar, up from the foot of the rail (ADR-140, enmienda del 20-10). */
    direction?: 'up' | 'down';
    align?: 'start' | 'end';
  }

  let {
    workspaceSlug,
    menuWorkspaceSlug,
    inSettings,
    rememberWorkingScope,
    direction = 'down',
    align = 'end',
  }: Props = $props();

  const locale = appLocale();

  // Identity: the person's stored name (user_profile.full_name via /api/me),
  // then the session's auth-metadata name, then the email local-part.
  const meQuery = createQuery(meQueryOptions());
  let userEmail = $derived(session.user?.email ?? '');
  let userDisplayName = $derived(
    displayNameFor($meQuery.data?.full_name, session.user?.name, session.user?.email),
  );

  // ONE STYLE, LIGHT AND DARK (tarea 132). The menu offered five styles
  // named in English, three of which changed nothing (they had no tokens);
  // what is left is the mode: light, auto, dark.

  // No «Notifications» row and no do-not-disturb bell: Hour sends no
  // notification yet, so both pointed at controls that kept nothing. They
  // come back with the first notification that is real.

  async function logout() {
    rememberWorkingScope();
    // A pending «Ya está» writes its note, and a pending call (ADR-182) its
    // event, while the session still exists.
    await commitDone();
    await commitCall();
    // Server-side: clears the httpOnly cookies + revokes the refresh
    // token at Supabase. Await so the gates can't race a live cookie.
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* offline logout still clears local state */
    }
    // Wipes the device cache too (ADR-144): nothing of this user stays.
    await clearSession();
    goto('/login', { replaceState: true });
  }
</script>

<Menu
  {direction}
  {align}
  label={t('shell.account_menu', locale)}
  triggerClass="kebab"
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
        aria-label={t('shell.sign_out', locale)}
        title={t('shell.sign_out', locale)}
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
        {inSettings ? t('shell.dashboard', locale) : t('shell.all_settings', locale)}
      </a>
    </li>
    <li role="none" class="theme-row">
      <span class="theme-row__label">{t('shell.theme_mode', locale)}</span>
      <ThemeToggle variant="plain" />
    </li>
  {/snippet}
</Menu>

<style>
  /* ── account menu chrome (unchanged from the previous shell) ──
     :global because this markup renders inside <Menu>'s snippet. */

  :global(.menu-header) {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline-start: var(--space-s);
    padding-inline-end: 0;
    border-block-end: var(--line-hairline) solid var(--border-color-light);
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

  :global(.theme-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-s);
    padding-inline-start: var(--space-s);
  }
  :global(.theme-row__label) {
    font-size: var(--text-s);
    color: var(--text-color);
  }
</style>
