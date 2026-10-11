<script lang="ts">
  /**
   * La ficha de una conversación de difusión (ADR-099, añadido del 2026-10-11).
   *
   * Un solo dato, el registro (`conversation_event`, ADR-098), con dos vistas
   * conmutables que son presentación, no dos modelos:
   *  - «registro»: lo hablado con fuera a la izquierda, el hilo del equipo al
   *    lado;
   *  - «hilo»: todo junto en una sola línea, de lo más antiguo a lo más nuevo.
   * El hilo del equipo llega con el carril 2 (hilos con facetas); hasta
   * entonces su sitio dice que todavía no existe, sin inventar mensajes.
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
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonthYear, dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import ConversationHistory from '$lib/components/ConversationHistory.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    eventDirectionLabel,
    eventKindLabel,
    relativeContactDate,
    statusBadgeClass,
    statusLabel,
    type ConversationEventItem,
    type ConversationItem,
  } from '$lib/conversation';
  import { firstLine, replySubject, type MailAccountsResponse } from '$lib/mail';

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

  type Conversation = ConversationItem & { private: boolean };

  const convQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation', workspaceSlug, slug] as const,
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
    },
  });

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

  let title = $derived(conv?.person?.organization_name || conv?.person?.full_name || slug);
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
        {t('conversations.conversation', locale)}{#if conv.project} · {conv.project.name}{/if}
      </p>
      <h1 class="conv__title"><em>{title}</em></h1>
      <p class="conv__sub">
        {#if conv.person && conv.person.full_name !== title}<span>{conv.person.full_name}</span>{/if}
        {#if conv.person?.email}<span>{conv.person.email}</span>{/if}
        {#if conv.person?.city}<span>{conv.person.city}</span>{/if}
        <span><span class={`badge badge--xs ${statusBadgeClass(conv.status)}`}>{statusLabel(conv.status, locale)}</span></span>
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
            <Button size="xs" variant="outline" disabled={!sendable.length || !conv.person?.email} onclick={() => startCompose(null)}>
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
          <details class="log">
            <summary>{t('mail.log_other', locale)}</summary>
            <ConversationHistory conversationId={conv.id} showList={false} />
          </details>
        {:else}
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub">{t('mail.thread', locale)} · {events.length}</h2>
            <Button size="xs" variant="outline" disabled={!sendable.length || !conv.person?.email} onclick={() => startCompose(null)}>
              {t('mail.write', locale)}
            </Button>
          </div>
          <ol class="flow" aria-label={t('mail.thread', locale)}>
            {#each oldestFirst as e (e.id)}
              <li>{@render card(e)}</li>
            {/each}
          </ol>
          {#if composing === 'new'}{@render composer()}{/if}
          <p class="conv__msg">{t('mail.team_later_thread', locale)}</p>
        {/if}
      </div>

      <aside class="conv__aside">
        <dl class="facts">
          <div>
            <dt>{t('mail.last_contact', locale)}</dt>
            <dd>{relativeContactDate(conv.last_contacted_at, locale)}</dd>
          </div>
          {#if conv.next_action_at || conv.next_action_note}
            <div>
              <dt>{t('mail.next_step', locale)}</dt>
              <dd>
                {conv.next_action_note ?? ''}{#if conv.next_action_at}<span class="muted"> · {dayMonthYear(conv.next_action_at)}</span>{/if}
              </dd>
            </div>
          {/if}
        </dl>

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
              onclick={() => $setPrivate.mutate(!conv!.private)}
            ><span class="toggle__dot"></span></button>
          </div>
          <p class="privacy__hint">
            {conv.private ? t('mail.private_on_hint', locale) : t('mail.private_off_hint', locale)}
          </p>
        </div>

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
          <div class="inside">
            <div class="block-head">
              <h2 class="eyebrow eyebrow--sub">{t('mail.inside_team', locale)}</h2>
            </div>
            <p class="muted">{t('mail.team_later', locale)}</p>
          </div>
        {/if}
      </aside>
    </div>
  </section>
{/if}

{#snippet via(e: ConversationEventItem)}
  {#if viaLabel(e)}
    <span class="mb" class:mb--shared={e.mailbox_scope === 'workspace'} title={e.mailbox_address ?? ''}>
      {t('mail.via', locale, { mailbox: viaLabel(e) ?? '' })}
    </span>
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
          <div class="mail">
            {#if e.mail_from}<p class="mail__meta"><span>{t('mail.from', locale)}</span> {e.mail_from}</p>{/if}
            {#if e.mail_to?.length}<p class="mail__meta"><span>{t('mail.to', locale)}</span> {e.mail_to.join(', ')}</p>{/if}
            {#if e.body}<p class="mail__text">{e.body}</p>{/if}
            {#if composing !== e.id}
              <div class="mail__actions">
                <Button size="xs" variant="outline" disabled={!sendable.length || !conv?.person?.email} onclick={() => startCompose(e)}>
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
    {#if e.body}<p class="card__text">{e.body}</p>{/if}
    {#if e.kind === 'email' && e.source === 'email' && composing !== e.id}
      <div class="mail__actions">
        <Button size="xs" variant="outline" disabled={!sendable.length || !conv?.person?.email} onclick={() => startCompose(e)}>
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
    <p class="reply__field"><span>{t('mail.to', locale)}</span> {conv?.person?.full_name} &lt;{conv?.person?.email}&gt;</p>
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

    .block-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      min-block-size: var(--control-size-s);
      padding-block-end: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }
    .block-head h2 {
      margin: 0;
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
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin-block-start: var(--space-xs);
      padding: var(--space-s) var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
    }
    .mail__meta {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
      overflow-wrap: anywhere;
    }
    .mail__meta span,
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
