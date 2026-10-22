<script lang="ts">
  /**
   * New-project dialog — the creation flow ported out of the retired Plaza
   * sidebar. Workspace select (over the shared ['workspaces'] cache;
   * preselected + disabled when the caller passes workspaceId) + name +
   * accent swatch + description. POST /api/projects, refetch the active
   * projects cache before navigating to the new project page.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { spaceWriteWorkspaces } from '$lib/workspace-role';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, t } from '$lib/i18n';
  import AccentSwatchPicker from './AccentSwatchPicker.svelte';

  interface Props {
    open?: boolean;
    /** Preselects + locks the workspace when the caller already knows it. */
    workspaceId?: string | null;
  }

  let { open = $bindable(false), workspaceId = null }: Props = $props();

  type CreatedProject = { id: string; slug: string; name: string; workspace_id: string };

  const queryClient = useQueryClient();
  const locale = appLocale();
  const workspacesQ = createQuery(workspacesQueryOptions());

  let wsSelected = $state('');
  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let description = $state('');

  // Only the spaces that take a project from the person: never one they are
  // a guest of (`$lib/workspace-role`), where `create_project` says no.
  let workspaces = $derived(spaceWriteWorkspaces($workspacesQ.data?.items ?? []));
  // <option> text: a stylesheet cannot be trusted here, so the writer runs
  // where the labels are built.
  let workspaceOptions = $derived(workspaces.map((w) => ({ value: w.id, label: spaceName(w.name) })));
  let effectiveWorkspaceId = $derived(workspaceId ?? wsSelected);
  let targetWorkspaceName = $derived(
    spaceName(workspaces.find((w) => w.id === effectiveWorkspaceId)?.name ?? ''),
  );

  // Live preview of the color Auto would pick for the typed name.
  let autoAccentSlug = $derived(name.trim() || 'project');

  function reset() {
    wsSelected = '';
    name = '';
    accent = null;
    description = '';
  }

  function close() {
    open = false;
    reset();
  }

  const create = createMutation({
    mutationFn: async (input: {
      workspace_id: string;
      name: string;
      accent: string | null;
      description: string;
    }) => {
      const body: Record<string, string> = {
        workspace_id: input.workspace_id,
        name: input.name,
      };
      if (input.accent) body.accent = input.accent;
      if (input.description.trim()) body.description = input.description.trim();
      const res = await mutateJSON<{ project: CreatedProject }>('POST', '/api/projects', body);
      if (!res?.project) throw new Error('Empty response');
      return res.project;
    },
    onSuccess: async (project) => {
      // Refetch must land before goto — the project page reads this cache.
      await queryClient.invalidateQueries({ queryKey: ['projects', { status: 'active' }] });
      await queryClient.refetchQueries({ queryKey: ['projects', { status: 'active' }] });
      const wsSlug = workspaces.find((w) => w.id === project.workspace_id)?.slug;
      close();
      if (wsSlug) await goto(`/h/${wsSlug}/project/${project.slug}/`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('project.not_created', locale),
        message:
          err instanceof ApiError && err.status === 409
            ? t('project.name_taken', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      });
    },
  });

  /** The name's own word, under the field (ADR-139 p7); the native
      `required` covers the empty ones, this the blank ones. */
  let nameError = $state<string | undefined>();
  $effect(() => {
    void name;
    nameError = undefined;
  });
  let formEl: HTMLFormElement | undefined = $state();

  /** Runs from the form's submit, after the native constraints passed. */
  function submit(event?: Event) {
    event?.preventDefault();
    if (!effectiveWorkspaceId) {
      return; // the select's `required` says it under the field
    }
    const trimmed = name.trim();
    if (!trimmed) {
      nameError = t('project.name_empty', locale);
      return;
    }
    $create.mutate({
      workspace_id: effectiveWorkspaceId,
      name: trimmed,
      accent,
      description,
    });
  }
</script>

<Dialog
  bind:open
  title={t('project.new_title', locale)}
  description={targetWorkspaceName
    ? t('project.new_desc', locale, { space: targetWorkspaceName })
    : t('project.new_desc_none', locale)}
  size="s"
  onclose={reset}
>
  <form class="cpj__form" bind:this={formEl} onsubmit={submit}>
    {#if workspaceId}
      <Select label={t('workspace.label', locale)} value={workspaceId} options={workspaceOptions} disabled />
    {:else}
      <Select
        label={t('workspace.label', locale)}
        bind:value={wsSelected}
        options={workspaceOptions}
        placeholder={t('workspace.pick_ph', locale)}
        required
        disabled={$create.isPending}
      />
    {/if}

    <Input
      label={t('conversations.col_name', locale)}
      name="project-name"
      bind:value={name}
      error={nameError}
      placeholder={t('project.name_ph', locale)}
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label={t('project.color', locale)} disabled={$create.isPending} />

    <Textarea
      label={t('project.description', locale)}
      bind:value={description}
      maxlength={280}
      counter
      rows={3}
      placeholder={t('project.description_ph', locale)}
      disabled={$create.isPending}
    />

    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="quiet" disabled={$create.isPending} onclick={close}>{t('create.cancel', locale)}</Button>
    <Button loading={$create.isPending} onclick={() => formEl?.requestSubmit()}>{t('project.create', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cpj__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }
  }
</style>
