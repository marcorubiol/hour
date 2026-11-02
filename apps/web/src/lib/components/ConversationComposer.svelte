<script module lang="ts">
  /** Adónde va lo que se escribe al pie de una conversación. */
  export type ComposerTarget = 'mail' | 'team' | 'log';
</script>

<script lang="ts">
  /**
   * El campo de escribir de una conversación (punto 110): uno solo, con tres
   * destinos, que funde «Escribir correo», el compositor del hilo del equipo
   * y «Apuntar llamada».
   *  - «Correo a <contacto principal>», el de por defecto (Marco, 2026-11-02):
   *    un correo es un borrador con asunto y firma que sale por un buzón
   *    conectado (ADR-099, ADR-100), así que Intro hace salto de línea y
   *    ⌘/Ctrl+Intro envía. Responde al último correo de fuera con su asunto;
   *    «Abrir como correo» lo despliega entero (de, para, asunto, materiales,
   *    textos guardados, firma).
   *  - «Solo el equipo»: un mensaje del hilo del equipo (ADR-106), que se ve
   *    intercalado en el hilo. Intro envía, como en un grupo.
   *  - «Apuntar llamada o nota»: un `conversation_event` que no se manda a
   *    nadie (ADR-098), con su tipo y su día.
   * Sin buzón que envíe (o sin email del contacto) el correo dice por qué y el
   * destino pasa a «Apuntar», mientras no se haya elegido otro a mano.
   */
  import { tick } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { localDayISO } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { messageFailed } from '$lib/components/MessageItem.svelte';
  import {
    CONVERSATION_EVENT_KINDS,
    EVENT_BODY_MAX,
    eventKindLabel,
    occurredAtForDay,
    type ConversationEventCreate,
    type ConversationEventItem,
    type ConversationEventKind,
  } from '$lib/conversation';
  import { MAIL_BODY_MAX, insertBlock, materialLine, replySubject, type MailAccountsResponse } from '$lib/mail';
  import { kindLabel, type MaterialItem } from '$lib/material';
  import { sortTexts, workspaceTextsQueryOptions, type WorkspaceText } from '$lib/workspace-texts';
  import { safeHref } from '$lib/utils/safe-url';
  import { MESSAGE_MAX, audienceLine, type MessageCreate, type ThreadAudience } from '$lib/threads';
  import { senderName } from '$lib/conversation-thread';

  interface Props {
    conversation: { id: string; workspace_id: string; line_id: string | null; can_edit: boolean };
    workspaceSlug: string;
    /** A quién sale un correo: el contacto principal (`mail_send_authorize`). */
    recipient: { full_name: string; email: string } | null;
    /** Los buzones del espacio; undefined mientras se leen. */
    mail: MailAccountsResponse | undefined;
    /** El correo al que se responde: el último de fuera, o el que se eligió con «Responder». */
    replyTo: ConversationEventItem | null;
    target?: ComposerTarget;
    locale: Locale;
    /** Ya salió: el dueño recarga lo suyo y baja al final del hilo. */
    onsent: (target: ComposerTarget) => void;
  }

  let {
    conversation: conv,
    workspaceSlug,
    recipient,
    mail,
    replyTo,
    target = $bindable('mail'),
    locale,
    onsent,
  }: Props = $props();

  const queryClient = useQueryClient();
  // Página y vistazo pueden dibujar la misma ficha: ids propios de esta.
  const uid = $props.id();
  const ids = { body: `${uid}-body`, subject: `${uid}-subject`, from: `${uid}-from`, to: `${uid}-to`, hint: `${uid}-hint` };

  /**
   * Un borrador por destino: lo escrito para el equipo no se vuelve cuerpo de
   * un correo al cambiar de destino (ni al pulsar «Responder»).
   */
  let drafts = $state<Record<ComposerTarget, string>>({ mail: '', team: '', log: '' });
  let body = $derived(drafts[target]);
  let field = $state<HTMLTextAreaElement>();
  /** Se eligió destino a mano: la falta de buzón ya no lo mueve. */
  let chosen = $state(false);

  /** Correo sólo sale con `edit:conversation` (`mail_send_authorize`): sin él, el equipo. */
  $effect.pre(() => {
    if (!conv.can_edit && target !== 'team') target = 'team';
  });

  /** ⌘ en un Mac, Ctrl en el resto: lo que el atajo de enviar dice. */
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
  /** «Abrir como correo»: de, para, asunto, insertar y firma a la vista. */
  let full = $state(false);

  export function focus(next?: ComposerTarget) {
    if (next) choose(next);
    void tick().then(() => field?.focus());
  }

  function choose(next: ComposerTarget) {
    chosen = true;
    target = next;
  }

  // ── Correo ──────────────────────────────────────────────────────────────
  let sendable = $derived((mail?.items ?? []).filter((a) => a.status === 'active'));
  let mailBlocked = $derived<'no_mailbox' | 'no_email' | null>(
    !mail ? null : sendable.length === 0 ? 'no_mailbox' : !recipient?.email ? 'no_email' : null,
  );
  // Sin buzón ni email, el campo pasa a «Apuntar»; nunca con algo escrito.
  $effect(() => {
    if (mailBlocked && !chosen && target === 'mail' && !drafts.mail.trim()) target = conv.can_edit ? 'log' : 'team';
  });

  let accountPick = $state('');
  let fromAccount = $derived.by(() => {
    if (accountPick && sendable.some((a) => a.id === accountPick)) return accountPick;
    const preferred = replyTo?.mail_account_id;
    if (preferred && sendable.some((a) => a.id === preferred)) return preferred;
    return sendable.find((a) => a.scope === 'personal')?.id ?? sendable[0]?.id ?? '';
  });
  let from = $derived(sendable.find((a) => a.id === fromAccount) ?? null);
  let signature = $derived(from ? (mail?.signatures?.[from.scope] ?? '') : '');

  /**
   * El asunto: el de la respuesta mientras no se toque; abierto como correo,
   * se edita. Lo escrito vale para el correo al que se respondía: con otro,
   * vuelve su asunto (una recarga del hilo no lo pisa, el id es el mismo).
   */
  let subjectEdit = $state<{ for: string; text: string } | null>(null);
  let subject = $derived(
    subjectEdit && subjectEdit.for === (replyTo?.id ?? '') ? subjectEdit.text : replySubject(replyTo?.subject),
  );

  function accountLabel(a: (typeof sendable)[number]): string {
    return `${a.address} · ${a.scope === 'personal' ? t('mail.your_mailbox', locale) : t('mail.shared_mailbox', locale)}`;
  }

  const materialsQuery = createQuery(
    toStore(() => ({
      queryKey: ['line-materials', conv.line_id ?? ''] as const,
      enabled: Boolean(conv.line_id) && full,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MaterialItem[] }>(`/api/lines/${conv.line_id}/materials`, signal),
    })),
  );
  let materialActions = $derived.by(() => {
    if ($materialsQuery.isPending) return [{ label: t('mail.material_loading', locale), disabled: true }];
    const items = ($materialsQuery.data?.items ?? []).filter((m) => safeHref(m.url));
    if (items.length === 0) return [{ label: t('mail.material_none', locale), disabled: true }];
    return items.map((m) => ({
      label: m.notes ? `${kindLabel(m.kind, locale)} · ${m.notes}` : kindLabel(m.kind, locale),
      onclick: () => void insertAtCaret(materialLine(kindLabel(m.kind, locale), m.url)),
    }));
  });
  const textsQuery = createQuery(toStore(() => workspaceTextsQueryOptions(conv.workspace_id, full)));
  let textActions = $derived.by(() => {
    if ($textsQuery.isPending) return [{ label: t('mail.text_loading', locale), disabled: true }];
    const items = sortTexts($textsQuery.data?.items ?? []);
    if (items.length === 0) return [{ label: t('mail.text_none', locale), disabled: true }];
    return items.map((x: WorkspaceText) => ({ label: x.title, onclick: () => void insertAtCaret(x.body) }));
  });

  /** En el cursor del texto (donde se dejó), en su propia línea. */
  async function insertAtCaret(insert: string) {
    const r = insertBlock(drafts.mail, insert, field?.selectionStart ?? drafts.mail.length, field?.selectionEnd ?? drafts.mail.length);
    drafts.mail = r.text;
    await tick();
    field?.focus();
    field?.setSelectionRange(r.caret, r.caret);
  }

  const sendMail = createMutation({
    mutationFn: () =>
      mutateJSON('POST', '/api/mail/send', {
        conversation_id: conv.id,
        account_id: fromAccount,
        subject: subject.trim(),
        body: drafts.mail,
        reply_to_event_id: replyTo?.id ?? null,
      }),
    onSuccess: () => {
      addToast({ tone: 'success', title: t('mail.sent', locale), message: subject });
      drafts.mail = '';
      full = false;
      subjectEdit = null;
      onsent('mail');
    },
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.not_sent', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-events', conv.id] });
      void refreshAfterWrite(queryClient, ['conversations']);
    },
  });

  // ── Solo el equipo ──────────────────────────────────────────────────────
  // La misma lectura que el bloque del hilo: una clave por ancla y faceta.
  const audienceQuery = createQuery(
    toStore(() => ({
      queryKey: ['thread-audience', 'conversation', conv.id, ''] as const,
      enabled: target === 'team',
      staleTime: 5 * 60_000,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ThreadAudience>(`/api/threads/audience?anchor_kind=conversation&anchor_id=${conv.id}&facet_id=`, signal),
    })),
  );

  const postTeam = createMutation({
    mutationFn: (input: MessageCreate) => mutateJSON('POST', '/api/messages', input),
    onSuccess: () => {
      drafts.team = '';
      onsent('team');
    },
    onError: (err) => messageFailed(err, 'threads.not_sent', locale),
  });

  // ── Apuntar ─────────────────────────────────────────────────────────────
  // «Llamada», saliente, hoy: lo que más se apunta a mano (la difusión que
  // sale por correo ya la trae el buzón).
  let logKind = $state<ConversationEventKind>('call');
  let logDirection = $state<'outbound' | 'inbound' | ''>('outbound');
  let logDay = $state(localDayISO());
  let futureDay = $derived(logDay > localDayISO());

  /** «Llamar» desde el teléfono del contacto: el destino pasa a apuntar la llamada. */
  export function startCall() {
    logKind = 'call';
    logDirection = 'outbound';
    logDay = localDayISO();
    focus('log');
  }

  const logEvent = createMutation({
    mutationFn: (event: ConversationEventCreate) =>
      mutateJSON<{ item: ConversationEventItem }>('POST', `/api/conversations/${conv.id}/events`, event),
    onSuccess: (data) => {
      drafts.log = '';
      logDay = localDayISO();
      // Sale ya en el hilo, sin esperar a la recarga (que llega después y manda).
      const item = data?.item;
      if (item) {
        queryClient.setQueryData<{ items: ConversationEventItem[]; last_read_at?: string | null }>(
          ['conversation-events', conv.id],
          (old) =>
            old && !old.items.some((e) => e.id === item.id)
              ? {
                  ...old,
                  items: [item, ...old.items].sort(
                    (a, b) =>
                      Date.parse(b.occurred_at) - Date.parse(a.occurred_at) ||
                      Date.parse(b.recorded_at) - Date.parse(a.recorded_at),
                  ),
                }
              : old,
        );
      }
      onsent('log');
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('conversations.not_recorded', locale),
        message: t('perf.try_again', locale, { error: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
      }),
    onSettled: () => {
      void refreshAfterWrite(queryClient, ['conversation-events', conv.id]);
      void refreshAfterWrite(queryClient, ['conversations']);
      void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    },
  });

  // ── Enviar ──────────────────────────────────────────────────────────────
  let busy = $derived($sendMail.isPending || $postTeam.isPending || $logEvent.isPending);
  let ready = $derived.by(() => {
    if (busy) return false;
    if (target === 'mail') return !mailBlocked && Boolean(fromAccount) && body.trim() !== '';
    if (target === 'team') return body.trim() !== '';
    return Boolean(logDay) && !futureDay;
  });

  async function submit(event?: SubmitEvent) {
    event?.preventDefault();
    if (!ready) return;
    if (target === 'mail') {
      // Sin asunto que heredar, el correo se abre entero para ponerlo.
      if (!subject.trim()) {
        full = true;
        await tick();
        document.getElementById(ids.subject)?.focus();
        return;
      }
      $sendMail.mutate();
    } else if (target === 'team') {
      $postTeam.mutate({
        anchor_kind: 'conversation',
        anchor_id: conv.id,
        facet_id: null,
        performance_id: null,
        body: drafts.team.trim(),
      });
    } else {
      $logEvent.mutate({
        kind: logKind,
        direction: logDirection || null,
        body: drafts.log.trim() || null,
        occurred_at: occurredAtForDay(logDay),
      });
    }
  }

  /**
   * Intro en un campo de una línea (el asunto, el día) no envía nada: el
   * correo sale sólo desde el texto o el botón, y lo apuntado no se deshace.
   */
  let formEl = $state<HTMLFormElement>();
  $effect(() => {
    const guard = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
    };
    formEl?.addEventListener('keydown', guard);
    return () => formEl?.removeEventListener('keydown', guard);
  });

  /** Intro envía en el equipo; en un correo y en lo apuntado es un salto de línea y ⌘/Ctrl+Intro envía. */
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return;
    if ((target === 'team' && !e.shiftKey) || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      void submit();
    }
  }

  let name = $derived(recipient?.full_name ?? '');
  /** Quien escribió el correo al que se responde, si no es a quien sale la respuesta. */
  let replySender = $derived.by(() => {
    const who = senderName(replyTo?.mail_from);
    return who && who !== name && who.toLowerCase() !== recipient?.email.toLowerCase() ? who : '';
  });
  let placeholder = $derived(
    target === 'mail'
      ? replySender
        ? t('thread.mail_placeholder_reply_other', locale, { name, sender: replySender })
        : t(replyTo ? 'thread.mail_placeholder_reply' : 'thread.mail_placeholder', locale, { name })
      : target === 'team'
        ? t('thread.team_placeholder', locale)
        : t('thread.log_placeholder', locale),
  );
