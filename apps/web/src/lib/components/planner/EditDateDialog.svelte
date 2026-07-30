<script lang="ts">
  /**
   * Edit or delete ONE date row — the missing half of CreateEventDialog.
   * Every non-performance calendar row (rehearsal, travel, day off,
   * residency, press, other) has been creatable since ADR-078 and
   * uneditable ever since: PATCH and DELETE /api/dates/:id were built,
   * whitelisted and gated, and no component ever called them.
   *
   * Scope follows the ENDPOINT's whitelist, not the table:
   * - No project move. Rescoping is delete + recreate (the expense rule),
   *   and the endpoint refuses project_id outright — so the form doesn't
   *   offer a lie it can't carry out. Line and attached performance DO
   *   move, inside the project, which is what a mis-filed date needs.
   * - No series-wide edit. A block is N independent rows on purpose
   *   (ADR-084 §1: "each day keeps its own hours and status"), so this
   *   edits the day you opened — and says so when the row has siblings.
   * - Kind can change among the six date kinds, never into a performance:
   *   a gig is a different table with a fee, a road sheet and a slug.
   *
   * Timezone rule (ADR-078 §11): a typed hour is the space's local time.
   * The prefill runs instantToWallClock and the save runs its documented
   * inverse, so opening a date and saving it untouched is a no-op. Reading
   * `starts_at` straight into the input would print UTC in a Madrid form
   * and rewrite every hour by the offset the moment anyone pressed Save.
   */
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
  import {
    DATE_TYPE_KEYS,
    TYPE_LABEL_KEYS,
    type DateTypeKey,
  } from '../create/CreateEventDialog.svelte';
  import { dayMonthYear, instantToWallClock, wallClockToInstant } from '$lib/datetime';
  import { detectLocale, t } from '$lib/i18n';
  import { allLinesQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import {
    DATE_STATUSES,
    TRAVEL_DIRECTIONS,
    invalidateDateFeeds,
    type DateRow,
    type TravelDirection,
  } from '$lib/date';
  import type { DateEvent } from '$lib/month-events';

  interface Props {
    open?: boolean;
    /** The row to edit — the planner's own feed VM, no refetch needed. */
    date?: DateEvent | null;
    /** True when other rows share this row's series (ADR-084 §1 block). */
    inSeries?: boolean;
  }

  let { open = $bindable(false), date = null, inSeries = false }: Props = $props();

  const locale = detectLocale(navigator.language);
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const queryClient = useQueryClient();

  let kind = $state<DateTypeKey>('rehearsal');
  let status = $state<string>('confirmed');
  let dTitle = $state('');
  let dVenue = $state('');
  let dCity = $state('');
  let dLabel = $state('');
  let dLine = $state('');
  let dPerformance = $state('');
  let dAllDay = $state(false);
  let dDay = $state('');
  let dEndDay = $state('');
  let dStartWall = $state('');
  let dEndWall = $state('');
  let dDirection = $state<TravelDirection>('outbound');
  /** Two-step delete: the first press arms, the second writes. */
  let armed = $state(false);

  let projectId = $derived(date?.project?.id ?? '');
  let workspaceId = $derived(date?.project?.workspace_id ?? '');

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let entryTz = $derived(
    ($workspacesQuery.data?.items ?? []).find((w) => w.id === workspaceId)?.timezone || viewerTz,
  );
  let timeHint = $derived(t('create.time_hint_tz', locale, { tz: entryTz }));

  let projectLines = $derived(
    ($linesQuery.data?.items ?? []).filter((l) => l.project?.id === projectId),
  );
  let lineOptions = $derived([
    { value: '', label: t('create.line_none', locale) },
    ...projectLines.map((l) => ({ value: l.id, label: l.name })),
  ]);

  // Same third cascade level as creation (ADR-078 §1): a date can hang
  // from a performance of ITS project.
  type AttachPerf = {
    id: string;
    performed_at: string;
    venue_name: string | null;
    city: string | null;
  };
  const attachOptionsStore = toStore(() => ({
    queryKey: ['project-performances', projectId] as const,
    enabled: open && Boolean(projectId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: AttachPerf[] }>(
        `/api/performances?project_ids=${projectId}&status=any&limit=200`,
        signal,
      ),
  }));
  const attachQuery = createQuery(attachOptionsStore);
  let attachOptions = $derived([
    { value: '', label: t('create.attach_none', locale) },
    ...($attachQuery.data?.items ?? []).map((p) => ({
      value: p.id,
      label: `${dayMonthYear(p.performed_at)} · ${p.venue_name ?? p.city ?? '—'}`,
    })),
  ]);

  const labelsStore = toStore(() => ({
    queryKey: ['date-labels', workspaceId] as const,
    enabled: open && kind === 'other' && Boolean(workspaceId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await fetchJSON<{ labels: string[] }>(
          `/api/dates/labels?workspace_ids=${workspaceId}`,
          signal,
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'Unauthorized') throw err;
        console.warn('[calendar] labels feed absent:', err);
        return { labels: [] as string[] };
      }
    },
  }));
  const labelsQuery = createQuery(labelsStore);
  let labelSuggestions = $derived($labelsQuery.data?.labels ?? []);

  const statusOptions = $derived(
    DATE_STATUSES.map((s) => ({ value: s, label: t(`edit.status_${s}`, locale) })),
  );

  /**
   * Seed on open — and again if the workspace timezone resolves late.
   * The wall-clock prefill is only right once `entryTz` is the space's
   * zone; seeding once against the viewer's fallback would leave a Madrid
   * rehearsal showing the reader's hour, and saving would move it. The
   * re-seed costs at most a keystroke typed inside a cached-query tick,
   * and it errs toward the correct time rather than the typed one.
   */
  let seedKey = $state('');
  $effect(() => {
    if (!open || !date) {
      seedKey = '';
      return;
    }
    const key = `${date.id}:${entryTz}`;
    if (key === seedKey) return;
    seedKey = key;
    seed(date, entryTz);
  });

  function seed(d: DateEvent, tz: string) {
    kind = (DATE_TYPE_KEYS as readonly string[]).includes(d.kind)
      ? (d.kind as DateTypeKey)
      : 'other';
    status = d.status;
    dTitle = d.title ?? '';
    dVenue = d.venue_name ?? '';
    dCity = d.city ?? '';
    dLabel = d.label ?? '';
    dLine = d.line_id ?? '';
    dPerformance = d.performance_id ?? '';
    dDirection = (TRAVEL_DIRECTIONS as readonly string[]).includes(d.travel_direction ?? '')
      ? (d.travel_direction as TravelDirection)
      : 'outbound';
    dAllDay = d.all_day;
    // All-day rows are calendar dates, not instants — the stored day IS
    // the day (UTC-anchored midnight), so it never rides a conversion.
    dDay = d.starts_at.slice(0, 10);
    dEndDay = d.ends_at ? d.ends_at.slice(0, 10) : '';
    dStartWall = instantToWallClock(d.starts_at, tz);
    dEndWall = d.ends_at ? instantToWallClock(d.ends_at, tz) : '';
    armed = false;
  }

  /** Keep the picked day when the all-day switch flips — as creation does. */
  function toggleAllDay() {
    if (dAllDay) {
      if (dStartWall) dDay = dStartWall.slice(0, 10);
      if (dEndWall) dEndDay = dEndWall.slice(0, 10);
    } else {
      if (dDay) dStartWall = `${dDay}T10:00`;
      dEndWall = '';
    }
  }

  const savePatch = createMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const body = await mutateJSON<{ date: DateRow }>('PATCH', `/api/dates/${date?.id}`, input);
      if (!body?.date) throw new Error('Malformed response');
      return body.date;
    },
    onSuccess: () => {
      open = false;
      invalidateDateFeeds(queryClient);
      addToast({ tone: 'success', message: t('edit.saved', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_saved', locale),
        message: err instanceof ApiError || err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  const deleteDate = createMutation({
    mutationFn: () => mutateJSON('DELETE', `/api/dates/${date?.id}`),
    onSuccess: () => {
      open = false;
      invalidateDateFeeds(queryClient);
      addToast({ tone: 'success', message: t('edit.deleted', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_deleted', locale),
        message: err instanceof ApiError || err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submit() {
    if (!date) return;
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
      kind,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: dAllDay,
      title: dTitle.trim() || null,
      venue_name: dVenue.trim() || null,
      city: dCity.trim() || null,
      line_id: dLine || null,
      performance_id: dPerformance || null,
    };
    // Kind-scoped fields ride ONLY on the kind that admits them. Left out,
    // the endpoint clears what the old kind carried (travel_direction on a
    // kind change, the custom_fields label) instead of tripping a CHECK.
    if (kind === 'travel_day') input.travel_direction = dDirection;
    if (kind === 'other') input.label = dLabel.trim() || null;
    $savePatch.mutate(input);
  }

  function pressDelete() {
    if (!armed) {
      armed = true;
      return;
    }
    $deleteDate.mutate();
  }

  let pending = $derived($savePatch.isPending || $deleteDate.isPending);
</script>

<Dialog bind:open title={t('edit.date_title', locale)} size="m" onclose={() => (armed = false)}>
  {#if date}
    <div class="edd">
      <div class="edd__types" role="group" aria-label={t('create.type_label', locale)}>
        {#each DATE_TYPE_KEYS as key (key)}
          <Pill
            size="sm"
            active={kind === key}
            ariaPressed={kind === key}
            onclick={() => (kind = key)}
          >
            {t(TYPE_LABEL_KEYS[key], locale)}
          </Pill>
        {/each}
      </div>

      {#if inSeries}
        <!-- A block is N rows sharing a key, never one spanning row: say
             which one this edit touches before it touches it. -->
        <p class="edd__note">{t('edit.series_note', locale)}</p>
      {/if}

      <form
        class="edd__form"
        onsubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <!-- The project is FIXED: the endpoint refuses a rescope, so the
             form states the scope instead of offering to change it. -->
        <p class="edd__scope">
          {t('create.project', locale)}: <b>{date.project?.name ?? '—'}</b>
        </p>

        <Select label={t('edit.status', locale)} options={statusOptions} bind:value={status} />

        {#if projectLines.length > 0}
          <Select label={t('create.line', locale)} options={lineOptions} bind:value={dLine} />
        {/if}
        {#if attachOptions.length > 1}
          <Select
            label={t('create.attach', locale)}
            options={attachOptions}
            bind:value={dPerformance}
          />
        {/if}

        {#if kind !== 'day_off'}
          <Input label={t('create.event_title', locale)} bind:value={dTitle} />
          <Input label={t('create.venue', locale)} bind:value={dVenue} />
        {/if}
        <Input label={t('create.city', locale)} bind:value={dCity} />

        {#if kind === 'other'}
          <Input
            label={t('create.label', locale)}
            bind:value={dLabel}
            list="edd-labels"
            autocomplete="off"
          />
          <datalist id="edd-labels">
            {#each labelSuggestions as suggestion (suggestion)}
              <option value={suggestion}></option>
            {/each}
          </datalist>
        {/if}

        {#if kind === 'travel_day'}
          <div class="edd__field-group" role="group" aria-label={t('create.direction', locale)}>
            <span class="edd__field-label">{t('create.direction', locale)}</span>
            <div class="edd__seg">
              {#each TRAVEL_DIRECTIONS as dir (dir)}
                <button
                  type="button"
                  class="edd__seg-btn"
                  class:edd__seg-btn--on={dDirection === dir}
                  aria-pressed={dDirection === dir}
                  onclick={() => (dDirection = dir)}
                >
                  {t(`create.direction_${dir}`, locale)}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <Checkbox
          label={t('create.all_day', locale)}
          bind:checked={dAllDay}
          onchange={toggleAllDay}
        />

        <div class="edd__times">
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
          <p class="edd__hint">{timeHint}</p>
        {/if}

        <!-- Hidden submit lets Enter inside an input trigger submit. -->
        <button type="submit" hidden aria-hidden="true"></button>
      </form>
    </div>
  {/if}

  {#snippet actions()}
    <button
      type="button"
      class="edd__delete"
      class:edd__delete--armed={armed}
      disabled={pending}
      onclick={pressDelete}
    >
      {armed ? t('edit.delete_confirm', locale) : t('edit.delete', locale)}
    </button>
    <Button variant="outline" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submit} loading={$savePatch.isPending}>{t('edit.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .edd {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .edd__types {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }

    .edd__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .edd__scope,
    .edd__note,
    .edd__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .edd__scope b {
      font-weight: 500;
      color: var(--text-muted);
    }

    .edd__times {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--space-s);
    }

    .edd__field-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .edd__field-label {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    /* Same segmented grammar as the create dialog and the toolbar toggle. */
    .edd__seg {
      display: inline-flex;
      align-self: start;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      overflow: hidden;
    }

    .edd__seg-btn {
      border: none;
      background: none;
      padding: var(--space-2xs) var(--space-m);
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--transition), color var(--transition);
    }

    .edd__seg-btn--on {
      background: var(--text-color);
      color: var(--bg);
    }

    /* Destructive action, quiet until armed — the footer-left slot the
       create dialog uses for its blackout switch. Two presses instead of
       a window.confirm: the dialog is already a modal, and stacking a
       second one over it is how a misclick gets confirmed by reflex. */
    .edd__delete {
      margin-inline-end: auto;
      border: none;
      background: none;
      padding: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      transition: color var(--transition);
    }

    .edd__delete:hover,
    .edd__delete--armed {
      color: var(--danger);
    }

    .edd__delete--armed {
      font-weight: 500;
    }

    .edd__delete:disabled {
      cursor: default;
      opacity: 0.5;
    }
  }
</style>
