<script lang="ts">
  import { onMount } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { session } from '$lib/session.svelte';
  import { ApiError, mutateJSON } from '$lib/api';
  import { meQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { addToast } from '$lib/components/Toast.svelte';
  import { t, appLocale } from '$lib/i18n';

  const locale = appLocale();

  let { workspaceSlug }: { workspaceSlug: string } = $props();

  // ─── identity from session ────────────────────────────────────────────
  let userEmail = $derived(session.user?.email ?? '');
  let userName = $state('');

  onMount(() => {
    const name = session.user?.name;
    if (name) userName = name;
  });

  let initials = $derived(
    userName
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'MR',
  );

  // ─── where I exist as a person ────────────────────────────────────────
  // The one live group in this section: everything above it is still the
  // design mock (the name and avatar inputs persist nothing yet).
  //
  // A login and a person are two different things. Being a PERSON in a
  // workspace is what lets you be cast in a production, appear on a road
  // sheet, carry an absence and be found on the person axis — roster rows
  // point at your dossier there through a composite key, so without one you
  // are simply not selectable. Sharing is what creates it, and it stays an
  // explicit act per workspace: it writes your name into somebody else's
  // company, which is not something an invitation should do on your behalf.
  const queryClient = useQueryClient();
  const workspacesQuery = createQuery(workspacesQueryOptions());
  const meQuery = createQuery(meQueryOptions());

  // The stored name wins over the JWT's display name: it is the one that gets
  // copied into every dossier, so it is the one you are editing here. Seeded
  // once, when it lands — re-seeding on every read would fight the keyboard.
  let nameSeeded = $state(false);
  $effect(() => {
    const stored = $meQuery.data?.full_name;
    if (!nameSeeded && typeof stored === 'string' && stored.length > 0) {
      userName = stored;
      nameSeeded = true;
    }
  });

  /**
   * Save the name. This input has looked editable since the section was
   * drawn and saved nothing — a fabricated control, which is the one thing
   * this codebase keeps killing on sight. Now it writes, and it writes the
   * field the whole roster chain reads.
   */
  const saveName = createMutation({
    mutationFn: (full_name: string) => mutateJSON('PATCH', '/api/me', { full_name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      addToast({ tone: 'success', message: t('settings.profile_name_saved', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_saved', locale),
        message:
          err instanceof ApiError || err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function commitName() {
    const next = userName.trim();
    // Nothing typed, or nothing changed — never a write for a focus event.
    if (!next || next === ($meQuery.data?.full_name ?? '')) return;
    $saveName.mutate(next);
  }

  let myWorkspaces = $derived($workspacesQuery.data?.items ?? []);
  let sharedByWorkspace = $derived(
    new Map(($meQuery.data?.dossiers ?? []).map((d) => [d.workspace_id, d])),
  );
  let pendingWorkspace = $state<string | null>(null);

  const shareProfile = createMutation({
    mutationFn: async (input: { workspaceId: string; on: boolean }) => {
      pendingWorkspace = input.workspaceId;
      if (input.on) {
        // Name only. Everything else on this page is yours until you say
        // otherwise, one field at a time — never as a side effect of joining.
        return await mutateJSON('POST', '/api/me/profile-share', {
          workspace_id: input.workspaceId,
          fields: ['full_name'],
        });
      }
      return await mutateJSON('DELETE', '/api/me/profile-share', {
        workspace_id: input.workspaceId,
      });
    },
    onSuccess: (_data, input) => {
      // `['me']` holds the link and the dossiers; the team feed holds the
      // names every person-facing surface reads.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['planner-team'] });
      addToast({
        tone: 'success',
        message: input.on
          ? t('settings.profile_share_on', locale)
          : t('settings.profile_share_off', locale),
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_saved', locale),
        message:
          err instanceof ApiError || err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
    onSettled: () => {
      pendingWorkspace = null;
    },
  });
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">{t('settings.profile_kicker', locale)}</p>
  <h1 class="set-mast__title"><em>{t('settings.nav_profile', locale)}</em></h1>
  <p class="set-mast__sub">{t('settings.profile_sub', locale)}</p>
</header>

<section class="set-group">
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.profile_avatar', locale)}</div>
        <div class="set-row__hint">{t('settings.profile_avatar_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-avatar-pick">
          <span
            class="set-avatar-pick__big"
            style={`background: ${accentVar(workspaceSlug)}`}
          >
            {initials}
          </span>
          <button type="button" class="btn--primary btn--s">{t('settings.profile_upload', locale)}</button>
          <span class="set-row__hint">{t('settings.profile_upload_hint', locale)}</span>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.profile_name', locale)}</div>
        <div class="set-row__hint">{t('settings.profile_name_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <input
          type="text"
          bind:value={userName}
          disabled={$saveName.isPending}
          onblur={commitName}
          onkeydown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
        />
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.email', locale)}</div>
        <div class="set-row__hint">{t('settings.profile_email_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <input type="email" bind:value={userEmail} readonly />
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.profile_identity_kicker', locale)}</span>
    <h2 class="set-group__title">{t('settings.profile_identity_title', locale)}</h2>
  </div>
  <div class="set-group__body">
    <p class="set-row__hint set-person__lead">
      {t('settings.profile_identity_lead_a', locale)}
      <em>{t('settings.profile_identity_lead_person', locale)}</em>
      {t('settings.profile_identity_lead_b', locale)}
    </p>

    {#if $meQuery.isSuccess && $workspacesQuery.isSuccess}
      {#each myWorkspaces as w (w.id)}
        {@const dossier = sharedByWorkspace.get(w.id)}
        {@const on = Boolean(dossier?.profile_sync_enabled)}
        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">{spaceName(w.name)}</div>
            <div class="set-row__hint">
              {#if on}
                {t('settings.profile_known_as', locale)} <b>{dossier?.full_name}</b>
              {:else if dossier}
                {t('settings.profile_name_stale', locale)}
              {:else}
                {t('settings.profile_not_person', locale)}
              {/if}
            </div>
          </div>
          <div class="set-row__ctrl">
            <button
              type="button"
              class={on ? 'btn--outline btn--s' : 'btn--primary btn--s'}
              disabled={pendingWorkspace === w.id}
              onclick={() => $shareProfile.mutate({ workspaceId: w.id, on: !on })}
            >
              {pendingWorkspace === w.id
                ? '…'
                : on
                  ? t('settings.profile_stop_sharing', locale)
                  : t('settings.profile_share_name', locale)}
            </button>
          </div>
        </div>
      {/each}
      {#if myWorkspaces.length === 0}
        <p class="set-row__hint">{t('settings.profile_no_spaces', locale)}</p>
      {/if}
    {:else}
      <p class="set-row__hint">{t('desk.loading', locale)}</p>
    {/if}
  </div>
</section>

<!-- LOCATION & TIMEZONE group killed: timezone derives from
     browser automatically, week-starts-on default to Monday is
     fine for Phase 0, location adds nothing operational.
     Pronouns and Display name killed too (Phase 0 reality:
     solo Marco; pronouns opens a debate we don't need to host). -->

<style>
  .set-avatar-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-m);
    flex-wrap: wrap;
  }
  .set-person__lead {
    max-inline-size: 60ch;
    margin-block-end: var(--space-s);
    line-height: 1.5;
  }
  .set-person__lead em {
    font-style: italic;
  }
  .set-avatar-pick__big {
    inline-size: 56px;
    block-size: 56px;
    border-radius: 50%;
    color: var(--bg);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-l);
    font-weight: 600;
    flex: none;
  }
</style>
