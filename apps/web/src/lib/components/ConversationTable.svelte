<script module lang="ts">
  import StateBadge from '$lib/components/StateBadge.svelte';
  import type { MailoutPick, TempFilter } from '$lib/conversation-overview';
  import type { Relation } from '$lib/conversation-relation';
  import type { Orden } from '$lib/conversation-order';

  export interface ConversationFilters {
    projectIds?: string[];
    lineId?: string;
    workspaceIds?: string[];
    season?: string;
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
   * ConversationTable: the Conversations list (plan `build/plans/2026-10-22-
   * conversations-list.md` § 3), one ConversationRow per conversation, the
   * same row under every chip and in a project's or line's module. Inline
   * relation editing (the menu over the pill) and next-action editing (a
   * dialog), optimistic with rollback and toast (ADR-040). The name stays: it
   * is the lens's list, no longer a `table` (the card of the phone lost its
   * semantics in one, móvil 1).
   */

  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ConversationsImportEmpty from '$lib/components/ConversationsImportEmpty.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonth, dayMonthYear } from '$lib/datetime';
  import { detectLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ConversationHistory from '$lib/components/ConversationHistory.svelte';
  import ConversationRow from '$lib/components/ConversationRow.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import ConversationStatusMenu from '$lib/components/ConversationStatusMenu.svelte';
  import NextActionDialog from '$lib/components/NextActionDialog.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import AcquaintanceMark from '$lib/components/AcquaintanceMark.svelte';
  import { acquaintancesQueryOptions, knownAmong } from '$lib/acquaintance';
  import {
    relativeContactDate,
    conversationPatchColumns,
    conversationTitle,
    relationInputOf,
    type ConversationItem,
    type ConversationPatch,
  } from '$lib/conversation';
  import { lastActivity, relationLabel, relationTone } from '$lib/conversation-relation';
  import { boloLabel, nearestBolo, rowLast, rowTurn } from '$lib/conversation-row';
  import ConversationTagList from '$lib/components/ConversationTagList.svelte';
  import type { WorkspaceTag } from '$lib/conversation-tags';

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
     * Whether the relation menu is offered (ADR-124, `permisos.md` § 8). The
     * caller passes `edit:conversation` in some project; the PATCH still
     * decides per project.
     */
    editable?: boolean;
    /** The tag vocabulary of the scope: when given, each row shows its tags (ADR-138). */
    tagNames?: readonly WorkspaceTag[];
    /** A tag the rows do not repeat: the active chip's. */
    hideTag?: string;
    /** The sales chip: the bolos have their column even where a page has none (plan § 3.1, 4). */
    bolosColumn?: boolean;
    /** The project's name, when the scope has several (the meta line says which). */
    projectName?: (id: string) => string | null;
    /** The line's name, when the scope has several. */
    lineName?: (id: string) => string | null;
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
    bolosColumn = false,
    projectName,
    lineName,
  }: Props = $props();

  type ConversationsResponse = {
    total: number;
    limit: number;
    offset: number;
    items: ConversationItem[];
  };

  const locale = detectLocale(navigator.language);

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
    p.set('status', 'any');
    if (f.relacion) p.set('relacion', f.relacion);
    if (f.etiqueta) p.set('etiqueta', f.etiqueta);
    if (f.orden) p.set('orden', f.orden);
    if (f.projectIds && f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.lineId) p.set('line_id', f.lineId);
    if (f.workspaceIds && f.workspaceIds.length > 0)
      p.set('workspace_ids', f.workspaceIds.join(','));
    if (f.season) p.set('season', f.season);
    if (f.q) p.set('q', f.q);
    if (f.turno) p.set('turno', f.turno);
    if (f.temp) p.set('temp', f.temp);
    if (f.envio) {
      p.set('envio', f.envio);
      if (f.r) p.set('r', f.r);
    }
    if (f.linea) p.set('linea', f.linea);
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
  // «Lo conozco» (ADR-138 § 5): una sola lectura para todas las filas.
  const acquaintances = createQuery(acquaintancesQueryOptions());

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
            // «No esta vez» repaints at once; lifting it waits for the
            // server, which derives what the relation is again.
            return {
              ...it,
              ...conversationPatchColumns(patch, new Date(optimisticNow)),
              ...(patch.not_now ? { relation: 'not_now' as const } : {}),
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
            // The PATCH answers the row without the list's extras: keep them.
            items: cur.items.map((it) =>
              it.id === item.id ? { ...it, ...item, unread_count: it.unread_count, bolos: it.bolos, last_mailout: it.last_mailout } : it,
            ),
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

  function setNotNow(item: ConversationItem, next: { until: string | null } | null) {
    $patchMutation.mutate({ id: item.id, patch: { not_now: next } });
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
  let loading = $derived($query.isLoading);
  // Busy also while a placeholder (the previous page of rows) stands in for
  // the slice being fetched: what is on screen is not yet the answer.
  let busy = $derived(loading || ($query.isPlaceholderData && $query.isFetching));
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

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

  /** A bolo opens its function, in the conversation's space. */
  function performancePath(item: ConversationItem, slug: string | null): string | null {
    const file = conversationPath(item);
    return file && slug ? file.replace(/\/conversation\/[^/]+$/, `/performance/${slug}`) : null;
  }

  // ── What a row shows (plan § 3) ────────────────────────────────────────
  const now = new Date();

  type RowView = {
    item: ConversationItem;
    title: string;
    contact: { name: string; role: string | null; href: string | null } | null;
    meta: string[];
    turn: ReturnType<typeof rowTurn>;
    bolo: ReturnType<typeof nearestBolo>;
    last: ReturnType<typeof rowLast>;
    lastAt: string | null;
  };

  function rowView(item: ConversationItem): RowView {
    const relation = relationInputOf(item);
    const title = organizationOf(item) ?? item.person?.full_name ?? '—';
    // The real contact under the venue, not the venue's name again (an
    // independent programmer's organization carries their name, ADR-102 § 1).
    const person = item.person && item.person.full_name !== title ? item.person : null;
    const role = item.contacts.find((c) => c.is_primary)?.role ?? null;
    const city = item.person?.city || item.organization?.city || null;
    const project = projectName && item.project_id ? projectName(item.project_id) : null;
    const line = lineName && item.line_id ? lineName(item.line_id) : null;
    return {
      item,
      title,
      contact: person ? { name: person.full_name, role, href: personPath(item) } : null,
      meta: [city, project, line].filter((x): x is string => Boolean(x)),
      turn: rowTurn({ ...relation, reply_settled_at: item.reply_settled_at, next_action_at: item.next_action_at }, now, locale),
      bolo: item.bolos ? nearestBolo(item.bolos, now) : null,
      last: rowLast({ last: relation.last ? (item.last_turn?.[0] ?? null) : null, last_in: relation.last_in, last_mailout: item.last_mailout }, locale),
      lastAt: lastActivity(relation),
    };
  }

  let rows = $derived(items.map(rowView));
  // The bolos' column: always under the sales chip, else only when a row has one.
  let withBolos = $derived(bolosColumn || rows.some((r) => r.bolo !== null));

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

<ul class="crow-list crow-list--relation" class:crow-list--bolos={withBolos} aria-busy={busy} data-testid="conversation-list">
  {#each rows as r, i (r.item.id)}
    {@const item = r.item}
    {@const picked = selectable && selectedIds.has(item.id)}
    <li data-testid="conversation-row">
      <ConversationRow
        href={conversationPath(item)}
        title={r.title}
        turn={r.turn?.word}
        since={r.turn?.since}
        tone={r.turn?.tone}
        unread={item.unread_count ? t(item.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: item.unread_count }) : null}
        lead={r.last.lead}
        last={r.last.last}
        {picked}
        picking={selectable}
      >
        {#snippet pick()}
            <Checkbox
              checked={selectedIds.has(item.id)}
              ariaLabel={t('mailout.pick_one', locale, { name: r.title })}
              onchange={() => togglePick(item)}
            />
        {/snippet}
        {#snippet titleAside()}
          <AcquaintanceMark
            known={knownAmong($acquaintances.data, item.workspace_id, item.contacts.map((c) => c.person_id))}
            {locale}
          />
          {#if tagNames}<ConversationTagList tags={item.tags} known={tagNames} hide={hideTag} {locale} />{/if}
        {/snippet}
        {#snippet meta()}
          {#if r.contact}
            {#if r.contact.href}<a class="crow-contact" href={r.contact.href}>{r.contact.name}</a>{:else}{r.contact.name}{/if}{#if r.contact.role},
              {r.contact.role}{/if}{#if r.meta.length > 0}{' · '}{/if}
          {/if}{r.meta.join(' · ')}
        {/snippet}
        {#snippet relation()}
          {#if !editable}
            <StateBadge label={relationLabel(item.relation, locale)} tone={relationTone(item.relation)} />
          {:else}
            <ConversationStatusMenu
              relation={item.relation}
              notNowUntil={item.not_now_until}
              {locale}
              direction={i >= rows.length - 2 && i > 2 ? 'up' : 'down'}
              onnotnow={(next) => setNotNow(item, next)}
              onlog={() => openHistory(item)}
            />
          {/if}
        {/snippet}
        {#snippet bolos()}
          {#if r.bolo}
            {@const href = performancePath(item, r.bolo.bolo.performance_slug)}
            {#if href}<a class="crow-bolo" {href}>{boloLabel(r.bolo, locale)}</a>{:else}{boloLabel(r.bolo, locale)}{/if}
          {/if}
        {/snippet}
        {#snippet whenCell()}
          <button
            type="button"
            class="crow-when"
            onclick={() => openHistory(item)}
            title={r.lastAt ? dayMonthYear(r.lastAt) : t('conversations.history', locale)}
            aria-label={t('conversations.history_aria', locale, { when: relativeContactDate(r.lastAt, locale) })}
          >
            <time datetime={r.lastAt ?? undefined}>{relativeContactDate(r.lastAt, locale)}</time>
          </button>
        {/snippet}
        {#snippet next()}
          <button
            type="button"
            class="crow-next"
            class:crow-next--empty={!item.next_action_at && !item.next_action_note}
            onclick={() => openNextAction(item)}
            title={item.next_action_note ?? t('conversations.set_next_action', locale)}
            aria-label={item.next_action_at || item.next_action_note ? undefined : t('conversations.set_next_action', locale)}
          >
            {#if item.next_action_at || item.next_action_note}
              <span class="crow-next__label">{t('conversations.card_next', locale)}</span>
              {#if item.next_action_at}<span class="crow-next__date">{dayMonth(item.next_action_at)}</span>{/if}
              {#if item.next_action_note}<span class="crow-next__note">{item.next_action_note}</span>{/if}
            {:else}
              <span class="crow-next__date">—</span>
            {/if}
          </button>
        {/snippet}
      </ConversationRow>
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
    <Button variant="quiet" onclick={() => (historyOpen = false)}>{t('conversations.close', locale)}</Button>
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

    .crow-contact,
    .crow-bolo {
      color: inherit;
      text-decoration: none;
    }
    .crow-contact {
      color: var(--text-dark-muted);
    }
    .crow-contact:hover,
    .crow-bolo:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }

    .crow-when {
      color: inherit;
      font: inherit;
      text-align: end;
    }
    .crow-when:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }

    /* «24 oct · llamar»: the date in mono, the note giving way first. */
    .crow-next {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      max-inline-size: 100%;
      min-inline-size: 0;
      text-align: end;
    }
    /* The word «siguiente» only on the phone, where the step has no column. */
    .crow-next__label {
      display: none;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
    }
    .crow-next__date {
      white-space: nowrap;
      color: var(--text-dark-muted);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .crow-next:hover .crow-next__date {
      color: var(--text-color);
    }
    .crow-next__note {
      min-inline-size: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .next-action-who {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    @container (max-width: 47.999rem) {
      .crow-next {
        text-align: start;
      }
      .crow-next__label {
        display: inline;
      }
      /* A card does not draw an empty line (plan § 3.3); the step is set in the file. */
      .crow-next--empty {
        display: none;
      }
    }

    /* Touch: every control of a row reaches the finger's size (móvil #8). */
    @media (pointer: coarse) {
      .crow-when,
      .crow-next,
      .crow-contact {
        min-block-size: var(--touch-target);
      }
      .crow-next,
      .crow-contact {
        display: inline-flex;
        align-items: center;
      }
      .crow-next {
        min-inline-size: var(--touch-target);
      }
    }
  }
</style>
