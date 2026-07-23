<script lang="ts">
  import { toStore } from 'svelte/store';
  import { SvelteSet } from 'svelte/reactivity';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { copyText } from '$lib/clipboard';
  import { addToast } from '$lib/components/Toast.svelte';
  import { session } from '$lib/session.svelte';

  type Workspace = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
  };
  type Project = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  let {
    workspaces,
    projects,
    currentWorkspace,
    currentProjects,
  }: {
    workspaces: Workspace[];
    projects: Project[];
    currentWorkspace: Workspace | undefined;
    currentProjects: Project[];
  } = $props();

  const queryClient = useQueryClient();

  // ─── workspace access lifecycle ──────────────────────────────────────
  type AccessItem = {
    access_kind: 'member' | 'invitation';
    id: string;
    user_id: string | null;
    email: string;
    display_name: string;
    role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
    project_id: string | null;
    project_name: string | null;
    project_role_code: string | null;
    status: 'active' | 'pending' | 'accepted' | 'revoked' | 'expired';
    expires_at: string | null;
  };

  const accessOptions = toStore(() => ({
    queryKey: ['workspace-access', currentWorkspace?.id ?? null] as const,
    enabled: Boolean(currentWorkspace?.id),
    retry: false,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: AccessItem[] }>(
        `/api/workspaces/${currentWorkspace!.id}/access`,
        signal,
      ),
  }));
  const accessQuery = createQuery(accessOptions);
  let accessItems = $derived($accessQuery.data?.items ?? []);
  let activeMembers = $derived(
    accessItems.filter((item) => item.access_kind === 'member' && item.status === 'active'),
  );
  let pendingInvitations = $derived(
    accessItems.filter((item) => item.access_kind === 'invitation' && item.status === 'pending'),
  );

  let inviteEmail = $state('');
  let inviteRole = $state<'admin' | 'member' | 'viewer' | 'guest'>('guest');
  let inviteProjectId = $state('');
  let inviteProjectRole = $state('performer');
  let latestInviteUrl = $state('');

  const inviteMember = createMutation({
    mutationFn: async () => {
      if (!currentWorkspace) throw new Error('Workspace unavailable');
      const response = await mutateJSON<{
        invitation: { email: string; invite_url: string };
      }>('POST', `/api/workspaces/${currentWorkspace.id}/access`, {
        email: inviteEmail,
        role: inviteRole,
        project_id: inviteProjectId || null,
        project_role_code: inviteProjectId ? inviteProjectRole : null,
      });
      if (!response?.invitation) throw new Error('Invitation returned no link');
      return response.invitation;
    },
    onSuccess: async (invitation) => {
      latestInviteUrl = invitation.invite_url;
      inviteEmail = '';
      await queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      addToast({
        tone: 'success',
        message: `Invitation created for ${invitation.email}. Copy and send the private link.`,
      });
    },
    onError: (error) => {
      addToast({
        tone: 'danger',
        title: 'Invitation not created',
        message: error instanceof Error ? error.message : 'Unexpected error',
      });
    },
  });

  async function copyInviteLink() {
    if (!latestInviteUrl) return;
    addToast(
      (await copyText(latestInviteUrl))
        ? { tone: 'success', message: 'Private invitation link copied.' }
        : { tone: 'danger', message: 'Could not copy the private invitation link.' },
    );
  }

  async function changeMemberRole(membershipId: string, role: string) {
    if (!currentWorkspace) return;
    try {
      await mutateJSON('PATCH', `/api/workspaces/${currentWorkspace.id}/access`, {
        membership_id: membershipId,
        role,
      });
      await queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      addToast({ tone: 'success', message: 'Workspace role updated.' });
    } catch (error) {
      addToast({
        tone: 'danger',
        title: 'Role not updated',
        message: error instanceof Error ? error.message : 'Unexpected error',
      });
    }
  }

  async function revokeAccess(item: AccessItem) {
    if (!currentWorkspace) return;
    const label = item.access_kind === 'member' ? item.display_name : item.email;
    if (!window.confirm(`Revoke access for ${label}? Open sessions will be reauthorized.`)) return;
    try {
      await mutateJSON('DELETE', `/api/workspaces/${currentWorkspace.id}/access`, {
        kind: item.access_kind === 'member' ? 'member' : 'invitation',
        id: item.id,
      });
      await queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      addToast({ tone: 'success', message: `Access revoked for ${label}.` });
    } catch (error) {
      addToast({
        tone: 'danger',
        title: 'Access not revoked',
        message: error instanceof Error ? error.message : 'Unexpected error',
      });
    }
  }

  // ─── alias requests (ADR-067) ─────────────────────────────────────────
  // RLS scopes the list: a member sees their own workspace's requests, the
  // platform admin sees all. Review buttons hide on your own rows; the RPC
  // is the real gate (403 for non-admins) — the UI just avoids dead ends.
  type AliasRequest = {
    id: string;
    workspace_id: string;
    workspace_name: string;
    alias: string;
    status: string;
    requested_by: string;
    created_at: string;
  };

  const aliasRequestsQuery = createQuery({
    queryKey: ['alias-requests', 'pending'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: AliasRequest[] }>(
        '/api/workspaces/alias-requests?status=pending',
        signal,
      ),
  });
  let aliasRequests = $derived($aliasRequestsQuery.data?.items ?? []);

  const reviewAlias = createMutation({
    mutationFn: async (input: { id: string; approve: boolean }) => {
      const res = await mutateJSON<{ request: AliasRequest }>(
        'PATCH',
        `/api/workspaces/alias-requests/${input.id}`,
        { approve: input.approve },
      );
      if (!res?.request) throw new Error('Empty response');
      return res.request;
    },
    onSuccess: async (req) => {
      await queryClient.invalidateQueries({ queryKey: ['alias-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      addToast({
        tone: 'success',
        message:
          req.status === 'approved'
            ? `Alias /h/${req.alias} granted to ${req.workspace_name}.`
            : `Alias request from ${req.workspace_name} rejected.`,
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Review failed',
        message:
          err instanceof ApiError && err.status === 403
            ? 'Only the platform operator can review alias requests.'
            : err instanceof ApiError && err.status === 409
              ? 'That alias is no longer available.'
              : err instanceof Error
                ? err.message
                : 'Unexpected error',
      });
    },
  });

  // Hardcoded role set for Phase 0 — Marco's hats.
  const ALL_ROLES = [
    'author',
    'performer',
    'musician',
    'lighting',
    'sound',
    'production',
    'distribution',
    'technician',
  ];
  const activeRoles = new SvelteSet<string>([
      'musician',
      'lighting',
      'distribution',
      'production',
      'author',
      'performer',
    ]);

  function toggleRole(role: string) {
    if (activeRoles.has(role)) activeRoles.delete(role);
    else activeRoles.add(role);
  }
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">Roster</p>
  <h1 class="set-mast__title"><em>Workspaces &amp; roles</em></h1>
  <p class="set-mast__sub">
    A workspace holds the company boundary. Project assignments decide
    which productions each collaborator can enter.
  </p>
</header>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{workspaces.length} active</span>
    <h2 class="set-group__title">My projects</h2>
  </div>
  <div class="set-group__body">
    <div class="set-ws-list">
      {#each workspaces as w (w.id)}
        {@const projectCount = projects.filter((p) => p.workspace_id === w.id).length}
        <div class="set-ws" style={`--c: ${accentVar(w.slug)}`}>
          <div class="set-ws__rail"></div>
          <div class="set-ws__name">
            <h3>{w.name}</h3>
          </div>
          <!-- personal/team label + kind-derived role badges removed
               (ADR-064): personal/team is not a real distinction, and
               real per-workspace roles need the (pending) members
               endpoint — no fabricated badges. -->
          <div class="set-ws__roles"></div>
          <div class="set-ws__meta">
            <span>— people</span>
            <span class="sep">·</span>
            <span>{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>
          </div>
          <div class="set-ws__actions">
            <button type="button" class="btn--outline btn--s">Edit role</button>
            <button type="button" class="btn--outline btn--s is-warn">Leave</button>
          </div>
        </div>
      {/each}
    </div>
    <button type="button" class="set-add">
      + Create or join a workspace
    </button>
  </div>
</section>

{#if $accessQuery.isSuccess && currentWorkspace}
  <section class="set-group set-access">
    <div class="set-group__head set-access__head">
      <div>
        <span class="eyebrow set-group__kicker">Access desk</span>
        <h2 class="set-group__title">{currentWorkspace.name}</h2>
      </div>
      <span class="set-access__count">{activeMembers.length} active</span>
    </div>

    <div class="set-access__invite">
      <label>
        <span class="eyebrow">Email</span>
        <input type="email" placeholder="collaborator@example.com" bind:value={inviteEmail} />
      </label>
      <label>
        <span class="eyebrow">Workspace role</span>
        <select bind:value={inviteRole}>
          <option value="guest">Guest · assigned work only</option>
          <option value="viewer">Viewer · internal read-only</option>
          <option value="member">Member · internal collaborator</option>
          <option value="admin">Admin · manages access</option>
        </select>
      </label>
      <label>
        <span class="eyebrow">Project assignment</span>
        <select bind:value={inviteProjectId}>
          <option value="">No project yet</option>
          {#each currentProjects as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="eyebrow">Project role</span>
        <select bind:value={inviteProjectRole} disabled={!inviteProjectId}>
          <option value="performer">Performer · production read</option>
          <option value="viewer">Viewer · production read</option>
          <option value="director">Director · production edit</option>
          <option value="production_manager">Production manager</option>
          <option value="distribution">Distribution</option>
        </select>
      </label>
      <button
        type="button"
        class="btn--primary set-access__invite-button"
        disabled={!inviteEmail || $inviteMember.isPending}
        onclick={() => $inviteMember.mutate()}
      >
        {$inviteMember.isPending ? 'Creating…' : 'Create private link'}
      </button>
    </div>

    {#if latestInviteUrl}
      <div class="set-access__link" role="status">
        <div>
          <span class="eyebrow">Ready to send</span>
          <p>The link expires in 7 days and works only for the invited email.</p>
        </div>
        <button type="button" class="btn--outline btn--s" onclick={copyInviteLink}>
          Copy invitation link
        </button>
      </div>
    {/if}

    <div class="set-access__ledger">
      {#each activeMembers as member (member.id)}
        <div class="set-access__row">
          <span class="set-access__mark" aria-hidden="true"></span>
          <div class="set-access__identity">
            <strong>{member.display_name}</strong>
            <span>{member.email}</span>
          </div>
          {#if member.role === 'owner'}
            <span class="set-access__role">Owner</span>
          {:else}
            <label class="set-access__role-select">
              <span class="sr-only">Role for {member.display_name}</span>
              <select
                value={member.role}
                onchange={(event) =>
                  changeMemberRole(member.id, event.currentTarget.value)}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
                <option value="guest">Guest</option>
              </select>
            </label>
          {/if}
          <span class="set-access__status">active</span>
          {#if member.role !== 'owner'}
            <button
              type="button"
              class="btn--outline btn--s is-warn"
              onclick={() => revokeAccess(member)}
            >Revoke</button>
          {/if}
        </div>
      {/each}

      {#each pendingInvitations as invitation (invitation.id)}
        <div class="set-access__row is-pending">
          <span class="set-access__mark" aria-hidden="true"></span>
          <div class="set-access__identity">
            <strong>{invitation.email}</strong>
            <span>
              {invitation.project_name
                ? `${invitation.project_name} · ${invitation.project_role_code}`
                : 'Workspace only'}
            </span>
          </div>
          <span class="set-access__role">{invitation.role}</span>
          <span class="set-access__status">pending</span>
          <button
            type="button"
            class="btn--outline btn--s is-warn"
            onclick={() => revokeAccess(invitation)}
          >Cancel</button>
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if aliasRequests.length > 0}
  <section class="set-group">
    <div class="set-group__head">
      <span class="eyebrow set-group__kicker">{aliasRequests.length} pending</span>
      <h2 class="set-group__title">Alias requests</h2>
    </div>
    <div class="set-group__body">
      <div class="set-alias-list">
        {#each aliasRequests as r (r.id)}
          <div class="set-alias">
            <div class="set-alias__what">
              <span class="set-alias__url">/h/{r.alias}</span>
              <span class="set-alias__ws">for {r.workspace_name}</span>
            </div>
            {#if r.requested_by === session.user?.sub}
              <span class="set-alias__state">pending review</span>
            {:else}
              <div class="set-alias__actions">
                <button
                  type="button"
                  class="btn--outline btn--s"
                  disabled={$reviewAlias.isPending}
                  onclick={() => $reviewAlias.mutate({ id: r.id, approve: true })}
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="btn--outline btn--s is-warn"
                  disabled={$reviewAlias.isPending}
                  onclick={() => $reviewAlias.mutate({ id: r.id, approve: false })}
                >
                  Reject
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>
{/if}

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">By role</span>
    <h2 class="set-group__title">Roles I take on</h2>
  </div>
  <div class="set-group__body">
    <p class="set-prose">
      Hour groups your work by the role you play. Toggle which roles to
      surface in the side filter.
    </p>
    <div class="set-roles-grid">
      {#each ALL_ROLES as role (role)}
        <button
          type="button"
          class={['pill--sm', 'pill--mono', 'set-role-chip', activeRoles.has(role) && 'pill--on']
            .filter(Boolean)
            .join(' ')}
          onclick={() => toggleRole(role)}
        >
          <span class="set-role-chip__dot" aria-hidden="true"></span>
          <span>{role}</span>
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  .set-prose {
    font-size: var(--text-s);
    color: var(--text-muted);
    line-height: 1.6;
    margin-block: 0 var(--space-s);
    max-inline-size: 56ch;
  }

  /* Pseudo-button "+ Add a thing" — dashed outline placeholder for
     creation affordances. Specific enough to keep local. */
  .set-add {
    appearance: none;
    align-self: flex-start;
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border: 1px dashed var(--border-color-dark);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    cursor: pointer;
    margin-block-start: var(--space-s);
    transition: color var(--transition), border-color var(--transition);
  }
  .set-add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }

  .set-ws-list {
    display: flex;
    flex-direction: column;
  }
  .set-ws {
    display: grid;
    grid-template-columns: 4px minmax(140px, 1fr) auto auto auto;
    gap: var(--set-pad);
    align-items: center;
    padding-block: var(--space-m);
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-ws:last-child {
    border-block-end: 0;
  }
  .set-ws__rail {
    inline-size: 4px;
    block-size: 38px;
    background: var(--c);
    border-radius: 2px;
  }
  .set-ws__name h3 {
    font-family: var(--font-display);
    font-size: var(--text-l);
    font-weight: 500;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--text-color);
  }
  .set-ws__sub {
    font-size: var(--text-xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    margin-block-start: 2px;
  }
  .set-ws__roles {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
    max-inline-size: 280px;
  }
  /* Role badges via base.css .role-badge (+ .is-mine). */
  .set-ws__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    display: flex;
    gap: var(--space-xs);
    white-space: nowrap;
  }
  .set-ws__meta .sep {
    opacity: 0.5;
  }
  .set-ws__actions {
    display: flex;
    gap: var(--space-xs);
  }

  .set-alias-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
  }

  .set-alias {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-m);
    padding-block: var(--space-s);
    border-block-end: 1px solid var(--border-color-light);
  }

  .set-alias__what {
    display: flex;
    align-items: baseline;
    gap: var(--space-s);
    min-inline-size: 0;
  }

  .set-alias__url {
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--text-color);
  }

  .set-alias__ws {
    font-size: var(--text-s);
    color: var(--text-muted);
  }

  .set-alias__state {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }

  .set-alias__actions {
    display: flex;
    gap: var(--space-xs);
  }

  .set-roles-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  /* Pill skeleton (base.css) carries the chip; only the dot is local. */
  .set-role-chip {
    --pill-gap: var(--space-xs);
  }
  .set-role-chip__dot {
    inline-size: 7px;
    block-size: 7px;
    border: 1px solid currentColor;
    border-radius: 50%;
    display: inline-block;
  }
  :global(.set-role-chip.pill--on) .set-role-chip__dot {
    background: currentColor;
  }

  .set-access {
    border: 1px solid var(--border-color-dark);
    background: var(--bg-light);
  }
  .set-access__head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-m);
  }
  .set-access__count,
  .set-access__status,
  .set-access__role {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-faint);
  }
  .set-access__invite {
    display: grid;
    grid-template-columns: minmax(12rem, 1.4fr) repeat(3, minmax(9rem, 1fr)) auto;
    gap: var(--space-s);
    align-items: end;
    padding: var(--space-m);
    border-block: 1px solid var(--border-color-light);
  }
  .set-access__invite label {
    display: grid;
    gap: var(--space-xs);
  }
  .set-access__invite-button { white-space: nowrap; }
  .set-access__link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-m);
    margin: var(--space-m);
    padding: var(--space-s) var(--space-m);
    border-inline-start: 3px solid var(--accent-color);
    background: var(--bg);
  }
  .set-access__link p {
    margin: var(--space-xs) 0 0;
    color: var(--text-muted);
    font-size: var(--text-s);
  }
  .set-access__ledger { padding-inline: var(--space-m); }
  .set-access__row {
    display: grid;
    grid-template-columns: 8px minmax(12rem, 1fr) minmax(7rem, auto) 5rem auto;
    gap: var(--space-m);
    align-items: center;
    min-block-size: 4.25rem;
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-access__row:last-child { border-block-end: 0; }
  .set-access__mark {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--success);
  }
  .set-access__row.is-pending .set-access__mark {
    background: transparent;
    border: 1px solid var(--text-faint);
  }
  .set-access__identity {
    display: grid;
    gap: 2px;
    min-inline-size: 0;
  }
  .set-access__identity strong {
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .set-access__identity span {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .set-access__role-select select { min-inline-size: 8rem; }

  @media (max-width: 72rem) {
    .set-access__invite { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .set-access__invite-button { grid-column: 1 / -1; }
  }
  @media (max-width: 44rem) {
    .set-access__invite { grid-template-columns: 1fr; }
    .set-access__row {
      grid-template-columns: 8px 1fr auto;
      gap: var(--space-s);
      padding-block: var(--space-s);
    }
    .set-access__role,
    .set-access__role-select { grid-column: 2; }
    .set-access__status { display: none; }
    .set-access__row > button { grid-column: 3; grid-row: 1 / span 2; }
  }
</style>
