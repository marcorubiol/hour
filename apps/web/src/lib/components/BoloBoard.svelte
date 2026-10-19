<script lang="ts">
  /**
   * El tablón del bolo, en la ficha de la función (ADR-106; ADR-099 §6,
   * variante «a»). Toda función con bolo enseña el tablón de su bolo y las
   * hermanas lo comparten: un General y un hilo por faceta, solo los que quien
   * mira puede leer (ausente no es denegado: lo que no lees no se anuncia).
   * Un mensaje puede decir de qué función habla.
   *
   * Sin dinero: la cabecera dice de cuántas funciones es, si son varias (`bolo_board`).
   * Sin realtime (ADR-083 §2): se recarga al volver a la pestaña y cada 30 s
   * mientras se ve. Lo nuevo se marca leído cuando el tablón está a la vista;
   * la raya de «nuevos» se queda donde estaba al abrir la ficha
   * (`thread-reading.svelte.ts`, lo mismo que el hilo de una conversación).
   */

  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
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
    <BlockHead title={t('threads.board', locale)} id="board-title" concept="board" />
    <!-- Ni la sala ni «1 función»: la ficha ya dice dónde (su título) y de
         qué bolo cuelga (sus hechos). Solo cuando el tablón es de varias
         funciones lo dice, y cuáles (ADR-139 p2). -->
    {#if board?.bolo}
      {#if perfCount > 1}
        <p class="board__bolo">{t('threads.performances', locale, { n: perfCount })}</p>
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
    <EmptyLine text={t('desk.loading', locale)} busy />
  {:else if $boardQuery.isError && !board}
    <EmptyLine text={t('threads.board_error', locale)} />
  {:else if board && !board.bolo}
    <EmptyLine text={t('threads.no_bolo', locale)} />
  {:else if board?.bolo}
    {#if board.truncated}
      <EmptyLine text={t('threads.truncated', locale)} />
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
      <!-- Los hilos sin mensajes, en una sola línea: cada nombre abre el suyo
           con el compositor enfocado (ADR-139 § 2: lo vacío, una línea). -->
      <div class="board__folded">
        <EmptyLine
          text={layout.folded.length === 1
            ? t('threads.folded_one', locale)
            : t('threads.folded_other', locale, { n: layout.folded.length })}
        >
          {#each layout.folded as th (threadKey(th))}
            <button type="button" class="empty-line__act" data-facet={th.facet_key ?? 'general'} onclick={() => unfold(th)}
              >{facetName(th, locale)}</button
            >
          {/each}
        </EmptyLine>
      </div>
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
  }
</style>
