<script lang="ts">
  /**
   * «Todas» en una sola lista (ADR-138, fase 3 de etiquetas): las
   * conversaciones con fuera y los hilos del equipo, cada una con la regla de
   * lectura de su tabla (`conversation_feed`). Lo que tiene nuevos arriba,
   * después lo que te toca, después lo último. El hilo del equipo de una sala
   * va dentro de su fila: sus nuevos se suman a los del registro.
   *
   * Solo lectura: se escribe en la ficha, y abrirla la deja leída. Sin
   * realtime (ADR-083 §2): se recarga al volver a la pestaña y cada 30 s, como
   * los hilos.
   */

  import { createQuery, keepPreviousData } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import ConversationRow from '$lib/components/ConversationRow.svelte';
  import ConversationTagList from '$lib/components/ConversationTagList.svelte';
  import ThreadFeedRow from '$lib/components/ThreadFeedRow.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ConversationsImportEmpty from '$lib/components/ConversationsImportEmpty.svelte';
  import Button from '$lib/components/Button.svelte';
  import { viewerTimeZone } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { SALES, type WorkspaceTag } from '$lib/conversation-tags';
  import { rowTurn } from '$lib/conversation-row';
  import { feedKey, feedTurnRow, type ConversationFeedView, type FeedConversationView, type FeedThreadRow } from '$lib/conversation-feed';
  import { THREAD_REFRESH_MS, boloDays, feedHref, messageWhen } from '$lib/threads';

  interface Props {
    /** El alcance de la barra lateral; vacío = todo. */
    filters: { projectIds: string[]; workspaceIds: string[]; enabled: boolean };
    /** La búsqueda, ya con su pausa. */
    q: string;
    workspaceSlugById: Map<string, string>;
    projectNameById: Map<string, string>;
    /** Las etiquetas del alcance, para nombrar las de cada fila. */
    tagNames: readonly WorkspaceTag[];
    locale: Locale;
    /** Who can add one: an empty scope says «Trae tu agenda» instead of «nothing yet». */
    importEmptyState?: boolean;
  }

  let { filters, q, workspaceSlugById, projectNameById, tagNames, locale, importEmptyState = false }: Props = $props();

  const tz = viewerTimeZone();
  const PAGE = 100;
  let limit = $state(PAGE);
  // Otra búsqueda u otro alcance empiezan por la primera página (una clave
  // de texto: un objeto nuevo con los mismos ids no cuenta como otro alcance).
  let scopeKey = $derived(JSON.stringify([filters.projectIds, filters.workspaceIds, q]));
  $effect(() => {
    void scopeKey;
    limit = PAGE;
  });

  function params(): string {
    const p = new URLSearchParams();
    if (filters.projectIds.length > 0) p.set('project_ids', filters.projectIds.join(','));
    if (filters.workspaceIds.length > 0) p.set('workspace_ids', filters.workspaceIds.join(','));
    if (q) p.set('q', q);
    p.set('limit', String(limit));
    return p.toString();
  }

  const feedQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-feed', filters.projectIds, filters.workspaceIds, q, limit] as const,
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

  function author(view: ConversationFeedView, th: FeedThreadRow): string {
    const id = th.last_message.author_id;
    if (id && id === view.me) return t('threads.you', locale);
    return (id && view.authors[id]) || t('threads.someone', locale);
  }

  function threadWhere(th: FeedThreadRow): string {
    const parts = [projectNameById.get(th.project_id)];
    if (th.bolo) parts.push(boloDays(th.bolo.first_day, th.bolo.last_day, locale));
    return parts.filter(Boolean).join(' · ');
  }

  /** La ficha; si lo nuevo es solo del hilo del equipo, abre en el hilo. */
  function conversationHref(c: FeedConversationView): string | null {
    const ws = workspaceSlugById.get(c.workspace_id);
    if (!ws) return null;
    return `/h/${ws}/conversation/${c.id}${c.thread_unread > 0 && c.event_unread === 0 ? '#team' : ''}`;
  }

  /** De quién es el turno, con la palabra y el tono de la tabla (ADR-126 § 1). */
  function turnOf(c: FeedConversationView) {
    return rowTurn({ ...feedTurnRow(c), next_action_at: c.next_action_at }, new Date(), locale);
  }

  function unreadLabel(n: number): string | null {
    return n > 0 ? t(n === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n }) : null;
  }
</script>

<section class="cfeed" aria-busy={$feedQuery.isLoading} aria-label={t('conversations.feed_aria', locale)} data-testid="conversation-feed">
  {#if $feedQuery.isLoading}
    <EmptyLine busy text={t('conversations.loading', locale)} />
  {:else if $feedQuery.isError}
    <EmptyLine text={t('conversations.feed_error', locale)} />
  {:else if feed && feed.items.length === 0}
    {#if importEmptyState && !q}
      <!-- The scope has nothing at all: the first-time empty, as the table says it. -->
      <ConversationsImportEmpty {locale} />
    {:else}
      <EmptyLine text={t(q ? 'conversations.feed_no_match' : 'conversations.feed_empty', locale)} />
    {/if}
  {:else if feed}
    <ul class="crow-list">
      {#each feed.items as row (feedKey(row))}
        <li data-testid="feed-row" data-kind={row.kind}>
          {#if row.kind === 'conversation'}
            {@const turn = turnOf(row)}
            <ConversationRow
              href={conversationHref(row)}
              turn={turn?.word}
              since={turn?.since}
              tone={turn?.tone}
              title={row.title ?? '—'}
              unread={unreadLabel(row.unread_count)}
              at={row.last_at}
              when={row.last_at ? messageWhen(row.last_at, locale, tz) : ''}
              where={[row.person, projectNameById.get(row.project_id)].filter(Boolean).join(' · ')}
              lead={row.due !== 'follow_up' && row.last?.direction === 'outbound' ? t('threads.you', locale) : null}
              last={row.due === 'follow_up' ? row.next_action_note : (row.last?.subject ?? null)}
            >
              {#snippet titleAside()}<ConversationTagList tags={row.tags.length > 0 ? row.tags : [SALES]} known={tagNames} {locale} />{/snippet}
            </ConversationRow>
          {:else}
            <ThreadFeedRow
              th={row}
              href={feedHref(row, workspaceSlugById.get(row.workspace_id))}
              author={author(feed, row)}
              where={threadWhere(row)}
              {locale}
              {tz}
            />
          {/if}
        </li>
      {/each}
    </ul>
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
    .cfeed__more {
      margin-block-start: var(--space-s);
    }
  }
</style>
