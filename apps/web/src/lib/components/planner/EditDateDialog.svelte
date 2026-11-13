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
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
  import { dayMonthYear, dualTime, instantToWallClock, wallClockToInstant, viewerTimeZone } from '$lib/datetime';
  import { appLocale, t, voiceFor } from '$lib/i18n';
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

  const locale = appLocale();
  const viewerTz = viewerTimeZone();
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
  /** Borrar una fecha no se deshace y la quita del calendario de todos: se confirma (tarea 134). */
  let confirmDelete = $state(false);
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
  /** The trade of the date's space (tarea 142); the screen's voice for a date without a project. */
  let voice = $derived(voiceFor(workspaceId));
  const tr = (key: string, params?: Record<string, string | number>) => t(key, locale, params, voice);

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let entryTz = $derived(
    ($workspacesQuery.data?.items ?? []).find((w) => w.id === workspaceId)?.timezone || viewerTz,
  );
  // Only when the space's clock is not yours (ADR-154): the same test as
  // `dualTime`, by name and then by what the clock reads now.
  let timeHint = $derived(
    dualTime(new Date().toISOString(), entryTz, viewerTz).secondary !== null ? tr('create.time_hint_tz', { tz: entryTz }) : '',
  );

  let projectLines = $derived(
    ($linesQuery.data?.items ?? []).filter((l) => l.project?.id === projectId),
  );
  let lineOptions = $derived([
    { value: '', label: tr('create.line_none') },
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
    { value: '', label: tr('create.attach_none') },
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
    DATE_STATUSES.map((s) => ({ value: s, label: tr(`edit.status_${s}`) })),
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
    confirmDelete = false;
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
      addToast({ tone: 'success', message: tr('edit.saved') });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: tr('edit.not_saved'),
        message: err instanceof ApiError || err instanceof Error ? err.message : tr('perf.unexpected'),
      });
    },
  });

  const deleteDate = createMutation({
    mutationFn: () => mutateJSON('DELETE', `/api/dates/${date?.id}`),
    onSuccess: () => {
      confirmDelete = false;
      open = false;
      invalidateDateFeeds(queryClient);
      addToast({ tone: 'success', message: tr('edit.deleted') });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: tr('edit.not_deleted'),
        message: err instanceof ApiError || err instanceof Error ? err.message : tr('perf.unexpected'),
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
      errStart = tr('create.pick_start');
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
      errEnd = tr('create.end_before_start');
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


  let pending = $derived($savePatch.isPending || $deleteDate.isPending || committing);
</script>

<Dialog
  bind:open
  title={tr('edit.date_title')}
  size="m"
  dirty={whoChanged}
>
  {#if date}
    <div class="edd">
      <Segmented
        ariaLabel={tr('create.type_label')}
        options={DATE_TYPE_KEYS.map((key) => ({ value: key, label: tr(TYPE_LABEL_KEYS[key]) }))}
        bind:value={kind}
      />

      {#if inSeries}
        <!-- A block is N rows sharing a key, never one spanning row: say
             which one this edit touches before it touches it. -->
        <p class="edd__note">{tr('edit.series_note')}</p>
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
        <Field id="edd-project" label={tr('create.project')} group>
          <span>{date.project?.name ?? '—'}</span>
        </Field>

        <Select label={tr('edit.status')} options={statusOptions} bind:value={status} />

        {#if projectLines.length > 0}
          <Select label={tr('create.line')} options={lineOptions} bind:value={dLine} />
        {/if}
        {#if attachOptions.length > 1}
          <Select
            label={tr('create.attach')}
            options={attachOptions}
            bind:value={dPerformance}
          />
        {/if}

        {#if kind !== 'day_off'}
          <Input label={tr('create.event_title')} bind:value={dTitle} />
          <Input label={tr('create.venue')} bind:value={dVenue} />
        {/if}
        {#if kind === 'travel_day'}
          <!-- A TRIP HAS TWO ENDS (ADR-089), so the one place becomes two:
               where it leaves from, where it goes. The stages in between are
               written in the day view, under the strip. -->
          <Input label={tr('create.trip_from')} bind:value={dOrigin} autocomplete="off" />
          <Input label={tr('create.trip_to')} bind:value={dCity} autocomplete="off" />
        {:else}
          <Input label={tr('create.city')} bind:value={dCity} />
        {/if}

        {#if kind === 'other'}
          <Input
            label={tr('create.label')}
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
            label={tr('create.direction')}
            options={TRAVEL_DIRECTIONS.map((dir) => ({ value: dir, label: tr(`create.direction_${dir}`) }))}
            bind:value={dDirection}
          />
        {/if}

        <Checkbox
          label={tr('create.all_day')}
          bind:checked={dAllDay}
          onchange={toggleAllDay}
        />

        {#if dAllDay}
          <Input label={tr('create.starts')} type="date" bind:value={dDay} required error={errStart} />
          <Input label={tr('create.ends')} type="date" bind:value={dEndDay} error={errEnd} />
        {:else}
          <Input
            label={tr('create.starts')}
            type="datetime-local"
            bind:value={dStartWall}
            required
            error={errStart}
          />
          <Input label={tr('create.ends')} type="datetime-local" bind:value={dEndWall} error={errEnd} />
        {/if}
        {#if !dAllDay && timeHint}
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
          workspaceId={date.project.workspace_id}
          commitments={date.commitments}
          {locale}
        />
      {/if}
    </div>
  {/if}

  <!-- Destructive: the quiet word in the warn tone, and what cannot be
       undone asks first (ConfirmDialog, tarea 134). -->
  {#snippet lead()}
    <Button variant="quiet" tone="warn" disabled={pending} onclick={() => (confirmDelete = true)}>
      {tr('edit.delete')}
    </Button>
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{tr('create.cancel')}</Button>
    <Button onclick={() => formEl?.requestSubmit()} loading={$savePatch.isPending || committing}
      >{tr('edit.save')}</Button
    >
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={confirmDelete}
  title={tr('edit.delete_date_title')}
  body={tr('edit.delete_date_body')}
  confirm={tr('edit.delete')}
  busy={$deleteDate.isPending}
  {locale}
  onconfirm={() => $deleteDate.mutate()}
/>

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
