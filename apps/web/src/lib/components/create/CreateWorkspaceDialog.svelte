<script lang="ts">
  /**
   * New-workspace dialog — the creation flow ported out of the retired
   * Plaza sidebar. Name + accent swatch (8-color palette, Auto = server
   * derives via hash(slug)) + description. POST /api/workspaces, then wait
   * for the ['workspaces'] cache to hold the new row BEFORE navigating —
   * the workspace page reads that cache and 404s if the row isn't there.
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import AccentSwatchPicker from './AccentSwatchPicker.svelte';

  interface Props {
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  type CreatedWorkspace = { id: string; slug: string; name: string };

  const queryClient = useQueryClient();

  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let description = $state('');

  // Live preview of the color Auto would pick for the typed name.
  let autoAccentSlug = $derived(name.trim() || 'workspace');

  function reset() {
    name = '';
    accent = null;
    description = '';
  }

  function close() {
    open = false;
    reset();
  }

  const create = createMutation({
    mutationFn: async (input: { name: string; accent: string | null; description: string }) => {
      const body: Record<string, string> = { name: input.name };
      if (input.accent) body.accent = input.accent;
      if (input.description.trim()) body.description = input.description.trim();
      const res = await mutateJSON<{ workspace: CreatedWorkspace }>(
        'POST',
        '/api/workspaces',
        body,
      );
      if (!res?.workspace) throw new Error('Empty response');
      return res.workspace;
    },
    onSuccess: async (workspace) => {
      // Refetch must land before goto — the target page 404s otherwise.
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      await queryClient.refetchQueries({ queryKey: ['workspaces'] });
      close();
      await goto(`/h/${workspace.slug}/`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Workspace not created',
        message:
          err instanceof ApiError && err.status === 409
            ? 'A workspace with that name already exists.'
            : err instanceof Error
              ? err.message
              : 'Unexpected error',
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ tone: 'warning', message: 'Name cannot be empty.' });
      return;
    }
    $create.mutate({ name: trimmed, accent, description });
  }
</script>

<Dialog
  bind:open
  title="New workspace"
  description="A workspace groups your projects under your personal account."
  size="s"
  onclose={reset}
>
  <form class="cws__form" onsubmit={submit}>
    <Input
      label="Name"
      name="workspace-name"
      bind:value={name}
      placeholder="e.g. Side projects"
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label="Space color" disabled={$create.isPending} />

    <label class="field">
      <span>Description</span>
      <textarea
        class="cws__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder="Optional. What is this workspace for?"
        disabled={$create.isPending}
      ></textarea>
      <span class="cws__desc-count">{description.length} / 280</span>
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
    .cws__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .cws__desc {
      resize: vertical;
      min-block-size: 5em;
    }

    .cws__desc-count {
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-align: end;
    }
  }
</style>
