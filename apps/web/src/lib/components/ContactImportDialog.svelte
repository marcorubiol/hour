<script lang="ts">
  /**
   * «Importar contactos» (tarea 138): una hoja de contactos (CSV, la primera
   * hoja de un .xlsx o las filas pegadas desde la hoja), leída en este
   * dispositivo. Desde el «+» de Conversaciones y desde ⌘K; montado una vez
   * en el marco (`creation.importOpen`).
   *
   * 1. Fichero: soltar, elegir o pegar. A Hour no llega nada todavía.
   * 2. Columnas: lo que Hour propone por la cabecera, corregible una a una;
   *    lo que no tiene campo va a la nota privada de quien importa.
   * 3. Revisar: qué pasa con cada fila contra lo que ya está (mismo correo,
   *    la misma persona; mismo nombre, se pregunta), las que no entran y las
   *    repetidas unidas. Importar escribe al confirmar, en tandas de 500.
   * 4. Importado: las cifras, copiar lo que no entró y deshacer (7 días).
   *
   * Importar guarda contactos y nada más: ni conversaciones ni bases de envío.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, mutateJSON } from '$lib/api';
  import Badge from '$lib/components/Badge.svelte';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Select from '$lib/components/Select.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { t, type Locale } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { spaceName } from '$lib/utils/identity';
  import { readXlsx, sheetKind } from '$lib/xlsx-read';
  import {
    assignColumn,
    columnSample,
    CONTACT_IMPORT_MAX_ROWS,
    decodeText,
    failedAsTsv,
    IMPORT_FIELDS,
    lookupRequest,
    mappingReady,
    mergeRows,
    payloadRows,
    planContacts,
    proposeColumns,
    readRows,
    sheetFromCells,
    sheetFromText,
    tallyPlan,
    type ContactImportResult,
    type ImportField,
    type ImportLookup,
    type PlannedContact,
    type Sheet,
  } from '$lib/contact-import';
  import { CONTACT_IMPORT_KEYS, undoContactImport } from '$lib/contact-import-undo';

  interface Props {
    open?: boolean;
    /** Los espacios donde quien importa puede dar de alta contactos, el preferido primero. */
    workspaceIds: string[];
    locale: Locale;
  }

  let { open = $bindable(false), workspaceIds, locale }: Props = $props();

  const queryClient = useQueryClient();
  const workspacesQuery = createQuery(workspacesQueryOptions());

  type Step = 'file' | 'columns' | 'review' | 'done';
  let step = $state<Step>('file');

  // ── 1. Fichero ──────────────────────────────────────────────────────────
  let fileName = $state('');
  let pasted = $state('');
  let fileSheet = $state<Sheet | null>(null);
  let sheetNote = $state('');
  let readError = $state('');
  let reading = $state(false);
  let dragging = $state(false);
  let inputEl = $state<HTMLInputElement>();

  let sheet = $derived<Sheet | null>(fileSheet ?? (pasted.trim() ? sheetFromText(pasted, t('contact_import.column_word', locale)) : null));
  let sheetError = $derived.by(() => {
    if (readError) return readError;
    if (!sheet) return '';
    if (sheet.rows.length === 0) return t('contact_import.empty', locale);
    if (sheet.rows.length > CONTACT_IMPORT_MAX_ROWS) return t('contact_import.too_many', locale, { n: sheet.rows.length });
    return '';
  });

  async function readFile(file: File) {
    readError = '';
    sheetNote = '';
    reading = true;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const kind = sheetKind(buf);
      if (kind === 'xls') {
        readError = t('contact_import.xls_old', locale);
        return;
      }
      if (kind === 'zip') {
        const x = await readXlsx(buf);
        fileSheet = sheetFromCells(x.rows, t('contact_import.column_word', locale));
        if (x.sheets > 1) sheetNote = t('contact_import.first_sheet', locale, { name: x.sheet });
      } else {
        fileSheet = sheetFromText(decodeText(buf), t('contact_import.column_word', locale));
      }
      fileName = file.name;
      pasted = '';
    } catch {
      readError = t('contact_import.not_a_sheet', locale);
    } finally {
      reading = false;
    }
  }

  function onPick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) void readFile(f);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void readFile(f);
  }

  // ── El espacio ──────────────────────────────────────────────────────────
  let workspaces = $derived(
    workspaceIds
      .map((id) => ($workspacesQuery.data?.items ?? []).find((w) => w.id === id))
      .filter((w): w is NonNullable<typeof w> => Boolean(w)),
  );
  let workspaceId = $state('');
  $effect(() => {
    if (!workspaces.some((w) => w.id === workspaceId) && workspaces.length > 0) workspaceId = workspaces[0].id;
  });

  // ── 2. Columnas ─────────────────────────────────────────────────────────
  let mapping = $state<ImportField[]>([]);
  let proposedMapping = $state<ImportField[]>([]);
  const fieldOptions = $derived(IMPORT_FIELDS.map((f) => ({ value: f, label: t(`contact_import.f_${f}`, locale) })));

  function toColumns() {
    if (!sheet || sheetError) return;
    const proposed = proposeColumns(sheet);
    proposedMapping = proposed;
    mapping = [...proposed];
    step = 'columns';
  }

  function setColumn(i: number, value: string) {
    mapping = assignColumn(mapping, i, value as ImportField);
  }

  // ── 3. Revisar ──────────────────────────────────────────────────────────
  let lookup = $state<ImportLookup | null>(null);
  let lookupError = $state<'not_ready' | 'failed' | null>(null);
  let decisions = $state<Record<number, 'same' | 'other'>>({});
  type Filter = 'all' | 'ask' | 'error' | 'fill' | 'merged';
  let filter = $state<Filter>('all');

  let contacts = $derived(sheet && mapping.length ? mergeRows(readRows(sheet, mapping), sheet.header[mapping.indexOf('org_name')] ?? '') : []);
  let plan = $derived<PlannedContact[]>(lookup ? planContacts(contacts, lookup) : []);
  let tally = $derived(tallyPlan(plan, decisions));

  async function toReview() {
    if (!sheet || !mappingReady(mapping)) return;
    step = 'review';
    lookup = null;
    lookupError = null;
    decisions = {};
    try {
      const found = await mutateJSON<ImportLookup>('POST', '/api/contact-imports/lookup', {
        workspace_id: workspaceId,
        ...lookupRequest(contacts),
      });
      if (!found) throw new Error('empty lookup');
      lookup = found;
      const planned = planContacts(contacts, found);
      filter = planned.some((c) => c.status === 'ask') ? 'ask' : 'all';
    } catch (err) {
      lookupError = err instanceof ApiError && err.body?.error === 'not_ready' ? 'not_ready' : 'failed';
    }
  }

  const SHOWN = 200;
  let filtered = $derived(
    plan.filter((c) =>
      filter === 'all'
        ? true
        : filter === 'ask'
          ? c.status === 'ask'
          : filter === 'error'
            ? c.status === 'error'
            : filter === 'fill'
              ? c.status === 'fill'
              : c.lines.length > 1,
    ),
  );

  function contactName(c: PlannedContact): string {
    return c.person?.full_name ?? c.org?.name ?? t('contact_import.no_name', locale);
  }

  function contactSub(c: PlannedContact): string {
    const org = c.person && c.org ? c.org.name : null;
    const email = c.person?.email ?? c.org?.email ?? null;
    return [org, email].filter(Boolean).join(' · ');
  }

  function fieldWords(fields: string[]): string {
    return fields.map((f) => t(`contact_import.fl_${f}`, locale)).join(', ');
  }

  function why(c: PlannedContact): string {
    if (c.status === 'error') return t(c.error === 'too_long' ? 'contact_import.err_too_long' : 'contact_import.err_no_name', locale);
    if (c.status === 'ask' && c.candidate) {
      return c.candidate.organization_name
        ? t('contact_import.why_ask_org', locale, { name: c.candidate.full_name, org: c.candidate.organization_name })
        : t('contact_import.why_ask', locale, { name: c.candidate.full_name });
    }
    if (c.status === 'fill') {
      const fields = [...c.personFills, ...(c.person && c.org && c.existing && !c.existing.organization_id ? ['org'] : []), ...c.orgFills];
      return t('contact_import.why_fill', locale, { fields: fieldWords(fields) });
    }
    if (c.status === 'same') return t('contact_import.why_same', locale);
    return c.person ? (c.org && !c.knownOrg ? t('contact_import.why_new_both', locale) : t('contact_import.why_new_person', locale)) : t('contact_import.why_new_org', locale);
  }

  function issueText(c: PlannedContact): string[] {
    return c.issues.map((i) => (i === 'kind_unread' ? t('contact_import.issue_kind_unread', locale, { kind: c.rawKind ?? '' }) : t(`contact_import.issue_${i}`, locale)));
  }

  const BADGE: Record<PlannedContact['status'], { tone: 'success' | 'neutral' | 'warning' | 'danger'; key: string }> = {
    new: { tone: 'success', key: 'contact_import.st_new' },
    fill: { tone: 'neutral', key: 'contact_import.st_fill' },
    same: { tone: 'neutral', key: 'contact_import.st_same' },
    ask: { tone: 'warning', key: 'contact_import.st_ask' },
    error: { tone: 'danger', key: 'contact_import.st_error' },
  };

  // ── 4. Importar ─────────────────────────────────────────────────────────
  let saving = $state(false);
  let result = $state<ContactImportResult | null>(null);
  let notReady = $state(false);

  /** Las líneas de la hoja que no entraron: las de la revisión y las que la base rechazó. */
  let failedLines = $derived.by(() => {
    const out: number[] = [];
    for (const c of plan) if (c.status === 'error') out.push(...c.lines);
    const byFirst = new Map(plan.map((c) => [c.lines[0], c.lines]));
    for (const f of result?.failed ?? []) if (f.line !== null) out.push(...(byFirst.get(f.line) ?? [f.line]));
    return out;
  });

  async function save() {
    if (!lookup || saving || tally.toImport === 0) return;
    saving = true;
    notReady = false;
    try {
      const r = await mutateJSON<ContactImportResult>('POST', '/api/contact-imports', {
        workspace_id: workspaceId,
        filename: fileName || null,
        rows: payloadRows(plan, decisions),
      });
      if (!r) throw new Error('empty result');
      result = r;
      step = 'done';
      await Promise.all(CONTACT_IMPORT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
      const n = r.persons_created + r.organizations_created;
      addToast({
        tone: 'success',
        message: t('contact_import.saved', locale, { n }),
        ...(r.import_id ? { action: { label: t('ui.undo', locale), run: () => askUndo() } } : {}),
      });
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'not_ready') notReady = true;
      else addToast({ tone: 'danger', title: t('contact_import.failed', locale), message: t('perf.unexpected', locale) });
    } finally {
      saving = false;
    }
  }

  async function copyFailed() {
    if (!sheet) return;
    const ok = await copyText(failedAsTsv(sheet, failedLines));
    addToast({ tone: ok ? 'info' : 'danger', message: t(ok ? 'contact_import.copied' : 'contact_import.copy_failed_toast', locale) });
  }

  // ── Deshacer ────────────────────────────────────────────────────────────
  let undoOpen = $state(false);
  let undoing = $state(false);
  /** La importación que se deshace: se queda aunque el diálogo se cierre o se reinicie. */
  let undoTarget = $state<{ id: string; name: string; persons: number; orgs: number; notes: number } | null>(null);

  function askUndo() {
    if (!result?.import_id) return;
    undoTarget = {
      id: result.import_id,
      name: fileName || t('contact_import.pasted', locale),
      persons: result.persons_created,
      orgs: result.organizations_created,
      notes: result.notes_created,
    };
    undoOpen = true;
  }

  async function confirmUndo() {
    if (!undoTarget) return;
    undoing = true;
    const ok = await undoContactImport(undoTarget.id, locale, queryClient);
    undoing = false;
    undoOpen = false;
    if (ok) open = false;
  }

  // ── Reiniciar al abrir ──────────────────────────────────────────────────
  function reset() {
    step = 'file';
    fileName = '';
    pasted = '';
    fileSheet = null;
    sheetNote = '';
    readError = '';
    mapping = [];
    proposedMapping = [];
    lookup = null;
    lookupError = null;
    decisions = {};
    result = null;
    notReady = false;
    if (inputEl) inputEl.value = '';
  }

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) reset();
    wasOpen = open;
  });

  let stepIndex = $derived(step === 'file' ? 0 : step === 'columns' ? 1 : 2);
  let title = $derived(step === 'done' ? t('contact_import.done_title', locale) : fileName || t('contact_import.title', locale));
