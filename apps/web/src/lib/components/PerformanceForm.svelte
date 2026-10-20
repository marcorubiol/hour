<script module lang="ts">
  /**
   * The performance creation form — ONE home for "how a gig is created"
   * (ADR-078 §1). Extracted from PerformanceCreateDialog so both that
   * dialog (line modules, hall) and the unified calendar create dialog
   * mount the exact same fields, presets and POST; neither forks it.
   *
   * The host owns the surrounding dialog and its footer buttons: this
   * component exposes `submit()` (instance export) and a bindable
   * `pending`, so each host renders its own actions row without
   * duplicating the mutation.
   *
   * NO HOURS HERE, on purpose (ADR-090 P3, Marco 2026-10-10): a gig is
   * created on a day, and its hours are written only in its running order
   * (`RunningOrder`, on the day view and on the performance page). So
   * `performed_at` is a plain calendar day and the POST never carries a
   * time; the venue-local rule (ADR-078 §11) bites where hours exist.
   *
   * The create RPC returns the full row — this is the slice consumers
   * need (workspace_id resolves the navigation target's slug).
   */
  export type { CreatedPerformance } from '$lib/plan-create';
</script>

<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { viewerTimeZone } from '$lib/datetime';
  import { lensOn } from '$lib/lenses.svelte';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Select from './Select.svelte';
  import { addToast } from './Toast.svelte';
  import { toastCreated } from '$lib/created';
  import {
    createPerformances,
    invalidatePerformanceFeeds,
    undoPerformances,
    type CreatedPerformance,
  } from '$lib/plan-create';
  import { dayMonthYear } from '$lib/datetime';
  import { dayKeyInTz } from '$lib/planner';
  import { detectLocale, t } from '$lib/i18n';
  import { allLinesQueryOptions } from '$lib/nav-queries';
  import {
    boloDefault,
    boloOptions,
    boloPrefill,
    booksHref,
    type BoloLite,
  } from '$lib/bolo-pick';
  import { moneyAccessQueryOptions, projectBolosQueryOptions } from '$lib/bolo-queries';
  import {
    HOLD_NOTICE_DEFAULT,
    PERFORMANCE_CREATE_STATUSES,
    isHoldStatus,
    type PerformanceCreate,
    type PerformanceSeriesCreate,
  } from '$lib/performance';

  type ProjectLite = { id: string; slug: string; name: string };

  interface Props {
    /** Host dialog's open state — presets apply on each open transition. */
    open?: boolean;
    /** Preselect this project on open (applied only if none picked yet). */
    presetProjectId?: string | null;
    /** Preselect this line on open — hides the Line select entirely. */
    presetLineId?: string | null;
    /** Freeze the Project select (e.g. creating from inside a project). */
    lockProject?: boolean;
    /** ISO day to prefill on open; defaults to the viewer's today. */
    presetDate?: string | null;
    /**
     * ADR-084 §1 — los días RESUELTOS de una tanda, o null para una sola
     * función. Los calcula `BlockDays` en el diálogo anfitrión (regla de tramo
     * + días de la semana con excepciones punzadas) y llegan aquí ya hechos:
     * este formulario no vuelve a derivarlos, igual que no lo hace el
     * servidor. Con dos o más, `submit()` escribe la tanda de una sentencia.
     */
    days?: string[] | null;
    /** Mirrors the mutation's isPending for the host's footer button. */
    pending?: boolean;
    onCreated?: (perf: CreatedPerformance) => void;
  }

  let {
    open = false,
    presetProjectId = null,
    presetLineId = null,
    lockProject = false,
    presetDate = null,
    days = null,
    pending = $bindable(false),
    onCreated,
  }: Props = $props();

  const locale = detectLocale(navigator.language);
  const viewerTz = viewerTimeZone();
  const queryClient = useQueryClient();

  let cProject = $state('');
  let cDay = $state('');
  let cVenue = $state('');
  let cCity = $state('');
  // A NEW DATE IS BORN AS A HOLD (ADR-095 §7). Nobody adds a night to a touring
  // calendar because it is settled: you add it because a theatre asked for it,
  // and the whole certainty grammar exists to carry that difference.
  // Confirming is a separate act, and it lives on the row.
  let cStatus = $state('hold');
  let cLine = $state('');
  // ADR-080 §2 — hold decision notice; only shown (and only sent) while
  // the picked status is a hold*. null = empty field = standard default.
  let cHoldNotice = $state<number | null>(null);
  let showHoldNotice = $derived(isHoldStatus(cStatus));

  let statusOptions = $derived(
    PERFORMANCE_CREATE_STATUSES.map((s) => ({ value: s, label: t(`perf.status_${s}`, locale) })),
  );

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectLite[] }>('/api/projects?status=active', signal),
  });
  const linesQuery = createQuery(allLinesQueryOptions());

  let projectOptions = $derived(
    ($projectsQuery.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
  );

  // Lines of the selected project — client-side narrowing over the shared
  // ['lines','all'] cache. No lines (or a preset line) → no select at all.
  let projectLines = $derived(
    ($linesQuery.data?.items ?? []).filter((l) => l.project?.id === cProject),
  );
  let lineOptions = $derived([
    { value: '', label: t('create.line_none', locale) },
    ...projectLines.map((l) => ({ value: l.id, label: l.name })),
  ]);
  let showLineSelect = $derived(!presetLineId && projectLines.length > 0);

  // ADR-087 · § 36 — EL BOLO DEL QUE CUELGA. El trato suele existir antes que
  // la fecha (se cierra hablando), así que el alta ofrece los del proyecto y
  // no crea ninguno: crear es de Cuentas, y el campo enlaza allí. Las opciones
  // salen del feed de dinero; quien no lee dinero no ve el campo.
  let cBolo = $state('');
  const bolosQuery = createQuery(toStore(() => projectBolosQueryOptions(cProject, open)));
  let projectBolos = $derived<BoloLite[]>($bolosQuery.data?.items ?? []);
  let bolosOptions = $derived(boloOptions(projectBolos, locale));
  let showBoloSelect = $derived(bolosOptions.length > 1);
  // Sin filas, el feed no distingue «sin bolos» de «no te toca». Solo entonces
  // se pregunta, y solo a quien lee dinero se le ofrece crear uno en Cuentas.
  const accessQuery = createQuery(
    toStore(() =>
      moneyAccessQueryOptions(cProject, open && $bolosQuery.isSuccess && projectBolos.length === 0),
    ),
  );
  let showBoloEmpty = $derived(
    !showBoloSelect && $bolosQuery.isSuccess && $accessQuery.data?.read_money === true,
  );
  let emptyBoloOptions = $derived([{ value: '', label: t('perf.bolo_empty', locale) }]);

  // Con UN solo bolo abierto, el alta lo propone (Marco, 2026-10-10); con
  // varios, «sin bolo». Una vez por proyecto: lo que elija la persona después
  // no se vuelve a pisar.
  let boloSeededFor = $state('');
  $effect(() => {
    if (!cProject || boloSeededFor === cProject || !$bolosQuery.isSuccess) return;
    boloSeededFor = cProject;
    cBolo = boloDefault(projectBolos);
    if (cBolo) pickBolo(cBolo);
  });

  /** Otro proyecto, u otra alta: el bolo se vuelve a proponer desde cero. */
  function resetBolo() {
    cBolo = '';
    boloSeededFor = '';
  }

  /** Un bolo es una sala: lo que el alta tenga vacío lo trae él. */
  function pickBolo(id: string) {
    const filled = boloPrefill(
      projectBolos.find((b) => b.id === id),
      { venue: cVenue, city: cCity },
    );
    cVenue = filled.venue;
    cCity = filled.city;
  }

  // Apply presets on each open transition; day is refreshed every open.
  // When the CONTEXT dictates the target (presetProjectId/presetLineId —
  // line modules, locked projects) the preset ALWAYS wins: the component
  // instance survives navigation between lines (same route, new params),
  // so a leftover cProject/cLine from line A must never leak a gig into
  // line B (review 2026-07-12, HIGH). Only the free-form global dialog
  // keeps the "don't override what the user picked" contract.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      cDay = presetDate ?? dayKeyInTz(new Date().toISOString(), viewerTz);
      if (presetProjectId) {
        if (cProject !== presetProjectId) resetBolo();
        cProject = presetProjectId;
        cLine = presetLineId ?? '';
      } else if (!cProject) {
        cProject = projectOptions.length === 1 ? projectOptions[0].value : '';
        cLine = presetLineId ?? '';
        resetBolo();
      }
    }
    wasOpen = open;
  });

  /**
   * ONE mutation for one gig or a run (ADR-084 §1): the write, the hold-notice
   * follow-up and what «Deshacer» deletes live in `plan-create`, shared with
   * the planner's quick add.
   */
  const createPerf = createMutation({
    mutationFn: (input: PerformanceCreate | PerformanceSeriesCreate) => createPerformances(input, cHoldNotice),
    onSuccess: ({ rows, noticeFailed }, input) => {
      if (noticeFailed) addToast({ tone: 'warning', message: t('perf.hold_notice_not_saved', locale) });
      const span = Array.isArray(input.performed_at) ? input.performed_at : [input.performed_at];
      const day =
        span.length > 1
          ? `${dayMonthYear(span[0])} – ${dayMonthYear(span[span.length - 1])}`
          : dayMonthYear(span[0]);
      toastCreated({
        locale,
        message: t('create.added', locale, { what: t('create.type_performance', locale), day }),
        undo: () => undoPerformances(rows.map((r) => r.id), queryClient),
      });
      cVenue = '';
      cCity = '';
      resetBolo();
      cHoldNotice = null;
      void invalidatePerformanceFeeds(queryClient);
      // El anfitrión cierra con la primera, que es la que abre la tanda.
      onCreated?.(rows[0]);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('create.not_created', locale),
        message: t('perf.try_again', locale, {
          error: err instanceof Error ? err.message : t('perf.unexpected', locale),
        }),
      });
    },
  });

  // The host's footer button reads pending through the bindable — a store
  // value can't cross the instance boundary reactively any other way.
  $effect(() => {
    pending = $createPerf.isPending;
  });

  /** La tanda manda: dos días o más resueltos por el anfitrión. */
  let isRun = $derived(Boolean(days && days.length >= 2));

  let formEl: HTMLFormElement | undefined = $state();

  /**
   * The host's button submits the FORM, so the native constraints (the
   * project, the day) run and speak under their field (ADR-139 p7), never
   * as a toast; the form's own submit handler then writes.
   */
  export function submit() {
    formEl?.requestSubmit();
  }

  function save() {
    // UNA TANDA ES OTRA ESCRITURA, no la misma repetida. Con los días ya
    // resueltos por `BlockDays`, dos o más van por la ruta atómica.
    if (days && days.length >= 2) {
      $createPerf.mutate({
        project_id: cProject,
        performed_at: days,
        venue_name: cVenue.trim() || null,
        city: cCity.trim() || null,
        status: cStatus as PerformanceCreate['status'],
        line_id: cLine || null,
        bolo_id: cBolo || null,
      });
      return;
    }
    $createPerf.mutate({
      project_id: cProject,
      performed_at: cDay,
      venue_name: cVenue.trim() || null,
      city: cCity.trim() || null,
      status: cStatus as PerformanceCreate['status'],
      line_id: cLine || null,
      bolo_id: cBolo || null,
    });
  }
