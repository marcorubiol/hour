<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { ApiError, mutateJSON } from '$lib/api';
  import { ensureSession } from '$lib/session.svelte';

  type Invitation = {
    workspace_id: string;
    workspace_slug: string;
    workspace_name: string;
    email: string;
    role: string;
    project_id: string | null;
    project_name: string | null;
    project_role_code: string | null;
    expires_at: string;
  };

  let token = $state('');
  let invitation = $state<Invitation | null>(null);
  let loading = $state(true);
  let accepting = $state(false);
  let errorMessage = $state('');

  function roleLabel(role: string): string {
    return role.charAt(0).toUpperCase() + role.slice(1).replaceAll('_', ' ');
  }

  onMount(async () => {
    token = window.location.hash.slice(1);
    if (!token) {
      errorMessage = 'This invitation link is incomplete.';
      loading = false;
      return;
    }

    if (!(await ensureSession())) {
      const next = `/invite#${token}`;
      await goto(`/login?${new URLSearchParams({ next }).toString()}`);
      return;
    }

    try {
      const response = await mutateJSON<{ invitation: Invitation }>(
        'POST',
        '/api/invitations',
        { token },
      );
      invitation = response?.invitation ?? null;
      if (!invitation) errorMessage = 'This invitation is no longer available.';
    } catch (error) {
      errorMessage =
        error instanceof ApiError && error.status === 404
          ? 'This invitation has expired, was revoked, or belongs to another email address.'
          : error instanceof Error
            ? error.message
            : 'The invitation could not be checked.';
    } finally {
      loading = false;
    }
  });

  async function acceptInvitation() {
    if (!invitation || accepting) return;
    accepting = true;
    errorMessage = '';
    try {
      const response = await mutateJSON<{ invitation: Invitation }>(
        'PATCH',
        '/api/invitations',
        { token },
      );
      const accepted = response?.invitation;
      if (!accepted) throw new Error('The invitation returned no workspace.');
      history.replaceState(null, '', '/invite');
      await goto(`/h/${accepted.workspace_slug}`, { replaceState: true });
    } catch (error) {
      errorMessage =
        error instanceof ApiError && error.status === 404
          ? 'This invitation is no longer available.'
          : error instanceof Error
            ? error.message
            : 'The invitation could not be accepted.';
      accepting = false;
    }
  }
</script>

<svelte:head>
  <title>Workspace invitation — Hour</title>
</svelte:head>

<main class="invitation-page">
  <header class="invitation-page__brand"><BrandMark size="m" /></header>

  <section class="invitation-card" aria-busy={loading}>
    <div class="invitation-card__rail" aria-hidden="true"></div>
    <p class="eyebrow invitation-card__kicker">Private invitation</p>

    {#if loading}
      <h1>Checking your <em>place.</em></h1>
      <p class="invitation-card__lede">Verifying the account and invitation boundary…</p>
    {:else if invitation}
      <h1>Join <em>{invitation.workspace_name}.</em></h1>
      <p class="invitation-card__lede">
        This invitation is addressed to {invitation.email}. Review the access below before
        entering the workspace.
      </p>

      <dl class="invitation-card__terms">
        <div>
          <dt>Workspace role</dt>
          <dd>{roleLabel(invitation.role)}</dd>
        </div>
        {#if invitation.project_name}
          <div>
            <dt>Assigned project</dt>
            <dd>{invitation.project_name}</dd>
          </div>
          <div>
            <dt>Project role</dt>
            <dd>{roleLabel(invitation.project_role_code ?? '')}</dd>
          </div>
        {/if}
        <div>
          <dt>Valid until</dt>
          <dd>{new Date(invitation.expires_at).toLocaleDateString()}</dd>
        </div>
      </dl>

      {#if errorMessage}<p class="invitation-card__error" role="alert">{errorMessage}</p>{/if}
      <button
        type="button"
        class="btn--primary invitation-card__accept"
        disabled={accepting}
        onclick={acceptInvitation}
      >
        <span>{accepting ? 'Joining…' : 'Accept and enter'}</span>
        <span aria-hidden="true">→</span>
      </button>
      <p class="invitation-card__fineprint">
        Acceptance grants only the role and project shown here. Your personal profile remains
        separate from the workspace’s private contact dossier.
      </p>
    {:else}
      <h1>Invitation <em>unavailable.</em></h1>
      <p class="invitation-card__lede">{errorMessage}</p>
      <a class="btn--outline invitation-card__accept" href="/login">Return to sign in</a>
    {/if}
  </section>

  <footer class="invitation-page__foot">Hour · access is explicit, scoped and revocable</footer>
</main>

<style>
  @layer components {
    .invitation-page {
      min-block-size: 100dvh;
      display: grid;
      grid-template-rows: auto 1fr auto;
      padding: clamp(var(--space-l), 5vw, var(--space-xxl));
      background:
        linear-gradient(90deg, transparent 49.9%, var(--border-color-light) 50%, transparent 50.1%),
        var(--bg);
    }
    .invitation-page__brand { display: inline-flex; }
    .invitation-card {
      align-self: center;
      justify-self: center;
      position: relative;
      inline-size: min(100%, 42rem);
      padding: clamp(var(--space-l), 5vw, var(--space-xxl));
      border: 1px solid var(--border-color-dark);
      background: color-mix(in srgb, var(--bg) 94%, transparent);
      box-shadow: 0 24px 80px color-mix(in srgb, var(--text-color) 8%, transparent);
    }
    .invitation-card__rail {
      position: absolute;
      inset-block: -1px;
      inset-inline-start: -1px;
      inline-size: 5px;
      background: var(--accent-color);
    }
    .invitation-card__kicker { margin: 0 0 var(--space-m); }
    .invitation-card h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: clamp(2.3rem, 7vw, 4.6rem);
      font-weight: 400;
      line-height: 0.98;
      letter-spacing: -0.04em;
      text-wrap: balance;
    }
    .invitation-card h1 em { color: var(--text-muted); font-weight: 400; }
    .invitation-card__lede {
      max-inline-size: 48ch;
      margin: var(--space-l) 0;
      color: var(--text-muted);
      line-height: 1.6;
    }
    .invitation-card__terms {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin: 0 0 var(--space-l);
      border-block-start: 1px solid var(--border-color-light);
    }
    .invitation-card__terms div {
      padding: var(--space-m) var(--space-m) var(--space-m) 0;
      border-block-end: 1px solid var(--border-color-light);
    }
    .invitation-card__terms dt {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .invitation-card__terms dd { margin: var(--space-xs) 0 0; }
    .invitation-card__accept { --btn-width: 100%; }
    .invitation-card__error { color: var(--danger); font-size: var(--text-s); }
    .invitation-card__fineprint {
      margin: var(--space-m) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
      line-height: 1.5;
    }
    .invitation-page__foot {
      justify-self: center;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
    }
    @media (max-width: 34rem) {
      .invitation-page { background: var(--bg); }
      .invitation-card__terms { grid-template-columns: 1fr; }
    }
  }
</style>
