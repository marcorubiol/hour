<script lang="ts">
  /**
   * ThreadBlock: un hilo interno (ADR-106) tal como se lee y se escribe en su
   * contenedor. Cabecera (nombre, recuento, nuevos), la línea de audiencia sin
   * plegar (ADR-083, enmienda §6), los mensajes de arriba abajo y el
   * compositor de texto plano. Lo propio se corrige o se borra desde su menú.
   *
   * No lee mensajes: se los da quien lo embebe (el tablón los trae todos de
   * una vez, `lib/server/threads.ts`). Sí lee su audiencia, que cambia poco.
   * Sin realtime: tras escribir, `onchange` pide al dueño que recargue.
   *
   * Lo usan el tablón del bolo y el hilo del equipo de una conversación
   * (`anchorKind="conversation"`, con su propio `title`). En la vista «hilo» de
   * la conversación los mensajes se mezclan con el registro fuera de aquí
   * (`list={false}`): el bloque queda en cabecera, audiencia y compositor.
   */

  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Badge from '$lib/components/Badge.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import Button from '$lib/components/Button.svelte';
  import MessageItem, { messageFailed, sendOnModEnter } from '$lib/components/MessageItem.svelte';
  import { t, type Locale } from '$lib/i18n';
  import {
    MESSAGE_MAX,
    audienceLine,
    facetName,
    firstUnreadId,
    performanceOptions,
    performanceTag,
    type AnchorKind,
    type BoardPerformance,
    type BoardThread,
    type MessageCreate,
    type ThreadAudience,
    type ThreadMessage,
  } from '$lib/threads';

  interface Props {
    thread: BoardThread;
    anchorKind: AnchorKind;
    anchorId: string;
    messages: ThreadMessage[];
    authors: Record<string, string>;
    me: string;
    /** Hasta dónde había leído al abrir la pantalla: la raya de «nuevos» no se mueve mientras se lee. */
    newSince: string | null;
    /** Las funciones del bolo, para etiquetar y para el selector «de qué función». */
    performances?: BoardPerformance[];
    /** La zona de la sala: la hora de una función se dice donde ocurre. */
    tz: string;
    /** Abierto desde su línea plegada: el compositor llega con el foco. */
    autofocus?: boolean;
    /** El nombre del hilo cuando no es el de su faceta (el del equipo de una conversación). */
    title?: string;
    /** false: los mensajes se pintan fuera (la vista «hilo» los mezcla con el registro). */
    list?: boolean;
    /**
     * La voz de la cabecera: `name` (el tablón, un hilo entre hilos) o
     * `eyebrow` (la ficha de una conversación, donde es una sección más del
     * lateral, como Datos fiscales o Buzones; revisión de diseño B8).
     */
    heading?: 'name' | 'eyebrow';
    locale: Locale;
    onchange: () => void;
  }

  let {
    thread,
    anchorKind,
    anchorId,
    messages,
    authors,
    me,
    newSince,
    performances = [],
    tz,
    autofocus = false,
    title,
    list = true,
    heading = 'name',
    locale,
    onchange,
  }: Props = $props();

  let name = $derived(title ?? facetName(thread, locale));
  let headingId = $derived(`thread-${anchorId}-${thread.facet_id ?? 'general'}`);

  // ── audiencia ──────────────────────────────────────────────────────────
  const audienceQuery = createQuery(
    toStore(() => ({
      queryKey: ['thread-audience', anchorKind, anchorId, thread.facet_id ?? ''] as const,
      staleTime: 5 * 60_000,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ThreadAudience>(
          `/api/threads/audience?anchor_kind=${anchorKind}&anchor_id=${anchorId}&facet_id=${thread.facet_id ?? ''}`,
          signal,
        ),
    })),
  );
  let audience = $derived($audienceQuery.data ?? null);
  let audienceNames = $derived(
    audience?.people
      .map((p) => p.name)
      .filter(Boolean)
      .join(', ') ?? '',
  );

  // ── mensajes ───────────────────────────────────────────────────────────
  let perfById = $derived(new Map(performances.map((p) => [p.id, p])));
  let dividerId = $derived(firstUnreadId(messages, me, newSince));

  // ── escribir ───────────────────────────────────────────────────────────
  let body = $state('');
  let composer = $state<HTMLTextAreaElement>();
  $effect(() => {
    if (autofocus) composer?.focus();
  });
  let aboutPerf = $state('');
  let perfOptions = $derived(performanceOptions(performances, locale, tz));

  const postMutation = createMutation({
    mutationFn: (input: MessageCreate) => mutateJSON<{ message: ThreadMessage }>('POST', '/api/messages', input),
    onSuccess: () => {
      body = '';
      aboutPerf = '';
      onchange();
    },
    onError: (err) => messageFailed(err, 'threads.not_sent', locale),
  });

  function send(event?: SubmitEvent) {
    event?.preventDefault();
    const text = body.trim();
    if (!text || $postMutation.isPending) return;
    $postMutation.mutate({
      anchor_kind: anchorKind,
      anchor_id: anchorId,
      facet_id: thread.facet_id,
      performance_id: aboutPerf || null,
      body: text,
    });
  }
