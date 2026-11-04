<script lang="ts">
  /**
   * Un hilo de bolo abierto solo, como un grupo de una app de mensajería
   * (punto 110): el General, Técnica o Comidas de un bolo. Mensajes por autor
   * en su globo, cada uno en su lado; Intro envía.
   *
   * Lee lo mismo que el tablón de la función (`bolo-board`, una clave y una
   * forma) y escoge su hilo. Quién lo lee no se monta desde aquí: lo da el
   * acceso al bolo (ADR-142) o la regla de la faceta (ADR-106). La cabecera lo
   * dice con nombres y papel (reparto, técnica: 122), y que la sala no está
   * (ADR-177 § 6); el acceso está en el tablón. Su monograma es el del espectáculo: el grupo es nuestro
   * (ADR-177 § 3).
   *
   * Sin realtime, como el tablón: se recarga al volver a la pestaña y cada
   * 30 s; lo nuevo se marca leído al llegar al pie.
   *
   * Una pantalla, dos marcos: su página (`/h/[workspace]/group/[performanceId]`)
   * y el segundo panel de la lista (`inPeek`).
   */
  import { conversationsListHref } from '$lib/conversations-return.svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { tick } from 'svelte';
  import { fetchJSON } from '$lib/api';
  import { docTitle } from '$lib/doc-title';
  import { lensOn } from '$lib/lenses.svelte';
  import { appLocale, t } from '$lib/i18n';
  import { viewerTimeZone } from '$lib/datetime';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { activeProjectsQueryOptions } from '$lib/nav-queries';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import { markReadWhenSeen, readAtOpen } from '$lib/thread-reading.svelte';
  import { scrollToEdge } from '$lib/conversation-thread';
  import {
    THREAD_REFRESH_MS,
    boloDays,
    boloPlace,
    facetName,
    messagesByThread,
    readerLabel,
    type BoardView,
    type ThreadAudience,
  } from '$lib/threads';

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

  // Quién lo lee: la misma clave que la línea de audiencia del hilo.
  const audienceQuery = createQuery(
    toStore(() => ({
      queryKey: ['thread-audience', 'bolo', board?.bolo?.id ?? '', facetId ?? ''] as const,
      enabled: Boolean(board?.bolo?.id && thread),
      staleTime: 5 * 60_000,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ThreadAudience>(
          `/api/threads/audience?anchor_kind=bolo&anchor_id=${board!.bolo!.id}&facet_id=${facetId ?? ''}`,
          signal,
        ),
    })),
  );
  let audience = $derived($audienceQuery.data ?? null);
  // Cada nombre con su papel en el bolo (122): «Laia (reparto), Pau (técnica)».
  let readers = $derived(
    audience?.people
      .map((p) => readerLabel(p, locale))
      .filter(Boolean)
      .join(', ') ?? '',
  );

  // El espectáculo del bolo: su IdentityMark. Quien entra por el bolo no lee
  // el proyecto (ADR-142): sin él, el color que le da su id y el nombre del hilo.
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  let project = $derived(($projectsQuery.data?.items ?? []).find((p) => p.id === board?.bolo?.project_id) ?? null);

  const readAt = readAtOpen();
  let since = $derived(board && thread ? readAt(facetId ?? '', thread.thread_id, board.reads) : null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
  }

  let name = $derived(thread ? facetName(thread, locale) : '');
  let place = $derived(board?.bolo ? boloPlace(board.bolo) : '');
  let venue = $derived(board?.bolo?.venue_name ?? null);
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
  // The function's own space (the API reads it), not the one in the address.
  let boardHref = $derived(first?.slug ? `/h/${board?.workspace_slug ?? workspaceSlug}/performance/${first.slug}#board` : null);
  /** Sin la barra de lentes en el móvil, siempre hay vuelta: la lista, el tablón o Hoy. */
  let back = $derived(
    lensOn('conversations')
      ? { href: conversationsListHref(), label: t('thread.back_list', locale) }
      : boardHref
        ? { href: boardHref, label: t('thread.open_bolo', locale) }
        : { href: '/h', label: t('thread.back_home', locale) },
  );

  let footEl = $state<HTMLElement>();
  markReadWhenSeen({
    target: () => footEl,
    threads: () => (thread ? [thread] : []),
    // Read here, its row in the list of chats goes off too (opened beside, ADR-176).
    onmarked: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['conversation-feed'] });
    },
  });

  // Al abrir, como un chat: al final.
  let placed = false;
  $effect(() => {
    if (placed || !thread || !footEl) return;
    placed = true;
    void tick().then(() => footEl && scrollToEdge(footEl, 'end', inPeek));
  });
</script>

<svelte:head>
  {#if !inPeek && title}<title>{docTitle(title, t('threads.board', locale))}</title>{/if}
</svelte:head>

<section class="record group" data-chat-open={inPeek ? undefined : ''} data-testid="bolo-group">
  <header class="group__head">
    {#if !inPeek}
      <a class="group__back" href={back.href} aria-label={back.label}>
        <span aria-hidden="true">‹</span>
      </a>
    {/if}
    <IdentityMark
      accent={project ? accentVarFor(project) : accentVar(board?.bolo?.project_id)}
      initials={project?.initials}
      name={project?.name ?? name}
      size="var(--chat-mono)"
    />
    <div class="group__who">
      <h1 class="group__title">{title || t('threads.board', locale)}</h1>
      <!-- La línea de audiencia no se pliega nunca (ADR-083, enmienda §6). -->
      <p class="group__readers" data-testid="group-readers">
        {#if audience}
          {t(audience.count === 1 ? 'thread.group_who_one' : 'thread.group_who', locale, {
            n: audience.count,
            names: readers,
          })}
        {:else if $audienceQuery.isError}
          {t('threads.audience_unknown', locale)}
        {:else}
          &nbsp;
        {/if}
      </p>
    </div>
  </header>
  {#if board?.bolo}
    <p class="group__sub" data-testid="group-outside">
      {#if project}<span>{project.name}</span>{/if}
      <strong>{venue ? t('thread.group_outside', locale, { venue }) : t('thread.group_outside_none', locale)}</strong>
      {#if days}<span>{t('thread.bolo', locale)} {days}</span>{/if}
      {#if boardHref}<span><a href={boardHref}>{t('thread.open_bolo', locale)}</a></span>{/if}
    </p>
  {/if}

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
        {venue}
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
    .group__readers {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    /* The band under the head: whose show, and who is NOT here. */
    .group__sub {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--space-xs);
      margin: 0;
      padding: var(--space-2xs) var(--space-s);
      color: var(--text-muted);
      background: var(--bg-light);
      border-radius: var(--radius-s);
      font-size: var(--text-s);
    }
    .group__sub strong {
      color: var(--heading-color);
      font-weight: 500;
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
