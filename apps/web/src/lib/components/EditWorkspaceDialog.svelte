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
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    open?: boolean;
    workspace: NavWorkspace | null;
  }

  let { open = $bindable(false), workspace }: Props = $props();

  const queryClient = useQueryClient();
  const locale = appLocale();

  const DOMAIN_OPTIONS = [
    { value: '', label: t('workspace.domain_none', locale) },
    { value: 'theatre', label: t('workspace.domain_theatre', locale) },
    { value: 'dance', label: t('workspace.domain_dance', locale) },
    { value: 'circus', label: t('workspace.domain_circus', locale) },
    { value: 'music', label: t('workspace.domain_music', locale) },
    { value: 'mixed', label: t('workspace.domain_mixed', locale) },
    { value: 'other', label: t('workspace.domain_other', locale) },
  ];

  /**
   * ADR-002 — which hold convention this space speaks. Only two entries: the
   * simple case is the ABSENT key, not a stored "simple", so the setting has
   * one representation instead of two that mean the same thing.
   */
  const BOOKING_MODE_OPTIONS = [
    { value: '', label: t('workspace.holds_simple', locale) },
    { value: 'prioritized', label: t('workspace.holds_ranked', locale) },
  ];

  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let domain = $state(''); // '' = no discipline
  let bookingMode = $state(''); // '' = absent = simple
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
      bookingMode = workspace.booking_mode === 'prioritized' ? 'prioritized' : '';
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
        // '' clears the key back to absent (= simple); see the RPC.
        booking_mode: bookingMode,
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
      addToast({ tone: 'success', message: t('workspace.updated', locale) });
      close();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_saved', locale),
        message:
          err instanceof ApiError && err.status === 403
            ? t('workspace.no_permission', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    if (!name.trim()) {
      addToast({ tone: 'warning', message: t('project.name_empty', locale) });
      return;
    }
    $save.mutate();
  }

  // ── Web address (ADR-067) ─────────────────────────────────────────────
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
      addToast({ tone: 'success', message: t('workspace.alias_requested', locale) });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError && err.status === 409
          ? t('workspace.alias_taken', locale)
          : err instanceof ApiError && err.status === 400
            ? t('workspace.alias_invalid', locale)
            : err instanceof ApiError && err.status === 403
              ? t('workspace.alias_forbidden', locale)
              : err instanceof Error
                ? err.message
                : t('perf.unexpected', locale);
      addToast({ tone: 'danger', title: t('workspace.alias_not_requested', locale), message: msg });
    },
  });

  function submitAlias() {
    if (!aliasInput.trim()) return;
    $requestAlias.mutate();
  }
</script>

<Dialog bind:open title={t('workspace.edit_title', locale)} size="s">
  <form class="ews__form" onsubmit={submit}>
    <Input
      label={t('conversations.col_name', locale)}
      name="space-name"
      bind:value={name}
      required
      autocomplete="off"
      disabled={$save.isPending}
    />

    <Select
      label={t('workspace.discipline', locale)}
      name="space-domain"
      bind:value={domain}
      options={DOMAIN_OPTIONS}
      helper={t('workspace.discipline_help', locale)}
      disabled={$save.isPending}
    />

    <Select
      label={t('workspace.holds', locale)}
      name="space-booking-mode"
      bind:value={bookingMode}
      options={BOOKING_MODE_OPTIONS}
      helper={t('workspace.holds_help', locale)}
      disabled={$save.isPending}
    />

    <Input
      label={t('workspace.home_base', locale)}
      name="space-city"
      bind:value={city}
      placeholder={t('workspace.home_base_ph', locale)}
      autocomplete="off"
      disabled={$save.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label={t('workspace.color', locale)} disabled={$save.isPending} />

    <label class="field">
      <span>{t('project.description', locale)}</span>
      <textarea
        class="ews__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder={t('workspace.description_ph', locale)}
        disabled={$save.isPending}
      ></textarea>
      <span class="ews__desc-count">{description.length} / 280</span>
    </label>

    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  <div class="ews__address">
    <span class="eyebrow">{t('workspace.web_address', locale)}</span>
    <p class="ews__address-current">
      <span class="ews__address-url">/h/{workspace?.slug}</span>
      {#if workspace?.alias}
        <span class="ews__address-alias">{t('workspace.alias_current', locale, { alias: workspace.alias })}</span>
      {/if}
    </p>
    {#if pendingAlias}
      <p class="ews__address-pending">{t('workspace.alias_pending', locale, { alias: pendingAlias })}</p>
    {:else}
      <div class="ews__address-claim">
        <Input
          label={t('workspace.alias_request_label', locale)}
          name="space-alias"
          bind:value={aliasInput}
          placeholder={t('workspace.alias_ph', locale)}
          helper={t('workspace.alias_help', locale)}
          autocomplete="off"
          disabled={$requestAlias.isPending}
        />
        <Button
          variant="outline"
          loading={$requestAlias.isPending}
          disabled={!aliasInput.trim()}
          onclick={submitAlias}
        >
          {t('workspace.alias_request', locale)}
        </Button>
      </div>
    {/if}
  </div>

  {#snippet actions()}
    <Button variant="outline" disabled={$save.isPending} onclick={close}>{t('create.cancel', locale)}</Button>
    <Button loading={$save.isPending} onclick={submit}>{t('blackout.save', locale)}</Button>
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
