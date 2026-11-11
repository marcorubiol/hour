<script module lang="ts">
  import type { MailoutPick, TempFilter } from '$lib/conversation-overview';
  import type { Relation } from '$lib/conversation-relation';
  import type { Orden } from '$lib/conversation-order';

  export interface ConversationFilters {
    projectIds?: string[];
    lineId?: string;
    /** One organization's conversations, across its projects (ADR-159). */
    organizationId?: string;
    workspaceIds?: string[];
    q?: string;
    /** One relation (ADR-138), derived like the dashboard's filters. */
    relacion?: Relation;
    /** The dashboard's derived filters (ADR-117): global lens only. */
    turno?: 'nuestro' | 'suyo';
    temp?: TempFilter;
    /** Only the current season; `lineIds` (pinned lines) narrow it. */
    temporada?: boolean;
    lineIds?: string[];
    /** One line (ADR-135): its id, or `sin`; with `temporada`, of the season. */
    linea?: string;
    /** A mailout's batch as a filter (ADR-126 § 9, plan de la lista § 5). */
    envio?: string;
    r?: MailoutPick;
    /** «Filtrar» by area and type (ADR-177): a city, a kind of organization or `solo`. */
    zona?: string;
    clase?: string;
    /** The lens chip's tag key (ADR-138, fase 2); untagged rows read as `sales`. */
    etiqueta?: string;
    /** The lens's order (plan de la lista § 4); a module leaves it out and gets the next step's. */
    orden?: Orden;
    /** Hold the query (e.g. while a sidebar selection hasn't resolved). */
    enabled?: boolean;
  }
</script>