</script>

<form
  class="pform"
  bind:this={formEl}
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <Select
    label={t('create.project', locale)}
    placeholder={t('create.project_placeholder', locale)}
    options={projectOptions}
    bind:value={cProject}
    required
    disabled={lockProject}
    onchange={() => {
      cLine = '';
      resetBolo();
    }}
  />
  {#snippet boloMessage()}
    {t('perf.bolo_helper_short', locale)}
    <!-- Otra pestaña: el alta a medio escribir no se pierde (Marco, 2026-10-10). -->
    {#if lensOn('books')}
      <a href={booksHref(cProject, { newBolo: true })} target="_blank" rel="noopener"
        >{t('perf.bolo_create_link', locale)}</a
      >
    {/if}
  {/snippet}
  {#if showBoloSelect}
    <Select
      label={t('perf.bolo', locale)}
      options={bolosOptions}
      bind:value={cBolo}
      message={boloMessage}
      onchange={(e) => pickBolo((e.currentTarget as HTMLSelectElement).value)}
    />
  {:else if showBoloEmpty}
    <!-- Quien lee dinero en un proyecto sin bolos: el mismo campo, apagado,
         dice que no hay ninguno y dónde se crea. Misma forma que con bolos,
         así el formulario no salta de sitio. -->
    <Select label={t('perf.bolo', locale)} options={emptyBoloOptions} disabled message={boloMessage} />
  {/if}
  <!-- UN SOLO CONTROL PARA LOS DÍAS. Con la tanda puesta, el tramo de
       `BlockDays` ya dice cuándo, y dejar además este campo sería preguntar
       dos veces lo mismo con dos respuestas posibles. -->
  {#if !isRun}
    <Input label={t('perf.date', locale)} type="date" bind:value={cDay} required />
  {/if}
  <Input
    label={t('create.venue', locale)}
    bind:value={cVenue}
    placeholder={t('perf.venue_placeholder', locale)}
  />
  <Input label={t('create.city', locale)} bind:value={cCity} placeholder={t('perf.optional', locale)} />
  <Select label={t('edit.status', locale)} options={statusOptions} bind:value={cStatus} />
  {#if showHoldNotice}
    <!-- ADR-080 §2 — discreet, hold-only. Empty = default (the placeholder
         says it), 0 = no notice. The native min/max ARE the constraint. -->
    <Field
      id="c-hold-notice"
      label={t('perf.hold_notice', locale)}
      helper={cHoldNotice === 0 ? t('perf.hold_notice_none', locale) : undefined}
    >
      <input
        id="c-hold-notice"
        type="number"
        min="0"
        max="365"
        step="1"
        inputmode="numeric"
        bind:value={cHoldNotice}
        placeholder={String(HOLD_NOTICE_DEFAULT)}
        aria-describedby={cHoldNotice === 0 ? 'c-hold-notice-msg' : undefined}
      />
      {#snippet suffix()}{t('perf.hold_notice_suffix', locale)}{/snippet}
    </Field>
  {/if}
  {#if showLineSelect}
    <Select label={t('create.line', locale)} options={lineOptions} bind:value={cLine} />
  {/if}
  <!-- Hidden submit lets Enter inside an input trigger submit. -->
  <button type="submit" hidden aria-hidden="true"></button>
</form>

<style>
  @layer components {
    .pform {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }
  }
</style>
