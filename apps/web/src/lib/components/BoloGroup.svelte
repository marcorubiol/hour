<script lang="ts">
  /**
   * Un hilo de bolo abierto solo, como un grupo de una app de mensajería
   * (punto 110): el General, Técnica o Comidas de un bolo. Mensajes por autor
   * en su globo, cada uno en su lado; Intro envía.
   *
   * Lee lo mismo que el tablón de la función (`bolo-board`, una clave y una
   * forma) y escoge su hilo. Quién lo lee no se monta desde aquí: lo da el
   * acceso al bolo (ADR-142) o la regla de la faceta (ADR-106), así que la
   * cabecera dice cuántos lo leen y lleva al tablón, donde está el acceso.
   *
   * Sin realtime, como el tablón: se recarga al volver a la pestaña y cada
   * 30 s; lo nuevo se marca leído al llegar al pie.
   *
   * Una pantalla, dos marcos: su página (`/h/[workspace]/group/[performanceId]`)
   * y el segundo panel de la lista (`inPeek`).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { tick } from 'svelte';
  import { fetchJSON } from '$lib/api';
  import { docTitle } from '$lib/doc-title';
  import { lensOn } from '$lib/lenses.svelte';
  import { appLocale, t } from '$lib/i18n';
  import { viewerTimeZone } from '$lib/datetime';
  import ChatMonogram from '$lib/components/ChatMonogram.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import { markReadWhenSeen, readAtOpen } from '$lib/thread-reading.svelte';
  import { THREAD_REFRESH_MS, boloDays, boloPlace, facetName, messagesByThread, type BoardView } from '$lib/threads';

  interface Props {
    workspaceSlug: string;
    /** La función que abre el tablón del bolo. */
    performanceId: string;
    /** La faceta del hilo; null, el General. */
    facetId: string | null;
    inPeek?: boolean;
  }

  let { workspaceSlug, performanceId, facetId, inPeek = false }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const tz = viewerTimeZone();
  let queryKey = $derived(['bolo-board', performanceId] as const);

  const boardQuery = createQuery(
    toStore(() => ({
      queryKey,
      enabled: Boolean(performanceId),
      staleTime: 0,
      refetchInterval: THREAD_REFRESH_MS,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<BoardView>(`/api/boards/${performanceId}`, signal),
    })),
  );
  let board = $derived($boardQuery.data ?? null);
  let thread = $derived(board?.threads.find((th) => (th.facet_id ?? null) === facetId) ?? null);
  let messages = $derived(thread?.thread_id ? (messagesByThread(board?.messages ?? []).get(thread.thread_id) ?? []) : []);

  const readAt = readAtOpen();
  let since = $derived(board && thread ? readAt(facetId ?? '', thread.thread_id, board.reads) : null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  let name = $derived(thread ? facetName(thread, locale) : '');
  let place = $derived(board?.bolo ? boloPlace(board.bolo) : '');
  let first = $derived(board?.performances[0] ?? null);
  let days = $derived(
    board && board.performances.length > 0
      ? boloDays(
          board.performances[0].performed_at,
          board.performances[board.performances.length - 1].performed_at,
          locale,
        )
      : '',
  );
  let title = $derived([place, name].filter(Boolean).join(' · '));
  let boardHref = $derived(first?.slug ? `/h/${workspaceSlug}/performance/${first.slug}#board` : null);

  let footEl = $state<HTMLElement>();
  markReadWhenSeen({
    target: () => footEl,
    threads: () => (thread ? [thread] : []),
    onmarked: refresh,
  });

  // Al abrir, como un chat: al final.
  let placed = false;
  $effect(() => {
    if (placed || !thread || !footEl) return;
    placed = true;
    void tick().then(() => footEl?.scrollIntoView({ block: 'end' }));
  });
</script>

<svelte:head>
  {#if !inPeek && title}<title>{docTitle(title, t('threads.board', locale))}</title>{/if}
</svelte:head>

<section class="record group" data-chat-open={inPeek ? undefined : ''} data-testid="bolo-group">
  <header class="group__head">
    {#if !inPeek && lensOn('conversations')}
      <a class="group__back" href="/h/conversations" aria-label={t('conversations.back', locale)}>
        <span aria-hidden="true">‹</span>
      </a>
    {/if}
    <ChatMonogram name={place || name} group />
    <div class="group__who">
      <h1 class="group__title">{title || t('threads.board', locale)}</h1>
      <p class="group__sub">
        <span>{t('thread.group_team', locale)}</span>
        {#if days}<span>{t('thread.bolo', locale)} {days}</span>{/if}
        {#if boardHref}<span><a href={boardHref}>{t('thread.open_bolo', locale)}</a></span>{/if}
      </p>
    </div>
  </header>

  {#if $boardQuery.isLoading}
    <EmptyLine text={t('conversations.loading', locale)} busy />
  {:else if $boardQuery.isError || !board?.bolo}
    <EmptyLine text={t('thread.group_missing', locale)} />
  {:else if !thread}
    <!-- Ausente no es denegado: lo que no lees no se anuncia (ADR-106). -->
    <EmptyLine text={t('thread.group_missing', locale)} />
  {:else}
    <div class="group__body">
      <ThreadBlock
        {thread}
        anchorKind="bolo"
        anchorId={board.bolo.id}
        {messages}
        authors={board.authors}
        me={board.me}
        newSince={since}
        performances={board.performances}
        {tz}
        look="group"
        {locale}
        onchange={refresh}
      />
      <span class="group__end" bind:this={footEl}></span>
    </div>
  {/if}
</section>

<style>
  @layer components {
    .group {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    /* On its own page the group fills the screen, so the field sits at the
       foot even with three messages, as in a chat. */
    .group[data-chat-open] {
      /* What the shell leaves: its top bar (set on .shell, so read here), the
         page's own air above and under, the lens bar on a phone. */
      min-block-size: calc(100dvh - var(--header-height) - var(--space-l) - var(--space-xxl) - var(--shell-foot));
    }
    .group__body {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
    .group__body > :global(.thread--group) {
      flex: 1;
    }
    .group__head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      padding-block-end: var(--space-s);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .group__back {
      display: none;
      align-items: center;
      justify-content: center;
      min-inline-size: var(--touch-target);
      min-block-size: var(--touch-target);
      margin-inline-start: calc(-1 * var(--space-s));
      color: var(--heading-color);
      font-size: var(--text-l);
      text-decoration: none;
    }
    .group__who {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .group__title {
      margin: 0;
      overflow: hidden;
      color: var(--heading-color);
      font-family: var(--font-sans);
      font-size: var(--text-l);
      font-weight: 500;
      letter-spacing: normal;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .group__sub {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--space-xs);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .group__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-xs);
      color: var(--text-faint);
    }
    .group__sub a {
      color: var(--text-muted);
    }
    /* What the reading watches: reaching it is having seen the last one. */
    .group__end {
      display: block;
      block-size: var(--line-hairline);
    }
    @container record (max-width: 47.999rem) {
      .group__title {
        font-size: var(--text-m);
      }
    }
    @media (max-width: 47.999rem) {
      .group__back {
        display: inline-flex;
      }
    }
  }
</style>
