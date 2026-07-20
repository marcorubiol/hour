<script module lang="ts">
  /**
   * Unified calendar create dialog (ADR-078 §1) — every "+" on the
   * calendar (toolbar and day cells) opens THIS. The type pill drives the
   * form: Actuació mounts the shared PerformanceForm (one home for "how a
   * gig is created"); every other pill creates a `date` row through
   * POST /api/dates with the kind-specific fields of the contract
   * (historical contract: build/archive/2026-07-calendar-v2-api-contract.md §2).
   *
   * Timezone rule (ADR-078 §11): a typed hour is VENUE-LOCAL. The date
   * form converts wall time through the selected project's workspace
   * timezone (the fallback — free-text venues carry no zone) and SAYS so
   * under the fields: "local time at {city}" when a city is typed, the
   * workspace zone otherwise. All-day rows are calendar dates, not
   * instants: they store UTC-anchored midnight so `starts_at.slice(0,10)`
   * is the picked day everywhere (MonthGrid bucketing, awayBands).
   *
   * The quiet footer-left action switches to the blackout dialog (the
   * parent orchestrates: closes this, opens that). It hides itself while
   * the availability/team feeds are absent (contract § Graceful absence).
   */
  export const EVENT_TYPE_KEYS = [
    'performance',
    'rehearsal',
    'travel_day',
    'day_off',
    'residency',
    'press',
    'other',
  ] as const;
  export type EventTypeKey = (typeof EVENT_TYPE_KEYS)[number];
</script>

