<script lang="ts">
  /**
   * La página de una lista del público (ADR-173; plan del público § 6.1).
   *
   * Cabecera: nombre, estado y «Escribir una invitación» (una invitación en
   * borrador con esta lista). Tres bloques:
   *   · Formulario: idiomas, descripción, el texto de consentimiento y la
   *     primera capa de información por idioma (con los de Hour propuestos;
   *     guardar crea una versión nueva, las viejas no cambian), «Copiar
   *     enlace», «Copiar código para tu web», abrir y cerrar. Sin la política
   *     de privacidad del espacio no se abre, y lo dice con su enlace.
   *   · Importar (plan § 3.6): un CSV, las columnas reconocidas y cuántas
   *     filas antes de importar; base y fuente obligatorias y la declaración
   *     aceptada. La primera importación del espacio queda pendiente de
   *     revisión (la revisa Marco, como el primer envío real).
   *   · Personas: estado, fecha, origen y buscador; por persona, las
   *     invitaciones que recibió, «Dar de baja» y, solo admin, «Borrar sus
   *     datos» y «Prueba del consentimiento»; «Apuntar a alguien» (alta a
   *     mano, tarea 101) y, en su ficha, «También está apuntada a» las otras
   *     listas del espacio (tarea 103).
   * «Añadir a un borrador» pone la lista en una invitación en borrador que ya
   * existe, en vez de crear otra (tarea 103).
   * Mientras el envío sea simulado, la lista no se abre a gente real (§ 5.4).
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { docTitle } from '$lib/doc-title';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { dayMonthYear } from '$lib/datetime';
  import { retryLoad } from '$lib/load-fail';
  import { lensOn } from '$lib/lenses.svelte';
  import { audienceQueryOptions } from '$lib/audience-query';
  import {
    AUDIENCE_LANGUAGES,
    IMPORT_MAX_ROWS,
    embedCode,
    formUrl,
    readAudienceCsv,
    draftChoices,
    type AudienceAlso,
    type AudienceLanguage,
    type InvitationDraft,
    type CsvRead,
    type ImportBasis,
    type ImportResult,
    type SubscriptionInvitation,
    type SubscriptionRow,
  } from '$lib/audience';
  import RecordState from '$lib/components/RecordState.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Radio from '$lib/components/Radio.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import MailoutTestMode from '$lib/components/MailoutTestMode.svelte';
  import AudienceAddPerson from '$lib/components/audience/AudienceAddPerson.svelte';
  import AudienceAlsoLine from '$lib/components/audience/AudienceAlsoLine.svelte';
  import { addToast } from '$lib/components/Toast.svelte';

  const locale = appLocale();
  const queryClient = useQueryClient();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let id = $derived(page.params.id ?? '');

  const query = createQuery(toStore(() => ({ ...audienceQueryOptions(id), retry: retryLoad })));
  let d = $derived($query.data ?? null);
  let a = $derived(d?.audience ?? null);
  let canEdit = $derived(Boolean(d?.access.edit));
  let isAdmin = $derived(Boolean(d?.access.admin));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['audience', id] });
    void queryClient.invalidateQueries({ queryKey: ['audience-lists'] });
  }

  function failed(err: unknown) {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    const known = code && t(`audience.err_${code}`, locale) !== `audience.err_${code}` ? t(`audience.err_${code}`, locale) : '';
    addToast({
      tone: 'danger',
      title: t('audience.not_saved', locale),
      message: known || (err instanceof Error ? err.message : t('perf.unexpected', locale)),
    });
  }

  // ── Datos y textos, en local hasta guardar ─────────────────────────────
  let name = $state('');
  let description = $state('');
  let languages = $state<AudienceLanguage[]>([]);
  let defaultLanguage = $state<AudienceLanguage>('es');
  let texts = $state<Record<string, { consent_text: string; info_text: string }>>({});
  let loadedFor = $state('');

  /** Los textos que propone Hour, en el idioma de la lista (borradores para el abogado, plan § 6.2). */
  function proposedText(lang: AudienceLanguage): { consent_text: string; info_text: string } {
    const company = d?.workspace.name ?? '';
    const policy = d?.workspace.privacy_url ?? '';
    return {
      consent_text: t('audience.list_consent_default', lang, { company }),
      info_text: t('audience.list_info_default', lang, { company, policy }),
    };
  }

  $effect(() => {
    const cur = a;
    if (!cur || !d) return;
    const key = `${cur.id}:${cur.updated_at}`;
    if (untrack(() => loadedFor) === key) return;
    loadedFor = key;
    name = cur.name;
    description = cur.description ?? '';
    languages = [...cur.languages];
    defaultLanguage = cur.default_language;
    const next: Record<string, { consent_text: string; info_text: string }> = {};
    for (const lang of AUDIENCE_LANGUAGES) {
      const saved = d.texts.find((x) => x.language === lang);
      next[lang] = saved ? { consent_text: saved.consent_text, info_text: saved.info_text ?? '' } : proposedText(lang);
    }
    texts = next;
  });

  function toggleLanguage(lang: AudienceLanguage, on: boolean) {
    languages = on ? AUDIENCE_LANGUAGES.filter((l) => l === lang || languages.includes(l)) : languages.filter((l) => l !== lang);
    if (!languages.includes(defaultLanguage) && languages[0]) defaultLanguage = languages[0];
  }

  const saveDetails = createMutation({
    mutationFn: () =>
      mutateJSON('PATCH', `/api/audience/${id}`, {
        action: 'details',
        name: name.trim(),
        description: description.trim() || null,
        languages,
        default_language: defaultLanguage,
      }),
    onSuccess: () => {
      addToast({ tone: 'success', message: t('audience.saved', locale) });
      refresh();
    },
    onError: failed,
  });

  const saveTexts = createMutation({
    mutationFn: () =>
      mutateJSON('PATCH', `/api/audience/${id}`, {
        action: 'texts',
        texts: Object.fromEntries(
          (a?.languages ?? []).map((l) => [l, { consent_text: texts[l].consent_text.trim(), info_text: texts[l].info_text.trim() || null }]),
        ),
      }),
    onSuccess: () => {
      addToast({ tone: 'success', message: t('audience.texts_saved', locale) });
      refresh();
    },
    onError: failed,
  });

  const setStatus = createMutation({
    mutationFn: (status: 'open' | 'closed' | 'draft' | 'archived') => mutateJSON('PATCH', `/api/audience/${id}`, { action: 'status', status }),
    onSuccess: refresh,
    onError: failed,
  });

  const regenerate = createMutation({
    mutationFn: () => mutateJSON('PATCH', `/api/audience/${id}`, { action: 'key' }),
    onSuccess: () => {
      addToast({ tone: 'success', message: t('audience.key_regenerated', locale) });
      refresh();
    },
    onError: failed,
  });

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      addToast({ tone: 'success', message: done });
    } catch {
      addToast({ tone: 'danger', message: text });
    }
  }

  // ── Escribir una invitación ────────────────────────────────────────────
  const invite = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout/invitation', {
        workspace_id: a?.workspace_id,
        audience_id: id,
      }),
    onSuccess: (r) => {
      if (r) void goto(`/h/${r.workspace_slug}/mailout/${r.id}`);
    },
    onError: failed,
  });

  // ── Añadir a un borrador (tarea 103) ───────────────────────────────────
  let draftOpen = $state(false);
  let draftId = $state<string | null>(null);
  const drafts = createQuery(
    toStore(() => ({
      queryKey: ['audience-drafts', id] as const,
      enabled: draftOpen,
      meta: { persist: false },
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<{ items: InvitationDraft[] }>(`/api/audience/${id}/drafts`, signal),
    })),
  );
  let draftList = $derived(draftChoices($drafts.data?.items ?? [], id));
  function openDrafts() {
    draftId = null;
    draftOpen = true;
  }
  const toDraft = createMutation({
    mutationFn: (mailoutId: string) => mutateJSON('PUT', `/api/mailout/${mailoutId}/audience`, { audience_id: id }),
    onSuccess: (_r, mailoutId) => {
      draftOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['mailout', mailoutId] });
      void queryClient.invalidateQueries({ queryKey: ['mailout-list'] });
      void goto(`/h/${workspaceSlug}/mailout/${mailoutId}`);
    },
    onError: failed,
  });

  // ── Apuntar a alguien (tarea 101) ──────────────────────────────────────
  let addOpen = $state(false);

  // ── Importar ──────────────────────────────────────────────────────────
  let csv = $state<CsvRead | null>(null);
  let filename = $state<string | null>(null);
  let basis = $state<string | null>(null);
  let sourceNote = $state('');
  let statement = $state(false);
  let lastImport = $state<ImportResult | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function filePicked(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    filename = file.name;
    csv = readAudienceCsv(await file.text());
    lastImport = null;
  }

  // Otra base es otra declaración: se vuelve a aceptar.
  $effect(() => {
    void basis;
    untrack(() => (statement = false));
  });

  let importable = $derived(
    Boolean(
      csv &&
        csv.rows.length > 0 &&
        csv.rows.length <= IMPORT_MAX_ROWS &&
        basis &&
        sourceNote.trim().length >= 10 &&
        statement,
    ),
  );

  const runImport = createMutation({
    mutationFn: () =>
      mutateJSON<ImportResult>('POST', `/api/audience/${id}/import`, {
        filename,
        rows: csv?.rows ?? [],
        basis_kind: basis as ImportBasis,
        source_note: sourceNote.trim(),
        statement_accepted: true,
        statement_language: locale,
      }),
    onSuccess: (r) => {
      lastImport = r ?? null;
      csv = null;
      filename = null;
      basis = null;
      sourceNote = '';
      statement = false;
      refresh();
    },
    onError: failed,
  });

  function skippedLine(skipped: Partial<Record<string, number>>): string {
    return Object.entries(skipped)
      .filter(([, n]) => n)
      .map(([k, n]) => t(`audience.skip_${k}`, locale, { n: n ?? 0 }))
      .join(' · ');
  }

  // ── Personas ──────────────────────────────────────────────────────────
  let search = $state('');
  let people = $derived(
    (d?.subscriptions ?? []).filter((p) => {
      const q = search.trim().toLowerCase();
      return !q || p.address.includes(q) || (p.name ?? '').toLowerCase().includes(q);
    }),
  );
  const PEOPLE_PAGE = 100;
  let shown = $state(PEOPLE_PAGE);

  let openPerson = $state<SubscriptionRow | null>(null);
  let personOpen = $state(false);
  const history = createQuery(
    toStore(() => ({
      queryKey: ['audience-subscription', openPerson?.id ?? ''] as const,
      enabled: Boolean(openPerson),
      meta: { persist: false },
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ invitations: SubscriptionInvitation[]; also: AudienceAlso[] }>(
          `/api/audience/subscription/${openPerson?.id}`,
          signal,
        ),
    })),
  );
  function showPerson(p: SubscriptionRow) {
    openPerson = p;
    proof = null;
    personOpen = true;
  }

  const unsubscribe = createMutation({
    mutationFn: (p: SubscriptionRow) => mutateJSON('POST', `/api/audience/subscription/${p.id}`, {}),
    onSuccess: () => {
      personOpen = false;
      refresh();
    },
    onError: failed,
  });
  const erase = createMutation({
    mutationFn: (p: SubscriptionRow) => mutateJSON('DELETE', `/api/audience/subscription/${p.id}`),
    onSuccess: () => {
      personOpen = false;
      refresh();
    },
    onError: failed,
  });
  let proof = $state<unknown>(null);
  const loadProof = createMutation({
    mutationFn: (p: SubscriptionRow) => fetchJSON<{ proof: unknown }>(`/api/audience/subscription/${p.id}?proof=1`),
    onSuccess: (r) => (proof = r?.proof ?? null),
    onError: failed,
  });

  let counts = $derived({
    confirmed: (d?.subscriptions ?? []).filter((p) => p.status === 'confirmed').length,
    pending: (d?.subscriptions ?? []).filter((p) => p.status === 'pending').length,
    unsubscribed: (d?.subscriptions ?? []).filter((p) => p.status === 'unsubscribed').length,
  });
  let link = $derived(a ? formUrl(page.url.origin, a.form_key) : '');
  let languageOptions = $derived(languages.map((l) => ({ value: l, label: t(`mailout.lang_${l}`, locale) })));
