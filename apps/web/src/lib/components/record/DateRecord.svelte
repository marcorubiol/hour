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
   * Reads the row by id (`GET /api/dates/:id`, the list's own select) under a
   * key inside `planner-dates`, so every write that refreshes the date feeds
   * (`invalidateDateFeeds`) refreshes this too.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { loadFailKind, retryLoad } from '$lib/load-fail';
  import { dateStatusFamily, invalidateDateFeeds } from '$lib/date';
  import { closePeek } from '$lib/peek.svelte';
  import { dateFacts } from '$lib/date-record';
  import { dayLabel, localDayISO, viewerTimeZone } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { dateMissing, type DateMissing } from '$lib/record-missing';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import type { DateEvent } from '$lib/month-events';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import RecordState from '$lib/components/RecordState.svelte';
  import MissingBand, { type MissingItem } from '$lib/components/MissingBand.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import RunningOrder from '$lib/components/RunningOrder.svelte';
  import TravelStages, { stagesQuery } from '$lib/components/planner/TravelStages.svelte';
  import WhoGoes from '$lib/components/planner/WhoGoes.svelte';
  import EditDateDialog from '$lib/components/planner/EditDateDialog.svelte';
  import { TYPE_LABEL_KEYS, type DateTypeKey } from '$lib/quick-add';
  import { addToast } from '$lib/components/Toast.svelte';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

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

  let whenText = $derived.by(() => {
    if (!info) return '';
    const days = info.first === info.last ? dayLabel(info.first) : `${dayLabel(info.first)} – ${dayLabel(info.last)}`;
    return days;
  });
  let hoursText = $derived(
    !info ? '' : info.start ? (info.end ? `${info.start}–${info.end}` : info.start) : t('peek.all_day', locale),
  );

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

  function missingItem(m: DateMissing): MissingItem {
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
  let missingItems = $derived(missing.map(missingItem));

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
    <RecordHead {crumbs} {title}>
      {#snippet actions()}
        <Button variant="secondary" size="xs" onclick={() => (editOpen = true)}>{t('peek.edit', locale)}</Button>
      {/snippet}
      {#snippet facts()}
        <span class="fact-word" data-family={dateStatusFamily(row!.status)}>{t(`edit.status_${row!.status}`, locale).toLowerCase()}</span>
        <span>{whenText}</span>
        <span class="date-record__hours">{hoursText}</span>
        {#if isTrip && row!.travel_direction}<span>{t(`create.direction_${row!.travel_direction}`, locale)}</span>{/if}
        {#if info?.place}<span>{info.place}</span>{/if}
      {/snippet}
      {#snippet band()}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    {#if row.performance_id && workspaceSlug}
      <p class="date-record__of">
        <span class="eyebrow eyebrow--sub">{t('peek.date_of_performance', locale)}</span>
        <a class="link-arrow" href={`/h/${workspaceSlug}/performance/${row.performance_id}`}>{t('peek.see_performance', locale)}</a>
      </p>
    {/if}

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
      <RunningOrder target="date" {id} dayIso={info?.first ?? row.starts_at.slice(0, 10)} tz={row.venue?.timezone || tz} {viewerTz} {locale} />
    {/if}

    {#if row.project}
      <section class="date-record__section" aria-label={t('peek.who_goes', locale)}>
        <WhoGoes
          target="date"
          {id}
          workspaceId={row.project.workspace_id}
          commitments={row.commitments}
          {locale}
        />
      </section>
    {/if}

    <EditDateDialog bind:open={editOpen} date={row} inSeries={Boolean(row.series_id)} />
  {/if}
</article>

<style>
  @layer components {
    .date-record__hours {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .date-record__of {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      margin: 0;
    }
    .date-record__of .eyebrow {
      min-inline-size: var(--record-label-inline);
    }
    .date-record__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
