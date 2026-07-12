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
  import { addToast } from '$lib/components/Toast.svelte';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import AccentSwatchPicker from './AccentSwatchPicker.svelte';

  interface Props {
    open?: boolean;
    /** Preselects + locks the workspace when the caller already knows it. */
    workspaceId?: string | null;
  }

  let { open = $bindable(false), workspaceId = null }: Props = $props();

  type CreatedProject = { id: string; slug: string; name: string; workspace_id: string };

  const queryClient = useQueryClient();
  const workspacesQ = createQuery(workspacesQueryOptions());

  let wsSelected = $state('');
  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let description = $state('');

  let workspaces = $derived($workspacesQ.data?.items ?? []);
  let workspaceOptions = $derived(workspaces.map((w) => ({ value: w.id, label: w.name })));
  let effectiveWorkspaceId = $derived(workspaceId ?? wsSelected);
  let targetWorkspaceName = $derived(
    workspaces.find((w) => w.id === effectiveWorkspaceId)?.name ?? '',
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
        title: 'Project not created',
        message:
          err instanceof ApiError && err.status === 409
            ? 'A project with that name already exists in this workspace.'
            : err instanceof Error
              ? err.message
              : 'Unexpected error',
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    if (!effectiveWorkspaceId) {
      addToast({ tone: 'warning', message: 'Pick a workspace.' });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ tone: 'warning', message: 'Name cannot be empty.' });
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
  title="New project"
  description={targetWorkspaceName
    ? `Adds a project under ${targetWorkspaceName}.`
    : 'Adds a project under the selected workspace.'}
  size="s"
  onclose={reset}
>
  <form class="cpj__form" onsubmit={submit}>
    {#if workspaceId}
      <Select label="Workspace" value={workspaceId} options={workspaceOptions} disabled />
    {:else}
      <Select
        label="Workspace"
        bind:value={wsSelected}
        options={workspaceOptions}
        placeholder="Pick a workspace"
        required
        disabled={$create.isPending}
      />
    {/if}

    <Input
      label="Name"
      name="project-name"
      bind:value={name}
      placeholder="e.g. Nightshade"
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label="Project color" disabled={$create.isPending} />

    <label class="field">
      <span>Description</span>
      <textarea
        class="cpj__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder="Optional. What is this project?"
        disabled={$create.isPending}
      ></textarea>
      <span class="cpj__desc-count">{description.length} / 280</span>
    </label>

    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="outline" disabled={$create.isPending} onclick={close}>Cancel</Button>
    <Button loading={$create.isPending} onclick={submit}>Create</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cpj__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .cpj__desc {
      resize: vertical;
      min-block-size: 5em;
    }

    .cpj__desc-count {
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-align: end;
    }
  }
</style>
