<script lang="ts">
  /**
   * Materials module (ADR-056 v1) — the line's versioned-assets registry.
   * Rows + links only: register a URL where the version lives (Drive,
   * Dropbox…), no upload (that arrives with the R2 UI). Direction is
   * fixed 'outbound' at line scope, so the form never asks for it.
   * Content-only component — the line detail shell owns the module frame.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel } from '$lib/datetime';
  import { ASSET_KINDS, directionLabel, kindLabel, type MaterialItem } from '$lib/material';
  import { appLocale, t } from '$lib/i18n';
  import { safeHref } from '$lib/utils/safe-url';

  interface Props {
    line: {
      id: string;
      slug: string | null;
      name: string;
      kind: string;
      project_id: string;
      workspace_id: string;
    };
    workspaceSlug: string;
  }

  let { line, workspaceSlug }: Props = $props();

  const locale = appLocale();
  const kindOptions = ASSET_KINDS.map((k) => ({ value: k, label: kindLabel(k, locale) }));

  const queryClient = useQueryClient();

  const materialsOptions = toStore(() => ({
    queryKey: ['line-materials', line.id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: MaterialItem[] }>(`/api/lines/${line.id}/materials`, signal),
  }));
  const materialsQuery = createQuery(materialsOptions);

  let items = $derived($materialsQuery.data?.items ?? []);
  let loading = $derived($materialsQuery.isLoading);
  let errorMsg = $derived(
    $materialsQuery.error instanceof Error ? $materialsQuery.error.message : '',
  );

  // ── Register dialog ───────────────────────────────────────────────────
  let createOpen = $state(false);
  let fKind = $state('');
  let fUrl = $state('');
  let fNotes = $state('');

  function openCreate() {
    fKind = '';
    fUrl = '';
    fNotes = '';
    createOpen = true;
  }

  const createMaterial = createMutation({
    mutationFn: (input: { kind: string; url: string; notes: string | null }) =>
      mutateJSON<{ material: MaterialItem }>('POST', `/api/lines/${line.id}/materials`, input),
    onSuccess: () => {
      createOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['line-materials', line.id] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('line.material_not_registered', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function submitCreate() {
    const url = fUrl.trim();
    if (!fKind) {
      addToast({ tone: 'warning', message: t('line.material_pick_kind', locale) });
      return;
    }
    let valid = false;
    try {
      new URL(url);
      valid = true;
    } catch {
      valid = false;
    }
    if (!valid) {
      addToast({ tone: 'warning', message: t('line.material_full_url', locale) });
      return;
    }
    $createMaterial.mutate({ kind: fKind, url, notes: fNotes.trim() || null });
  }

  // ── Remove (soft-delete) ──────────────────────────────────────────────
  const deleteMaterial = createMutation({
    mutationFn: (assetId: string) =>
      mutateJSON('DELETE', `/api/lines/${line.id}/materials/${assetId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['line-materials', line.id] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('line.material_not_removed', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });
</script>

<section class="mat" aria-label={t('line.module_materials', locale)}>
  <header class="mat__head">
    <Button size="xs" variant="outline" onclick={openCreate}>{t('line.material_register', locale)}</Button>
  </header>

  {#if errorMsg}
    <p class="mat__state mat__state--danger">{errorMsg}</p>
  {:else if loading}
    <p class="mat__state">{t('desk.loading', locale)}</p>
  {:else if items.length === 0}
    <p class="mat__state">{t('line.material_empty', locale)}</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('conversations.event_kind', locale)}</th>
            <th>{t('create.direction', locale)}</th>
            <th>{t('line.material_link', locale)}</th>
            <th>{t('person.notes', locale)}</th>
            <th>{t('line.material_registered', locale)}</th>
            <th aria-label={t('line.actions', locale)}></th>
          </tr>
        </thead>
        <tbody>
          {#each items as m (m.id)}
            <tr>
              <td>{kindLabel(m.kind, locale)}</td>
              <td class="mat__cell-direction">{directionLabel(m.direction, locale)}</td>
              <td>
                <a class="mat__link" href={safeHref(m.url)} target="_blank" rel="noopener noreferrer">
                  {m.url}
                </a>
              </td>
              <td>
                {#if m.notes}
                  <span class="mat__notes" title={m.notes}>{m.notes}</span>
                {:else}
                  <span class="mat__notes">—</span>
                {/if}
              </td>
              <td class="mat__cell-date">{dayLabel(m.uploaded_at)}</td>
              <td class="mat__cell-actions">
                <Menu
                  label={t('line.material_actions', locale)}
                  align="end"
                  triggerClass="btn--outline btn--xs"
                  items={[
                    {
                      label: t('line.remove', locale),
                      danger: true,
                      onclick: () => $deleteMaterial.mutate(m.id),
                    },
                  ]}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<Dialog
  bind:open={createOpen}
  title={t('line.material_register', locale)}
  description={t('line.material_dialog_desc', locale)}
  size="s"
>
  <div class="mat__form">
    <Select
      label={t('conversations.event_kind', locale)}
      bind:value={fKind}
      options={kindOptions}
      placeholder={t('line.material_kind_ph', locale)}
      required
    />
    <Input label="URL" type="url" bind:value={fUrl} placeholder="https://…" required />
    <Input
      label={t('person.notes', locale)}
      bind:value={fNotes}
      placeholder={t('line.material_notes_ph', locale)}
    />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (createOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submitCreate} loading={$createMaterial.isPending}>{t('line.material_register_short', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .mat {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .mat__head {
      display: flex;
      justify-content: flex-end;
    }

    .mat__state {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .mat__state--danger {
      color: var(--danger);
    }

    .mat__cell-direction {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      text-transform: lowercase;
    }

    .mat__cell-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }

    .mat__link {
      display: inline-block;
      max-inline-size: 20rem;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
    }
    .mat__link:hover {
      text-decoration: underline;
    }

    .mat__notes {
      display: inline-block;
      max-inline-size: 14rem;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
      font-size: var(--text-s);
      color: var(--text-dark-muted);
    }

    .mat__cell-actions {
      text-align: end;
    }

    .mat__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
