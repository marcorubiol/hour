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
  import { ASSET_KINDS, KIND_LABELS, kindLabel, type MaterialItem } from '$lib/material';

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

  const kindOptions = ASSET_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));

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
        title: 'Material not registered',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submitCreate() {
    const url = fUrl.trim();
    if (!fKind) {
      addToast({ tone: 'warning', message: 'Pick what kind of material this is.' });
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
      addToast({ tone: 'warning', message: 'Enter a full URL (https://…).' });
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
        title: 'Material not removed',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });
</script>

<section class="mat" aria-label="Materials">
  <header class="mat__head">
    <Button size="xs" variant="outline" onclick={openCreate}>Register material</Button>
  </header>

  {#if errorMsg}
    <p class="mat__state mat__state--danger">{errorMsg}</p>
  {:else if loading}
    <p class="mat__state">Loading…</p>
  {:else if items.length === 0}
    <p class="mat__state">No materials registered — riders, dossiers, plots live here.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Direction</th>
            <th>Link</th>
            <th>Notes</th>
            <th>Registered</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each items as m (m.id)}
            <tr>
              <td>{kindLabel(m.kind)}</td>
              <td class="mat__cell-direction">{m.direction}</td>
              <td>
                <a class="mat__link" href={m.url} target="_blank" rel="noopener noreferrer">
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
                  label="Material actions"
                  align="end"
                  triggerClass="btn--outline btn--xs"
                  items={[
                    {
                      label: 'Remove',
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
  title="Register material"
  description="v1 registers links — paste the URL where the version lives."
  size="s"
>
  <div class="mat__form">
    <Select
      label="Kind"
      bind:value={fKind}
      options={kindOptions}
      placeholder="Choose a kind…"
      required
    />
    <Input label="URL" type="url" bind:value={fUrl} placeholder="https://…" required />
    <Input label="Notes" bind:value={fNotes} placeholder="Optional — what changed, which venue…" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
    <Button onclick={submitCreate} loading={$createMaterial.isPending}>Register</Button>
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
      justify-content: flex-start;
    }

    .mat__state {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .mat__state--danger {
      color: var(--danger);
    }

    .table-wrap {
      overflow-x: auto;
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
