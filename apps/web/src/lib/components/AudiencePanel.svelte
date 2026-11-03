<script lang="ts">
  /**
   * Las listas del público de los espacios en pantalla con sus recuentos, al
   * lado de la lista de Envíos (ADR-176; antes la vista Público, ADR-173 § 3).
   * Lista y abre; lo que se edita (la lista, su texto) tiene su página.
   * «Nueva lista» la crea en borrador y abre su página. Las invitaciones van
   * en la lista de Envíos, con la difusión.
   */
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { retryLoad } from '$lib/load-fail';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { audienceListQueryOptions } from '$lib/audience-query';
  import type { NavWorkspace } from '$lib/nav';

  interface Props {
    workspaceIds: string[];
    workspaces: NavWorkspace[];
    locale: Locale;
  }

  let { workspaceIds, workspaces, locale }: Props = $props();

  const query = createQuery(toStore(() => ({ ...audienceListQueryOptions(workspaceIds), retry: retryLoad })));
  let data = $derived($query.data ?? null);
  let byId = $derived(new Map(workspaces.map((w) => [w.id, w])));
  let editable = $derived(workspaceIds.filter((w) => data?.access[w]?.edit));
  let multi = $derived(new Set((data?.items ?? []).map((a) => a.workspace_id)).size > 1 || editable.length > 1);

  function href(workspaceId: string, path: string): string {
    return `/h/${byId.get(workspaceId)?.slug ?? ''}/${path}`;
  }

  // ── Nueva lista ───────────────────────────────────────────────────────
  let newOpen = $state(false);
  let newName = $state('');
  let newWorkspace = $state('');
  function openNew() {
    newName = '';
    newWorkspace = editable[0] ?? '';
    newOpen = true;
  }
  const create = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/audience', {
        workspace_id: newWorkspace,
        name: newName.trim(),
        languages: [locale],
      }),
    onSuccess: (r) => {
      newOpen = false;
      if (r) void goto(`/h/${r.workspace_slug}/audience/${r.id}`);
    },
    onError: (err) =>
      addToast({ tone: 'danger', title: t('audience.not_saved', locale), message: err instanceof Error ? err.message : '' }),
  });
</script>

<section class="aud" data-testid="audience-panel">
  {#if $query.isLoading}
    <p class="aud__msg">{t('audience.loading', locale)}</p>
  {:else if $query.isError}
    <p class="aud__msg">{t('audience.load_error', locale)}</p>
  {:else if data}
    <div>
      <BlockHead title={t('envios.audience_lists', locale)} count={data.items.length}>
        {#if editable.length > 0}
          <Button size="s" onclick={openNew}>{t('audience.new_list', locale)}</Button>
        {/if}
      </BlockHead>
      {#if data.items.length === 0}
        <p class="aud__msg">{t(editable.length ? 'audience.empty_edit' : 'audience.empty', locale)}</p>
      {:else}
        <ul class="aud__lists">
          {#each data.items as a (a.id)}
            <li class="aud__list">
              <a class="aud__name" href={href(a.workspace_id, `audience/${a.id}`)}>{a.name}</a>
              <span class="aud__status" data-status={a.status}>{t(`audience.status_${a.status}`, locale)}</span>
              {#if multi}<span class="aud__ws">{byId.get(a.workspace_id)?.name ?? ''}</span>{/if}
              <span class="aud__counts">
                {t('audience.counts', locale, { n: a.counts.confirmed, m: a.counts.pending, k: a.counts.unsubscribed })}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

  {/if}
</section>

<Dialog bind:open={newOpen} title={t('audience.new_list', locale)} size="s">
  <Input label={t('audience.list_name', locale)} bind:value={newName} placeholder={t('audience.list_name_ph', locale)} />
  {#if editable.length > 1}
    <Select
      label={t('audience.workspace', locale)}
      options={editable.map((w) => ({ value: w, label: byId.get(w)?.name ?? '' }))}
      bind:value={newWorkspace}
    />
  {/if}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (newOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button loading={$create.isPending} disabled={!newName.trim() || !newWorkspace} onclick={() => $create.mutate()}>
      {t('audience.create', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .aud {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .aud__msg {
      margin: 0;
      padding-block: var(--space-s);
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }
    .aud__lists {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .aud__list {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-s);
      border-block-end: var(--border);
    }
    .aud__name {
      font-weight: 500;
    }
    .aud__status,
    .aud__ws {
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .aud__counts {
      margin-inline-start: auto;
      color: var(--text-muted);
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
