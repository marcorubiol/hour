<script lang="ts">
  /**
   * La ficha de una conversación de difusión (ADR-099, añadido del 2026-10-11).
   *
   * Un solo dato, el registro (`conversation_event`, ADR-098), con dos vistas
   * conmutables que son presentación, no dos modelos:
   *  - «registro»: lo hablado con fuera a la izquierda, el hilo del equipo al
   *    lado;
   *  - «hilo»: todo junto en una sola línea, de lo más antiguo a lo más nuevo,
   *    cada mensaje del equipo con su marca «Solo el equipo».
   * El hilo del equipo (ADR-106) lo lee quien lee la conversación, privacidad
   * incluida. Como el tablón: sin realtime, se recarga al volver a la pestaña
   * y cada 30 s; lo nuevo se marca leído a la vista y la raya de «nuevos» se
   * queda donde estaba al abrir.
   *
   * Los correos los trae el buzón sincronizado; «Responder» y «Escribir correo»
   * envían por un buzón conectado y lo enviado vuelve al registro. La marca de
   * privada (punto 4) la hace invisible para el resto del espacio.
   *
   * El segmento [slug] admite también el id de la conversación.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonthYear, dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import ConversationHistory from '$lib/components/ConversationHistory.svelte';
  import ConversationStatusMenu from '$lib/components/ConversationStatusMenu.svelte';
  import NextActionDialog from '$lib/components/NextActionDialog.svelte';
  import MessageItem from '$lib/components/MessageItem.svelte';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import OrganizationFiscal from '$lib/components/OrganizationFiscal.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    eventDirectionLabel,
    eventKindLabel,
    conversationTitle,
    relativeContactDate,
    statusBadgeClass,
    statusLabel,
    type ConversationEventItem,
    type ConversationItem,
    type ConversationPatch,
  } from '$lib/conversation';
  import { followUpDue, turnOf } from '$lib/conversation-overview';
  import { firstLine, replySubject, type MailAccountsResponse } from '$lib/mail';
  import { markReadWhenSeen, readAtOpen, scrollWhenNamed } from '$lib/thread-reading.svelte';
  import { THREAD_REFRESH_MS, firstUnreadId, teamTimeline, type ConversationThreadView } from '$lib/threads';

  const locale = appLocale();
  const queryClient = useQueryClient();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let slug = $derived(page.params.slug ?? '');

  type Reading = 'registro' | 'hilo';
  let reading = $derived<Reading>(page.url.searchParams.get('vista') === 'hilo' ? 'hilo' : 'registro');
  function setReading(r: Reading) {
    const url = new URL(page.url);
    url.searchParams.set('vista', r);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }

  type Conversation = ConversationItem & { private: boolean; can_edit: boolean; can_set_private: boolean };

  const convQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation', workspaceSlug, slug] as const,
      // A 404 is the answer (someone else's private one, or no Converses):
      // retrying only keeps «Loading…» on screen (`permisos.md` § 7).
      retry: (count: number, err: unknown) => !(err instanceof ApiError && err.status === 404) && count < 3,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ item: Conversation }>(
          UUID.test(slug)
            ? `/api/conversations/${slug}`
            : `/api/conversations/${encodeURIComponent(slug)}?workspace=${encodeURIComponent(workspaceSlug)}`,
          signal,
        ),
    })),
  );
  let conv = $derived($convQuery.data?.item ?? null);

  const eventsQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-events', conv?.id ?? ''] as const,
      enabled: Boolean(conv?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ConversationEventItem[] }>(`/api/conversations/${conv!.id}/events`, signal),
    })),
  );
  let events = $derived($eventsQuery.data?.items ?? []);
  let oldestFirst = $derived([...events].reverse());

  const mailQuery = createQuery(
    toStore(() => ({
      queryKey: ['mail-accounts', conv?.workspace_id ?? ''] as const,
      enabled: Boolean(conv?.workspace_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<MailAccountsResponse>(`/api/mail/accounts?workspace_id=${conv!.workspace_id}`, signal),
    })),
  );
  // ── El hilo del equipo ──
  let teamKey = $derived(['conversation-thread', conv?.id ?? ''] as const);
  const teamQuery = createQuery(
    toStore(() => ({
      queryKey: teamKey,
      enabled: Boolean(conv?.id),
      // Siempre viejo: volver a la pestaña recarga (refetchOnWindowFocus).
      staleTime: 0,
      refetchInterval: THREAD_REFRESH_MS,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ConversationThreadView>(`/api/conversations/${conv!.id}/thread`, signal),
    })),
  );
  let team = $derived($teamQuery.data ?? null);
  const readAt = readAtOpen();
  let teamSince = $derived(team ? readAt('', team.thread.thread_id, team.reads) : null);
  let teamDivider = $derived(team ? firstUnreadId(team.messages, team.me, teamSince) : null);
  let timeline = $derived(teamTimeline(oldestFirst, team?.messages ?? []));
  function refreshTeam() {
    void queryClient.invalidateQueries({ queryKey: teamKey });
  }
  /** Lo que se mira del hilo: su bloque en «registro», la línea entera en «hilo». */
  let teamEl = $state<HTMLElement>();
  markReadWhenSeen({
    target: () => teamEl,
    threads: () => (team ? [team.thread] : []),
    onmarked: refreshTeam,
  });
  scrollWhenNamed('#team', () => (team ? teamEl : undefined));

  let sendable = $derived(($mailQuery.data?.items ?? []).filter((a) => a.status === 'active'));
  let mailboxes = $derived(
    [...new Map(events.filter((e) => e.mailbox_address).map((e) => [e.mailbox_address!, e.mailbox_scope])).entries()],
  );

  // ── Abrir correos ──
  let open = $state<Set<string>>(new Set());
  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    open = next;
  }

  // ── Componer: responder a un correo (replyTo) o uno nuevo ('new') ──
  let composing = $state<string | null>(null);
  let fromAccount = $state('');
  /** Con qué firma sale: la tuya en este espacio, o la de la compañía desde el común. */
  let fromSignature = $derived.by(() => {
    const scope = sendable.find((a) => a.id === fromAccount)?.scope;
    return scope ? ($mailQuery.data?.signatures?.[scope] ?? '') : '';
  });
  let subject = $state('');
  let body = $state('');

  function startCompose(e: ConversationEventItem | null) {
    composing = e ? e.id : 'new';
    subject = e ? replySubject(e.subject) : '';
    body = '';
    const preferred = e?.mail_account_id && sendable.some((a) => a.id === e.mail_account_id) ? e.mail_account_id : null;
    fromAccount = preferred ?? sendable.find((a) => a.scope === 'personal')?.id ?? sendable[0]?.id ?? '';
    if (e) open = new Set(open).add(e.id);
  }

  const send = createMutation({
    mutationFn: () =>
      mutateJSON('POST', '/api/mail/send', {
        conversation_id: conv!.id,
        account_id: fromAccount,
        subject: subject.trim(),
        body,
        reply_to_event_id: composing && composing !== 'new' ? composing : null,
      }),
    onSuccess: () => {
      composing = null;
      addToast({ tone: 'success', title: t('mail.sent', locale), message: subject });
    },
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.not_sent', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-events', conv?.id ?? ''] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // ── Privada ──
  const setPrivate = createMutation({
    mutationFn: (value: boolean) =>
      mutateJSON<{ private: boolean }>('PUT', `/api/conversations/${conv!.id}/private`, { private: value }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      // Quién lee el hilo del equipo cambia con la privacidad.
      void queryClient.invalidateQueries({ queryKey: ['thread-audience', 'conversation', conv?.id ?? ''] });
    },
  });

  // ADR-124: marking a shared one private makes it vanish for the rest of the
  // team, and only you can bring it back, so it asks first. Unmarking does not.
  function togglePrivate() {
    if (!conv) return;
    if (!conv.private && !window.confirm(t('mail.private_confirm', locale))) return;
    $setPrivate.mutate(!conv.private);
  }

  function what(e: ConversationEventItem): string {
    return e.direction
      ? `${eventKindLabel(e.kind, locale)} · ${eventDirectionLabel(e.direction, locale)}`
      : eventKindLabel(e.kind, locale);
  }
  function viaLabel(e: ConversationEventItem): string | null {
    if (!e.mailbox_address) return null;
    return e.mailbox_scope === 'workspace' ? t('mail.via_shared', locale) : e.mailbox_address;
  }
  function accountLabel(id: string): string {
    const a = sendable.find((x) => x.id === id);
    if (!a) return '';
    return `${a.address} · ${a.scope === 'personal' ? t('mail.your_mailbox', locale) : t('mail.shared_mailbox', locale)}`;
  }

  // ── Decidir desde la ficha (ADR-126 § 5): estado, turno y siguiente paso ──
  // Lo que el dashboard pide se resuelve aquí, sin volver a la lista.
  const patch = createMutation({
    mutationFn: (body: ConversationPatch) =>
      mutateJSON<{ item: ConversationItem }>('PATCH', `/api/conversations/${conv!.id}`, body),
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('conversations.change_not_saved', locale),
        message: err instanceof Error ? err.message : String(err),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    },
  });
  let nextOpen = $state(false);
  let turn = $derived(
    conv ? turnOf({ status: conv.status, last: conv.last_turn?.[0] ?? null, reply_settled_at: conv.reply_settled_at }, new Date()) : null,
  );
  let followUp = $derived(conv ? followUpDue(conv, new Date()) : false);
  /** «Anotar contacto…» del menú de estado: abre el apunte de abajo. */
  let logOpen = $state(false);
  let logEl = $state<HTMLElement>();
  function openLog() {
    if (reading !== 'registro') setReading('registro');
    logOpen = true;
    requestAnimationFrame(() => logEl?.scrollIntoView({ block: 'nearest' }));
  }

  // ADR-102: el título es la organización; debajo, el contacto principal.
  let title = $derived((conv && conversationTitle(conv)) || slug);
  /** A quién sale un correo: el contacto principal (`mail_send_authorize`). */
  let recipient = $derived.by(() => {
    const p = conv?.contacts.find((c) => c.is_primary)?.person ?? null;
    if (p?.email) return { full_name: p.full_name, email: p.email };
    return conv?.person?.email ? { full_name: conv.person.full_name, email: conv.person.email } : null;
  });
