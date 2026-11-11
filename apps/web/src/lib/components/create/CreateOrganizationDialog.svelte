<script lang="ts">
  /**
   * «Nueva organización» from ⌘K (136): an organization on its own, without
   * a conversation (ADR-102 keeps the conversation with the organization; it
   * can now exist before one). Name, type (ADR-177), city and email, the
   * first facts of its file. POST /api/organizations
   * (`create_workspace_organization`), then its file. A name the space
   * already has opens that one instead of making a second.
   *
   * Mounted once by the /h shell, opened through the creation store.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { ORGANIZATION_KINDS } from '$lib/organization-record';
  import { spaceWriteWorkspaces } from '$lib/workspace-role';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, t } from '$lib/i18n';
  import { organizationCreateBody, type CreatedOrganization } from '$lib/directory-create';

  interface Props {
    open?: boolean;
    /** Typed in ⌘K: the organization's name. */
    name?: string;
  }
  let { open = $bindable(false), name: preset = '' }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const workspacesQ = createQuery(workspacesQueryOptions());

  let workspaces = $derived(spaceWriteWorkspaces($workspacesQ.data?.items ?? []));
  let workspaceOptions = $derived(workspaces.map((w) => ({ value: w.id, label: spaceName(w.name) })));
  let defaultWorkspace = $derived(
    workspaces.find((w) => w.slug === page.params.workspace)?.id ?? workspaces[0]?.id ?? '',
  );
  let kindOptions = $derived(
    ORGANIZATION_KINDS.map((k) => ({ value: k, label: t(`organization.kind_${k}`, locale) })),
  );

  let wsChosen = $state('');
  let name = $state('');
  let kind = $state('');
  let city = $state('');
  let email = $state('');
  let nameError = $state<string | undefined>();

  let workspaceId = $derived(wsChosen || defaultWorkspace);

  $effect(() => {
    if (open) {
      name = preset;
      wsChosen = '';
      kind = city = email = '';
      nameError = undefined;
    }
  });

  async function openFile(org: CreatedOrganization) {
    await Promise.all(
      ['organizations', 'search'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    );
    const ws = workspaces.find((w) => w.id === org.workspace_id)?.slug;
    open = false;
    if (ws) await goto(`/h/${ws}/organization/${org.slug}`);
  }

  const create = createMutation({
    mutationFn: async (ws: string) => {
      const res = await mutateJSON<{ organization?: CreatedOrganization }>(
        'POST',
        '/api/organizations',
        organizationCreateBody({ workspaceId: ws, name, kind, city, email }),
      );
      if (!res?.organization) throw new Error('create_failed');
      return res.organization;
    },
    onSuccess: openFile,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const existing = (err.body as { organization?: CreatedOrganization | null } | null)?.organization;
        if (existing) {
          // The space already has it: its file, not a second one.
          addToast({ tone: 'info', message: t('directory.organization_exists', locale, { name: existing.name }) });
          void openFile(existing);
          return;
        }
        nameError = t('organization.name_taken', locale);
        return;
      }
      addToast({
        tone: 'danger',
        title: t('directory.organization_not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  let formEl: HTMLFormElement | undefined = $state();

  function submit(event?: Event) {
    event?.preventDefault();
    if (!workspaceId) return;
    if (!name.trim()) {
      nameError = t('form.required', locale);
      return;
    }
    $create.mutate(workspaceId);
  }
</script>

<Dialog
  bind:open
  title={t('palette.new_organization', locale)}
  description={t('directory.organization_desc', locale)}
  size="s"
>
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
      label={t('organization.field_name', locale)}
      bind:value={name}
      error={nameError}
      oninput={() => (nameError = undefined)}
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />
    <Select
      label={t('organization.field_kind', locale)}
      bind:value={kind}
      options={kindOptions}
      placeholder={t('directory.organization_kind_ph', locale)}
      disabled={$create.isPending}
    />
    <Input label={t('organization.field_city', locale)} bind:value={city} autocomplete="off" disabled={$create.isPending} />
    <Input label={t('organization.field_email', locale)} type="email" bind:value={email} autocomplete="off" disabled={$create.isPending} />
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
