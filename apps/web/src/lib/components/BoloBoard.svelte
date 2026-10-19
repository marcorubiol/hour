<script lang="ts">
  /**
   * El tablón del bolo, en la ficha de la función (ADR-106; ADR-099 §6,
   * variante «a»). Toda función con bolo enseña el tablón de su bolo y las
   * hermanas lo comparten: un General y un hilo por faceta, solo los que quien
   * mira puede leer (ausente no es denegado: lo que no lees no se anuncia).
   * Un mensaje puede decir de qué función habla.
   *
   * Sin dinero: la cabecera es sala, ciudad y funciones (`bolo_board`).
   * Sin realtime (ADR-083 §2): se recarga al volver a la pestaña y cada 30 s
   * mientras se ve. Lo nuevo se marca leído cuando el tablón está a la vista;
   * la raya de «nuevos» se queda donde estaba al abrir la ficha
   * (`thread-reading.svelte.ts`, lo mismo que el hilo de una conversación).
   */

  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import FirstTimeNote from '$lib/components/FirstTimeNote.svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { markReadWhenSeen, readAtOpen, scrollWhenNamed } from '$lib/thread-reading.svelte';
  import {
    THREAD_REFRESH_MS,
    boardLayout,
    boloPlace,
    facetName,
    firstUnreadId,
    messagesByThread,
    performanceTag,
    threadKey,
    type BoardThread,
    type BoardView,
  } from '$lib/threads';

  interface Props {
    performanceId: string;
    workspaceSlug: string;
    /** La zona de la sala (o la del espacio): la hora de cada función. */
    tz: string;
    locale: Locale;
  }

  let { performanceId, workspaceSlug, tz, locale }: Props = $props();

  const queryClient = useQueryClient();
  let queryKey = $derived(['bolo-board', performanceId] as const);

  const boardQuery = createQuery(
    toStore(() => ({
      queryKey,
      enabled: Boolean(performanceId),
      // Siempre viejo: volver a la pestaña recarga (refetchOnWindowFocus).
      staleTime: 0,
      refetchInterval: THREAD_REFRESH_MS,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<BoardView>(`/api/boards/${performanceId}`, signal),
    })),
  );

  let board = $derived($boardQuery.data ?? null);
  let byThread = $derived(messagesByThread(board?.messages ?? []));

  const readAt = readAtOpen();
  function newSince(view: BoardView, key: string, threadId: string | null): string | null {
    return readAt(key, threadId, view.reads);
  }

  // ── plegar ─────────────────────────────────────────────────────────────
  // Un hilo vacío es una línea; al pulsarla se abre con el compositor enfocado
  // y sigue abierto mientras dure la visita.
  let opened = $state<string[]>([]);
  let focusKey = $state<string | null>(null);

  function messagesOf(th: BoardThread) {
    return (th.thread_id && byThread.get(th.thread_id)) || [];
  }

  let layout = $derived(
    board
      ? boardLayout(
          board.threads,
          (th) => firstUnreadId(messagesOf(th), board!.me, newSince(board!, threadKey(th), th.thread_id)) !== null,
          new Set(opened),
        )
      : { open: [], folded: [] },
  );

  function unfold(th: BoardThread) {
    const key = threadKey(th);
    if (!opened.includes(key)) opened = [...opened, key];
    focusKey = key;
  }

  // ── leído ──────────────────────────────────────────────────────────────
  let sectionEl = $state<HTMLElement>();
  markReadWhenSeen({
    target: () => sectionEl,
    threads: () => board?.threads ?? [],
    onmarked: refresh,
  });
  scrollWhenNamed('#board', () => (board ? sectionEl : undefined));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  let perfCount = $derived(board?.performances.length ?? 0);
</script>

<section id="board" class="board" aria-labelledby="board-title" aria-busy={$boardQuery.isLoading} bind:this={sectionEl}>
  <header class="board__head">
    <span class="block-head__lead"><p class="eyebrow" id="board-title">{t('threads.board', locale)}</p><ConceptHint concept="board" /></span>
    {#if board?.bolo}
      <p class="board__bolo">
        {#if boloPlace(board.bolo)}<span>{boloPlace(board.bolo)}</span>{/if}
        <span>{perfCount === 1 ? t('threads.one_performance', locale) : t('threads.performances', locale, { n: perfCount })}</span>
      </p>
      {#if perfCount > 1}
        <ul class="board__perfs" role="list">
          {#each board.performances as p (p.id)}
            <li>
              {#if p.id === performanceId}
                <span class="tag-chip" data-tone="blue" aria-current="page">{performanceTag(p, locale, tz)}</span>
              {:else if p.slug}
                <a class="link-arrow" href={`/h/${workspaceSlug}/performance/${p.slug}`}>{performanceTag(p, locale, tz)}</a>
              {:else}
                <span>{performanceTag(p, locale, tz)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </header>
  <FirstTimeNote event="first_board" when={Boolean(board?.bolo)} />

  {#if $boardQuery.isLoading}
    <p class="board__state">{t('desk.loading', locale)}</p>
  {:else if $boardQuery.isError && !board}
    <p class="board__state">{t('threads.board_error', locale)}</p>
  {:else if board && !board.bolo}
    <p class="board__state">{t('threads.no_bolo', locale)}</p>
  {:else if board?.bolo}
    {#if board.truncated}
      <p class="board__state">{t('threads.truncated', locale)}</p>
    {/if}
    {#each layout.open as th (threadKey(th))}
      <ThreadBlock
        thread={th}
        anchorKind="bolo"
        anchorId={board.bolo.id}
        messages={messagesOf(th)}
        authors={board.authors}
        me={board.me}
        newSince={newSince(board, threadKey(th), th.thread_id)}
        performances={board.performances}
        autofocus={focusKey === threadKey(th)}
        {tz}
        {locale}
        onchange={refresh}
      />
    {/each}
    {#if layout.folded.length > 0}
      <!-- Los hilos sin mensajes, plegados: una línea cada uno. -->
      <ul class="board__folded" role="list">
        {#each layout.folded as th (threadKey(th))}
          <li data-facet={th.facet_key ?? 'general'}>
            <button type="button" class="board__fold" onclick={() => unfold(th)}>
              <span class="board__fold-name">{facetName(th, locale)}</span>
              <span>{t('threads.no_messages', locale)}</span>
              <span class="board__fold-write">{t('threads.write', locale)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  @layer components {
    .board {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .board__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .board__bolo {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-s);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .board__bolo > * + *::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    .board__perfs {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs) var(--space-m);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .board__perfs .link-arrow {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    .board__folded {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
      border-block-start: var(--divider-light);
    }
    .board__fold {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      inline-size: 100%;
      padding-block: var(--space-xs);
      color: var(--text-faint);
      font-size: var(--text-xs);
      text-align: start;
    }
    .board__fold > * + *::before {
      content: '·';
      margin-inline-end: var(--space-xs);
      color: var(--text-faint);
    }
    .board__fold-name {
      color: var(--heading-color);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .board__fold-write {
      color: var(--text-muted);
      transition: color var(--transition);
    }
    @media (hover: hover) and (pointer: fine) {
      .board__fold:hover .board__fold-write {
        color: var(--text-color);
        text-decoration: underline;
      }
    }
    .board__fold:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }
    .board__state {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-s);
    }
  }
</style>
