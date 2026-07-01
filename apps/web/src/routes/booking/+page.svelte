<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { derived, get, writable } from 'svelte/store';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    ENGAGEMENT_STATUSES,
    statusBadgeClass,
    statusLabel,
    type EngagementPatch,
    type EngagementStatus,
  } from '$lib/engagement';

  type EngagementItem = {
    id: string;
    status: string;
    next_action_at: string | null;
    next_action_note: string | null;
    person: {
      full_name: string | null;
      organization_name: string | null;
      city: string | null;
      country: string | null;
    } | null;
  };

  type EngagementsResponse = {
    total: number;
    limit: number;
    offset: number;
    items: EngagementItem[];
  };

  const LIMIT = 50;

  function clearAuth() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
  }

  // Pagination state. `writable` (legacy store) so the query options can
  // derive from it cleanly — `createQuery` from svelte-query v5 takes
  // `StoreOrVal<options>`, which is the simplest reactive bridge here.
  const offset = writable(0);

  // Single source for the list's query key — the mutation below must target
  // exactly the key of the page currently in cache.
  function queryKeyFor(o: number) {
    return [
      'engagements',
      {
        status: 'any',
        project_slug: 'mamemi',
        season: '2026-27',
        limit: LIMIT,
        offset: o,
      },
    ] as const;
  }

  // Bail out before mounting the query if there's no JWT — saves a 401
  // round-trip on first paint after logout.
  onMount(() => {
    if (!localStorage.getItem('hour_jwt')) {
      goto('/login', { replaceState: true });
    }
  });

  const queryOptions = derived(offset, ($offset) => ({
    queryKey: queryKeyFor($offset),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) throw new Error('Missing JWT');

      const url = `/api/engagements?status=any&project_slug=mamemi&season=2026-27&limit=${LIMIT}&offset=${$offset}`;
      const res = await fetch(url, {
        signal,
        headers: { Authorization: `Bearer ${jwt}` },
      });

      if (res.status === 401) {
        clearAuth();
        goto('/login', { replaceState: true });
        throw new Error('Unauthorized');
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }

      return (await res.json()) as EngagementsResponse;
    },
    // Keep showing previous page's data while the next page loads — no flicker
    // on prev/next clicks. Standard TanStack pattern for paginated lists.
    placeholderData: (prev: EngagementsResponse | undefined) => prev,
  }));

  const query = createQuery(queryOptions);

  // ── Inline write path (ADR-040) ─────────────────────────────────────────
  // Optimistic per-row update with rollback: the row repaints immediately,
  // a failed PATCH restores the snapshot and raises a toast. This is the
  // error→recovery loop the roadmap requires before any PATCH ships.
  const queryClient = useQueryClient();

  type PatchInput = { id: string; patch: EngagementPatch };

  const patchMutation = createMutation({
    mutationFn: async ({ id, patch }: PatchInput) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) {
        clearAuth();
        goto('/login', { replaceState: true });
        throw new Error('Missing JWT');
      }
      const res = await fetch(`/api/engagements/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        clearAuth();
        goto('/login', { replaceState: true });
        throw new Error('Unauthorized');
      }
      const body = (await res.json().catch(() => ({}))) as {
        item?: EngagementItem;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.item) {
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }
      return body.item;
    },
    onMutate: async ({ id, patch }: PatchInput) => {
      const key = queryKeyFor(get(offset));
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<EngagementsResponse>(key);
      if (prev) {
        queryClient.setQueryData<EngagementsResponse>(key, {
          ...prev,
          items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        });
      }
      return { key, prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      addToast({
        tone: 'danger',
        title: 'Change not saved',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
    onSuccess: (item, _vars, ctx) => {
      // Replace the optimistic row with the server truth.
      const cur = queryClient.getQueryData<EngagementsResponse>(ctx.key);
      if (cur) {
        queryClient.setQueryData<EngagementsResponse>(ctx.key, {
          ...cur,
          items: cur.items.map((it) => (it.id === item.id ? { ...it, ...item } : it)),
        });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['engagements'] }),
  });

  function changeStatus(item: EngagementItem, status: EngagementStatus) {
    if (item.status === status) return;
    $patchMutation.mutate({ id: item.id, patch: { status } });
  }

  // ── Next action editor (dialog) ─────────────────────────────────────────
  let dialogOpen = $state(false);
  let editing = $state<EngagementItem | null>(null);
  let formDate = $state('');
  let formNote = $state('');

  function openNextAction(item: EngagementItem) {
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

  // Read-side derived state. `$query` auto-subscribes via the store contract.
  let total = $derived($query.data?.total ?? 0);
  let items = $derived(($query.data?.items ?? []) as EngagementItem[]);
  let loading = $derived($query.isPending);
  let errorMsg = $derived(
    $query.error instanceof Error ? $query.error.message : '',
  );

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }

  function locationOf(item: EngagementItem): string {
    if (!item.person) return '—';
    return [item.person.city, item.person.country].filter(Boolean).join(', ') || '—';
  }

  function logout() {
    clearAuth();
    goto('/login', { replaceState: true });
  }

  function prev() {
    offset.update((o) => Math.max(0, o - LIMIT));
  }

  function next() {
    offset.update((o) => o + LIMIT);
  }

  let showPagination = $derived(total > LIMIT);
  let prevDisabled = $derived($offset === 0);
  let nextDisabled = $derived($offset + LIMIT >= total);
  let rangeEnd = $derived(Math.min($offset + LIMIT, total));
</script>

<svelte:head>
  <title>Booking 2026-27 — Hour</title>
</svelte:head>

<header class="app-header">
  <h1 class="h4">
    Hour <span class="text--dark-muted">/ Booking 2026-27</span>
  </h1>
  <button class="btn--outline" onclick={logout}>Sign out</button>
</header>

<div class="status-bar">
  {#if loading}
    <span>Loading...</span>
  {:else if !errorMsg}
    <span class="status-bar__count">{total} contacts</span>
    <span>Showing {$offset + 1}-{rangeEnd}</span>
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
          <td class="cell--name">{item.person?.full_name ?? '—'}</td>
          <td class="cell--muted">{item.person?.organization_name ?? '—'}</td>
          <td class="cell--meta">{locationOf(item)}</td>
          <td>
            <Menu
              label="Change status"
              triggerClass="{statusBadgeClass(item.status)} status-trigger"
              direction={i >= items.length - 2 && i > 2 ? 'up' : 'down'}
            >
              {#snippet trigger()}
                {statusLabel(item.status)}<span class="status-caret" aria-hidden="true">▾</span>
              {/snippet}
              {#snippet children({ close })}
                {#each ENGAGEMENT_STATUSES as s (s)}
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
    <button class="btn--outline" onclick={prev} disabled={prevDisabled}>Previous</button>
    <button class="btn--outline" onclick={next} disabled={nextDisabled}>Next</button>
  </div>
{/if}

<Dialog bind:open={dialogOpen} title="Next action" size="s" onclose={() => (editing = null)}>
  {#if editing}
    <p class="next-action-who">
      {editing.person?.full_name ?? 'Engagement'}{editing.person?.organization_name
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
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      border-block-end: var(--divider);
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding-block: var(--space-s);
      padding-inline: var(--gutter);
      border-block-end: var(--divider);
      font-size: var(--text-s);
      color: var(--text-dark-muted);
      flex-wrap: wrap;
    }
    .status-bar__count {
      color: var(--heading-color);
      font-weight: 500;
    }

    .table-wrap {
      overflow-x: auto;
      padding-inline: var(--gutter);
    }

    .msg {
      text-align: center;
      padding-block: var(--space-xxl);
      padding-inline: var(--gutter);
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
      padding-inline: var(--gutter);
    }

    /* Cell-content + status-badge styles. Now that rows render through Svelte,
       these no longer need to be global — Svelte injects scope hashes
       consistently across each iteration. */
    tbody td {
      max-inline-size: 16rem;
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
    .cell--muted {
      color: var(--text-dark-muted);
    }
    .cell--meta {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    /* Status badge doubles as the menu trigger — same badge-- variable
       contract from base.css, plus button affordances. */
    :global(.status-trigger) {
      cursor: pointer;
      border-color: var(--badge-border-color);
      font-family: inherit;
    }
    .status-caret {
      opacity: 0.5;
      margin-inline-start: 0.35em;
      font-size: 0.85em;
    }

    /* Next-action cell is a click-to-edit surface: date on top, note
       truncated underneath. */
    .next-action {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
      font: inherit;
      text-align: start;
      max-inline-size: 100%;
    }
    .next-action__date {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
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
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    /* Engagement status badge variants live in base.css (single source of
       truth, consumed by booking + room detail + future contacts lens). */
  }
</style>
