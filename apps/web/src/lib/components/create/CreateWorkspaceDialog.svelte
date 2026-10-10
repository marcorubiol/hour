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
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  type CreatedWorkspace = { id: string; slug: string; name: string };

  const queryClient = useQueryClient();
  const locale = appLocale();

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
        title: t('workspace.not_created', locale),
        message:
          err instanceof ApiError && err.status === 409
            ? t('workspace.name_taken', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ tone: 'warning', message: t('project.name_empty', locale) });
      return;
    }
    $create.mutate({ name: trimmed, accent, description });
  }
</script>

<Dialog
  bind:open
  title={t('workspace.new_title', locale)}
  description={t('workspace.new_desc', locale)}
  size="s"
  onclose={reset}
>
  <form class="cws__form" onsubmit={submit}>
    <Input
      label={t('conversations.col_name', locale)}
      name="workspace-name"
      bind:value={name}
      placeholder={t('workspace.name_ph', locale)}
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label={t('workspace.color', locale)} disabled={$create.isPending} />

    <label class="field">
      <span>{t('project.description', locale)}</span>
      <textarea
        class="cws__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder={t('workspace.new_description_ph', locale)}
        disabled={$create.isPending}
      ></textarea>
      <span class="cws__desc-count">{description.length} / 280</span>
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
