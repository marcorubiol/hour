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
  import Field from '../Field.svelte';
  import Segmented from '../Segmented.svelte';
  import Select from '../Select.svelte';
  import WhoGoes from './WhoGoes.svelte';
  import { addToast } from '../Toast.svelte';
  import {
    DATE_TYPE_KEYS,
    TYPE_LABEL_KEYS,
    type DateTypeKey,
  } from '$lib/quick-add';
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
  /** ADR-089: where a trip leaves from. On a trip, `dCity` is where it goes. */
  let dOrigin = $state('');
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
  /** The form's own words for what is wrong, under the field (ADR-139 p7). */
  let errStart = $state<string | undefined>();
  let errEnd = $state<string | undefined>();
  $effect(() => {
    void dDay;
    void dStartWall;
    errStart = undefined;
  });
  $effect(() => {
    void dEndDay;
    void dEndWall;
    errEnd = undefined;
  });
  let formEl: HTMLFormElement | undefined = $state();
  /** «Quién va», held until «Guardar» like every other field here. */
  let whoGoes: { commit: () => Promise<void> } | undefined = $state();
  let whoChanged = $state(false);
  let committing = $state(false);

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
    dCity = (d.kind === 'travel_day' ? d.destination_city : null) ?? d.city ?? '';
    dOrigin = d.origin_city ?? '';
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
        message: err instanceof ApiError || err instanceof Error ? err.message : t('perf.unexpected', locale),
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
        message: err instanceof ApiError || err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  /** Runs from the form's submit, after the native constraints passed. */
  async function submit() {
    if (!date) return;
    const startsAt = dAllDay
      ? dDay && `${dDay}T00:00:00.000Z`
      : dStartWall && wallClockToInstant(dStartWall, entryTz);
    if (!startsAt) {
      errStart = t('create.pick_start', locale);
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
      errEnd = t('create.end_before_start', locale);
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
    if (kind === 'travel_day') {
      input.travel_direction = dDirection;
      input.origin_city = dOrigin.trim() || null;
      input.destination_city = dCity.trim() || null;
    }
    if (kind === 'other') input.label = dLabel.trim() || null;
    // ONE save (ADR-139 p7): who goes is written with the rest, not on its
    // own click, so «Cancelar» takes it back too. A refused word stops here
    // and WhoGoes says so in place; the dialog stays open.
    if (whoChanged && whoGoes) {
      committing = true;
      try {
        await whoGoes.commit();
      } catch {
        return;
      } finally {
        committing = false;
      }
    }
    $savePatch.mutate(input);
  }

  function pressDelete() {
    if (!armed) {
      armed = true;
      return;
    }
    $deleteDate.mutate();
  }

  let pending = $derived($savePatch.isPending || $deleteDate.isPending || committing);
</script>

<Dialog
  bind:open
  title={t('edit.date_title', locale)}
  size="m"
  dirty={whoChanged}
  onclose={() => (armed = false)}
>
  {#if date}
    <div class="edd">
      <Segmented
        ariaLabel={t('create.type_label', locale)}
        options={DATE_TYPE_KEYS.map((key) => ({ value: key, label: t(TYPE_LABEL_KEYS[key], locale) }))}
        bind:value={kind}
      />

      {#if inSeries}
        <!-- A block is N rows sharing a key, never one spanning row: say
             which one this edit touches before it touches it. -->
        <p class="edd__note">{t('edit.series_note', locale)}</p>
      {/if}

      <form
        class="edd__form"
        bind:this={formEl}
        onsubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <!-- The project is FIXED: the endpoint refuses a rescope, so the
             form states the scope instead of offering to change it. -->
        <Field id="edd-project" label={t('create.project', locale)} group>
          <span>{date.project?.name ?? '—'}</span>
        </Field>

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
        {#if kind === 'travel_day'}
          <!-- A TRIP HAS TWO ENDS (ADR-089), so the one place becomes two:
               where it leaves from, where it goes. The stages in between are
               written in the day view, under the strip. -->
          <Input label={t('create.trip_from', locale)} bind:value={dOrigin} autocomplete="off" />
          <Input label={t('create.trip_to', locale)} bind:value={dCity} autocomplete="off" />
        {:else}
          <Input label={t('create.city', locale)} bind:value={dCity} />
        {/if}

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
          <Segmented
            label={t('create.direction', locale)}
            options={TRAVEL_DIRECTIONS.map((dir) => ({ value: dir, label: t(`create.direction_${dir}`, locale) }))}
            bind:value={dDirection}
          />
        {/if}

        <Checkbox
          label={t('create.all_day', locale)}
          bind:checked={dAllDay}
          onchange={toggleAllDay}
        />

        {#if dAllDay}
          <Input label={t('create.starts', locale)} type="date" bind:value={dDay} required error={errStart} />
          <Input label={t('create.ends', locale)} type="date" bind:value={dEndDay} error={errEnd} />
        {:else}
          <Input
            label={t('create.starts', locale)}
            type="datetime-local"
            bind:value={dStartWall}
            required
            error={errStart}
          />
          <Input label={t('create.ends', locale)} type="datetime-local" bind:value={dEndWall} error={errEnd} />
        {/if}
        {#if !dAllDay}
          <p class="edd__hint">{timeHint}</p>
        {/if}

        <!-- Hidden submit lets Enter inside an input trigger submit. -->
        <button type="submit" hidden aria-hidden="true"></button>
      </form>

      {#if date.project}
        <!-- ADR-103's words, inside this dialog's ONE save (ADR-139 p7):
             drawn here, written by «Guardar», taken back by «Cancelar». -->
        <WhoGoes
          bind:this={whoGoes}
          bind:changed={whoChanged}
          deferred
          target="date"
          id={date.id}
          projectId={date.project.id}
          workspaceId={date.project.workspace_id}
          commitments={date.commitments}
          {locale}
        />
      {/if}
    </div>
  {/if}

  <!-- Destructive, quiet until armed. Two presses instead of a
       window.confirm: the dialog is already a modal, and stacking a second
       one over it is how a misclick gets confirmed by reflex. -->
  {#snippet lead()}
    <Button variant="quiet" tone={armed ? 'warn' : undefined} disabled={pending} onclick={pressDelete}>
      {armed ? t('edit.delete_confirm', locale) : t('edit.delete', locale)}
    </Button>
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => formEl?.requestSubmit()} loading={$savePatch.isPending || committing}
      >{t('edit.save', locale)}</Button
    >
  {/snippet}
</Dialog>

<style>
  @layer components {
    .edd {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .edd__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }

    .edd__note,
    .edd__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
  }
</style>
