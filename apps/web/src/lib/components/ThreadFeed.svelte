<script lang="ts">
  /**
   * «De qué se habla», la segunda proyección de Conversations (ADR-106,
   * ADR-116): los hilos con mensajes que quien mira puede leer, los que
   * tienen nuevos arriba. Cada fila abre su ficha: la función con el tablón
   * de su bolo, o la conversación con su hilo del equipo.
   *
   * Solo lectura: se escribe en la ficha. Sin realtime (ADR-083 §2): se
   * recarga al volver a la pestaña y cada 30 s, como el tablón.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import Badge from '$lib/components/Badge.svelte';
  import { t, type Locale } from '$lib/i18n';
  import {
    THREAD_REFRESH_MS,
    boloDays,
    feedHref,
    feedThreadName,
    feedTitle,
    messageWhen,
    type FeedThread,
    type ThreadFeedView,
  } from '$lib/threads';

  interface Props {
    /** El alcance de la barra lateral; vacío = todo. */
    filters: { projectIds: string[]; workspaceIds: string[]; enabled: boolean };
    workspaceSlugById: Map<string, string>;
    projectNameById: Map<string, string>;
    locale: Locale;
  }

  let { filters, workspaceSlugById, projectNameById, locale }: Props = $props();

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function params(f: Props['filters']): string {
    const p = new URLSearchParams();
    if (f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.workspaceIds.length > 0) p.set('workspace_ids', f.workspaceIds.join(','));
    return p.toString();
  }

  const feedQuery = createQuery(
    toStore(() => ({
      queryKey: ['thread-feed', filters.projectIds, filters.workspaceIds] as const,
      enabled: filters.enabled,
      // Siempre viejo: volver a la pestaña, o de una ficha, recarga.
      staleTime: 0,
      refetchInterval: THREAD_REFRESH_MS,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ThreadFeedView>(`/api/threads?${params(filters)}`, signal),
    })),
  );

  let feed = $derived($feedQuery.data ?? null);

  function author(view: ThreadFeedView, th: FeedThread): string {
    const id = th.last_message.author_id;
    if (id && id === view.me) return t('threads.you', locale);
    return (id && view.authors[id]) || t('threads.someone', locale);
  }

  function where(th: FeedThread): string {
    const parts = [projectNameById.get(th.project_id)];
    if (th.bolo) parts.push(boloDays(th.bolo.first_day, th.bolo.last_day, locale));
    return parts.filter(Boolean).join(' · ');
  }
</script>

<section class="feed" aria-busy={$feedQuery.isLoading} aria-label={t('conversations.view_what', locale)}>
  {#if $feedQuery.isLoading}
    <p class="feed__msg">{t('conversations.loading', locale)}</p>
  {:else if $feedQuery.isError}
    <p class="feed__msg">{t('threads.feed_error', locale)}</p>
  {:else if feed && feed.threads.length === 0}
    <p class="feed__msg">{t('threads.feed_empty', locale)}</p>
  {:else if feed}
    <ul class="feed__list">
      {#each feed.threads as th (th.thread_id)}
        {@const href = feedHref(th, workspaceSlugById.get(th.workspace_id))}
        <li class="feed__row" class:feed__row--new={th.unread_count > 0} data-testid="feed-row">
          <svelte:element this={href ? 'a' : 'div'} {href} class="feed__link">
            <span class="feed__head">
              <span class="feed__name">{feedThreadName(th, locale)}</span>
              <span class="feed__title">{feedTitle(th)}</span>
              {#if th.unread_count > 0}
                <Badge tone="info" size="xs">{t(th.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: th.unread_count })}</Badge>
              {/if}
            </span>
            <time class="feed__when" datetime={th.last_message_at}>{messageWhen(th.last_message_at, locale, tz)}</time>
            <span class="feed__where">{where(th)}</span>
            <span class="feed__last"><span class="feed__author">{author(feed, th)}:</span> {th.last_message.body}</span>
          </svelte:element>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  @layer components {
    .feed__msg {
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .feed__list {
      list-style: none;
      margin: 0;
      padding: 0;
      border-block-start: var(--border);
    }

    .feed__row {
      border-block-end: var(--border);
    }

    /* Cabecera y hora en la primera línea; dónde y el último mensaje debajo. */
    .feed__link {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2xs) var(--space-m);
      padding: var(--space-s) var(--space-2xs);
      color: inherit;
      text-decoration: none;
      transition: background-color var(--transition);
    }
    a.feed__link:hover {
      background: var(--bg-ultra-light);
    }

    .feed__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      min-inline-size: 0;
    }

    .feed__name {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }

    .feed__title {
      font-size: var(--text-m);
      color: var(--text-muted);
    }
    /* Con nuevos, el título en tinta: el único peso que cambia. */
    .feed__row--new .feed__title {
      color: var(--text-color);
    }

    .feed__when {
      font-size: var(--text-xs);
      color: var(--text-faint);
      white-space: nowrap;
    }

    .feed__where {
      grid-column: 1 / -1;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .feed__last {
      grid-column: 1 / -1;
      font-size: var(--text-s);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .feed__author {
      color: var(--text-color);
    }
  }
</style>
