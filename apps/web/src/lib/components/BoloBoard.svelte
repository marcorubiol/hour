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
   * la raya de «nuevos» se queda donde estaba al abrir la ficha.
   */

  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import { t, type Locale } from '$lib/i18n';
  import {
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

  /** ADR-083 §2: sin realtime; la cifra es la del plan, sin medir. */
  const REFRESH_MS = 30_000;

  const queryClient = useQueryClient();
  let queryKey = $derived(['bolo-board', performanceId] as const);

  const boardQuery = createQuery(
    toStore(() => ({
      queryKey,
      enabled: Boolean(performanceId),
      // Siempre viejo: volver a la pestaña recarga (refetchOnWindowFocus).
      staleTime: 0,
      refetchInterval: REFRESH_MS,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<BoardView>(`/api/boards/${performanceId}`, signal),
    })),
  );

  let board = $derived($boardQuery.data ?? null);
  let byThread = $derived(messagesByThread(board?.messages ?? []));

  /**
   * Hasta dónde había leído cada hilo AL ABRIR la ficha. Se apunta la primera
   * vez que se ve el hilo y no cambia al marcarlo leído: si cambiase, la raya
   * de «nuevos» desaparecería a los 30 s, mientras se lee. Un Map sin estado a
   * propósito: es memoria de esta visita, no algo que repinte.
   */
  const openedAt = new Map<string, string | null>();
  function newSince(view: BoardView, key: string, threadId: string | null): string | null {
    if (!openedAt.has(key)) openedAt.set(key, (threadId && view.reads[threadId]) || null);
    return openedAt.get(key) ?? null;
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
  let inView = $state(false);

  $effect(() => {
    if (!sectionEl) return;
    const io = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting), { threshold: 0.15 });
    io.observe(sectionEl);
    return () => io.disconnect();
  });

  /** Lo ya pedido por hilo y último mensaje: una marca por novedad, no una por recarga. */
  const marked = new Set<string>();

  $effect(() => {
    if (!board || !inView || document.visibilityState !== 'visible') return;
    const pending = board.threads.filter(
      (th) => th.thread_id && th.unread_count > 0 && !marked.has(`${th.thread_id}@${th.last_message_at}`),
    );
    if (pending.length === 0) return;
    for (const th of pending) marked.add(`${th.thread_id}@${th.last_message_at}`);
    void Promise.allSettled(
      pending.map((th) => mutateJSON('POST', `/api/threads/${th.thread_id}/read`)),
    ).then(() => queryClient.invalidateQueries({ queryKey }));
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  let perfCount = $derived(board?.performances.length ?? 0);
</script>

<section class="board" aria-labelledby="board-title" aria-busy={$boardQuery.isLoading} bind:this={sectionEl}>
  <header class="board__head">
    <p class="eyebrow" id="board-title">{t('threads.board', locale)}</p>
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