</script>

<svelte:head>
  <title>{title} · {t('conversations.conversation', locale)} · Hour</title>
</svelte:head>

{#if $convQuery.isLoading}
  <p class="conv__msg">{t('conversations.loading', locale)}</p>
{:else if !conv}
  <section class="conv">
    <p class="eyebrow">{t('conversations.conversation', locale)}</p>
    <p class="conv__msg">{t('mail.conv_not_found', locale)}</p>
    <p><a class="link-arrow" href="/h/conversations">{t('conversations.back', locale)}</a></p>
  </section>
{:else}
  <section class="conv">
    <header class="conv__mast">
      <p class="eyebrow">
        {t('conversations.conversation', locale)}{#if conv.project}&nbsp;· {conv.project.name}{/if}
      </p>
      <h1 class="conv__title"><em>{title}</em></h1>
      <p class="conv__sub">
        {#if conv.person && conv.person.full_name !== title}<span>{conv.person.full_name}</span>{/if}
        {#if conv.person?.email}<span>{conv.person.email}</span>{/if}
        {#if conv.person?.city || conv.organization?.city}<span>{conv.person?.city || conv.organization?.city}</span>{/if}
        {#if conv.private}<span class="conv__private">{t('mail.private_badge', locale)}</span>{/if}
      </p>
    </header>

    <div class="conv__bar">
      <div class="seg" role="group" aria-label={t('mail.view_label', locale)}>
        <button type="button" class:is-on={reading === 'registro'} aria-pressed={reading === 'registro'} onclick={() => setReading('registro')}>
          {t('mail.view_record', locale)}
        </button>
        <button type="button" class:is-on={reading === 'hilo'} aria-pressed={reading === 'hilo'} onclick={() => setReading('hilo')}>
          {t('mail.view_thread', locale)}
        </button>
      </div>
    </div>

    <div class="conv__grid" class:conv__grid--single={reading === 'hilo'}>
      <div class="conv__main">
        {#if reading === 'registro'}
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub">{t('mail.outside', locale)} · {events.length}</h2>
            <Button size="xs" variant="outline" disabled={!sendable.length || !recipient?.email} onclick={() => startCompose(null)}>
              {t('mail.write', locale)}
            </Button>
          </div>
          {#if composing === 'new'}{@render composer()}{/if}
          {#if $eventsQuery.isLoading}
            <p class="conv__msg">{t('conversations.loading', locale)}</p>
          {:else if events.length === 0}
            <p class="conv__msg">{t('conversations.history_empty', locale)}</p>
          {:else}
            <ol class="rec" aria-label={t('conversations.history', locale)}>
              {#each events as e (e.id)}
                {@render recordItem(e)}
              {/each}
            </ol>
          {/if}
          <details class="log" bind:open={logOpen} bind:this={logEl}>
            <summary>{t('mail.log_other', locale)}</summary>
            <p class="muted">{t('mail.log_turn_hint', locale)}</p>
            <ConversationHistory conversationId={conv.id} showList={false} />
          </details>
        {:else}
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub">{t('mail.thread', locale)} · {events.length}</h2>
            <Button size="xs" variant="outline" disabled={!sendable.length || !recipient?.email} onclick={() => startCompose(null)}>
              {t('mail.write', locale)}
            </Button>
          </div>
          <ol class="flow" aria-label={t('mail.thread', locale)} bind:this={teamEl}>
            {#each timeline as x (x.kind === 'event' ? x.event.id : x.message.id)}
              {#if x.kind === 'event'}
                <li>{@render card(x.event)}</li>
              {:else if team}
                <MessageItem
                  message={x.message}
                  author={(x.message.author_id && team.authors[x.message.author_id]) || ''}
                  mine={x.message.author_id === team.me}
                  mark={t('threads.team_only', locale)}
                  newBefore={x.message.id === teamDivider}
                  {locale}
                  onchange={refreshTeam}
                />
              {/if}
            {/each}
          </ol>
          {#if composing === 'new'}{@render composer()}{/if}
          {@render teamThread(false)}
        {/if}
      </div>

      <aside class="conv__aside">
        <dl class="facts">
          <div>
            <dt>{t('edit.status', locale)}</dt>
            <dd>
              {#if conv.can_edit}
                <ConversationStatusMenu
                  status={conv.status}
                  {locale}
                  onchange={(status) => $patch.mutate({ status })}
                  onlog={openLog}
                />
              {:else}
                <span class={`badge badge--xs ${statusBadgeClass(conv.status)}`}>{statusLabel(conv.status, locale)}</span>
              {/if}
            </dd>
          </div>
          <div>
            <dt>{t('mail.last_contact', locale)}</dt>
            <dd>{relativeContactDate(conv.last_contacted_at, locale)}</dd>
          </div>
          {#if turn || followUp}
            <div>
              <dt>{t('overview.col_turn', locale)}</dt>
              <dd class="facts__turn" class:facts__turn--ours={turn?.side === 'ours' || (!turn && followUp)}>
                {#if turn?.side === 'ours'}
                  {t('overview.turn_ours_cap', locale)} · {relativeContactDate(turn.since, locale)}
                  {#if conv.can_edit}
                    <button
                      type="button"
                      class="facts__act"
                      disabled={$patch.isPending}
                      onclick={() => $patch.mutate({ reply_settled_at: turn!.since })}>{t('overview.settle', locale)}</button
                    >
                  {/if}
                {:else if followUp}
                  {t('overview.follow_up_cap', locale)} · {dayMonthYear(conv.next_action_at!)}
                {:else if turn}
                  {t('overview.turn_theirs_cap', locale)} · {relativeContactDate(turn.since, locale)}
                {/if}
              </dd>
            </div>
          {/if}
          {#if conv.next_action_at || conv.next_action_note || conv.can_edit}
            <div>
              <dt>{t('mail.next_step', locale)}</dt>
              <dd>
                {conv.next_action_note ?? ''}{#if conv.next_action_at}<span class="muted">{conv.next_action_note ? ' · ' : ''}{dayMonthYear(conv.next_action_at)}</span>{/if}
                {#if conv.can_edit}
                  <button
                    type="button"
                    class="facts__act"
                    aria-label={conv.next_action_at || conv.next_action_note ? t('conversations.edit_next_action_aria', locale) : undefined}
                    onclick={() => (nextOpen = true)}
                    >{conv.next_action_at || conv.next_action_note
                      ? t('conversations.edit_next_action', locale)
                      : t('conversations.set_next_action', locale)}</button
                  >
                {/if}
              </dd>
            </div>
          {/if}
        </dl>

        {#if conv.organization}
          <OrganizationFiscal organizationId={conv.organization.id} />
        {/if}

        {#if conv.can_set_private}
        <div class="privacy">
          <div class="privacy__row">
            <span class="privacy__label">{t('mail.private_label', locale)}</span>
            <button
              type="button"
              class="toggle"
              class:is-on={conv.private}
              role="switch"
              aria-checked={conv.private}
              aria-label={t('mail.private_label', locale)}
              disabled={$setPrivate.isPending}
              onclick={togglePrivate}
            ><span class="toggle__dot"></span></button>
          </div>
          <p class="privacy__hint">
            {conv.private ? t('mail.private_on_hint', locale) : t('mail.private_off_hint', locale)}
          </p>
        </div>
        {/if}

        <div class="legend">
          <p class="eyebrow eyebrow--sub">{t('mail.mailboxes_here', locale)}</p>
          {#if mailboxes.length}
            {#each mailboxes as [address, scope] (address)}
              <p class="legend__row">
                <span class="mb" class:mb--shared={scope === 'workspace'}>
                  {scope === 'workspace' ? t('mail.shared_mailbox', locale) : t('mail.personal_mailbox', locale)}
                </span>
                <span class="muted">{address}</span>
              </p>
            {/each}
          {:else}
            <p class="muted">{t('mail.no_mail_yet', locale)}</p>
          {/if}
        </div>

        {#if reading === 'registro'}
          <div class="inside" bind:this={teamEl}>
            {@render teamThread(true)}
          </div>
        {/if}
      </aside>
    </div>
  </section>
{/if}

{#if conv}
  <NextActionDialog
    bind:open={nextOpen}
    who={conv.person && conv.person.full_name !== title ? `${title} · ${conv.person.full_name}` : title}
    date={conv.next_action_at ? conv.next_action_at.slice(0, 10) : ''}
    note={conv.next_action_note ?? ''}
    {locale}
    onsave={(next) => $patch.mutate(next)}
  />
{/if}

{#snippet teamThread(list: boolean)}
  {#if team && conv}
    <ThreadBlock
      thread={team.thread}
      anchorKind="conversation"
      anchorId={conv.id}
      title={t('threads.team', locale)}
      messages={team.messages}
      authors={team.authors}
      me={team.me}
      newSince={teamSince}
      tz={Intl.DateTimeFormat().resolvedOptions().timeZone}
      {list}
      {locale}
      onchange={refreshTeam}
    />
  {:else if $teamQuery.isError}
    <p class="muted">{t('threads.team_error', locale)}</p>
  {/if}
{/snippet}

{#snippet via(e: ConversationEventItem)}
  {#if viaLabel(e)}
    <span class="mb" class:mb--shared={e.mailbox_scope === 'workspace'} title={e.mailbox_address ?? ''}>
      {t('mail.via', locale, { mailbox: viaLabel(e) ?? '' })}
    </span>
  {/if}
  {#if e.mailout_id && e.kind === 'email'}
    <a class="mb" href={`/h/${workspaceSlug}/mailout/${e.mailout_id}`} data-testid="event-mailout">{t('mailout.of_mailout', locale)}</a>
  {/if}
{/snippet}

{#snippet recordItem(e: ConversationEventItem)}
  <li class="rec__item" class:rec__item--in={e.direction === 'inbound'}>
    <time class="rec__when" datetime={e.occurred_at}>{dayMonthYearTs(e.occurred_at)}</time>
    <div class="rec__body">
      {#if e.kind === 'email' && e.source === 'email'}
        <button type="button" class="rec__head" aria-expanded={open.has(e.id)} onclick={() => toggle(e.id)}>
          <span class="rec__what">{what(e)}{@render via(e)}</span>
          {#if e.subject}<span class="rec__subject">{e.subject}</span>{/if}
          {#if !open.has(e.id)}<span class="rec__snippet">{firstLine(e.body)}</span>{/if}
        </button>
        {#if open.has(e.id)}
          <div class="mail mail-card">
            {#if e.mail_from}<p class="mail-card__meta"><span>{t('mail.from', locale)}</span> {e.mail_from}</p>{/if}
            {#if e.mail_to?.length}<p class="mail-card__meta"><span>{t('mail.to', locale)}</span> {e.mail_to.join(', ')}</p>{/if}
            {#if e.body}<p class="mail__text">{e.body}</p>{/if}
            {#if composing !== e.id}
              <div class="mail__actions">
                <Button size="xs" variant="outline" disabled={!sendable.length || !recipient?.email} onclick={() => startCompose(e)}>
                  {t('mail.reply', locale)}
                </Button>
              </div>
            {:else}
              {@render composer()}
            {/if}
          </div>
        {/if}
      {:else}
        <span class="rec__what">{what(e)}</span>
        {#if e.mailout_note}<p class="rec__note">{t(`mailout.note_${e.mailout_note}`, locale)}</p>{/if}
        {#if e.body}<p class="rec__note">{e.body}</p>{/if}
      {/if}
    </div>
  </li>
{/snippet}

{#snippet card(e: ConversationEventItem)}
  <div class="card" class:card--in={e.direction === 'inbound'}>
    <p class="card__head">
      <span class="rec__what">{what(e)}</span>{@render via(e)}
      <time class="rec__when" datetime={e.occurred_at}>{dayMonthYearTs(e.occurred_at)}</time>
    </p>
    {#if e.subject}<p class="rec__subject">{e.subject}</p>{/if}
    {#if e.mailout_note}<p class="card__text">{t(`mailout.note_${e.mailout_note}`, locale)}</p>{/if}
    {#if e.body}<p class="card__text">{e.body}</p>{/if}
    {#if e.kind === 'email' && e.source === 'email' && composing !== e.id}
      <div class="mail__actions">
        <Button size="xs" variant="outline" disabled={!sendable.length || !recipient?.email} onclick={() => startCompose(e)}>
          {t('mail.reply', locale)}
        </Button>
      </div>
    {:else if composing === e.id}
      {@render composer()}
    {/if}
  </div>
{/snippet}

{#snippet composer()}
  <form
    class="reply"
    onsubmit={(ev) => {
      ev.preventDefault();
      if (fromAccount && subject.trim() && body.trim()) $send.mutate();
    }}
  >
    <label class="reply__field">
      <span>{t('mail.from', locale)}</span>
      <select bind:value={fromAccount}>
        {#each sendable as a (a.id)}
          <option value={a.id}>{accountLabel(a.id)}</option>
        {/each}
      </select>
    </label>
    <p class="reply__field"><span>{t('mail.to', locale)}</span> {recipient?.full_name} &lt;{recipient?.email}&gt;</p>
    <label class="reply__field">
      <span>{t('mail.subject', locale)}</span>
      <input type="text" maxlength="500" bind:value={subject} required />
    </label>
    <textarea rows="5" maxlength="20000" aria-label={t('mail.body', locale)} bind:value={body} required></textarea>
    {#if fromSignature}
      <p class="reply__sig">-- <br />{fromSignature}</p>
    {/if}
    <div class="reply__row">
      <span class="muted">{t('mail.send_hint', locale, { address: sendable.find((a) => a.id === fromAccount)?.address ?? '' })}</span>
      <span class="reply__btns">
        <Button size="xs" variant="outline" onclick={() => (composing = null)}>{t('mail.discard', locale)}</Button>
        <Button size="xs" type="submit" disabled={$send.isPending || !fromAccount || !subject.trim() || !body.trim()}>
          {t('mail.send', locale)}
        </Button>
      </span>
    </div>
  </form>
{/snippet}

<style>
  @layer components {
    .conv {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .conv__mast {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .conv__mast p,
    .conv__title {
      margin: 0;
    }
    .conv__title em {
      font-style: italic;
    }
    .conv__sub {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .conv__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    .conv__private {
      color: var(--heading-color);
      font-weight: 500;
    }
    .conv__msg {
      padding-block: var(--space-m);
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }
    .conv__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-s) var(--space-m);
    }

    .seg {
      display: inline-flex;
      padding: 2px;
      background: var(--bg-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
    }
    .seg button {
      appearance: none;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      color: var(--text-muted);
      background: transparent;
      border: 0;
      border-radius: var(--radius-s);
      font: inherit;
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .seg button.is-on {
      color: var(--text-color);
      background: var(--bg-ultra-light);
      box-shadow: var(--box-shadow-1);
      font-weight: 500;
    }

    .conv__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
      gap: var(--space-xl);
      align-items: start;
    }
    @media (max-width: 63.999rem) {
      .conv__grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-l);
      }
    }


    .rec {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rec__item {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-s);
      border-block-end: var(--divider);
    }
    .rec__when {
      padding-block-start: 0.1em;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .rec__body {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .rec__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding: 0;
      color: inherit;
      text-align: start;
      background: none;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    .rec__what {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      color: var(--text-dark-muted);
      font-size: var(--text-xs);
    }
    .rec__item--in .rec__what {
      color: var(--heading-color);
    }
    .rec__subject {
      margin: 0;
      color: var(--heading-color);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .rec__snippet {
      margin: 0;
      overflow: hidden;
      color: var(--text-muted);
      font-size: var(--text-s);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rec__note {
      margin: 0;
      font-size: var(--text-s);
      white-space: pre-line;
    }

    .mb {
      padding-inline: var(--space-xs);
      color: var(--text-dark-muted);
      background: var(--tag-neutral-bg);
      border-radius: var(--radius-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .mb--shared {
      color: var(--tag-blue-fg);
      background: var(--tag-blue-bg);
    }

    .mail {
      margin-block-start: var(--space-xs);
    }
    .reply__field > span {
      display: inline-block;
      min-inline-size: 3.5rem;
      color: var(--text-faint);
    }
    .mail__text {
      margin: var(--space-s) 0 0;
      font-size: var(--text-s);
      white-space: pre-line;
    }
    .mail__actions {
      display: flex;
      justify-content: flex-end;
      margin-block-start: var(--space-s);
    }

    .log {
      margin-block-start: var(--space-m);
      font-size: var(--text-s);
    }
    .log summary {
      color: var(--text-dark-muted);
      cursor: pointer;
    }

    .reply {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block: var(--space-s);
      padding-block-start: var(--space-s);
      border-block-start: 1px solid var(--border-color-light);
    }
    .reply__field {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
      overflow-wrap: anywhere;
    }
    .reply__field select,
    .reply__field input {
      flex: 1;
      min-inline-size: 0;
      padding: var(--space-2xs) var(--space-xs);
      color: var(--text-color);
      background: var(--bg-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      font: inherit;
    }
    .reply textarea {
      inline-size: 100%;
      padding: var(--space-xs) var(--space-s);
      color: var(--text-color);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      font: inherit;
      font-size: var(--text-s);
      resize: vertical;
    }
    .reply__sig {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
      white-space: pre-line;
    }
    .reply__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-xs) var(--space-s);
      font-size: var(--text-xs);
    }
    .reply__btns {
      display: inline-flex;
      gap: var(--space-xs);
    }

    .muted {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    .conv__aside {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .facts {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin: 0;
    }
    .facts dt {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .facts dd {
      margin: 0;
      font-size: var(--text-s);
    }
    .facts__turn--ours {
      font-weight: 500;
    }
    .facts__act {
      margin-inline-start: var(--space-xs);
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: var(--text-xs);
      font-weight: 400;
      text-decoration: underline;
      text-underline-offset: 0.2em;
      cursor: pointer;
    }
    .facts__act:hover {
      color: var(--text-color);
    }
    @media (pointer: coarse) {
      .facts__act {
        min-block-size: var(--touch-target);
      }
    }
    .privacy {
      padding-block: var(--space-s);
      border-block: 1px solid var(--border-color-light);
    }
    .privacy__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }
    .privacy__label {
      font-size: var(--text-s);
      font-weight: 500;
    }
    .privacy__hint {
      margin: var(--space-xs) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      inline-size: 36px;
      block-size: 20px;
      padding: 2px;
      background: var(--border-color-dark);
      border: 0;
      border-radius: var(--radius-circle);
      cursor: pointer;
      transition: background var(--transition);
    }
    .toggle__dot {
      inline-size: 16px;
      block-size: 16px;
      background: var(--bg-ultra-light);
      border-radius: 50%;
      box-shadow: var(--box-shadow-1);
      transition: transform var(--transition);
    }
    .toggle.is-on {
      background: var(--text-color);
    }
    .toggle.is-on .toggle__dot {
      transform: translateX(16px);
    }

    .legend,
    .inside {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .legend p {
      margin: 0;
    }
    .legend__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      font-size: var(--text-xs);
    }

    .flow {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      list-style: none;
      margin: 0;
      padding: var(--space-m) 0;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding: var(--space-s) var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-inline-start: 2px solid var(--border-color-dark);
      border-radius: var(--radius);
    }
    .card--in {
      border-inline-start-color: var(--heading-color);
    }
    .card p {
      margin: 0;
    }
    .card__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
    }
    .card__head .rec__when {
      margin-inline-start: auto;
    }
    .card__text {
      font-size: var(--text-s);
      white-space: pre-line;
    }

    @media (max-width: 47.999rem) {
      .rec__item {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  }
</style>
