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
  import FeedLine from '$lib/components/FeedLine.svelte';
  import ThreadFeedRow from '$lib/components/ThreadFeedRow.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import Button from '$lib/components/Button.svelte';
  import { viewerTimeZone } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { SALES, keyLabel, type WorkspaceTag } from '$lib/conversation-tags';
  import { feedKey, type ConversationFeedView, type FeedConversationView, type FeedThreadRow } from '$lib/conversation-feed';
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
  }

  let { filters, q, workspaceSlugById, projectNameById, tagNames, locale }: Props = $props();

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

  /** Sus etiquetas, por su nombre en el alcance; sin ninguna, Difusión. */
  function tagsOf(c: FeedConversationView): string {
    const keys = c.tags.length > 0 ? c.tags : [SALES];
    return keys.map((k) => keyLabel(k, tagNames, locale)).join(' · ');
  }

  /** La ficha; si lo nuevo es solo del hilo del equipo, abre en el hilo. */
  function conversationHref(c: FeedConversationView): string | null {
    const ws = workspaceSlugById.get(c.workspace_id);
    if (!ws) return null;
    return `/h/${ws}/conversation/${c.id}${c.thread_unread > 0 && c.event_unread === 0 ? '#team' : ''}`;
  }

  /** De quién es el turno, con la palabra del panel (ADR-126 § 1). */
  function turnLead(c: FeedConversationView): string | null {
    if (c.due === 'reply') return t('overview.turn_ours_cap', locale);
    if (c.due === 'follow_up') return t('overview.follow_up_cap', locale);
    if (c.turn === 'theirs') return t('overview.turn_theirs_cap', locale);
    return null;
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
    <EmptyLine text={t(q ? 'conversations.feed_no_match' : 'conversations.feed_empty', locale)} />
  {:else if feed}
    <ul class="cfeed__list">
      {#each feed.items as row (feedKey(row))}
        <li class="cfeed__row" data-testid="feed-row" data-kind={row.kind}>
          {#if row.kind === 'conversation'}
            <FeedLine
              href={conversationHref(row)}
              name={tagsOf(row)}
              title={row.title ?? '—'}
              unread={unreadLabel(row.unread_count)}
              at={row.last_at}
              when={row.last_at ? messageWhen(row.last_at, locale, tz) : ''}
              where={[projectNameById.get(row.project_id), row.person].filter(Boolean).join(' · ')}
              lead={turnLead(row)}
              last={row.due === 'follow_up' ? row.next_action_note : (row.last?.subject ?? null)}
            />
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
    .cfeed__list {
      list-style: none;
      margin: 0;
      padding: 0;
      border-block-start: var(--border);
    }

    .cfeed__row {
      border-block-end: var(--border);
    }

    .cfeed__more {
      margin-block-start: var(--space-s);
    }
  }
</style>
