<script lang="ts">
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { toStore } from 'svelte/store';
  import { SvelteSet } from 'svelte/reactivity';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { copyText } from '$lib/clipboard';
  import { addToast } from '$lib/components/Toast.svelte';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import { session } from '$lib/session.svelte';
  import { t, appLocale } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Dialog from '$lib/components/Dialog.svelte';

  const locale = appLocale();

  /** Workspace role, in the session's language. */
  function roleLabel(role: string): string {
    return t(`settings.role_${role}`, locale);
  }

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
  // El acceso lo da el paquete; el rol es etiqueta. Por defecto, Mínim (ADR-085 §11).
  let inviteProjectPreset = $state<'minim' | 'equip' | 'coordinacio' | 'direccio'>('minim');
  let latestInviteUrl = $state('');

  const inviteMember = createMutation({
    mutationFn: async () => {
      if (!currentWorkspace) throw new Error(t('settings.access_ws_unavailable', locale));
      const response = await mutateJSON<{
        invitation: { email: string; invite_url: string };
      }>('POST', `/api/workspaces/${currentWorkspace.id}/access`, {
        email: inviteEmail,
        role: inviteRole,
        project_id: inviteProjectId || null,
        project_role_code: inviteProjectId ? inviteProjectRole : null,
        project_preset: inviteProjectId ? inviteProjectPreset : null,
      });
      if (!response?.invitation) throw new Error(t('settings.access_invite_no_link', locale));
      return response.invitation;
    },
    onSuccess: async (invitation) => {
      latestInviteUrl = invitation.invite_url;
      inviteEmail = '';
      await queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      addToast({
        tone: 'success',
        message: t('settings.access_invite_created', locale, { email: invitation.email }),
      });
    },
    onError: (error) => {
      addToast({
        tone: 'danger',
        title: t('settings.access_invite_failed', locale),
        message: error instanceof Error ? error.message : t('perf.unexpected', locale),
      });
    },
  });

  async function copyInviteLink() {
    if (!latestInviteUrl) return;
    addToast(
      (await copyText(latestInviteUrl))
        ? { tone: 'success', message: t('settings.access_link_copied', locale) }
        : { tone: 'danger', message: t('settings.access_link_copy_failed', locale) },
    );
  }

  const savedRole = new SaveFlash();

  async function changeMemberRole(membershipId: string, role: string) {
    if (!currentWorkspace) return;
    try {
      await mutateJSON('PATCH', `/api/workspaces/${currentWorkspace.id}/access`, {
        membership_id: membershipId,
        role,
      });
      await queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      // In place (ADR-139 p7): the row says «guardado», no toast.
      savedRole.show(membershipId);
    } catch (error) {
      addToast({
        tone: 'danger',
        title: t('settings.access_role_not_updated', locale),
        message: error instanceof Error ? error.message : t('perf.unexpected', locale),
      });
    }
  }

  // Revoking asks first, in the app's own dialog: the row waits in `revoking`.
  let revoking = $state<AccessItem | null>(null);
  const revokingLabel = $derived(
    revoking ? (revoking.access_kind === 'member' ? revoking.display_name : revoking.email) : '',
  );
  function revokeAccess(item: AccessItem) {
    revoking = item;
  }
  async function confirmRevoke() {
    const item = revoking;
    revoking = null;
    if (!item || !currentWorkspace) return;
    const label = item.access_kind === 'member' ? item.display_name : item.email;
    try {
      await mutateJSON('DELETE', `/api/workspaces/${currentWorkspace.id}/access`, {
        kind: item.access_kind === 'member' ? 'member' : 'invitation',
        id: item.id,
      });
      await queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      addToast({ tone: 'success', message: t('settings.access_revoked', locale, { label }) });
    } catch (error) {
      addToast({
        tone: 'danger',
        title: t('settings.access_not_revoked', locale),
        message: error instanceof Error ? error.message : t('perf.unexpected', locale),
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
      if (!res?.request) throw new Error(t('settings.alias_empty_response', locale));
      return res.request;
    },
    onSuccess: async (req) => {
      await queryClient.invalidateQueries({ queryKey: ['alias-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      addToast({
        tone: 'success',
        message:
          req.status === 'approved'
            ? t('settings.alias_granted', locale, {
                alias: req.alias,
                space: spaceName(req.workspace_name),
              })
            : t('settings.alias_rejected', locale, { space: spaceName(req.workspace_name) }),
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('settings.alias_review_failed', locale),
        message:
          err instanceof ApiError && err.status === 403
            ? t('settings.alias_forbidden', locale)
            : err instanceof ApiError && err.status === 409
              ? t('settings.alias_taken', locale)
              : err instanceof Error
                ? err.message
                : t('perf.unexpected', locale),
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

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.ws_kicker', locale) }]} title={t('settings.nav_workspaces', locale)}>
  {#snippet facts()}<span>{t('settings.ws_sub', locale)}</span>{/snippet}
</RecordHead>

<section class="set-group">
  <BlockHead title={t('settings.ws_my_spaces', locale)} count={workspaces.length} />
  <div class="set-group__body">
    <!-- Only what is true and works: a space's name and how many projects it
         holds. «Edit role», «Leave», «Create or join» and the people count had
         no writer behind them; they come back with one. -->
    <div class="set-ws-list">
      {#each workspaces as w (w.id)}
        {@const projectCount = projects.filter((p) => p.workspace_id === w.id).length}
        <div class="set-ws" style={`--c: ${accentVar(w.slug)}`}>
          <div class="set-ws__rail"></div>
          <div class="set-ws__name">
            <h3>{spaceName(w.name)}</h3>
          </div>
          <div class="set-ws__meta">
            {t(projectCount === 1 ? 'settings.ws_projects_one' : 'settings.ws_projects_other', locale, { n: projectCount })}
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>

{#if $accessQuery.isSuccess && currentWorkspace}
  <section class="set-group set-access">
    <div class="set-access__head">
      <BlockHead title={t('settings.access_kicker', locale)} count={spaceName(currentWorkspace.name)}>
        <span class="set-access__count"
          >{t(activeMembers.length === 1 ? 'settings.ws_active_one' : 'settings.ws_active_other', locale, { n: activeMembers.length })}</span
        >
      </BlockHead>
    </div>

    <div class="set-access__invite">
      <Input id="invite-email" label={t('settings.email', locale)} type="email" placeholder="collaborator@example.com" bind:value={inviteEmail} />
      <Select id="invite-role" label={t('settings.access_ws_role', locale)} bind:value={inviteRole}>
        <option value="guest">{t('settings.access_opt_guest', locale)}</option>
        <option value="viewer">{t('settings.access_opt_viewer', locale)}</option>
        <option value="member">{t('settings.access_opt_member', locale)}</option>
        <option value="admin">{t('settings.access_opt_admin', locale)}</option>
      </Select>
      <Select id="invite-project" label={t('settings.access_project', locale)} bind:value={inviteProjectId}>
        <option value="">{t('settings.access_no_project', locale)}</option>
        {#each currentProjects as project (project.id)}
          <option value={project.id}>{project.name}</option>
        {/each}
      </Select>
      <Select id="invite-project-role" label={t('settings.access_project_role', locale)} bind:value={inviteProjectRole} disabled={!inviteProjectId}>
        <option value="performer">{t('settings.prole_performer', locale)}</option>
        <option value="viewer">{t('settings.prole_viewer', locale)}</option>
        <option value="director">{t('settings.prole_director', locale)}</option>
        <option value="production_manager">{t('settings.prole_production_manager', locale)}</option>
        <option value="distribution">{t('settings.prole_distribution', locale)}</option>
      </Select>
      <Select id="invite-project-preset" label={t('settings.access_project_preset', locale)} bind:value={inviteProjectPreset} disabled={!inviteProjectId}>
        <option value="minim">{t('preset.minim', locale)}</option>
        <option value="equip">{t('preset.equip', locale)}</option>
        <option value="coordinacio">{t('preset.coordinacio', locale)}</option>
        <option value="direccio">{t('preset.direccio', locale)}</option>
      </Select>
      <Button
        disabled={!inviteEmail || $inviteMember.isPending}
        onclick={() => $inviteMember.mutate()}
      >
        {$inviteMember.isPending
          ? t('settings.access_creating', locale)
          : t('settings.access_create_link', locale)}
      </Button>
    </div>

    {#if latestInviteUrl}
      <div class="set-access__link" role="status">
        <div>
          <span class="eyebrow">{t('settings.access_ready', locale)}</span>
          <p>{t('settings.access_link_expiry', locale)}</p>
        </div>
        <button type="button" class="btn--secondary btn--s" onclick={copyInviteLink}>
          {t('settings.access_copy_link', locale)}
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
            <span class="set-access__role">{roleLabel('owner')}</span>
          {:else}
            <div class="set-access__role-select">
              <Select
                id={`member-role-${member.id}`}
                ariaLabel={t('settings.access_role_for', locale, { name: member.display_name })}
                value={member.role}
                saved={savedRole.is(member.id)}
                onchange={(event) =>
                  changeMemberRole(member.id, (event.currentTarget as HTMLSelectElement).value)}
              >
                <option value="admin">{roleLabel('admin')}</option>
                <option value="member">{roleLabel('member')}</option>
                <option value="viewer">{roleLabel('viewer')}</option>
                <option value="guest">{roleLabel('guest')}</option>
              </Select>
            </div>
          {/if}
          <span class="set-access__status">{t('settings.access_status_active', locale)}</span>
          {#if member.role !== 'owner'}
            <button
              type="button"
              class="btn--secondary btn--s is-warn"
              onclick={() => revokeAccess(member)}
            >{t('settings.access_revoke', locale)}</button>
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
                : t('settings.access_workspace_only', locale)}
            </span>
          </div>
          <span class="set-access__role">{roleLabel(invitation.role)}</span>
          <span class="set-access__status">{t('settings.access_status_pending', locale)}</span>
          <button
            type="button"
            class="btn--secondary btn--s is-warn"
            onclick={() => revokeAccess(invitation)}
          >{t('create.cancel', locale)}</button>
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if aliasRequests.length > 0}
  <section class="set-group">
    <BlockHead
      title={t('settings.alias_title', locale)}
      count={t(aliasRequests.length === 1 ? 'settings.alias_pending_one' : 'settings.alias_pending_other', locale, { n: aliasRequests.length })}
    />
    <div class="set-group__body">
      <div class="set-alias-list">
        {#each aliasRequests as r (r.id)}
          <div class="set-alias">
            <div class="set-alias__what">
              <span class="set-alias__url">/h/{r.alias}</span>
              <span class="set-alias__ws"
                >{t('settings.alias_for', locale, { space: spaceName(r.workspace_name) })}</span
              >
            </div>
            {#if r.requested_by === session.user?.sub}
              <span class="set-alias__state">{t('settings.alias_pending_review', locale)}</span>
            {:else}
              <div class="set-alias__actions">
                <button
                  type="button"
                  class="btn--secondary btn--s"
                  disabled={$reviewAlias.isPending}
                  onclick={() => $reviewAlias.mutate({ id: r.id, approve: true })}
                >
                  {t('settings.alias_approve', locale)}
                </button>
                <button
                  type="button"
                  class="btn--secondary btn--s is-warn"
                  disabled={$reviewAlias.isPending}
                  onclick={() => $reviewAlias.mutate({ id: r.id, approve: false })}
                >
                  {t('settings.alias_reject', locale)}
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
  <BlockHead title={t('settings.roles_kicker', locale)} count={t('settings.roles_title', locale)} />
  <div class="set-group__body">
    <p class="set-prose">
      {t('settings.roles_prose', locale)}
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
          <span>{t(`settings.hat_${role}`, locale)}</span>
        </button>
      {/each}
    </div>
  </div>
</section>

<Dialog
  open={revoking !== null}
  onclose={() => (revoking = null)}
  size="s"
  title={t('settings.access_revoke_title', locale)}
  description={t('settings.access_revoke_confirm', locale, { label: revokingLabel })}
>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (revoking = null)}>{t('create.cancel', locale)}</Button>
    <Button tone="warn" onclick={confirmRevoke}>{t('settings.access_revoke', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  .set-prose {
    font-size: var(--text-s);
    color: var(--text-muted);
    line-height: 1.6;
    margin-block: 0 var(--space-s);
    max-inline-size: 56ch;
  }

  .set-ws-list {
    display: flex;
    flex-direction: column;
  }
  .set-ws {
    display: grid;
    grid-template-columns: var(--dot-s) minmax(0, 1fr) auto;
    gap: var(--set-pad);
    align-items: center;
    padding-block: var(--space-m);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .set-ws:last-child {
    border-block-end: 0;
  }
  .set-ws__rail {
    inline-size: var(--dot-s);
    block-size: 2.375rem;
    background: var(--c);
    border-radius: var(--radius-xs);
  }
  .set-ws__name h3 {
    font-family: var(--font-display);
    font-size: var(--text-l);
    font-weight: 500;
    letter-spacing: var(--heading-letter-spacing);
    margin: 0;
    color: var(--text-color);
  }
  .set-ws__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    white-space: nowrap;
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
    border-block-end: var(--line-hairline) solid var(--border-color-light);
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
    inline-size: var(--dot-l);
    block-size: var(--dot-l);
    border: var(--line-hairline) solid currentColor;
    border-radius: 50%;
    display: inline-block;
  }
  :global(.set-role-chip.pill--on) .set-role-chip__dot {
    background: currentColor;
  }

  .set-access {
    border: var(--line-hairline) solid var(--border-color-dark);
    background: var(--bg-light);
  }
  /* A framed panel: its parts meet at their rules, so the group's gap between
     blocks would only open empty bands inside the frame. */
  .set-group.set-access {
    row-gap: 0;
  }
  /* The access box is a framed panel: its head (a BlockHead, whose rule
     closes it) sits inside the same padding as the invite row below. */
  .set-access__head {
    padding: var(--space-m) var(--space-m) 0;
  }
  .set-access__count,
  .set-access__status,
  .set-access__role {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-l);
    color: var(--text-faint);
  }
  /* Field rows, the verb under them (ADR-139 p4). */
  .set-access__invite {
    display: flex;
    flex-direction: column;
    padding: var(--space-m);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .set-access__invite > :global(button) {
    align-self: flex-end;
    margin-block-start: var(--space-s);
  }
  .set-access__link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-m);
    margin: var(--space-m);
    padding: var(--space-s) var(--space-m);
    border-inline-start: var(--line-thick) solid var(--accent-color);
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
    grid-template-columns: var(--dot-l) minmax(12rem, 1fr) minmax(7rem, auto) 5rem auto;
    gap: var(--space-m);
    align-items: center;
    min-block-size: 4.25rem;
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .set-access__row:last-child { border-block-end: 0; }
  .set-access__mark {
    inline-size: var(--dot-m);
    block-size: var(--dot-m);
    border-radius: 50%;
    background: var(--success);
  }
  .set-access__row.is-pending .set-access__mark {
    background: transparent;
    border: var(--line-hairline) solid var(--text-faint);
  }
  .set-access__identity {
    display: grid;
    gap: var(--space-2xs);
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
  .set-access__role-select { min-inline-size: 8rem; }

  /* By the page's column (`set-page`, the settings page), not the viewport:
     the rail and the settings nav take most of a 768 or 900 screen. */
  @container set-page (width < 40rem) {
    .set-access__row {
      grid-template-columns: var(--dot-l) 1fr auto;
      gap: var(--space-s);
      padding-block: var(--space-s);
    }
    .set-access__role,
    .set-access__role-select { grid-column: 2; }
    .set-access__status { display: none; }
    .set-access__row > button { grid-column: 3; grid-row: 1 / span 2; }
  }
  /* Narrower still, the role and the verb stack under the name. */
  @container set-page (width < 22rem) {
    .set-access__row { grid-template-columns: var(--dot-l) minmax(0, 1fr); }
    .set-access__role-select { min-inline-size: 0; }
    .set-access__row > button { grid-column: 2; grid-row: auto; justify-self: start; }
  }
</style>