</script>

<svelte:head>
  <title>{docTitle(a?.name || t('audience.view', locale))}</title>
</svelte:head>

{#if $query.isLoading || !d || !a}
  <section class="al">
    <p class="eyebrow">{t('audience.view', locale)}</p>
    <RecordState
      loading={$query.isLoading}
      error={$query.error ?? new ApiError(404, 'Not found')}
      missingText={t('audience.not_found', locale)}
      failedText={t('audience.load_error', locale)}
      onretry={() => void $query.refetch()}
      back={lensOn('conversations') ? { href: '/h/conversations?view=envios', label: t('envios.back', locale) } : null}
      {locale}
    />
  </section>
{:else}
  <section class="al" data-testid="audience-list">
    <header class="al__mast">
      <p class="eyebrow"><a href="/h/conversations?view=envios">{t('audience.view', locale)}</a></p>
      <h1 class="al__title"><em>{a.name}</em></h1>
      <p class="al__sub">
        <span class="al__status" data-status={a.status} data-testid="audience-status">{t(`audience.status_${a.status}`, locale)}</span>
        <span>{t('audience.counts', locale, { n: counts.confirmed, m: counts.pending, k: counts.unsubscribed })}</span>
      </p>
      {#if canEdit && a.status !== 'archived'}
        <div class="al__acts">
          <Button size="s" loading={$invite.isPending} onclick={() => $invite.mutate()}>{t('audience.write_invitation', locale)}</Button>
          <Button size="s" variant="secondary" onclick={openDrafts}>{t('audience.add_to_draft', locale)}</Button>
        </div>
      {/if}
    </header>

    {#if d.simulated}
      <MailoutTestMode title={t('mailout.simulated_title', locale)} body={t('audience.simulated_body', locale)} />
    {/if}

    <!-- ── Formulario ─────────────────────────────────────────────────── -->
    <section class="al__block" aria-labelledby="al-form">
      <BlockHead id="al-form" title={t('audience.list_form_block', locale)} />
      {#if !d.workspace.privacy_url}
        <p class="al__warn">
          {t('audience.needs_privacy', locale)}
          <a class="link-arrow" href={`/h/${workspaceSlug}/settings?section=space`}>{t('mailout.to_settings', locale)}</a>
        </p>
      {/if}
      {#if canEdit}
        <div class="al__form">
          <Input label={t('audience.list_name', locale)} bind:value={name} />
          <Textarea id="al-desc" label={t('audience.description', locale)} rows={2} maxlength={500} bind:value={description} />
          <fieldset class="al__langs">
            <legend>{t('audience.languages', locale)}</legend>
            {#each AUDIENCE_LANGUAGES as lang (lang)}
              <Checkbox
                label={t(`mailout.lang_${lang}`, locale)}
                checked={languages.includes(lang)}
                disabled={languages.length === 1 && languages.includes(lang)}
                onchange={(e) => toggleLanguage(lang, (e.currentTarget as HTMLInputElement).checked)}
              />
            {/each}
          </fieldset>
          {#if languages.length > 1}
            <Select label={t('audience.default_language', locale)} options={languageOptions} bind:value={defaultLanguage} />
          {/if}
          <div class="al__row-acts">
            <Button size="s" variant="secondary" loading={$saveDetails.isPending} disabled={!name.trim() || languages.length === 0} onclick={() => $saveDetails.mutate()}>
              {t('audience.save_details', locale)}
            </Button>
          </div>

          {#each a.languages as lang (lang)}
            {#if texts[lang]}
              <div class="al__text" data-lang={lang}>
                <h3 class="eyebrow eyebrow--sub">{t('audience.text_in', locale, { language: t(`mailout.lang_${lang}`, locale) })}</h3>
                <Textarea id={`al-consent-${lang}`} label={t('audience.consent_text', locale)} rows={2} maxlength={500} bind:value={texts[lang].consent_text} />
                <Textarea id={`al-info-${lang}`} label={t('audience.info_text', locale)} rows={4} maxlength={1500} bind:value={texts[lang].info_text} />
              </div>
            {/if}
          {/each}
          <p class="al__hint">
            {a.current_text_version
              ? t('audience.text_version', locale, { n: a.current_text_version })
              : t('audience.text_none', locale)}
          </p>
          <div class="al__row-acts">
            <Button size="s" variant="secondary" loading={$saveTexts.isPending} onclick={() => $saveTexts.mutate()}>{t('audience.save_texts', locale)}</Button>
          </div>
        </div>
      {:else if d.texts.length}
        {#each d.texts as x (x.id)}
          <p class="al__quote" lang={x.language}>{x.consent_text}</p>
        {/each}
      {/if}

      <div class="al__share">
        <p class="al__line"><span class="al__name">{t('audience.list_form_link', locale)}</span> <code class="al__addr" data-testid="audience-form-link">{link}</code></p>
        <div class="al__row-acts">
          <Button size="s" variant="secondary" onclick={() => copy(link, t('audience.copied', locale))}>{t('audience.copy_link', locale)}</Button>
          <Button size="s" variant="secondary" onclick={() => copy(embedCode(page.url.origin, a!.form_key, a!.name), t('audience.copied', locale))}>
            {t('audience.copy_embed', locale)}
          </Button>
          {#if canEdit}
            <Button size="s" variant="quiet" loading={$regenerate.isPending} onclick={() => $regenerate.mutate()}>{t('audience.new_link', locale)}</Button>
          {/if}
        </div>
      </div>

      {#if canEdit}
        <div class="al__row-acts">
          {#if a.status === 'open'}
            <Button size="s" variant="secondary" loading={$setStatus.isPending} onclick={() => $setStatus.mutate('closed')}>{t('audience.close_form', locale)}</Button>
          {:else if a.status !== 'archived'}
            <Button
              size="s"
              loading={$setStatus.isPending}
              disabled={!d.workspace.privacy_url || !a.current_text_version}
              onclick={() => $setStatus.mutate('open')}>{t('audience.open_form', locale)}</Button
            >
          {/if}
        </div>
        <p class="al__hint">{t(`audience.status_hint_${a.status}`, locale)}</p>
      {/if}
    </section>

    <!-- ── Importar ───────────────────────────────────────────────────── -->
    {#if canEdit && a.status !== 'archived'}
      <section class="al__block" aria-labelledby="al-import" data-testid="audience-import">
        <BlockHead id="al-import" title={t('audience.import', locale)} />
        <p class="al__hint">{t('audience.import_hint', locale)}</p>
        <input bind:this={fileInput} class="al__file" type="file" accept=".csv,text/csv,text/plain" onchange={filePicked} data-testid="audience-import-file" />
        <div class="al__row-acts">
          <Button size="s" variant="secondary" onclick={() => fileInput?.click()}>{t(csv ? 'audience.import_other' : 'audience.import_pick', locale)}</Button>
        </div>
        {#if csv}
          <div class="al__csv" data-testid="audience-import-read">
            <p class="al__line">
              <strong>{filename}</strong> · {t('audience.import_rows', locale, { n: csv.rows.length })}
            </p>
            <p class="al__hint">
              {t('audience.import_columns', locale, {
                columns: [csv.columns.email, csv.columns.name, csv.columns.language].filter(Boolean).join(', ') ||
                  t('audience.import_no_header', locale),
              })}
            </p>
            {#if csv.rows.length === 0}
              <p class="al__warn">{t('audience.import_no_email', locale)}</p>
            {:else if csv.rows.length > IMPORT_MAX_ROWS}
              <p class="al__warn">{t('audience.import_too_many', locale, { n: IMPORT_MAX_ROWS })}</p>
            {/if}
            <fieldset class="al__basis">
              <legend>{t('audience.import_basis', locale)}</legend>
              <Radio name="al-basis" value="consent" bind:group={basis} label={t('audience.import_basis_consent', locale, { company: d.workspace.name })} />
              <Radio name="al-basis" value="relationship" bind:group={basis} label={t('audience.import_basis_relationship', locale, { company: d.workspace.name })} />
            </fieldset>
            {#if basis === 'relationship'}
              <p class="al__hint">{t('audience.import_relationship_hint', locale)}</p>
            {/if}
            <Textarea
              id="al-source"
              label={t('audience.import_source', locale)}
              rows={2}
              maxlength={1000}
              bind:value={sourceNote}
              placeholder={t('audience.import_source_ph', locale)}
            />
            <!-- La declaración que se acepta es, palabra por palabra, la que guarda
                 `import_audience` en el idioma de la pantalla (plan § 3.6). -->
            {#if basis}
              <Checkbox
                label={t(basis === 'relationship' ? 'audience.import_statement_relationship' : 'audience.import_statement_consent', locale, {
                  company: d.workspace.name,
                })}
                bind:checked={statement}
              />
            {/if}
            <div class="al__row-acts">
              <Button size="s" loading={$runImport.isPending} disabled={!importable} onclick={() => $runImport.mutate()}>
                {t('audience.import_go', locale, { n: csv.rows.length })}
              </Button>
            </div>
          </div>
        {/if}
        {#if lastImport}
          <p class="al__line" role="status" data-testid="audience-import-result">
            {t('audience.import_done', locale, { n: lastImport.imported_count })}
            {#if skippedLine(lastImport.skipped)}· {skippedLine(lastImport.skipped)}{/if}
            {#if lastImport.status === 'review'}· <strong>{t('audience.import_review', locale)}</strong>{/if}
          </p>
        {/if}
        {#if d.imports.length > 0}
          <ul class="al__imports">
            {#each d.imports as im (im.id)}
              <li data-status={im.status}>
                <span>{dayMonthYear(im.declared_at)} · {im.filename ?? '—'}</span>
                <span>{t('audience.import_done', locale, { n: im.imported_count })}</span>
                <span class="al__status" data-status={im.status}>{t(`audience.import_status_${im.status}`, locale)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <!-- ── Personas ───────────────────────────────────────────────────── -->
    <section class="al__block" aria-labelledby="al-people">
      <BlockHead id="al-people" title={t('audience.people', locale)} count={d.subscriptions_total}>
        {#if canEdit && a.status !== 'archived' && a.current_text_version}
          <Button size="s" onclick={() => (addOpen = true)}>{t('audience.add_person', locale)}</Button>
        {/if}
      </BlockHead>
      {#if canEdit && a.status !== 'archived' && !a.current_text_version}
        <p class="al__hint">{t('audience.add_needs_text', locale)}</p>
      {/if}
      {#if d.subscriptions_total > d.subscriptions.length}
        <p class="al__hint">{t('audience.people_truncated', locale, { n: d.subscriptions.length, total: d.subscriptions_total })}</p>
      {/if}
      {#if d.subscriptions.length === 0}
        <p class="al__hint">{t('audience.people_empty', locale)}</p>
      {:else}
        <Input toolbar type="search" label={t('audience.search', locale)} placeholder={t('audience.search_ph', locale)} bind:value={search} />
        <ul class="al__people" data-testid="audience-people">
          {#each people.slice(0, shown) as p (p.id)}
            <li class="al__person">
              <button type="button" class="al__who" onclick={() => showPerson(p)}>
                <span class="al__addr">{p.address}</span>
                {#if p.name}<span class="al__name">{p.name}</span>{/if}
              </button>
              <span class="al__status" data-status={p.status}>{t(`audience.sub_${p.status}`, locale)}</span>
              <span class="al__meta">
                {t(`audience.source_${p.source}`, locale)} · {dayMonthYear(p.confirmed_at ?? p.created_at)}
              </span>
            </li>
          {/each}
        </ul>
        {#if people.length > shown}
          <Button size="s" variant="secondary" onclick={() => (shown += PEOPLE_PAGE)}>{t('audience.more', locale, { n: people.length - shown })}</Button>
        {/if}
      {/if}
    </section>
  </section>

  <Dialog bind:open={personOpen} title={openPerson?.address ?? ''} size="s" onclose={() => (openPerson = null)}>
    {#if openPerson}
      <p class="al__line">
        {t(`audience.sub_${openPerson.status}`, locale)} · {t(`audience.source_${openPerson.source}`, locale)} ·
        {t(`audience.basis_${openPerson.basis_kind}`, locale)}
      </p>
      <AudienceAlsoLine items={$history.data?.also ?? []} {workspaceSlug} {locale} />
      <h3 class="eyebrow eyebrow--sub">{t('audience.person_invitations', locale)}</h3>
      {#if $history.isLoading}
        <p class="al__hint">{t('audience.loading', locale)}</p>
      {:else if $history.isError}
        <!-- Una lectura que falla no es «Aún ninguna» (ADR-130 § 3). -->
        <p class="load-fail" role="alert" data-testid="audience-person-invitations-error">
          <span>{t('audience.person_invitations_error', locale)}</span>
          <Button variant="secondary" size="xs" onclick={() => $history.refetch()}>{t('ui.retry', locale)}</Button>
        </p>
      {:else if ($history.data?.invitations ?? []).length === 0}
        <p class="al__hint">{t('audience.person_no_invitations', locale)}</p>
      {:else}
        <ul class="al__imports" data-testid="audience-person-invitations">
          {#each $history.data?.invitations ?? [] as inv (inv.recipient_id)}
            <li>
              <a href={`/h/${workspaceSlug}/mailout/${inv.mailout_id}`}>{inv.subject || t('mailout.untitled', locale)}</a>
              <span class="al__status" data-state={inv.status}>{t(`mailout.r_${['pending', 'sending'].includes(inv.status) ? 'queued' : inv.status === 'skipped' ? 'unavailable' : inv.status}`, locale)}</span>
              {#if inv.sent_at}<span>{dayMonthYear(inv.sent_at)}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if proof}
        <h3 class="eyebrow eyebrow--sub">{t('audience.consent_proof', locale)}</h3>
        <pre class="al__proof">{JSON.stringify(proof, null, 2)}</pre>
      {/if}
    {/if}
    {#snippet actions()}
      {#if openPerson && isAdmin}
        <Button variant="quiet" loading={$loadProof.isPending} onclick={() => openPerson && $loadProof.mutate(openPerson)}>{t('audience.consent_proof', locale)}</Button>
        <Button variant="quiet" tone="warn" loading={$erase.isPending} onclick={() => openPerson && $erase.mutate(openPerson)}>{t('audience.erase_person', locale)}</Button>
      {/if}
      {#if openPerson && canEdit && openPerson.status !== 'unsubscribed'}
        <Button variant="secondary" loading={$unsubscribe.isPending} onclick={() => openPerson && $unsubscribe.mutate(openPerson)}>
          {t('audience.unsubscribe_person', locale)}
        </Button>
      {/if}
    {/snippet}
  </Dialog>
{/if}

{#if d && a}
  <AudienceAddPerson
    bind:open={addOpen}
    audienceId={a.id}
    listName={a.name}
    languages={a.languages}
    defaultLanguage={a.default_language}
    {locale}
  />

  <Dialog bind:open={draftOpen} title={t('audience.add_to_draft', locale)} description={a.name} size="s">
    {#if $drafts.isLoading}
      <p class="al__hint">{t('audience.loading', locale)}</p>
    {:else if $drafts.isError}
      <p class="load-fail" role="alert">
        <span>{t('audience.load_error', locale)}</span>
        <Button variant="secondary" size="xs" onclick={() => $drafts.refetch()}>{t('ui.retry', locale)}</Button>
      </p>
    {:else if draftList.length === 0}
      <p class="al__hint" data-testid="audience-drafts-empty">{t('audience.draft_none', locale)}</p>
    {:else}
      <fieldset class="al__basis" data-testid="audience-drafts">
        {#each draftList as m (m.id)}
          <Radio
            name="al-draft"
            value={m.id}
            bind:group={draftId}
            label={`${m.subject || t('mailout.untitled', locale)} · ${dayMonthYear(m.created_at)}${
              m.audience ? ` · ${t('audience.draft_has_list', locale, { list: m.audience.name })}` : ''
            }`}
          />
        {/each}
      </fieldset>
      <p class="al__hint">{t('audience.draft_hint', locale)}</p>
    {/if}
    {#snippet actions()}
      <Button variant="quiet" onclick={() => (draftOpen = false)}>{t('create.cancel', locale)}</Button>
      <Button loading={$toDraft.isPending} disabled={!draftId} onclick={() => draftId && $toDraft.mutate(draftId)}>
        {t('audience.draft_go', locale)}
      </Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  @layer components {
    .al {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      max-inline-size: var(--calm-measure);
    }
    .al__mast {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .al__mast p,
    .al__title {
      margin: 0;
    }
    .al__title em {
      font-style: italic;
    }
    .al__sub {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-s);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .al__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    .al__status {
      color: var(--heading-color);
      font-weight: 500;
    }
    .al__acts,
    .al__row-acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
    }
    .al__block,
    .al__form,
    .al__text,
    .al__share,
    .al__csv {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .al__langs,
    .al__basis {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-m);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .al__langs legend,
    .al__basis legend {
      margin-block-end: var(--space-xs);
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .al__basis {
      flex-direction: column;
    }
    .al__hint {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .al__warn {
      margin: 0;
      color: var(--danger-dark);
      font-size: var(--text-s);
    }
    .al__line,
    .al__quote {
      margin: 0;
      font-size: var(--text-s);
    }
    .al__file {
      display: none;
    }
    .al__imports,
    .al__people {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .al__imports li,
    .al__person {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-xs);
      border-block-end: var(--border);
      font-size: var(--text-s);
    }
    .al__who {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-s);
      padding: 0;
      background: none;
      border: 0;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .al__addr {
      overflow-wrap: anywhere;
    }
    .al__name,
    .al__meta {
      color: var(--text-muted);
    }
    .al__meta {
      margin-inline-start: auto;
    }
    .al__proof {
      max-block-size: 16rem;
      overflow: auto;
      font-size: var(--text-xs);
      white-space: pre-wrap;
    }
  }
</style>