</script>

<form
  class="composer"
  class:composer--team={target === 'team'}
  onsubmit={submit}
  bind:this={formEl}
  data-testid="thread-composer"
>
  <div class="composer__targets" role="group" aria-label={t('thread.target_label', locale)}>
    {#if conv.can_edit}
      <button
        type="button"
        class="composer__target"
        aria-pressed={target === 'mail'}
        data-testid="composer-to-mail"
        onclick={() => focus('mail')}
      >
        {#if name}{t('thread.to_mail', locale, { name })}{:else}{t('thread.to_mail_none', locale)}{/if}
      </button>
    {/if}
    <button
      type="button"
      class="composer__target"
      aria-pressed={target === 'team'}
      data-testid="composer-to-team"
      onclick={() => focus('team')}>{t('threads.team_only', locale)}</button
    >
    {#if conv.can_edit}
      <button
        type="button"
        class="composer__target"
        aria-pressed={target === 'log'}
        data-testid="composer-to-log"
        onclick={() => focus('log')}
        ><span class="composer__long">{t('thread.to_log', locale)}</span><span class="composer__short"
          >{t('thread.to_log_short', locale)}</span
        ></button
      >
    {/if}
  </div>

  {#if target === 'mail' && full}
    <div class="composer__mail">
      <Select id={ids.from} label={t('mail.from', locale)} value={fromAccount} onchange={(e) => (accountPick = (e.currentTarget as HTMLSelectElement).value)}>
        {#each sendable as a (a.id)}
          <option value={a.id}>{accountLabel(a)}</option>
        {/each}
      </Select>
      <Field id={ids.to} label={t('mail.to', locale)} group>
        <span class="composer__to">{recipient?.full_name} &lt;{recipient?.email}&gt;</span>
      </Field>
      <Input
        id={ids.subject}
        label={t('mail.subject', locale)}
        value={subject}
        oninput={(e) => (subjectEdit = { for: replyTo?.id ?? '', text: (e.currentTarget as HTMLInputElement).value })}
        required
      />
    </div>
  {/if}

  {#if target === 'log'}
    <div class="composer__log">
      <select bind:value={logKind} aria-label={t('conversations.event_kind', locale)}>
        {#each CONVERSATION_EVENT_KINDS as k (k)}
          <option value={k}>{eventKindLabel(k, locale)}</option>
        {/each}
      </select>
      <select bind:value={logDirection} aria-label={t('create.direction', locale)}>
        <option value="outbound">{t('thread.dir_out', locale)}</option>
        <option value="inbound">{t('thread.dir_in', locale)}</option>
        <option value="">{t('thread.direction_none', locale)}</option>
      </select>
      <input type="date" bind:value={logDay} max={localDayISO()} aria-label={t('conversations.event_day', locale)} />
    </div>
  {/if}

  <div class="composer__row">
    <textarea
      id={ids.body}
      rows="1"
      maxlength={target === 'team' ? MESSAGE_MAX : target === 'log' ? EVENT_BODY_MAX : MAIL_BODY_MAX}
      {placeholder}
      aria-label={placeholder}
      aria-describedby={ids.hint}
      disabled={target === 'mail' && Boolean(mailBlocked)}
      bind:value={drafts[target]}
      bind:this={field}
      onkeydown={onKey}
    ></textarea>
    <span class="composer__btns">
      {#if target === 'mail' && !mailBlocked}
        <Button size="s" variant="secondary" onclick={() => (full = !full)}>
          {full ? t('thread.close_mail', locale) : t('thread.open_as_mail', locale)}
        </Button>
      {/if}
      <Button size="s" type="submit" loading={busy} disabled={!ready}>
        {target === 'log' ? t('thread.log_send', locale) : t('mail.send', locale)}
      </Button>
    </span>
  </div>

  {#if target === 'mail' && full}
    <div class="composer__insert">
      {#if conv.line_id}
        <Menu items={materialActions} align="start" label={t('mail.insert_material', locale)} triggerClass="btn--quiet btn--xs">
          {#snippet trigger()}{t('mail.insert_material', locale)}<span aria-hidden="true"> ▾</span>{/snippet}
        </Menu>
      {/if}
      <Menu items={textActions} align="start" label={t('mail.insert_text', locale)} triggerClass="btn--quiet btn--xs">
        {#snippet trigger()}{t('mail.insert_text', locale)}<span aria-hidden="true"> ▾</span>{/snippet}
      </Menu>
    </div>
    {#if signature}<p class="composer__sig">-- <br />{signature}</p>{/if}
  {/if}

  <p class="composer__hint" id={ids.hint} data-testid="write-why">
    {#if target === 'mail'}
      {#if mailBlocked}
        {t(`record.write_${mailBlocked}`, locale)}{#if mailBlocked === 'no_mailbox'}{' · '}<a
            href={`/h/${workspaceSlug}/settings?section=mail`}>{t('record.write_to_settings', locale)}</a
          >{/if}
      {:else if from && subject.trim()}
        {t('thread.mail_hint', locale, { address: from.address, subject, mod })}
      {:else if from}
        {t('thread.mail_hint_new', locale, { address: from.address })}
      {/if}
    {:else if target === 'team'}
      {#if $audienceQuery.data}{audienceLine($audienceQuery.data, locale)} · {/if}{t('thread.team_hint', locale)}
    {:else}
      {futureDay ? t('conversations.not_future', locale) : t('thread.log_hint', locale, { mod })}
    {/if}
  </p>
</form>

<style>
  @layer components {
    .composer {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      container-type: inline-size;
    }
    .composer__targets {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2xs) var(--space-xs);
    }
    /* The three places a word can go: the chosen one in a soft pill, the
       others as quiet words beside it. */
    .composer__target {
      padding: var(--space-2xs) var(--space-s);
      color: var(--text-muted);
      background: none;
      border: var(--line-hairline) solid transparent;
      border-radius: var(--radius-circle);
      font: inherit;
      font-size: var(--text-s);
      cursor: pointer;
      transition:
        color var(--transition),
        border-color var(--transition);
    }
    .composer__target:hover {
      color: var(--heading-color);
    }
    .composer__target[aria-pressed='true'] {
      color: var(--heading-color);
      background: var(--thread-theirs-bg);
      border-color: var(--border-color-dark);
    }
    .composer--team .composer__target[aria-pressed='true'] {
      background: var(--thread-team-bg);
      border-color: var(--thread-team-rule);
    }
    .composer__short {
      display: none;
    }
    @container (max-width: 27.999rem) {
      .composer__long {
        display: none;
      }
      .composer__short {
        display: inline;
      }
    }

    .composer__row {
      display: flex;
      align-items: flex-end;
      gap: var(--space-xs);
    }
    .composer__row textarea {
      flex: 1;
      min-inline-size: 0;
      field-sizing: content;
      min-block-size: var(--control-size-m);
      max-block-size: 40vh;
      resize: none;
    }
    /* Without field-sizing (Firefox, older Safari) the field does not grow
       with the text: give it room for a few lines, and let it be dragged. */
    @supports not (field-sizing: content) {
      .composer__row textarea {
        min-block-size: calc(var(--control-size-m) * 2);
        resize: vertical;
      }
    }
    .composer__btns {
      display: inline-flex;
      flex: none;
      gap: var(--space-xs);
    }
    /* On a phone the field takes the row; «Abrir como correo» goes under. */
    @container (max-width: 27.999rem) {
      .composer__row {
        flex-wrap: wrap;
      }
      .composer__btns {
        justify-content: flex-end;
        inline-size: 100%;
      }
    }

    .composer__mail,
    .composer__log {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .composer__log {
      flex-direction: row;
      flex-wrap: wrap;
    }
    .composer__log select,
    .composer__log input {
      inline-size: auto;
      padding-block: var(--space-2xs);
      font-size: var(--text-s);
    }
    .composer__to {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
      overflow-wrap: anywhere;
    }
    .composer__insert {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }
    .composer__sig {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
      white-space: pre-line;
    }
    .composer__hint {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .composer__hint a {
      color: var(--text-muted);
    }
  }
</style>