<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Button from '../Button.svelte';
  import Checkbox from '../Checkbox.svelte';
  import Dialog from '../Dialog.svelte';
  import Input from '../Input.svelte';
  import Pill from '../Pill.svelte';
  import Select from '../Select.svelte';
  import { addToast } from '../Toast.svelte';
  import PerformanceForm, { type CreatedPerformance } from '../PerformanceForm.svelte';
  import BlockDays from '../BlockDays.svelte';
  import { blockDays, blockLimit, BLOCK_MAX_DAYS } from '$lib/block';
  import { dayKeyInTz } from '$lib/planner';
  import { dayMonthYear, wallClockToInstant } from '$lib/datetime';
  import { detectLocale, t } from '$lib/i18n';
  import { activeProjectsQueryOptions, allLinesQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { TRAVEL_DIRECTIONS, type DateRow, type TravelDirection } from '$lib/date';

  interface Props {
    open?: boolean;
    /** ISO day to prefill (a day cell's "+"); defaults to today. */
    presetDate?: string | null;
    /** Scope presets — same semantics as PerformanceCreateDialog. */
    presetProjectId?: string | null;
    presetLineId?: string | null;
    /** Blackout entry (footer-left) — hidden while the feeds are absent. */
    showBlackoutAction?: boolean;
    onBlackout?: () => void;
    onCreatedPerformance?: (perf: CreatedPerformance) => void;
  }

  let {
    open = $bindable(false),
    presetDate = null,
    presetProjectId = null,
    presetLineId = null,
    showBlackoutAction = false,
    onBlackout,
    onCreatedPerformance,
  }: Props = $props();

  const locale = detectLocale(navigator.language);
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const queryClient = useQueryClient();

  const TYPE_LABEL_KEYS: Record<EventTypeKey, string> = {
    performance: 'create.type_performance',
    rehearsal: 'create.type_rehearsal',
    travel_day: 'create.type_travel',
    day_off: 'create.type_day_off',
    residency: 'create.type_residency',
    press: 'create.type_press',
    other: 'create.type_other',
  };

  /** Day-level kinds open in all-day mode; timed kinds with a clock. */
  const ALL_DAY_DEFAULT: Record<string, boolean> = {
    travel_day: true,
    day_off: true,
    residency: true,
  };

  let type = $state<EventTypeKey>('performance');

  // ── Performance branch — the shared form owns everything. ────────────
  let perfForm: { submit: () => void } | undefined = $state();
  let perfPending = $state(false);

  function handlePerfCreated(perf: CreatedPerformance) {
    open = false;
    onCreatedPerformance?.(perf);
  }

  // ── Date branch state ─────────────────────────────────────────────────
  let dProject = $state('');
  let dLine = $state('');
  let dPerformance = $state('');
  let dTitle = $state('');
  let dVenue = $state('');
  let dCity = $state('');
  let dLabel = $state('');
  let dAllDay = $state(false);
  let dDay = $state(''); // all-day start (date)
  let dEndDay = $state(''); // all-day end (date, optional)
  // ADR-084 §1 — CARDINALITY, not a type: a five-week run of rehearsals is
  // still a rehearsal, so the pill above stays the kind and this only says
  // how many days it covers (Marco, 2026-07-20).
  let dMulti = $state(false);
  let dFrom = $state('');
  let dTo = $state('');
  let dWeekdays = $state<number[]>([0, 1, 2, 3, 4, 5, 6]);
  let dExceptions = $state<string[]>([]);
  let dStartTime = $state('10:00');
  let dEndTime = $state('');
  let dStartWall = $state(''); // timed start (datetime-local)
  let dEndWall = $state(''); // timed end (datetime-local, optional)
  let dOption = $state(false); // ADR-078 §9 — on ⇒ tentative, off ⇒ confirmed
  let dDirection = $state<TravelDirection>('outbound');

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let projects = $derived($projectsQuery.data?.items ?? []);
  let projectOptions = $derived(projects.map((p) => ({ value: p.id, label: p.name })));

  let projectLines = $derived(
    ($linesQuery.data?.items ?? []).filter((l) => l.project?.id === dProject),
  );
  let lineOptions = $derived([
    { value: '', label: t('create.line_none', locale) },
    ...projectLines.map((l) => ({ value: l.id, label: l.name })),
  ]);
  let showLineSelect = $derived(!presetLineId && projectLines.length > 0);

  // Third cascade level (ADR-078 §1): a date can hang from a performance
  // of ITS project. Fetched per project, not month-bound.
  type AttachPerf = {
    id: string;
    slug: string | null;
    performed_at: string;
    venue_name: string | null;
    city: string | null;
  };
  const attachOptionsStore = toStore(() => {
    const project = dProject;
    return {
      queryKey: ['project-performances', project] as const,
      enabled: open && type !== 'performance' && Boolean(project),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: AttachPerf[] }>(
          `/api/performances?project_ids=${project}&status=any&limit=200`,
          signal,
        ),
    };
  });
  const attachQuery = createQuery(attachOptionsStore);
  let attachOptions = $derived([
    { value: '', label: t('create.attach_none', locale) },
    ...($attachQuery.data?.items ?? []).map((p) => ({
      value: p.id,
      label: `${dayMonthYear(p.performed_at)} · ${p.venue_name ?? p.city ?? '—'}`,
    })),
  ]);

  // "Altres" label autocomplete — the corpus IS the workspace's usage
  // history (ADR-078 §8). Fails quiet: no labels, no feature.
  let projectWorkspaceId = $derived(projects.find((p) => p.id === dProject)?.workspace_id ?? '');
  const labelsStore = toStore(() => {
    const ws = projectWorkspaceId;
    return {
      queryKey: ['date-labels', ws] as const,
      enabled: open && type === 'other' && Boolean(ws),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ labels: string[] }>(
            `/api/dates/labels?workspace_ids=${ws}`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] labels feed absent:', err);
          return { labels: [] as string[] };
        }
      },
    };
  });
  const labelsQuery = createQuery(labelsStore);
  let labelSuggestions = $derived($labelsQuery.data?.labels ?? []);

  // ── Time entry rule (ADR-078 §11) ─────────────────────────────────────
  // Free-text venues/cities carry no zone, so the conversion always falls
  // back to the project's workspace timezone — and the hint must say THAT
  // zone, visibly. Never claim city-local time here: this dialog resolves
  // no venue timezone, and a false "local time at {city}" label would
  // re-open the exact timezone bug §11 closed.
  let entryTz = $derived(
    ($workspacesQuery.data?.items ?? []).find((w) => w.id === projectWorkspaceId)?.timezone ||
      viewerTz,
  );
  let timeHint = $derived(t('create.time_hint_tz', locale, { tz: entryTz }));

  function setType(next: EventTypeKey) {
    if (type === next) return;
    type = next;
    if (next !== 'performance') dAllDay = ALL_DAY_DEFAULT[next] ?? false;
  }

  function toggleAllDay() {
    // Keep the picked day when the mode flips.
    if (dAllDay) {
      if (dStartWall) dDay = dStartWall.slice(0, 10);
      if (dEndWall) dEndDay = dEndWall.slice(0, 10);
    } else {
      if (dDay) dStartWall = `${dDay}T10:00`;
      dEndWall = '';
    }
  }

  // Presets on each open transition — same contract as PerformanceForm:
  // a context preset always wins; the free-form dialog keeps the user's
  // previous project pick.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      type = 'performance';
      const day = presetDate ?? dayKeyInTz(new Date().toISOString(), viewerTz);
      dDay = day;
      dEndDay = '';
      dStartWall = `${day}T10:00`;
      dEndWall = '';
      dTitle = '';
      dVenue = '';
      dCity = '';
      dLabel = '';
      dPerformance = '';
      dOption = false;
      dDirection = 'outbound';
      dAllDay = false;
      if (presetProjectId) {
        dProject = presetProjectId;
        dLine = presetLineId ?? '';
      } else if (!dProject) {
        dProject = projectOptions.length === 1 ? projectOptions[0].value : '';
        dLine = presetLineId ?? '';
      }
    }
    wasOpen = open;
  });

  const createDate = createMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const body = await mutateJSON<{ date: DateRow }>('POST', '/api/dates', input);
      if (!body?.date) throw new Error('Malformed response');
      return body.date;
    },
    onSuccess: () => {
      open = false;
      void queryClient.invalidateQueries({ queryKey: ['planner-dates'] });
    },
    onError: (err) => {
      // Contract § Graceful absence: only invalid-body-class failures on a
      // user write may surface; a pre-migration 502 stays quiet.
      if (err instanceof ApiError && err.status === 400) {
        addToast({
          tone: 'danger',
          title: t('create.not_created', locale),
          message: err.message,
        });
      } else {
        console.warn('[calendar] date create failed (feature absent?):', err);
      }
    },
  });

  /**
   * ADR-084 §1 — several days is ONE atomic write of N rows sharing a series
   * key. Each day's wall time is converted on its own: computing one instant
   * and adding 24h would put every day after a DST jump an hour out.
   */
  const createSeries = createMutation({
    mutationFn: async () => {
      const days = blockDays({
        from: dFrom,
        to: dTo,
        weekdays: dWeekdays,
        exceptions: dExceptions,
      });
      const starts: string[] = [];
      const ends: string[] = [];
      for (const day of days) {
        const s = dAllDay ? `${day}T00:00:00.000Z` : wallClockToInstant(`${day}T${dStartTime}`, entryTz);
        if (!s) throw new Error(t('create.pick_start', locale));
        starts.push(s);
        if (!dAllDay && dEndTime) {
          const e = wallClockToInstant(`${day}T${dEndTime}`, entryTz);
          if (!e) throw new Error(t('create.pick_start', locale));
          if (e < s) throw new Error(t('create.end_before_start', locale));
          ends.push(e);
        }
      }
      return mutateJSON<{ dates: unknown[] }>('POST', '/api/dates/series', {
        project_id: dProject,
        kind: type,
        starts,
        ends: !dAllDay && dEndTime ? ends : null,
        all_day: dAllDay,
        title: dTitle || null,
        venue_name: dVenue || null,
        city: dCity || null,
        status: dOption ? 'tentative' : 'confirmed',
        line_id: dLine || null,
        label: type === 'other' ? dLabel || null : null,
      });
    },
    onSuccess: (body) => {
      const n = body?.dates?.length ?? 0;
      void queryClient.invalidateQueries({ queryKey: ['planner-dates'] });
      addToast({ tone: 'success', message: t('block.created', locale, { n: String(n) }) });
      dExceptions = [];
      open = false;
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('create.not_created', locale),
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submitSeries() {
    const n = blockDays({
      from: dFrom,
      to: dTo,
      weekdays: dWeekdays,
      exceptions: dExceptions,
    }).length;
    const limit = blockLimit(n);
    if (limit !== 'ok') {
      addToast({
        tone: 'warning',
        message:
          limit === 'too_few'
            ? t('block.too_few', locale)
            : t('block.too_many', locale, { max: String(BLOCK_MAX_DAYS) }),
      });
      return;
    }
    $createSeries.mutate();
  }

  function submitDate() {
    if (!dProject) {
      addToast({ tone: 'warning', message: t('create.pick_project', locale) });
      return;
    }
    if (dMulti) return submitSeries();
    // All-day rows are calendar dates: UTC-anchored midnight keeps
    // starts_at.slice(0,10) equal to the picked day (never tz-shifted).
    const startsAt = dAllDay
      ? dDay && `${dDay}T00:00:00.000Z`
      : dStartWall && wallClockToInstant(dStartWall, entryTz);
    if (!startsAt) {
      addToast({ tone: 'warning', message: t('create.pick_start', locale) });
      return;
    }
    const endsAt = dAllDay
      ? dEndDay
        ? `${dEndDay}T00:00:00.000Z`
        : null
      : dEndWall
        ? wallClockToInstant(dEndWall, entryTz)
        : null;
    if (endsAt && endsAt < startsAt) {
      addToast({ tone: 'warning', message: t('create.end_before_start', locale) });
      return;
    }
    const input: Record<string, unknown> = {
      project_id: dProject,
      kind: type,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: dAllDay,
      city: dCity.trim() || null,
      status: dOption ? 'tentative' : 'confirmed',
      line_id: dLine || null,
      performance_id: dPerformance || null,
    };
    if (type !== 'day_off') {
      input.title = dTitle.trim() || null;
      input.venue_name = dVenue.trim() || null;
    }
    // Kind-scoped fields stay OUT of the body unless the kind admits them
    // (the endpoint 400s a travel_direction on a rehearsal — by design).
    if (type === 'travel_day') input.travel_direction = dDirection;
    if (type === 'other') input.label = dLabel.trim() || null;
    $createDate.mutate(input);
  }

  function submit() {
    if (type === 'performance') perfForm?.submit();
    else submitDate();
  }

  let pending = $derived(
    type === 'performance' ? perfPending : dMulti ? $createSeries.isPending : $createDate.isPending,
  );
</script>

<Dialog bind:open title={t('create.title', locale)} size="m">
  <div class="ced">
    <div class="ced__types" role="group" aria-label={t('create.type_label', locale)}>
      {#each EVENT_TYPE_KEYS as key (key)}
        <Pill
          size="sm"
          active={type === key}
          ariaPressed={type === key}
          onclick={() => setType(key)}
        >
          {t(TYPE_LABEL_KEYS[key], locale)}
        </Pill>
      {/each}
    </div>

    {#if type === 'performance'}
      <PerformanceForm
        bind:this={perfForm}
        bind:pending={perfPending}
        {open}
        {presetProjectId}
        {presetLineId}
        {presetDate}
        onCreated={handlePerfCreated}
      />
    {:else}
      <form
        class="ced__form"
        onsubmit={(e) => {
          e.preventDefault();
          submitDate();
        }}
      >
        <Select
          label={t('create.project', locale)}
          placeholder={t('create.project_placeholder', locale)}
          options={projectOptions}
          bind:value={dProject}
          required
          onchange={() => {
            dLine = '';
            dPerformance = '';
          }}
        />
        {#if showLineSelect}
          <Select label={t('create.line', locale)} options={lineOptions} bind:value={dLine} />
        {/if}
        {#if attachOptions.length > 1}
          <Select
            label={t('create.attach', locale)}
            options={attachOptions}
            bind:value={dPerformance}
          />
        {/if}

        {#if type !== 'day_off'}
          <Input label={t('create.event_title', locale)} bind:value={dTitle} />
          <Input label={t('create.venue', locale)} bind:value={dVenue} />
        {/if}
        <Input label={t('create.city', locale)} bind:value={dCity} />

        {#if type === 'other'}
          <Input label={t('create.label', locale)} bind:value={dLabel} list="ced-labels" autocomplete="off" />
          <datalist id="ced-labels">
            {#each labelSuggestions as suggestion (suggestion)}
              <option value={suggestion}></option>
            {/each}
          </datalist>
        {/if}

        {#if type === 'travel_day'}
          <div class="ced__field-group" role="group" aria-label={t('create.direction', locale)}>
            <span class="ced__field-label">{t('create.direction', locale)}</span>
            <div class="ced__seg">
              {#each TRAVEL_DIRECTIONS as dir (dir)}
                <button
                  type="button"
                  class="ced__seg-btn"
                  class:ced__seg-btn--on={dDirection === dir}
                  aria-pressed={dDirection === dir}
                  onclick={() => (dDirection = dir)}
                >
                  {t(`create.direction_${dir}`, locale)}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <Checkbox label={t('create.all_day', locale)} bind:checked={dAllDay} onchange={toggleAllDay} />

        <!-- Cardinality, not a type (ADR-084 §1): the pill above already said
             WHAT this is; this only says over how many days it runs. -->
        <Checkbox label={t('block.several_days', locale)} bind:checked={dMulti} />

        {#if dMulti}
          <BlockDays
            bind:from={dFrom}
            bind:to={dTo}
            bind:weekdays={dWeekdays}
            bind:exceptions={dExceptions}
            locale={navigator.language}
            labels={{
              from: t('block.from', locale),
              to: t('block.to', locale),
              pickSpan: t('block.pick_span', locale),
              daysUnit: t('block.days_unit', locale),
              tooFew: t('block.too_few', locale),
              tooMany: t('block.too_many', locale, { max: String(BLOCK_MAX_DAYS) }),
              removed: (n: number) => t('block.removed', locale, { n: String(n) }),
            }}
          />
          {#if !dAllDay}
            <div class="ced__times">
              <Input label={t('create.starts', locale)} type="time" bind:value={dStartTime} />
              <Input label={t('create.ends', locale)} type="time" bind:value={dEndTime} />
            </div>
            <p class="ced__hint">{t('block.times_note', locale)} · {timeHint}</p>
          {/if}
        {:else}
          <div class="ced__times">
            {#if dAllDay}
              <Input label={t('create.starts', locale)} type="date" bind:value={dDay} required />
              <Input label={t('create.ends', locale)} type="date" bind:value={dEndDay} />
            {:else}
              <Input
                label={t('create.starts', locale)}
                type="datetime-local"
                bind:value={dStartWall}
                required
              />
              <Input label={t('create.ends', locale)} type="datetime-local" bind:value={dEndWall} />
            {/if}
          </div>
          {#if !dAllDay}
            <p class="ced__hint">{timeHint}</p>
          {/if}
        {/if}

        <div class="ced__option">
          <Pill size="sm" active={dOption} ariaPressed={dOption} onclick={() => (dOption = !dOption)}>
            {t('create.option', locale)}
          </Pill>
          <span class="ced__hint">{t('create.option_hint', locale)}</span>
        </div>

        <!-- Hidden submit lets Enter inside an input trigger submit. -->
        <button type="submit" hidden aria-hidden="true"></button>
      </form>
    {/if}
  </div>

  {#snippet actions()}
    {#if showBlackoutAction}
      <button type="button" class="ced__blackout" onclick={() => onBlackout?.()}>
        {t('create.blackout_action', locale)}
      </button>
    {/if}
    <Button variant="outline" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submit} loading={pending}>
      {type === 'performance'
        ? t('create.submit_performance', locale)
        : dMulti
          ? t('block.submit', locale)
          : t('create.submit_date', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .ced {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .ced__types {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }

    .ced__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .ced__times {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--space-s);
    }

    .ced__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .ced__option {
      display: flex;
      align-items: center;
      gap: var(--space-s);
    }

    .ced__field-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .ced__field-label {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    /* Same segmented grammar as the toolbar's projection toggle. */
    .ced__seg {
      display: inline-flex;
      align-self: start;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      overflow: hidden;
    }

    .ced__seg-btn {
      border: none;
      background: none;
      padding: var(--space-2xs) var(--space-m);
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--transition), color var(--transition);
    }

    .ced__seg-btn--on {
      background: var(--text-color);
      color: var(--bg);
    }

    /* Quiet footer-left switch to the blackout form (ADR-078 §4/§5). */
    .ced__blackout {
      margin-inline-end: auto;
      border: none;
      background: none;
      padding: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      transition: color var(--transition);
    }

    .ced__blackout:hover {
      color: var(--text-color);
    }
  }
</style>
