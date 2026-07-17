<script module lang="ts">
  export interface ConversationFilters {
    projectSlug?: string;
    projectIds?: string[];
    lineId?: string;
    workspaceIds?: string[];
    season?: string;
    q?: string;
    status?: string;
    /** Hold the query (e.g. while a sidebar selection hasn't resolved). */
    enabled?: boolean;
  }
</script>

<script lang="ts">
  /**
   * ConversationTable — the difusión work surface (ADR-040 write path):
   * paginated conversation list with inline status editing (menu over the
   * badge) and next-action editing (dialog), optimistic with rollback +
   * toast. Extracted from /booking so the Conversations lens and the legacy
   * page share one implementation.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonth } from '$lib/datetime';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    CONVERSATION_STATUSES,
    statusBadgeClass,
    statusLabel,
    type ConversationItem,
    type ConversationPatch,
    type ConversationStatus,
  } from '$lib/conversation';

  interface Props {
    filters: ConversationFilters;
    /** e.g. `/h/muk-cia/person` — when set, names link to the person file. */
    personBase?: string;
  }

  let { filters, personBase }: Props = $props();

  type ConversationsResponse = {
    total: number;
    limit: number;
    offset: number;
    items: ConversationItem[];
  };

  const LIMIT = 50;
  let offset = $state(0);

  // New filters restart pagination (first run is a harmless no-op).
  let filterKey = $derived(JSON.stringify(filters));
  let lastFilterKey = $state('');
  $effect(() => {
    if (filterKey !== untrack(() => lastFilterKey)) {
      lastFilterKey = filterKey;
      offset = 0;
    }
  });

  function params(f: ConversationFilters, o: number): string {
    const p = new URLSearchParams();
    p.set('status', f.status ?? 'any');
    if (f.projectSlug) p.set('project_slug', f.projectSlug);
    if (f.projectIds && f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.lineId) p.set('line_id', f.lineId);
    if (f.workspaceIds && f.workspaceIds.length > 0)
      p.set('workspace_ids', f.workspaceIds.join(','));
    if (f.season) p.set('season', f.season);
    if (f.q) p.set('q', f.q);
    p.set('limit', String(LIMIT));
    p.set('offset', String(o));
    return p.toString();
  }

  const queryOptions = toStore(() => {
    const f = filters;
    const o = offset;
    return {
      queryKey: ['conversations', { ...f, limit: LIMIT, offset: o }] as const,
      enabled: f.enabled !== false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ConversationsResponse>(`/api/conversations?${params(f, o)}`, signal),
      placeholderData: (prev: ConversationsResponse | undefined) => prev,
    };
  });

  const query = createQuery(queryOptions);

  // ── Inline write path (ADR-040) — cache-anchored optimistic updates ────
  const queryClient = useQueryClient();

  type PatchInput = { id: string; patch: ConversationPatch };

  const patchMutation = createMutation({
    mutationFn: async ({ id, patch }: PatchInput) => {
      const body = await mutateJSON<{ item?: ConversationItem }>(
        'PATCH',
        `/api/conversations/${id}`,
        patch,
      );
      if (!body?.item) throw new Error('Unexpected response');
      return body.item;
    },
    onMutate: async ({ id, patch }: PatchInput) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const pages = queryClient
        .getQueriesData<ConversationsResponse>({ queryKey: ['conversations'] })
        .filter(([, d]) => d?.items.some((it) => it.id === id));
      for (const [key, data] of pages) {
        if (!data) continue;
        queryClient.setQueryData<ConversationsResponse>(key, {
          ...data,
          items: data.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        });
      }
      return { pages };
    },
    onError: (err, _vars, ctx) => {
      for (const [key, data] of ctx?.pages ?? []) {
        queryClient.setQueryData(key, data);
      }
      addToast({
        tone: 'danger',
        title: 'Change not saved',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
    onSuccess: (item, _vars, ctx) => {
      for (const [key] of ctx?.pages ?? []) {
        const cur = queryClient.getQueryData<ConversationsResponse>(key);
        if (cur) {
          queryClient.setQueryData<ConversationsResponse>(key, {
            ...cur,
            items: cur.items.map((it) => (it.id === item.id ? { ...it, ...item } : it)),
          });
        }
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      // Line header funnel stats (ADR-056) read the same rows.
      void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    },
  });

  function changeStatus(item: ConversationItem, status: ConversationStatus) {
    if (item.status === status) return;
    $patchMutation.mutate({ id: item.id, patch: { status } });
  }

  // ── Next action editor (dialog) ─────────────────────────────────────────
  let dialogOpen = $state(false);
  let editing = $state<ConversationItem | null>(null);
  let formDate = $state('');
  let formNote = $state('');

  function openNextAction(item: ConversationItem) {
    editing = item;
    formDate = item.next_action_at ? item.next_action_at.slice(0, 10) : '';
    formNote = item.next_action_note ?? '';
    dialogOpen = true;
  }

  function closeNextAction() {
    dialogOpen = false;
    editing = null;
  }

  function saveNextAction() {
    if (!editing) return;
    $patchMutation.mutate({
      id: editing.id,
      patch: {
        next_action_at: formDate || null,
        next_action_note: formNote.trim() || null,
      },
    });
    closeNextAction();
  }

  let total = $derived($query.data?.total ?? 0);
  let items = $derived(($query.data?.items ?? []) as ConversationItem[]);
  let loading = $derived($query.isLoading);
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return dayMonth(iso);
  }

  function locationOf(item: ConversationItem): string {
    if (!item.person) return '—';
    return [item.person.city, item.person.country].filter(Boolean).join(', ') || '—';
  }

  let showPagination = $derived(total > LIMIT);
  let rangeEnd = $derived(Math.min(offset + LIMIT, total));
</script>

<div class="status-bar">
  {#if loading}
    <span>Loading...</span>
  {:else if !errorMsg}
    <span class="status-bar__count">{total} conversations</span>
    {#if total > 0}<span>Showing {offset + 1}-{rangeEnd}</span>{/if}
  {/if}
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Organization</th>
        <th>Location</th>
        <th>Status</th>
        <th>Next action</th>
      </tr>
    </thead>
    <tbody>
      {#each items as item, i (item.id)}
        <tr>
          <td class="cell--name">
            {#if personBase && item.person?.slug}
              <a class="cell--name-link" href={`${personBase}/${item.person.slug}`}>
                {item.person.full_name}
              </a>
            {:else}
              {item.person?.full_name ?? '—'}
            {/if}
          </td>
          <td class="cell--muted">{item.person?.organization_name ?? '—'}</td>
          <td class="cell--meta">{locationOf(item)}</td>
          <td>
            <Menu
              label="Change status"
              triggerClass={statusBadgeClass(item.status)}
              direction={i >= items.length - 2 && i > 2 ? 'up' : 'down'}
            >
              {#snippet trigger()}
                {statusLabel(item.status)}<span class="status-caret" aria-hidden="true">▾</span>
              {/snippet}
              {#snippet children({ close })}
                {#each CONVERSATION_STATUSES as s (s)}
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="menu__item{s === item.status ? ' menu__item--active' : ''}"
                      onclick={() => {
                        close();
                        changeStatus(item, s);
                      }}
                    >
                      {statusLabel(s)}
                    </button>
                  </li>
                {/each}
              {/snippet}
            </Menu>
          </td>
          <td>
            <button
              type="button"
              class="next-action"
              onclick={() => openNextAction(item)}
              title={item.next_action_note ?? 'Set next action'}
            >
              <span class="next-action__date">{formatDate(item.next_action_at)}</span>
              {#if item.next_action_note}
                <span class="next-action__note">{item.next_action_note}</span>
              {/if}
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if errorMsg}
  <div class="msg msg--error">{errorMsg}</div>
{:else if !loading && items.length === 0}
  <div class="msg">No results.</div>
{/if}

{#if showPagination}
  <div class="pagination">
    <button
      class="btn--outline btn--s"
      onclick={() => (offset = Math.max(0, offset - LIMIT))}
      disabled={offset === 0}
    >
      Previous
    </button>
    <button
      class="btn--outline btn--s"
      onclick={() => (offset = offset + LIMIT)}
      disabled={offset + LIMIT >= total}
    >
      Next
    </button>
  </div>
{/if}

<Dialog bind:open={dialogOpen} title="Next action" size="s" onclose={() => (editing = null)}>
  {#if editing}
    <p class="next-action-who">
      {editing.person?.full_name ?? 'Conversation'}{editing.person?.organization_name
        ? ` — ${editing.person.organization_name}`
        : ''}
    </p>
  {/if}
  <Input label="Date" type="date" bind:value={formDate} />
  <div class="field">
    <label for="next-action-note">Note</label>
    <textarea
      id="next-action-note"
      rows="3"
      maxlength="500"
      bind:value={formNote}
      placeholder="What's the next move?"
    ></textarea>
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={closeNextAction}>Cancel</Button>
    <Button onclick={saveNextAction}>Save</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .status-bar {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding-block: var(--space-s);
      border-block-end: var(--divider);
      font-size: var(--text-s);
      color: var(--text-dark-muted);
      flex-wrap: wrap;
    }
    .status-bar__count {
      color: var(--heading-color);
      font-weight: 500;
    }

    .msg {
      text-align: center;
      padding-block: var(--space-xxl);
      color: var(--text-dark-muted);
    }
    .msg--error {
      color: var(--danger-dark);
    }

    .pagination {
      display: flex;
      justify-content: center;
      gap: var(--space-s);
      padding-block: var(--space-m);
    }

    tbody td {
      max-inline-size: clamp(7rem, 24cqi, 16rem);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tbody tr:hover td {
      background: var(--bg-ultra-light);
    }
    .cell--name {
      font-weight: 500;
      color: var(--heading-color);
    }
    .cell--name-link {
      color: inherit;
      text-decoration: none;
    }
    .cell--name-link:hover {
      text-decoration: underline;
    }
    .cell--muted {
      color: var(--text-dark-muted);
    }
    .cell--meta {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    .next-action {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2xs);
      text-align: start;
      max-inline-size: 100%;
    }
    .next-action__date {
      color: var(--text-dark-muted);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .next-action:hover .next-action__date {
      color: var(--text-color);
    }
    .next-action__note {
      color: var(--text-faint);
      font-size: var(--text-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-inline-size: 14rem;
    }

    .next-action-who {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
  }
</style>
