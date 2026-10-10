<script lang="ts" module>
  import { fetchJSON as fetchStages } from '$lib/api';
  import type { TravelStageRow as StageRow } from '$lib/travel-stage';

  export type StagesFeed = { stages: StageRow[]; can_edit: boolean };

  /** ONE query per trip, shared: this list and the day strip read the same
      cache entry, so a stage written here moves its bar up there. */
  export function stagesQuery(id: string) {
    return {
      queryKey: ['travel-stages', id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchStages<StagesFeed>(`/api/dates/${id}/stages`, signal),
    };
  }
</script>

<script lang="ts">
  /**
   * THE STAGES OF A TRIP · how a travel day gets from one end to the other
   * (ADR-089 P2, ADR-097).
   *
   * A travel day is `Barcelona → Sevilla` on its own row; this is what
   * happens in between, one line per stage: `8h15–10h40 TRAIN Barcelona →
   * Madrid`, `11h CAR Madrid → Sevilla`. It is optional: a trip with no
   * stages is a whole answer, and the lid says «empty» without apology.
   *
   * It is the running order's sibling, not a new thing: same place (the Day
   * view, under the strip, where a gig keeps its running order), same lid,
   * same hour column (`styles/hours.css`), same clock (`20h30`, typed and
   * read by `$lib/running-order`). A trip has no running order on purpose:
   * its day IS its stages.
   *
   * THE LEAST TYPING: a new stage asks for its hour, its mode and where it
   * goes. Where it leaves from is where the previous one arrived (or where
   * the trip starts), shown as the placeholder and stored if left alone. The
   * station, the booking reference and a note wait in the edit form.
   *
   * EACH END ITS OWN CLOCK (20261010160000): a flight leaves at 8h15 Madrid
   * time and lands at 9h40 London time, and each hour is typed and read in
   * its end's zone. The zone is said only where it is not the space's.
   *
   * THE ZONE IS KNOWN, NEVER GUESSED (Marco, 2026-10-10): each city field is
   * a `PlaceField` that offers candidates with country and zone from the
   * Worker's gazetteer (`$lib/places`), and the end takes the zone of the
   * place picked. «Valencia» is asked, not chosen. A new stage leaves in the
   * zone the stage before it arrived in (the same place, so the same clock).
   * Not picking is allowed and said: that end reads on the space's clock. A
   * place outside the gazetteer can still get its zone by hand in the edit
   * form.
   *
   * AN END CAN BE ONE OF THE SPACE'S VENUES (Marco, 2026-10-10), picked in
   * the same list, first: the stage links it (`*_venue_id`), its name is the
   * stage's place and its zone is the venue's. A hotel is a town picked for
   * the zone and its name written in the place field. When the day holds a
   * show, the new stage's destination OFFERS that show's venue on focus.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { mutateJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { addToast } from '../Toast.svelte';
  import PlaceField from './PlaceField.svelte';
  import type { PickedPlace } from '$lib/places';
  import { clockText, dayOf, endFor, instantFor, parseClock } from '$lib/running-order';
  import {
    TRANSPORT_MODES,
    chainedFrom,
    storedZone,
    zoneNote,
    type StageInput,
    type TransportMode,
    type TravelStageRow,
  } from '$lib/travel-stage';

  interface Props {
    /** The travel day (`date.id`). */
    id: string;
    /** The day being looked at, `YYYY-MM-DD`: where a typed hour lands. */
    dayIso: string;
    /** The space's clock: what an end without a zone of its own means. */
    tz: string;
    locale: Locale;
    /** Where the trip starts: what the first stage leaves from. */
    origin?: string | null;
    /** The space's country (ISO-2): its places are listed first. */
    spaceCountry?: string | null;
    /** The trip's space: its venues are offered first. */
    workspaceId?: string | null;
    /** Tonight's venue, offered as where the new stage arrives. */
    suggestVenue?: { venueId: string; name: string } | null;
    /** Whose stages these are, when the day holds more than one list. */
    name?: string | null;
  }

  let {
    id,
    dayIso,
    tz,
    locale,
    origin = null,
    spaceCountry = null,
    workspaceId = null,
    suggestVenue = null,
    name = null,
  }: Props = $props();

  const queryClient = useQueryClient();
  const queryKey = $derived(['travel-stages', id] as const);

  type Feed = StagesFeed;
  const feedStore = toStore(() => stagesQuery(id));
  const feed = createQuery(feedStore);

  /** Every IANA name this browser knows: the edit form's list for a zone
      typed by hand. Empty where the API is missing; the RPC still checks. */
  const ZONES: readonly string[] =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const departZoneOf = (s: Pick<TravelStageRow, 'depart_tz'>) => s.depart_tz ?? tz;
  const arriveZoneOf = (s: Pick<TravelStageRow, 'arrive_tz'>) => s.arrive_tz ?? tz;

  let stages = $derived($feed.data?.stages ?? []);
  /** Tonight's venue is offered until a stage already arrives there. */
  let offer = $derived(
    suggestVenue && !stages.some((st) => st.to_venue_id === suggestVenue.venueId) ? suggestVenue : null,
  );
  /** The countries this trip already goes through: listed first among the
      candidates (an order, never a choice). */
  let prefer = $derived([
    ...new Set(
      [spaceCountry, ...stages.flatMap((s) => [s.from_country, s.to_country])]
        .map((c) => c?.toUpperCase())
        .filter((c): c is string => Boolean(c)),
    ),
  ]);
  let canEdit = $derived($feed.data?.can_edit ?? false);

  const modeWord = (m: string) => t(`planner.mode_${m}`, locale);

  // ── Writing: every call answers with the whole list ───────────────────
  type Write =
    | { op: 'create'; body: StageInput }
    | { op: 'update'; stageId: string; body: StageInput }
    | { op: 'delete'; stageId: string };

  const save = createMutation({
    mutationFn: (w: Write) =>
      w.op === 'create'
        ? mutateJSON<{ stages: TravelStageRow[] }>('POST', `/api/dates/${id}/stages`, w.body)
        : w.op === 'update'
          ? mutateJSON<{ stages: TravelStageRow[] }>(
              'PUT',
              `/api/dates/${id}/stages/${w.stageId}`,
              w.body,
            )
          : mutateJSON<{ stages: TravelStageRow[] }>('DELETE', `/api/dates/${id}/stages/${w.stageId}`),
    onSuccess: (res) => {
      if (res) queryClient.setQueryData<Feed>(queryKey, (prev) => ({
        stages: res.stages,
        can_edit: prev?.can_edit ?? true,
      }));
    },
    onError: () => {
      addToast({ tone: 'danger', message: t('planner.trip_save_error', locale) });
    },
  });
  let pending = $derived($save.isPending);

  async function write(w: Write): Promise<boolean> {
    try {
      await $save.mutateAsync(w);
      return true;
    } catch {
      return false;
    }
  }

  /** The departures already on the list: the night rule reads them. */
  let departures = $derived(
    stages.filter((s) => s.depart_at).map((s) => ({ at: s.depart_at as string })),
  );

  let open = $state(true);

  // ── Adding: an hour, a mode, where it goes. ───────────────────────────
  let aClock = $state('');
  let aMode = $state<TransportMode>('train');
  let aFrom = $state('');
  let aTo = $state('');
  let aFromPick = $state<PickedPlace | null>(null);
  let aToPick = $state<PickedPlace | null>(null);
  let aBad = $state(false);
  /** A new stage's two clocks: where it leaves is the place picked, else
      the clock the stage before it arrived in (the same place), else the
      space's; where it arrives is the place picked, else the space's. */
  function zonesOf(fromPick: PickedPlace | null, chainTz: string | null, toPick: PickedPlace | null) {
    return {
      depart: fromPick ? (fromPick.tz ?? tz) : (chainTz ?? tz),
      arrive: toPick?.tz ?? tz,
    };
  }

  /**
   * Where a new stage lands, what it leaves from and in which clocks. The
   * hour means the zone it leaves in, and that zone comes from the stage
   * before it, which depends on the hour: so it is read twice, first on the
   * space's clock, then on the clock that first reading gave.
   */
  function placeNew(clock: { h: number; m: number } | null) {
    let chain = chainedFrom(stages, origin, clock ? instantFor(dayIso, clock, tz, departures) : null);
    let zones = zonesOf(aFromPick, chain.tz, aToPick);
    let depart_at = clock ? instantFor(dayIso, clock, zones.depart, departures) : null;
    if (clock && zones.depart !== tz) {
      chain = chainedFrom(stages, origin, depart_at);
      zones = zonesOf(aFromPick, chain.tz, aToPick);
      depart_at = instantFor(dayIso, clock, zones.depart, departures);
    }
    return { chain, zones, depart_at };
  }

  /** Where the new stage leaves from, following the hour being typed. */
  let chain = $derived.by(() => {
    const c = aClock.trim() ? parseClock(aClock) : null;
    return placeNew(c).chain;
  });

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (pending) return;
    const typed = aClock.trim();
    const clock = typed ? parseClock(typed) : null;
    aBad = typed !== '' && clock === null;
    if (aBad) return;
    const fromTyped = aFrom.trim();
    const { chain, zones, depart_at } = placeNew(clock);
    if (clock && !depart_at) {
      aBad = true;
      return;
    }
    const body: StageInput = {
      mode: aMode,
      from_city: fromTyped || chain.city,
      from_country: fromTyped ? (aFromPick?.country ?? null) : chain.country,
      from_place: fromTyped ? (aFromPick?.place ?? null) : chain.place,
      to_city: aTo.trim() || null,
      to_country: aToPick?.country ?? null,
      to_place: aToPick?.place ?? null,
      from_venue_id: fromTyped ? (aFromPick?.venueId ?? null) : chain.venueId,
      to_venue_id: aToPick?.venueId ?? null,
      depart_at,
      arrive_at: null,
      depart_tz: storedZone(zones.depart, tz),
      arrive_tz: storedZone(zones.arrive, tz),
      reference: null,
      notes: null,
    };
    if (await write({ op: 'create', body })) {
      aClock = '';
      aFrom = '';
      aTo = '';
      aFromPick = null;
      aToPick = null;
    }
  }

  // ── Editing one stage: the row becomes its form. ──────────────────────
  let editing = $state<string | null>(null);
  let e = $state({
    depart: '',
    arrive: '',
    mode: 'train' as TransportMode,
    fromCity: '',
    fromPlace: '',
    toCity: '',
    toPlace: '',
    reference: '',
    notes: '',
    departTz: '',
    arriveTz: '',
  });
  let eBad = $state(false);
  let eBadZone = $state(false);
  /** What an empty zone field means: the guess, shown as its placeholder. */
  /** The places picked for the two ends of the stage being edited. */
  let eFromPick = $state<PickedPlace | null>(null);
  let eToPick = $state<PickedPlace | null>(null);

  /** An end with a country was picked: it comes back as that pick. */
  function pickOf(
    city: string | null,
    place: string | null,
    country: string | null,
    zone: string | null,
    venueId: string | null,
  ): PickedPlace | null {
    if (venueId) return { city: city ?? place ?? '', place, country, tz: zone ?? tz, venueId };
    return city && country ? { city, place, country, tz: zone ?? tz } : null;
  }

  function startEdit(s: TravelStageRow) {
    editing = s.id;
    e = {
      depart: s.depart_at ? clockText(s.depart_at, departZoneOf(s)) : '',
      arrive: s.arrive_at ? clockText(s.arrive_at, arriveZoneOf(s)) : '',
      mode: s.mode,
      fromCity: s.from_city ?? '',
      fromPlace: s.from_place ?? '',
      toCity: s.to_city ?? '',
      toPlace: s.to_place ?? '',
      reference: s.reference ?? '',
      notes: s.notes ?? '',
      departTz: s.from_country || s.from_venue_id ? '' : (s.depart_tz ?? ''),
      arriveTz: s.to_country || s.to_venue_id ? '' : (s.arrive_tz ?? ''),
    };
    eFromPick = pickOf(s.from_city, s.from_place, s.from_country, s.depart_tz, s.from_venue_id);
    eToPick = pickOf(s.to_city, s.to_place, s.to_country, s.arrive_tz, s.to_venue_id);
    eBad = false;
    eBadZone = false;
  }

  function cancelEdit() {
    editing = null;
  }

  async function commitEdit(ev: SubmitEvent) {
    ev.preventDefault();
    const prev = stages.find((s) => s.id === editing);
    if (!prev || pending) return;
    const dClock = e.depart.trim() ? parseClock(e.depart) : null;
    const aClockE = e.arrive.trim() ? parseClock(e.arrive) : null;
    eBad = (e.depart.trim() !== '' && dClock === null) || (e.arrive.trim() !== '' && aClockE === null);
    // The pick says the zone; without one, a zone typed by hand; without
    // that, the space's clock.
    const dz = eFromPick ? (eFromPick.tz ?? tz) : e.departTz.trim() || tz;
    const az = eToPick ? (eToPick.tz ?? tz) : e.arriveTz.trim() || tz;
    // A zone the browser does not know is refused here, before the RPC does.
    eBadZone =
      ZONES.length > 0 && ((dz !== tz && !ZONES.includes(dz)) || (az !== tz && !ZONES.includes(az)));
    if (eBad || eBadZone) return;
    // An untouched hour in an untouched zone keeps its instant (a 0h30
    // arrival that already ran past midnight stays tomorrow); a new hour, or
    // the same hour in another clock, is placed like a new one.
    const keeps = (iso: string | null, c: { h: number; m: number } | null, was: string, now: string) => {
      if (!iso || !c || was !== now) return false;
      const w = parseClock(clockText(iso, now));
      return w !== null && w.h === c.h && w.m === c.m;
    };
    const others = departures.filter((d) => d.at !== prev.depart_at);
    const depart_at = !dClock
      ? null
      : keeps(prev.depart_at, dClock, departZoneOf(prev), dz)
        ? prev.depart_at
        : instantFor(dayIso, dClock, dz, others);
    const arrive_at = !aClockE
      ? null
      : keeps(prev.arrive_at, aClockE, arriveZoneOf(prev), az) &&
          (!depart_at || new Date(prev.arrive_at as string) >= new Date(depart_at))
        ? prev.arrive_at
        : depart_at
          ? endFor(depart_at, aClockE, az)
          : instantFor(dayIso, aClockE, az, others);
    if ((dClock && !depart_at) || (aClockE && !arrive_at)) {
      eBad = true;
      return;
    }
    const body: StageInput = {
      mode: e.mode,
      from_city: e.fromCity.trim() || null,
      from_country: eFromPick?.country ?? null,
      from_place: e.fromPlace.trim() || null,
      to_city: e.toCity.trim() || null,
      to_country: eToPick?.country ?? null,
      from_venue_id: eFromPick?.venueId ?? null,
      to_venue_id: eToPick?.venueId ?? null,
      to_place: e.toPlace.trim() || null,
      depart_at,
      arrive_at,
      depart_tz: storedZone(dz, tz),
      arrive_tz: storedZone(az, tz),
      reference: e.reference.trim() || null,
      notes: e.notes.trim() || null,
    };
    if (await write({ op: 'update', stageId: prev.id, body })) editing = null;
  }

  async function remove() {
    if (!editing || pending) return;
    if (await write({ op: 'delete', stageId: editing })) editing = null;
  }

  function onEditKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelEdit();
    }
  }

  /** Focus the first field of a row the moment it becomes a form. */
  function focusFirst(node: HTMLElement) {
    node.querySelector<HTMLInputElement>('input')?.select();
  }

  /** `Barcelona → Madrid`: the cities, or the places where no city was given. */
  function route(s: TravelStageRow): string | null {
    const a = s.from_city || s.from_place;
    const b = s.to_city || s.to_place;
    if (!a && !b) return null;
    return `${a ?? '…'} → ${b ?? '…'}`;
  }

  /** The faint line: the stations (when the main line did not already say
      them), the booking reference, the note. Only what somebody wrote. */
  function gloss(s: TravelStageRow): string | null {
    const parts: string[] = [];
    const fp = s.from_city ? s.from_place : null;
    const tp = s.to_city ? s.to_place : null;
    // One station alone keeps its side of the arrow: `→ Teatre Romà`.
    if (fp || tp) parts.push([fp, tp].map((x) => x ?? '').join(' → ').trim());
    if (s.reference) parts.push(s.reference);
    if (s.notes) parts.push(s.notes);
    return parts.length ? parts.join(' · ') : null;
  }

  let zoneListId = $derived(`ts-zones-${id}`);

  let lidWord = $derived(
    name ? `${t('planner.trip_title', locale)} · ${name}` : t('planner.trip_title', locale),
  );
