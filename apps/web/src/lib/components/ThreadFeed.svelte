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
  import ThreadFeedRow from '$lib/components/ThreadFeedRow.svelte';
  import { t, type Locale } from '$lib/i18n';
  import {
    THREAD_REFRESH_MS,
    boloDays,
    feedHref,
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
        <li class="feed__row" data-testid="feed-row">
          <ThreadFeedRow {th} {href} author={author(feed, th)} where={where(th)} {locale} {tz} />
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

  }
</style>
