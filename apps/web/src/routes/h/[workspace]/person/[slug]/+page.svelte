<script lang="ts">
  /**
   * Person detail — one workspace's dossier for a portable person identity.
   * Contact data and every related list are explicitly scoped to the
   * workspace in the URL; the global person id is only the identity bridge.
   */

  import { docTitle } from '$lib/doc-title';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import Acquaintance from '$lib/components/Acquaintance.svelte';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { ApiError } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import { copyText } from '$lib/clipboard';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { session } from '$lib/session.svelte';
  import { relationLabel, relationTone, type Relation } from '$lib/conversation-relation';
  import { dayLabel, dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import { useBreadcrumb } from '$lib/stores/breadcrumb.svelte';
  import { usePins } from '$lib/stores/pins.svelte';
  import { buildLineIndex, buildProjectIndex, projectsInScope, resolveScope } from '$lib/nav';
  import {
    activeProjectsQueryOptions,
    allLinesQueryOptions,
    workspacesQueryOptions,
  } from '$lib/nav-queries';
  import { accentVar } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { safeHref } from '$lib/utils/safe-url';

  type PersonFile = {
    person: {
      id: string;
      slug: string;
      full_name: string;
      title: string | null;
      organization_name: string | null;
      email: string | null;
      phone: string | null;
      website: string | null;
      city: string | null;
      country: string | null;
      languages: string[];
    };
    conversations: Array<{
      id: string;
      slug: string;
      /** The derived relation (ADR-138 § 4). */
      relation: Relation;
      next_action_at: string | null;
      next_action_note: string | null;
      project: { id: string; slug: string; name: string; workspace_id: string } | null;
      /** ADR-102: with whom (the person is one of its contacts). */
      organization: { id: string; slug: string; name: string } | null;
    }>;
    notes: Array<{
      id: string;
      body: string;
      /** The day the note lives on (ADR-093 §1) — not necessarily the day it
          was written about. */
      on_day: string;
      workspace_id: string;
      author_id: string | null;
      created_at: string;
    }>;
    crew: Array<{
      id: string;
      role: string;
      performance: {
        id: string;
        slug: string | null;
        performed_at: string;
        venue_name: string | null;
        city: string | null;
      } | null;
    }>;
    cast: Array<{
      id: string;
      role: string;
      project: { id: string; slug: string; name: string } | null;
    }>;
    /** Only an admin of the space invites (ADR-107). */
    can_invite?: boolean;
  };

  const locale = appLocale();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let slug = $derived(page.params.slug ?? '');

  const workspacesQuery = createQuery(workspacesQueryOptions());

  let contextWorkspaceId = $derived(
    ($workspacesQuery.data?.items ?? []).find((w) => w.slug === workspaceSlug)?.id ?? '',
  );

  const queryOptions = toStore(() => {
    const personSlug = slug;
    const workspaceId = contextWorkspaceId;
    return {
      queryKey: ['person', workspaceId, personSlug] as const,
      enabled: Boolean(personSlug && workspaceId),
      // A 404 is the answer (a dossier of someone else's private conversation,
      // or the directory without Converses, ADR-124): no retries.
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<PersonFile>(
          `/api/persons/${encodeURIComponent(personSlug)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          signal,
        ),
    };
  });
  const query = createQuery(queryOptions);

  const breadcrumb = useBreadcrumb();
  let activeWorkspaceName = $derived(
    spaceName($workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name ?? workspaceSlug),
  );

  // A person is cross-cutting (global, appears across projects), not a tree
  // node — so the address is Space › Person, no pin (persons aren't in the
  // pin model). The "appears in N projects" lives in the page body.
  $effect(() => {
    const p = $query.data?.person;
    if (p) {
      breadcrumb.set([
        {
          label: activeWorkspaceName,
          href: `/h/${workspaceSlug}/`,
          kind: 'space',
          accent: accentVar(workspaceSlug),
        },
        { label: p.full_name, kind: 'node' },
      ]);
    } else {
      breadcrumb.clear();
    }
    return () => breadcrumb.clear();
  });

  let file = $derived($query.data ?? null);
  let loading = $derived($query.isPending);

  // ── Note composer ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  let noteBody = $state('');

  const noteMutation = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ note?: unknown; detail?: string; error?: string }>(
        'POST',
        `/api/persons/${encodeURIComponent(slug)}/notes`,
        {
          workspace_id: contextWorkspaceId,
          body: noteBody,
          // The writer's own day, not the server's UTC one (ADR-093 §1).
          on_day: new Date().toLocaleDateString('en-CA'),
        },
      );
      if (!body?.note) {
        throw new Error(body?.detail || body?.error || t('perf.unexpected', locale));
      }
      return body.note;
    },
    onSuccess: () => {
      noteBody = '';
      void queryClient.invalidateQueries({
        queryKey: ['person', contextWorkspaceId, slug],
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('person.note_not_saved', locale),
        message: t('perf.try_again', locale, {
          error: err instanceof Error ? err.message : t('perf.unexpected', locale),
        }),
      });
    },
  });

  function addNote() {
    if (!noteBody.trim()) return;
    if (!contextWorkspaceId) {
      addToast({ tone: 'warning', message: t('person.workspace_unresolved', locale) });
      return;
    }
    $noteMutation.mutate();
  }

  // Delete is author-only (enforced by the delete_note RPC); the button only
  // shows on the caller's own notes — which, since ADR-093, is all of them.
  let callerId = $derived(session.user?.sub ?? '');

  const deleteNote = createMutation({
    mutationFn: async (noteId: string) => {
      await mutateJSON('DELETE', `/api/persons/${encodeURIComponent(slug)}/notes/${noteId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['person', contextWorkspaceId, slug],
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('person.note_not_deleted', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  // ── Add to project (ADR-051): a new conversation for this person ────
  // The picker offers only the projects of the current scope (drop 11-10),
  // resolved the same way the lenses resolve it.
  const pins = usePins();
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  let scope = $derived.by(() => {
    const workspaces = $workspacesQuery.data?.items ?? [];
    return resolveScope(
      pins.pins,
      workspaces,
      buildLineIndex(workspaces, $linesQuery.data?.items ?? []),
      buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []),
    );
  });

  let addOpen = $state(false);
  let aProject = $state('');

  let projectOptions = $derived.by(() => {
    // Offer only projects without a live conversation for this person.
    const taken = new Set((file?.conversations ?? []).map((e) => e.project?.id));
    return projectsInScope(scope, $projectsQuery.data?.items ?? [])
      .filter((p) => !taken.has(p.id))
      .map((p) => ({ value: p.id, label: p.name ?? p.slug }));
  });

  const addConversation = createMutation({
    mutationFn: () =>
      mutateJSON<{ conversation: unknown }>('POST', '/api/conversations', {
        project_id: aProject,
        person_id: file!.person.id,
      }),
    onSuccess: () => {
      addOpen = false;
      aProject = '';
      void queryClient.invalidateQueries({
        queryKey: ['person', contextWorkspaceId, slug],
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      addToast({ tone: 'success', message: t('person.added_to_project', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('person.not_added', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function submitAddConversation() {
    if (!aProject) {
      addToast({ tone: 'warning', message: t('create.pick_project', locale) });
      return;
    }
    $addConversation.mutate();
  }

  // ── Details (ADR-107): what the quick add left for later ───────────
  let editOpen = $state(false);
  let eName = $state('');
  let eEmail = $state('');
  let ePhone = $state('');
  let eTitle = $state('');

  function openEdit() {
    if (!file) return;
    eName = file.person.full_name;
    eEmail = file.person.email ?? '';
    ePhone = file.person.phone ?? '';
    eTitle = file.person.title ?? '';
    editOpen = true;
  }

  const saveDetails = createMutation({
    mutationFn: () =>
      mutateJSON('PATCH', `/api/persons/${file!.person.id}`, {
        workspace_id: contextWorkspaceId,
        full_name: eName,
        email: eEmail.trim() || null,
        phone: ePhone.trim() || null,
        title: eTitle.trim() || null,
      }),
    onSuccess: () => {
      editOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['person', contextWorkspaceId, slug] });
      void queryClient.invalidateQueries({ queryKey: ['planner-team'] });
      addToast({ tone: 'success', message: t('person.saved', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('person.not_saved', locale),
        message:
          err instanceof ApiError && err.status === 409
            ? t('person.email_taken', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      });
    },
  });

  // ── Invite to Hour from the file (ADR-107) ──────────────────────────
  // The invitation names this dossier: accepting it joins the account to
  // it, so the cast, the notes and the rest stay where they are.
  let inviteOpen = $state(false);
  let iEmail = $state('');
  let iRole = $state('member');
  let inviteUrl = $state('');
  const inviteRoles = (['member', 'viewer', 'guest', 'admin'] as const).map((r) => ({
    value: r,
    label: t(`settings.role_${r}`, locale),
  }));

  function openInvite() {
    iEmail = file?.person.email ?? '';
    iRole = 'member';
    inviteUrl = '';
    inviteOpen = true;
  }

  const invite = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ invitation?: { invite_url: string } }>(
        'POST',
        `/api/workspaces/${contextWorkspaceId}/access`,
        { email: iEmail.trim(), role: iRole, person_id: file!.person.id },
      );
      if (!body?.invitation) throw new Error(t('settings.access_invite_no_link', locale));
      return body.invitation;
    },
    onSuccess: (invitation) => {
      inviteUrl = invitation.invite_url;
      void queryClient.invalidateQueries({ queryKey: ['person', contextWorkspaceId, slug] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('person.invite_failed', locale),
        message:
          err instanceof ApiError && err.status === 409
            ? t('person.email_taken', locale)
            : err instanceof ApiError && err.status === 400
              ? t('person.invite_has_account', locale)
              : err instanceof Error
                ? err.message
                : t('perf.unexpected', locale),
      });
    },
  });

  async function copyInvite() {
    addToast(
      (await copyText(inviteUrl))
        ? { tone: 'success', message: t('settings.access_link_copied', locale) }
        : { tone: 'danger', message: t('settings.access_link_copy_failed', locale) },
    );
  }

  let placeLine = $derived(
    file ? [file.person.city, file.person.country].filter(Boolean).join(', ') : '',
  );
</script>

<svelte:head>
  <title>{docTitle(file?.person.full_name ?? slug)}</title>
</svelte:head>

<article class="person" aria-busy={loading}>
  {#if loading || ($query.isError && !file)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('person.not_found', locale)}
      failedText={t('person.load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else if file}
    <header class="person__head">
      <p class="eyebrow">{t('person.eyebrow', locale)}</p>
      <h1 class="person__title"><em>{file.person.full_name}</em></h1>
      <div class="person__meta">
        {#if file.person.title}<span>{file.person.title}</span>{/if}
        {#if file.person.organization_name}
          <span class="person__org">{file.person.organization_name}</span>
        {/if}
        {#if placeLine}<span class="person__place">{placeLine}</span>{/if}
      </div>
    </header>

    <section class="person__section" aria-label={t('conversations.col_contact', locale)}>
      <div class="person__section-head">
        <p class="eyebrow">{t('conversations.col_contact', locale)}</p>
        <span class="person__verbs">
          <Button variant="outline" size="xs" onclick={openEdit}>{t('person.edit', locale)}</Button>
          {#if file.can_invite}
            <Button variant="outline" size="xs" onclick={openInvite}>
              {t('person.invite', locale, { name: file.person.full_name })}
            </Button>
          {/if}
        </span>
      </div>
      <ul class="person__contact" role="list">
        {#if file.person.email}
          <li><a href={`mailto:${file.person.email}`}>{file.person.email}</a></li>
        {/if}
        {#if file.person.phone}
          <li><a href={`tel:${file.person.phone}`}>{file.person.phone}</a></li>
        {/if}
        {#if file.person.website}
          <li>
            <a href={safeHref(file.person.website)} target="_blank" rel="noopener noreferrer">
              {file.person.website}
            </a>
          </li>
        {/if}
        {#if file.person.languages.length > 0}
          <li class="person__langs">{file.person.languages.join(' · ')}</li>
        {/if}
      </ul>
    </section>

    <section class="person__section" aria-label={t('lens.conversations', locale)}>
      <div class="person__section-head">
        <p class="eyebrow">{t('lens.conversations', locale)}</p>
        <Button variant="outline" size="xs" onclick={() => (addOpen = true)}>
          {t('person.add_to_project', locale)}
        </Button>
      </div>
      {#if file.conversations.length > 0}
        <ul class="person__rows" role="list">
          {#each file.conversations as e (e.id)}
            <li>
              <StateBadge label={relationLabel(e.relation, locale)} tone={relationTone(e.relation)} />
              <span class="person__row-main">
                <a class="person__row-link" href={`/h/${workspaceSlug}/conversation/${e.id}`}
                  >{e.project?.name ?? '—'}{#if e.organization} · {e.organization.name}{/if}</a
                >
                {#if e.next_action_note}
                  <span class="person__row-note">{e.next_action_note}</span>
                {/if}
              </span>
              {#if e.next_action_at}
                <span class="person__row-meta">{dayLabel(e.next_action_at)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="person__section" aria-label={t('person.notes', locale)}>
      <p class="eyebrow">{t('person.notes', locale)}</p>
      <!-- «Lo conozco» y «Mi nota»: las dos cosas tuyas sobre esta persona (ADR-138 § 5). -->
      <Acquaintance workspaceId={contextWorkspaceId} personId={file.person.id} {locale} />
      <div class="person__composer">
        <textarea
          rows="3"
          maxlength="4000"
          placeholder={t('person.note_ph', locale)}
          bind:value={noteBody}
        ></textarea>
        <div class="person__composer-row">
          <!-- No visibility control: a note is always private (ADR-093 §2).
               The line says so once, instead of a checkbox implying a choice
               that no longer exists. -->
          <span class="person__composer-hint">{t('person.only_you', locale)}</span>
          <Button size="s" onclick={addNote} loading={$noteMutation.isPending}>
            {t('person.add_note', locale)}
          </Button>
        </div>
      </div>
      {#if file.notes.length > 0}
        <ul class="person__notes" role="list">
          {#each file.notes as n (n.id)}
            <li>
              <span class="person__note-meta">
                {dayMonthYearTs(n.created_at)}
                {#if n.author_id === callerId}
                  <button
                    type="button"
                    class="person__note-delete"
                    disabled={$deleteNote.isPending}
                    onclick={() => $deleteNote.mutate(n.id)}
                  >
                    {t('person.note_delete', locale)}
                  </button>
                {/if}
              </span>
              <p class="person__note-body">{n.body}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if file.cast.length > 0 || file.crew.length > 0}
      <section class="person__section" aria-label={t('person.appearances', locale)}>
        <p class="eyebrow">{t('person.appearances', locale)}</p>
        <ul class="person__rows" role="list">
          {#each file.cast as c (c.id)}
            <li>
              <span class="person__row-kind">{t('person.cast', locale)} · {c.role}</span>
              <span class="person__row-main">{c.project?.name ?? '—'}</span>
            </li>
          {/each}
          {#each file.crew as c (c.id)}
            <li>
              <span class="person__row-kind">{t('person.crew', locale)} · {c.role}</span>
              <span class="person__row-main">
                {c.performance?.venue_name ?? c.performance?.city ?? '—'}
              </span>
              {#if c.performance}
                <span class="person__row-meta">{dayLabel(c.performance.performed_at)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</article>

<Dialog bind:open={addOpen} title={t('person.add_to_project', locale)} size="s">
  <div class="person__add-grid">
    <Select
      label={t('create.project', locale)}
      options={projectOptions}
      bind:value={aProject}
      placeholder={projectOptions.length === 0 ? t('person.in_every_project', locale) : undefined}
      required
    />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button
      onclick={submitAddConversation}
      loading={$addConversation.isPending}
      disabled={projectOptions.length === 0}
    >
      {t('composer.add', locale)}
    </Button>
  {/snippet}
</Dialog>

<Dialog bind:open={editOpen} title={t('person.edit_title', locale, { name: file?.person.full_name ?? '' })} size="s">
  <div class="person__add-grid">
    <Input label={t('person.field_name', locale)} bind:value={eName} required />
    <Input label={t('person.field_title', locale)} bind:value={eTitle} />
    <Input label={t('person.field_email', locale)} type="email" bind:value={eEmail} />
    <Input label={t('person.field_phone', locale)} type="tel" bind:value={ePhone} />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (editOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button
      onclick={() => $saveDetails.mutate()}
      loading={$saveDetails.isPending}
      disabled={!eName.trim()}
    >
      {t('edit.save', locale)}
    </Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={inviteOpen}
  title={t('person.invite', locale, { name: file?.person.full_name ?? '' })}
  size="s"
>
  <p class="person__hint">{t('person.invite_hint', locale)}</p>
  {#if inviteUrl}
    <div class="person__add-grid">
      <Input label={t('person.invite_link', locale)} value={inviteUrl} />
    </div>
    <p class="person__hint">{t('settings.access_link_expiry', locale)}</p>
  {:else}
    <div class="person__add-grid">
      <Input label={t('person.field_email', locale)} type="email" bind:value={iEmail} required />
      <Select label={t('person.invite_role', locale)} options={inviteRoles} bind:value={iRole} />
    </div>
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (inviteOpen = false)}>{t('create.cancel', locale)}</Button>
    {#if inviteUrl}
      <Button onclick={copyInvite}>{t('person.invite_copy', locale)}</Button>
    {:else}
      <Button
        onclick={() => $invite.mutate()}
        loading={$invite.isPending}
        disabled={!iEmail.trim()}
      >
        {t('person.invite_send', locale)}
      </Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  @layer components {
    .person {
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
    }

    .person__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    /* Masthead typography via base.css h1 defaults. */
    .person__title {
      color: var(--text-color);
    }
    .person__title em {
      font-style: italic;
    }

    .person__meta {
      display: flex;
      gap: var(--space-s);
      flex-wrap: wrap;
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .person__place {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      align-self: center;
    }

    .person__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .person__section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-m);
    }

    .person__verbs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }

    .person__hint {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
      line-height: 1.55;
    }

    .person__add-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }

    .person__contact li {
      padding-block: var(--space-2xs);
      font-size: var(--text-s);
    }

    .person__langs {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      letter-spacing: 0.04em;
    }

    .person__rows li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .person__row-kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      min-inline-size: 8rem;
    }

    .person__row-main {
      font-size: var(--text-s);
      color: var(--text-color);
      flex: 1;
    }

    .person__row-link {
      color: inherit;
      text-decoration: none;
    }

    .person__row-link:hover,
    .person__row-link:focus-visible {
      text-decoration: underline;
    }

    .person__row-note {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .person__row-meta {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .person__composer {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .person__composer-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-m);
    }

    .person__composer-hint {
      font-size: var(--font-size-s);
      color: var(--text-faint);
    }

    .person__notes li {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding-block: var(--space-s);
      border-block-end: 1px solid var(--border-color-light);
    }

    .person__note-meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .person__note-delete {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
    .person__note-delete:hover {
      color: var(--danger);
    }

    .person__note-body {
      font-size: var(--text-s);
      line-height: 1.55;
      white-space: pre-wrap;
    }

  }
</style>