</script>

<section class="hours ts" aria-busy={$feed.isPending}>
  <button type="button" class="lid" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="lid__w">{lidWord}</span>
    <span class="lid__n"
      >{stages.length === 0 ? t('planner.lid_empty', locale) : stages.length} {open ? '−' : '+'}</span
    >
  </button>

  {#if open}
    <ol class="hours__list">
      {#each stages as s (s.id)}
        {@const late = s.arrive_at ? dayOf(s.arrive_at, arriveZoneOf(s)) !== dayIso : false}
        {@const zn = zoneNote(s, tz)}
        {#if editing === s.id}
          <li class="hours__row hours__row--edit">
            <form class="hours__form" onsubmit={commitEdit} use:focusFirst>
              <span class="hours__at hours__at--edit">
                <input
                  class="hours__in hours__in--clock"
                  aria-label={t('planner.trip_depart', locale)}
                  aria-invalid={eBad}
                  placeholder="8h15"
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={e.depart}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
                <span class="hours__dash" aria-hidden="true">–</span>
                <input
                  class="hours__in hours__in--clock"
                  aria-label={t('planner.trip_arrive', locale)}
                  placeholder={t('planner.ro_until', locale)}
                  inputmode="numeric"
                  autocomplete="off"
                  bind:value={e.arrive}
                  onkeydown={onEditKey}
                  disabled={pending}
                />
              </span>
              <span class="hours__body">
                <span class="ts__grid">
                  <select
                    class="hours__in ts__mode"
                    aria-label={t('planner.trip_mode', locale)}
                    bind:value={e.mode}
                    onkeydown={onEditKey}
                    disabled={pending}
                  >
                    {#each TRANSPORT_MODES as m (m)}<option value={m}>{modeWord(m)}</option>{/each}
                  </select>
                  <PlaceField
                    bind:value={e.fromCity}
                    bind:picked={eFromPick}
                    label={t('planner.trip_from', locale)}
                    placeholder={t('planner.trip_from_ph', locale)}
                    {prefer}
                    spaceTz={tz}
                    {locale}
                    {workspaceId}
                    onkeydown={onEditKey}
                    onpick={(p) => (e.fromPlace = p.place ?? e.fromPlace)}
                    disabled={pending}
                  />
                  <span class="hours__dash" aria-hidden="true">→</span>
                  <PlaceField
                    bind:value={e.toCity}
                    bind:picked={eToPick}
                    label={t('planner.trip_to', locale)}
                    placeholder={t('planner.trip_to_ph', locale)}
                    {prefer}
                    spaceTz={tz}
                    {locale}
                    {workspaceId}
                    onkeydown={onEditKey}
                    onpick={(p) => (e.toPlace = p.place ?? e.toPlace)}
                    disabled={pending}
                  />
                  <span class="ts__gap" aria-hidden="true"></span>
                  <input
                    class="hours__in hours__in--notes"
                    aria-label={t('planner.trip_from_place', locale)}
                    placeholder={t('planner.trip_place_ph', locale)}
                    autocomplete="off"
                    bind:value={e.fromPlace}
                    onkeydown={onEditKey}
                    disabled={pending}
                  />
                  <span class="hours__dash" aria-hidden="true">→</span>
                  <input
                    class="hours__in hours__in--notes"
                    aria-label={t('planner.trip_to_place', locale)}
                    placeholder={t('planner.trip_place_ph', locale)}
                    autocomplete="off"
                    bind:value={e.toPlace}
                    onkeydown={onEditKey}
                    disabled={pending}
                  />
                  <span class="ts__gap" aria-hidden="true"></span>
                  <input
                    class="hours__in hours__in--notes"
                    aria-label={t('planner.trip_reference', locale)}
                    placeholder={t('planner.trip_reference_ph', locale)}
                    autocomplete="off"
                    bind:value={e.reference}
                    onkeydown={onEditKey}
                    disabled={pending}
                  />
                  <span class="ts__gap" aria-hidden="true"></span>
                  <input
                    class="hours__in hours__in--notes ts__note"
                    aria-label={t('planner.ro_notes', locale)}
                    placeholder={t('planner.ro_notes_ph', locale)}
                    autocomplete="off"
                    bind:value={e.notes}
                    onkeydown={onEditKey}
                    disabled={pending}
                  />
                  <!-- A ZONE BY HAND, only for an end without a picked place (a
                       village outside the gazetteer): a pick already says its
                       zone under the city. Empty = the space's clock. -->
                  {#if !eFromPick || !eToPick}
                    <span class="ts__gap" aria-hidden="true"></span>
                    {#if eFromPick}<span></span>{:else}
                      <input
                        class="hours__in hours__in--notes"
                        aria-label={t('planner.trip_depart_tz', locale)}
                        aria-invalid={eBadZone}
                        placeholder={t('planner.trip_zone_ph', locale, { zone: tz })}
                        list={zoneListId}
                        autocomplete="off"
                        bind:value={e.departTz}
                        onkeydown={onEditKey}
                        disabled={pending}
                      />
                    {/if}
                    <span class="hours__dash" aria-hidden="true">{eFromPick || eToPick ? '' : '→'}</span>
                    {#if eToPick}<span></span>{:else}
                      <input
                        class="hours__in hours__in--notes"
                        aria-label={t('planner.trip_arrive_tz', locale)}
                        aria-invalid={eBadZone}
                        placeholder={t('planner.trip_zone_ph', locale, { zone: tz })}
                        list={zoneListId}
                        autocomplete="off"
                        bind:value={e.arriveTz}
                        onkeydown={onEditKey}
                        disabled={pending}
                      />
                    {/if}
                  {/if}
                </span>
              </span>
              <span class="hours__acts">
                <button type="submit" class="hours__act" disabled={pending}>{t('planner.ro_save', locale)}</button>
                <button type="button" class="hours__act" onclick={cancelEdit} disabled={pending}
                  >{t('planner.ro_cancel', locale)}</button
                >
                <button type="button" class="hours__act hours__act--quiet" onclick={remove} disabled={pending}
                  >{t('planner.ro_remove', locale)}</button
                >
              </span>
            </form>
          </li>
        {:else}
          {@const r = route(s)}
          {@const g = gloss(s)}
          <li class="hours__row" data-mode={s.mode}>
            <svelte:element
              this={canEdit ? 'button' : 'div'}
              class="hours__line"
              {...canEdit
                ? {
                    type: 'button',
                    'aria-label': t('planner.trip_edit', locale, {
                      stage: r ?? modeWord(s.mode),
                    }),
                    onclick: () => startEdit(s),
                  }
                : {}}
            >
              <span class="hours__at"
                >{#if s.depart_at}{clockText(s.depart_at, departZoneOf(s))}{/if}{#if s.arrive_at}<span
                    class="hours__end">–{clockText(s.arrive_at, arriveZoneOf(s))}</span
                  >{#if late}<sup class="hours__plus" title={t('planner.ro_next_day', locale)}>+1</sup
                    >{/if}{/if}{#if zn}<span class="hours__n ts__zone" title={t('planner.trip_zone_note', locale)}
                    >{zn}</span
                  >{/if}</span
              >
              <span class="hours__body">
                <span class="hours__w"
                  ><i class="hours__k">{modeWord(s.mode)}</i>{#if r}{r}{/if}</span
                >
                {#if g}<span class="hours__n">{g}</span>{/if}
              </span>
            </svelte:element>
          </li>
        {/if}
      {/each}

      {#if canEdit}
        <li class="hours__row hours__row--add">
          <form class="hours__form" onsubmit={add}>
            <span class="hours__at hours__at--edit">
              <input
                class="hours__in hours__in--clock"
                aria-label={t('planner.trip_depart', locale)}
                aria-invalid={aBad}
                placeholder="8h15"
                inputmode="numeric"
                autocomplete="off"
                bind:value={aClock}
                disabled={pending}
              />
            </span>
            <span class="hours__body">
              <span class="ts__grid">
                <select
                  class="hours__in ts__mode"
                  aria-label={t('planner.trip_mode', locale)}
                  bind:value={aMode}
                  disabled={pending}
                >
                  {#each TRANSPORT_MODES as m (m)}<option value={m}>{modeWord(m)}</option>{/each}
                </select>
                <!-- Empty = where the stage before it arrived (the placeholder). -->
                <PlaceField
                  bind:value={aFrom}
                  bind:picked={aFromPick}
                  label={t('planner.trip_from', locale)}
                  placeholder={chain.city || chain.place || t('planner.trip_from_ph', locale)}
                  {prefer}
                  spaceTz={tz}
                  {locale}
                  {workspaceId}
                  disabled={pending}
                />
                <span class="hours__dash" aria-hidden="true">→</span>
                <PlaceField
                  bind:value={aTo}
                  bind:picked={aToPick}
                  label={t('planner.trip_to', locale)}
                  placeholder={offer
                    ? t('planner.trip_to_suggest', locale, { venue: offer.name })
                    : t('planner.trip_to_ph', locale)}
                  {prefer}
                  spaceTz={tz}
                  {locale}
                  {workspaceId}
                  suggest={offer}
                  disabled={pending}
                />
              </span>
            </span>
            <span class="hours__acts">
              <button type="submit" class="hours__act" disabled={pending || !aTo.trim()}
                >{t('planner.ro_add', locale)}</button
              >
            </span>
          </form>
        </li>
      {:else if stages.length === 0 && !$feed.isPending}
        <li class="hours__row hours__row--empty">{t('planner.trip_empty', locale)}</li>
      {/if}
    </ol>
    {#if aBad || eBad}<p class="hours__hint" role="status">{t('planner.ro_bad_clock', locale)}</p>{/if}
    {#if eBadZone}<p class="hours__hint" role="status">{t('planner.trip_bad_zone', locale)}</p>{/if}
    {#if editing}
      <datalist id={zoneListId}>
        {#each ZONES as z (z)}<option value={z}></option>{/each}
      </datalist>
    {/if}
  {/if}
</section>

<style>
  @layer components {
    /* The list (columns, rows, fields, verbs) is `styles/hours.css`, the
       running order's. Only the route is the trip's own.
       ONE MODE WIDTH, PASSED TO BOTH: the read row's mode word takes it
       through the list's own contract (`--hours-k`), the form's select and
       empty cells take it as their column, so the cities start at the same x
       whether a line is being read or written. */
    .ts {
      --ts-mode: 4.25rem;
      --hours-k: var(--ts-mode);
    }
    /* The form's body: mode · from · arrow · to, one grid for every line of
       it (the route, the stations, the reference and the note), so each
       field sits under the one it belongs to by construction. */
    .ts__grid {
      display: grid;
      grid-template-columns: var(--ts-mode) minmax(0, 1fr) auto minmax(0, 1fr);
      column-gap: var(--space-2xs);
      row-gap: var(--space-2xs);
      align-items: baseline;
    }
    .ts__mode {
      cursor: pointer;
    }
    /* The zone, under the hours it qualifies: only when an end is not on the
       space's clock. */
    .ts .hours__at .ts__zone {
      display: block;
      padding-inline-start: 0;
    }
    /* The faint line (stations, reference, note) starts under the cities,
       not under the mode word: it glosses the route. */
    .ts .hours__n {
      padding-inline-start: calc(var(--ts-mode) + var(--space-2xs));
    }
    /* A narrow host: the mode takes its own line and the route keeps its
       pair under it; the empty mode cells go, and the note keeps the right
       column it has on a wide screen. */
    @container (max-width: 30rem) {
      /* The list, not `.ts`: a container never matches its own query. */
      .hours__list {
        --hours-k: auto;
      }
      .ts__grid {
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      }
      .ts__mode {
        grid-column: 1 / -1;
        justify-self: start;
        inline-size: var(--ts-mode);
      }
      .ts__gap {
        display: none;
      }
      .ts__note {
        grid-column: 3;
      }
      .ts .hours__n {
        padding-inline-start: 0;
      }
    }
  }
</style>
