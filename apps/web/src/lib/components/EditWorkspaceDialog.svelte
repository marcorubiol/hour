<script lang="ts">
  /**
   * Edit-space dialog (ADR-062) — the masthead pencil opens this. Name +
   * discipline + home base + color + description, PATCHed via
   * update_workspace (owner/admin only). Seeds from the current workspace on
   * open; on success invalidates ['workspaces'] so the masthead + rail
   * repaint in place (no navigation — you stay on the portada).
   *
   * logo_url is intentionally NOT managed here yet (upload flow + CSP img-src
   * ship later); the RPC leaves absent keys untouched, so it survives edits.
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import AccentSwatchPicker from '$lib/components/create/AccentSwatchPicker.svelte';
  import type { NavWorkspace } from '$lib/nav';

  interface Props {
    open?: boolean;
    workspace: NavWorkspace | null;
  }

  let { open = $bindable(false), workspace }: Props = $props();

  const queryClient = useQueryClient();

  const DOMAIN_OPTIONS = [
    { value: '', label: '— No discipline —' },
    { value: 'theatre', label: 'Theatre' },
    { value: 'dance', label: 'Dance' },
    { value: 'circus', label: 'Circus' },
    { value: 'music', label: 'Music' },
    { value: 'mixed', label: 'Mixed' },
    { value: 'other', label: 'Other' },
  ];

  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let domain = $state(''); // '' = no discipline
  let city = $state('');
  let description = $state('');

  // Seed the form from the workspace each time the dialog transitions to open.
  // Plain latch (not $state) so writing it can't re-trigger the effect.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen && workspace) {
      name = workspace.name ?? '';
      accent = workspace.accent ?? null;
      domain = workspace.domain ?? '';
      city = workspace.city ?? '';
      description = workspace.description ?? '';
    }
    wasOpen = open;
  });

  let autoAccentSlug = $derived(workspace?.slug || name.trim() || 'workspace');

  function close() {
    open = false;
  }

  const save = createMutation({
    mutationFn: async () => {
      if (!workspace) throw new Error('No workspace');
      // Full state for the fields this dialog manages: '' / null clear.
      const body = {
        name: name.trim(),
        description: description.trim(),
        accent,
        domain: domain || null,
        city: city.trim(),
      };
      const res = await mutateJSON<{ workspace: { id: string; slug: string } }>(
        'PATCH',
        `/api/workspaces/${workspace.id}`,
        body,
      );
      if (!res?.workspace) throw new Error('Empty response');
      return res.workspace;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      addToast({ tone: 'success', message: 'Space updated.' });
      close();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not saved',
        message:
          err instanceof ApiError && err.status === 403
            ? "You don't have permission to edit this space."
            : err instanceof Error
              ? err.message
              : 'Unexpected error',
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    if (!name.trim()) {
      addToast({ tone: 'warning', message: 'Name cannot be empty.' });
      return;
    }
    $save.mutate();
  }
</script>

<Dialog bind:open title="Edit space" size="s">
  <form class="ews__form" onsubmit={submit}>
    <Input
      label="Name"
      name="space-name"
      bind:value={name}
      required
      autocomplete="off"
      disabled={$save.isPending}
    />

    <Select
      label="Discipline"
      name="space-domain"
      bind:value={domain}
      options={DOMAIN_OPTIONS}
      helper="Drives the vocabulary this space uses."
      disabled={$save.isPending}
    />

    <Input
      label="Home base"
      name="space-city"
      bind:value={city}
      placeholder="e.g. Barcelona"
      autocomplete="off"
      disabled={$save.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label="Space color" disabled={$save.isPending} />

    <label class="field">
      <span>Description</span>
      <textarea
        class="ews__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder="Optional. What is this space for?"
        disabled={$save.isPending}
      ></textarea>
      <span class="ews__desc-count">{description.length} / 280</span>
    </label>

    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="outline" disabled={$save.isPending} onclick={close}>Cancel</Button>
    <Button loading={$save.isPending} onclick={submit}>Save</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .ews__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .ews__desc {
      resize: vertical;
      min-block-size: 5em;
    }

    .ews__desc-count {
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-align: end;
    }
  }
</style>
