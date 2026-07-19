<script lang="ts">
  /**
   * BlockForm — the "Block" mode of the unified create dialog (ADR-084 §1;
   * design "Hour Block Create"). Sibling of PerformanceForm and deliberately
   * the same contract — instance `submit()`, bindable `pending`, `onCreated`
   * — so the host dialog drives either one without knowing which is mounted.
   *
   * A block is N `date` rows sharing one series key, written atomically by
   * POST /api/dates/series. The days are never enumerated by hand: a span
   * plus a weekday RULE produces them, and single strays are punched out as
   * exceptions (a bank holiday in week three is an exception to one rule,
   * not three separate blocks).
   *
   * Timezone (ADR-078 §11): the typed hour is wall time in the entry zone,
   * and each day is converted INDEPENDENTLY. Computing one instant and
   * adding 24h would put every day after a DST jump an hour out — and the
   * canonical example (9 Mar → 10 Apr 2026) crosses one.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import Select from '$lib/components/Select.svelte';
  import Input from '$lib/components/Input.svelte';
  import { dayKeyInTz, addDaysIso } from '$lib/planner';
  import { wallClockToInstant } from '$lib/datetime';
  import { detectLocale, t } from '$lib/i18n';
  import { allLinesQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import {
    blockDays,
    blockLimit,
    blockWeeks,
    weekdayOf,
    WEEKDAY_ORDER,
    BLOCK_MAX_DAYS,
  } from '$lib/block';

  interface Props {
    open?: boolean;
    presetProjectId?: string | null;
    presetLineId?: string | null;
    lockProject?: boolean;
    presetDate?: string | null;
    pending?: boolean;
    onCreated?: (info: { count: number }) => void;
  }

  let {
    open = false,
    presetProjectId = null,
    presetLineId = null,
    lockProject = false,
    presetDate = null,
    pending = $bindable(false),
    onCreated,
  }: Props = $props();

  const locale = detectLocale(navigator.language);
  const queryClient = useQueryClient();
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** Kinds a block can be. Travel is absent on purpose — a travel day
      carries a direction, which is a property of one row, not of a span. */
  const KINDS = ['rehearsal', 'residency', 'press', 'other'] as const;

  let bProject = $state('');
  let bLine = $state('');
  let bKind = $state<(typeof KINDS)[number]>('rehearsal');
  let bFrom = $state('');
  let bTo = $state('');
  let bWeekdays = $state<number[]>([1, 2, 3, 4, 5]);
  let bExceptions = $state<string[]>([]);
  let bStart = $state('10:00');
  let bEnd = $state('');
  let bVenue = $state('');
  let bCity = $state('');
  let bCountry = $state('');
  let bSettled = $state(false); // dates are born tentative (ADR-084 §4)
  let bTitle = $state('');

  // Seed on each open transition — plain latch, same pattern as the siblings.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      const today = presetDate ?? dayKeyInTz(new Date().toISOString(), viewerTz);
      if (!bProject && presetProjectId) bProject = presetProjectId;
      if (presetLineId) bLine = presetLineId;
      if (!bFrom) bFrom = today;
      if (!bTo) bTo = addDaysIso(today, 11); // ~two working weeks ahead
      bExceptions = [];
    }
    wasOpen = open;
  });

  const projectsQuery = createQuery({
    queryKey: ['projects', 'all'] as const,
    queryFn: () =>
      fetchJSON<{
        items: {
          id: string;
          name: string;
          workspace_id: string;
          slug: string | null;
          accent: string | null;
        }[];
      }>('/api/projects?limit=200'),
  });
  const linesQuery = createQuery(allLinesQueryOptions());
  const workspacesQuery = createQuery(workspacesQueryOptions());

  let projectOptions = $derived(
    ($projectsQuery.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
  );
  let lineOptions = $derived([
    { value: '', label: t('create.line_none', locale) },
    ...($linesQuery.data?.items ?? [])
      .filter((l) => l.project?.id === bProject)
      .map((l) => ({ value: l.id, label: l.name })),
  ]);
  let projectWorkspaceId = $derived(
    ($projectsQuery.data?.items ?? []).find((p) => p.id === bProject)?.workspace_id ?? '',
  );
  /** Same rule as the create dialog: the project's workspace zone, never a
      guessed city-local one — this form resolves no venue timezone. */
  let entryTz = $derived(
    ($workspacesQuery.data?.items ?? []).find((w) => w.id === projectWorkspaceId)?.timezone ||
      viewerTz,
  );

  /**
   * The picked project's accent. The picker's hatch wears the colour those
   * days will wear on the month, so "what I chose" and "what landed" are
   * recognisably the same block rather than two neutral grey things.
   */
  let projectAccent = $derived.by(() => {
    const p = ($projectsQuery.data?.items ?? []).find((x) => x.id === bProject);
    return p ? accentVarFor(p) : null;
  });

  let days = $derived(
    blockDays({ from: bFrom, to: bTo, weekdays: bWeekdays, exceptions: bExceptions }),
  );
  let limit = $derived(blockLimit(days.length));
  let weeks = $derived(blockWeeks(days));
  let daySet = $derived(new Set(days));
  let exceptionSet = $derived(new Set(bExceptions));

  /** The calendar shown under the rule: whole weeks covering the span, so a
      day can be punched out where the eye already expects to find it. */
  let calendarDays = $derived.by(() => {
    if (!bFrom || !bTo || bTo < bFrom) return [] as string[];
    const back = (weekdayOf(bFrom) + 6) % 7;
    const fwd = 6 - ((weekdayOf(bTo) + 6) % 7);
    const out: string[] = [];
    let d = addDaysIso(bFrom, -back);
    const end = addDaysIso(bTo, fwd);
    for (let guard = 0; d <= end && guard < 400; guard++) {
      out.push(d);
      d = addDaysIso(d, 1);
    }
    return out;
  });

  function toggleWeekday(w: number) {
    bWeekdays = bWeekdays.includes(w) ? bWeekdays.filter((x) => x !== w) : [...bWeekdays, w];
  }
  function toggleException(day: string) {
    if (day < bFrom || day > bTo) return;
    if (!bWeekdays.includes(weekdayOf(day))) return; // the rule already excludes it
    bExceptions = exceptionSet.has(day)
      ? bExceptions.filter((x) => x !== day)
      : [...bExceptions, day];
  }

  const createBlock = createMutation({
    mutationFn: async () => {
      // Per-day conversion: see the DST note at the top of this file.
      const starts: string[] = [];
      const ends: string[] = [];
      for (const day of days) {
        const s = wallClockToInstant(`${day}T${bStart}`, entryTz);
        if (!s) throw new Error(t('create.pick_start', locale));
        starts.push(s);
        if (bEnd) {
          const e = wallClockToInstant(`${day}T${bEnd}`, entryTz);
          if (!e) throw new Error(t('create.pick_start', locale));
          if (e < s) throw new Error(t('create.end_before_start', locale));
          ends.push(e);
        }
      }
      return mutateJSON<{ dates: unknown[] }>('POST', '/api/dates/series', {
        project_id: bProject,
        kind: bKind,
        starts,
        ends: bEnd ? ends : null,
        title: bTitle || null,
        venue_name: bVenue || null,
        city: bCity || null,
        country: bCountry || null,
        status: bSettled ? 'confirmed' : 'tentative',
        line_id: bLine || null,
      });
    },
    onSuccess: (body) => {
      const n = body?.dates?.length ?? days.length;
      void queryClient.invalidateQueries({ queryKey: ['planner-dates'] });
      void queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
      addToast({ tone: 'success', message: t('block.created', locale, { n: String(n) }) });
      bExceptions = [];
      bTitle = '';
      onCreated?.({ count: n });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('create.not_created', locale),
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  $effect(() => {
    pending = $createBlock.isPending;
  });

  export function submit() {
    if (!bProject) {
      addToast({ tone: 'warning', message: t('create.pick_project', locale) });
      return;
    }
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
    $createBlock.mutate();
  }

  const KIND_KEY: Record<string, string> = {
    rehearsal: 'create.type_rehearsal',
    residency: 'create.type_residency',
    press: 'create.type_press',
    other: 'create.type_other',
  };
  const WD_LABEL = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // getDay() index
</script>

<div class="bf">
  <Select
    label={t('create.project', locale)}
    options={projectOptions}
    bind:value={bProject}
    disabled={lockProject}
    placeholder={t('create.project_placeholder', locale)}
  />
  {#if !presetLineId}
    <Select label={t('create.line', locale)} options={lineOptions} bind:value={bLine} />
  {/if}

  <div class="bf__field">
    <span class="bf__label">{t('create.type_label', locale)}</span>
    <div class="bf__seg">
      {#each KINDS as k (k)}
        <button
          type="button"
          class="bf__opt"
          class:bf__opt--on={bKind === k}
          aria-pressed={bKind === k}
          onclick={() => (bKind = k)}>{t(KIND_KEY[k], locale)}</button
        >
      {/each}
    </div>
    <p class="bf__note">{t('block.travel_hint', locale)}</p>
  </div>

  <div class="bf__field">
    <span class="bf__label">{t('block.which_days', locale)}</span>
    <div class="bf__days" style={projectAccent ? `--c: ${projectAccent}` : undefined}>
      <div class="bf__row2">
        <Input label={t('block.from', locale)} type="date" bind:value={bFrom} />
        <Input label={t('block.to', locale)} type="date" bind:value={bTo} />
      </div>

      <div class="bf__wd">
        {#each WEEKDAY_ORDER as w (w)}
          <button
            type="button"
            class="bf__wdchip"
            class:bf__wdchip--on={bWeekdays.includes(w)}
            aria-pressed={bWeekdays.includes(w)}
            onclick={() => toggleWeekday(w)}>{WD_LABEL[w]}</button
          >
        {/each}
      </div>

      {#if calendarDays.length === 0}
        <p class="bf__empty">{t('block.pick_span', locale)}</p>
      {:else}
        <div class="bf__cal" role="group" aria-label={t('block.which_days', locale)}>
          {#each calendarDays as d (d)}
            {@const inSpan = d >= bFrom && d <= bTo}
            {@const selected = daySet.has(d)}
            {@const removed = exceptionSet.has(d)}
            <button
              type="button"
              class="bf__cald"
              class:bf__cald--out={!inSpan}
              class:bf__cald--sel={selected}
              class:bf__cald--rem={removed}
              disabled={!inSpan || !bWeekdays.includes(weekdayOf(d))}
              aria-pressed={selected}
              onclick={() => toggleException(d)}>{Number(d.slice(8, 10))}</button
            >
          {/each}
        </div>
      {/if}

      <p class="bf__count" class:bf__count--err={limit !== 'ok'}>
        <b>{days.length}</b>
        <span>{t('block.days_unit', locale)}</span>
        {#if limit === 'too_many'}
          <i>{t('block.too_many', locale, { max: String(BLOCK_MAX_DAYS) })}</i>
        {:else if limit === 'too_few'}
          <i>{t('block.too_few', locale)}</i>
        {:else if bExceptions.length > 0}
          <i>{t('block.removed', locale, { n: String(bExceptions.length) })}</i>
        {/if}
      </p>
    </div>
  </div>

  <div class="bf__row2">
    <Input label={t('create.starts', locale)} type="time" bind:value={bStart} />
    <Input label={t('create.ends', locale)} type="time" bind:value={bEnd} />
  </div>
  <p class="bf__note">{t('block.times_note', locale)} · {t('create.time_hint_tz', locale, { tz: entryTz })}</p>

  <div class="bf__row3">
    <Input label={t('create.venue', locale)} bind:value={bVenue} />
    <Input label={t('create.city', locale)} bind:value={bCity} />
    <Input label={t('block.country', locale)} bind:value={bCountry} placeholder="ES" />
  </div>

  <div class="bf__field">
    <span class="bf__label">{t('create.type_label', locale)}</span>
    <div class="bf__seg">
      <button
        type="button"
        class="bf__opt"
        class:bf__opt--on={!bSettled}
        aria-pressed={!bSettled}
        onclick={() => (bSettled = false)}>{t('create.option', locale)}</button
      >
      <button
        type="button"
        class="bf__opt"
        class:bf__opt--on={bSettled}
        aria-pressed={bSettled}
        onclick={() => (bSettled = true)}>{t('block.settled', locale)}</button
      >
    </div>
    <p class="bf__note">{t('create.option_hint', locale)}</p>
  </div>

  <Input label={t('create.event_title', locale)} bind:value={bTitle} />

  {#if days.length > 0 && limit === 'ok'}
    <!-- The review: you confirm against a COUNT and a shape, never a guess.
         The write is atomic and multi-row — a wrong click makes 25 rows. -->
    <div class="bf__review" style={projectAccent ? `--c: ${projectAccent}` : undefined}>
      <p class="bf__review-h">
        <b>{days.length}</b>
        {t(KIND_KEY[bKind], locale)}
      </p>
      {#each weeks as w, i (w.monday)}
        <p class="bf__wk">
          <span class="bf__wk-l">{t('block.week', locale, { n: String(i + 1) })}</span>
          <span class="bf__wk-bars">
            {#each w.days as _d (_d)}<i></i>{/each}
          </span>
          <span class="bf__wk-n">{w.days.length}</span>
        </p>
      {/each}
      <p class="bf__review-ser">{t('block.series_note', locale)}</p>
    </div>
  {/if}
</div>

<style>
  .bf {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
  }
  .bf__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .bf__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .bf__note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .bf__row2,
  .bf__row3 {
    display: grid;
    gap: var(--space-s);
  }
  .bf__row2 {
    grid-template-columns: 1fr 1fr;
  }
  .bf__row3 {
    grid-template-columns: 1.4fr 1fr 0.6fr;
  }

  /* Segmented choices — the settled/option pair reuses the chip grammar. */
  .bf__seg {
    display: flex;
    gap: var(--space-2xs);
  }
  .bf__opt {
    flex: 1;
    appearance: none;
    padding: var(--space-xs) var(--space-2xs);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-s);
    background: var(--bg);
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .bf__opt--on {
    background: var(--text-color);
    border-color: var(--text-color);
    color: var(--bg);
  }

  .bf__days {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
    padding: var(--space-s);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius-m);
    background: var(--bg-light);
  }
  .bf__wd {
    display: flex;
    gap: var(--space-2xs);
  }
  .bf__wdchip {
    flex: 1;
    appearance: none;
    padding: var(--space-2xs) 0;
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-s);
    background: var(--bg-ultra-light);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .bf__wdchip--on {
    background: color-mix(in oklch, var(--c, var(--text-color)) 14%, var(--bg-ultra-light));
    border-color: color-mix(in oklch, var(--c, var(--text-color)) 34%, var(--border-color-light));
    color: var(--text-color);
  }

  /* The calendar shows the RESULT of the rule and is only a way to punch a
     single day out — never the way to build the block. */
  .bf__cal {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .bf__cald {
    appearance: none;
    aspect-ratio: 1.1;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text-faint);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .bf__cald:disabled {
    cursor: default;
  }
  .bf__cald--out {
    visibility: hidden;
  }
  /* Selected days wear the SAME hatch the month will give them: what you
     pick here is what lands there. */
  .bf__cald--sel {
    border-color: color-mix(in oklch, var(--c, var(--text-color)) 32%, transparent);
    border-style: dashed;
    background-image: repeating-linear-gradient(
      135deg,
      color-mix(in oklch, var(--c, var(--text-color)) 11%, var(--bg-ultra-light)) 0 4px,
      var(--bg-ultra-light) 4px 8px
    );
    color: var(--text-color);
  }
  .bf__cald--rem {
    text-decoration: line-through;
    text-decoration-color: var(--danger, var(--text-muted));
    background-image: none;
    border-color: transparent;
    border-style: solid;
  }

  .bf__count {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    margin: 0;
    padding-block-start: var(--space-xs);
    border-block-start: 1px solid var(--border-color-light);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .bf__count b {
    font-family: var(--font-display, var(--font-sans));
    font-size: var(--text-l);
    font-weight: 400;
    color: var(--heading-color);
    line-height: 1;
  }
  .bf__count i {
    margin-inline-start: auto;
    font-style: normal;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .bf__count--err b,
  .bf__count--err i {
    color: var(--danger, var(--text-color));
  }

  .bf__review {
    padding: var(--space-s);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius-m);
    background: var(--bg-light);
  }
  .bf__review-h {
    margin: 0 0 var(--space-2xs);
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .bf__review-h b {
    font-family: var(--font-display, var(--font-sans));
    font-size: var(--text-l);
    font-weight: 400;
    color: var(--heading-color);
  }
  .bf__wk {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .bf__wk-l {
    inline-size: 3.5em;
    flex: none;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .bf__wk-bars {
    display: flex;
    gap: 2px;
  }
  .bf__wk-bars i {
    inline-size: 14px;
    block-size: 8px;
    border-radius: 2px;
    border: 1px dashed color-mix(in oklch, var(--c, var(--text-color)) 32%, transparent);
    background-image: repeating-linear-gradient(
      135deg,
      color-mix(in oklch, var(--c, var(--text-color)) 11%, var(--bg-ultra-light)) 0 3px,
      var(--bg-ultra-light) 3px 6px
    );
  }
  .bf__wk-n {
    margin-inline-start: auto;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .bf__review-ser {
    margin: var(--space-xs) 0 0;
    padding-block-start: var(--space-xs);
    border-block-start: 1px dashed var(--border-color-light);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .bf__empty {
    margin: 0;
    padding: var(--space-m) 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
