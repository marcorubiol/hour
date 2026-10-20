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
   *
   * Una ficha, dos marcos (ADR-139 p1 A): la página y el vistazo sobre una
   * lente dibujan este componente.
   */
  import { docTitle } from '$lib/doc-title';
  import { lensOn } from '$lib/lenses.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import FirstTimeNote from '$lib/components/FirstTimeNote.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import { dayMonth, dayMonthYear, dayMonthYearTs, localDayISO, viewerTimeZone } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import ConversationHistory from '$lib/components/ConversationHistory.svelte';
  import ConversationStatusMenu from '$lib/components/ConversationStatusMenu.svelte';
  import NextActionDialog from '$lib/components/NextActionDialog.svelte';
  import MessageItem from '$lib/components/MessageItem.svelte';
  import ThreadBlock from '$lib/components/ThreadBlock.svelte';
  import OrganizationFiscal from '$lib/components/OrganizationFiscal.svelte';
  import ConversationAcquaintances from '$lib/components/ConversationAcquaintances.svelte';
  import ConversationTags from '$lib/components/ConversationTags.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import Fold from '$lib/components/Fold.svelte';
  import MissingBand, { type MissingItem } from '$lib/components/MissingBand.svelte';
  import { conversationMissing, stepShortcuts, type ConversationMissing, type StepShortcut } from '$lib/record-missing';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    eventDirectionLabel,
    eventKindLabel,
    conversationTitle,
    relativeContactDate,
    relationInputOf,
    type ConversationEventItem,
    type ConversationItem,
    type ConversationPatch,
  } from '$lib/conversation';
  import { turnOf } from '$lib/conversation-overview';
  import { relationLabel, type ConversationBolo } from '$lib/conversation-relation';
  import { performanceStatusLabel } from '$lib/performance';
  import { conversationPlannerHref, dayKeyInTz } from '$lib/planner';
  import { firstLine, replySubject, type MailAccountsResponse } from '$lib/mail';
  import { markReadWhenSeen, readAtOpen, scrollWhenNamed } from '$lib/thread-reading.svelte';
  import { THREAD_REFRESH_MS, firstUnreadId, teamTimeline, type ConversationThreadView } from '$lib/threads';

  const locale = appLocale();
  const queryClient = useQueryClient();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  interface Props {
    workspaceSlug: string;
    slug: string;
    /** Drawn in the vistazo (ADR-139 p1): no document title, and the reading
        is the panel's own, not the address bar's (`?vista=` belongs to the page). */
    inPeek?: boolean;
  }

  let { workspaceSlug, slug, inPeek = false }: Props = $props();

  type Reading = 'registro' | 'hilo';
  let peekReading = $state<Reading>('registro');
  let reading = $derived<Reading>(
    inPeek ? peekReading : page.url.searchParams.get('vista') === 'hilo' ? 'hilo' : 'registro',
  );
  function setReading(r: Reading) {
    if (inPeek) {
      peekReading = r;
      return;
    }
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
      retry: retryLoad,
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

  // Sus bolos (ADR-138 § 3): fecha y estado, sin dinero. Quien no tiene
  // `read:performance` en el proyecto recibe la lista vacía y no ve la fila.
  const bolosQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-bolos', conv?.id ?? ''] as const,
      enabled: Boolean(conv?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ConversationBolo[] }>(`/api/conversations/${conv!.id}/bolos`, signal),
    })),
  );
  let bolos = $derived($bolosQuery.data?.items ?? []);

  // «Ver en el Planner» (ADR-138 § 6): la conversación no se dibuja en la
  // rejilla; desde aquí, la Agenda en su primer día con el proyecto fijado.
  let plannerHref = $derived.by(() => {
    if (!conv?.project || !lensOn('planner')) return null;
    const tz = viewerTimeZone();
    const days = bolos.flatMap((b) => (b.first_performed_at ? [dayKeyInTz(b.first_performed_at, tz)] : []));
    return conversationPlannerHref(conv.project.id, days, dayKeyInTz(new Date().toISOString(), tz));
  });

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
  let confirmPrivate = $state(false);
  function togglePrivate() {
    if (!conv) return;
    if (conv.private) $setPrivate.mutate(false);
    else confirmPrivate = true;
  }
  function confirmMakePrivate() {
    confirmPrivate = false;
    $setPrivate.mutate(true);
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
  let turn = $derived(conv ? turnOf({ ...relationInputOf(conv), reply_settled_at: conv.reply_settled_at }, new Date()) : null);
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

  // Address: Space › [Project ›] Conversación (the title names who).
  const wsQuery = createQuery(workspacesQueryOptions());
  let crumbs = $derived.by<Crumb[]>(() => {
    const ws = $wsQuery.data?.items.find((w) => w.slug === workspaceSlug);
    const out: Crumb[] = [spaceCrumb(ws?.name, workspaceSlug)];
    if (conv?.project) out.push({ label: conv.project.name, href: `/h/${workspaceSlug}/project/${conv.project.slug}/` });
    out.push({ label: t('conversations.conversation', locale) });
    return out;
  });
  /** A quién sale un correo: el contacto principal (`mail_send_authorize`). */
  let recipient = $derived.by(() => {
    const p = conv?.contacts.find((c) => c.is_primary)?.person ?? null;
    if (p?.email) return { full_name: p.full_name, email: p.email };
    return conv?.person?.email ? { full_name: conv.person.full_name, email: conv.person.email } : null;
  });

  // «Escribir correo» desactivado dice por qué (ADR-139 p2): sin buzón que
  // envíe, o sin email del contacto. Mientras los buzones se leen, nada.
  let writeBlocked = $derived<'no_mailbox' | 'no_email' | null>(
    !$mailQuery.isSuccess ? null : sendable.length === 0 ? 'no_mailbox' : !recipient?.email ? 'no_email' : null,
  );
  let canWrite = $derived(sendable.length > 0 && Boolean(recipient?.email));

  /** Responder: al último correo de fuera si lo hay (el compositor cae debajo), si no uno nuevo. */
  function replyToLast() {
    if (reading !== 'registro') setReading('registro');
    const last = events.find((e) => e.direction === 'inbound' && e.kind === 'email' && e.source === 'email') ?? null;
    startCompose(last);
  }

  // ── «Falta» y el siguiente paso en sitio (ADR-139 p2 A) ────────────────
  let missing = $derived<ConversationMissing[]>(
    conv
      ? conversationMissing(
          {
            ...relationInputOf(conv),
            reply_settled_at: conv.reply_settled_at,
            next_action_at: conv.next_action_at,
            next_action_note: conv.next_action_note,
          },
          new Date(),
        )
      : [],
  );

  /** El editor del siguiente paso: atajos de fecha en una línea, bajo los hechos. */
  let stepOpen = $state(false);
  let stepEl = $state<HTMLElement>();
  function openStep() {
    stepOpen = true;
    requestAnimationFrame(() => stepEl?.querySelector<HTMLElement>('button')?.focus());
  }
  const SHORTCUT_WORDS: Record<StepShortcut, string> = {
    tomorrow: 'record.step_tomorrow',
    monday: 'record.step_monday',
    two_weeks: 'record.step_two_weeks',
  };
  let shortcuts = $derived(
    Object.entries(stepShortcuts(localDayISO())) as [StepShortcut, string][],
  );
  function setStepDay(day: string) {
    $patch.mutate({ next_action_at: day });
    stepOpen = false;
  }
  function clearStep() {
    $patch.mutate({ next_action_at: null, next_action_note: null });
    stepOpen = false;
  }
  let hasStep = $derived(Boolean(conv?.next_action_at || conv?.next_action_note));
  let stepText = $derived(
    conv
      ? [conv.next_action_note, conv.next_action_at ? dayMonthYear(conv.next_action_at) : null].filter(Boolean).join(' · ')
      : '',
  );

  function missingItem(m: ConversationMissing): MissingItem {
    const edit = conv?.can_edit ?? false;
    switch (m.kind) {
      case 'reply':
        return {
          id: 'reply',
          text: t('record.missing_reply', locale),
          meta: relativeContactDate(m.since, locale),
          verbs: [
            ...(canWrite ? [{ label: t('record.verb_write', locale), onclick: replyToLast }] : []),
            ...(edit
              ? [
                  {
                    label: t('overview.settle', locale),
                    disabled: $patch.isPending,
                    onclick: () => $patch.mutate({ reply_settled_at: m.since }),
                  },
                ]
              : []),
          ],
        };
      case 'step_due':
        return {
          id: 'step_due',
          text: t('record.missing_step_due', locale),
          // El paso ya está en los hechos: aquí, cuánto hace que venció.
          meta: relativeContactDate(m.day, locale),
          verbs: edit ? [{ label: t('record.verb_postpone', locale), onclick: openStep }] : [],
        };
      case 'step_undated':
        return {
          id: 'step_undated',
          text: t('record.missing_step_undated', locale),
          verbs: edit ? [{ label: t('record.verb_set_date', locale), onclick: openStep }] : [],
        };
      case 'no_step':
        return {
          id: 'no_step',
          text: t('record.missing_no_step', locale),
          verbs: edit ? [{ label: t('record.verb_add_step', locale), onclick: openStep }] : [],
        };
    }
  }
  let missingItems = $derived(missing.map(missingItem));

  // «Detalles»: lo de consulta (datos fiscales, «lo conozco», privacidad,
  // buzones), plegado. Cerrado dice lo que guarda que se sepa sin abrir.
  let detailsKeeps = $derived(
    [
      conv?.private ? t('mail.private_badge', locale) : null,
      mailboxes.length > 0 ? `${t('mail.mailboxes_here', locale)} ${mailboxes.length}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<svelte:head>
  {#if !inPeek}<title>{docTitle(title, t('conversations.conversation', locale))}</title>{/if}
</svelte:head>

{#if $convQuery.isLoading || !conv}
  <section class="record conv">
    <!-- No conversation and no error (a read that never ran) is the same
         answer as a 404: there is nothing here for you. -->
    <RecordState
      loading={$convQuery.isLoading}
      error={$convQuery.error ?? new ApiError(404, 'Not found')}
      missingText={t('mail.conv_not_found', locale)}
      failedText={t('conversations.one_load_error', locale)}
      onretry={() => void $convQuery.refetch()}
      back={lensOn('conversations') ? { href: '/h/conversations', label: t('conversations.back', locale) } : null}
      {locale}
    />
  </section>
{:else}
  <section class="record conv">
    <RecordHead {crumbs} {title}>
      <!-- La acción principal y cómo se lee, en la cabecera (ADR-139 p2). -->
      {#snippet actions()}
        <span class="conv__reading">
          <Segmented
            ariaLabel={t('mail.view_label', locale)}
            name="conv-reading"
            options={[
              { value: 'registro', label: t('record.view_record', locale) },
              { value: 'hilo', label: t('record.view_thread', locale) },
            ]}
            value={reading}
            onchange={(v) => setReading(v as Reading)}
          />
          <ConceptHint concept="reading" />
        </span>
        <span class="conv__write">
          <Button size="xs" variant="secondary" disabled={!canWrite} onclick={() => startCompose(null)}>
            {t('mail.write', locale)}
          </Button>
          {#if writeBlocked}
            <span class="conv__write-why" data-testid="write-why"
              >{t(`record.write_${writeBlocked}`, locale)}{#if writeBlocked === 'no_mailbox'}{' · '}<a href={`/h/${workspaceSlug}/settings?section=mail`}>{t('record.write_to_settings', locale)}</a>{/if}</span
            >
          {/if}
        </span>
      {/snippet}
      <!-- Los hechos: con quién, el contacto, la relación y el siguiente
           paso, cada uno en su sitio; en el móvil, antes del historial. -->
      {#snippet facts()}
        {#if conv!.person && conv!.person.full_name !== title}<span>{conv!.person.full_name}</span>{/if}
        {#if conv!.person?.email}<span>{conv!.person.email}</span>{/if}
        {#if conv!.private}<span class="conv__private">{t('mail.private_badge', locale)}</span>{/if}
        <span class="conv__relation">
          {#if conv!.can_edit}
            <ConversationStatusMenu
              relation={conv!.relation}
              notNowUntil={conv!.not_now_until}
              look="word"
              {locale}
              onnotnow={(not_now) => $patch.mutate({ not_now })}
              onlog={openLog}
            />
          {:else}
            <span class="fact-word">{relationLabel(conv!.relation, locale)}</span>
          {/if}
          <ConceptHint concept="relation" />
        </span>
        {#if conv!.can_edit}
          <span
            ><button
              type="button"
              class="fact-act"
              aria-expanded={stepOpen}
              aria-label={hasStep ? t('record.step_edit_aria', locale, { step: stepText }) : undefined}
              data-testid="conversation-next-step"
              onclick={() => (stepOpen ? (stepOpen = false) : openStep())}
              >{hasStep ? stepText : t('record.step_none', locale)}</button
            ></span
          >
        {:else if hasStep}
          <span>{stepText}</span>
        {/if}
      {/snippet}
      {#snippet band()}
        {#if stepOpen && conv!.can_edit}
          <div class="conv__step" role="group" aria-label={t('record.step_shortcuts', locale)} bind:this={stepEl}>
            <span class="eyebrow eyebrow--sub conv__step-label">{t('mail.next_step', locale)}</span>
            <span class="conv__step-acts">
              {#each shortcuts as [k, day] (k)}
                <button
                  type="button"
                  class="missing__act"
                  disabled={$patch.isPending}
                  aria-label={t('record.step_shortcut_aria', locale, { when: t(SHORTCUT_WORDS[k], locale), date: dayMonth(day) })}
                  onclick={() => setStepDay(day)}
                  >{t(SHORTCUT_WORDS[k], locale)}<span class="conv__step-day">{dayMonth(day)}</span></button
                >
              {/each}
              <button type="button" class="missing__act" onclick={() => ((nextOpen = true), (stepOpen = false))}
                >{t('record.step_other', locale)}</button
              >
              {#if hasStep}
                <button type="button" class="missing__act" disabled={$patch.isPending} onclick={clearStep}
                  >{t('record.verb_done', locale)}</button
                >
              {/if}
            </span>
          </div>
        {/if}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    <div class="conv__grid" class:conv__grid--single={reading === 'hilo'}>
      <div class="conv__main">
        {#if reading === 'registro'}
          <BlockHead title={t('mail.outside', locale)} count={events.length} concept="outside" />
          <FirstTimeNote event="first_mail_synced" when={mailboxes.length > 0} />
          {#if composing === 'new'}{@render composer()}{/if}
          {#if $eventsQuery.isLoading}
            <EmptyLine text={t('conversations.loading', locale)} busy />
          {:else if events.length === 0}
            <EmptyLine text={t('conversations.history_empty', locale)} />
          {:else}
            <ol class="rec" aria-label={t('conversations.history', locale)}>
              {#each events as e (e.id)}
                {@render recordItem(e)}
              {/each}
            </ol>
          {/if}
          <Fold word={t('mail.log_other', locale)} bind:open={logOpen} bind:el={logEl} testid="conversation-log">
            <p class="muted">{t('mail.log_turn_hint', locale)}</p>
            <ConversationHistory conversationId={conv.id} showList={false} />
          </Fold>
        {:else}
          <BlockHead title={t('mail.thread', locale)} count={events.length} />
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

      <div class="conv__aside">
        <dl class="facts">
          {#if bolos.length > 0}
            <div data-testid="conversation-bolos">
              <dt>{t('conversations.bolos', locale)}</dt>
              <dd>
                <ul class="facts__bolos">
                  {#each bolos as b (b.bolo_id)}
                    {@const when = b.first_performed_at ? dayMonth(b.first_performed_at) : t('conversations.bolo_undated', locale)}
                    <li>
                      {#if b.performance_slug}
                        <a href={`/h/${workspaceSlug}/performance/${b.performance_slug}`}>{when}</a>
                      {:else}
                        {when}
                      {/if}
                      · {performanceStatusLabel(b.status, locale)}{#if b.function_count > 1}<span class="muted">
                          · {t('perf.bolo_functions_other', locale, { n: b.function_count })}</span
                        >{/if}
                    </li>
                  {/each}
                </ul>
              </dd>
            </div>
          {/if}
          <div>
            <dt>{t('mail.last_contact', locale)}</dt>
            <dd>{relativeContactDate(conv.last_contacted_at, locale)}</dd>
          </div>
          {#if turn?.side === 'theirs'}
            <!-- Lo nuestro (te toca) sube a «Falta»; aquí queda cuánto esperamos. -->
            <div>
              <dt>{t('overview.col_turn', locale)}</dt>
              <dd>{t('overview.turn_theirs_cap', locale)} · {relativeContactDate(turn.since, locale)}</dd>
            </div>
          {/if}
          {#if plannerHref}
            <div>
              <dt>{t('lens.planner', locale)}</dt>
              <dd><a href={plannerHref} data-testid="conversation-planner">{t('conversations.see_in_planner', locale)}</a></dd>
            </div>
          {/if}
        </dl>

        <!-- Etiquetas (ADR-138, fase 2): de qué va; su propio bloque. -->
        <ConversationTags conversationId={conv.id} workspaceId={conv.workspace_id} tags={conv.tags} canEdit={conv.can_edit} {locale} />

        {#if reading === 'registro'}
          <div class="inside" bind:this={teamEl}>
            {@render teamThread(true)}
          </div>
        {/if}

        <!-- Lo de consulta, plegado (ADR-139 p2): se toca una vez. -->
        <Fold word={t('record.details', locale)} keeps={detailsKeeps} id="details" testid="record-details">
          {#if conv.organization}
            <OrganizationFiscal organizationId={conv.organization.id} level={3} />
          {/if}

          <ConversationAcquaintances workspaceId={conv.workspace_id} contacts={conv.contacts} {locale} />

          {#if conv.can_set_private}
            <div class="privacy">
              <div class="privacy__row">
                <span class="eyebrow eyebrow--sub">{t('mail.private_label', locale)}</span>
                <Switch
                  checked={conv.private}
                  label={t('mail.private_label', locale)}
                  disabled={$setPrivate.isPending}
                  testid="conversation-private"
                  onchange={togglePrivate}
                />
              </div>
              <p class="privacy__hint">
                {conv.private ? t('mail.private_on_hint', locale) : t('mail.private_off_hint', locale)}
              </p>
            </div>
          {/if}

          {#if mailboxes.length}
            <div class="legend">
              <BlockHead title={t('mail.mailboxes_here', locale)} concept="mailboxes" level={3} />
              {#each mailboxes as [address, scope] (address)}
                <p class="legend__row">
                  <span class="mb" class:mb--shared={scope === 'workspace'}>
                    {scope === 'workspace' ? t('mail.shared_mailbox', locale) : t('mail.personal_mailbox', locale)}
                  </span>
                  <span class="muted">{address}</span>
                </p>
              {/each}
            </div>
          {:else}
            <EmptyLine label={t('mail.mailboxes_here', locale)} text={t('mail.no_mail_yet', locale)} />
          {/if}
        </Fold>
      </div>
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

<Dialog bind:open={confirmPrivate} size="s" title={t('mail.private_title', locale)} description={t('mail.private_confirm', locale)}>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (confirmPrivate = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={confirmMakePrivate}>{t('mail.private_confirm_btn', locale)}</Button>
  {/snippet}
</Dialog>

{#snippet teamThread(list: boolean)}
  {#if team && conv}
    <ThreadBlock
      thread={team.thread}
      anchorKind="conversation"
      anchorId={conv.id}
      title={t('threads.team', locale)}
      heading="eyebrow"
      messages={team.messages}
      authors={team.authors}
      me={team.me}
      newSince={teamSince}
      tz={viewerTimeZone()}
      {list}
      {locale}
      onchange={refreshTeam}
    />
  {:else if $teamQuery.isError}
    <EmptyLine text={t('threads.team_error', locale)} />
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
                <Button size="xs" variant="secondary" disabled={!sendable.length || !recipient?.email} onclick={() => startCompose(e)}>
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
        <Button size="xs" variant="secondary" disabled={!sendable.length || !recipient?.email} onclick={() => startCompose(e)}>
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
    <Select id="reply-from" label={t('mail.from', locale)} bind:value={fromAccount}>
      {#each sendable as a (a.id)}
        <option value={a.id}>{accountLabel(a.id)}</option>
      {/each}
    </Select>
    <Field id="reply-to" label={t('mail.to', locale)} group>
      <span class="reply__to">{recipient?.full_name} &lt;{recipient?.email}&gt;</span>
    </Field>
    <Input id="reply-subject" label={t('mail.subject', locale)} bind:value={subject} required />
    <Textarea id="reply-body" rows={5} maxlength={20000} ariaLabel={t('mail.body', locale)} bind:value={body} required />
    {#if fromSignature}
      <p class="reply__sig">-- <br />{fromSignature}</p>
    {/if}
    <div class="reply__row">
      <span class="muted">{t('mail.send_hint', locale, { address: sendable.find((a) => a.id === fromAccount)?.address ?? '' })}</span>
      <span class="reply__btns">
        <Button size="xs" variant="quiet" onclick={() => (composing = null)}>{t('mail.discard', locale)}</Button>
        <Button size="xs" type="submit" disabled={$send.isPending || !fromAccount || !subject.trim() || !body.trim()}>
          {t('mail.send', locale)}
        </Button>
      </span>
    </div>
  </form>
{/snippet}

<style>
  @layer components {
    .conv__private {
      color: var(--heading-color);
      font-weight: 500;
    }
    .conv__reading,
    .conv__write,
    .conv__relation {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
    }
    .conv__reading {
      flex-wrap: nowrap;
    }
    /* Two tools here (how to read, write): on a phone they take a line each. */
    .conv :global(.lenshead__tools) {
      flex-wrap: wrap;
    }
    .conv__write-why {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .conv__write-why a {
      color: var(--text-muted);
    }

    /* The next step's editor: its name in the record's label column, the
       days after it, the same row as the «Falta» strip under it. */
    .conv__step {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
    }
    .conv__step-label {
      flex: none;
      min-inline-size: var(--record-label-inline);
      margin: 0;
    }
    .conv__step-acts {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
    }
    .conv__step-day {
      margin-inline-start: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }

    .conv__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
      gap: var(--space-xl);
      align-items: start;
    }
    /* Measured on the record (base.css `.record`), so the vistazo gets one
       column too. 48rem of record is about a 64rem window beside the rail. */
    @container record (max-width: 47.999rem) {
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

    .conv__main :global(.fold) {
      margin-block-start: var(--space-m);
    }

    .reply {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block: var(--space-s);
      padding-block-start: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .reply__to {
      font-size: var(--text-s);
      color: var(--text-muted);
      overflow-wrap: anywhere;
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
    .facts__bolos {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .privacy {
      padding-block: var(--space-s);
      border-block: var(--line-hairline) solid var(--border-color-light);
    }
    .privacy__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }
    .privacy__hint {
      margin: var(--space-xs) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
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
      border: var(--line-hairline) solid var(--border-color-light);
      border-inline-start: var(--line) solid var(--border-color-dark);
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

    @container record (max-width: 31.999rem) {
      .rec__item {
        grid-template-columns: minmax(0, 1fr);
      }
    }

  }
</style>
