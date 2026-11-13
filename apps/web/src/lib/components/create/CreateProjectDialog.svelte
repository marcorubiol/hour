<script lang="ts">
  /**
   * New-project dialog — the creation flow ported out of the retired Plaza
   * sidebar. Workspace select (over the shared ['workspaces'] cache;
   * preselected + disabled when the caller passes workspaceId) + name +
   * accent swatch + description. POST /api/projects, refetch the active
   * projects cache before navigating to the new project page. Opened from
   * Hoy's start list (`stay`, tarea 137) it does not navigate: the list
   * crosses the step out and the notice offers «Abrir».
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
  import { toastCreated } from '$lib/created';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { spaceWriteWorkspaces } from '$lib/workspace-role';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, t, voiceFor } from '$lib/i18n';
  import AccentSwatchPicker from './AccentSwatchPicker.svelte';

  interface Props {
    open?: boolean;
    /** Preselects + locks the workspace when the caller already knows it. */
    workspaceId?: string | null;
    /** Stay where it was opened; the notice's «Abrir» goes to the new project. */
    stay?: boolean;
  }

  let { open = $bindable(false), workspaceId = null, stay = false }: Props = $props();

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
  /** The trade of the space this writes to (tarea 142); the screen's voice until one is chosen. */
  let voice = $derived(voiceFor(effectiveWorkspaceId));
  const tr = (key: string, params?: Record<string, string | number>) => t(key, locale, params, voice);
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
      const href = wsSlug ? `/h/${wsSlug}/project/${project.slug}/` : null;
      // Said before close() lets go of the chosen space, in its trade.
      const message = tr('project.created');
      close();
      if (stay) {
        toastCreated({
          locale,
          message,
          open: href ? () => void goto(href) : undefined,
        });
        return;
      }
      if (href) await goto(href);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: tr('project.not_created'),
        message:
          err instanceof ApiError && err.status === 409
            ? tr('project.name_taken')
            : err instanceof Error
              ? err.message
              : tr('perf.unexpected'),
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
      nameError = tr('project.name_empty');
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
  title={tr('project.new_title')}
  description={targetWorkspaceName
    ? tr('project.new_desc', { space: targetWorkspaceName })
    : tr('project.new_desc_none')}
  size="s"
  onclose={reset}
>
  <form class="cpj__form" bind:this={formEl} onsubmit={submit}>
    {#if workspaceId}
      <Select label={tr('workspace.label')} value={workspaceId} options={workspaceOptions} disabled />
    {:else}
      <Select
        label={tr('workspace.label')}
        bind:value={wsSelected}
        options={workspaceOptions}
        placeholder={tr('workspace.pick_ph')}
        required
        disabled={$create.isPending}
      />
    {/if}

    <Input
      label={tr('conversations.col_name')}
      name="project-name"
      bind:value={name}
      error={nameError}
      placeholder={tr('project.name_ph')}
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label={tr('project.color')} disabled={$create.isPending} />

    <Textarea
      label={tr('project.description')}
      bind:value={description}
      maxlength={280}
      counter
      rows={3}
      placeholder={tr('project.description_ph')}
      disabled={$create.isPending}
    />

    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="quiet" disabled={$create.isPending} onclick={close}>{tr('create.cancel')}</Button>
    <Button loading={$create.isPending} onclick={() => formEl?.requestSubmit()}>{tr('project.create')}</Button>
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
