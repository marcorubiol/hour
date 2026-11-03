<script lang="ts">
  /**
   * La lista de chats de Conversaciones (ADR-176; antes «Todas», ADR-138 fase
   * 3): las conversaciones con fuera y los hilos de los bolos en una sola
   * lista, cada una con la regla de lectura de su tabla (`conversation_feed`).
   * Lo que tiene nuevos arriba, después lo que te toca, después lo último
   * (`comparePide`). El hilo del equipo de una sala no es una fila: sus
   * nuevos se suman a los de su conversación y se lee dentro de ella.
   *
   * `tag` acota: una etiqueta (las de la conversación), o `team`, sólo los
   * hilos de los bolos (el chip Equipo). Se escribe en la ficha, y abrirla
   * la deja leída; desde la fila, sólo «Ya está» (`ChatDone`), a quien edita.
   * Cada fila dice con quién en palabras (`chatWho`, ADR-177 § 2 y § 3); un
   * hilo de bolo lleva el `IdentityMark` de su espectáculo. Sin realtime (ADR-083 §2): se recarga al
   * volver a la pestaña y cada 30 s, como los hilos.
   */

  import { createQuery, keepPreviousData } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import ChatRow from '$lib/components/ChatRow.svelte';
  import ChatDone from '$lib/components/ChatDone.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ConversationsImportEmpty from '$lib/components/ConversationsImportEmpty.svelte';
  import Button from '$lib/components/Button.svelte';
  import { viewerTimeZone } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { chatWhen, chatWho } from '$lib/chat-row';
  import { eventKindLabel, type ConversationEventKind } from '$lib/conversation';
  import { relationLabel } from '$lib/conversation-relation';
  import { SALES, TEAM, keyLabel, type WorkspaceTag } from '$lib/conversation-tags';
  import { rowTurn } from '$lib/conversation-row';
  import { feedKey, feedTurnRow, type ConversationFeedView, type FeedConversationView, type FeedThreadRow } from '$lib/conversation-feed';
  import { THREAD_REFRESH_MS, boloDays, feedHref, feedThreadName, feedTitle, groupHref } from '$lib/threads';

  interface Props {
    /** El alcance de la barra lateral; vacío = todo. */
    filters: { projectIds: string[]; workspaceIds: string[]; enabled: boolean };
    /** La búsqueda, ya con su pausa. */
    q: string;
    /** Una etiqueta, `team` (los hilos de los bolos) o null (todo). */
    tag?: string | null;
    workspaceSlugById: Map<string, string>;
    projectNameById: Map<string, string>;
    /** Con varios proyectos en el alcance, la fila dice de cuál es. */
    showProject?: boolean;
    /** Las etiquetas del alcance, para nombrar las de cada fila. */
    tagNames: readonly WorkspaceTag[];
    locale: Locale;
    /** Who can add one: an empty scope says «Trae tu agenda» instead of «nothing yet». */
    importEmptyState?: boolean;
    /** Who edits conversations: a row that needs a reply offers «Ya está». */
    editable?: boolean;
    /** The identity of a project, for a bolo thread's mark (ADR-177 § 3). */
    projectMark?: (id: string) => { accent: string; initials?: string | null; name: string } | null;
    /** After «Ya está» or its undo: the lists read again. */
    onchange?: () => void;
    /** La conversación abierta al lado (escritorio). */
    activeId?: string | null;
    /** Abrir al lado en vez de navegar; sin ella, el enlace va a la ficha. */
    onopen?: (c: FeedConversationView, event: MouseEvent) => void;
    /** The bolo thread open beside, as `<performance>/<facet or ''>`. */
    activeThread?: string | null;
    /** Open a bolo's thread beside, as a group; without it, its group page. */
    onopenthread?: (th: FeedThreadRow, event: MouseEvent) => void;
  }

  let {
    filters,
    q,
    tag = null,
    workspaceSlugById,
    projectNameById,
    showProject = false,
    tagNames,
    locale,
    importEmptyState = false,
    editable = false,
    projectMark,
    onchange,
    activeId = null,
    onopen,
    activeThread = null,
    onopenthread,
  }: Props = $props();

  const tz = viewerTimeZone();
  const PAGE = 100;
  let limit = $state(PAGE);
  // Otra búsqueda, otro alcance u otra etiqueta empiezan por la primera página.
  let scopeKey = $derived(JSON.stringify([filters.projectIds, filters.workspaceIds, q, tag]));
  $effect(() => {
    void scopeKey;
    limit = PAGE;
  });

  function params(): string {
    const p = new URLSearchParams();
    if (filters.projectIds.length > 0) p.set('project_ids', filters.projectIds.join(','));
    if (filters.workspaceIds.length > 0) p.set('workspace_ids', filters.workspaceIds.join(','));
    if (tag) p.set('etiqueta', tag);
    if (q) p.set('q', q);
    p.set('limit', String(limit));
    return p.toString();
  }

  const feedQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-feed', filters.projectIds, filters.workspaceIds, q, limit, tag] as const,
      enabled: filters.enabled,
      staleTime: 0,
      refetchInterval: THREAD_REFRESH_MS,
      // «Ver más» no vacía la lista mientras llega la página siguiente.
      placeholderData: keepPreviousData,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ConversationFeedView>(`/api/conversations/feed?${params()}`, signal),
    })),
  );

  let feed = $derived($feedQuery.data ?? null);
  // A conversation's own team thread lives inside it: never a row of its own.
  let rows = $derived((feed?.items ?? []).filter((r) => r.kind === 'conversation' || r.anchor_kind !== 'conversation'));

  function author(view: ConversationFeedView, th: FeedThreadRow): string {
    const id = th.last_message.author_id;
    if (id && id === view.me) return t('threads.you', locale);
    return (id && view.authors[id]) || t('threads.someone', locale);
  }

  function href(c: FeedConversationView): string | null {
    const ws = workspaceSlugById.get(c.workspace_id);
    // What is new is only the team's: the conversation opens on its team thread.
    return ws ? `/h/${ws}/conversation/${c.id}${c.thread_unread > 0 && c.event_unread === 0 ? '#team' : ''}` : null;
  }

  function unreadLabel(n: number): string | null {
    return n > 0 ? t(n === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n }) : null;
  }

  /** Quién dijo lo último: tú, su contacto, o qué fue (una llamada, una reunión). */
  function lastOf(c: FeedConversationView): { lead: string | null; last: string | null } {
    if (c.due === 'follow_up') return { lead: t('chat.follow_up', locale), last: c.next_action_note };
    const ev = c.last;
    // Nothing said yet: never contacted says so; one contacted by a stamp says its relation.
    if (!ev) return { lead: null, last: c.relation && c.relation !== 'never' ? relationLabel(c.relation, locale) : t('chat.never', locale) };
    const kind = ev.kind as ConversationEventKind | null;
    if (kind && kind !== 'email' && kind !== 'message') return { lead: eventKindLabel(kind, locale), last: ev.subject ?? null };
    const who = ev.direction === 'outbound' ? t('threads.you', locale) : c.person;
    return { lead: who, last: ev.subject ?? null };
  }

  /** La línea de contexto: el turno (te toca en tinta), el proyecto, la etiqueta y la relación. */
  function contextOf(c: FeedConversationView): { text: string; ink?: boolean }[] {
    const turn = rowTurn({ ...feedTurnRow(c), next_action_at: c.next_action_at }, new Date(), locale);
    const out: { text: string; ink?: boolean }[] = [];
    if (turn?.word) out.push({ text: turn.word, ink: turn.tone === 'ours' || turn.tone === 'late' });
    if (showProject) {
      const p = projectNameById.get(c.project_id);
      if (p) out.push({ text: p });
    }
    if (!tag) out.push({ text: keyLabel(c.tags[0] ?? SALES, tagNames, locale) });
    if (!turn?.word && c.relation && c.last) out.push({ text: relationLabel(c.relation, locale) });
    return out;
  }

  function threadContext(th: FeedThreadRow): { text: string }[] {
    const out = [{ text: t('conversations.view_team', locale) }];
    if (th.bolo?.first_day) out.push({ text: boloDays(th.bolo.first_day, th.bolo.last_day, locale) });
    if (showProject) {
      const p = projectNameById.get(th.project_id);
      if (p) out.push({ text: p });
    }
    return out;
  }
