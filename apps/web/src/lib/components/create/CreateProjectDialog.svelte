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

  let workspaces = $derived($workspacesQ.data?.items ?? []);
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

  function submit(event?: Event) {
    event?.preventDefault();
    if (!effectiveWorkspaceId) {
      addToast({ tone: 'warning', message: t('workspace.pick', locale) });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ tone: 'warning', message: t('project.name_empty', locale) });
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
  <form class="cpj__form" onsubmit={submit}>
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
      placeholder={t('project.name_ph', locale)}
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label={t('project.color', locale)} disabled={$create.isPending} />

    <label class="field">
      <span>{t('project.description', locale)}</span>
      <textarea
        class="cpj__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder={t('project.description_ph', locale)}
        disabled={$create.isPending}
      ></textarea>
      <span class="cpj__desc-count">{description.length} / 280</span>
    </label>

    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="outline" disabled={$create.isPending} onclick={close}>{t('create.cancel', locale)}</Button>
    <Button loading={$create.isPending} onclick={submit}>{t('project.create', locale)}</Button>
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
