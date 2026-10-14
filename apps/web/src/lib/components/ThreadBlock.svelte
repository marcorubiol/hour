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
   * Hoy lo usa el tablón del bolo; el hilo del equipo de una conversación
   * (fase 3) es el mismo bloque con `anchorKind="conversation"`.
   */

  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Button from '$lib/components/Button.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { t, type Locale } from '$lib/i18n';
  import {
    MESSAGE_MAX,
    audienceLine,
    facetName,
    firstUnreadId,
    messageWhen,
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
    locale,
    onchange,
  }: Props = $props();

  let name = $derived(facetName(thread, locale));
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
  // Un mensaje es un momento: se dice en la zona de quien lo lee.
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let perfById = $derived(new Map(performances.map((p) => [p.id, p])));
  let dividerId = $derived(firstUnreadId(messages, me, newSince));

  function authorName(id: string | null): string {
    return (id && authors[id]) || t('threads.someone', locale);
  }

  // ── escribir ───────────────────────────────────────────────────────────
  let body = $state('');
  let aboutPerf = $state('');
  let perfOptions = $derived(performanceOptions(performances, locale, tz));

  const postMutation = createMutation({
    mutationFn: (input: MessageCreate) => mutateJSON<{ message: ThreadMessage }>('POST', '/api/messages', input),
    onSuccess: () => {
      body = '';
      aboutPerf = '';
      onchange();
    },
    onError: (err) => failed(err, 'threads.not_sent'),
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

  /** Cmd/Ctrl+Intro envía; Intro solo es un salto de línea (un mensaje puede ser una lista). */
  function sendOnModEnter(event: KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      action();
    }
  }

  // ── corregir y borrar lo propio ────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let draft = $state('');

  const editMutation = createMutation({
    mutationFn: (input: { id: string; body: string }) =>
      mutateJSON('PATCH', `/api/messages/${input.id}`, { body: input.body }),
    onSuccess: () => {
      editingId = null;
      onchange();
    },
    onError: (err) => failed(err, 'threads.not_saved'),
  });

  const deleteMutation = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/messages/${id}`),
    onSuccess: () => onchange(),
    onError: (err) => failed(err, 'threads.not_deleted'),
  });

  function startEdit(m: ThreadMessage) {
    editingId = m.id;
    draft = m.body;
  }

  function saveEdit(m: ThreadMessage) {
    const text = draft.trim();
    if (!text || $editMutation.isPending) return;
    if (text === m.body) {
      editingId = null;
      return;
    }
    $editMutation.mutate({ id: m.id, body: text });
  }

  function remove(m: ThreadMessage) {
    if (!window.confirm(t('threads.delete_confirm', locale))) return;
    $deleteMutation.mutate(m.id);
  }

  function failed(err: unknown, titleKey: string) {
    addToast({
      tone: 'danger',
      title: t(titleKey, locale),
      message: t('perf.try_again', locale, {
        error: err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
    });
  }
</script>

<article class="thread" aria-labelledby={headingId} data-facet={thread.facet_key ?? 'general'}>
  <header class="thread__head">
    <h3 class="thread__name" id={headingId}>{name}</h3>
    <span class="thread__count">{thread.message_count}</span>
    {#if thread.unread_count > 0}
      <Badge tone="info" size="xs">{t('threads.unread', locale, { n: thread.unread_count })}</Badge>
    {/if}
  </header>
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

  {#if messages.length === 0}
    <p class="thread__empty">{t('threads.empty', locale)}</p>
  {:else}
    <ol class="thread__list">
      {#each messages as m (m.id)}
        {@const perf = m.performance_id ? perfById.get(m.performance_id) : undefined}
        {#if m.id === dividerId}
          <li class="thread__new" aria-label={t('threads.new_divider', locale)}>
            <span>{t('threads.new_divider', locale)}</span>
          </li>
        {/if}
        <li class="msg">
          <Avatar size="xs" name={authorName(m.author_id)} />
          <div class="msg__main">
            <p class="msg__head">
              <span class="msg__by">{authorName(m.author_id)}</span>
              <time datetime={m.created_at}>{messageWhen(m.created_at, locale, viewerTz)}</time>
              {#if m.edited_at}<span>{t('threads.edited', locale)}</span>{/if}
              {#if perf}
                <span class="tag-chip" data-tone="blue">{performanceTag(perf, locale, tz)}</span>
              {/if}
            </p>
            {#if editingId === m.id}
              <form
                class="msg__edit"
                onsubmit={(e) => {
                  e.preventDefault();
                  saveEdit(m);
                }}
              >
                <textarea
                  rows="2"
                  maxlength={MESSAGE_MAX}
                  aria-label={t('threads.edit_label', locale)}
                  bind:value={draft}
                  onkeydown={(e) => sendOnModEnter(e, () => saveEdit(m))}
                ></textarea>
                <div class="msg__edit-actions">
                  <Button variant="outline" size="xs" onclick={() => (editingId = null)}>{t('threads.cancel', locale)}</Button>
                  <Button type="submit" size="xs" loading={$editMutation.isPending} disabled={!draft.trim()}>
                    {t('threads.save', locale)}
                  </Button>
                </div>
              </form>
            {:else}
              <p class="msg__text">{m.body}</p>
            {/if}
          </div>
          {#if m.author_id === me && editingId !== m.id}
            <Menu align="end" triggerClass="kebab" label={t('threads.message_actions', locale)}>
              {#snippet trigger()}<span aria-hidden="true">⋯</span>{/snippet}
              {#snippet children({ close })}
                <li role="none">
                  <button type="button" role="menuitem" class="menu__item" onclick={() => { close(false); startEdit(m); }}>
                    {t('threads.edit', locale)}
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" class="menu__item menu__item--danger" onclick={() => { close(false); remove(m); }}>
                    {t('threads.delete', locale)}
                  </button>
                </li>
              {/snippet}
            </Menu>
          {/if}
        </li>
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
    .thread__name {
      margin: 0;
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
    .thread__empty {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    .thread__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin: var(--space-xs) 0 0;
      padding: 0;
      list-style: none;
    }

    /* La raya de «nuevos»: una línea y su palabra, sin color de alarma. */
    .thread__new {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      color: var(--info, var(--text-muted));
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .thread__new::after {
      content: '';
      flex: 1;
      border-block-start: 1px solid currentColor;
      opacity: 0.4;
    }

    .msg {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: start;
    }
    .msg__main {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .msg__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .msg__by {
      color: var(--heading-color);
      font-weight: 500;
    }
    .msg__text {
      margin: 0;
      color: var(--text-color);
      font-size: var(--text-s);
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .msg__edit {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .msg__edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-xs);
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