<script lang="ts">
  /**
   * ConversationTable: the Conversations list (ADR-176, ADR-179), one ChatRow
   * per conversation, the same two-line row as the feed's, in the lens and in
   * a line's module (tarea 135). The row writes nothing inline: the relation,
   * the next step and the history are set in the conversation's page; from
   * the row, only «Ya está» (`ChatDone`), to whoever edits. The name stays:
   * it is the lens's list, no longer a `table`.
   */

  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ConversationsImportEmpty from '$lib/components/ConversationsImportEmpty.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { viewerTimeZone } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ChatRow from '$lib/components/ChatRow.svelte';
  import ChatDone from '$lib/components/ChatDone.svelte';
  import { chatWhen, chatWho } from '$lib/chat-row';
  import { relationInputOf, type ConversationItem } from '$lib/conversation';
  import { lastActivity, relationLabel } from '$lib/conversation-relation';
  import { boloLabel, nearestBolo, rowLast, rowTurn } from '$lib/conversation-row';
  import { SALES, keyLabel, type WorkspaceTag } from '$lib/conversation-tags';

  interface Props {
    filters: ConversationFilters;
    /** e.g. `/h/muk-cia/person` — when set, names link to the person file. */
    personBase?: string;
    /** Cross-space lenses resolve the dossier from each conversation's workspace. */
    personHref?: (item: ConversationItem) => string | null;
    /** The conversation file; without it, derived from the person path (ADR-102: a conversation may have no person). */
    conversationHref?: (item: ConversationItem) => string | null;
    /** The global lens points an empty book at the existing import path. */
    importEmptyState?: boolean;
    /** Selection mode (plan § 10, «Escribir a N»): a checkbox per row. */
    selectable?: boolean;
    /** The picked conversations, across pages and filters. */
    selected?: Pick<ConversationItem, 'id' | 'project_id'>[];
    /**
     * Whether a row that needs a reply offers «Ya está» (ADR-124,
     * `permisos.md` § 8). The caller passes `edit:conversation` in some
     * project; the write still decides per project.
     */
    editable?: boolean;
    /** The tag vocabulary of the scope: when given, each row shows its tags (ADR-138). */
    tagNames?: readonly WorkspaceTag[];
    /** A tag the rows do not repeat: the active chip's. */
    hideTag?: string;
    /** The project's name, when the scope has several (the meta line says which). */
    projectName?: (id: string) => string | null;
    /** The line's name, when the scope has several. */
    lineName?: (id: string) => string | null;
    /** The row's title: the venue (the lists), or the project where the venue is the page (its record, ADR-159). */
    titleBy?: 'organization' | 'project';
    /** What the selection bar needs of the page: how many match, and whether the page is all picked. */
    onpage?: (page: { total: number; size: number; full: boolean }) => void;
    /** Esc in the list while picking: leave the selection (plan § 6.1). */
    onexit?: () => void;
    /** The host's head already says how many (a record's BlockHead): the
     *  bar does not say it again (ADR-167 § 2). */
    counted?: boolean;
    /** The conversation open beside the list (two panes). */
    activeId?: string | null;
    /** Open beside instead of navigating. */
    onopen?: (item: ConversationItem, event: MouseEvent) => void;
    /** After a row's «Ya está» or its undo, the lists read again. */
    onchange?: () => void;
  }

  let {
    filters,
    personBase,
    personHref,
    conversationHref,
    importEmptyState = false,
    selectable = false,
    selected = $bindable([]),
    editable = true,
    tagNames,
    hideTag,
    projectName,
    lineName,
    titleBy = 'organization',
    onpage,
    onexit,
    counted = false,
    activeId = null,
    onopen,
    onchange,
  }: Props = $props();
  const tz = viewerTimeZone();

  /** The chat row's context line: the turn (ours in ink), the relation, the tag, the bolo, project and line. */
  function chatContext(r: RowView): { text: string; ink?: boolean }[] {
    const item = r.item;
    const out: { text: string; ink?: boolean }[] = [];
    // Under «Nos toca» the chip says the turn: the row does not repeat it.
    if (r.turn?.word) {
      if (filters.turno !== 'nuestro') out.push({ text: r.turn.word, ink: r.turn.tone === 'ours' || r.turn.tone === 'late' });
    } else if (r.last.last) out.push({ text: relationLabel(item.relation, locale) });
    const tag = (item.tags.length > 0 ? item.tags : [SALES]).find((k) => k !== hideTag);
    if (tag && tagNames && mixed.tag) out.push({ text: keyLabel(tag, tagNames, locale) });
    if (r.bolo) out.push({ text: boloLabel(r.bolo, locale) });
    const project = projectName && item.project_id && mixed.project ? projectName(item.project_id) : null;
    const line = lineName && item.line_id && mixed.line ? lineName(item.line_id) : null;
    for (const x of [project, line]) if (x) out.push({ text: x });
    return out;
  }

  type ConversationsResponse = {
    total: number;
    limit: number;
    offset: number;
    items: ConversationItem[];
  };

  const locale = appLocale();

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
    if (f.relacion) p.set('relacion', f.relacion);
    if (f.etiqueta) p.set('etiqueta', f.etiqueta);
    if (f.orden) p.set('orden', f.orden);
    if (f.projectIds && f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.lineId) p.set('line_id', f.lineId);
    if (f.organizationId) p.set('organization_id', f.organizationId);
    if (f.workspaceIds && f.workspaceIds.length > 0)
      p.set('workspace_ids', f.workspaceIds.join(','));
    if (f.q) p.set('q', f.q);
    if (f.turno) p.set('turno', f.turno);
    if (f.temp) p.set('temp', f.temp);
    if (f.envio) {
      p.set('envio', f.envio);
      if (f.r) p.set('r', f.r);
    }
    if (f.linea) p.set('linea', f.linea);
    if (f.zona) p.set('zona', f.zona);
    if (f.clase) p.set('clase', f.clase);
    if (f.temporada) {
      p.set('temporada', 'actual');
      if (f.lineIds && f.lineIds.length > 0) p.set('line_ids', f.lineIds.join(','));
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
  let total = $derived($query.data?.total ?? 0);
  let items = $derived(($query.data?.items ?? []) as ConversationItem[]);
  let loading = $derived($query.isLoading);
  // Busy also while a placeholder (the previous page of rows) stands in for
  // the slice being fetched: what is on screen is not yet the answer.
  let busy = $derived(loading || ($query.isPlaceholderData && $query.isFetching));
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  /** ADR-102: who the conversation is with; before the organization, the dossier's. */
  function organizationOf(item: ConversationItem): string | null {
    return item.organization?.name ?? item.person?.organization_name ?? null;
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

  // ── What a row shows (plan § 3) ────────────────────────────────────────
  const now = new Date();

  type RowView = {
    item: ConversationItem;
    title: string;
    turn: ReturnType<typeof rowTurn>;
    bolo: ReturnType<typeof nearestBolo>;
    last: ReturnType<typeof rowLast>;
    lastAt: string | null;
  };

  function rowView(item: ConversationItem): RowView {
    const relation = relationInputOf(item);
    const byProject = titleBy === 'project' && item.project?.name;
    const title = (byProject ? item.project!.name : organizationOf(item)) ?? item.person?.full_name ?? '—';
    return {
      item,
      title,
      turn: rowTurn({ ...relation, reply_settled_at: item.reply_settled_at, next_action_at: item.next_action_at }, now, locale),
      bolo: item.bolos ? nearestBolo(item.bolos, now) : null,
      last: rowLast({ last: relation.last ? (item.last_turn?.[0] ?? null) : null, last_in: relation.last_in, last_mailout: item.last_mailout }, locale),
      lastAt: lastActivity(relation),
    };
  }

  let rows = $derived(items.map(rowView));
  /**
   * What the chat row names only when the page mixes it (diseño 2026-11-05):
   * a tag, project or line every row shares is the list's, not the row's.
   */
  let mixed = $derived({
    tag: new Set(items.map((i) => (i.tags.length > 0 ? i.tags : [SALES]).find((k) => k !== hideTag) ?? '')).size > 1 || Boolean(filters.q),
    project: new Set(items.map((i) => i.project_id)).size > 1,
    line: new Set(items.map((i) => i.line_id ?? '')).size > 1,
  });

  /** With whom, in words and shape (ADR-177 § 2 y § 3), as `conversation_feed` reads it. */
  function whoOf(item: ConversationItem) {
    return chatWho(item.place ?? { kind: item.organization?.kind, city: item.organization?.city || item.person?.city || null }, locale);
  }

  // ── Selection (envío en bloque) ───────────────────────────────────────
  let selectedIds = $derived(new Set(selected.map((s) => s.id)));
  let pagePicked = $derived(items.filter((i) => selectedIds.has(i.id)).length);

  function togglePick(item: ConversationItem) {
    selected = selectedIds.has(item.id) ? selected.filter((s) => s.id !== item.id) : [...selected, item];
  }

  /** Pick (or unpick) the visible page; the selection bar offers it. */
  export function togglePage() {
    const page = new Set(items.map((i) => i.id));
    selected =
      pagePicked === items.length
        ? selected.filter((s) => !page.has(s.id))
        : [...selected, ...items.filter((i) => !selectedIds.has(i.id))];
  }

  $effect(() => {
    onpage?.({ total, size: items.length, full: items.length > 0 && pagePicked === items.length });
  });

  /**
   * «Seleccionar las N que coinciden» (plan § 6.2): the ids of the whole
   * filter, without reading the rows. The selection keeps ids, not the filter:
   * a filter changed afterwards does not widen it.
   */
  export async function pickMatching(): Promise<number> {
    const res = await fetchJSON<{ total: number; items: Pick<ConversationItem, 'id' | 'project_id'>[] }>(
      `/api/conversations?${params(filters, 0)}&ids_only=1`,
    );
    const have = new Set(selected.map((s) => s.id));
    selected = [...selected, ...res.items.filter((i) => !have.has(i.id))];
    return res.items.length;
  }

  // ── Keyboard (plan § 6.1): arrows move between rows, Enter opens (the
  //    row's link), `x` picks while picking, Esc leaves the selection. ──
  let listEl = $state<HTMLUListElement>();

  /** The row's own stop: its checkbox while picking, else its title link. */
  function rowStop(li: Element): HTMLElement | null {
    return li.querySelector<HTMLElement>(selectable ? '.chat__pick input' : '.chat__title[href]') ??
      li.querySelector<HTMLElement>('.chat__title[href]');
  }

  function onListKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    // A menu, a field or a dialog keeps its own keys.
    if (target.closest('[role="menu"], [role="dialog"], input:not([type="checkbox"]), textarea, select')) return;
    const li = target.closest('li[data-testid="conversation-row"]');
    if (!li || !listEl) return;
    const rowsEls = [...listEl.querySelectorAll(':scope > li')];
    const at = rowsEls.indexOf(li);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const to = rowsEls[at + (e.key === 'ArrowDown' ? 1 : -1)];
      const stop = to ? rowStop(to) : null;
      if (stop) {
        e.preventDefault();
        stop.focus();
      }
    } else if (e.key === 'x' && selectable) {
      const item = items[at];
      if (item) {
        e.preventDefault();
        togglePick(item);
      }
    } else if (e.key === 'Escape' && selectable && onexit) {
      e.preventDefault();
      onexit();
    }
  }

  let showPagination = $derived(total > LIMIT);
  let rangeEnd = $derived(Math.min(offset + LIMIT, total));
