<script lang="ts">
  /**
   * «Nueva persona» from ⌘K (136): somebody on their own, without a
   * conversation. Name, and what the file shows first (title, email, phone)
   * plus their organization, which completes from the space's; a name nobody
   * has yet is made with them. POST /api/persons (`create_workspace_person`,
   * ADR-107: the same email in the space is the same person), then their file.
   *
   * Mounted once by the /h shell, opened through the creation store.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { organizationNames, organizationsQueryOptions } from '$lib/organizations';
  import { spaceWriteWorkspaces } from '$lib/workspace-role';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, t } from '$lib/i18n';
  import type { CreatedPerson } from '$lib/persons';
  import {
    matchOrganization,
    organizationCreateBody,
    organizationCreateQueryOptions,
    personCreateBody,
    type CreatedOrganization,
  } from '$lib/directory-create';

  interface Props {
    open?: boolean;
    /** Typed in ⌘K: the person's name. */
    name?: string;
  }
  let { open = $bindable(false), name: preset = '' }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const workspacesQ = createQuery(workspacesQueryOptions());
  const orgCreateQ = createQuery(toStore(() => organizationCreateQueryOptions(open)));
  // The organization field only once the database can make and link one (136).
  let withOrganization = $derived($orgCreateQ.data?.available === true);
  const organizationsQ = createQuery(toStore(() => organizationsQueryOptions(open && withOrganization)));

  let workspaces = $derived(spaceWriteWorkspaces($workspacesQ.data?.items ?? []));
  let workspaceOptions = $derived(workspaces.map((w) => ({ value: w.id, label: spaceName(w.name) })));
  // The space in the URL when it takes a person, else the first that does.
  let defaultWorkspace = $derived(
    workspaces.find((w) => w.slug === page.params.workspace)?.id ?? workspaces[0]?.id ?? '',
  );

  let wsChosen = $state('');
  let fullName = $state('');
  let title = $state('');
  let email = $state('');
  let phone = $state('');
  let organization = $state('');
  let nameError = $state<string | undefined>();

  let workspaceId = $derived(wsChosen || defaultWorkspace);
  let orgItems = $derived($organizationsQ.data?.items ?? []);
  let orgSuggestions = $derived(organizationNames(orgItems, workspaceId ? [workspaceId] : []));

  // Each opening starts from what ⌘K brings.
  $effect(() => {
    if (open) {
      fullName = preset;
      wsChosen = '';
      title = email = phone = organization = '';
      nameError = undefined;
    }
  });

  async function organizationIdFor(ws: string): Promise<string | null> {
    const typed = organization.trim();
    if (!typed || !withOrganization) return null;
    const known = matchOrganization(orgItems, ws, typed);
    if (known) return known.id;
    try {
      const res = await mutateJSON<{ organization: CreatedOrganization }>(
        'POST',
        '/api/organizations',
        organizationCreateBody({ workspaceId: ws, name: typed, kind: '', city: '', email: '' }),
      );
      return res?.organization?.id ?? null;
    } catch (err) {
      // Somebody made it meanwhile: use theirs.
      if (err instanceof ApiError && err.status === 409) {
        const existing = (err.body as { organization?: CreatedOrganization | null } | null)?.organization;
        if (existing) return existing.id;
      }
      throw err;
    }
  }

  const create = createMutation({
    mutationFn: async (ws: string) => {
      const organizationId = await organizationIdFor(ws);
      const res = await mutateJSON<{ person?: CreatedPerson; organized?: boolean }>(
        'POST',
        '/api/persons',
        personCreateBody({ workspaceId: ws, fullName, title, email, phone, organizationId }),
      );
      if (!res?.person) throw new Error('create_failed');
      return { person: res.person, organized: res.organized !== false };
    },
    onSuccess: async ({ person, organized }) => {
      await Promise.all(
        ['project-cast', 'planner-team', 'organizations', 'search'].map((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      );
      if (!organized) addToast({ tone: 'warning', message: t('directory.person_unorganized', locale) });
      const ws = workspaces.find((w) => w.id === person.workspace_id)?.slug;
      open = false;
      if (ws) await goto(`/h/${ws}/person/${person.slug}`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('directory.person_not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  let formEl: HTMLFormElement | undefined = $state();

  function submit(event?: Event) {
    event?.preventDefault();
    if (!workspaceId) return;
    if (!fullName.trim()) {
      nameError = t('form.required', locale);
      return;
    }
    $create.mutate(workspaceId);
  }
</script>

<Dialog bind:open title={t('palette.new_person', locale)} description={t('directory.person_desc', locale)} size="s">
  <form class="cdir__form" bind:this={formEl} onsubmit={submit} novalidate>
    {#if workspaces.length > 1}
      <Select
        label={t('workspace.label', locale)}
        value={workspaceId}
        options={workspaceOptions}
        onchange={(e) => (wsChosen = (e.currentTarget as HTMLSelectElement).value)}
        disabled={$create.isPending}
      />
    {/if}
    <Input
      label={t('person.field_name', locale)}
      bind:value={fullName}
      error={nameError}
      oninput={() => (nameError = undefined)}
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />
    <Input label={t('person.field_title', locale)} bind:value={title} autocomplete="off" disabled={$create.isPending} />
    <Input label={t('person.field_email', locale)} type="email" bind:value={email} autocomplete="off" disabled={$create.isPending} />
    <Input label={t('person.field_phone', locale)} type="tel" bind:value={phone} autocomplete="off" disabled={$create.isPending} />
    {#if withOrganization}
      <Input
        label={t('directory.person_organization', locale)}
        bind:value={organization}
        list="cdir-org-list"
        helper={organization.trim() && !matchOrganization(orgItems, workspaceId, organization)
          ? t('directory.organization_will_be_made', locale)
          : undefined}
        autocomplete="off"
        disabled={$create.isPending}
      />
      <datalist id="cdir-org-list">
        {#each orgSuggestions as option (option)}<option value={option}></option>{/each}
      </datalist>
    {/if}
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="quiet" disabled={$create.isPending} onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button loading={$create.isPending} onclick={() => formEl?.requestSubmit()}>{t('directory.create', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cdir__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }
  }
</style>