</script>

<article class="thread" aria-labelledby={headingId} data-facet={thread.facet_key ?? 'general'}>
  {#snippet unread()}
    {#if thread.unread_count > 0}
      <Badge tone="info" size="xs">{t(thread.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: thread.unread_count })}</Badge>
    {/if}
  {/snippet}
  {#if heading === 'eyebrow'}
    <BlockHead level={3} title={name} count={thread.message_count} id={headingId}>{@render unread()}</BlockHead>
  {:else}
    <header class="thread__head">
      <h3 class="thread__name" id={headingId}>{name}</h3>
      <span class="thread__count">{thread.message_count}</span>
      {@render unread()}
    </header>
  {/if}
  <!-- La línea de audiencia no se pliega nunca (ADR-083, enmienda §6). -->
  <p class="thread__audience" title={audienceNames || undefined}>
    {#if audience}
      {audienceLine(audience, locale)}
    {:else if $audienceQuery.isError}
      {t('threads.audience_unknown', locale)}
    {:else}
      &nbsp;
    {/if}
  </p>

  {#if !list}
    <!-- Los mensajes van mezclados con el registro, fuera de este bloque. -->
  {:else if messages.length === 0}
    <EmptyLine text={t('threads.empty', locale)} />
  {:else}
    <ol class="thread__list">
      {#each messages as m (m.id)}
        {@const perf = m.performance_id ? perfById.get(m.performance_id) : undefined}
        <MessageItem
          message={m}
          author={(m.author_id && authors[m.author_id]) || ''}
          mine={m.author_id === me}
          about={perf ? performanceTag(perf, locale, tz) : undefined}
          newBefore={m.id === dividerId}
          {locale}
          {onchange}
        />
      {/each}
    </ol>
  {/if}

  <form class="thread__compose" class:thread__compose--filled={body.trim() !== ''} onsubmit={send}>
    <textarea
      rows="1"
      maxlength={MESSAGE_MAX}
      placeholder={t('threads.write_in', locale, { name })}
      aria-label={t('threads.write_in', locale, { name })}
      bind:value={body}
      bind:this={composer}
      onkeydown={(e) => sendOnModEnter(e, () => send())}
    ></textarea>
    <div class="thread__compose-row">
      {#if perfOptions.length > 0}
        <select bind:value={aboutPerf} aria-label={t('threads.about_label', locale)}>
          {#each perfOptions as o (o.value)}
            <option value={o.value}>{o.label}</option>
          {/each}
        </select>
      {/if}
      <Button type="submit" size="xs" loading={$postMutation.isPending} disabled={!body.trim()}>
        {t('threads.send', locale)}
      </Button>
    </div>
  </form>
</article>

<style>
  @layer components {
    .thread {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-start: var(--space-m);
      border-block-start: var(--divider-light);
    }

    .thread__head {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
    }
    .thread__head h3 {
      margin: 0;
    }
    .thread__name {
      color: var(--heading-color);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      font-weight: 500;
      letter-spacing: normal;
    }
    .thread__count {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }

    .thread__audience,

    .thread__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin: var(--space-xs) 0 0;
      padding: 0;
      list-style: none;
    }

    .thread__compose {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-xs);
    }
    .thread__compose textarea {
      field-sizing: content;
      min-block-size: 2.5rem;
      max-block-size: 12rem;
      resize: vertical;
    }
    /* Ocho hilos son ocho compositores: en reposo, solo la caja. La función y
       el botón salen al escribir (foco dentro o texto a medias). */
    .thread__compose:not(:focus-within, .thread__compose--filled) .thread__compose-row {
      display: none;
    }
    .thread__compose-row {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--space-xs);
    }
    .thread__compose-row select {
      inline-size: auto;
      max-inline-size: 100%;
      padding-block: var(--space-2xs);
      font-size: var(--text-xs);
    }
  }
</style>
