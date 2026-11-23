<script lang="ts">
  /**
   * DateRecord: a date to be looked at (ADR-139 p1 A, flujos § 12). A
   * rehearsal, a trip, a day off, a residency, press, other: none has a page
   * of its own, and pressing one used to open its edit form, the type pills
   * on top and «Borrar» beside «Cancelar», to read at what time the train
   * leaves. Now it opens this, in the vistazo, and «Editar» opens the same
   * dialog as always.
   *
   * The shape of every record: RecordHead (address, name, facts), «Falta»,
   * then its blocks: a trip's stages, the running order of anything else,
   * and who goes. Those blocks save in place, as on a performance's page
   * (ADR-139 p7); the dialog keeps its own «Guardar».
   *
   * THE SHRUNK «PASE» (ADR-215, brief `ficha-pase` phase 4): the same piece
   * as a performance's page (`RecordPass`), the state as its tag, the hour
   * (or the day, when it has none), the project and the place; a stub of
   * three boxes (the hour, or a trip's stages; who goes; where), and the day
   * as stops (`RunningOrder placing="stops"`). No hotel, no technical, no
   * road sheet. A trip keeps its stages.
   *
   * Reads the row by id (`GET /api/dates/:id`, the list's own select) under a
   * key inside `planner-dates`, so every write that refreshes the date feeds
   * (`invalidateDateFeeds`) refreshes this too.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { loadFailKind, retryLoad } from '$lib/load-fail';
  import { DATE_STATUSES, dateStatusTone, invalidateDateFeeds } from '$lib/date';
  import RecordPass, { passToneVar, type PassAct, type PassBox, type PassLine } from './RecordPass.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { daysBetween } from '$lib/away';
  import { mapsHref } from '$lib/ahora';
  import { closePeek } from '$lib/peek.svelte';
  import { dateFacts } from '$lib/date-record';
  import { localDayISO, viewerTimeZone } from '$lib/datetime';
  import { appLocale, tHere, setRecordSpace } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { MISSING_MAX, dateMissing, dateReadiness, type DateMissing, type DateReadinessBox } from '$lib/record-missing';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import type { DateEvent } from '$lib/month-events';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import RecordState from '$lib/components/RecordState.svelte';
  import RunningOrder from '$lib/components/RunningOrder.svelte';
  import TravelStages, { stagesQuery } from '$lib/components/planner/TravelStages.svelte';
  import WhoGoes from '$lib/components/planner/WhoGoes.svelte';
  import EditDateDialog from '$lib/components/planner/EditDateDialog.svelte';
  import { TYPE_LABEL_KEYS, type DateTypeKey } from '$lib/quick-add';
  import { addToast } from '$lib/components/Toast.svelte';
  import { projectBolosQueryOptions } from '$lib/bolo-queries';
  import { boloLabel, suggestBoloForTrip } from '$lib/bolo-pick';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();
  setRecordSpace(() => row?.project?.workspace_id);
  const t = tHere();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const viewerTz = viewerTimeZone();

  const query = createQuery(
    toStore(() => ({
      // Inside `planner-dates`: the date feeds' invalidation reaches it.
      queryKey: ['planner-dates', 'one', id] as const,
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ item: DateEvent }>(`/api/dates/${encodeURIComponent(id)}`, signal),
    })),
  );
  let row = $derived($query.data?.item ?? null);

  const wsQuery = createQuery(workspacesQueryOptions());
  let space = $derived(($wsQuery.data?.items ?? []).find((w) => w.id === row?.project?.workspace_id) ?? null);
  let workspaceSlug = $derived(space?.slug ?? '');
  let tz = $derived(space?.timezone || viewerTz);

  let kind = $derived((row?.kind ?? 'other') as DateTypeKey);
  let kindWord = $derived(t(TYPE_LABEL_KEYS[kind] ?? 'create.type_other', locale));
  let info = $derived(row ? dateFacts(row, tz) : null);
  let title = $derived(info?.name ?? kindWord);
  let isTrip = $derived(kind === 'travel_day');

  let crumbs = $derived.by<Crumb[]>(() => {
    const out: Crumb[] = [];
    if (workspaceSlug) out.push(spaceCrumb(space?.name, workspaceSlug));
    if (row?.project && workspaceSlug) {
      out.push({ label: row.project.name, href: `/h/${workspaceSlug}/project/${row.project.slug}/` });
    }
    out.push({ label: kindWord });
    return out;
  });

  // ── Falta ──────────────────────────────────────────────────────────────
  // A trip's stages: the same cache entry TravelStages and the Day read.
  const stages = createQuery(toStore(() => ({ ...stagesQuery(id), enabled: isTrip, retry: false })));

  const today = localDayISO();
  let missing = $derived<DateMissing[]>(
    row && info
      ? dateMissing(
          {
            kind: row.kind,
            status: row.status,
            day: info.first,
            stages: isTrip && $stages.isSuccess ? $stages.data.stages.length : null,
          },
          today,
        )
      : [],
  );

  const patch = createMutation({
    mutationFn: (status: string) => mutateJSON('PATCH', `/api/dates/${encodeURIComponent(id)}`, { status }),
    onSuccess: () => {
      invalidateDateFeeds(queryClient);
      addToast({ tone: 'success', message: t('edit.saved', locale) });
    },
    onError: (err) => {
      addToast({ tone: 'danger', message: err instanceof Error ? err.message : t('perf.unexpected', locale) });
    },
  });

  let stagesEl: HTMLElement | undefined = $state();

  // ── Del bolo (ADR-245, fase 3 de «el viaje se ata a su bolo») ─────────
  // Los bolos se leen por la puerta de `read:money`: sin filas no hay nada que
  // ofrecer y la ficha calla (enmascarado y vacío se ven igual, como en el
  // selector función↔bolo). Hour sugiere el bolo; la persona lo confirma.
  const tripBolosQuery = createQuery(
    toStore(() => projectBolosQueryOptions(row?.project?.id ?? '', isTrip && Boolean(row?.project?.id))),
  );
  let tripBolos = $derived(($tripBolosQuery.data?.items ?? []).filter((b) => b.status !== 'cancelled' || b.id === row?.bolo_id));
  let tripBolo = $derived(row?.bolo_id ? (tripBolos.find((b) => b.id === row!.bolo_id) ?? null) : null);
  let suggestedBoloId = $derived(
    isTrip && row && !row.bolo_id && info
      ? suggestBoloForTrip({ day: info.first, direction: row.travel_direction ?? null }, tripBolos)
      : null,
  );
  let suggestedBolo = $derived(suggestedBoloId ? (tripBolos.find((b) => b.id === suggestedBoloId) ?? null) : null);
  // A bound bolo that the list does not carry (deleted, past the cap): say
  // nothing rather than offer a menu that would read «no bolo».
  let showTripBolo = $derived(isTrip && tripBolos.length > 0 && (!row?.bolo_id || tripBolo !== null));

  const bindBolo = createMutation({
    mutationFn: (boloId: string | null) =>
      mutateJSON('PATCH', `/api/dates/${encodeURIComponent(id)}`, { bolo_id: boloId }),
    onSuccess: () => {
      invalidateDateFeeds(queryClient);
      addToast({ tone: 'success', message: t('edit.saved', locale) });
    },
    onError: (err) => {
      addToast({ tone: 'danger', message: err instanceof Error ? err.message : t('perf.unexpected', locale) });
    },
  });

  function missingItem(m: DateMissing): PassLine {
    switch (m.kind) {
      case 'date_tentative':
        return {
          id: 'date_tentative',
          text: t('record.missing_date_tentative', locale),
          verbs: [
            { label: t('record.verb_confirm', locale), onclick: () => $patch.mutate('confirmed'), disabled: $patch.isPending },
            { label: t('record.verb_release', locale), onclick: () => $patch.mutate('cancelled'), disabled: $patch.isPending },
          ],
        };
      case 'trip_no_stages':
        return {
          id: 'trip_no_stages',
          text: t('record.missing_trip_no_stages', locale),
          verbs: [
            {
              label: t('record.verb_add', locale),
              onclick: () => {
                stagesEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                stagesEl?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
              },
            },
          ],
        };
    }
  }
  // ── El pase encogido (ADR-215) ─────────────────────────────────────────
  let going = $derived((row?.commitments ?? []).some((c) => c.state === 'going'));
  let readiness = $derived<DateReadinessBox[]>(
    row && info
      ? dateReadiness(
          {
            kind: row.kind,
            status: row.status,
            day: info.first,
            timed: info.start !== null,
            stages: isTrip && $stages.isSuccess ? $stages.data.stages.length : null,
            going: row.project ? going : null,
            place: Boolean(info.place || info.trip?.to || row.city || row.venue_name),
          },
          today,
        )
      : [],
  );
  const BOX_LABEL: Record<DateReadinessBox['id'], string> = {
    hours: 'pass.box_hours',
    stages: 'pass.box_stages',
    team: 'pass.box_team_date',
    place: 'pass.box_place',
  };
  let passBoxes = $derived<PassBox[]>(readiness.map((b) => ({ id: b.id, label: t(BOX_LABEL[b.id], locale), done: b.done })));

  function boxLine(b: DateReadinessBox): PassLine {
    switch (b.id) {
      case 'hours':
        return { id: 'hours', text: t('record.missing_no_time', locale), verbs: [{ label: t('peek.edit', locale), onclick: () => (editOpen = true) }] };
      case 'stages':
        return missingItem({ kind: 'trip_no_stages' });
      case 'team':
        return { id: 'team', text: t('record.missing_nobody_going', locale), verbs: [{ label: t('record.verb_sign_up', locale), href: '#who-goes' }] };
      case 'place':
        return { id: 'place', text: t('pass.line_no_place', locale), verbs: [{ label: t('peek.edit', locale), onclick: () => (editOpen = true) }] };
    }
  }
  let passLines = $derived<PassLine[]>(
    [
      ...missing.filter((m) => m.kind === 'date_tentative').map(missingItem),
      ...readiness.filter((b) => !b.done).map(boxLine),
    ].slice(0, MISSING_MAX),
  );

  let passWhen = $derived.by(() => {
    if (!info) return '';
    const d = daysBetween(today, info.first);
    if (d === 0) return t('pass.when_today', locale);
    if (d === 1) return t('pass.when_tomorrow', locale);
    if (d === -1) return t('pass.when_yesterday', locale);
    return t(d > 0 ? 'pass.when_in' : 'pass.when_ago', locale, { n: Math.abs(d) });
  });
  let passTime = $derived(info?.start ? (info.end ? `${info.start}–${info.end}` : info.start) : null);
  let passPlace = $derived(
    info?.trip ? [info.trip.from, info.trip.to].filter(Boolean).join(' → ') : (info?.place ?? ''),
  );
  let mapParts = $derived(row ? [row.venue_name, row.city] : []);
  let passActs = $derived<PassAct[]>(
    !isTrip && mapsHref(mapParts) !== null ? [{ id: 'map', label: t('ahora.map', locale), map: mapParts }] : [],
  );
  const STATUS_MENU = DATE_STATUSES;

  // ── Editar: the dialog of always, over the vistazo ─────────────────────
  let editOpen = $state(false);

  // Deleted from «Editar» (or from elsewhere while open): the row we were
  // looking at is gone, so the vistazo goes with it instead of showing a
  // copy of something that no longer exists.
  $effect(() => {
    if ($query.data && $query.isError && loadFailKind($query.error) === 'missing') closePeek();
  });
</script>

<article class="record date-record" aria-busy={$query.isLoading} data-testid="date-record">
  {#if $query.isLoading || !row}
    <RecordState
      loading={$query.isLoading}
      error={$query.error}
      missingText={t('peek.date_not_found', locale)}
      failedText={t('peek.date_load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else}
    <RecordHead slim {crumbs} {title} />

    <div class="pass-grid">
      <div class="pass-grid__left">

    <!-- El pase encogido (ADR-215): la pieza, el estado como etiqueta y un
         talón de tres casillas. Sin hotel, técnica ni hoja. -->
    <RecordPass
      {locale}
      project={row.project ? { slug: row.project.slug, name: row.project.name, accent: row.project.accent ?? null } : null}
      eyebrow={`${kindWord}${isTrip && row.travel_direction ? ` · ${t(`create.direction_${row.travel_direction}`, locale)}` : ''} · ${passWhen}`}
      dayIso={info?.first ?? row.starts_at.slice(0, 10)}
      dayIsoEnd={info?.last ?? null}
      time={passTime}
      timeOptional={isTrip}
      show={row.project?.name ?? null}
      place={passPlace}
      onEditDate={() => (editOpen = true)}
      onEditPlace={() => (editOpen = true)}
      editDateLabel={t('record.edit_when', locale)}
      editPlaceLabel={t('record.edit_where', locale)}
      acts={passActs}
      boxes={passBoxes}
      lines={passLines}
      label={t('pass.label_date', locale)}
    >
      {#snippet tag()}
        <Menu
          label={t('perf.status_menu', locale, { status: t(`edit.status_${row!.status}`, locale) })}
          triggerClass="pass__tag"
          triggerAttrs={{ 'data-testid': 'date-status', style: `--pass-tone: ${passToneVar(dateStatusTone(row!.status))}` }}
        >
          {#snippet trigger()}{t(`edit.status_${row!.status}`, locale)}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
          {#snippet children({ close })}
            {#each STATUS_MENU as s (s)}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  class="menu__item{s === row!.status ? ' menu__item--active' : ''}"
                  onclick={() => {
                    close();
                    if (s !== row!.status) $patch.mutate(s);
                  }}>{t(`edit.status_${s}`, locale)}</button
                >
              </li>
            {/each}
          {/snippet}
        </Menu>
      {/snippet}
    </RecordPass>

    {#if row.performance_id && workspaceSlug}
      <p class="date-record__of" data-slot="of">
        <span class="eyebrow eyebrow--sub">{t('peek.date_of_performance', locale)}</span>
        <a class="link-arrow" href={`/h/${workspaceSlug}/performance/${row.performance_id}`}>{t('peek.see_performance', locale)}</a>
      </p>
    {/if}

    {#if showTripBolo}
      <div class="date-record__of" data-slot="bolo" data-testid="trip-bolo">
        <span class="eyebrow eyebrow--sub">{t('trip.bolo_label', locale)}</span>
        <span class="date-record__bolo">
          {#if !tripBolo && suggestedBolo}
            <span data-testid="trip-bolo-suggested">{boloLabel(suggestedBolo, locale)}</span>
            <button
              type="button"
              class="fact-act"
              data-testid="trip-bolo-confirm"
              disabled={$bindBolo.isPending}
              onclick={() => $bindBolo.mutate(suggestedBolo!.id)}>{t('trip.bolo_confirm', locale)}</button
            >
          {/if}
          <Menu
            label={tripBolo ? t('trip.bolo_menu', locale, { bolo: boloLabel(tripBolo, locale) }) : t('trip.bolo_pick', locale)}
            triggerClass="fact-act"
            triggerAttrs={{ 'data-testid': 'trip-bolo-menu' }}
          >
            {#snippet trigger()}{tripBolo
                ? boloLabel(tripBolo, locale)
                : suggestedBolo
                  ? t('trip.bolo_other', locale)
                  : t('trip.bolo_pick', locale)}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
            {#snippet children({ close })}
              {#each tripBolos as b (b.id)}
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="menu__item{b.id === row!.bolo_id ? ' menu__item--active' : ''}"
                    onclick={() => {
                      close();
                      if (b.id !== row!.bolo_id) $bindBolo.mutate(b.id);
                    }}>{boloLabel(b, locale)}</button
                  >
                </li>
              {/each}
              {#if row!.bolo_id}
                <li class="menu-separator" role="separator"></li>
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="menu__item"
                    onclick={() => {
                      close();
                      $bindBolo.mutate(null);
                    }}>{t('trip.bolo_unbind', locale)}</button
                  >
                </li>
              {/if}
            {/snippet}
          </Menu>
        </span>
      </div>
    {/if}

    {#if row.project}
      <section class="date-record__section" id="who-goes" data-slot="who" aria-label={t('peek.who_goes', locale)}>
        <WhoGoes
          target="date"
          {id}
          workspaceId={row.project.workspace_id}
          commitments={row.commitments}
          compact
          {locale}
        />
      </section>
    {/if}

      </div>
      <div class="pass-grid__right">
        <div data-slot="day">
    {#if isTrip}
      <!-- What defines a trip, its stages: before only in the Day. -->
      <section class="date-record__section" aria-label={t('peek.stages', locale)} bind:this={stagesEl}>
        <TravelStages
          {id}
          dayIso={info?.first ?? row.starts_at.slice(0, 10)}
          {tz}
          {locale}
          origin={row.origin_city ?? null}
          workspaceId={row.project?.workspace_id ?? null}
        />
      </section>
    {:else}
      <RunningOrder
        target="date"
        {id}
        dayIso={info?.first ?? row.starts_at.slice(0, 10)}
        tz={row.venue?.timezone || tz}
        {viewerTz}
        {locale}
        placing="stops"
        title={t('pass.day_title', locale)}
      />
    {/if}

        </div>
      </div>
    </div>

    <EditDateDialog bind:open={editOpen} date={row} inSeries={Boolean(row.series_id)} />
  {/if}
</article>

<style>
  @layer components {
    .date-record__of {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      margin: 0;
    }
    .date-record__of .eyebrow {
      min-inline-size: var(--record-label-inline);
    }
    .date-record__bolo {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-s);
    }
    .date-record__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
