<script lang="ts">
  /**
   * Añadir al plan: el alta rápida (ADR-139 p3 A).
   *
   * Un título grande sin caja y, debajo, las propiedades como fichas en una
   * fila: tipo, de quién (proyecto, o persona en una indisponibilidad),
   * cuándo, dónde, la certeza y «más». Cada ficha dice su valor y, pulsada,
   * abre debajo su bloque del esqueleto común Qué · Cuándo · Dónde · Más, el
   * mismo para los ocho tipos (`skeletonFor`): el tipo cambia líneas dentro de
   * un bloque, nunca el orden.
   *
   * DEDUCIR ANTES DE PREGUNTAR: el proyecto sale del ámbito fijado (o del
   * único, o del último usado), el día de la vista (`defaultCreateDay`, lo
   * pasa el Planner), el bolo único propone la sala y la ciudad de la función,
   * el viaje busca su función cercana para el destino y la dirección, y la
   * indisponibilidad propone a quien la marca. Lo deducido solo llena lo vacío.
   *
   * GUARDAR (p7): nada se escribe hasta «Añadir» (o ⌘↵, o Enter en el título).
   * Al crear, el diálogo se cierra y te quedas en el Planner, con un aviso que
   * deja deshacer (y abrir la ficha de una función). Cerrar no tira lo escrito:
   * el borrador vuelve al reabrir, con «Descartar borrador» a la vista.
   *
   * Hora escrita = hora local del espacio del proyecto (ADR-078 §11), y la
   * línea bajo la hora lo dice. Las escrituras son las de siempre
   * (`plan-create`): ninguna migración detrás.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { tick, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON } from '$lib/api';
  import Button from '../Button.svelte';
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import Input from '../Input.svelte';
  import Segmented from '../Segmented.svelte';
  import Select from '../Select.svelte';
  import BlockDays from '../BlockDays.svelte';
  import { addToast } from '../Toast.svelte';
  import { toastCreated } from '$lib/created';
  import { markFresh } from '$lib/fresh.svelte';
  import { dayKeyInTz } from '$lib/planner';
  import { dayMonthYear, viewerTimeZone } from '$lib/datetime';
  import { BLOCK_MAX_DAYS } from '$lib/block';
  import { appLocale, appLocaleTag, t } from '$lib/i18n';
  import {
    activeProjectsQueryOptions,
    allLinesQueryOptions,
    meQueryOptions,
    teamQueryOptions,
    workspacesQueryOptions,
  } from '$lib/nav-queries';
  import { boloDefault, boloOptions, boloPrefill, type BoloLite } from '$lib/bolo-pick';
  import { projectBolosQueryOptions } from '$lib/bolo-queries';
  import { HOLD_NOTICE_DEFAULT } from '$lib/performance';
  import { TRAVEL_DIRECTIONS, invalidateDateFeeds } from '$lib/date';
  import { spaceName } from '$lib/utils/identity';
  import {
    createAvailability,
    createDates,
    createPerformances,
    invalidatePerformanceFeeds,
    undoAvailability,
    undoDates,
    undoPerformances,
    type CreatedPerformance,
  } from '$lib/plan-create';
  import {
    CERTAINTIES,
    QUICK_MORE,
    QUICK_PRIMARY,
    TYPE_LABEL_KEYS,
    afterCreate,
    availabilityBody,
    dateBody,
    deducePerson,
    deduceProject,
    deduceTrip,
    deduceWorkspace,
    draftWritten,
    fillEmpty,
    freshDraft,
    performanceBody,
    planWhen,
    skeletonFor,
    switchType,
    whenLabel,
    type Draft,
    type NearPerformance,
    type QuickType,
  } from '$lib/quick-add';

  interface Props {
    open?: boolean;
    /** The day of the door (a cell's «+») or of the view (`defaultCreateDay`). */
    presetDate?: string | null;
    /** The pinned scope's project (and line), which always wins. */
    presetProjectId?: string | null;
    presetLineId?: string | null;
    /** Open on this type (the toolbar's «unavailable» door). */
    presetType?: QuickType | null;
    /** Typed in ⌘K: it is the title, over a leftover draft's. */
    presetTitle?: string | null;
    /** The pinned scope's one space, for an unavailability. */
    presetWorkspaceId?: string | null;
    /** The availability and team feeds answer: an unavailability can be
        written. Without them the type stays, said, but cannot be picked. */
    canUnavailable?: boolean;
    /** «Abrir» on the notice after a performance: its page. */
    onOpenPerformance?: (perf: CreatedPerformance) => void;
  }

  let {
    open = $bindable(false),
    presetDate = null,
    presetProjectId = null,
    presetLineId = null,
    presetType = null,
    presetTitle = null,
    presetWorkspaceId = null,
    canUnavailable = true,
    onOpenPerformance,
  }: Props = $props();

  const locale = appLocale();
  const tag = appLocaleTag();
  const viewerTz = viewerTimeZone();
  const queryClient = useQueryClient();
  const uid = $props.id();
  const LAST_PROJECT_KEY = 'hour.quick-add.project';

  const todayIso = () => dayKeyInTz(new Date().toISOString(), viewerTz);

  /** THE DRAFT: one object, kept across a close (ADR-139 p7, «aquí sí»). */
  let d = $state<Draft>(freshDraft(todayIso()));
  /** What the person set by hand, so a deduction never overwrites it. */
  let touched = $state({ day: false, direction: false, person: false });
  /** A deduction runs once per what it reads. */
  let seeded = $state({ bolo: '', trip: '', person: '' });

  type Panel = 'type' | 'owner' | 'when' | 'where' | 'more';
  let panel = $state<Panel | null>(null);
  /** The person tried to save: now the span's limit and the errors speak. */
  let checked = $state(false);
  let errors = $state<Partial<Record<'project' | 'workspace' | 'day' | 'until' | 'end' | 'repeat', string>>>({});

  let sk = $derived(skeletonFor(d.type));
  /** Something was typed or picked here since the draft began: a guess
      (the trip's city, the bolo's venue) alone is not a draft. */
  let typed = $state(false);
  let written = $derived(typed && draftWritten(d));

  // ── Data ───────────────────────────────────────────────────────────────
  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const meQuery = createQuery(meQueryOptions());

  let workspaces = $derived($workspacesQuery.data?.items ?? []);
  let projects = $derived($projectsQuery.data?.items ?? []);
  let project = $derived(projects.find((p) => p.id === d.project) ?? null);
  let projectOptions = $derived(projects.map((p) => ({ value: p.id, label: p.name })));
  let projectLines = $derived(($linesQuery.data?.items ?? []).filter((l) => l.project?.id === d.project));
  let lineOptions = $derived([
    { value: '', label: t('create.line_none', locale) },
    ...projectLines.map((l) => ({ value: l.id, label: l.name })),
  ]);
  let showLine = $derived(sk.more.line && !presetLineId && projectLines.length > 0);

  /** The clock an hour is typed in: the project's space (ADR-078 §11). */
  let entryTz = $derived(
    workspaces.find((w) => w.id === (project?.workspace_id ?? d.workspace))?.timezone || viewerTz,
  );

  // The team, for an unavailability: who can be marked (cast ∪ crew).
  const teamQuery = createQuery(
    toStore(() =>
      teamQueryOptions(
        workspaces.map((w) => w.id),
        { enabled: open && d.type === 'unavailable' },
      ),
    ),
  );
  let teamOfSpace = $derived(($teamQuery.data?.items ?? []).filter((m) => m.workspace_id === d.workspace));
  let workspaceOptions = $derived(workspaces.map((w) => ({ value: w.id, label: spaceName(w.name) })));
  let personOptions = $derived([
    { value: '', label: t('blackout.person_company', locale) },
    ...teamOfSpace.map((m) => ({ value: m.person_id, label: m.full_name })),
  ]);

  // The project's performances: a trip's destination, a date's link.
  const nearQuery = createQuery(
    toStore(() => {
      const id = d.project;
      return {
        queryKey: ['project-performances', id] as const,
        enabled: open && Boolean(id) && d.type !== 'performance' && d.type !== 'unavailable',
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchJSON<{ items: NearPerformance[] }>(`/api/performances?project_ids=${id}&status=any&limit=200`, signal),
      };
    }),
  );
  let nearPerfs = $derived($nearQuery.data?.items ?? []);
  let attachOptions = $derived([
    { value: '', label: t('create.attach_none', locale) },
    ...nearPerfs.map((p) => ({
      value: p.id,
      label: `${dayMonthYear(p.performed_at)} · ${p.venue_name ?? p.city ?? '—'}`,
    })),
  ]);
  let showAttach = $derived(sk.more.attach && nearPerfs.length > 0);

  // A performance hangs from its deal (ADR-087): the bolos of the project.
  const bolosQuery = createQuery(
    toStore(() => projectBolosQueryOptions(d.project, open && d.type === 'performance')),
  );
  let bolos = $derived<BoloLite[]>($bolosQuery.data?.items ?? []);
  let bolosOpts = $derived(boloOptions(bolos, locale));
  let showBolo = $derived(sk.more.bolo && bolosOpts.length > 1);

  // «Otros»: its labels are the space's own usage (ADR-078 §8).
  const labelsQuery = createQuery(
    toStore(() => {
      const ws = project?.workspace_id ?? '';
      return {
        queryKey: ['date-labels', ws] as const,
        enabled: open && d.type === 'other' && Boolean(ws),
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          try {
            return await fetchJSON<{ labels: string[] }>(`/api/dates/labels?workspace_ids=${ws}`, signal);
          } catch (err) {
            if (err instanceof Error && err.message === 'Unauthorized') throw err;
            return { labels: [] as string[] };
          }
        },
      };
    }),
  );
  let labelSuggestions = $derived($labelsQuery.data?.labels ?? []);

  // ── Opening: a fresh draft, or the one that was left ────────────────────
  function lastProject(): string | null {
    try {
      return localStorage.getItem(LAST_PROJECT_KEY);
    } catch {
      return null;
    }
  }
  function rememberProject(id: string) {
    try {
      localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
      /* a private window: the next add asks again */
    }
  }

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      if (!(typed && draftWritten(d))) {
        d = freshDraft(presetDate ?? todayIso(), presetType ?? 'performance');
        touched = { day: false, direction: false, person: false };
        seeded = { bolo: '', trip: '', person: '' };
        typed = false;
      } else {
        if (presetType && presetType !== d.type) d = switchType(d, presetType);
        if (!touched.day && presetDate) d.when.day = presetDate;
      }
      // The pinned scope says whose this is, draft or not: a leftover project
      // must never put a date into another scope (review 2026-07-12).
      if (presetProjectId) {
        d.project = presetProjectId;
        d.line = presetLineId ?? '';
      }
      // What was typed to ask for this is written, not deduced: it wins, and
      // it is a draft from now on.
      if (presetTitle?.trim()) {
        d.title = presetTitle.trim();
        typed = true;
      }
      panel = null;
      checked = false;
      errors = {};
    }
    wasOpen = open;
  });

  // The project, once the list is there: deduce, never overwrite.
  $effect(() => {
    if (!open || d.project || projects.length === 0) return;
    d.project = deduceProject({
      preset: presetProjectId,
      projectIds: projects.map((p) => p.id),
      last: lastProject(),
    });
  });

  // An unavailability: its space (the project's, the scope's, the only one)
  // and its person (whoever marks it, if on that team).
  $effect(() => {
    if (!open || d.type !== 'unavailable') return;
    const ws = deduceWorkspace({
      projectWorkspace: project?.workspace_id ?? null,
      preset: presetWorkspaceId,
      workspaceIds: workspaces.map((w) => w.id),
    });
    if (!d.workspace && ws) d.workspace = ws;
  });
  $effect(() => {
    if (!open || d.type !== 'unavailable' || touched.person || !$teamQuery.isSuccess) return;
    if (seeded.person === d.workspace) return;
    seeded.person = d.workspace;
    d.person = deducePerson($meQuery.data?.person_id ?? null, teamOfSpace, d.workspace);
  });

  // A performance: one open bolo is proposed, and brings its venue and city.
  $effect(() => {
    if (!open || d.type !== 'performance' || !d.project || !$bolosQuery.isSuccess) return;
    if (seeded.bolo === d.project) return;
    seeded.bolo = d.project;
    d.bolo = boloDefault(bolos);
    if (d.bolo) pickBolo(d.bolo);
  });

  function pickBolo(id: string) {
    const filled = boloPrefill(
      bolos.find((b) => b.id === id),
      { venue: d.title, city: d.city },
    );
    d.title = filled.venue;
    d.city = filled.city;
  }

  // A trip goes to a performance or comes back from one: the nearest says
  // where to, and which way. Again whenever the day or the project moves.
  let tripGuess = $derived(d.type === 'travel_day' ? deduceTrip(d.when.day, nearPerfs) : null);
  $effect(() => {
    if (!open || d.type !== 'travel_day' || !$nearQuery.isSuccess) return;
    const key = `${d.project}|${d.when.day}`;
    if (seeded.trip === key) return;
    seeded.trip = key;
    if (!tripGuess) return;
    const filled = fillEmpty(
      { origin: d.origin, city: d.city, performance: d.performance },
      { origin: tripGuess.origin, city: tripGuess.destination, performance: tripGuess.performance_id },
    );
    d.origin = filled.origin;
    d.city = filled.city;
    d.performance = filled.performance;
    if (!touched.direction) d.direction = tripGuess.direction;
  });
  let tripHint = $derived.by(() => {
    if (!tripGuess || d.performance !== tripGuess.performance_id) return '';
    const p = nearPerfs.find((x) => x.id === tripGuess!.performance_id);
    if (!p?.city) return '';
    const key = tripGuess.direction === 'return' ? 'qa.trip_hint_return' : 'qa.trip_hint';
    return t(key, locale, { day: dayMonthYear(p.performed_at), city: p.city });
  });

  /** A date linked to a performance takes its city, if it has none. */
  function pickAttach(id: string) {
    const p = nearPerfs.find((x) => x.id === id);
    if (p?.city && !d.city.trim()) d.city = p.city;
  }

  // ── The chips ──────────────────────────────────────────────────────────
  let typeLabel = $derived(t(TYPE_LABEL_KEYS[d.type], locale));
  let ownerLabel = $derived.by(() => {
    if (sk.owner === 'person') {
      const who = d.person ? teamOfSpace.find((m) => m.person_id === d.person)?.full_name : null;
      const name = who ?? t('blackout.person_company', locale);
      const ws = workspaces.length > 1 ? workspaces.find((w) => w.id === d.workspace) : null;
      return ws ? `${name} · ${spaceName(ws.name)}` : name;
    }
    return project?.name ?? '';
  });
  let whenText = $derived(whenLabel(d.type, d.when, tag, t('block.days_unit', locale)));
  let whereText = $derived.by(() => {
    if (sk.where === 'trip') {
      if (!d.origin.trim() && !d.city.trim()) return '';
      const dir = t(`create.direction_${d.direction}`, locale).toLowerCase();
      return `${d.origin.trim() || '…'} → ${d.city.trim() || '…'} · ${dir}`;
    }
    if (sk.where === 'venue') return d.city.trim();
    if (sk.where === 'place') return [d.venue.trim(), d.city.trim()].filter(Boolean).join(', ');
    return '';
  });
  let hasMore = $derived(
    showLine || showAttach || sk.more.label || (sk.more.rank && d.certainty === 'option'),
  );

  let typeOptions = $derived(
    [...QUICK_PRIMARY, ...QUICK_MORE].map((key) => ({
      value: key as QuickType,
      label: t(TYPE_LABEL_KEYS[key], locale),
      disabled: key === 'unavailable' && !canUnavailable && d.type !== 'unavailable',
    })),
  );

  let panelEl: HTMLDivElement | undefined = $state();

  async function toggle(next: Panel) {
    panel = panel === next ? null : next;
    if (!panel) return;
    await tick();
    panelEl?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus();
  }

  function setType(next: QuickType) {
    d = switchType(d, next);
    errors = {};
  }

  // ── Cuándo ─────────────────────────────────────────────────────────────
  function addHours() {
    d.when.timed = true;
  }
  function addUntil() {
    d.when.until_on = true;
  }
  function addRepeat() {
    d.when.until_on = true;
    d.when.repeat = true;
  }
  // A word under a field goes as soon as its field changes.
  $effect(() => {
    void d.when.day;
    void d.when.until;
    void d.when.start;
    void d.when.end;
    void d.when.weekdays.length;
    void d.when.repeat;
    untrack(() => {
      errors.day = errors.until = errors.end = errors.repeat = undefined;
    });
  });
  $effect(() => {
    void d.project;
    void d.workspace;
    untrack(() => {
      errors.project = errors.workspace = undefined;
    });
  });

  // ── Saving ─────────────────────────────────────────────────────────────
  /** `made`: the cards this write draws, marked fresh in the Planner. */
  type Done = { what: string; day: string; undo: () => Promise<unknown>; perf?: CreatedPerformance; made: string[] };

  const save = createMutation({
    mutationFn: async (draft: Draft): Promise<Done> => {
      const plan = planWhen(draft.type, draft.when, entryTz);
      if (plan.shape === 'error') throw new Error(plan.error.key);
      const what = t(TYPE_LABEL_KEYS[draft.type], locale);
      const first = plan.days[0] ?? draft.when.day;
      const last = plan.shape === 'range' ? plan.to : (plan.days[plan.days.length - 1] ?? first);
      const day = last > first ? `${dayMonthYear(first)} – ${dayMonthYear(last)}` : dayMonthYear(first);
      if (plan.shape === 'range') {
        const id = await createAvailability(availabilityBody(draft, plan));
        return { what, day, undo: async () => (id ? undoAvailability(id, queryClient) : undefined), made: [] };
      }
      if (draft.type === 'performance') {
        const { rows, noticeFailed } = await createPerformances(performanceBody(draft, plan), draft.notice);
        if (noticeFailed) addToast({ tone: 'warning', message: t('perf.hold_notice_not_saved', locale) });
        const made = rows.map((r) => r.id);
        return { what, day, undo: () => undoPerformances(made, queryClient), perf: rows[0], made };
      }
      const ids = await createDates(dateBody(draft, plan));
      return { what, day, undo: () => undoDates(ids, queryClient), made: ids };
    },
    onSuccess: (done, draft) => {
      if (draft.type === 'unavailable') void queryClient.invalidateQueries({ queryKey: ['planner-availability'] });
      else if (draft.type === 'performance') void invalidatePerformanceFeeds(queryClient);
      else invalidateDateFeeds(queryClient);
      if (draft.project) rememberProject(draft.project);
      markFresh(done.made);
      toastCreated({
        locale,
        message: t('create.added', locale, { what: done.what, day: done.day }),
        undo: done.undo,
        open: done.perf && onOpenPerformance ? () => onOpenPerformance(done.perf!) : undefined,
      });
      d = afterCreate(d);
      typed = false;
      touched = { day: true, direction: false, person: touched.person };
      seeded = { bolo: '', trip: '', person: seeded.person };
      open = false;
    },
    onError: (err) => {
      // Graceful absence: a body the server refuses is said; a feature that
      // is not there yet (a 502 before its migration) stays quiet.
      const shown = !(err instanceof ApiError) || err.status === 400 || err.status === 403;
      if (!shown) console.warn('[planner] create failed (feature absent?):', err);
      addToast({
        tone: 'danger',
        title: t('create.not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  async function submit() {
    checked = true;
    errors = {};
    if (sk.owner === 'project' && !d.project) {
      errors.project = t('create.pick_project', locale);
      panel = 'owner';
    } else if (sk.owner === 'person' && !d.workspace) {
      errors.workspace = t('blackout.pick_space', locale);
      panel = 'owner';
    } else {
      const plan = planWhen(d.type, d.when, entryTz);
      if (plan.shape === 'error') {
        errors[plan.error.field] = t(plan.error.key, locale, { max: String(BLOCK_MAX_DAYS) });
        panel = 'when';
      } else {
        $save.mutate($state.snapshot(d) as Draft);
        return;
      }
    }
    await tick();
    panelEl?.querySelector<HTMLElement>('[aria-invalid="true"], .field--error input, .field--error select')?.focus();
  }

  function discard() {
    d = freshDraft(presetDate ?? d.when.day, presetType ?? 'performance');
    if (presetProjectId) {
      d.project = presetProjectId;
      d.line = presetLineId ?? '';
    }
    touched = { day: false, direction: false, person: false };
    seeded = { bolo: '', trip: '', person: '' };
    typed = false;
    panel = null;
    checked = false;
    errors = {};
  }

  let titlePlaceholder = $derived(
    sk.title === 'venue'
      ? t('qa.title_venue', locale)
      : sk.title === 'note'
        ? t('qa.title_note', locale)
        : t('qa.title_title', locale, { what: typeLabel }),
  );
  let certaintyOptions = $derived(
    CERTAINTIES.map((c) => ({ value: c, label: t(c === 'option' ? 'qa.option' : 'qa.confirmed', locale) })),
  );
  let rankOptions = $derived(
    (['', '1', '2', '3'] as const).map((r) => ({
      value: r,
      label: t(r ? `perf.status_hold_${r}` : 'perf.status_hold', locale),
    })),
  );
  const chipId = (p: Panel) => `${uid}-chip-${p}`;
  const panelId = `${uid}-panel`;
</script>

<Dialog bind:open title={t('create.title', locale)} size="m" keepsDraft>
  <form
    class="qa"
    novalidate
    oninput={() => (typed = true)}
    onchange={() => (typed = true)}
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <!-- QUÉ: one line of free text. What it writes depends on the type
         (`skeletonFor().title`); a line that reads «ensayo jue 10-14 Mercat»
         will later split it into the chips below. -->
    <input
      id="{uid}-title"
      class="qa__title"
      type="text"
      autocomplete="off"
      aria-label={t('qa.what', locale)}
      placeholder={titlePlaceholder}
      bind:value={d.title}
    />

    <div class="qa__chips">
      <button
        type="button"
        id={chipId('type')}
        data-chip="type"
        class="qa__chip"
        aria-expanded={panel === 'type'}
        aria-controls={panelId}
        onclick={() => toggle('type')}
      >
        <span class="qa__key">{t('create.type_label', locale)}</span>{typeLabel}
      </button>

      <button
        type="button"
        id={chipId('owner')}
        data-chip="owner"
        class="qa__chip"
        class:qa__chip--empty={!ownerLabel}
        class:qa__chip--error={Boolean(errors.project || errors.workspace)}
        aria-expanded={panel === 'owner'}
        aria-controls={panelId}
        onclick={() => toggle('owner')}
      >
        {#if sk.owner === 'person'}<span class="qa__key">{t('qa.who', locale)}</span>{/if}
        {ownerLabel || t('qa.project_empty', locale)}
      </button>

      <button
        type="button"
        id={chipId('when')}
        data-chip="when"
        class="qa__chip"
        class:qa__chip--error={Boolean(errors.day || errors.until || errors.end || errors.repeat)}
        aria-expanded={panel === 'when'}
        aria-controls={panelId}
        onclick={() => toggle('when')}
      >
        <span class="qa__key">{t('qa.when', locale)}</span>{whenText}
      </button>

      {#if sk.where !== 'none'}
        <button
          type="button"
          id={chipId('where')}
        data-chip="where"
          class="qa__chip"
          class:qa__chip--empty={!whereText}
          aria-expanded={panel === 'where'}
          aria-controls={panelId}
          onclick={() => toggle('where')}
        >
          {whereText || t('qa.where_empty', locale)}
        </button>
      {/if}

      <Segmented ariaLabel={t('qa.certainty', locale)} options={certaintyOptions} bind:value={d.certainty} />

      {#if hasMore}
        <button
          type="button"
          id={chipId('more')}
        data-chip="more"
          class="qa__chip qa__chip--empty"
          aria-expanded={panel === 'more'}
          aria-controls={panelId}
          onclick={() => toggle('more')}
        >
          {t('qa.more_chip', locale)}
        </button>
      {/if}
    </div>

    {#if panel}
      <div class="qa__panel" id={panelId} role="group" aria-labelledby={chipId(panel)} bind:this={panelEl}>
        {#if panel === 'type'}
          <Segmented
            label={t('create.type_label', locale)}
            options={typeOptions}
            value={d.type}
            onchange={setType}
            helper={!canUnavailable ? t('qa.unavailable_absent', locale) : undefined}
          />
        {:else if panel === 'owner'}
          {#if sk.owner === 'project'}
            <Select
              label={t('create.project', locale)}
              placeholder={t('create.project_placeholder', locale)}
              options={projectOptions}
              bind:value={d.project}
              error={errors.project}
              onchange={() => {
                d.line = '';
                d.performance = '';
                d.bolo = '';
              }}
            />
          {:else}
            {#if workspaces.length > 1}
              <Select
                label={t('blackout.space', locale)}
                placeholder={t('blackout.space_placeholder', locale)}
                options={workspaceOptions}
                bind:value={d.workspace}
                error={errors.workspace}
                onchange={() => {
                  d.person = '';
                  touched.person = false;
                }}
              />
            {/if}
            <Select
              label={t('blackout.person', locale)}
              options={personOptions}
              bind:value={d.person}
              onchange={() => (touched.person = true)}
            />
          {/if}
        {:else if panel === 'when'}
          <Input
            label={sk.when.untilOpen || d.when.until_on ? t('blackout.from', locale) : t('qa.day', locale)}
            type="date"
            bind:value={d.when.day}
            error={errors.day}
            onchange={() => (touched.day = true)}
          />
          {#if sk.when.hours && d.when.timed}
            <Field id="{uid}-start" label={t('qa.hours', locale)} error={errors.end} helper={t('create.time_hint_tz', locale, { tz: entryTz })}>
              <input
                id="{uid}-start"
                type="time"
                aria-label={t('qa.start', locale)}
                bind:value={d.when.start}
              />
              <span class="qa__dash" aria-hidden="true">–</span>
              <input id="{uid}-end" type="time" aria-label={t('qa.end', locale)} bind:value={d.when.end} />
              {#snippet suffix()}
                <button type="button" class="btn--quiet btn--xs" onclick={() => (d.when.timed = false)}
                  >{t('qa.remove_hours', locale)}</button
                >
              {/snippet}
            </Field>
          {/if}
          {#if d.when.until_on}
            <Input
              label={t('qa.until', locale)}
              type="date"
              bind:value={d.when.until}
              min={d.when.day}
              error={errors.until}
            />
          {/if}
          {#if d.when.repeat && sk.when.repeat && d.when.until_on}
            <BlockDays
              from={d.when.day}
              to={d.when.until}
              bind:weekdays={d.when.weekdays}
              bind:exceptions={d.when.exceptions}
              locale={tag}
              {checked}
              labels={{
                weekdays: t('qa.weekdays', locale),
                pickSpan: t('block.pick_span', locale),
                daysUnit: t('block.days_unit', locale),
                tooFew: t('block.too_few', locale),
                tooMany: t('block.too_many', locale, { max: String(BLOCK_MAX_DAYS) }),
                removed: (n: number) => t('block.removed', locale, { n: String(n) }),
              }}
            />
            {#if errors.repeat}<p class="qa__error" role="alert">{errors.repeat}</p>{/if}
          {/if}
          <div class="qa__adds">
            {#if sk.when.hours && !d.when.timed}
              <button type="button" class="btn--quiet btn--xs" onclick={addHours}>{t('qa.add_hour', locale)}</button>
            {/if}
            {#if !d.when.until_on}
              <button type="button" class="btn--quiet btn--xs" onclick={addUntil}>{t('qa.add_until', locale)}</button>
            {:else if !sk.when.untilOpen}
              <button
                type="button"
                class="btn--quiet btn--xs"
                onclick={() => {
                  d.when.until_on = false;
                  d.when.until = '';
                  d.when.repeat = false;
                }}>{t('qa.remove_until', locale)}</button
              >
            {/if}
            {#if sk.when.repeat && !d.when.repeat}
              <button type="button" class="btn--quiet btn--xs" onclick={addRepeat}>{t('qa.add_repeat', locale)}</button>
            {:else if sk.when.repeat}
              <button
                type="button"
                class="btn--quiet btn--xs"
                onclick={() => {
                  d.when.repeat = false;
                  d.when.exceptions = [];
                }}>{t('qa.remove_repeat', locale)}</button
              >
            {/if}
          </div>
        {:else if panel === 'where'}
          {#if sk.where === 'trip'}
            <Input label={t('create.trip_from', locale)} bind:value={d.origin} autocomplete="off" />
            <Input
              label={t('create.trip_to', locale)}
              bind:value={d.city}
              autocomplete="off"
              helper={tripHint || undefined}
            />
            <Segmented
              label={t('create.direction', locale)}
              options={TRAVEL_DIRECTIONS.map((dir) => ({ value: dir, label: t(`create.direction_${dir}`, locale) }))}
              bind:value={d.direction}
              onchange={() => (touched.direction = true)}
            />
          {:else}
            {#if sk.where === 'place'}
              <Input label={t('create.venue', locale)} bind:value={d.venue} />
            {/if}
            {#if showBolo}
              <Select
                label={t('perf.bolo', locale)}
                options={bolosOpts}
                bind:value={d.bolo}
                helper={t('perf.bolo_helper_short', locale)}
                onchange={(e) => pickBolo((e.currentTarget as HTMLSelectElement).value)}
              />
            {/if}
            <Input label={t('create.city', locale)} bind:value={d.city} />
          {/if}
        {:else if panel === 'more'}
          {#if sk.more.rank && d.certainty === 'option'}
            <Segmented label={t('qa.rank', locale)} options={rankOptions} bind:value={d.rank} />
            <Field
              id="{uid}-notice"
              label={t('perf.hold_notice', locale)}
              helper={d.notice === 0 ? t('perf.hold_notice_none', locale) : undefined}
            >
              <input
                id="{uid}-notice"
                type="number"
                min="0"
                max="365"
                step="1"
                inputmode="numeric"
                bind:value={d.notice}
                placeholder={String(HOLD_NOTICE_DEFAULT)}
              />
              {#snippet suffix()}{t('perf.hold_notice_suffix', locale)}{/snippet}
            </Field>
          {/if}
          {#if sk.more.label}
            <Input label={t('create.label', locale)} bind:value={d.label} list="{uid}-labels" autocomplete="off" />
            <datalist id="{uid}-labels">
              {#each labelSuggestions as suggestion (suggestion)}
                <option value={suggestion}></option>
              {/each}
            </datalist>
          {/if}
          {#if showAttach}
            <Select
              label={t('create.attach', locale)}
              options={attachOptions}
              bind:value={d.performance}
              onchange={(e) => pickAttach((e.currentTarget as HTMLSelectElement).value)}
            />
          {/if}
          {#if showLine}
            <Select label={t('create.line', locale)} options={lineOptions} bind:value={d.line} />
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Enter in the title adds, like ⌘↵ anywhere. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet lead()}
    {#if written}
      <Button variant="quiet" tone="warn" onclick={discard}>{t('qa.discard', locale)}</Button>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('qa.close', locale)}</Button>
    <Button onclick={() => void submit()} loading={$save.isPending}>
      {t('qa.add', locale)}<kbd class="qa__kbd" aria-hidden="true">⌘↵</kbd>
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .qa {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* QUÉ: the big line without a box. One hairline under it, the field's,
       that takes the focus colour while typing. */
    .qa__title {
      inline-size: 100%;
      padding-block: var(--space-xs);
      padding-inline: 0;
      border: 0;
      border-block-end: var(--field-line-width) solid var(--field-line);
      border-radius: 0;
      background: transparent;
      color: var(--heading-color);
      font-size: var(--text-l);
      outline: none;
    }
    .qa__title::placeholder {
      color: var(--text-faint);
    }
    .qa__title:focus,
    .qa__title:focus-visible {
      border-block-end-color: var(--field-line-focus);
      box-shadow: 0 var(--field-line-width) 0 var(--field-line-focus);
    }

    /* The properties as chips in one row: they wrap on a phone, they never
       scroll sideways. */
    .qa__chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs);
    }

    .qa__chip {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-2xs);
      min-block-size: var(--touch-target);
      padding-block: var(--space-2xs);
      padding-inline: var(--space-s);
      border: var(--border-size) solid var(--border-color-light);
      border-radius: var(--radius-circle);
      background: transparent;
      color: var(--text-color);
      font: inherit;
      font-size: var(--text-s);
      white-space: nowrap;
      cursor: pointer;
      transition:
        border-color var(--transition),
        background var(--transition);
    }
    @media (hover: hover) and (pointer: fine) {
      .qa__chip:hover {
        border-color: var(--border-color-dark);
      }
    }
    .qa__chip[aria-expanded='true'] {
      background: var(--seg-on);
      border-color: var(--border-color-dark);
      box-shadow: var(--box-shadow-1);
    }
    .qa__chip:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: var(--focus-offset);
    }
    /* Nothing said yet: the property's name, faint, on a dashed edge. */
    .qa__chip--empty {
      color: var(--text-faint);
      border-style: dashed;
      border-color: var(--border-color-dark);
    }
    .qa__chip--error {
      border-color: var(--danger);
      color: var(--danger-dark);
    }
    /* The certainty is a chip too: the Segmented's track as a pill, the
       chosen word raised, at the chips' height. */
    .qa__chips :global(.seg) {
      padding: 0;
      gap: 0;
      border-radius: var(--radius-circle);
    }
    .qa__chips :global(.seg__opt) {
      padding-block: var(--space-2xs);
      border-radius: var(--radius-circle);
    }

    /* The mono key the field rows use, small, before the value. */
    .qa__key {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* The block a chip opens: rows of the skeleton, under the chips. */
    .qa__panel {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      padding-block-start: var(--space-xs);
    }

    .qa__adds {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
    }

    .qa__dash {
      color: var(--text-faint);
    }

    .qa__error {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--danger-dark);
    }

    .qa__kbd {
      margin-inline-start: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      opacity: var(--disabled-opacity);
    }
    /* A phone has no ⌘. */
    @media (pointer: coarse) {
      .qa__kbd {
        display: none;
      }
    }
  }
</style>
