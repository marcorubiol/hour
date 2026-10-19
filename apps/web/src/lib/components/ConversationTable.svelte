<script module lang="ts">
  import StateBadge from '$lib/components/StateBadge.svelte';
  import type { MailoutPick, TempFilter } from '$lib/conversation-overview';

  export interface ConversationFilters {
    projectSlug?: string;
    projectIds?: string[];
    lineId?: string;
    workspaceIds?: string[];
    season?: string;
    q?: string;
    status?: string;
    /** The dashboard's derived filters (ADR-117): global lens only. */
    turno?: 'nuestro' | 'suyo';
    temp?: TempFilter;
    /** Only the current season; `lineIds` (pinned lines) narrow it. */
    temporada?: boolean;
    lineIds?: string[];
    /** One line of the season (ADR-135): its id, or `sin`. */
    linea?: string;
    /** A mailout's figure as a filter (ADR-126 § 9). */
    envio?: string;
    r?: MailoutPick;
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
  import ConversationStatusMenu from '$lib/components/ConversationStatusMenu.svelte';
  import NextActionDialog from '$lib/components/NextActionDialog.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { followUpDue, turnOf } from '$lib/conversation-overview';
  import {
    groupConversationsByContact,
    relativeContactDate,
    statusBadgeClass,
    statusTone,
    statusLabel,
    conversationTitle,
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
    /** The conversation file; without it, derived from the person path (ADR-102: a conversation may have no person). */
    conversationHref?: (item: ConversationItem) => string | null;
    /** The global lens may switch between operational rows and the contact book. */
    groupable?: boolean;
    /** The global lens points an empty book at the existing import path. */
    importEmptyState?: boolean;
    /** Selection mode (plan § 10, «Escribir a N»): a checkbox per row. */
    selectable?: boolean;
    /** The picked conversations, across pages and filters. */
    selected?: Pick<ConversationItem, 'id' | 'project_id'>[];
    /** Whose turn it is, from the last directional event (ADR-117). */
    turnColumn?: boolean;
    /**
     * Whether the status menu is offered (ADR-124, `permisos.md` § 8). The
     * caller passes `edit:conversation` in some project; the PATCH still
     * decides per project.
     */
    editable?: boolean;
  }

  let {
    filters,
    personBase,
    personHref,
    conversationHref,
    groupable = false,
    importEmptyState = false,
    selectable = false,
    selected = $bindable([]),
    turnColumn = false,
    editable = true,
  }: Props = $props();

  type ConversationsResponse = {
    total: number;
    limit: number;
    offset: number;
    items: ConversationItem[];
  };

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
    if (f.turno) p.set('turno', f.turno);
    if (f.temp) p.set('temp', f.temp);
    if (f.envio && f.r) {
      p.set('envio', f.envio);
      p.set('r', f.r);
    }
    if (f.temporada) {
      p.set('temporada', 'actual');
      if (f.lineIds && f.lineIds.length > 0) p.set('line_ids', f.lineIds.join(','));
      if (f.linea) p.set('linea', f.linea);
    }
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
      if (!body?.item) throw new Error(t('conversations.unexpected_response', locale));
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
        title: t('conversations.change_not_saved', locale),
        message: t('perf.try_again', locale, {
          error: err instanceof Error ? err.message : t('perf.unexpected', locale),
        }),
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
      void queryClient.invalidateQueries({ queryKey: ['conversation-overview'] });
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

  function openNextAction(item: ConversationItem) {
    editing = item;
    dialogOpen = true;
  }

  function saveNextAction(patch: Pick<ConversationPatch, 'next_action_at' | 'next_action_note'>) {
    if (!editing) return;
    $patchMutation.mutate({ id: editing.id, patch });
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
    if (!item.person) return item.organization?.city || '—';
    return [item.person.city, item.person.country].filter(Boolean).join(', ') || '—';
  }

  /** ADR-102: who the conversation is with; before the organization, the dossier's. */
  function organizationOf(item: ConversationItem): string | null {
    return item.organization?.name ?? item.person?.organization_name ?? null;
  }

  /** The line of the dialogs: the organization, and the primary contact when there is one. */
  function whoLine(item: ConversationItem): string {
    const title = conversationTitle(item) || t('conversations.conversation', locale);
    const person = item.person?.full_name;
    return person && person !== title ? `${title} · ${person}` : title;
  }

  function personPath(item: ConversationItem): string | null {
    if (!item.person?.slug) return null;
    return personHref?.(item) ?? (personBase ? `${personBase}/${item.person.slug}` : null);
  }

  /** La ficha vive en el mismo espacio que el dossier: /h/<ws>/conversation/<id>. */
  function conversationPath(item: ConversationItem): string | null {
    const direct = conversationHref?.(item);
    if (direct) return direct;
    const person = personPath(item);
    return person ? person.replace(/\/person\/[^/]+$/, `/conversation/${item.id}`) : null;
  }

  // ── Selection (envío en bloque) ───────────────────────────────────────
  let selectedIds = $derived(new Set(selected.map((s) => s.id)));
  let pagePicked = $derived(visibleItems.filter((i) => selectedIds.has(i.id)).length);
  let showContacts = $derived(view === 'contact' && groupable && !selectable);

  function togglePick(item: ConversationItem) {
    selected = selectedIds.has(item.id) ? selected.filter((s) => s.id !== item.id) : [...selected, item];
  }

  /** Pick (or unpick) the visible page; the selection bar offers it on a phone. */
  export function togglePage() {
    const page = new Set(visibleItems.map((i) => i.id));
    selected =
      pagePicked === visibleItems.length
        ? selected.filter((s) => !page.has(s.id))
        : [...selected, ...visibleItems.filter((i) => !selectedIds.has(i.id))];
  }

  /** The Turn cell: a reply owed, a follow-up due, or their turn (ADR-117). */
  function turnCell(item: ConversationItem): { tone: 'ours' | 'theirs'; text: string } | null {
    const now = new Date();
    const turn = turnOf({ status: item.status, last: item.last_turn?.[0] ?? null, reply_settled_at: item.reply_settled_at }, now);
    if (turn?.side === 'ours') {
      return { tone: 'ours', text: `${t('overview.turn_ours_cap', locale)} · ${relativeContactDate(turn.since, locale)}` };
    }
    if (followUpDue(item, now)) {
      return { tone: 'ours', text: `${t('overview.follow_up_cap', locale)} · ${formatDate(item.next_action_at)}` };
    }
    if (turn) return { tone: 'theirs', text: `${t('overview.turn_theirs_cap', locale)} · ${relativeContactDate(turn.since, locale)}` };
    return null;
  }

  let showPagination = $derived(total > LIMIT);
  let rangeEnd = $derived(Math.min(offset + LIMIT, total));
</script>

<div class="status-bar">
  <div class="status-bar__summary">
    {#if loading}
      <span>{t('conversations.loading', locale)}</span>
    {:else if !errorMsg}
      <span class="status-bar__count"
        >{t(total === 1 ? 'conversations.count_one' : 'conversations.count_other', locale, { n: total })}</span
      >
      {#if total > 0}
        <span>{t('conversations.showing', locale, { from: offset + 1, to: rangeEnd })}</span>
      {/if}
      {#if focusedConversationId}
        <button
          type="button"
          class="status-bar__clear"
          onclick={() => (focusedConversationId = null)}
        >{t('conversations.show_all_loaded', locale)}</button>
      {/if}
    {/if}
  </div>
  {#if groupable && !selectable}
    <div class="view-toggle" role="group" aria-label={t('conversations.group_aria', locale)}>
      <button
        type="button"
        class:view-toggle__active={view === 'conversation'}
        aria-pressed={view === 'conversation'}
        onclick={() => setView('conversation')}
      >{t('conversations.by_conversation', locale)}</button>
      <button
        type="button"
        class:view-toggle__active={view === 'contact'}
        aria-pressed={view === 'contact'}
        onclick={() => setView('contact')}
      >{t('conversations.by_contact', locale)}</button>
    </div>
  {/if}
</div>

<div class="table-wrap" aria-busy={busy}>
  {#if showContacts}
    <table class="contact-table">
      <thead>
        <tr>
          <th>{t('conversations.col_contact', locale)}</th>
          <th>{t('conversations.col_organization', locale)}</th>
          <th>{t('conversations.col_location', locale)}</th>
          <th>{t('lens.conversations', locale)}</th>
          <th>{t('conversations.col_last_contact', locale)}</th>
        </tr>
      </thead>
      <tbody>
        {#each contactGroups as group (group.key)}
          {@const representative = group.conversations[0]}
          {@const path = personPath(representative)}
          <tr>
            <td class="cell--name" data-label={t('conversations.col_contact', locale)}>
              {#if path && group.person}
                <a class="cell--name-link" href={path}>{group.person.full_name}</a>
              {:else}
                {group.person?.full_name ?? '—'}
              {/if}
            </td>
            <td
              class="cell--muted"
              data-label={t('conversations.col_organization', locale)}
              data-empty={!organizationOf(representative) || undefined}
            >
              {organizationOf(representative) ?? '—'}
            </td>
            <td
              class="cell--meta"
              data-label={t('conversations.col_location', locale)}
              data-empty={locationOf(representative) === '—' || undefined}>{locationOf(representative)}</td
            >
            <td class="contact-projects" data-label={t('lens.conversations', locale)}>
              {#each group.conversations as conversation (conversation.id)}
                <button
                  type="button"
                  class={`project-chip ${statusBadgeClass(conversation.status)}`}
                  title={`${conversation.project?.name ?? t('conversations.conversation', locale)} · ${statusLabel(conversation.status, locale)}`}
                  onclick={() => focusConversation(conversation.id)}
                >{conversation.project?.name ?? t('conversations.conversation', locale)}</button>
              {/each}
            </td>
            <td class="last-contact" data-label={t('conversations.col_last_contact', locale)} data-short={t('conversations.card_last', locale)}>
              <time
                datetime={group.last_contacted_at ?? undefined}
                title={contactTitle(group.last_contacted_at)}
              >{relativeContactDate(group.last_contacted_at, locale)}</time>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <table class="conversation-table" class:conversation-table--picking={selectable}>
      <thead>
        <tr>
          {#if selectable}
            <th class="cell--pick">
              <input
                type="checkbox"
                class="pick"
                checked={visibleItems.length > 0 && pagePicked === visibleItems.length}
                indeterminate={pagePicked > 0 && pagePicked < visibleItems.length}
                aria-label={t('mailout.pick_page', locale)}
                onchange={togglePage}
              />
            </th>
          {/if}
          <th>{t('conversations.col_organization', locale)}</th>
          <th>{t('conversations.col_contact', locale)}</th>
          <th>{t('conversations.col_location', locale)}</th>
          <th>{t('edit.status', locale)}</th>
          {#if turnColumn}<th>{t('overview.col_turn', locale)}</th>{/if}
          <th>{t('conversations.col_last_contact', locale)}</th>
          <th>{t('conversations.col_next_action', locale)}</th>
        </tr>
      </thead>
      <tbody>
        {#each visibleItems as item, i (item.id)}
          {@const path = personPath(item)}
          {@const file = conversationPath(item)}
          <tr class:is-picked={selectable && selectedIds.has(item.id)}>
            {#if selectable}
              <td class="cell--pick">
                <!-- On a phone the label covers the whole card: a tap anywhere picks it (móvil #2). -->
                <label class="pick-label">
                  <input
                    type="checkbox"
                    class="pick"
                    checked={selectedIds.has(item.id)}
                    aria-label={t('mailout.pick_one', locale, { name: organizationOf(item) ?? item.person?.full_name ?? '' })}
                    onchange={() => togglePick(item)}
                  />
                </label>
              </td>
            {/if}
            <!-- ADR-102: the conversation is with the organization; it titles the row and opens the file. -->
            <td class="cell--name" data-label={t('conversations.col_organization', locale)}>
              {#if file && organizationOf(item)}
                <a class="cell--name-link" href={file}>{organizationOf(item)}</a>
              {:else}
                {organizationOf(item) ?? '—'}
              {/if}
            </td>
            <td
              class="cell--muted"
              data-label={t('conversations.col_contact', locale)}
              data-empty={!item.person || undefined}
            >
              {#if path && item.person}
                <a class="cell--name-link" href={path}>{item.person.full_name}</a>
              {:else if item.person}
                {item.person.full_name}
              {/if}
            </td>
            <td class="cell--meta" data-label={t('conversations.col_location', locale)} data-empty={locationOf(item) === '—' || undefined}
              >{locationOf(item)}</td
            >
            <td class="cell--status" data-label={t('edit.status', locale)}>
              {#if !editable}
                <StateBadge label={statusLabel(item.status, locale)} tone={statusTone(item.status)} />
              {:else}
              <ConversationStatusMenu
                status={item.status}
                {locale}
                direction={i >= visibleItems.length - 2 && i > 2 ? 'up' : 'down'}
                onchange={(next) => changeStatus(item, next)}
                onlog={() => openHistory(item)}
              />
              {/if}
            </td>
            {#if turnColumn}
              {@const turn = turnCell(item)}
              <td class="cell--turn" data-label={t('overview.col_turn', locale)} data-empty={!turn || undefined}>
                {#if turn}<span class="turn turn--{turn.tone}">{turn.text}</span>{/if}
              </td>
            {/if}
            <td class="last-contact" data-label={t('conversations.col_last_contact', locale)} data-short={t('conversations.card_last', locale)}>
              <button
                type="button"
                class="last-contact__open"
                onclick={() => openHistory(item)}
                title={contactTitle(item.last_contacted_at) ?? t('conversations.history', locale)}
                aria-label={t('conversations.history_aria', locale, {
                  when: relativeContactDate(item.last_contacted_at, locale),
                })}
              >
                <time datetime={item.last_contacted_at ?? undefined}
                  >{relativeContactDate(item.last_contacted_at, locale)}</time
                >
              </button>
            </td>
            <td class="cell--next" data-label={t('conversations.col_next_action', locale)} data-short={t('conversations.card_next', locale)}>
              <button
                type="button"
                class="next-action"
                onclick={() => openNextAction(item)}
                title={item.next_action_note ?? t('conversations.set_next_action', locale)}
                aria-label={item.next_action_at || item.next_action_note ? undefined : t('conversations.set_next_action', locale)}
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
  <!-- Our sentence, not the server's text (diseño M2); the detail stays in Sentry. -->
  <p class="load-fail" role="alert">
    <span>{t('conversations.load_error', locale)}</span>
    <Button size="xs" variant="outline" onclick={() => void $query.refetch()}>{t('ui.retry', locale)}</Button>
  </p>
{:else if !loading && items.length === 0}
  {#if importEmptyState && !filters.q && !filters.turno && !filters.temp && !filters.temporada && !filters.envio && (!filters.status || filters.status === 'any')}
    <div class="empty-book">
      <p class="empty-book__title">{t('conversations.empty_title', locale)}</p>
      <p>{t('conversations.empty_body', locale)}</p>
    </div>
  {:else}
    <div class="msg">{t('conversations.no_match', locale)}</div>
  {/if}
{/if}

{#if showContacts && showPagination}
  <p class="grouping-note">
    {t('conversations.grouping_note', locale, { n: items.length, total })}
  </p>
{/if}

{#if showPagination}
  <div class="pagination">
    <button
      class="btn--outline btn--s"
      onclick={() => (offset = Math.max(0, offset - LIMIT))}
      disabled={offset === 0}
    >
      {t('conversations.prev_page', locale)}
    </button>
    <button
      class="btn--outline btn--s"
      onclick={() => (offset = offset + LIMIT)}
      disabled={offset + LIMIT >= total}
    >
      {t('conversations.next_page', locale)}
    </button>
  </div>
{/if}

<Dialog bind:open={historyOpen} title={t('conversations.history', locale)} size="m" onclose={() => (historyFor = null)}>
  {#if historyFor}
    <p class="next-action-who">
      {whoLine(historyFor)}
    </p>
    {@const fullPath = conversationPath(historyFor)}
    {#if fullPath}
      <p><a class="link-arrow" href={fullPath}>{t('conversations.open_full', locale)}</a></p>
    {/if}
    {#key historyFor.id}
      <ConversationHistory conversationId={historyFor.id} />
    {/key}
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (historyOpen = false)}>{t('conversations.close', locale)}</Button>
  {/snippet}
</Dialog>

<NextActionDialog
  bind:open={dialogOpen}
  who={editing ? whoLine(editing) : ''}
  date={editing?.next_action_at ? editing.next_action_at.slice(0, 10) : ''}
  note={editing?.next_action_note ?? ''}
  {locale}
  onsave={saveNextAction}
  onclose={() => (editing = null)}
/>

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
    .empty-book {
      padding-block: clamp(var(--space-xl), 8vw, var(--space-3xl));
      padding-inline: var(--space-m);
      text-align: center;
      border-block-end: var(--divider);
      color: var(--text-muted);
    }
    /* The display italic of the lens titles (`--font-serif` does not exist,
       so this fell back to a big sans, diseño B10). */
    .empty-book__title {
      margin-block-end: var(--space-xs);
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-xl);
      color: var(--heading-color);
    }
    .empty-book p {
      margin-block-start: 0;
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

    /* Turno (ADR-117): lo que te toca en tinta, lo suyo en voz baja. */
    .turn {
      font-size: var(--text-xs);
      white-space: nowrap;
    }
    .turn--ours {
      color: var(--text-color);
      font-weight: 500;
    }
    .turn--theirs {
      color: var(--text-muted);
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

    .cell--pick {
      inline-size: 2rem;
      padding-inline-end: 0;
    }
    .pick {
      inline-size: 1rem;
      block-size: 1rem;
      accent-color: var(--text-color);
      cursor: pointer;
    }
    tbody tr.is-picked td {
      background: var(--bg-ultra-light);
    }
    @media (pointer: coarse) {
      .pick {
        inline-size: 1.5rem;
        block-size: 1.5rem;
      }
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
      white-space: nowrap;
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
      tbody tr:hover td,
      tbody tr.is-picked td {
        background: transparent;
      }
      tbody tr.is-picked {
        background: var(--bg-ultra-light);
        border-color: var(--border-color-dark);
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
      .conversation-table .cell--pick {
        order: 1;
        inline-size: auto;
        align-self: center;
      }
      /* Picking: the whole card is the checkbox's label. The page's own
         checkbox lives in the hidden header, so it leaves the tab order; the
         selection bar offers it instead. */
      .conversation-table--picking tbody tr {
        position: relative;
      }
      .conversation-table--picking .pick-label::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        cursor: pointer;
      }
      thead .pick {
        visibility: hidden;
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
      /* The turn closes the «Organization · City» line, on its own. */
      .conversation-table .cell--turn {
        order: 3;
        flex-basis: 100%;
        margin-block-start: var(--space-2xs);
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

    /* Touch: every control of a row or card reaches the finger's size, the
       empty «—» of the next step included (móvil #8). */
    @media (pointer: coarse) {
      .view-toggle button,
      .last-contact__open,
      .next-action {
        min-block-size: var(--touch-target);
      }
      .next-action {
        min-inline-size: var(--touch-target);
        justify-content: center;
      }
      .cell--name-link {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--touch-target);
      }
    }
  }
</style>
