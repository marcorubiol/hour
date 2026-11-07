<script lang="ts">
  /**
   * La pantalla de un envío de difusión (plan § 10, ADR-115).
   *
   * Borrador: De (el dominio verificado de la compañía), a dónde van las
   * respuestas, idioma, asunto y cuerpo con los campos `{nombre}`, `{sala}`,
   * `{ciudad}`, `{obra}` (y en una invitación `{fecha}` y `{hora}`); la vista previa destinatario a destinatario con la firma y el
   * pie reales (mailout-compose.ts, lo mismo que monta la cola); la lista de
   * destinatarios con su estado, quitar uno y apuntar su base; «Enviarme una
   * prueba» y «Enviar a N» con confirmación. El borrador se guarda solo.
   *
   * Después: los recuentos y el estado de cada destinatario, con refresco al
   * volver a la pestaña y cada 30 s mientras sale (sin realtime, como los
   * hilos), y «Cancelar lo que falta».
   *
   * Mientras el envío sea simulado (ADR-111), la pantalla lo dice; nunca
   * nombra el servicio.
   *
   * La plantilla (ADR-172): el logo del espacio arriba (se cambia en Ajustes)
   * y, si se elige aquí, una imagen del espectáculo tras el texto, enlazada al
   * dosier. La vista previa enseña el correo con la plantilla o solo el texto.
   *
   * Una invitación (ADR-173 § 10, plan del público § 6.1) es esta misma
   * pantalla con dos bloques de destinatarios: «Público» (una lista, cuántas
   * recibirán y desde el subdominio del público) y «Profesionales» (las
   * conversaciones elegidas, como en el envío, desde la difusión). La vista
   * previa recorre los dos orígenes con el pie real de cada uno; en borrador,
   * el público es una muestra (sus filas se congelan al poner en cola).
   *
   * Una invitación puede ser «Con diseño» (ADR-192): el cuerpo deja de
   * escribirse aquí y se diseña en el editor (MailDesignEditor, a toda
   * pantalla); su texto plano lo deriva el servidor y la vista previa enseña
   * el diseño con el pie de Hour. La difusión no tiene ese selector.
   */
  import { docTitle } from '$lib/doc-title';
  import { lensOn } from '$lib/lenses.svelte';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { tick, untrack } from 'svelte';
  import { ApiError, fetchJSON, mutateJSON, uploadBlob } from '$lib/api';
  import { shrinkImage } from '$lib/image-shrink';
  import { mailTemplate } from '$lib/mail-template';
  import { kindLabel, type MaterialItem } from '$lib/material';
  import Segmented from '$lib/components/Segmented.svelte';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import { dayMonthYear } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import MailoutTestMode from '$lib/components/MailoutTestMode.svelte';
  import MailoutFigures from '$lib/components/MailoutFigures.svelte';
  import MailDesignEditor from '$lib/components/MailDesignEditor.svelte';
  import { designText, type DesignContent } from '$lib/mail-design';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    recipientCounts,
    recipientState,
    senderAddress,
    type AudiencePreview,
    type MailoutDetail,
    type MailoutRecipientRow,
    type RecipientState,
  } from '$lib/mailout';
  import { goto } from '$app/navigation';
  import {
    composeMailout,
    MAILOUT_LANGUAGES,
    mergeFieldsFor,
    recipientLanguage,
    suggestedBasis,
    unsubscribeUrl,
    type ComposeContext,
    type MailBasisKind,
  } from '$lib/mailout-compose';

  const locale = appLocale();
  const queryClient = useQueryClient();
  const REFRESH_MS = 30_000;

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let id = $derived(page.params.id ?? '');

  const query = createQuery(
    toStore(() => ({
      queryKey: ['mailout', id] as const,
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<MailoutDetail>(`/api/mailout/${id}`, signal),
      // Mientras sale, cada 30 s; volver a la pestaña recarga siempre.
      refetchInterval: (q: { state: { data?: MailoutDetail } }) =>
        ['queued', 'sending'].includes(q.state.data?.mailout.status ?? '') ? REFRESH_MS : false,
    })),
  );

  let d = $derived($query.data ?? null);
  let m = $derived(d?.mailout ?? null);
  let editable = $derived(Boolean(d?.can_edit && m?.status === 'draft'));
  let invitation = $derived(m?.kind === 'invitation');

  // ── El borrador, en local; se guarda solo ─────────────────────────────
  let subject = $state('');
  let body = $state('');
  let language = $state<string>(locale);
  let domainId = $state('');
  let localPart = $state('difusion');
  let fromName = $state('');
  // La imagen del espectáculo (ADR-172): se manda solo cuando cambia.
  let imageUrl = $state('');
  let imageAlt = $state('');
  let imageLink = $state('');
  let imageDirty = $state(false);
  let imageRev = 0;
  // El diseño de una invitación (ADR-192): se manda solo cuando cambia.
  let designContent = $state<DesignContent | null>(null);
  let designHtml = $state<string | null>(null);
  let designDirty = $state(false);
  let designRev = 0;
  let editorOpen = $state(false);
  let askLetter = $state(false);
  let loadedFor = $state('');
  let dirty = $state(false);

  $effect(() => {
    const mo = m;
    if (!mo || untrack(() => loadedFor) === mo.id) return;
    loadedFor = mo.id;
    subject = mo.subject ?? '';
    body = mo.body ?? '';
    language = mo.language;
    domainId = mo.mail_domain_id ?? d?.domains[0]?.id ?? '';
    localPart = mo.from_local_part;
    fromName = mo.from_name ?? '';
    imageUrl = mo.image_url ?? '';
    imageAlt = mo.image_alt ?? '';
    imageLink = mo.image_link_url ?? '';
    imageDirty = false;
    designContent = mo.design ?? null;
    designHtml = mo.design_html ?? null;
    designDirty = false;
    dirty = false;
  });

  function touch() {
    dirty = true;
  }

  function touchImage() {
    imageRev += 1;
    imageDirty = true;
    dirty = true;
  }

  /** Lo que sale del editor: el cuerpo pasa a ser su texto, como lo derivará el servidor. */
  function designDone(design: { content: DesignContent; html: string }) {
    designContent = design.content;
    designHtml = design.html;
    body = designText(design.content);
    editorOpen = false;
    designRev += 1;
    designDirty = true;
    dirty = true;
  }

  /** Volver a carta: el diseño se borra y su texto se queda como cuerpo. */
  function toLetter() {
    designContent = null;
    designHtml = null;
    askLetter = false;
    designRev += 1;
    designDirty = true;
    dirty = true;
  }

  /** La carta que había, como primeros bloques de un diseño nuevo. */
  let designStarter = $derived({
    title: d?.project?.name ?? null,
    paragraphs: body
      .trim()
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`),
  });
  let designBlocks = $derived(designContent?.blocks.length ?? 0);

  const save = createMutation({
    mutationFn: () => {
      const sendsImage = imageDirty;
      const rev = imageRev;
      const sendsDesign = designDirty;
      const dRev = designRev;
      return mutateJSON('PATCH', `/api/mailout/${id}`, {
        subject,
        body,
        language,
        mail_domain_id: domainId || null,
        from_local_part: localPart,
        from_name: fromName.trim() || null,
        ...(sendsImage
          ? { image: imageUrl ? { url: imageUrl, alt: imageAlt.trim() || null, link: imageLink.trim() || null } : null }
          : {}),
        ...(sendsDesign ? { design: designContent && designHtml ? { content: designContent, html: designHtml } : null } : {}),
      }).then(() => ({ image: sendsImage ? rev : null, design: sendsDesign ? dRev : null }));
    },
    onSuccess: (sent) => {
      dirty = false;
      // Lo que cambió mientras se guardaba sigue pendiente.
      if (sent.image === imageRev) imageDirty = false;
      if (sent.design === designRev) designDirty = false;
    },
    onError: (err) => failed(err),
  });

  const uploadImage = createMutation({
    mutationFn: async (file: File) => {
      const blob = await shrinkImage(file, { maxWidth: 1200, maxHeight: 2400, type: 'image/jpeg', maxBytes: 600_000 });
      return uploadBlob<{ image_url: string }>(`/api/mailout/${id}/image`, blob);
    },
    onSuccess: (r) => {
      if (!r) return;
      imageUrl = r.image_url;
      if (!imageAlt.trim()) imageAlt = d?.project?.name ?? '';
      touchImage();
    },
    onError: (err) => failed(err),
  });

  let imageInput = $state<HTMLInputElement | null>(null);
  function imagePicked(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    if (file) $uploadImage.mutate(file);
    el.value = '';
  }
  function removeImage() {
    imageUrl = '';
    imageAlt = '';
    imageLink = '';
    touchImage();
  }

  // Los enlaces que ya tiene la línea del envío: el dosier primero.
  const LINK_KINDS = ['dossier', 'video', 'tech_sheet', 'rider'];
  let lineId = $derived(m?.line_id ?? '');
  const materials = createQuery(
    toStore(() => ({
      queryKey: ['line-materials', lineId] as const,
      enabled: Boolean(lineId && editable),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MaterialItem[] }>(`/api/lines/${lineId}/materials`, signal),
    })),
  );
  let linkChoices = $derived(
    ($materials.data?.items ?? [])
      .filter((x) => LINK_KINDS.includes(x.kind))
      .sort((a, b) => LINK_KINDS.indexOf(a.kind) - LINK_KINDS.indexOf(b.kind))
      .slice(0, 4),
  );

  $effect(() => {
    // Leer los campos ata el efecto a ellos: cada cambio reinicia la espera.
    void [subject, body, language, domainId, localPart, fromName, imageUrl, imageAlt, imageLink, designHtml];
    if (!dirty || !editable) return;
    const timer = setTimeout(() => $save.mutate(), 700);
    return () => clearTimeout(timer);
  });

  async function flush() {
    if (dirty) await $save.mutateAsync();
  }

  // ── Lo que se ve ──────────────────────────────────────────────────────
  let domain = $derived(d?.domains.find((x) => x.id === domainId) ?? null);
  let fromLine = $derived(
    domain ? `${fromName.trim() || d?.workspace.name || ''} <${senderAddress(localPart, domain.domain)}>` : '',
  );
  // El público sale por su subdominio, con la parte local de ese dominio (ADR-173 § 5).
  let audienceDomain = $derived(d?.audience_domain ?? null);
  let audienceFromLine = $derived(
    audienceDomain
      ? `${fromName.trim() || d?.workspace.name || ''} <${senderAddress(audienceDomain.from_local_part, audienceDomain.domain)}>`
      : '',
  );
  let draft = $derived({ subject, body, language });
  let ctxById = $derived(new Map((d?.compose ?? []).map((c) => [c.recipient_id, c])));

  function missingFor(r: MailoutRecipientRow): boolean {
    const c = ctxById.get(r.recipient_id);
    return c ? composeMailout(draft, c, '').missing.length > 0 : false;
  }

  let rows = $derived(
    (d?.recipients ?? []).map((r) => ({
      row: r,
      ctx: ctxById.get(r.recipient_id) ?? null,
      state: (editable ? recipientState(r, missingFor(r)) : recipientState(r, false)) as RecipientState,
    })),
  );
  // Los dos orígenes de una invitación (la fila dice el suyo).
  let proRows = $derived(rows.filter((x) => x.row.conversation_id !== null));
  let audienceRows = $derived(rows.filter((x) => x.row.audience_subscription_id !== null));
  /** Una persona del público de la muestra, como una fila más de la vista previa. */
  function sampleRow(c: AudiencePreview): MailoutRecipientRow {
    return {
      recipient_id: c.recipient_id,
      conversation_id: null,
      audience_subscription_id: c.audience_subscription_id,
      mail_domain_id: null,
      address: c.address,
      display_name: c.display_name,
      address_kind: 'subscriber',
      status: 'pending',
      skip_reason: null,
      basis_kind: c.basis_kind,
      basis_withdrawn_at: null,
      suppressed_reason: null,
      suppressed_at: null,
      ready: true,
    };
  }
  let samples = $derived(
    editable
      ? (d?.audience_preview ?? []).map((c) => {
          const row = sampleRow(c);
          return { row, ctx: c as ComposeContext, state: (composeMailout(draft, c, '').missing.length ? 'missing_fields' : 'ready') as RecipientState };
        })
      : [],
  );
  // En borrador, el público que recibiría es el de la lista; luego, sus filas.
  let audienceReady = $derived(editable ? (d?.audience?.eligible ?? 0) : 0);
  let audienceMissing = $derived(samples.some((x) => x.state === 'missing_fields'));
  let readyCount = $derived(rows.filter((x) => x.state === 'ready').length + (audienceMissing ? 0 : audienceReady));
  let missingCount = $derived(rows.filter((x) => x.state === 'missing_fields').length + (audienceMissing ? audienceReady : 0));
  /**
   * What stands between the draft and sending (ADR-180): a domain for the
   * professionals, the basis each one still lacks, a subject and a text. The
   * fields that miss a value are the note above; the rest is here, in one place.
   */
  let blockers = $derived.by(() => {
    if (!d || !editable) return [];
    const out: { key: string; text: string; href?: string; onclick?: () => void }[] = [];
    if (!domain && (!invitation || proRows.length > 0)) {
      out.push({ key: 'domain', text: t('mailout.block_domain', locale), href: `/h/${workspaceSlug}/settings?section=mail` });
    }
    const noBasis = rows.filter((x) => x.state === 'no_basis').length;
    if (noBasis > 0) {
      out.push({ key: 'basis', text: t(noBasis === 1 ? 'mailout.block_basis_one' : 'mailout.block_basis', locale, { n: noBasis }), onclick: showWho });
    }
    if (!subject.trim() || !body.trim()) out.push({ key: 'text', text: t('mailout.block_text', locale) });
    return out;
  });
  let counts = $derived(recipientCounts(rows.map((x) => x.state)));

  // Vista previa: los que tienen dirección, el que se mira; primero los que
  // salen (o salieron), después los que se quedan fuera.
  const OUT_STATES: RecipientState[] = [
    'no_address',
    'suppressed',
    'no_basis',
    'not_now',
    'duplicate',
    'unavailable',
    'cancelled',
  ];
  let previewable = $derived(
    [...rows, ...samples]
      .filter((x) => x.ctx && x.row.address)
      .sort((a, b) => Number(OUT_STATES.includes(a.state)) - Number(OUT_STATES.includes(b.state))),
  );
  let previewIndex = $state(0);
  let current = $derived(previewable[Math.min(previewIndex, Math.max(previewable.length - 1, 0))] ?? null);
  let exampleLink = $derived(unsubscribeUrl(page.url.origin, '…'));
  let template = $derived(
    mailTemplate(
      d
        ? {
            company_name: d.workspace.name,
            logo_url: d.workspace.logo_url,
            image_url: imageUrl || null,
            image_alt: imageAlt.trim() || null,
            image_link_url: imageLink.trim() || null,
            design_html: invitation ? designHtml : null,
          }
        : null,
      page.url.origin,
    ),
  );
  let designed = $derived(Boolean(invitation && template.design));
  let hasTemplate = $derived(Boolean(template.logo || template.image || designed));
  let preview = $derived(current?.ctx ? composeMailout(draft, current.ctx, exampleLink, template) : null);
  // 104: el pie de una persona del público sale en el idioma de su suscripción.
  let currentLanguage = $derived(current?.ctx ? recipientLanguage(language, current.ctx) : null);
  let currentFrom = $derived(current?.row.audience_subscription_id ? audienceFromLine : fromLine);
  // Con plantilla si la hay; quien mira puede pasar a solo texto (lo que leen
  // los clientes sin HTML) y volver.
  let previewChoice = $state<'html' | 'text' | null>(null);
  // How it reaches them (ADR-180): the width of a desk or a phone, and the
  // client's dark mode, which the mail's own sheet answers.
  let previewDevice = $state<'desktop' | 'mobile'>('desktop');
  let previewScheme = $state<'light' | 'dark'>('light');
  /** The mail as a dark client paints it: its dark sheet, applied whatever the viewer's theme. */
  function darkPreview(html: string): string {
    return html.replace('@media (prefers-color-scheme:dark){', '@media all{');
  }

  // On a phone the screen is three tabs; wider, all three show (ADR-180).
  const PANES = ['write', 'preview', 'who'] as const;
  let pane = $state<(typeof PANES)[number]>('write');
  function showWho() {
    pane = 'who';
    void tick().then(() => document.getElementById('mo-who')?.scrollIntoView({ block: 'start' }));
  }
  let previewMode = $derived(previewChoice ?? (hasTemplate ? 'html' : 'text'));
  let frameHeight = $state(0);
  function fitFrame(e: Event) {
    const doc = (e.currentTarget as HTMLIFrameElement).contentDocument;
    frameHeight = doc?.documentElement.scrollHeight ?? 0;
  }

  // ── Acciones ──────────────────────────────────────────────────────────
  function failed(err: unknown) {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    const known = code && t(`mailout.err_${code}`, locale) !== `mailout.err_${code}` ? t(`mailout.err_${code}`, locale) : '';
    addToast({
      tone: 'danger',
      title: t('mailout.action_failed', locale),
      message: known || (err instanceof Error ? err.message : t('perf.unexpected', locale)),
    });
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['mailout', id] });
    // Its row in Envíos (status, recipients, figures) is another read (ADR-176).
    void queryClient.invalidateQueries({ queryKey: ['mailout-list'] });
  }

  // Removing is immediate, so it says who and offers to undo (móvil #6): the
  // undo puts the same set back, the one this removal started from.
  const setRecipients = createMutation({
    mutationFn: (conversationIds: string[]) =>
      mutateJSON('PUT', `/api/mailout/${id}/recipients`, { conversation_ids: conversationIds }),
    onSuccess: refresh,
    // In an invitation the list may hold another editor's professionals from
    // a project the caller does not edit: the replace is refused whole.
    onError: (err) =>
      invitation && err instanceof ApiError && err.status === 404
        ? addToast({ tone: 'danger', title: t('mailout.action_failed', locale), message: t('mailout.err_pros_not_yours', locale) })
        : failed(err),
  });
  function removeOne(r: MailoutRecipientRow, name: string) {
    const before = (d?.recipients ?? []).map((x) => x.conversation_id).filter((cid): cid is string => cid !== null);
    $setRecipients.mutate(before.filter((cid) => cid !== r.conversation_id), {
      onSuccess: () =>
        addToast({
          tone: 'info',
          message: t('mailout.removed_one', locale, { name }),
          duration: 8000,
          action: { label: t('mailout.undo', locale), run: () => $setRecipients.mutate(before) },
        }),
    });
  }

  let basisFor = $state<MailoutRecipientRow | null>(null);
  let basisOpen = $state(false);
  let basisKind = $state<MailBasisKind>('relationship');
  let basisNote = $state('');

  function openBasis(r: MailoutRecipientRow) {
    basisFor = r;
    basisKind = suggestedBasis(r.address_kind === 'subscriber' ? null : r.address_kind);
    basisNote = '';
    basisOpen = true;
  }

  const saveBasis = createMutation({
    mutationFn: () =>
      mutateJSON('POST', `/api/mailout/${id}/basis`, {
        recipient_id: basisFor?.recipient_id,
        kind: basisKind,
        note: basisNote.trim() || null,
      }),
    onSuccess: () => {
      basisOpen = false;
      refresh();
    },
    onError: failed,
  });

  const sendTest = createMutation({
    mutationFn: async () => {
      await flush();
      const sub = current?.row.audience_subscription_id ?? null;
      return mutateJSON<{ to: string; simulated: boolean }>('POST', `/api/mailout/${id}/test`, {
        recipient_id: sub ? null : (current?.row.recipient_id ?? null),
        audience_subscription_id: sub,
      });
    },
    onSuccess: (r) => {
      if (!r) return;
      addToast({
        tone: 'success',
        message: t(r.simulated ? 'mailout.test_simulated' : 'mailout.test_sent', locale, { to: r.to }),
      });
    },
    onError: failed,
  });

  let confirmOpen = $state(false);

  const send = createMutation({
    mutationFn: async () => {
      await flush();
      return mutateJSON<{ status: string }>('POST', `/api/mailout/${id}/send`, {});
    },
    onSuccess: () => {
      confirmOpen = false;
      refresh();
      // La primera pasada corre en el servidor: se vuelve a mirar enseguida.
      setTimeout(refresh, 2000);
    },
    onError: (err) => {
      confirmOpen = false;
      failed(err);
      refresh();
    },
  });

  // La lista de una invitación: ponerla, cambiarla o quitarla.
  const setAudience = createMutation({
    mutationFn: (audienceId: string | null) => mutateJSON('PUT', `/api/mailout/${id}/audience`, { audience_id: audienceId }),
    onSuccess: refresh,
    onError: failed,
  });
  let audienceOptions = $derived([
    { value: '', label: t('mailout.invitation_no_list', locale) },
    ...(d?.audiences ?? []).map((a) => ({ value: a.id, label: a.name })),
  ]);

  /** «Añadir profesionales»: Conversaciones en modo selección, que vuelve aquí con lo elegido. */
  async function addPros() {
    await flush();
    await goto(`/h/conversations?etiqueta=sales&invitacion=${id}`);
  }

  const cancel = createMutation({
    mutationFn: () => mutateJSON('POST', `/api/mailout/${id}/cancel`, {}),
    onSuccess: refresh,
    onError: failed,
  });

  // ── Palabras ──────────────────────────────────────────────────────────
  const languageOptions = MAILOUT_LANGUAGES.map((l) => ({ value: l, label: t(`mailout.lang_${l}`, locale) }));
  let domainOptions = $derived((d?.domains ?? []).map((x) => ({ value: x.id, label: `@${x.domain}` })));
  let basisOptions = $derived(
    (
      [
        'relationship',
        'consent',
        ...(basisFor?.address_kind === 'organization' ? ['generic'] : []),
        'sector',
      ] as MailBasisKind[]
    ).map((k) => ({ value: k, label: t(`mailout.basis_${k}`, locale) })),
  );

  function stateLabel(x: { row: MailoutRecipientRow; state: RecipientState }): string {
    if (x.state === 'suppressed' && x.row.suppressed_reason) {
      return t(`mailout.suppressed_${x.row.suppressed_reason}`, locale, {
        when: x.row.suppressed_at ? dayMonthYear(x.row.suppressed_at) : '',
      });
    }
    return t(`mailout.r_${x.state}`, locale);
  }

  function stateTone(s: RecipientState): string {
    if (s === 'ready' || s === 'sent' || s === 'delivered') return 'ok';
    if (s === 'queued') return 'wait';
    if (s === 'bounced' || s === 'complained' || s === 'failed' || s === 'missing_fields') return 'bad';
    return 'off';
  }

  function who(x: { row: MailoutRecipientRow; ctx: ComposeContext | null }): string {
    return x.ctx?.organization_name ?? x.row.display_name ?? x.row.address ?? '—';
  }

  function insertField(f: string) {
    body = `${body}${body && !/\s$/.test(body) ? ' ' : ''}{${f}}`;
    touch();
  }

  const STATUS_COUNTS = ['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'] as const satisfies readonly RecipientState[];
  const WARN_COUNTS: readonly RecipientState[] = ['bounced', 'complained', 'failed'];
  let excludedCount = $derived(rows.filter((x) => OUT_STATES.includes(x.state)).length);
</script>

<svelte:head>
  <title>{docTitle(m?.subject || t('mailout.title', locale))}</title>
</svelte:head>

{#if $query.isLoading || !d || !m}
  <section class="mo">
    <p class="eyebrow">{t('mailout.title', locale)}</p>
    <RecordState
      loading={$query.isLoading}
      error={$query.error ?? new ApiError(404, 'Not found')}
      missingText={t('mailout.not_found', locale)}
      failedText={t('mailout.load_error', locale)}
      onretry={() => void $query.refetch()}
      back={lensOn('conversations') ? { href: '/h/conversations?view=envios', label: t('envios.back', locale) } : null}
      {locale}
    />
  </section>
{:else}
  <section class="mo" data-testid="mailout">
    <header class="mo__mast">
      <p class="eyebrow">
        {t(invitation ? 'mailout.invitation_title' : 'mailout.title', locale)}{#if d.project?.name}&nbsp;· {d.project.name}{/if}{#if d.performance}&nbsp;·
          {[dayMonthYear(d.performance.performed_at), d.performance.venue_name, d.performance.city].filter(Boolean).join(', ')}{/if}
      </p>
      <h1 class="mo__title"><em>{m.subject || t('mailout.untitled', locale)}</em></h1>
      <p class="mo__sub">
        <span class="mo__status" data-status={m.status} data-testid="mailout-status">{t(`mailout.s_${m.status}`, locale)}</span>
        <span>{t(rows.length === 1 ? 'mailout.recipients_one' : 'mailout.recipients_other', locale, { n: rows.length })}</span>
        {#if m.queued_at}<span>{dayMonthYear(m.queued_at)}</span>{/if}
      </p>
    </header>

    {#if d.simulated}
      <MailoutTestMode title={t('mailout.simulated_title', locale)} body={t('mailout.simulated_send_body', locale)} />
    {/if}

    {#if m.status !== 'draft'}
      <div class="mo__counts" data-testid="mailout-counts">
        <MailoutFigures
          {locale}
          testid="mailout-figures"
          figures={[
            ...STATUS_COUNTS.map((s) => ({ key: s, n: counts[s] ?? 0, warn: WARN_COUNTS.includes(s) })),
            { key: 'excluded' as const, n: excludedCount },
          ]}
        />
        {#if d.can_edit && ['queued', 'sending', 'paused', 'review'].includes(m.status)}
          <div class="mo__count-act">
            <Button size="s" variant="secondary" tone="warn" loading={$cancel.isPending} onclick={() => $cancel.mutate()}>
              {t('mailout.cancel_rest', locale)}
            </Button>
          </div>
        {/if}
      </div>
    {/if}

    {#if editable}
      <!-- On a phone the three parts are tabs (ADR-180); wider, they sit side by side. -->
      <div class="viewtabs mo__tabs" role="tablist" aria-label={t('mailout.tabs_label', locale)}>
        {#each PANES as p (p)}
          <button
            type="button"
            role="tab"
            class="viewtabs__tab"
            aria-selected={pane === p}
            aria-current={pane === p ? 'true' : undefined}
            onclick={() => (pane = p)}>{t(`mailout.tab_${p}`, locale)}</button
          >
        {/each}
      </div>
    {/if}
    <div class="mo__grid" class:mo__grid--read={!editable} data-pane={editable ? pane : undefined}>
      <div class="mo__write" data-part="write">
        {#if editable}
          <div class="mo__form">
            {#if d.domains.length === 0 && invitation}
              <!-- Sin dominio de la difusión una invitación aún puede ir al público: solo el nombre. -->
              {#if proRows.length > 0}
                <p class="mo__warn">
                  {t('mailout.no_domain', locale)}
                  <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=mail`}>{t('mailout.to_settings', locale)}</a>
                </p>
              {/if}
              <div class="mo__row">
                <Input label={t('mailout.from_name', locale)} bind:value={fromName} oninput={touch} placeholder={d.workspace.name} />
              </div>
            {:else if d.domains.length === 0}
              <p class="mo__warn">
                {t('mailout.no_domain', locale)}
                <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=mail`}>{t('mailout.to_settings', locale)}</a>
              </p>
            {:else}
              <!-- One domain: it is the address's suffix, in the same row. -->
              {#snippet atDomain()}@{domain?.domain ?? ''}{/snippet}
              <div class="mo__row">
                <Input label={t('mailout.from_name', locale)} bind:value={fromName} oninput={touch} placeholder={d.workspace.name} />
                <Input
                  label={t('mailout.from_address', locale)}
                  bind:value={localPart}
                  oninput={touch}
                  suffix={domainOptions.length > 1 ? undefined : atDomain}
                />
                {#if domainOptions.length > 1}
                  <Select label={t('mailout.domain_label', locale)} options={domainOptions} bind:value={domainId} onchange={touch} />
                {/if}
              </div>
            {/if}
            <p class="mo__reply">
              <span>{t('mailout.reply_to', locale)}</span>
              {#if d.reply_to}
                {d.reply_to.address}
              {:else}
                <span class="mo__warn-inline"
                  >{domain
                    ? t('mailout.reply_to_none', locale, { address: senderAddress(localPart, domain.domain) })
                    : t('mailout.reply_to_none_nodomain', locale)}</span
                >
                <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=mail`}>{t('mailout.to_settings', locale)}</a>
              {/if}
            </p>
            <div class="mo__row">
              <Select label={t('mailout.language', locale)} options={languageOptions} bind:value={language} onchange={touch} />
            </div>
            {#if invitation && m.audience_id}
              <p class="mo__hint">{t('mailout.language_audience_hint', locale)}</p>
            {/if}
            <Input label={t('mail.subject', locale)} bind:value={subject} oninput={touch} />
            {#if invitation}
              <!-- Letter or designed (ADR-192): only an invitation chooses. -->
              <div class="mo__format" data-testid="mailout-format">
                <Segmented
                  ariaLabel={t('mailout.format', locale)}
                  options={[
                    { value: 'letter', label: t('mailout.format_letter', locale) },
                    { value: 'design', label: t('mailout.format_design', locale) },
                  ]}
                  value={designContent ? 'design' : 'letter'}
                  onchange={(v) => {
                    if (v === 'design' && !designContent) editorOpen = true;
                    else if (v === 'letter' && designContent) askLetter = true;
                  }}
                />
              </div>
            {/if}
            {#if invitation && designContent}
              <div class="mo__design" data-testid="mailout-design">
                <h3 class="eyebrow eyebrow--sub">{t('mailout.design_title', locale)}</h3>
                <p class="mo__hint">{t('mailout.design_summary', locale, { n: designBlocks })}</p>
                <div class="mo__image-acts">
                  <Button size="s" variant="secondary" onclick={() => (editorOpen = true)}>{t('mailout.design_edit', locale)}</Button>
                  <Button size="s" variant="quiet" onclick={() => (askLetter = true)}>{t('mailout.design_to_letter', locale)}</Button>
                </div>
                <p class="mo__saved" aria-live="polite">
                  {$save.isPending ? t('mailout.saving', locale) : dirty ? '' : t('mailout.saved_draft', locale)}
                </p>
              </div>
            {:else}
            <Textarea id="mailout-body" label={t('mail.body', locale)} rows={10} maxlength={20000} bind:value={body} oninput={touch} />
            <p class="mo__fields">
              <span>{t('mailout.fields', locale)}</span>
              {#each mergeFieldsFor(invitation ? 'invitation' : 'outreach') as f (f)}
                <button type="button" class="mo__chip" title={`{${f}}`} onclick={() => insertField(f)}>{f.replace('_', ' ')}</button>
              {/each}
              <span class="mo__saved" aria-live="polite">
                {$save.isPending ? t('mailout.saving', locale) : dirty ? '' : t('mailout.saved_draft', locale)}
              </span>
            </p>
            <p class="mo__hint">{t('mailout.footer_hint', locale)}</p>

            <div class="mo__image" data-testid="mailout-image">
              <h3 class="eyebrow eyebrow--sub">{t('mailout.image_title', locale)}</h3>
              <p class="mo__hint">{t('mailout.image_hint', locale)}</p>
              <input
                bind:this={imageInput}
                class="mo__file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onchange={imagePicked}
              />
              {#if imageUrl}
                <img class="mo__thumb" src={imageUrl} alt={imageAlt} />
                <Input label={t('mailout.image_alt', locale)} bind:value={imageAlt} oninput={touchImage} placeholder={t('mailout.image_alt_ph', locale)} />
                <Input label={t('mailout.image_link', locale)} bind:value={imageLink} oninput={touchImage} placeholder="https://" />
                {#if linkChoices.length}
                  <p class="mo__fields">
                    <span>{t('mailout.image_link_from', locale)}</span>
                    {#each linkChoices as x (x.id)}
                      <button
                        type="button"
                        class="mo__chip mo__chip--text"
                        aria-pressed={imageLink === x.url}
                        onclick={() => {
                          imageLink = x.url;
                          touchImage();
                        }}>{kindLabel(x.kind, locale)}</button
                      >
                    {/each}
                  </p>
                {/if}
              {/if}
              <div class="mo__image-acts">
                <Button size="s" variant="secondary" loading={$uploadImage.isPending} onclick={() => imageInput?.click()}>
                  {t(imageUrl ? 'mailout.image_replace' : 'mailout.image_add', locale)}
                </Button>
                {#if imageUrl}
                  <Button size="s" variant="quiet" tone="warn" disabled={$uploadImage.isPending} onclick={removeImage}>
                    {t('mailout.image_remove', locale)}
                  </Button>
                {/if}
              </div>
              <p class="mo__hint">
                {t(d.workspace.logo_url ? 'mailout.logo_set' : 'mailout.logo_missing', locale)}
                <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=space#logo`}>{t('mailout.logo_change', locale)}</a>
              </p>
            </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Así le llega (ADR-180): beside what is written, fixed while the text scrolls. -->
      <div class="mo__preview" data-part="preview">
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub">{t('mailout.preview', locale)}</h2>
          {#if previewable.length > 1}
            <div class="mo__pager">
              <Button size="xs" variant="secondary" disabled={previewIndex <= 0} onclick={() => (previewIndex = Math.max(0, previewIndex - 1))}>
                {t('mailout.prev', locale)}
              </Button>
              <span>{Math.min(previewIndex + 1, previewable.length)} / {previewable.length}</span>
              <Button
                size="xs"
                variant="secondary"
                disabled={previewIndex >= previewable.length - 1}
                onclick={() => (previewIndex = Math.min(previewable.length - 1, previewIndex + 1))}
              >
                {t('mailout.next', locale)}
              </Button>
            </div>
          {/if}
        </div>
        {#if preview && current}
          <article class="mail-card" data-testid="mailout-preview">
            <p class="mail-card__meta"><span>{t('mail.from', locale)}</span> {currentFrom}</p>
            <p class="mail-card__meta">
              <span>{t('mail.to', locale)}</span>
              {current.row.display_name ?? ''} &lt;{current.row.address}&gt;
            </p>
            {#if currentLanguage && currentLanguage !== language}
              <p class="mail-card__meta" data-testid="mailout-preview-language">
                <span>{t('mailout.language', locale)}</span> {t(`mailout.lang_${currentLanguage}`, locale)}
              </p>
            {/if}
            <p class="mail-preview__subject">{preview.subject || '—'}</p>
            {#if preview.missing.length}
              <p class="mo__warn" role="alert">
                {t('mailout.missing', locale, { fields: preview.missing.map((f) => `{${f}}`).join(', ') })}
              </p>
            {/if}
            <div class="mo__view">
              <Segmented
                ariaLabel={t('mailout.preview', locale)}
                options={[
                  { value: 'html', label: t(designed ? 'mailout.preview_design' : 'mailout.preview_html', locale) },
                  { value: 'text', label: t('mailout.preview_text', locale) },
                ]}
                value={previewMode}
                onchange={(v) => (previewChoice = v as 'html' | 'text')}
              />
              {#if previewMode === 'html'}
                <Segmented
                  ariaLabel={t('mailout.preview_device', locale)}
                  options={[
                    { value: 'desktop', label: t('mailout.preview_desktop', locale) },
                    { value: 'mobile', label: t('mailout.preview_mobile', locale) },
                  ]}
                  value={previewDevice}
                  onchange={(v) => (previewDevice = v as 'desktop' | 'mobile')}
                />
                <Segmented
                  ariaLabel={t('mailout.preview_scheme', locale)}
                  options={[
                    { value: 'light', label: t('mailout.preview_light', locale) },
                    { value: 'dark', label: t('mailout.preview_dark', locale) },
                  ]}
                  value={previewScheme}
                  onchange={(v) => (previewScheme = v as 'light' | 'dark')}
                />
              {/if}
            </div>
            {#if previewMode === 'html'}
              <!-- The email itself, as a recipient's client paints it. No scripts
                   (sandbox without allow-scripts); same origin only so the frame
                   can be measured and the app's images load under its CSP. -->
              <iframe
                class="mail-frame"
                title={t('mailout.preview', locale)}
                sandbox="allow-same-origin"
                srcdoc={previewScheme === 'dark' ? darkPreview(preview.html) : preview.html}
                data-device={previewDevice}
                onload={fitFrame}
                style:block-size={frameHeight ? `${frameHeight}px` : undefined}
              ></iframe>
            {:else}
              <pre class="mail-preview__text">{preview.text}</pre>
            {/if}
          </article>
        {:else}
          <p class="mo__msg">{t('mailout.preview_empty', locale)}</p>
        {/if}
      </div>

      <div class="mo__who" data-part="who" id="mo-who">
        {#snippet recipientList(list: typeof rows, testid: string)}
          <ul class="rcp" data-testid={testid}>
            {#each list as x (x.row.recipient_id)}
              <li class="rcp__item">
                <div class="rcp__who">
                  {#if x.row.conversation_id}
                    <a class="rcp__name" href={`/h/${workspaceSlug}/conversation/${x.row.conversation_id}`}>{who(x)}</a>
                  {:else}
                    <span class="rcp__name">{who(x)}</span>
                  {/if}
                  {#if x.row.address && who(x) !== x.row.address}<span class="rcp__addr">{x.row.address}</span>{/if}
                </div>
                <span class="rcp__state" data-tone={stateTone(x.state)} data-state={x.state}>{stateLabel(x)}</span>
                {#if editable && x.row.conversation_id}
                  <div class="rcp__acts">
                    {#if x.state === 'no_basis'}
                      <button
                        type="button"
                        class="rcp__act"
                        aria-label={t('mailout.set_basis_named', locale, { name: who(x) })}
                        onclick={() => openBasis(x.row)}>{t('mailout.set_basis', locale)}</button
                      >
                    {/if}
                    <button
                      type="button"
                      class="rcp__act"
                      aria-label={t('mailout.remove_named', locale, { name: who(x) })}
                      disabled={$setRecipients.isPending}
                      onclick={() => removeOne(x.row, who(x))}>{t('mailout.remove_one', locale)}</button
                    >
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/snippet}

        {#if invitation}
          <!-- Dos orígenes (ADR-173 § 10): cada uno con su remitente. -->
          <section class="mo__origin" data-testid="invitation-audience" aria-labelledby="inv-aud">
            <div class="block-head">
              <h2 class="eyebrow eyebrow--sub" id="inv-aud">{t('mailout.invitation_audience', locale)}</h2>
            </div>
            {#if editable && d.can_edit_audience}
              <Select
                label={t('mailout.invitation_list', locale)}
                options={audienceOptions}
                value={m.audience_id ?? ''}
                disabled={$setAudience.isPending}
                onchange={(e) => $setAudience.mutate((e.currentTarget as HTMLSelectElement).value || null)}
              />
            {/if}
            {#if d.audience}
              {#if !editable}<p class="mo__line">{d.audience.name}</p>{/if}
              {#if editable}
                <p class="mo__line" data-testid="invitation-audience-count">
                  {t(d.audience.eligible === 1 ? 'mailout.invitation_people_one' : 'mailout.invitation_people_other', locale, {
                    n: d.audience.eligible,
                  })}
                </p>
                {#if d.audience.truncated}
                  <p class="mo__hint">{t('mailout.invitation_truncated', locale)}</p>
                {/if}
                {#if d.audience.as_pros > 0}
                  <p class="mo__hint">{t('mailout.invitation_dupes', locale, { n: d.audience.as_pros })}</p>
                {/if}
              {/if}
              {#if audienceDomain}
                <p class="mo__reply"><span>{t('mail.from', locale)}</span> {audienceFromLine}</p>
                {#if !audienceDomain.verified_at}
                  <p class="mo__warn-inline">
                    {t('mailout.audience_domain_pending', locale)}
                    <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=mail`}>{t('mailout.to_settings', locale)}</a>
                  </p>
                {/if}
              {/if}
            {:else if m.audience_id === null}
              <p class="mo__hint">{t('mailout.invitation_no_list_hint', locale)}</p>
            {/if}
            {#if audienceRows.length > 0}
              {@render recipientList(audienceRows, 'invitation-audience-recipients')}
            {/if}
          </section>

          <section class="mo__origin" data-testid="invitation-pros" aria-labelledby="inv-pros">
            <div class="block-head">
              <h2 class="eyebrow eyebrow--sub" id="inv-pros">{t('mailout.invitation_pros', locale)} · {proRows.length}</h2>
              {#if editable}
                <Button size="xs" variant="secondary" onclick={addPros}>{t('mailout.invitation_add_pros', locale)}</Button>
              {/if}
            </div>
            {#if proRows.length > 0 && domain}
              <p class="mo__reply"><span>{t('mail.from', locale)}</span> {fromLine}</p>
            {/if}
            {@render recipientList(proRows, 'mailout-recipients')}
          </section>
        {:else}
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub">{t('mailout.recipients', locale)} · {rows.length}</h2>
          </div>
          {@render recipientList(rows, 'mailout-recipients')}
        {/if}
      </div>
    </div>

    {#if editable}
      <div class="action-bar">
        <div class="action-bar__note">
          <p class="mo__ready">
            {#if missingCount}
              {t(missingCount === 1 ? 'mailout.missing_one' : 'mailout.missing_n', locale, { n: missingCount })}
            {:else}
              {t(readyCount === 1 ? 'mailout.ready_one' : 'mailout.ready_other', locale, { n: readyCount })}
            {/if}
          </p>
          <!-- What stands between this and sending, in one place (ADR-180), each with its way. -->
          {#if blockers.length > 0}
            <ul class="mo__blockers" data-testid="mailout-blockers">
              <li class="mo__blockers-lead">{t('mailout.blocked', locale)}</li>
              {#each blockers as b (b.key)}
                <li>
                  {#if b.href}<a href={b.href}>{b.text}</a>{:else if b.onclick}<button type="button" onclick={b.onclick}>{b.text}</button
                    >{:else}{b.text}{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <Button
          size="s"
          variant="secondary"
          disabled={!(current?.row.audience_subscription_id ? audienceDomain?.verified_at : domain) || !subject.trim() || !body.trim() || !current}
          loading={$sendTest.isPending}
          onclick={() => $sendTest.mutate()}
        >
          {t('mailout.send_test', locale)}
        </Button>
        <Button
          size="s"
          disabled={!(domain || (invitation && proRows.length === 0)) || !subject.trim() || !body.trim() || readyCount === 0 || missingCount > 0}
          onclick={() => (confirmOpen = true)}
        >
          {t('mailout.send_to', locale, { n: readyCount })}
        </Button>
      </div>
    {/if}
  </section>

  <Dialog bind:open={confirmOpen} title={t('mailout.confirm_title', locale)} size="s">
    <p>
      {t('mailout.confirm_body', locale, {
        n: readyCount,
        subject,
        from: invitation ? [proRows.length ? fromLine : '', d.audience ? audienceFromLine : ''].filter(Boolean).join(' · ') : fromLine,
      })}
    </p>
    {#if d.simulated}<p class="mo__hint">{t('mailout.confirm_simulated', locale)}</p>{/if}
    {#snippet actions()}
      <Button variant="quiet" onclick={() => (confirmOpen = false)}>{t('create.cancel', locale)}</Button>
      <Button loading={$send.isPending} onclick={() => $send.mutate()}>{t('mailout.send_to', locale, { n: readyCount })}</Button>
    {/snippet}
  </Dialog>

  <Dialog bind:open={basisOpen} title={t('mailout.set_basis', locale)} size="s" onclose={() => (basisFor = null)}>
    {#if basisFor}<p class="mo__hint">{basisFor.address}</p>{/if}
    <Select label={t('mailout.basis', locale)} options={basisOptions} bind:value={basisKind} />
    <Textarea id="basis-note" label={t('mailout.basis_note', locale)} rows={2} maxlength={1000} bind:value={basisNote} placeholder={t('mailout.basis_note_ph', locale)} />
    {#snippet actions()}
      <Button variant="quiet" onclick={() => (basisOpen = false)}>{t('create.cancel', locale)}</Button>
      <Button
        loading={$saveBasis.isPending}
        disabled={basisKind === 'consent' && !basisNote.trim()}
        onclick={() => $saveBasis.mutate()}
      >
        {t('mailout.save', locale)}
      </Button>
    {/snippet}
  </Dialog>

  <Dialog bind:open={askLetter} title={t('mailout.design_to_letter_title', locale)} size="s">
    <p>{t('mailout.design_to_letter_body', locale)}</p>
    {#snippet actions()}
      <Button variant="quiet" onclick={() => (askLetter = false)}>{t('create.cancel', locale)}</Button>
      <Button tone="warn" onclick={toLetter}>{t('mailout.design_to_letter', locale)}</Button>
    {/snippet}
  </Dialog>

  {#if editorOpen && editable}
    <MailDesignEditor
      content={designContent}
      starter={designStarter}
      mailoutId={id}
      {locale}
      fields={mergeFieldsFor('invitation')}
      ondone={designDone}
      oncancel={() => (editorOpen = false)}
    />
  {/if}
{/if}

<style>
  @layer components {
    .mo {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .mo__mast {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .mo__mast p,
    .mo__title {
      margin: 0;
    }
    .mo__title em {
      font-style: italic;
    }
    .mo__sub {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .mo__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    .mo__status {
      color: var(--heading-color);
      font-weight: 500;
    }
    .mo__msg {
      padding-block: var(--space-m);
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    .mo__counts {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
      gap: var(--space-s);
    }
    .mo__count-act {
      display: flex;
      align-items: center;
      margin-inline-start: auto;
    }

    /* Escribir y a quién a la izquierda; «Así le llega» a la derecha, fija
       mientras baja el texto (ADR-180). Estrecho, una columna; en el móvil,
       una pestaña cada vez. */
    .mo {
      container: mo / inline-size;
    }
    .mo__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'write' 'preview' 'who';
      gap: var(--space-l);
      align-items: start;
    }
    @container mo (min-width: 56rem) {
      .mo__grid {
        grid-template-columns: minmax(0, 1fr) minmax(0, var(--mail-preview-col));
        grid-template-areas:
          'write preview'
          'who preview';
        column-gap: var(--space-xl);
      }
      /* Sent or not ours to edit: no form, the recipients start at the top. */
      .mo__grid--read {
        grid-template-areas: 'who preview';
      }
      .mo__grid--read > .mo__write {
        display: none;
      }
      .mo__preview {
        position: sticky;
        inset-block-start: calc(var(--header-height) + var(--space-s));
        max-block-size: calc(100dvh - var(--header-height) - var(--space-l));
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .mo__tabs {
        display: none;
      }
    }
    @container mo (max-width: 55.999rem) {
      .mo__grid[data-pane] > [data-part] {
        display: none;
      }
      .mo__grid[data-pane='write'] > [data-part='write'],
      .mo__grid[data-pane='preview'] > [data-part='preview'],
      .mo__grid[data-pane='who'] > [data-part='who'] {
        display: flex;
      }
    }
    .mo__write,
    .mo__preview,
    .mo__who {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      min-inline-size: 0;
    }
    .mo__write {
      grid-area: write;
    }
    .mo__preview {
      grid-area: preview;
    }
    .mo__who {
      grid-area: who;
    }

    .mo__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-m);
    }
    /* Field rows, one under the other (ADR-139 p4). */
    .mo__row {
      display: flex;
      flex-direction: column;
    }
    .mo__form :global(textarea) {
      line-height: 1.5;
    }
    .mo__reply {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
      overflow-wrap: anywhere;
    }
    .mo__reply > span:first-child,
    .mo__fields > span:first-child {
      margin-inline-end: var(--space-xs);
      color: var(--text-faint);
    }
    .mo__fields {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs);
      margin: 0;
      font-size: var(--text-xs);
    }
    .mo__chip {
      padding: 0 var(--space-xs);
      color: var(--text-dark-muted);
      background: var(--tag-neutral-bg);
      border: 0;
      border-radius: var(--radius-s);
      font-size: var(--text-s);
      cursor: pointer;
    }
    .mo__chip:hover {
      color: var(--text-color);
    }
    .mo__saved {
      margin-inline-start: auto;
      color: var(--text-faint);
    }
    .mo__chip--text {
      font-family: inherit;
    }
    .mo__chip--text[aria-pressed='true'] {
      color: var(--text-color);
      box-shadow: 0 0 0 var(--line-hairline) var(--border-color-dark);
    }

    /* La imagen del espectáculo (ADR-172). */
    .mo__design {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .mo__design h3 {
      margin: 0;
    }
    .mo__image {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-start: var(--space-s);
      border-block-start: var(--divider);
    }
    .mo__image h3 {
      margin: 0;
    }
    .mo__file {
      display: none;
    }
    .mo__thumb {
      display: block;
      max-inline-size: 100%;
      max-block-size: 12rem;
      inline-size: auto;
      border-radius: var(--radius-s);
    }
    .mo__image-acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
    }

    .mo__view {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-s);
      margin-block-start: var(--space-s);
    }
    .mail-frame[data-device='mobile'] {
      max-inline-size: var(--mail-preview-mobile);
    }
    /* The send bar's note: how many are ready, and what still stands in the way. */
    .mo__ready {
      margin: 0;
    }
    .mo__blockers {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-s);
      margin: var(--space-2xs) 0 0;
      padding: 0;
      list-style: none;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .mo__blockers-lead {
      color: var(--warning-dark);
    }
    .mo__blockers a,
    .mo__blockers button {
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-color);
      font: inherit;
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
      cursor: pointer;
    }
    /* El correo tal cual: su propio fondo, a todo el ancho de la tarjeta. */
    .mail-frame {
      display: block;
      inline-size: 100%;
      margin-inline: auto;
      min-block-size: 16rem;
      margin-block-start: var(--space-s);
      border: var(--border);
      border-radius: var(--radius-s);
    }
    .mo__hint {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .mo__warn,
    .mo__warn-inline {
      color: var(--danger-dark);
      font-size: var(--text-s);
    }
    .mo__warn {
      margin: 0;
    }
    /* Los dos orígenes de una invitación, uno bajo el otro. */
    .mo__origin {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .mo__origin + .mo__origin {
      padding-block-start: var(--space-m);
      border-block-start: var(--border);
    }
    .mo__line {
      margin: 0;
      font-size: var(--text-s);
    }

    .mo__pager {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }

    .mail-preview__subject {
      margin: var(--space-xs) 0 0;
      color: var(--heading-color);
      font-weight: 500;
    }
    .mail-preview__text {
      margin: var(--space-s) 0 0;
      padding: 0;
      background: none;
      border: 0;
      font-family: inherit;
      font-size: var(--text-s);
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .rcp {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rcp__item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-xs);
      border-block-end: var(--divider);
      font-size: var(--text-s);
    }
    .rcp__who {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }
    .rcp__name {
      color: var(--heading-color);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rcp__name:hover {
      text-decoration: underline;
    }
    .rcp__addr {
      color: var(--text-faint);
      font-size: var(--text-xs);
      overflow-wrap: anywhere;
    }
    .rcp__state {
      align-self: start;
      color: var(--text-muted);
      font-size: var(--text-xs);
      text-align: end;
    }
    .rcp__state[data-tone='ok'] {
      color: var(--success-dark, var(--text-color));
    }
    .rcp__state[data-tone='bad'] {
      color: var(--danger-dark);
    }
    .rcp__state[data-tone='off'] {
      color: var(--text-faint);
    }
    .rcp__acts {
      grid-column: 1 / -1;
      display: flex;
      gap: var(--space-s);
    }
    .rcp__act {
      padding: 0;
      color: var(--text-faint);
      background: none;
      border: 0;
      font: inherit;
      font-size: var(--text-xs);
      text-decoration: underline;
      text-underline-offset: 0.2em;
      cursor: pointer;
    }
    .rcp__act:hover {
      color: var(--text-color);
    }
    @media (pointer: coarse) {
      .rcp__act {
        min-block-size: var(--touch-target);
        padding-inline: var(--space-xs);
      }
    }

  }
</style>
