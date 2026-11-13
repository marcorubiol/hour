<script lang="ts">
  /**
   * La ficha de una conversación, como hilo (punto 110, dirección A con el
   * modelo de una app de mensajería; ADR-099 añadido, ADR-102).
   *
   * Arriba, con quién (la organización y sus contactos) y una línea fija de
   * hechos, el turno primero: a quién le toca, la relación, los bolos y el
   * siguiente paso. Los detalles (contactos, bolos, etiquetas, privacidad,
   * buzones y el registro en lista) siempre a un toque (ADR-184): columna al
   * lado cuando la ficha mide 64rem o más; si no, «Detalles» los abre encima
   * del hilo.
   *
   * En medio, el hilo: lo hablado con fuera (`conversation_event`, ADR-098) y
   * el hilo del equipo (ADR-106) en una sola línea, de lo antiguo a lo nuevo,
   * lo último abajo (`$lib/conversation-thread`). El lado dice quién (de fuera
   * a la izquierda, lo nuestro a la derecha) y hay tres pesos (ADR-184): lo
   * hablado con ellos en burbuja (correo, llamada, mensaje, reunión), el
   * equipo en burbuja ámbar, y lo nuestro sin destinatario (apunte, envío,
   * aviso) en una línea pequeña. Cada cosa con su glifo y su palabra. Cada
   * correo entero en su sitio, con su texto nuevo y el asunto sólo cuando
   * cambia; lo largo se despliega en el mismo sitio. Sin «visto», doble check
   * ni «escribiendo»: el correo no da esa información y fingirla sería
   * inventar.
   *
   * Al pie, un solo campo con tres destinos (`ConversationComposer`).
   *
   * Como el tablón: sin realtime; el hilo del equipo se recarga al volver a la
   * pestaña y cada 30 s, lo nuevo se marca leído a la vista y la raya de
   * «nuevos» se queda donde estaba al abrir.
   *
   * Una ficha, dos marcos (ADR-139 p1 A): la página y el vistazo. En la página
   * de un móvil es un chat a pantalla entera: sin la barra de lentes
   * (`data-chat-open`) y con su vuelta a la lista en la cabecera.
   *
   * El segmento [slug] admite también el id de la conversación.
   */
  import { attachmentKey, type AttachmentType } from '$lib/whatsapp-export';
  import { conversationsListHref } from '$lib/conversations-return.svelte';
  import { docTitle } from '$lib/doc-title';
  import { lensOn } from '$lib/lenses.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { toStore } from 'svelte/store';
  import { tick } from 'svelte';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import ChatMonogram from '$lib/components/ChatMonogram.svelte';
  import { dayMonth, dayMonthYear, dayMonthYearTs, hourMark, localDayISO, timeInTz, viewerTimeZone } from '$lib/datetime';
  import { appLocale, tHere, setRecordSpace } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import ConversationStatusMenu from '$lib/components/ConversationStatusMenu.svelte';
  import NextActionDialog from '$lib/components/NextActionDialog.svelte';
  import MessageItem from '$lib/components/MessageItem.svelte';
  import MailOriginal from '$lib/components/MailOriginal.svelte';
  import ConversationComposer, { type ComposerTarget } from '$lib/components/ConversationComposer.svelte';
  import ConversationAcquaintances from '$lib/components/ConversationAcquaintances.svelte';
  import ConversationTags from '$lib/components/ConversationTags.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import { conversationMissing, stepShortcuts, type StepShortcut } from '$lib/record-missing';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    currentContacts,
    eventKindLabel,
    conversationTitle,
    relativeContactDate,
    relationInputOf,
    type ConversationEventItem,
    type ConversationItem,
    type ConversationPatch,
  } from '$lib/conversation';
  import { shownTurn } from '$lib/conversation-overview';
  import { ASKED_KINDS, needsKind, type AskedKind } from '$lib/organization-record';
  import { bulkFailedLine, type BulkResult } from '$lib/conversation-bulk';
  import { relationLabel, type ConversationBolo } from '$lib/conversation-relation';
  import { performanceStatusLabel } from '$lib/performance';
  import { conversationPlannerHref, dayKeyInTz } from '$lib/planner';
  import { firstLine, type MailAccountsResponse } from '$lib/mail';
  import { markConversationReadOnOpen, markReadWhenSeen, readAtOpen } from '$lib/thread-reading.svelte';
  import { markConversationRead, type ConversationFeedView } from '$lib/conversation-feed';
  import { THREAD_REFRESH_MS, type ConversationThreadView } from '$lib/threads';
  import {
    conversationThreadEntries,
    scrollToEdge,
    senderName,
    threadDayLabel,
    threadGapLabel,
    citeLine,
    messageAppIcon,
    messageAppName,
    type ThreadSide,
  } from '$lib/conversation-thread';
  import ThreadIcon, { type ThreadIconName } from '$lib/components/ThreadIcon.svelte';

  const locale = appLocale();
  const queryClient = useQueryClient();
  const tz = viewerTimeZone();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  interface Props {
    workspaceSlug: string;
    slug: string;
    /** Drawn in the vistazo (ADR-139 p1): no document title, no way back to the
        list (the list is beside it), and the lens bar stays. */
    inPeek?: boolean;
    /** Beside the list: «Cerrar» in the head's own row (ADR-184). */
    onclose?: () => void;
  }

  let { workspaceSlug, slug, inPeek = false, onclose }: Props = $props();
  setRecordSpace(() => workspaceSlug);
  const t = tHere();

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
  // `read:performance` en el proyecto recibe la lista vacía y no los ve.
  const bolosQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-bolos', conv?.id ?? ''] as const,
      enabled: Boolean(conv?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ConversationBolo[] }>(`/api/conversations/${conv!.id}/bolos`, signal),
    })),
  );
  let bolos = $derived($bolosQuery.data?.items ?? []);

  // «+ Opción con esta sala» (ADR-138 § 3, ADR-102): el trato nace aquí, con
  // el proyecto y la sala de la conversación, y ya colgado de ella.
  let canOpenBolo = $derived(Boolean(conv?.can_edit && conv?.project));
  const openBolo = createMutation({
    mutationFn: () =>
      mutateJSON<{ bolo?: unknown }>('POST', '/api/money/bolos', {
        project_id: conv!.project!.id,
        conversation_id: conv!.id,
        venue_name: conv!.organization?.name ?? null,
        city: conv!.organization?.city ?? null,
        status: 'hold',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-bolos', conv?.id ?? ''] });
      void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
      addToast({ tone: 'success', message: t('conversations.bolo_opened', locale) });
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('books.deal_not_created', locale),
        message: err instanceof ApiError && err.status === 403 ? t('conversations.bolo_forbidden', locale) : err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
  });

  // «Ver en el Planner» (ADR-138 § 6): la Agenda en su primer día con el proyecto fijado.
  let plannerHref = $derived.by(() => {
    if (!conv?.project || !lensOn('planner')) return null;
    const days = bolos.flatMap((b) => (b.first_performed_at ? [dayKeyInTz(b.first_performed_at, tz)] : []));
    return conversationPlannerHref(conv.project.id, days, dayKeyInTz(new Date().toISOString(), tz));
  });

  // ── Lo hablado con fuera ──
  const eventsQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-events', conv?.id ?? ''] as const,
      enabled: Boolean(conv?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ConversationEventItem[]; last_read_at?: string | null }>(
          `/api/conversations/${conv!.id}/events`,
          signal,
        ),
    })),
  );
  let events = $derived($eventsQuery.data?.items ?? []);
  let oldestFirst = $derived([...events].reverse());

  /**
   * Hasta dónde había leído lo de fuera AL ABRIR, de la primera lectura de la
   * red (la copia del dispositivo puede traer una lectura vieja): la raya no
   * se mueve cuando abrirla la marca leída.
   */
  let openedRead = $state<{ id: string; at: string } | null>(null);
  $effect(() => {
    if (!conv || openedRead?.id === conv.id || !$eventsQuery.isFetchedAfterMount) return;
    openedRead = { id: conv.id, at: $eventsQuery.data?.last_read_at ?? conv.created_at };
  });
  let eventsReadAt = $derived(conv && openedRead?.id === conv.id ? openedRead.at : null);

  // Abrirla la deja leída (ADR-138, fase 3): la lista común deja de contar sus
  // entrantes; la fila se apaga sin esperar a la recarga.
  // Sólo después de apuntar hasta dónde se había leído: si se marcase antes,
  // la raya de «nuevos» se perdería.
  markConversationReadOnOpen({
    conversationId: () => ($eventsQuery.isSuccess && conv && openedRead?.id === conv.id ? conv.id : null),
    latest: () => events[0]?.id ?? '',
    onmarked: (id) => {
      queryClient.setQueriesData<ConversationFeedView>({ queryKey: ['conversation-feed'] }, (view) =>
        view ? markConversationRead(view, id) : view,
      );
      void queryClient.invalidateQueries({ queryKey: ['conversation-feed'] });
      // The lens's filtered list (te toca, a filter) counts it too: opened beside, it must go off as well (ADR-176).
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const mailQuery = createQuery(
    toStore(() => ({
      queryKey: ['mail-accounts', conv?.workspace_id ?? ''] as const,
      enabled: Boolean(conv?.workspace_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<MailAccountsResponse>(`/api/mail/accounts?workspace_id=${conv!.workspace_id}`, signal),
    })),
  );
  let mailboxes = $derived(
    [...new Map(events.filter((e) => e.mailbox_address).map((e) => [e.mailbox_address!, e.mailbox_scope])).entries()],
  );

  // ── El hilo del equipo, intercalado ──
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
  function refreshTeam() {
    void queryClient.invalidateQueries({ queryKey: teamKey });
  }

  let entries = $derived(
    conversationThreadEntries({
      events: oldestFirst,
      messages: team?.messages ?? [],
      me: team?.me ?? '',
      eventsReadAt,
      teamReadAt: teamSince,
      tz,
    }),
  );

  let flowEl = $state<HTMLElement>();
  let footEl = $state<HTMLElement>();
  // Lo último está abajo: llegar al pie es haberlo visto (la lista entera
  // puede ser más alta que el 15 % que pide el observador).
  markReadWhenSeen({
    target: () => footEl,
    threads: () => (team ? [team.thread] : []),
    onmarked: refreshTeam,
  });

  /**
   * Al abrir, como un chat: donde se dejó de leer si hay nuevos, si no al
   * final. Una vez por conversación, cuando lo de fuera y el equipo han
   * llegado (o el equipo ha fallado). `#team` (desde «de qué se habla») abre
   * con «Solo el equipo» en el campo.
   */
  let placedFor = '';
  $effect(() => {
    if (!conv || placedFor === conv.id || !$eventsQuery.isSuccess || !(team || $teamQuery.isError)) return;
    if (!flowEl || !footEl) return;
    placedFor = conv.id;
    const fromFeed = !inPeek && location.hash === '#team';
    if (fromFeed) composer?.focus('team');
    void tick().then(() => {
      const fresh = flowEl?.querySelector<HTMLElement>('[data-entry="new"]');
      if (fresh && !fromFeed) scrollToEdge(fresh, 'start', inPeek);
      else toEnd();
    });
  });

  // ── Desplegar un correo largo en su sitio ──
  let unfolded = $state<Set<string>>(new Set());
  function toggleFold(id: string) {
    const next = new Set(unfolded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    unfolded = next;
  }

  // ── Abrir el original entero, traído del buzón (punto 111) ──
  let originals = $state<Set<string>>(new Set());
  function toggleOriginal(id: string) {
    const next = new Set(originals);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    originals = next;
  }

  // ── El campo del pie ──
  // El destino es de cada conversación (ADR-177 § 6): lo decide el campo al
  // nacer, uno por conversación, y no pasa de una a otra.
  let composer = $state<ReturnType<typeof ConversationComposer>>();
  /** «Responder» en un correo: ese; si no, el último de fuera. */
  let replyPick = $state<string | null>(null);
  let lastInbound = $derived(
    events.find((e) => e.direction === 'inbound' && e.kind === 'email' && e.source === 'email' && !e.mailout_id) ?? null,
  );
  let replyTo = $derived((replyPick && events.find((e) => e.id === replyPick)) || lastInbound);
  function replyToMail(e: ConversationEventItem) {
    replyPick = e.id;
    composer?.focus('mail');
  }
  async function afterSent(sent: ComposerTarget) {
    replyPick = null;
    if (sent === 'team') await queryClient.invalidateQueries({ queryKey: teamKey });
    await tick();
    toEnd();
  }

  /**
   * Al final del hilo, con lo último a la vista y no debajo del pie, que es
   * fijo: lo último se alinea dejando el alto del pie por debajo. En el
   * segundo panel de la lista el hilo desplaza solo, encima del pie: su final
   * es su propio fondo.
   */
  function toEnd() {
    const last = flowEl?.lastElementChild as HTMLElement | null;
    if (!last || !footEl || !flowEl) return;
    if (flowEl.scrollHeight > flowEl.clientHeight) {
      flowEl.scrollTop = flowEl.scrollHeight;
      return;
    }
    last.style.scrollMarginBlockEnd = `${footEl.offsetHeight}px`;
    scrollToEdge(last, 'end', inPeek);
  }

  // ── Privada ──
  const setPrivate = createMutation({
    mutationFn: (value: boolean) =>
      mutateJSON<{ private: boolean }>('PUT', `/api/conversations/${conv!.id}/private`, { private: value }),
    onError: (err) =>
      addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void refreshAfterWrite(queryClient, ['conversations']);
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

  // ── Decidir desde la ficha (ADR-126 § 5): estado, turno y siguiente paso ──
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
      void refreshAfterWrite(queryClient, ['conversations']);
      void queryClient.invalidateQueries({ queryKey: ['conversation-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    },
  });
  let nextOpen = $state(false);
  /** El turno de la lista y de Hoy, la misma función (`shownTurn`, tarea 130). */
  let turn = $derived(
    conv
      ? shownTurn({ ...relationInputOf(conv), reply_settled_at: conv.reply_settled_at, next_action_at: conv.next_action_at }, new Date())
      : null,
  );
  /** Un siguiente paso vencido se dice en la línea de hechos, sin franja aparte. */
  let stepDue = $derived(
    conv
      ? conversationMissing(
          {
            ...relationInputOf(conv),
            reply_settled_at: conv.reply_settled_at,
            next_action_at: conv.next_action_at,
            next_action_note: conv.next_action_note,
          },
          new Date(),
        ).some((m) => m.kind === 'step_due')
      : false,
  );

  // ADR-102: el título es la organización; debajo, sus contactos.
  let title = $derived((conv && conversationTitle(conv)) || slug);
  let orgHref = $derived(
    conv?.organization?.slug ? `/h/${workspaceSlug}/organization/${encodeURIComponent(conv.organization.slug)}` : null,
  );
  let contacts = $derived(conv ? currentContacts(conv.contacts).filter((c) => c.person) : []);
  /** Quién no lee una nota del equipo: sus contactos, el principal primero; sin ellos, la organización. */
  let outsiders = $derived.by(() => {
    const names = [...contacts]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((c) => c.person!.full_name);
    return names.length > 0 ? names : [title];
  });
  let who = $derived(contacts.map((c) => (c.role ? `${c.person!.full_name} (${c.role})` : c.person!.full_name)).join(', '));

  // ── El tipo que falta (ADR-177 § 2, punto 115): se pregunta al abrirla, un
  //    toque lo guarda en su organización y la pregunta se va. «Ahora no» la
  //    calla en esta conversación hasta volver a abrirla. ──
  let kindHiddenFor = $state<string | null>(null);
  let askKind = $derived(
    Boolean(conv?.can_edit && conv.organization && kindHiddenFor !== conv.id && needsKind(conv.place)),
  );
  const setKind = createMutation({
    mutationFn: async (kind: AskedKind) => {
      const r = await mutateJSON<BulkResult>('POST', '/api/conversations/bulk', { action: 'kind', ids: [conv!.id], kind });
      if (!r || r.done.length === 0) throw new Error(r ? (bulkFailedLine(r, locale) ?? '') : t('conversations.unexpected_response', locale));
    },
    onMutate: () => (kindHiddenFor = conv?.id ?? null),
    onError: (err) => {
      kindHiddenFor = null;
      addToast({ tone: 'danger', title: t('conversations.change_not_saved', locale), message: err instanceof Error ? err.message : String(err) });
    },
    onSettled: () => {
      for (const key of ['conversation', 'conversations', 'conversation-feed', 'organization']) void refreshAfterWrite(queryClient, [key]);
    },
  });

  /**
   * A quién sale un correo: el contacto principal y nadie más
   * (`mail_send_authorize`). Sin email suyo, el correo dice por qué y no sale.
   */
  let recipient = $derived.by(() => {
    const p = conv?.contacts.find((c) => c.is_primary)?.person ?? null;
    return p?.email ? { full_name: p.full_name, email: p.email } : null;
  });

  /** La vuelta de un chat a pantalla entera: la lista, o Hoy sin la lente. */
  let back = $derived(
    lensOn('conversations')
      ? { href: conversationsListHref(), label: t('thread.back_list', locale) }
      : { href: '/h', label: t('thread.back_home', locale) },
  );

  // ── El siguiente paso, en sitio (ADR-139 p2 A) ──
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
  let shortcuts = $derived(Object.entries(stepShortcuts(localDayISO())) as [StepShortcut, string][]);
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

  // ── Detalles: la ficha de contacto de este chat, siempre a un toque ──
  // Con la ficha a 64rem o más, columna al lado; si no, encima del hilo.
  const DETAILS_BESIDE_REM = 64;
  let chatW = $state(0);
  let wide = $derived(
    typeof document !== 'undefined' &&
      chatW >= DETAILS_BESIDE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  let detailsOpen = $state(false);
  let detailsEl = $state<HTMLElement>();
  let detailsBtn = $state<HTMLButtonElement>();
  async function openDetails() {
    detailsOpen = true;
    await tick();
    detailsEl?.focus();
  }
  function closeDetails() {
    detailsOpen = false;
    void tick().then(() => detailsBtn?.focus());
  }

  // ── Cómo se dice cada cosa del hilo (ADR-184) ──
  const time = (iso: string) => hourMark(timeInTz(iso, tz));
  /** Cuándo, encima de cada entrada: el día y la hora, o sólo la hora si sigue el mismo día y el mismo lado. */
  const stamp = (iso: string, day: string | null) => (day ? `${threadDayLabel(day, locale)} · ${time(iso)}` : time(iso));
  /** Su nombre de pila, como se la nombra: el contacto principal, o la organización. */
  let theirName = $derived((recipient?.full_name ?? outsiders[0] ?? title).trim().split(/\s+/)[0] ?? title);
  /** Quién de los nuestros: quien lo apuntó o lo envió, por su nombre; sin él, nadie (el lado ya dice «nosotros»). */
  function ourName(e: ConversationEventItem): string {
    const author = e.created_by ? team?.authors[e.created_by] : '';
    return (author || senderName(e.mail_from)).trim().split(/\s+/)[0] ?? '';
  }
  function whoOf(e: ConversationEventItem, side: ThreadSide): string {
    // Un mensaje importado de un chat dice quién lo escribió (un grupo tiene varios, ADR-189).
    if (side === 'theirs' && e.sender) return e.sender.trim().split(/\s+/)[0] ?? theirName;
    return side === 'theirs' ? senderName(e.mail_from).split(/\s+/)[0] || theirName : ourName(e);
  }
  /** El glifo de lo hablado o apuntado. */
  const EVENT_ICON: Record<string, ThreadIconName> = { email: 'mail', call: 'call', message: 'message', meeting: 'meeting', note: 'note' };
  /** La primera palabra de una entrada: qué fue y de quién («Llamada de Elena», «Reunión con Elena», «Apunte»). */
  function evLabel(e: ConversationEventItem, side: ThreadSide): string {
    if (e.kind === 'note') return t('thread.ev_note', locale);
    if (e.kind === 'meeting') return t('thread.ev_meeting_with', locale, { name: theirName });
    const name = whoOf(e, side);
    // Un mensaje dice por qué app (ADR-186): «WhatsApp de Elena».
    if (e.kind === 'message' && e.via && e.via !== 'other') {
      const app = messageAppName(e.via, locale);
      return name ? t('thread.ev_app_from', locale, { app, name }) : app;
    }
    return name ? t(`thread.ev_${e.kind}_from`, locale, { name }) : eventKindLabel(e.kind, locale);
  }
  /** Quién lo apuntó, por su nombre de pila; vacío si no se sabe. */
  function loggerOf(e: ConversationEventItem): string {
    const n = e.created_by ? team?.authors[e.created_by] : '';
    return (n ?? '').trim().split(/\s+/)[0] ?? '';
  }
  /** «Comentar al equipo» (ADR-185): el campo pasa al equipo con la cita de esta entrada. */
  function commentOn(label: string, iso: string, body: string | null) {
    composer?.cite(citeLine(label, `${dayMonth(iso)} · ${time(iso)}`, body));
  }
  /** En el registro en lista de los detalles: el tipo y de qué parte. */
  function loggedWhat(e: ConversationEventItem): string {
    if (e.mailout_note) return t(`mailout.note_${e.mailout_note}`, locale);
    const kind = eventKindLabel(e.kind, locale);
    return e.direction ? `${kind} · ${t(e.direction === 'outbound' ? 'thread.dir_out' : 'thread.dir_in', locale)}` : kind;
  }
  /** Lo apuntado que pesa como lo hablado: va en burbuja. Lo demás (apunte, aviso de un envío) es una línea. */
  const isBubble = (e: ConversationEventItem) => !e.mailout_note && e.kind !== 'note';
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
      back={lensOn('conversations') ? { href: conversationsListHref(), label: t('thread.back_list', locale) } : null}
      {locale}
    />
  </section>
{:else}
  {#snippet kindAsk(where: 'head' | 'line')}
    {@const q = t('chat.kind_ask_short', locale)}
    <span class="chat__kind chat__kind--{where}" role="group" aria-label={t('chat.kind_ask', locale, { name: conv!.organization!.name })} data-testid={where === 'line' ? 'conversation-kind-ask' : undefined}>
      <span class="chat__kind-q">{q}</span>
      {#each ASKED_KINDS as k (k)}
        <button type="button" class="chat__kind-act" disabled={$setKind.isPending} onclick={() => $setKind.mutate(k)}
          >{t(`organization.kind_${k}`, locale)}</button
        >
      {/each}
      <button type="button" class="chat__kind-later" onclick={() => (kindHiddenFor = conv!.id)}>{t('chat.kind_later', locale)}</button>
    </span>
  {/snippet}

  <section class="record conv chat" data-chat-open={inPeek ? undefined : ''} bind:clientWidth={chatW}>
    <!-- Con quién, en una fila: la vuelta, el nombre, sus contactos y el proyecto, los detalles y cerrar. -->
    <header class="chat__head">
      {#if !inPeek}
        <a class="chat__back" href={back.href} aria-label={back.label}>
          <span aria-hidden="true">‹</span>
        </a>
      {/if}
      <ChatMonogram name={title} />
      <div class="chat__who">
        <!-- The venue's name is its record (ADR-159): the fiscal data live there. -->
        <h1 class="chat__title">
          {#if orgHref && conv.organization?.name === title}<a class="chat__titlelink" href={orgHref}>{title}</a>{:else}{title}{/if}
        </h1>
        <p class="chat__sub">
          {#if who}<span>{who}</span>{/if}
          {#if conv.project}<span class="chat__sub-project">{conv.project.name}</span>{/if}
          {#if askKind}{@render kindAsk('head')}{/if}
        </p>
      </div>
      {#if !wide}
        <button
          type="button"
          class="chat__details"
          aria-expanded={detailsOpen}
          aria-controls="{conv.id}-details"
          data-testid="conversation-who"
          bind:this={detailsBtn}
          onclick={() => (detailsOpen ? closeDetails() : void openDetails())}
          ><ThreadIcon name="details" /><span class="visually-hidden--narrow">{t('record.details', locale)}</span></button
        >
      {/if}
      {#if onclose}
        <button type="button" class="block-head__act chat__close" aria-keyshortcuts="Escape" onclick={onclose}
          >{t('peek.close', locale)}</button
        >
      {/if}
    </header>

    <!-- Los hechos, fijos y en una línea: el turno primero (ADR-184). -->
    <div class="chat__facts" data-testid="conversation-facts">
      {#if turn?.reason === 'reply'}
        <span class="chat__fact chat__fact--ours" data-testid="conversation-turn">
          {t('thread.turn_ours', locale, { when: relativeContactDate(turn.since, locale) })}
          {#if conv.can_edit}
            <button
              type="button"
              class="fact-act"
              disabled={$patch.isPending}
              onclick={() => $patch.mutate({ reply_settled_at: turn!.since })}>{t('chat.done', locale)}</button
            >
          {/if}
        </span>
      {:else if turn?.reason === 'follow_up'}
        <!-- Un paso nuestro vencido: nos toca, aunque esperemos su respuesta (la lista dice lo mismo). -->
        <span class="chat__fact chat__fact--ours" data-testid="conversation-turn">
          {turn.waitingSince
            ? t('thread.turn_follow_up_waiting', locale, { day: dayMonth(turn.since), when: relativeContactDate(turn.waitingSince, locale) })
            : t('thread.turn_follow_up', locale, { day: dayMonth(turn.since) })}
        </span>
      {:else if turn?.reason === 'theirs'}
        <span class="chat__fact" data-testid="conversation-turn">
          {t('thread.turn_theirs', locale, { when: relativeContactDate(turn.since, locale) })}
        </span>
      {/if}
      <span class="chat__fact">
        {#if conv.can_edit}
          <ConversationStatusMenu
            relation={conv.relation}
            notNowUntil={conv.not_now_until}
            look="word"
            {locale}
            onnotnow={(not_now) => $patch.mutate({ not_now })}
          />
        {:else}
          <span class="fact-word">{relationLabel(conv.relation, locale)}</span>
        {/if}
      </span>
      {#each bolos.slice(0, 2) as b (b.bolo_id)}
        {@const when = b.first_performed_at ? dayMonth(b.first_performed_at) : t('conversations.bolo_undated', locale)}
        <span class="chat__fact" data-testid="conversation-fact-bolo">
          <span class="chat__fact-label">{t('thread.bolo', locale)}</span>
          {#if b.performance_slug}<a href={`/h/${workspaceSlug}/performance/${b.performance_slug}`}>{when}</a>{:else}{when}{/if}
          · {performanceStatusLabel(b.status, locale)}
        </span>
      {/each}
      {#if bolos.length > 2}
        <button type="button" class="fact-act chat__fact" onclick={() => void openDetails()}
          >{t('thread.more_bolos', locale, { n: bolos.length - 2 })}</button
        >
      {/if}
      <span class="chat__fact" class:chat__fact--due={stepDue}>
        <span class="chat__fact-label">{t('mail.next_step', locale)}:</span>
        {#if conv.can_edit}
          <button
            type="button"
            class="fact-act"
            aria-expanded={stepOpen}
            aria-label={hasStep ? t('record.step_edit_aria', locale, { step: stepText }) : undefined}
            data-testid="conversation-next-step"
            onclick={() => (stepOpen ? (stepOpen = false) : openStep())}>{hasStep ? stepText : t('record.step_none', locale)}</button
          >
        {:else}
          {hasStep ? stepText : t('record.step_none', locale)}
        {/if}
      </span>
      {#if conv.private}<span class="chat__fact chat__private">{t('mail.private_word', locale)}</span>{/if}
    </div>
    {#if stepOpen && conv.can_edit}
      <div class="conv__step" role="group" aria-label={t('record.step_shortcuts', locale)} bind:this={stepEl}>
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
    {#if askKind}<div class="chat__kindline">{@render kindAsk('line')}</div>{/if}

    <div class="chat__body" class:chat__body--wide={wide}>
      <div class="chat__main">
        <!-- El hilo: lo de fuera y lo del equipo, en orden, lo último abajo. -->
        <ol class="flow" aria-label={t('mail.thread', locale)} bind:this={flowEl} data-testid="conversation-thread">
          {#if $eventsQuery.isLoading}
            <li><EmptyLine text={t('conversations.loading', locale)} busy /></li>
          {:else if entries.length === 0}
            <li class="flow__empty"><EmptyLine text={t('thread.empty', locale)} /></li>
          {/if}
          {#each entries as x (x.key)}
            {#if x.kind === 'gap'}
              <li class="flow__mark flow__gap">{threadGapLabel(x.days, locale)}</li>
            {:else if x.kind === 'new'}
              <li class="flow__mark flow__new" data-entry="new">
                {t(x.count === 1 ? 'thread.new_one' : 'thread.new_other', locale, { n: x.count })}
              </li>
            {:else if x.kind === 'mail'}
              {@const e = x.event}
              {@const folded = x.long && !unfolded.has(e.id)}
              <!-- El original entero (citas, HTML, adjuntos), traído del buzón al abrirlo (punto 111). -->
              {@const hasOriginal = Boolean(e.mail_account_id)}
              <li class="bub bub--{x.side} bub--mail" data-testid="thread-mail">
                <p class="bub__head">
                  <span class="bub__what"><ThreadIcon name="mail" />{evLabel(e, x.side)}</span>
                  {#if e.mailbox_scope === 'workspace'}<span class="mb mb--shared" title={e.mailbox_address ?? ''}>{t('mail.via_shared', locale)}</span>{/if}
                  <time datetime={e.occurred_at}>{stamp(e.occurred_at, x.day)}</time>
                  {#if team}<button type="button" class="bub__cite" onclick={() => commentOn(evLabel(e, x.side), e.occurred_at, e.subject ? `${e.subject}. ${e.body ?? ''}` : e.body)}
                      ><ThreadIcon name="team" />{t('thread.comment_team', locale)}</button
                    >{/if}
                </p>
                {#if x.showSubject}<p class="bub__subject">{e.subject}</p>{/if}
                {#if e.body}
                  <p class="bub__text" class:bub__text--folded={folded}>{e.body}</p>
                {:else}
                  <p class="bub__text bub__text--none">{t('thread.mail_empty', locale)}</p>
                {/if}
                {#if originals.has(e.id)}
                  <MailOriginal conversationId={conv.id} eventId={e.id} />
                {/if}
                {#if x.long || hasOriginal || (e.direction === 'inbound' && conv.can_edit)}
                  <p class="bub__acts">
                    {#if x.long}
                      <button type="button" class="fact-act" aria-expanded={!folded} onclick={() => toggleFold(e.id)}
                        >{folded ? t('thread.unfold', locale) : t('thread.fold', locale)}</button
                      >
                    {/if}
                    {#if hasOriginal}
                      <button
                        type="button"
                        class="fact-act"
                        aria-expanded={originals.has(e.id)}
                        data-testid="mail-original-toggle"
                        onclick={() => toggleOriginal(e.id)}
                        >{originals.has(e.id) ? t('mail.original_close', locale) : t('mail.original_open', locale)}</button
                      >
                    {/if}
                    {#if e.direction === 'inbound'}
                      <button type="button" class="fact-act" onclick={() => replyToMail(e)}>{t('mail.reply', locale)}</button>
                    {/if}
                  </p>
                {/if}
              </li>
            {:else if x.kind === 'mailout'}
              {@const e = x.event}
              <li class="line line--{x.side}" data-testid="thread-mailout">
                <span
                  >{e.mailout_kind === 'invitation'
                    ? t('thread.mailout_invitation', locale, { subject: e.subject ?? '' })
                    : t('thread.mailout', locale, { subject: e.subject ?? '' })}</span
                >
                <a href={`/h/${workspaceSlug}/mailout/${e.mailout_id}`} data-testid="event-mailout">{t('thread.open_mailout', locale)}</a>
                <time datetime={e.occurred_at}>{stamp(e.occurred_at, x.day)}</time>
              </li>
            {:else if x.kind === 'logged' && isBubble(x.event)}
              {@const e = x.event}
              {@const logger = loggerOf(e)}
              <li class="bub bub--{x.side}" data-testid="thread-logged">
                <p class="bub__head">
                  <span class="bub__what"><ThreadIcon name={e.kind === 'message' ? messageAppIcon(e.via) : (EVENT_ICON[e.kind] ?? 'note')} />{evLabel(e, x.side)}</span>
                  <!-- Lo apuntado lo dice quién lo apuntó, no una forma aparte (ADR-185). -->
                  {#if e.source === 'whatsapp'}
                    <!-- Traído de un chat exportado, no apuntado (ADR-189). -->
                    <span class="bub__logged">{logger ? t('thread.ev_imported_by', locale, { name: logger }) : t('thread.ev_imported', locale)}</span>
                  {:else}
                    <span class="bub__logged">{logger ? t('thread.ev_logged_by', locale, { name: logger }) : t('thread.ev_logged', locale)}</span>
                  {/if}
                  <time datetime={e.occurred_at}>{stamp(e.occurred_at, x.day)}</time>
                  {#if team}<button type="button" class="bub__cite" onclick={() => commentOn(evLabel(e, x.side), e.occurred_at, e.body)}
                      ><ThreadIcon name="team" />{t('thread.comment_team', locale)}</button
                    >{/if}
                </p>
                {#if e.body}<p class="bub__text">{e.body}</p>{/if}
                {#if e.attachments?.length}
                  <p class="bub__att" data-testid="thread-attachments">
                    {#each e.attachments as a, i (i)}
                      <span>{t(attachmentKey(a.type as AttachmentType), locale)}{#if a.name}{' · '}<span class="bub__att-name">{a.name}</span>{/if}</span>
                    {/each}
                  </p>
                {/if}
              </li>
            {:else if x.kind === 'logged'}
              {@const e = x.event}
              <li class="line line--{x.side}" data-testid="thread-logged">
                {#if e.mailout_note}
                  <span class="line__what"><ThreadIcon name="mailout" />{t(`mailout.note_${e.mailout_note}`, locale)}</span>
                {:else}
                  <span class="line__what"><ThreadIcon name="note" />{t('thread.ev_note', locale)}</span>
                  {#if e.body}<span class="line__text">{e.body}</span>{/if}
                {/if}
                <time datetime={e.occurred_at}>{stamp(e.occurred_at, x.day)}</time>
              </li>
            {:else if x.kind === 'team' && team}
              <MessageItem
                message={x.message}
                author={(x.message.author_id && team.authors[x.message.author_id]) || ''}
                mine={x.message.author_id === team.me}
                mark={t('thread.team_mark', locale)}
                look="note"
                stamp={stamp(x.message.created_at, x.day)}
                {locale}
                onchange={refreshTeam}
              />
            {/if}
          {/each}
          {#if $teamQuery.isError}
            <li><EmptyLine text={t('threads.team_error', locale)} /></li>
          {/if}
        </ol>

        <div class="chat__foot" bind:this={footEl}>
          {#key conv.id}
          <ConversationComposer
            bind:this={composer}
            conversation={{ id: conv.id, workspace_id: conv.workspace_id, line_id: conv.line_id, can_edit: conv.can_edit }}
            {workspaceSlug}
            {recipient}
            {outsiders}
            mail={$mailQuery.data}
            {replyTo}
            {locale}
            onsent={afterSent}
          />
          {/key}
        </div>
      </div>

      {#if wide || detailsOpen}
        <!-- Los detalles: columna al lado, o encima del hilo hasta «Cerrar» o Esc. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <aside
          id="{conv.id}-details"
          class="details"
          class:details--over={!wide}
          aria-label={t('record.details', locale)}
          data-testid="record-details"
          tabindex="-1"
          bind:this={detailsEl}
          onkeydown={(e) => {
            if (e.key === 'Escape' && !wide && !e.defaultPrevented) {
              e.preventDefault();
              e.stopPropagation();
              closeDetails();
            }
          }}
        >
          {#if !wide}
            <div class="details__head">
              <span class="details__title">{t('record.details', locale)}</span>
              <button type="button" class="block-head__act" onclick={closeDetails}>{t('peek.close', locale)}</button>
            </div>
          {/if}
    <div class="details__body">
      <div class="details__block">
        <BlockHead title={t('thread.contacts', locale)} level={3} />
        {#if contacts.length === 0}
          <EmptyLine text={t('thread.no_contacts', locale)} />
        {/if}
        {#each contacts as c (c.person_id)}
          {@const p = c.person!}
          <p class="details__contact">
            <span class="details__name">{p.full_name}</span>
            {#if c.role}<span class="muted">{c.role}</span>{/if}
            {#if p.email}<span>{p.email}</span>{/if}
            {#if p.phone}
              <a
                href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}
                aria-label={t('record.call_aria', locale, { name: p.full_name, phone: p.phone })}
                data-testid={c.is_primary ? 'conversation-call' : undefined}
                onclick={() => {
                  detailsOpen = false;
                  composer?.startCall();
                }}>{p.phone}</a
              >
            {/if}
          </p>
        {/each}
        {#if orgHref}<p class="details__line"><a href={orgHref}>{t('thread.org_record', locale)}</a></p>{/if}
      </div>

      {#if bolos.length > 0 || canOpenBolo}
        <div class="details__block" data-testid="conversation-bolos">
          <BlockHead title={t('conversations.bolos', locale)} level={3} />
          {#each bolos as b (b.bolo_id)}
            {@const when = b.first_performed_at ? dayMonth(b.first_performed_at) : t('conversations.bolo_undated', locale)}
            <p class="details__line">
              {#if b.performance_slug}<a href={`/h/${workspaceSlug}/performance/${b.performance_slug}`}>{when}</a>{:else}{when}{/if}
              · {performanceStatusLabel(b.status, locale)}{#if b.function_count > 1}<span class="muted">
                  · {t('perf.bolo_functions_other', locale, { n: b.function_count })}</span
                >{/if}
            </p>
          {/each}
          {#if canOpenBolo}
            <span><Button variant="quiet" size="xs" loading={$openBolo.isPending} onclick={() => $openBolo.mutate()}
                >{t('conversations.open_bolo', locale)}</Button
              ></span>
          {/if}
        </div>
      {/if}

      <dl class="details__facts">
        <div>
          <dt class="field__label">{t('mail.last_contact', locale)}</dt>
          <dd>{relativeContactDate(conv.last_contacted_at, locale)}</dd>
        </div>
        {#if plannerHref}
          <div>
            <dt class="field__label">{t('lens.planner', locale)}</dt>
            <dd><a href={plannerHref} data-testid="conversation-planner">{t('conversations.see_in_planner', locale)}</a></dd>
          </div>
        {/if}
      </dl>

      <ConversationTags conversationId={conv.id} workspaceId={conv.workspace_id} tags={conv.tags} canEdit={conv.can_edit} {locale} />

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

      <div class="details__block">
        <BlockHead title={t('mail.mailboxes_here', locale)} concept="mailboxes" level={3} />
        {#each mailboxes as [address, scope] (address)}
          <p class="details__line">
            <span class="mb" class:mb--shared={scope === 'workspace'}>
              {scope === 'workspace' ? t('mail.shared_mailbox', locale) : t('mail.personal_mailbox', locale)}
            </span>
            <span class="muted">{address}</span>
          </p>
        {:else}
          <EmptyLine text={t('mail.no_mail_yet', locale)} />
        {/each}
      </div>

      <!-- El registro en lista (ADR-099 § 5, la otra vista del mismo dato), lo más nuevo arriba. -->
      <div class="details__block" data-testid="conversation-record">
        <BlockHead title={t('conversations.history', locale)} count={events.length} level={3} />
        {#if events.length === 0}
          <EmptyLine text={t('conversations.history_empty', locale)} />
        {:else}
          <ol class="rec">
            {#each events as e (e.id)}
              <li class="rec__item">
                <time class="rec__when" datetime={e.occurred_at}>{dayMonthYearTs(e.occurred_at)}</time>
                <span class="rec__what">{loggedWhat(e)}</span>
                <span class="rec__snippet">{e.subject || firstLine(e.body)}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </div>
        </aside>
      {/if}
    </div>
  </section>

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

<style>
  @layer components {
    .chat {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    /* On its own page the chat fills the screen: the field at the foot even
       when little has been said. */
    .chat[data-chat-open] {
      /* What the shell leaves: its top bar (set on .shell, so read here), the
         page's own air above and under, the lens bar on a phone. */
      min-block-size: calc(100dvh - var(--header-height) - var(--space-l) - var(--space-xxl) - var(--shell-foot));
    }

    /* ── Cabecera: una fila ── */
    .chat__head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
    }
    .chat__back {
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
    .chat__who {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .chat__title {
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
    .chat__titlelink {
      color: inherit;
      text-decoration: none;
    }
    .chat__titlelink:hover {
      text-decoration: underline;
      text-decoration-thickness: var(--line-hairline);
    }
    /* Who, the project and, while the type is missing, the question of what
       it is, where the answer will go (ADR-177 § 2). */
    .chat__sub {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-xs);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .chat__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-xs);
      color: var(--text-faint);
    }
    .chat__details {
      display: inline-flex;
      flex: none;
      align-items: baseline;
      gap: var(--space-xs);
      padding: var(--space-2xs) var(--space-s);
      color: var(--text-muted);
      background: none;
      border: var(--line-hairline) solid var(--border-color-dark);
      border-radius: var(--radius);
      font: inherit;
      font-size: var(--text-s);
      cursor: pointer;
    }
    .chat__details[aria-expanded='true'] {
      color: var(--heading-color);
      background: var(--bg-light);
    }
    .chat__close {
      flex: none;
    }

    /* ── Hechos: una línea, el turno primero ── */
    .chat__facts {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-l);
      padding-block: var(--space-xs);
      border-block: var(--line-hairline) solid var(--border-color-light);
      font-size: var(--text-s);
    }
    .chat__fact {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      max-inline-size: 100%;
    }
    .chat__fact-label {
      color: var(--text-muted);
    }
    /* The state in the line's own voice here, not the records' mono word
       (ADR-184, after ADR-179 § 5): one voice in a chat's head. */
    .chat__facts :global(.fact-word) {
      font-family: inherit;
      font-size: inherit;
      letter-spacing: normal;
    }
    /* A long step («margen · 03 nov 2026») on a phone wraps inside its fact
       instead of running past the edge, where the page cut it. */
    .chat__fact .fact-act {
      min-inline-size: 0;
      white-space: normal;
      text-align: start;
    }
    .chat__fact--ours {
      color: var(--heading-color);
      font-weight: 500;
    }
    .chat__fact--ours .fact-act {
      font-weight: 400;
    }
    .chat__fact--due .fact-act {
      color: var(--warning);
    }
    .chat__private {
      color: var(--text-faint);
    }
    .conv__step-acts {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
    }
    /* The type's question (115): quiet words, the answer one touch away. In
       the head on a wide record; its own line under the facts on a narrow
       one, where the head has no room. */
    .chat__kind {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
    }
    .chat__kind-q,
    .chat__kind-later {
      color: var(--text-faint);
    }
    .chat__kind-act,
    .chat__kind-later {
      padding: 0;
      color: var(--text-muted);
      background: none;
      border: 0;
      font: inherit;
      text-decoration: underline dotted;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .chat__kind-later {
      color: var(--text-faint);
      text-decoration: none;
    }
    .chat__kindline {
      display: none;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
      font-size: var(--text-s);
    }
    .conv__step-day {
      margin-inline-start: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }

    /* ── Cuerpo: el hilo con su campo, y los detalles al lado o encima ── */
    .chat__body {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }
    .chat__body--wide {
      grid-template-columns: minmax(0, 1fr) var(--chat-details-inline);
    }
    .chat__main {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }
    .chat__body--wide .chat__main {
      padding-inline-end: var(--space-l);
    }
    /* On its own page the details stay in view while the thread scrolls. */
    .chat[data-chat-open] .details:not(.details--over) {
      position: sticky;
      inset-block-start: var(--header-height);
      align-self: start;
      max-block-size: calc(100dvh - var(--header-height));
      overflow-y: auto;
    }

    /* ── El hilo (ADR-184): el lado dice quién, el peso cómo llegó ── */
    .flow {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-m);
      margin: 0;
      padding: var(--space-m) 0;
      list-style: none;
    }
    /* The centre is time's: the line of what is new and a silence of a
       week or more. Nothing else goes in the middle. */
    .flow__mark {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      color: var(--text-faint);
      font-size: var(--text-s);
    }
    .flow__mark::before,
    .flow__mark::after {
      content: '';
      flex: 1;
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .flow__new {
      color: var(--info, var(--text-muted));
      scroll-margin-block-start: var(--space-xxl);
    }
    .flow__new::before,
    .flow__new::after {
      border-color: currentColor;
      opacity: 0.35;
    }

    /* Weight 1, what was said with them: a bubble on its side. */
    .bub {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      max-inline-size: var(--thread-letter-max);
      padding: var(--space-xs) var(--space-m) var(--space-s);
      background: var(--thread-theirs-bg);
      border: var(--line-hairline) solid var(--thread-theirs-rule);
      border-radius: var(--thread-bubble-radius);
    }
    .bub--theirs {
      align-self: flex-start;
      border-end-start-radius: var(--thread-bubble-tail);
    }
    .bub--ours {
      align-self: flex-end;
      background: var(--thread-ours-bg);
      border-color: var(--thread-ours-rule);
      border-end-end-radius: var(--thread-bubble-tail);
    }
    .bub--mail {
      inline-size: var(--thread-letter-max);
    }
    .bub p {
      margin: 0;
    }
    .bub__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      color: var(--text-faint);
      font-size: var(--text-s);
    }
    .bub__what {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
      color: var(--text-muted);
      font-weight: 500;
    }
    .bub__head time {
      margin-inline-start: auto;
      padding-inline-start: var(--space-m);
    }
    /* «Comentar al equipo»: where there is a pointer it waits for the bubble
       (hover or focus), on a touch screen it stays; in the team's amber. */
    .bub__cite {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-2xs);
      padding: 0;
      color: var(--thread-team-fg);
      background: none;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    @media (hover: hover) and (pointer: fine) {
      .bub__cite {
        display: none;
      }
      .bub:hover .bub__cite,
      .bub:focus-within .bub__cite {
        display: inline-flex;
      }
    }
    .bub__subject {
      color: var(--heading-color);
      font-weight: 600;
    }
    .bub__text {
      color: var(--text-color);
      font-size: var(--text-m);
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    /* The beginning of a long mail; the rest unfolds right here. */
    .bub__text--folded {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--thread-fold-lines);
      line-clamp: var(--thread-fold-lines);
    }
    /* What came attached to an imported message: its kind and file name, not the file. */
    .bub__att {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-s);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .bub__att-name {
      color: var(--text-faint);
      overflow-wrap: anywhere;
    }
    .bub__text--none {
      color: var(--text-faint);
    }
    .bub__acts {
      display: flex;
      gap: var(--space-m);
      font-size: var(--text-s);
    }

    /* Weight 3, ours with nobody to read it (a note to self, a mailout, a
       mailout's notice): one small line on its side, no bubble. */
    .line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      max-inline-size: var(--thread-letter-max);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .line--theirs {
      align-self: flex-start;
    }
    .line--ours {
      align-self: flex-end;
      justify-content: flex-end;
    }
    .line__what {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-xs);
      font-weight: 500;
    }
    .line__text {
      color: var(--text-muted);
      white-space: pre-line;
    }
    .line a {
      color: var(--text-muted);
    }
    .line time {
      color: var(--text-faint);
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

    /* ── El pie: el campo, siempre a mano ── */
    .chat__foot {
      position: sticky;
      inset-block-end: var(--shell-foot);
      z-index: var(--z-sticky);
      padding-block: var(--space-s);
      background: var(--bg);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }

    /* ── Detalles: columna al lado, o panel encima del hilo ── */
    .details {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      min-inline-size: 0;
      padding: var(--space-m) 0 var(--space-m) var(--space-l);
      border-inline-start: var(--line-hairline) solid var(--border-color-light);
    }
    .details:focus {
      outline: none;
    }
    .details__body {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    /* Over the thread, fixed to the window's right edge under the top bar:
       the conversation stays where it was underneath (Marco, 2026-11-05). */
    .details--over {
      position: fixed;
      inset-block: var(--header-height) var(--shell-foot);
      inset-inline-end: 0;
      z-index: var(--z-sticky);
      inline-size: min(100%, var(--chat-details-over));
      padding: var(--space-m) var(--space-l);
      overflow-y: auto;
      overscroll-behavior: contain;
      background: var(--bg);
      border-inline-start: var(--line-hairline) solid var(--border-color-dark);
      box-shadow: var(--box-shadow-3);
    }
    .details__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding-block-end: var(--space-s);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .details__title {
      color: var(--heading-color);
      font-weight: 500;
    }
    .details__block {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .details__contact,
    .details__line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      margin: 0;
      font-size: var(--text-s);
    }
    .details__name {
      color: var(--heading-color);
      font-weight: 500;
    }
    .details__facts {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin: 0;
    }
    .details__facts dd {
      margin: 0;
      font-size: var(--text-s);
    }
    .muted {
      color: var(--text-faint);
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
    .rec {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rec__item {
      display: grid;
      grid-template-columns: 7.5rem auto minmax(0, 1fr);
      gap: var(--space-s);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--divider-light);
      font-size: var(--text-s);
    }
    .rec__when {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .rec__what {
      color: var(--text-dark-muted);
      font-size: var(--text-xs);
    }
    .rec__snippet {
      overflow: hidden;
      color: var(--text-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* A phone (or a narrow vistazo): the head is the way back and the door
       to the details; the question of the type gets its own line. */
    @container record (max-width: 47.999rem) {
      .chat__sub {
        flex-wrap: nowrap;
        overflow: hidden;
        white-space: nowrap;
      }
      .chat__sub > * {
        flex: 0 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .chat__sub > .chat__sub-project,
      .chat__kind--head {
        display: none;
      }
      .chat__kindline {
        display: block;
      }
      /* The facts stay one line, as in a chat's head: it slides sideways. */
      .chat__facts {
        flex-wrap: nowrap;
        overflow-x: auto;
        white-space: nowrap;
        scrollbar-width: none;
      }
      .chat__fact {
        flex-wrap: nowrap;
      }
      .chat__fact .fact-act {
        white-space: nowrap;
      }
      .chat__title {
        font-size: var(--text-m);
      }
      .rec__item {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-2xs);
      }
    }
    @media (max-width: 47.999rem) {
      .chat__back {
        display: inline-flex;
      }
      /* A phone: the details take the whole screen, the chat under them. */
      .details--over {
        inline-size: 100%;
        border-inline-start: 0;
        box-shadow: none;
      }
    }
  }
</style>
