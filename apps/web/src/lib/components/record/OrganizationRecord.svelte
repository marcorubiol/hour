<script lang="ts">
  /**
   * Organization detail (ADR-159): the venue or whoever programs it, the one
   * a sales conversation is with (ADR-102). Its conversations across the
   * projects of the space, its bolos, its contacts and its fiscal data, in
   * the shape of every record (ADR-139 p2): head, «Falta», blocks, Detalles.
   *
   * One record, two frames (ADR-139 p1 A): the page and the vistazo draw
   * this component. One column on purpose: the vistazo is narrow.
   */

  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { tick } from 'svelte';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { CREATED_TOAST_MS, toastCreated } from '$lib/created';
  import { addToast } from '$lib/components/Toast.svelte';
  import RecordState from '$lib/components/RecordState.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import Fold from '$lib/components/Fold.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Select from '$lib/components/Select.svelte';
  import Input from '$lib/components/Input.svelte';
  import MissingBand, { type MissingItem } from '$lib/components/MissingBand.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import FiscalIdentity from '$lib/components/FiscalIdentity.svelte';
  import OrganizationMergeDialog, { type OrgMergeResult } from '$lib/components/OrganizationMergeDialog.svelte';
  import { undoOpen } from '$lib/organization-merge';
  import { goto } from '$app/navigation';
  import { openPeek } from '$lib/peek.svelte';
  import type { OrganizationFiscalResponse } from '$lib/fiscal';
  import { ORGANIZATION_KINDS, orgBolos, orgContacts, orgMissing, type OrganizationFile } from '$lib/organization-record';
  import { relativeContactDate } from '$lib/conversation';
  import { performanceStatusLabel } from '$lib/performance';
  import { dayMonthYear, dayMonthYearTs, localDayISO } from '$lib/datetime';
  import { spaceCrumb } from '$lib/record-crumbs';
  import { safeHref } from '$lib/utils/safe-url';
  import { usePins } from '$lib/stores/pins.svelte';
  import { buildLineIndex, buildProjectIndex, projectsInScope, resolveScope } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    workspaceSlug: string;
    slug: string;
    /** Drawn in the vistazo (ADR-139 p1): no document title. */
    inPeek?: boolean;
  }

  let { workspaceSlug, slug, inPeek = false }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const workspacesQuery = createQuery(workspacesQueryOptions());

  let workspace = $derived(($workspacesQuery.data?.items ?? []).find((w) => w.slug === workspaceSlug) ?? null);
  let workspaceId = $derived(workspace?.id ?? '');

  const query = createQuery(
    toStore(() => ({
      queryKey: ['organization', workspaceId, slug] as const,
      enabled: Boolean(slug && workspaceId),
      // A 404 is the answer: no retries.
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<OrganizationFile>(
          `/api/organizations/${encodeURIComponent(slug)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          signal,
        ),
    })),
  );

  let file = $derived($query.data ?? null);
  let loading = $derived($query.isPending);
  let org = $derived(file?.organization ?? null);

  // The fiscal block reads the same query (one request): «Falta» needs to
  // know whether there is any, and whether whoever looks may write it.
  const fiscalQuery = createQuery(
    toStore(() => ({
      queryKey: ['organization-fiscal', org?.id ?? ''] as const,
      enabled: Boolean(org?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<OrganizationFiscalResponse>(`/api/organizations/${org!.id}/fiscal`, signal),
    })),
  );
  let fiscalVisible = $derived(Boolean($fiscalQuery.data && ($fiscalQuery.data.can_edit || $fiscalQuery.data.fiscal)));

  let crumbs = $derived([spaceCrumb(workspace?.name, workspaceSlug), { label: t('organization.eyebrow', locale) }]);

  let today = localDayISO();
  let contacts = $derived(file ? orgContacts(file.contacts, file.staff, today) : []);
  let bolos = $derived(file ? orgBolos(file.bolos, today) : []);
  let projectOf = $derived(new Map((file?.conversations ?? []).map((c) => [c.id, c.project])));
  let projectById = $derived(
    new Map((file?.conversations ?? []).flatMap((c) => (c.project ? [[c.project.id, c.project] as const] : []))),
  );

  let placeLine = $derived(org ? [org.city, org.country].filter(Boolean).join(', ') : '');
  let kindWord = $derived(org?.kind && org.kind !== 'other' ? t(`organization.kind_${org.kind}`, locale) : '');

  // ── «Falta» (ADR-139 p2) ────────────────────────────────────────────
  let fiscalEl = $state<HTMLElement | undefined>();
  let fiscalStart = $state(false);

  async function addFiscal() {
    fiscalStart = true;
    await tick();
    fiscalEl?.scrollIntoView({ block: 'center' });
  }

  let missingItems = $derived.by<MissingItem[]>(() => {
    if (!file) return [];
    const f = $fiscalQuery.data;
    return orgMissing({
      conversations: file.conversations,
      bolos: file.bolos,
      fiscal: f ? { has: Boolean(f.fiscal), canEdit: f.can_edit } : null,
      today,
    }).map((m) => {
      if (m.kind === 'fiscal') {
        return {
          id: 'fiscal',
          text: t('organization.missing_fiscal', locale),
          verbs: [{ label: t('fiscal.add', locale), onclick: () => void addFiscal() }],
        };
      }
      const project = projectOf.get(m.conversationId)?.name ?? '';
      return {
        id: `step_${m.conversationId}`,
        text: project
          ? t('organization.missing_step_due_in', locale, { project })
          : t('record.missing_step_due', locale),
        meta: relativeContactDate(m.day, locale),
        verbs: [{ label: t('record.verb_open', locale), href: `/h/${workspaceSlug}/conversation/${m.conversationId}` }],
      };
    });
  });

  // ── Add to a project: a new conversation with this organization ──────
  // The projects of the current scope (as the person's file), in this space,
  // without one already (ADR-102 § 3: one per organization and project).
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
  let projectError = $state<string | undefined>();
  $effect(() => {
    void aProject;
    projectError = undefined;
  });

  let projectOptions = $derived.by(() => {
    const taken = new Set((file?.conversations ?? []).map((c) => c.project?.id));
    return projectsInScope(scope, $projectsQuery.data?.items ?? [])
      .filter((p) => p.workspace_id === workspaceId && !taken.has(p.id))
      .map((p) => ({ value: p.id, label: p.name ?? p.slug }));
  });

  async function refreshOrg() {
    await queryClient.invalidateQueries({ queryKey: ['organization', workspaceId, slug] });
    await refreshAfterWrite(queryClient, ['conversations']);
  }

  const addConversation = createMutation({
    mutationFn: () =>
      mutateJSON<{ conversation: unknown }>('POST', '/api/conversations', {
        project_id: aProject,
        organization_id: org!.id,
      }),
    onSuccess: (body) => {
      addOpen = false;
      aProject = '';
      void refreshOrg();
      const id = (body?.conversation as { id?: string } | undefined)?.id;
      toastCreated({
        locale,
        message: t('person.added_to_project', locale),
        undo: id
          ? async () => {
              await mutateJSON('DELETE', `/api/conversations/${id}`);
              await refreshOrg();
            }
          : undefined,
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('person.not_added', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function submitAdd() {
    if (!aProject) {
      projectError = t('create.pick_project', locale);
      document.getElementById('org-add-project')?.focus();
      return;
    }
    $addConversation.mutate();
  }

  // ── Edit what the head shows: name, kind, city, email (§ 64) ─────────
  // The shape of the person's file: every field travels, empty clears it.
  let editOpen = $state(false);
  let eName = $state('');
  let eKind = $state('other');
  let eCity = $state('');
  let eEmail = $state('');

  let kindOptions = $derived(ORGANIZATION_KINDS.map((k) => ({ value: k, label: t(`organization.kind_${k}`, locale) })));

  function openEdit() {
    if (!org) return;
    eName = org.name;
    eKind = org.kind ?? 'other';
    eCity = org.city ?? '';
    eEmail = org.email ?? '';
    editOpen = true;
  }

  const saveDetails = createMutation({
    mutationFn: () =>
      mutateJSON('PATCH', `/api/organizations/${org!.id}`, {
        name: eName,
        kind: eKind,
        city: eCity.trim() || null,
        email: eEmail.trim() || null,
      }),
    onSuccess: () => {
      editOpen = false;
      void refreshOrg();
      addToast({ tone: 'success', message: t('organization.saved', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('organization.not_saved', locale),
        message:
          err instanceof ApiError && err.status === 409
            ? t('organization.name_taken', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      });
    },
  });

  // ── Merge with another organization (84, ADR-171) ────────────────────
  let mergeOpen = $state(false);

  /** Everything that names organizations, after a merge or its undo. */
  async function refreshOrgs() {
    await Promise.all(
      [['organization'], ['organizations'], ['conversations'], ['organization-merges'], ['person']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  }

  /** Where an organization opens: the page, or the vistazo it was in. */
  function showOrg(orgSlug: string) {
    if (orgSlug === slug) return;
    if (inPeek) openPeek({ kind: 'organization', ws: workspaceSlug, slug: orgSlug });
    else void goto(`/h/${workspaceSlug}/organization/${encodeURIComponent(orgSlug)}`, { replaceState: true });
  }

  async function undoMerge(mergeId: string, name: string) {
    try {
      const body = await mutateJSON<{ undo: { skipped?: number; drop_slug: string | null } }>(
        'DELETE',
        `/api/organization-merges/${mergeId}`,
      );
      await refreshOrgs();
      const skipped = body?.undo.skipped ?? 0;
      addToast({
        tone: 'info',
        message: t('person.merge_undone', locale, { name }),
        ...(skipped > 0 ? { title: t('person.merge_undone_skipped', locale, { n: skipped }) } : {}),
      });
    } catch (err) {
      const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
      addToast({
        tone: 'danger',
        title: t('person.merge_undo_failed', locale),
        message:
          code === 'undo_expired'
            ? t('person.merge_err_expired', locale)
            : code === 'already_undone'
              ? t('person.merge_err_undone', locale)
              : code === 'later_merge'
                ? t('organization.merge_err_later', locale)
                : code === 'name_taken'
                  ? t('organization.merge_err_name_taken', locale)
                  : err instanceof ApiError && err.status === 404
                    ? t('organization.merge_err_not_found', locale)
                    : err instanceof Error
                      ? err.message
                      : t('perf.unexpected', locale),
      });
    }
  }

  async function onMerged(m: OrgMergeResult) {
    await refreshOrgs();
    if (m.keep_slug) showOrg(m.keep_slug);
    addToast({
      tone: 'success',
      message: t('organization.merge_done', locale),
      duration: CREATED_TOAST_MS,
      action: { label: t('ui.undo', locale), run: () => void undoMerge(m.merge_id, m.drop_name) },
    });
  }

  // The slug of an organization merged into this one opens this one
  // (`previous_slugs`): the address says where you are.
  $effect(() => {
    const now = org?.slug;
    if (now && now !== slug && !inPeek) showOrg(now);
  });

  let detailsKeeps = $derived(org ? [org.address, org.phone].filter(Boolean).join(' · ') : '');
</script>

<svelte:head>
  {#if !inPeek}<title>{docTitle(org?.name ?? slug)}</title>{/if}
</svelte:head>

<article class="record organization" aria-busy={loading} data-testid="organization-record">
  {#if loading || ($query.isError && !file)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('organization.not_found', locale)}
      failedText={t('organization.load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else if file && org}
    <RecordHead {crumbs} title={org.name}>
      {#snippet actions()}
        <Button variant="secondary" size="xs" onclick={openEdit}>{t('person.edit', locale)}</Button>
        {#if file!.can_merge}
          <Button variant="quiet" size="xs" onclick={() => (mergeOpen = true)}>{t('organization.merge', locale)}</Button>
        {/if}
      {/snippet}
      {#snippet facts()}
        {#if kindWord}<span>{kindWord}</span>{/if}
        {#if placeLine}<span>{placeLine}</span>{/if}
        {#if org!.email}<a href={`mailto:${org!.email}`}>{org!.email}</a>{/if}
        {#if org!.website}<a href={safeHref(org!.website)} target="_blank" rel="noopener noreferrer">{org!.website}</a>{/if}
      {/snippet}
      {#snippet band()}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    {#each file.merges ?? [] as m (m.id)}
      <p class="merged-line" data-testid="organization-merged">
        {t('person.merge_line', locale, { name: m.drop_name ?? '?', date: dayMonthYearTs(m.merged_at) })}
        {#if undoOpen(m.merged_at)}
          <button type="button" class="merged-line__undo" onclick={() => undoMerge(m.id, m.drop_name ?? '')}
            >{t('person.merge_line_undo', locale)}</button
          >
        {/if}
      </p>
    {/each}

    <section class="organization__section" aria-label={t('lens.conversations', locale)}>
      {#if file.conversations.length > 0}
        <BlockHead title={t('lens.conversations', locale)} count={file.conversations.length}>
          <button type="button" class="block-head__act" onclick={() => (addOpen = true)}>{t('person.add_to_project', locale)}</button>
        </BlockHead>
        <ConversationTable
          filters={{ organizationId: org.id, workspaceIds: [workspaceId] }}
          titleBy="project"
          counted
          personBase={`/h/${workspaceSlug}/person`}
          conversationHref={(item) => `/h/${workspaceSlug}/conversation/${item.id}`}
        />
      {:else}
        <EmptyLine label={t('lens.conversations', locale)} text={t('organization.no_conversations', locale)}>
          <button type="button" class="empty-line__act" onclick={() => (addOpen = true)}>{t('person.add_to_project', locale)}</button>
        </EmptyLine>
      {/if}
    </section>

    {#if bolos.length > 0}
      <section class="organization__section" aria-label={t('conversations.bolos', locale)} data-testid="organization-bolos">
        <BlockHead title={t('conversations.bolos', locale)} count={bolos.length} />
        <ul class="organization__rows" role="list">
          {#each bolos as b (b.bolo_id)}
            {@const when = b.first_performed_at ? dayMonthYearTs(b.first_performed_at) : t('conversations.bolo_undated', locale)}
            {@const project = projectById.get(b.project_id)?.name ?? ''}
            <li>
              <span class="organization__row-day">{when}</span>
              <span class="organization__row-main">
                {#if b.performance_slug}
                  <a class="organization__row-link" href={`/h/${workspaceSlug}/performance/${b.performance_slug}`}>{project || when}</a>
                {:else}
                  {project || when}
                {/if}
                {#if b.function_count > 1}<span class="organization__faint">{' · '}{t('perf.bolo_functions_other', locale, { n: b.function_count })}</span>{/if}
              </span>
              <span class="organization__row-meta">{performanceStatusLabel(b.status, locale)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="organization__section" aria-label={t('organization.contacts', locale)}>
      {#if contacts.length > 0}
        <BlockHead title={t('organization.contacts', locale)} count={contacts.length} />
        <ul class="organization__rows" role="list" data-testid="organization-contacts">
          {#each contacts as c (c.personId)}
            <li class:organization__gone={c.until !== null}>
              <a class="organization__row-name" href={`/h/${workspaceSlug}/person/${encodeURIComponent(c.slug)}`}>{c.name}</a>
              <span class="organization__row-main">
                {c.role ?? ''}{#if c.until}{c.role ? ' · ' : ''}{t('organization.contact_until', locale, { date: dayMonthYear(c.until) })}{/if}
              </span>
              {#if c.reach && c.until === null}
                <a class="organization__row-meta" href={c.reachHref}>{c.reach}</a>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyLine label={t('organization.contacts', locale)} text={t('organization.no_contacts', locale)} />
      {/if}
    </section>

    <div class="organization__section" bind:this={fiscalEl} id="fiscal">
      {#key fiscalStart}
        <FiscalIdentity
          endpoint={`/api/organizations/${org.id}/fiscal`}
          queryKey={['organization-fiscal', org.id]}
          level={2}
          startEditing={fiscalStart}
        />
      {/key}
    </div>

    {#if detailsKeeps}
      <Fold word={t('record.details', locale)} keeps={detailsKeeps} id="details" testid="record-details">
        <ul class="organization__details" role="list">
          {#if org.address}<li>{org.address}</li>{/if}
          {#if org.phone}<li><a href={`tel:${org.phone}`}>{org.phone}</a></li>{/if}
        </ul>
      </Fold>
    {/if}
  {/if}
</article>

{#if file?.can_merge && org}
  <OrganizationMergeDialog
    bind:open={mergeOpen}
    {workspaceId}
    {workspaceSlug}
    organization={{ id: org.id, name: org.name }}
    {locale}
    onmerged={onMerged}
  />
{/if}

<Dialog bind:open={addOpen} title={t('person.add_to_project', locale)} size="s">
  <div class="organization__add-grid">
    <Select
      id="org-add-project"
      label={t('create.project', locale)}
      options={projectOptions}
      bind:value={aProject}
      error={projectError}
      placeholder={projectOptions.length === 0 ? t('person.in_every_project', locale) : undefined}
      required
    />
  </div>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (addOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submitAdd} loading={$addConversation.isPending} disabled={projectOptions.length === 0}>
      {t('composer.add', locale)}
    </Button>
  {/snippet}
</Dialog>

<Dialog bind:open={editOpen} title={t('organization.edit_title', locale, { name: org?.name ?? '' })} size="s">
  <div class="organization__add-grid">
    <Input label={t('organization.field_name', locale)} bind:value={eName} required />
    <Select id="org-edit-kind" label={t('organization.field_kind', locale)} options={kindOptions} bind:value={eKind} />
    <Input label={t('organization.field_city', locale)} bind:value={eCity} />
    <Input label={t('organization.field_email', locale)} type="email" bind:value={eEmail} />
  </div>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (editOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => $saveDetails.mutate()} loading={$saveDetails.isPending} disabled={!eName.trim()}>
      {t('edit.save', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .organization__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .organization__add-grid {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      margin-block-start: var(--space-s);
    }

    .organization__rows li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .organization__row-day {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-muted);
      min-inline-size: var(--record-label-inline);
    }

    .organization__row-name {
      min-inline-size: var(--record-label-inline);
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
    }

    .organization__row-main {
      flex: 1;
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .organization__row-link {
      color: inherit;
      text-decoration: none;
    }

    .organization__row-link:hover,
    .organization__row-link:focus-visible,
    .organization__row-name:hover,
    .organization__row-name:focus-visible {
      text-decoration: underline;
    }

    .organization__row-meta {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .organization__faint {
      color: var(--text-faint);
    }

    /* Who left: still a link to their file, in the quiet ink. */
    .organization__gone,
    .organization__gone .organization__row-name,
    .organization__gone .organization__row-main {
      color: var(--text-muted);
    }

    .organization__details li {
      padding-block: var(--space-2xs);
      font-size: var(--text-s);
    }

    /* Narrow (the phone, the vistazo): a row is a card of lines, as the conversation row. */
    @container record (max-width: 47.999rem) {
      .organization__rows li {
        flex-wrap: wrap;
        gap: 0 var(--space-s);
      }

      .organization__row-main {
        flex-basis: 100%;
        order: 2;
      }

      .organization__row-meta {
        order: 3;
      }
    }
  }
</style>
