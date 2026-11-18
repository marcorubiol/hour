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
   *
   * DOS SITIOS, UN EJE (`placing`, ADR-214): `page` es el bloque de siempre,
   * todos los hilos uno bajo otro; `sheet` es «Hablar» del pase: la hoja que
   * se abre sin salir de la ficha, con los hilos arriba para elegir (cada uno
   * con sus nuevos) y uno solo debajo, que siempre dice quién lo lee.
   */

  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import FirstTimeNote from '$lib/components/FirstTimeNote.svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import BoloAccess from '$lib/components/BoloAccess.svelte';
  import type { GoingPerson } from '$lib/bolo-access';
  import { type Locale, tHere } from '$lib/i18n';
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
    /** La zona del espacio: el día en que acaba un acceso al bolo. */
    workspaceTz?: string;
    /** Quién va a esta función (reparto y «voy»): el acceso propone invitar
        a quien va y no lo ve (comms carril 2, fase 2). */
    going?: readonly GoingPerson[];
    locale: Locale;
    /** `page`: el bloque de la ficha; `sheet`: la hoja de «Hablar» (ADR-214). */
    placing?: 'page' | 'sheet';
  }

  let { performanceId, workspaceSlug, tz, workspaceTz, going = [], locale, placing = 'page' }: Props = $props();
  let sheet = $derived(placing === 'sheet');
  const t = tHere();

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
    // En la hoja solo se ve un hilo: solo ese se marca leído.
    threads: () => (sheet ? (shown ? [shown] : []) : (board?.threads ?? [])),
    onmarked: refresh,
  });
  scrollWhenNamed('#board', () => (board ? sectionEl : undefined));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  let perfCount = $derived(board?.performances.length ?? 0);

  // ── la hoja: un hilo a la vez, elegido arriba ───────────────────────────
  /** El elegido: a mano, o al llegar el tablón el primero con nuevos, si no el primero. */
  let picked = $state<string | null>(null);
  // The first choice is made once, when the board arrives, and kept: were it
  // read live, marking the shown thread read would hand the sheet to the next
  // unread one, and that one would be marked too, never seen.
  $effect(() => {
    if (picked !== null || !board) return;
    const first = board.threads.find((th) => th.unread_count > 0) ?? board.threads[0];
    if (first) picked = threadKey(first);
  });
  let shown = $derived.by(() => {
    if (!board) return null;
    return board.threads.find((th) => threadKey(th) === picked) ?? board.threads[0] ?? null;
  });
  /** The threads the sheet has shown, kept mounted (their drafts with them). */
  let visited = $state<string[]>([]);
  $effect(() => {
    const key = shown ? threadKey(shown) : null;
    if (key !== null && !visited.includes(key)) visited = [...visited, key];
  });
  // Picking a tab only shows the thread: no focus in its composer. A focused
  // composer grows its «Enviar» row, and losing it to the next tab shrank the
  // sheet under the finger (from below, on a phone), so the tap missed.
  function pick(th: BoardThread) {
    picked = threadKey(th);
  }
</script>

<!-- Sin bolo no hay tablón ni nada que escribir en él: el bloque no se pinta
     (ADR-145 § 1; la franja «Falta» de la ficha ya dice «Sin bolo» a quien
     puede crearlo). -->
{#if !(board && !board.bolo)}
<section
  id={sheet ? undefined : 'board'}
  class="board"
  class:board--sheet={sheet}
  aria-labelledby={sheet ? undefined : 'board-title'}
  aria-label={sheet ? t('threads.board', locale) : undefined}
  aria-busy={$boardQuery.isLoading}
  bind:this={sectionEl}
>
  <header class="board__head">
    {#if !sheet}<BlockHead title={t('threads.board', locale)} id="board-title" concept="board" />{/if}
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
    {#if board?.bolo}
      <BoloAccess boloId={board.bolo.id} {going} tz={workspaceTz ?? tz} {locale} />
    {/if}
  </header>
  <FirstTimeNote event="first_board" when={Boolean(board?.bolo)} />

  {#if $boardQuery.isLoading}
    <EmptyLine text={t('desk.loading', locale)} busy />
  {:else if $boardQuery.isError && !board}
    <EmptyLine text={t('threads.board_error', locale)} />
  {:else if board?.bolo}
    {#if board.truncated}
      <EmptyLine text={t('threads.truncated', locale)} />
    {/if}
    {#if sheet}
      <!-- Arriba se elige el hilo; cada uno dice sus nuevos, o quién escribió. -->
      <div class="board__pick" role="tablist" aria-label={t('threads.pick', locale)}>
        {#each board.threads as th (threadKey(th))}
          {@const on = shown !== null && threadKey(shown) === threadKey(th)}
          <button
            type="button"
            role="tab"
            class="board__tab"
            aria-selected={on}
            data-facet={th.facet_key ?? 'general'}
            onclick={() => pick(th)}
          >
            <span class="board__tab-name">{facetName(th, locale)}</span>
            <span class="board__tab-meta" class:board__tab-meta--new={th.unread_count > 0}
              >{th.unread_count > 0
                ? th.unread_count === 1
                  ? t('threads.unread_one', locale)
                  : t('threads.unread', locale, { n: th.unread_count })
                : th.message_count > 0
                  ? t('threads.count', locale, { n: th.message_count })
                  : t('threads.empty_short', locale)}</span
            >
          </button>
        {/each}
      </div>
      <!-- Each thread once seen stays mounted, hidden when another is picked:
           a half-written message survives a look at another tab. -->
      {#each board.threads.filter((th) => visited.includes(threadKey(th))) as th (threadKey(th))}
        <div hidden={!shown || threadKey(th) !== threadKey(shown)}>
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
        </div>
      {/each}
    {:else}
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
  {/if}
</section>
{/if}

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
    /* La hoja: los hilos como pestañas a `--radius`, nunca pastillas. */
    .board__pick {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-2xs);
      padding: var(--space-2xs);
      border-radius: var(--radius);
      background: var(--bg-light);
      overflow-x: auto;
    }
    .board__tab {
      display: grid;
      justify-items: center;
      gap: var(--line-hairline);
      min-inline-size: 6rem;
      padding: var(--space-xs) var(--space-s);
      border: var(--line-hairline) solid transparent;
      border-radius: var(--radius);
      background: none;
      font: inherit;
      color: var(--text-color);
      cursor: pointer;
    }
    .board__tab[aria-selected='true'] {
      border-color: var(--border-color-dark);
      background: var(--bg-ultra-light);
    }
    .board__tab-name {
      font-size: var(--text-s);
      font-weight: 500;
    }
    .board__tab-meta {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .board__tab-meta--new {
      color: var(--missing-ink);
    }
    .board__perfs .link-arrow {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
  }
</style>