</script>

{#if !counted || loading || showPagination || (selectable && items.length > 0)}
<div class="status-bar">
  <div class="status-bar__summary">
    {#if loading}
      <span>{t('conversations.loading', locale)}</span>
    {:else if !errorMsg}
      {#if !counted}<span class="status-bar__count"
        >{t(total === 1 ? 'conversations.count_one' : 'conversations.count_other', locale, { n: total })}</span
      >{/if}
      {#if showPagination}
        <span>{t('conversations.showing', locale, { from: offset + 1, to: rangeEnd })}</span>
      {/if}
    {/if}
  </div>
  {#if selectable && items.length > 0}
    <Checkbox
      checked={pagePicked === items.length}
      indeterminate={pagePicked > 0 && pagePicked < items.length}
      label={t('mailout.pick_page', locale)}
      onchange={togglePage}
    />
  {/if}
</div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
  bind:this={listEl}
  class="crow-list crow-list--chat"
  aria-busy={busy}
  aria-keyshortcuts={selectable ? 'ArrowUp ArrowDown x Escape' : 'ArrowUp ArrowDown'}
  data-testid="conversation-list"
  onkeydown={onListKey}
>
  {#each rows as r (r.item.id)}
    {@const item = r.item}
    {@const picked = selectable && selectedIds.has(item.id)}
    {@const who = whoOf(item)}
    <li data-testid="conversation-row">
      <ChatRow
        href={conversationPath(item)}
        title={r.title}
        shape={who.shape}
        words={who.words}
        at={r.lastAt}
        when={r.lastAt ? chatWhen(r.lastAt, locale, tz) : ''}
        unread={item.unread_count ?? 0}
        unreadLabel={item.unread_count ? t(item.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: item.unread_count }) : null}
        lead={r.last.lead}
        last={r.last.last ?? (item.relation === 'never' ? t('chat.never', locale) : relationLabel(item.relation, locale))}
        context={chatContext(r)}
        active={activeId === item.id}
        onopen={onopen ? (e) => onopen(item, e) : undefined}
        {picked}
        picking={selectable}
        act={editable && !selectable && onchange && r.turn?.reason === 'reply' ? done : undefined}
      >
        {#snippet pick()}
          <Checkbox
            checked={selectedIds.has(item.id)}
            ariaLabel={t('mailout.pick_one', locale, { name: r.title })}
            onchange={() => togglePick(item)}
          />
        {/snippet}
      </ChatRow>
      {#snippet done()}
        <ChatDone conversationId={item.id} name={r.title} {locale} refresh={onchange!} />
      {/snippet}
    </li>
  {/each}
</ul>

{#if errorMsg}
  <!-- Our sentence, not the server's text (diseño M2); the detail stays in Sentry. -->
  <p class="load-fail" role="alert">
    <span>{t('conversations.load_error', locale)}</span>
    <Button size="xs" variant="secondary" onclick={() => void $query.refetch()}>{t('ui.retry', locale)}</Button>
  </p>
{:else if !loading && items.length === 0}
  {@const unfiltered = !filters.q && !filters.turno && !filters.temp && !filters.temporada && !filters.envio && !filters.relacion && !filters.linea}
  {#if importEmptyState && unfiltered}
    <ConversationsImportEmpty {locale} />
  {:else}
    <!-- «No match» only when something filters; a list that is simply empty says so. -->
    <EmptyLine text={unfiltered ? t('conversations.none_yet', locale) : t('conversations.no_match', locale)} />
  {/if}
{/if}

{#if showPagination}
  <div class="pagination">
    <button
      class="btn--secondary btn--s"
      onclick={() => (offset = Math.max(0, offset - LIMIT))}
      disabled={offset === 0}
    >
      {t('conversations.prev_page', locale)}
    </button>
    <button
      class="btn--secondary btn--s"
      onclick={() => (offset = offset + LIMIT)}
      disabled={offset + LIMIT >= total}
    >
      {t('conversations.next_page', locale)}
    </button>
  </div>
{/if}

<style>
  @layer components {
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
      padding-block: var(--space-s);
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

    .pagination {
      display: flex;
      justify-content: center;
      gap: var(--space-s);
      padding-block: var(--space-m);
    }
  }
</style>
