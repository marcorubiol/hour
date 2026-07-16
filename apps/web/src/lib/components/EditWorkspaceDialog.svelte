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
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
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

  // ── Web address (ADR-066) ─────────────────────────────────────────────
  // The space's identity segment is a machine short-id; a pretty alias is
  // requested here and granted by the platform operator. The canonical URL
  // never changes — the alias is an extra door, not a rename.
  type AliasRequest = {
    id: string;
    workspace_id: string;
    alias: string;
    status: string;
  };

  let aliasInput = $state('');

  const pendingOptions = toStore(() => ({
    queryKey: ['alias-requests', 'pending', workspace?.id] as const,
    enabled: open && !!workspace,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: AliasRequest[] }>(
        '/api/workspaces/alias-requests?status=pending',
        signal,
      ),
  }));
  const pendingQuery = createQuery(pendingOptions);
  let pendingAlias = $derived(
    ($pendingQuery.data?.items ?? []).find((r) => r.workspace_id === workspace?.id)?.alias ??
      null,
  );

  const requestAlias = createMutation({
    mutationFn: async () => {
      if (!workspace) throw new Error('No workspace');
      const res = await mutateJSON<{ request: AliasRequest }>(
        'POST',
        '/api/workspaces/alias-requests',
        { workspace_id: workspace.id, alias: aliasInput.trim().toLowerCase() },
      );
      if (!res?.request) throw new Error('Empty response');
      return res.request;
    },
    onSuccess: async () => {
      aliasInput = '';
      await queryClient.invalidateQueries({ queryKey: ['alias-requests'] });
      addToast({ tone: 'success', message: 'Alias requested — pending review.' });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError && err.status === 409
          ? 'That alias is already taken.'
          : err instanceof ApiError && err.status === 400
            ? 'Invalid alias — lowercase letters, digits and hyphens.'
            : err instanceof ApiError && err.status === 403
              ? 'Only the space owner or an admin can request an alias.'
              : err instanceof Error
                ? err.message
                : 'Unexpected error';
      addToast({ tone: 'danger', title: 'Alias not requested', message: msg });
    },
  });

  function submitAlias() {
    if (!aliasInput.trim()) return;
    $requestAlias.mutate();
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

  <div class="ews__address">
    <span class="eyebrow">Web address</span>
    <p class="ews__address-current">
      <span class="ews__address-url">/h/{workspace?.slug}</span>
      {#if workspace?.alias}
        <span class="ews__address-alias">alias: /h/{workspace.alias}</span>
      {/if}
    </p>
    {#if pendingAlias}
      <p class="ews__address-pending">Requested: /h/{pendingAlias} — pending review.</p>
    {:else}
      <div class="ews__address-claim">
        <Input
          label="Request an alias"
          name="space-alias"
          bind:value={aliasInput}
          placeholder="e.g. mocia"
          helper="Lowercase letters, digits, hyphens. Granted after review; the address above keeps working either way."
          autocomplete="off"
          disabled={$requestAlias.isPending}
        />
        <Button
          variant="outline"
          loading={$requestAlias.isPending}
          disabled={!aliasInput.trim()}
          onclick={submitAlias}
        >
          Request
        </Button>
      </div>
    {/if}
  </div>

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

    .ews__address {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-m);
      padding-block-start: var(--space-m);
      border-block-start: 1px solid var(--border-color-light);
    }

    .ews__address-current {
      display: flex;
      align-items: baseline;
      gap: var(--space-m);
      margin: 0;
    }

    .ews__address-url {
      font-family: var(--font-mono);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .ews__address-alias,
    .ews__address-pending {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .ews__address-pending {
      margin: 0;
    }

    .ews__address-claim {
      display: flex;
      align-items: flex-end;
      gap: var(--space-s);
    }

    .ews__address-claim :global(.field) {
      flex: 1;
    }
  }
</style>
