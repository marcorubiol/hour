<script lang="ts">
  /**
   * La pantalla de un envío de difusión (plan § 10, ADR-115).
   *
   * Borrador: De (el dominio verificado de la compañía), a dónde van las
   * respuestas, idioma, asunto y cuerpo con los campos `{nombre}`, `{sala}`,
   * `{ciudad}`; la vista previa destinatario a destinatario con la firma y el
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
   */
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { untrack } from 'svelte';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonthYear } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import MailoutTestMode from '$lib/components/MailoutTestMode.svelte';
  import MailoutFigures from '$lib/components/MailoutFigures.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    recipientCounts,
    recipientState,
    senderAddress,
    type MailoutDetail,
    type MailoutRecipientRow,
    type RecipientState,
  } from '$lib/mailout';
  import {
    composeMailout,
    MAILOUT_LANGUAGES,
    MERGE_FIELDS,
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
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<MailoutDetail>(`/api/mailout/${id}`, signal),
      // Mientras sale, cada 30 s; volver a la pestaña recarga siempre.
      refetchInterval: (q: { state: { data?: MailoutDetail } }) =>
        ['queued', 'sending'].includes(q.state.data?.mailout.status ?? '') ? REFRESH_MS : false,
    })),
  );

  let d = $derived($query.data ?? null);
  let m = $derived(d?.mailout ?? null);
  let editable = $derived(Boolean(d?.can_edit && m?.status === 'draft'));

  // ── El borrador, en local; se guarda solo ─────────────────────────────
  let subject = $state('');
  let body = $state('');
  let language = $state<string>(locale);
  let domainId = $state('');
  let localPart = $state('difusion');
  let fromName = $state('');
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
    dirty = false;
  });

  function touch() {
    dirty = true;
  }

  const save = createMutation({
    mutationFn: () =>
      mutateJSON('PATCH', `/api/mailout/${id}`, {
        subject,
        body,
        language,
        mail_domain_id: domainId || null,
        from_local_part: localPart,
        from_name: fromName.trim() || null,
      }),
    onSuccess: () => {
      dirty = false;
    },
    onError: (err) => failed(err),
  });

  $effect(() => {
    // Leer los campos ata el efecto a ellos: cada cambio reinicia la espera.
    void [subject, body, language, domainId, localPart, fromName];
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
  let readyCount = $derived(rows.filter((x) => x.state === 'ready').length);
  let missingCount = $derived(rows.filter((x) => x.state === 'missing_fields').length);
  let counts = $derived(recipientCounts(rows.map((x) => x.state)));

  // Vista previa: los que tienen dirección, el que se mira; primero los que
  // salen (o salieron), después los que se quedan fuera.
  const OUT_STATES: RecipientState[] = ['no_address', 'suppressed', 'no_basis', 'duplicate', 'unavailable', 'cancelled'];
  let previewable = $derived(
    rows
      .filter((x) => x.ctx && x.row.address)
      .sort((a, b) => Number(OUT_STATES.includes(a.state)) - Number(OUT_STATES.includes(b.state))),
  );
  let previewIndex = $state(0);
  let current = $derived(previewable[Math.min(previewIndex, Math.max(previewable.length - 1, 0))] ?? null);
  let exampleLink = $derived(unsubscribeUrl(page.url.origin, '…'));
  let preview = $derived(current?.ctx ? composeMailout(draft, current.ctx, exampleLink) : null);

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
  }

  // Removing is immediate, so it says who and offers to undo (móvil #6): the
  // undo puts the same set back, the one this removal started from.
  const setRecipients = createMutation({
    mutationFn: (conversationIds: string[]) =>
      mutateJSON('PUT', `/api/mailout/${id}/recipients`, { conversation_ids: conversationIds }),
    onSuccess: refresh,
    onError: failed,
  });
  function removeOne(r: MailoutRecipientRow, name: string) {
    const before = (d?.recipients ?? []).map((x) => x.conversation_id);
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
    basisKind = r.address_kind === 'organization' ? 'generic' : 'relationship';
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
      return mutateJSON<{ to: string; simulated: boolean }>('POST', `/api/mailout/${id}/test`, {
        recipient_id: current?.row.recipient_id ?? null,
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

  const cancel = createMutation({
    mutationFn: () => mutateJSON('POST', `/api/mailout/${id}/cancel`, {}),
    onSuccess: refresh,
    onError: failed,
  });

  // ── Palabras ──────────────────────────────────────────────────────────
  const languageOptions = MAILOUT_LANGUAGES.map((l) => ({ value: l, label: t(`mailout.lang_${l}`, locale) }));
  let domainOptions = $derived((d?.domains ?? []).map((x) => ({ value: x.id, label: `@${x.domain}` })));
  let basisOptions = $derived(
    (['relationship', 'consent', ...(basisFor?.address_kind === 'organization' ? ['generic'] : [])] as MailBasisKind[]).map(
      (k) => ({ value: k, label: t(`mailout.basis_${k}`, locale) }),
    ),
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
    return x.ctx?.organization_name ?? x.row.display_name ?? '—';
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
  <title>{m?.subject || t('mailout.title', locale)} · Hour</title>
</svelte:head>

{#if $query.isLoading}
  <p class="mo__msg">{t('mailout.loading', locale)}</p>
{:else if !d || !m}
  <section class="mo">
    <p class="eyebrow">{t('mailout.title', locale)}</p>
    <p class="mo__msg">{t('mailout.not_found', locale)}</p>
    <p><a class="link-arrow" href="/h/conversations">{t('conversations.back', locale)}</a></p>
  </section>
{:else}
  <section class="mo" data-testid="mailout">
    <header class="mo__mast">
      <p class="eyebrow">
        {t('mailout.title', locale)}{#if d.project?.name}&nbsp;· {d.project.name}{/if}
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
            <Button size="s" variant="outline" tone="warn" loading={$cancel.isPending} onclick={() => $cancel.mutate()}>
              {t('mailout.cancel_rest', locale)}
            </Button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="mo__grid">
      <div class="mo__main">
        {#if editable}
          <div class="mo__form">
            {#if d.domains.length === 0}
              <p class="mo__warn">
                {t('mailout.no_domain', locale)}
                <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=mail`}>{t('mailout.to_settings', locale)}</a>
              </p>
            {:else}
              <div class="mo__row mo__row--from">
                <Input label={t('mailout.from_name', locale)} bind:value={fromName} oninput={touch} placeholder={d.workspace.name} />
                <Input label={t('mailout.from_address', locale)} bind:value={localPart} oninput={touch} />
                {#if domainOptions.length > 1}
                  <Select label={t('mailout.domain_label', locale)} options={domainOptions} bind:value={domainId} onchange={touch} />
                {:else}
                  <p class="mo__at">@{domain?.domain ?? ''}</p>
                {/if}
              </div>
            {/if}
            <p class="mo__reply">
              <span>{t('mailout.reply_to', locale)}</span>
              {#if d.reply_to}
                {d.reply_to.address}
              {:else}
                <span class="mo__warn-inline">{t('mailout.reply_to_none', locale, { address: domain ? senderAddress(localPart, domain.domain) : '' })}</span>
              {/if}
            </p>
            <div class="mo__row">
              <Select label={t('mailout.language', locale)} options={languageOptions} bind:value={language} onchange={touch} />
            </div>
            <Input label={t('mail.subject', locale)} bind:value={subject} oninput={touch} />
            <div class="field">
              <label for="mailout-body">{t('mail.body', locale)}</label>
              <textarea id="mailout-body" rows="10" maxlength="20000" bind:value={body} oninput={touch}></textarea>
            </div>
            <p class="mo__fields">
              <span>{t('mailout.fields', locale)}</span>
              {#each MERGE_FIELDS as f (f)}
                <button type="button" class="mo__chip" onclick={() => insertField(f)}>{`{${f}}`}</button>
              {/each}
              <span class="mo__saved" aria-live="polite">
                {$save.isPending ? t('mailout.saving', locale) : dirty ? '' : t('mailout.saved_draft', locale)}
              </span>
            </p>
            <p class="mo__hint">{t('mailout.footer_hint', locale)}</p>
          </div>
        {/if}

        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub">{t('mailout.preview', locale)}</h2>
          {#if previewable.length > 1}
            <div class="mo__pager">
              <Button size="xs" variant="outline" disabled={previewIndex <= 0} onclick={() => (previewIndex = Math.max(0, previewIndex - 1))}>
                {t('mailout.prev', locale)}
              </Button>
              <span>{Math.min(previewIndex + 1, previewable.length)} / {previewable.length}</span>
              <Button
                size="xs"
                variant="outline"
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
            <p class="mail-card__meta"><span>{t('mail.from', locale)}</span> {fromLine}</p>
            <p class="mail-card__meta">
              <span>{t('mail.to', locale)}</span>
              {current.row.display_name ?? ''} &lt;{current.row.address}&gt;
            </p>
            <p class="mail-preview__subject">{preview.subject || '—'}</p>
            {#if preview.missing.length}
              <p class="mo__warn" role="alert">
                {t('mailout.missing', locale, { fields: preview.missing.map((f) => `{${f}}`).join(', ') })}
              </p>
            {/if}
            <pre class="mail-preview__text">{preview.text}</pre>
          </article>
        {:else}
          <p class="mo__msg">{t('mailout.preview_empty', locale)}</p>
        {/if}
      </div>

      <aside class="mo__aside">
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub">{t('mailout.recipients', locale)} · {rows.length}</h2>
        </div>
        <ul class="rcp" data-testid="mailout-recipients">
          {#each rows as x (x.row.recipient_id)}
            <li class="rcp__item">
              <div class="rcp__who">
                <a class="rcp__name" href={`/h/${workspaceSlug}/conversation/${x.row.conversation_id}`}>{who(x)}</a>
                {#if x.row.address}<span class="rcp__addr">{x.row.address}</span>{/if}
              </div>
              <span class="rcp__state" data-tone={stateTone(x.state)} data-state={x.state}>{stateLabel(x)}</span>
              {#if editable}
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
      </aside>
    </div>

    {#if editable}
      <div class="action-bar">
        <p class="action-bar__note">
          {#if missingCount}
            {t(missingCount === 1 ? 'mailout.missing_one' : 'mailout.missing_n', locale, { n: missingCount })}
          {:else}
            {t(readyCount === 1 ? 'mailout.ready_one' : 'mailout.ready_other', locale, { n: readyCount })}
          {/if}
        </p>
        <Button
          size="s"
          variant="outline"
          disabled={!domain || !subject.trim() || !body.trim() || !current}
          loading={$sendTest.isPending}
          onclick={() => $sendTest.mutate()}
        >
          {t('mailout.send_test', locale)}
        </Button>
        <Button
          size="s"
          disabled={!domain || !subject.trim() || !body.trim() || readyCount === 0 || missingCount > 0}
          onclick={() => (confirmOpen = true)}
        >
          {t('mailout.send_to', locale, { n: readyCount })}
        </Button>
      </div>
    {/if}
  </section>

  <Dialog bind:open={confirmOpen} title={t('mailout.confirm_title', locale)} size="s">
    <p>{t('mailout.confirm_body', locale, { n: readyCount, subject, from: fromLine })}</p>
    {#if d.simulated}<p class="mo__hint">{t('mailout.confirm_simulated', locale)}</p>{/if}
    {#snippet actions()}
      <Button variant="outline" onclick={() => (confirmOpen = false)}>{t('create.cancel', locale)}</Button>
      <Button loading={$send.isPending} onclick={() => $send.mutate()}>{t('mailout.send_to', locale, { n: readyCount })}</Button>
    {/snippet}
  </Dialog>

  <Dialog bind:open={basisOpen} title={t('mailout.set_basis', locale)} size="s" onclose={() => (basisFor = null)}>
    {#if basisFor}<p class="mo__hint">{basisFor.address}</p>{/if}
    <Select label={t('mailout.basis', locale)} options={basisOptions} bind:value={basisKind} />
    <div class="field">
      <label for="basis-note">{t('mailout.basis_note', locale)}</label>
      <textarea id="basis-note" rows="2" maxlength="1000" bind:value={basisNote} placeholder={t('mailout.basis_note_ph', locale)}></textarea>
    </div>
    {#snippet actions()}
      <Button variant="outline" onclick={() => (basisOpen = false)}>{t('create.cancel', locale)}</Button>
      <Button
        loading={$saveBasis.isPending}
        disabled={basisKind === 'consent' && !basisNote.trim()}
        onclick={() => $saveBasis.mutate()}
      >
        {t('mailout.save', locale)}
      </Button>
    {/snippet}
  </Dialog>
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

    .mo__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
      gap: var(--space-xl);
      align-items: start;
    }
    @media (max-width: 63.999rem) {
      .mo__grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-l);
      }
    }
    .mo__main,
    .mo__aside {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      min-inline-size: 0;
    }

    .mo__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-m);
    }
    .mo__row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
    }
    .mo__row--from {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: end;
    }
    .mo__at {
      margin: 0;
      padding-block-end: var(--space-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }
    @media (max-width: 46rem) {
      .mo__row--from {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .mo__form textarea {
      inline-size: 100%;
      resize: vertical;
      font: inherit;
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
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .mo__chip:hover {
      color: var(--text-color);
    }
    .mo__saved {
      margin-inline-start: auto;
      color: var(--text-faint);
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