</script>

<section class="cfeed" aria-busy={$feedQuery.isLoading} aria-label={t('conversations.feed_aria', locale)} data-testid="conversation-feed">
  {#if $feedQuery.isLoading}
    <EmptyLine busy text={t('conversations.loading', locale)} />
  {:else if $feedQuery.isError}
    <EmptyLine text={t('conversations.feed_error', locale)} />
  {:else if feed && rows.length === 0}
    {#if importEmptyState && !q && !tag}
      <!-- The scope has nothing at all: the first-time empty, as the table says it. -->
      <ConversationsImportEmpty {locale} />
    {:else}
      <EmptyLine text={t(q ? 'conversations.feed_no_match' : tag === TEAM ? 'chat.team_empty' : 'conversations.feed_empty', locale)} />
    {/if}
  {:else if feed}
    <ul class="crow-list">
      {#each rows as row (feedKey(row))}
        <li data-testid="feed-row" data-kind={row.kind}>
          {#if row.kind === 'conversation'}
            {@const l = lastOf(row)}
            {@const who = chatWho({ kind: row.org_kind, solo: row.solo, city: row.city }, locale)}
            <ChatRow
              href={href(row)}
              title={row.title ?? '—'}
              shape={who.shape}
              words={who.words}
              at={row.last_at}
              when={row.last_at ? chatWhen(row.last_at, locale, tz) : ''}
              unread={row.unread_count}
              unreadLabel={unreadLabel(row.unread_count)}
              lead={l.lead}
              last={l.last}
              context={contextOf(row)}
              active={activeId === row.id}
              onopen={onopen ? (e) => onopen(row, e) : undefined}
              act={editable && onchange && row.due === 'reply' ? done : undefined}
            />
            {#snippet done()}
              <ChatDone conversationId={row.id} name={row.title ?? ''} {locale} refresh={onchange!} />
            {/snippet}
          {:else}
            <ChatRow
              href={groupHref(row, workspaceSlugById.get(row.workspace_id)) ?? feedHref(row, workspaceSlugById.get(row.workspace_id))}
              title={[feedTitle(row), feedThreadName(row, locale)].filter(Boolean).join(' · ')}
              group
              mark={projectMark?.(row.project_id) ?? null}
              at={row.last_message_at}
              when={chatWhen(row.last_message_at, locale, tz)}
              unread={row.unread_count}
              unreadLabel={unreadLabel(row.unread_count)}
              lead={author(feed, row)}
              last={row.last_message.body}
              context={threadContext(row)}
              active={activeThread !== null && activeThread === `${row.bolo?.performance_id}/${row.facet_id ?? ''}`}
              onopen={onopenthread ? (e) => onopenthread(row, e) : undefined}
            />
          {/if}
        </li>
      {/each}
    </ul>
    {#if tag === TEAM}
      <p class="cfeed__note">{t('chat.team_note', locale)}</p>
    {/if}
    {#if feed.more}
      <div class="cfeed__more">
        <Button size="s" variant="secondary" loading={$feedQuery.isFetching} onclick={() => (limit = Math.min(limit + PAGE, 500))}
          >{t('conversations.feed_more', locale)}</Button
        >
      </div>
    {/if}
  {/if}
</section>

<style>
  @layer components {
    .cfeed__note {
      margin: var(--space-s) 0 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .cfeed__more {
      margin-block-start: var(--space-s);
    }
  }
</style>
