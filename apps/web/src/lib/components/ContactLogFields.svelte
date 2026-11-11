<script lang="ts">
  /**
   * Apuntar un contacto: el formulario, una sola pieza para las dos puertas
   * (tarea 134). «+ Apuntar» en el cuadro de escribir de una conversación
   * (ADR-185 § 4) y «+ → Llamada» en la lente (ADR-182) preguntan lo mismo,
   * en el mismo orden y con las mismas palabras:
   *
   *   Qué        llamada · reunión · mensaje · correo · apunte   (si hay más de uno)
   *   Por dónde  WhatsApp · SMS · Telegram · otra                (sólo un mensaje)
   *   Quién      yo · Elena                                      (no en reunión ni apunte)
   *   Cuándo     ahora · otro día [día] [hora]
   *
   * La nota es el campo de texto de cada puerta: el del cuadro de escribir, o
   * el del diálogo. Lo que se manda lo arma `contactEvent` ($lib/call-log).
   */
  import ThreadIcon, { type ThreadIconName } from '$lib/components/ThreadIcon.svelte';
  import { LOG_KINDS, hasWho, localTime, withKind, type ContactLog } from '$lib/call-log';
  import { MESSAGE_APPS, eventKindLabel, type ConversationEventKind } from '$lib/conversation';
  import { messageAppIcon, messageAppName } from '$lib/conversation-thread';
  import { localDayISO } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    log: ContactLog;
    /** Qué se puede apuntar desde esta puerta; con uno solo, la fila no sale. */
    kinds?: readonly ConversationEventKind[];
    /** El nombre de pila de quien está al otro lado: «Quién · yo · Elena». */
    them?: string | null;
    /** La hora elegida aún no ha llegado (la base no la acepta). */
    future?: boolean;
    locale: Locale;
  }

  let { log = $bindable(), kinds = LOG_KINDS, them = null, future = false, locale }: Props = $props();

  const ICON: Record<ConversationEventKind, ThreadIconName> = {
    call: 'call',
    meeting: 'meeting',
    message: 'message',
    email: 'mail',
    note: 'note',
  };

  function otherDay() {
    if (!log.edited) log = { ...log, edited: true, day: localDayISO(), time: localTime(new Date()) };
  }
</script>

<div class="logf" data-testid="contact-log">
  {#if kinds.length > 1}
    <div class="logf__row" role="group" aria-label={t('conversations.event_kind', locale)}>
      <span class="logf__label">{t('thread.log_what', locale)}</span>
      {#each kinds as k (k)}
        <button type="button" class="logf__opt" aria-pressed={log.kind === k} onclick={() => (log = withKind(log, k))}
          ><ThreadIcon name={ICON[k]} />{k === 'note' ? t('thread.ev_note', locale) : eventKindLabel(k, locale)}</button
        >
      {/each}
    </div>
  {/if}
  {#if log.kind === 'message'}
    <div class="logf__row" role="group" aria-label={t('thread.log_via', locale)}>
      <span class="logf__label">{t('thread.log_via', locale)}</span>
      {#each MESSAGE_APPS as a (a)}
        <button type="button" class="logf__opt" aria-pressed={log.via === a} onclick={() => (log = { ...log, via: a })}
          ><ThreadIcon name={messageAppIcon(a)} />{messageAppName(a, locale)}</button
        >
      {/each}
    </div>
  {/if}
  {#if hasWho(log.kind)}
    <div class="logf__row" role="group" aria-label={t('create.direction', locale)}>
      <span class="logf__label">{t('thread.log_who', locale)}</span>
      <button
        type="button"
        class="logf__opt"
        aria-pressed={log.direction === 'outbound'}
        onclick={() => (log = { ...log, direction: 'outbound' })}>{t('thread.log_me', locale)}</button
      >
      <button
        type="button"
        class="logf__opt"
        aria-pressed={log.direction === 'inbound'}
        onclick={() => (log = { ...log, direction: 'inbound' })}>{them || t('thread.log_them', locale)}</button
      >
    </div>
  {/if}
  <div class="logf__row" role="group" aria-label={t('conversations.event_day', locale)}>
    <span class="logf__label">{t('thread.log_when', locale)}</span>
    <button type="button" class="logf__opt" aria-pressed={!log.edited} onclick={() => (log = { ...log, edited: false })}
      >{t('thread.log_now', locale)}</button
    >
    <button type="button" class="logf__opt" aria-pressed={log.edited} onclick={otherDay}>{t('thread.log_other_day', locale)}</button>
    {#if log.edited}
      <input
        type="date"
        value={log.day}
        max={localDayISO()}
        aria-label={t('conversations.event_day', locale)}
        oninput={(e) => (log = { ...log, day: e.currentTarget.value })}
      />
      <input
        type="time"
        value={log.time}
        aria-label={t('call.time', locale)}
        aria-invalid={future || undefined}
        oninput={(e) => (log = { ...log, time: e.currentTarget.value })}
      />
    {/if}
  </div>
  {#if future}<p class="logf__error" role="alert">{t('call.future', locale)}</p>{/if}
</div>

<style>
  @layer components {
    .logf {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    /* What is logged, as choices: what it was, who began it, when. */
    .logf__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-xs);
      font-size: var(--text-s);
    }
    .logf__label {
      min-inline-size: var(--composer-opt-label);
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .logf__opt {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
      padding: var(--space-2xs) var(--space-s);
      color: var(--text-muted);
      background: none;
      border: var(--line-hairline) solid transparent;
      border-radius: var(--radius);
      font: inherit;
      cursor: pointer;
    }
    .logf__opt[aria-pressed='true'] {
      color: var(--heading-color);
      font-weight: 500;
      background: var(--bg-light);
      border-color: var(--border-color-dark);
    }
    .logf__row input {
      inline-size: auto;
      padding-block: var(--space-2xs);
      font-size: var(--text-s);
    }
    .logf__error {
      margin: 0;
      color: var(--danger);
      font-size: var(--text-s);
    }
  }
</style>