</script>

<Dialog bind:open {title} size="l" dirty={step === 'columns' || step === 'review'}>
  {#if step !== 'done'}
    <ol class="cim__steps" aria-label={t('contact_import.steps', locale)}>
      {#each ['contact_import.step_file', 'contact_import.step_columns', 'contact_import.step_review'] as key, i (key)}
        <li class:cim__step--on={i === stepIndex} class:cim__step--done={i < stepIndex} aria-current={i === stepIndex ? 'step' : undefined}>
          {t(key, locale)}
        </li>
      {/each}
    </ol>
  {/if}

  {#if step === 'file'}
    <div
      class="cim__drop"
      class:cim__drop--over={dragging}
      role="region"
      aria-label={t('contact_import.drop', locale)}
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      data-testid="contact-import-drop"
    >
      <strong>{fileName || t('contact_import.drop', locale)}</strong>
      <span>{fileSheet ? t('contact_import.read_rows', locale, { n: fileSheet.rows.length }) : t('contact_import.drop_kinds', locale)}</span>
      <Button variant="secondary" size="s" onclick={() => inputEl?.click()} loading={reading}>{t('contact_import.pick', locale)}</Button>
      <input
        bind:this={inputEl}
        class="cim__file"
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onchange={onPick}
        data-testid="contact-import-file"
      />
    </div>
    {#if sheetNote}<p class="cim__hint">{sheetNote}</p>{/if}
    {#if !fileSheet}
      <p class="cim__or">{t('contact_import.or_paste', locale)}</p>
      <Textarea ariaLabel={t('contact_import.paste_label', locale)} bind:value={pasted} rows={4} placeholder={t('contact_import.paste_placeholder', locale)} />
    {/if}
    {#if sheetError}<p class="cim__error" role="alert">{sheetError}</p>{/if}
    {#if workspaces.length > 1}
      <Select label={t('contact_import.workspace', locale)} options={workspaces.map((w) => ({ value: w.id, label: spaceName(w.name) }))} bind:value={workspaceId} />
    {/if}
    <p class="cim__hint">{t('contact_import.local_only', locale)}</p>
  {:else if step === 'columns' && sheet}
    <p class="cim__hint">{t('contact_import.columns_summary', locale, { rows: sheet.rows.length, cols: sheet.header.length })}</p>
    <ul class="cim__cols" data-testid="contact-import-columns">
      <li class="cim__cols-head" aria-hidden="true">
        <span>{t('contact_import.col_sheet', locale)}</span><span>{t('contact_import.col_sample', locale)}</span><span>{t('contact_import.col_hour', locale)}</span>
      </li>
      {#each sheet.header as head, i (i)}
        <li class="cim__col">
          <span class="cim__col-name">{head}</span>
          <span class="cim__col-sample">{columnSample(sheet, i).join(' · ')}</span>
          <span class="cim__col-pick">
            <Select ariaLabel={t('contact_import.in_hour', locale, { name: head })} options={fieldOptions} value={mapping[i]} onchange={(e) => setColumn(i, (e.currentTarget as HTMLSelectElement).value)} />
            {#if mapping[i] === proposedMapping[i] && mapping[i] !== 'skip' && mapping[i] !== 'note'}
              <span class="cim__proposed">{t('contact_import.proposed', locale)}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if !mappingReady(mapping)}<p class="cim__error" role="alert">{t('contact_import.need_name', locale)}</p>{/if}
    <p class="cim__hint">{t('contact_import.note_private', locale)}</p>
  {:else if step === 'review'}
    {#if lookupError}
      <p class="cim__error" role="alert">{t(lookupError === 'not_ready' ? 'contact_import.not_ready' : 'contact_import.lookup_failed', locale)}</p>
    {:else if !lookup}
      <p class="cim__hint">{t('conversations.loading', locale)}</p>
    {:else}
      <dl class="cim__tally" data-testid="contact-import-tally">
        <div><dt>{t('contact_import.t_new_persons', locale)}</dt><dd>{tally.newPersons}</dd></div>
        <div><dt>{t('contact_import.t_new_orgs', locale)}</dt><dd>{tally.newOrgs}</dd></div>
        <div><dt>{t('contact_import.t_fills', locale)}</dt><dd>{tally.fills}</dd></div>
        <div><dt>{t('contact_import.t_merged', locale)}</dt><dd>{tally.merged}</dd></div>
        <div><dt>{t('contact_import.t_ask', locale)}</dt><dd>{tally.ask}</dd></div>
        <div><dt>{t('contact_import.t_errors', locale)}</dt><dd>{tally.errors}</dd></div>
      </dl>
      <div class="cim__filters" role="group" aria-label={t('contact_import.filter', locale)}>
        <Chip selected={filter === 'all'} onclick={() => (filter = 'all')}>{t('contact_import.filter_all', locale, { n: plan.length })}</Chip>
        {#if tally.ask > 0}<Chip selected={filter === 'ask'} onclick={() => (filter = 'ask')}>{t('contact_import.filter_ask', locale, { n: tally.ask })}</Chip>{/if}
        {#if tally.errors > 0}<Chip selected={filter === 'error'} onclick={() => (filter = 'error')}>{t('contact_import.filter_error', locale, { n: tally.errors })}</Chip>{/if}
        {#if tally.fills > 0}<Chip selected={filter === 'fill'} onclick={() => (filter = 'fill')}>{t('contact_import.filter_fill', locale, { n: tally.fills })}</Chip>{/if}
        {#if tally.merged > 0}<Chip selected={filter === 'merged'} onclick={() => (filter = 'merged')}>{t('contact_import.filter_merged', locale, { n: tally.merged })}</Chip>{/if}
      </div>
      <ul class="cim__rows" data-testid="contact-import-rows">
        {#each filtered.slice(0, SHOWN) as c (c.lines[0])}
          <li class="cim__row" class:cim__row--error={c.status === 'error'} data-status={c.status}>
            <span class="cim__line">{c.lines.join(', ')}</span>
            <span class="cim__who">
              <strong>{contactName(c)}</strong>
              {#if contactSub(c)}<span class="cim__sub">{contactSub(c)}</span>{/if}
            </span>
            <span class="cim__what">
              <span class="cim__badges">
                <Badge tone={BADGE[c.status].tone} size="xs">{t(BADGE[c.status].key, locale)}</Badge>
                {#if c.lines.length > 1}<Badge size="xs">{t('contact_import.st_merged', locale)}</Badge>{/if}
              </span>
              <span class="cim__sub">{why(c)}</span>
              {#each issueText(c) as issue (issue)}<span class="cim__sub">{issue}</span>{/each}
            </span>
            {#if c.status === 'ask'}
              <span class="cim__decide">
                <Segmented
                  ariaLabel={t('contact_import.decide', locale, { name: contactName(c) })}
                  options={[
                    { value: 'same', label: t('contact_import.ask_same', locale) },
                    { value: 'other', label: t('contact_import.ask_other', locale) },
                  ]}
                  value={decisions[c.lines[0]] ?? c.proposal ?? 'other'}
                  onchange={(v) => (decisions = { ...decisions, [c.lines[0]]: v })}
                />
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if filtered.length > SHOWN}<p class="cim__hint">{t('contact_import.shown', locale, { shown: SHOWN, n: filtered.length })}</p>{/if}
      {#if notReady}<p class="cim__error" role="alert">{t('contact_import.not_ready', locale)}</p>{/if}
    {/if}
  {:else if step === 'done' && result}
    <dl class="cim__done" data-testid="contact-import-result">
      <div><dt>{t('contact_import.r_persons', locale)}</dt><dd>{result.persons_created}</dd></div>
      <div><dt>{t('contact_import.r_orgs', locale)}</dt><dd>{result.organizations_created}</dd></div>
      <div><dt>{t('contact_import.r_fills', locale)}</dt><dd>{result.persons_filled + result.organizations_filled}</dd></div>
      <div><dt>{t('contact_import.r_notes', locale)}</dt><dd>{result.notes_created}</dd></div>
      <div><dt>{t('contact_import.r_failed', locale)}</dt><dd>{failedLines.length}</dd></div>
    </dl>
    {#if result.partial}<p class="cim__error" role="alert">{t('contact_import.partial', locale)}</p>{/if}
    {#if result.warnings.some((w) => w.reason === 'organization_hidden')}<p class="cim__hint">{t('contact_import.warn_hidden', locale)}</p>{/if}
    {#if failedLines.length > 0}<p class="cim__hint">{t('contact_import.failed_hint', locale)}</p>{/if}
  {/if}

  {#snippet lead()}
    {#if step === 'columns'}<Button variant="quiet" onclick={() => (step = 'file')}>{t('contact_import.back', locale)}</Button>{/if}
    {#if step === 'review'}<Button variant="quiet" onclick={() => (step = 'columns')}>{t('contact_import.back', locale)}</Button>{/if}
    {#if step === 'done' && result?.import_id}<Button variant="quiet" onclick={askUndo}>{t('contact_import.undo_import', locale)}</Button>{/if}
  {/snippet}
  {#snippet actions()}
    {#if step === 'done'}
      {#if failedLines.length > 0}<Button variant="secondary" onclick={copyFailed}>{t('contact_import.copy_failed', locale)}</Button>{/if}
      <Button onclick={() => (open = false)}>{t('contact_import.close', locale)}</Button>
    {:else}
      <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
      {#if step === 'file'}
        <Button onclick={toColumns} disabled={!sheet || Boolean(sheetError) || !workspaceId}>{t('contact_import.next', locale)}</Button>
      {:else if step === 'columns'}
        <Button onclick={toReview} disabled={!mappingReady(mapping)}>{t('contact_import.next', locale)}</Button>
      {:else}
        <Button onclick={save} loading={saving} disabled={!lookup || tally.toImport === 0}>{t('contact_import.import_n', locale, { n: tally.toImport })}</Button>
      {/if}
    {/if}
  {/snippet}
</Dialog>

{#if undoTarget}
  <ConfirmDialog
    bind:open={undoOpen}
    title={t('contact_import.undo_title', locale, { name: undoTarget.name })}
    body={t('contact_import.undo_body', locale, { persons: undoTarget.persons, orgs: undoTarget.orgs, notes: undoTarget.notes })}
    confirm={t('contact_import.undo_confirm', locale)}
    busy={undoing}
    {locale}
    onconfirm={confirmUndo}
  />
{/if}

<style>
  @layer components {
    .cim__steps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-m);
      margin: 0 0 var(--space-s);
      padding: 0;
      list-style: none;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      text-transform: uppercase;
    }
    .cim__step--on {
      color: var(--text-color);
    }
    .cim__step--done {
      color: var(--text-muted);
    }
    .cim__drop {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      align-items: center;
      padding: var(--space-l) var(--space-m);
      border: var(--line-thin) dashed var(--border-color-dark);
      border-radius: var(--radius-m);
      color: var(--text-muted);
      text-align: center;
    }
    .cim__drop strong {
      color: var(--heading-color);
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .cim__drop--over {
      background: var(--bg-hover);
    }
    .cim__file {
      display: none;
    }
    .cim__or,
    .cim__hint {
      margin: var(--space-xs) 0 0;
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .cim__error {
      margin: var(--space-xs) 0 0;
      color: var(--warning-dark);
      font-size: var(--text-s);
    }
    .cim__cols,
    .cim__rows {
      display: flex;
      flex-direction: column;
      margin: var(--space-s) 0 0;
      padding: 0;
      list-style: none;
    }
    .cim__cols-head,
    .cim__col {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.2fr);
      gap: var(--space-s);
      align-items: center;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .cim__cols-head {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      text-transform: uppercase;
      border-block-end-color: var(--border-color-dark);
    }
    .cim__col-name {
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .cim__col-sample {
      color: var(--text-muted);
      font-size: var(--text-s);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cim__col-pick {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .cim__proposed {
      color: var(--suggest-ink);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-xs);
    }
    .cim__tally,
    .cim__done {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: var(--space-xs);
      margin: 0;
    }
    .cim__tally > div,
    .cim__done > div {
      display: flex;
      flex-direction: column-reverse;
      gap: var(--space-2xs);
      padding: var(--space-xs) var(--space-s);
      background: var(--bg-light);
      border-radius: var(--radius-s);
    }
    .cim__tally dt,
    .cim__done dt {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .cim__tally dd,
    .cim__done dd {
      margin: 0;
      color: var(--heading-color);
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-variant-numeric: tabular-nums;
    }
    .cim__filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin-block-start: var(--space-s);
    }
    .cim__row {
      display: grid;
      grid-template-columns: 4rem minmax(0, 1fr) minmax(0, 1.2fr) auto;
      gap: var(--space-2xs) var(--space-s);
      align-items: start;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .cim__row--error {
      background: var(--tone-danger-bg);
    }
    .cim__line {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .cim__who,
    .cim__what {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .cim__who strong {
      font-weight: 500;
    }
    .cim__badges {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }
    .cim__sub {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    /* La tabla se vuelve lista: arriba quién y qué pasa, debajo por qué y la elección. */
    @media (max-width: 47.999rem) {
      .cim__cols-head {
        display: none;
      }
      .cim__col {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .cim__col-pick {
        grid-column: 1 / -1;
      }
      .cim__row {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .cim__line {
        grid-column: 2;
        grid-row: 1;
        text-align: end;
      }
      .cim__who {
        grid-row: 1;
        grid-column: 1;
      }
      .cim__what,
      .cim__decide {
        grid-column: 1 / -1;
      }
    }
  }
</style>
