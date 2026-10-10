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
  import { onMount, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonth, dayMonthYear } from '$lib/datetime';
  import { detectLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import ConversationHistory from '$lib/components/ConversationHistory.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    CONVERSATION_STATUSES,
    groupConversationsByContact,
    relativeContactDate,
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
    /** Cross-space lenses resolve the dossier from each conversation's workspace. */
    personHref?: (item: ConversationItem) => string | null;
    /** The global lens may switch between operational rows and the contact book. */
    groupable?: boolean;
    /** The global lens points an empty book at the existing import path. */
    importEmptyState?: boolean;
  }

  let {
    filters,
    personBase,
    personHref,
    groupable = false,
    importEmptyState = false,
  }: Props = $props();

  type ConversationsResponse = {
    total: number;
    limit: number;
    offset: number;
    items: ConversationItem[];
  };

  // Only the compact phone card speaks through the dictionary for now; the
  // rest of this table is still English-only.
  const locale = detectLocale(navigator.language);

  const LIMIT = 50;
  const VIEW_STORAGE_KEY = 'hour:conversations:view';
  type ConversationView = 'conversation' | 'contact';

  let offset = $state(0);
  let view = $state<ConversationView>('conversation');
  let focusedConversationId = $state<string | null>(null);

  onMount(() => {
    if (!groupable) return;
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === 'conversation' || saved === 'contact') view = saved;
  });

  function setView(next: ConversationView) {
    view = next;
    focusedConversationId = null;
    if (groupable) localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  function focusConversation(id: string) {
    view = 'conversation';
    focusedConversationId = id;
    localStorage.setItem(VIEW_STORAGE_KEY, 'conversation');
  }

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
      const optimisticNow = new Date().toISOString();
      for (const [key, data] of pages) {
        if (!data) continue;
        queryClient.setQueryData<ConversationsResponse>(key, {
          ...data,
          items: data.items.map((it) => {
            if (it.id !== id) return it;
            const touched = patch.status !== undefined && patch.status !== it.status;
            return {
              ...it,
              ...patch,
              ...(touched
                ? {
                    last_contacted_at: optimisticNow,
                    first_contacted_at: it.first_contacted_at ?? optimisticNow,
                  }
                : {}),
            };
          }),
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

  // ── History (ADR-098): the timeline and its quick add ──────────────────
  // A contact is an event now; recording one moves the last contact on the
  // server, so the row repaints from the invalidated list, not optimistically.
  let historyOpen = $state(false);
  let historyFor = $state<ConversationItem | null>(null);

  function openHistory(item: ConversationItem) {
    historyFor = item;
    historyOpen = true;
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
  let visibleItems = $derived(
    focusedConversationId
      ? items.filter((item) => item.id === focusedConversationId)
      : items,
  );
  let contactGroups = $derived(groupConversationsByContact(items));
  let loading = $derived($query.isLoading);
  // Busy also while a placeholder (the previous page of rows) stands in for
  // the slice being fetched: what is on screen is not yet the answer.
  let busy = $derived(loading || ($query.isPlaceholderData && $query.isFetching));
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return dayMonth(iso);
  }

  function contactTitle(iso: string | null): string | undefined {
    return iso ? dayMonthYear(iso) : undefined;
  }

  function locationOf(item: ConversationItem): string {
    if (!item.person) return '—';
    return [item.person.city, item.person.country].filter(Boolean).join(', ') || '—';
  }

  function personPath(item: ConversationItem): string | null {
    if (!item.person?.slug) return null;
    return personHref?.(item) ?? (personBase ? `${personBase}/${item.person.slug}` : null);
  }

  let showPagination = $derived(total > LIMIT);
  let rangeEnd = $derived(Math.min(offset + LIMIT, total));
</script>

<div class="status-bar">
  <div class="status-bar__summary">
    {#if loading}
      <span>Loading...</span>
    {:else if !errorMsg}
      <span class="status-bar__count">{total} conversations</span>
      {#if total > 0}
        <span>Showing {offset + 1}-{rangeEnd}</span>
      {/if}
      {#if focusedConversationId}
        <button
          type="button"
          class="status-bar__clear"
          onclick={() => (focusedConversationId = null)}
        >Show all loaded</button>
      {/if}
    {/if}
  </div>
  {#if groupable}
    <div class="view-toggle" role="group" aria-label="Group conversations">
      <button
        type="button"
        class:view-toggle__active={view === 'conversation'}
        aria-pressed={view === 'conversation'}
        onclick={() => setView('conversation')}
      >By conversation</button>
      <button
        type="button"
        class:view-toggle__active={view === 'contact'}
        aria-pressed={view === 'contact'}
        onclick={() => setView('contact')}
      >By contact</button>
    </div>
  {/if}
</div>

<div class="table-wrap" aria-busy={busy}>
  {#if view === 'contact' && groupable}
    <table class="contact-table">
      <thead>
        <tr>
          <th>Contact</th>
          <th>Organization</th>
          <th>Location</th>
          <th>Conversations</th>
          <th>Last contact</th>
        </tr>
      </thead>
      <tbody>
        {#each contactGroups as group (group.key)}
          {@const representative = group.conversations[0]}
          {@const path = personPath(representative)}
          <tr>
            <td class="cell--name" data-label="Contact">
              {#if path && group.person}
                <a class="cell--name-link" href={path}>{group.person.full_name}</a>
              {:else}
                {group.person?.full_name ?? '—'}
              {/if}
            </td>
            <td
              class="cell--muted"
              data-label="Organization"
              data-empty={!group.person?.organization_name || undefined}
            >
              {group.person?.organization_name ?? '—'}
            </td>
            <td
              class="cell--meta"
              data-label="Location"
              data-empty={locationOf(representative) === '—' || undefined}>{locationOf(representative)}</td
            >
            <td class="contact-projects" data-label="Conversations">
              {#each group.conversations as conversation (conversation.id)}
                <button
                  type="button"
                  class={`project-chip ${statusBadgeClass(conversation.status)}`}
                  title={`${conversation.project?.name ?? 'Conversation'} · ${statusLabel(conversation.status)}`}
                  onclick={() => focusConversation(conversation.id)}
                >{conversation.project?.name ?? 'Conversation'}</button>
              {/each}
            </td>
            <td class="last-contact" data-label="Last contact" data-short={t('conversations.card_last', locale)}>
              <time
                datetime={group.last_contacted_at ?? undefined}
                title={contactTitle(group.last_contacted_at)}
              >{relativeContactDate(group.last_contacted_at)}</time>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <table class="conversation-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Organization</th>
          <th>Location</th>
          <th>Status</th>
          <th>Last contact</th>
          <th>Next action</th>
        </tr>
      </thead>
      <tbody>
        {#each visibleItems as item, i (item.id)}
          {@const path = personPath(item)}
          <tr>
            <td class="cell--name" data-label="Name">
              {#if path && item.person}
                <a class="cell--name-link" href={path}>
                  {item.person.full_name}
                </a>
              {:else}
                {item.person?.full_name ?? '—'}
              {/if}
            </td>
            <td
              class="cell--muted"
              data-label="Organization"
              data-empty={!item.person?.organization_name || undefined}
            >
              {item.person?.organization_name ?? '—'}
            </td>
            <td class="cell--meta" data-label="Location" data-empty={locationOf(item) === '—' || undefined}
              >{locationOf(item)}</td
            >
            <td class="cell--status" data-label="Status">
              <Menu
                label="Change status or log contact"
                triggerClass={statusBadgeClass(item.status)}
                direction={i >= visibleItems.length - 2 && i > 2 ? 'up' : 'down'}
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
                  <li class="menu-separator" role="separator"></li>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="menu__item"
                      onclick={() => {
                        close();
                        openHistory(item);
                      }}
                    >Log contact…</button>
                  </li>
                {/snippet}
              </Menu>
            </td>
            <td class="last-contact" data-label="Last contact" data-short={t('conversations.card_last', locale)}>
              <button
                type="button"
                class="last-contact__open"
                onclick={() => openHistory(item)}
                title={contactTitle(item.last_contacted_at) ?? 'History'}
                aria-label={`History · last contact ${relativeContactDate(item.last_contacted_at)}`}
              >
                <time datetime={item.last_contacted_at ?? undefined}
                  >{relativeContactDate(item.last_contacted_at)}</time
                >
              </button>
            </td>
            <td class="cell--next" data-label="Next action" data-short={t('conversations.card_next', locale)}>
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
  {/if}
</div>

{#if errorMsg}
  <div class="msg msg--error">{errorMsg}</div>
{:else if !loading && items.length === 0}
  {#if importEmptyState && !filters.q && (!filters.status || filters.status === 'any')}
    <div class="empty-book">
      <p class="empty-book__title">Bring your book.</p>
      <p>Import the spreadsheet you already use, then keep each relationship here.</p>
    </div>
  {:else}
    <div class="msg">No conversations match these filters.</div>
  {/if}
{/if}

{#if view === 'contact' && showPagination}
  <p class="grouping-note">
    Grouping this loaded page ({items.length} of {total}). A contact may continue on another page.
  </p>
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

<Dialog bind:open={historyOpen} title="History" size="m" onclose={() => (historyFor = null)}>
  {#if historyFor}
    <p class="next-action-who">
      {historyFor.person?.full_name ?? 'Conversation'}{historyFor.person?.organization_name
        ? ` — ${historyFor.person.organization_name}`
        : ''}
    </p>
    {#key historyFor.id}
      <ConversationHistory conversationId={historyFor.id} />
    {/key}
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (historyOpen = false)}>Close</Button>
  {/snippet}
</Dialog>

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
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
      padding-block: var(--space-s);
      border-block-end: var(--divider);
      font-size: var(--text-s);
      color: var(--text-dark-muted);
      flex-wrap: wrap;
    }
    .status-bar__summary {
      display: flex;
      align-items: baseline;
      gap: var(--space-m);
      flex-wrap: wrap;
    }
    .status-bar__count {
      color: var(--heading-color);
      font-weight: 500;
    }
    .status-bar__clear {
      color: var(--text-muted);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }

    .view-toggle {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .view-toggle button {
      border-block-end: 1.5px solid transparent;
      padding: 0;
      color: var(--text-faint);
      font-size: var(--text-s);
      line-height: 1.3;
      white-space: nowrap;
      transition: color var(--transition);
    }
    .view-toggle button:hover {
      color: var(--text-muted);
    }
    .view-toggle button.view-toggle__active {
      border-block-end-color: var(--text-color);
      color: var(--text-color);
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

    .empty-book {
      padding-block: clamp(var(--space-xl), 8vw, var(--space-3xl));
      padding-inline: var(--space-m);
      text-align: center;
      border-block-end: var(--divider);
      color: var(--text-muted);
    }
    .empty-book__title {
      margin-block-end: var(--space-xs);
      font-family: var(--font-serif);
      font-size: var(--text-xl);
      color: var(--heading-color);
    }

    .grouping-note {
      padding-block-start: var(--space-xs);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
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

    .last-contact {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }

    .last-contact__open {
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      text-align: start;
    }
    .last-contact__open:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }

    .contact-projects {
      display: flex;
      align-items: center;
      gap: var(--space-2xs);
      flex-wrap: wrap;
      white-space: normal;
    }
    .project-chip {
      --badge-padding-block: 0.2rem;
      --badge-padding-inline: var(--space-xs);
      cursor: pointer;
      max-inline-size: 12rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .project-chip:hover {
      filter: brightness(0.97);
    }

    .menu-separator {
      block-size: 1px;
      margin-block: var(--space-2xs);
      background: var(--border-color);
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

    @media (max-width: 46rem) {
      .status-bar {
        align-items: flex-start;
      }
      .status-bar__summary {
        gap: var(--space-xs) var(--space-s);
      }
      .view-toggle {
        inline-size: 100%;
      }

      .table-wrap {
        overflow: visible;
      }
      table,
      tbody,
      tr,
      td {
        display: block;
        inline-size: 100%;
      }
      thead {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      tbody {
        display: grid;
        gap: var(--space-s);
        padding-block: var(--space-s);
      }
      tbody tr {
        padding: var(--space-s);
        border: var(--border);
        border-radius: var(--radius-s);
        background: var(--bg-light);
      }
      tbody tr:hover td {
        background: transparent;
      }
      tbody td {
        display: grid;
        grid-template-columns: minmax(6.5rem, 0.42fr) minmax(0, 1fr);
        align-items: baseline;
        gap: var(--space-s);
        max-inline-size: none;
        padding-block: var(--space-xs);
        padding-inline: 0;
        border: 0;
        white-space: normal;
      }
      tbody td::before {
        content: attr(data-label);
        color: var(--text-faint);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        font-weight: 400;
        letter-spacing: var(--mono-letter-spacing-loose);
        text-transform: uppercase;
      }
      .contact-projects {
        display: grid;
        grid-template-columns: minmax(6.5rem, 0.42fr) minmax(0, 1fr);
      }
      .contact-projects::before {
        align-self: baseline;
      }
      .project-chip {
        grid-column: 2;
        justify-self: start;
        max-inline-size: 100%;
      }
      .contact-projects .project-chip + .project-chip {
        margin-block-start: var(--space-2xs);
      }
      .next-action {
        min-inline-size: 0;
      }

      /* THE CONVERSATION CARD, compact (Marco, 2026-10-10: Anouk works the
         difusión from here). The same cells as the desktop row, only placed
         differently: no markup of its own, so nothing can drift from the
         table. Labels go wherever the datum explains itself:

           Name ……………………………………… [Status ▾]
           Organization · City
           LAST 3 d ago        NEXT 12 Oct · note

         The status keeps its pill and its menu (with «Log contact…»); last
         contact keeps its button to the history; next action its button. */
      /* A flex line per row of the card, broken by the row's own two
         pseudo-elements: a grid would line the organization up with the
         date below it and open a hole in «Organization · City». Margins,
         not a row gap, so a line with nothing on it costs nothing. */
      :is(.conversation-table, .contact-table) tbody tr {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: var(--space-s);
      }
      :is(.conversation-table, .contact-table) tbody tr::before,
      :is(.conversation-table, .contact-table) tbody tr::after {
        content: '';
        flex-basis: 100%;
      }
      :is(.conversation-table, .contact-table) tbody tr::before {
        order: 2;
      }
      :is(.conversation-table, .contact-table) tbody tr::after {
        order: 4;
      }
      :is(.conversation-table, .contact-table) tbody td {
        display: block;
        inline-size: auto;
        padding-block: 0;
      }
      :is(.conversation-table, .contact-table) tbody td::before {
        content: none;
      }
      :is(.conversation-table, .contact-table) .cell--name {
        order: 1;
        flex: 1 1 0;
        min-inline-size: 0;
        align-self: center;
      }
      /* The status menu opens out of this cell, so it must not clip. */
      .conversation-table .cell--status {
        order: 1;
        align-self: center;
        overflow: visible;
      }
      /* …and the pill sits at the card's end, so its menu opens toward the
         start (Menu's own `.menu--end` placement) instead of off the screen. */
      .conversation-table .cell--status :global(.menu) {
        inset-inline: auto 0;
      }
      :is(.conversation-table, .contact-table) .cell--muted,
      :is(.conversation-table, .contact-table) .cell--meta {
        order: 3;
        margin-block-start: var(--space-2xs);
        font-size: var(--text-s);
      }
      /* «Organization · City», and neither shouts a dash when empty: a
         missing datum is simply not on the line. */
      /* The dot takes the gap's place: the cell pulls back by the difference
         (the cell clips its overflow, so the dot cannot hang outside it). */
      :is(.conversation-table, .contact-table) .cell--muted:not([data-empty]) + .cell--meta:not([data-empty]) {
        margin-inline-start: calc(var(--space-xs) - var(--space-s));
      }
      :is(.conversation-table, .contact-table) .cell--muted:not([data-empty]) + .cell--meta:not([data-empty])::before {
        content: '·';
        margin-inline-end: var(--space-xs);
        color: var(--text-faint);
      }
      :is(.conversation-table, .contact-table) [data-empty] {
        display: none;
      }
      :is(.conversation-table, .contact-table) .last-contact,
      :is(.conversation-table, .contact-table) .cell--next {
        order: 5;
        margin-block-start: var(--space-xs);
      }
      :is(.conversation-table, .contact-table) .cell--next {
        flex: 1 1 0;
        min-inline-size: 0;
      }
      /* «By contact» (Marco, 2026-10-10): the same card, the project chips
         taking the status's line role on the last line, before the date. */
      .contact-table .contact-projects {
        order: 5;
        display: flex;
        flex: 1 1 0;
        flex-wrap: wrap;
        gap: var(--space-2xs);
        min-inline-size: 0;
        margin-block-start: var(--space-xs);
      }
      .contact-table .contact-projects .project-chip {
        margin: 0;
      }
      /* The two dates are the only data that do NOT explain themselves: «3 d
         ago» could be either. They keep a micro-label, short, inline, in the
         margin voice the old card used for every field. */
      :is(.conversation-table, .contact-table) .last-contact::before,
      :is(.conversation-table, .contact-table) .cell--next::before {
        content: attr(data-short);
        margin-inline-end: var(--space-xs);
        color: var(--text-faint);
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        letter-spacing: var(--mono-letter-spacing-loose);
        text-transform: uppercase;
      }
      /* Date and note on the one line, the note giving way first. */
      :is(.conversation-table, .contact-table) .cell--next {
        display: flex;
        align-items: baseline;
      }
      .conversation-table .cell--next .next-action {
        flex-direction: row;
        align-items: baseline;
        gap: var(--space-xs);
        min-inline-size: 0;
      }
      .conversation-table .cell--next .next-action__note {
        min-inline-size: 0;
      }
    }
  }
</style>
