<script lang="ts">
  import { onMount } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { session } from '$lib/session.svelte';
  import { ApiError, mutateJSON } from '$lib/api';
  import { meQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { addToast } from '$lib/components/Toast.svelte';

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
      addToast({ tone: 'success', message: 'Name saved' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not saved',
        message: err instanceof ApiError || err instanceof Error ? err.message : 'Unexpected error',
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
        message: input.on ? 'Your name is now in this space' : 'Sharing stopped',
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not saved',
        message: err instanceof ApiError || err instanceof Error ? err.message : 'Unexpected error',
      });
    },
    onSettled: () => {
      pendingWorkspace = null;
    },
  });
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Account</p>
  <h1 class="set-mast__title"><em>Profile</em></h1>
  <p class="set-mast__sub">
    The basics. Used across your projects and on press kits.
  </p>
</header>

<section class="set-group">
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Avatar</div>
        <div class="set-row__hint">A monogram for now. Drop an image later.</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-avatar-pick">
          <span
            class="set-avatar-pick__big"
            style={`background: ${accentVar(workspaceSlug)}`}
          >
            {initials}
          </span>
          <button type="button" class="btn--primary btn--s">Upload image</button>
          <span class="set-row__hint">PNG, square, ≥ 256px</span>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Full name</div>
        <div class="set-row__hint">
          How every company you work with sees you — it is the name copied into
          each space below.
        </div>
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
        <div class="set-row__label">Email</div>
        <div class="set-row__hint">Sign-in and project invitations.</div>
      </div>
      <div class="set-row__ctrl">
        <input type="email" bind:value={userEmail} readonly />
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">Identity</span>
    <h2 class="set-group__title">Where you exist as a person</h2>
  </div>
  <div class="set-group__body">
    <p class="set-row__hint set-person__lead">
      Signing in makes you an operator. Sharing your name with a space makes
      you a <em>person</em> there — someone who can be cast in a production,
      appear on a road sheet, carry an absence, and be found by name. Only
      your name is shared; stopping later keeps the name the space already has
      but sends nothing new.
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
                Known here as <b>{dossier?.full_name}</b>
              {:else if dossier}
                Your name is here, but nothing new is being shared
              {:else}
                Not a person in this space yet
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
              {pendingWorkspace === w.id ? '…' : on ? 'Stop sharing' : 'Share my name'}
            </button>
          </div>
        </div>
      {/each}
      {#if myWorkspaces.length === 0}
        <p class="set-row__hint">You are not a member of any space yet.</p>
      {/if}
    {:else}
      <p class="set-row__hint">Loading…</p>
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
