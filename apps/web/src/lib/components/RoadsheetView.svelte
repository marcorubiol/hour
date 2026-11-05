<script lang="ts">
  /**
   * Road sheet document — the render body shared by the operator page
   * (role preview, ADR-041) and the public token page (ADR-047). Pure
   * presentation over an already-filtered projection: the server decides
   * what `sheet` contains, this only draws non-null sections. Mobile-first
   * (read on a phone in a van), print-friendly (pinned to a dressing-room
   * door).
   *
   * 120 (ADR-177): Pau, the technician on his phone, asks «what time do I
   * load in and whom do I call?». So the sheet opens with where (the
   * address, «Llamar a Jordi», «Cómo llegar») and then the day in order, an
   * itinerary: trip stages and running-order moments in one list, with the
   * «now» line on the day itself. The hours come only from the plan
   * (`roadsheetDay`).
   */

  import { onMount, type Snippet } from 'svelte';
  import { DASH } from '$lib/glyphs';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import type { Crumb } from '$lib/record-crumbs';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { dayLabel, dualTime, hourMark, viewerTimeZone } from '$lib/datetime';
  import { dayKeyInTz } from '$lib/planner';
  import { stageRoute } from '$lib/travel-stage';
  import { LOCALE_TAG, appLocale, t, type Locale } from '$lib/i18n';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { materialHost, type Roadsheet, type RoadsheetTrip } from '$lib/roadsheet';
  import { nowLineIndex, roadsheetDay, type RoadsheetDayPoint } from '$lib/roadsheet-day';
  import { mapsHref, telHref, venueCall } from '$lib/ahora';
  import { firstName } from '$lib/acquaintance';
  import { momentWordKey } from '$lib/month-events';
  import type { VenueContact } from '$lib/venue';
  import { safeHref } from '$lib/utils/safe-url';

  let {
    sheet,
    venueTz = null,
    crumbs = null,
    tools,
    holder = null,
    late,
    locale = appLocale(),
  }: {
    sheet: Roadsheet;
    venueTz?: string | null;
    /** Where the sheet hangs (the operator page: space › project › Función).
        The public page has no way back, so it names the project and the kind. */
    crumbs?: Crumb[] | null;
    /** What acts on the sheet (the operator's «view as»), at the end of the title row. */
    tools?: Snippet;
    /** 121 B: whose sheet this is, already said («Hoja de Pau Roca · luces»). Personal link only. */
    holder?: string | null;
    /** 121 B: «Llego tarde», after where to go. Personal link only. */
    late?: Snippet;
    /** The reader's language. Internal sheet: whoever is looking; public
        sheet: the browser's if Hour speaks it, else English. Both are
        `appLocale()`, the default. */
    locale?: Locale;
  } = $props();

  /** The word for a DB enum value; the raw value with spaces when the
      dictionary has none. */
  function enumWord(prefix: string, value: string): string {
    const key = prefix + value;
    const word = t(key, locale);
    return word === key ? value.replace(/_/g, ' ') : word;
  }

  const viewerTz = viewerTimeZone();

  // ── Trips (ADR-166), drawn as Ahora draws them (ADR-146) ───────────────
  /** An hour on the clock of the end it belongs to; the trip's zone, else the viewer's. */
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  function tripDay(trip: RoadsheetTrip): string {
    return trip.all_day ? trip.starts_at.slice(0, 10) : dayKeyInTz(trip.starts_at, trip.tz || venueTz || viewerTz);
  }
  function tripWay(trip: RoadsheetTrip): string {
    return [trip.origin_city, trip.destination_city].filter(Boolean).join(' → ') || trip.title || t('planner.kind_travel_day', locale);
  }
  const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

  // ── Where (120): the address, whom to call, how to get there ──────────
  let place = $derived(
    [sheet.venue?.address, sheet.venue?.city ?? sheet.city].filter((x): x is string => Boolean(x)).join(' · '),
  );
  /** The venue's technician first, else production, else the main contact (Ahora's rule). */
  let call = $derived(venueCall(sheet.venue?.contacts));
  let mapHref = $derived(
    sheet.venue?.address
      ? mapsHref([sheet.venue.address, sheet.venue.city ?? sheet.city, sheet.venue.country ?? sheet.country])
      : mapsHref([sheet.venue?.name ?? sheet.venue_name, sheet.venue?.city ?? sheet.city, sheet.venue?.country ?? sheet.country]),
  );
  /** The venue's contacts as stored (`VenueContactSchema`); anything else is skipped. */
  let venueContacts = $derived(
    (Array.isArray(sheet.venue?.contacts) ? (sheet.venue!.contacts as unknown[]) : []).filter(
      (c): c is VenueContact =>
        !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' && (c as VenueContact).name.trim() !== '',
    ),
  );

  // ── The day in order (120) ─────────────────────────────────────────────
  let points = $derived(roadsheetDay(sheet));
  /** A trip with no hour is not a point: it is named above the list. */
  let untimedTrips = $derived((sheet.travel ?? []).filter((trip) => trip.stages.length === 0));
  let dayTz = $derived(venueTz || viewerTz);
  /** The minute, for the «now» line. Read on load and every 30 s. */
  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(id);
  });
  let nowAt = $derived(nowLineIndex(points, now, dayTz));

  function pointWord(p: RoadsheetDayPoint): string {
    if (p.of === 'stage') {
      const way = stageRoute(p.stage);
      return cap(t(`planner.mode_${p.stage.mode}`, locale)) + (way ? ` · ${way}` : '');
    }
    return cap(p.label?.trim() || (p.key ? t(momentWordKey(p.key), locale) : ''));
  }

  /** 121 B: «cambiado hoy a las 15:50 · antes 16:00», on the day's clock. */
  function movedWord(p: Extract<RoadsheetDayPoint, { of: 'moment' }>): string | null {
    if (!p.moved_from) return null;
    const before = dualTime(p.moved_from, venueTz, viewerTz).primary;
    if (!p.moved_at) return t('roadsheet.moved', locale, { before });
    const when = dualTime(p.moved_at, venueTz, viewerTz);
    return when.primaryDay === dayKeyInTz(now.toISOString(), dayTz)
      ? t('roadsheet.moved_today', locale, { time: when.primary, before })
      : t('roadsheet.moved', locale, { before });
  }

  let address = $derived<Crumb[]>(
    crumbs ?? [...(sheet.project ? [{ label: sheet.project.name }] : []), { label: t('roadsheet.title', locale) }],
  );
</script>

{#snippet nowLine()}
  <li class="rsv__now" data-testid="roadsheet-now">
    {t('roadsheet.now', locale, { time: dualTime(now.toISOString(), venueTz, viewerTz).primary })}
  </li>
{/snippet}

<div class="record rsv">
  <RecordHead crumbs={address} title={sheet.title} actions={tools}>
    {#snippet facts()}
      <StateBadge label={performanceStatusLabel(sheet.status, locale)} tone={performanceStatusTone(sheet.status)} />
      <span>{dayLabel(sheet.performed_at, 'long', LOCALE_TAG[locale])}</span>
      {#if sheet.city}<span>{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>{/if}
    {/snippet}
  </RecordHead>

  {#if holder}
    <p class="rsv__holder" data-testid="roadsheet-holder">{holder}</p>
  {/if}

  {#if sheet.venue || sheet.venue_name}
    <section class="rsv__section" aria-label={t('create.venue', locale)} data-testid="roadsheet-where">
      <div class="rsv__venue">
        <strong>{place || (sheet.venue?.name ?? sheet.venue_name)}</strong>
        {#if call}
          <span class="rsv__muted">{call.name}{call.role ? ` · ${call.role}` : ''}</span>
        {/if}
        {#if sheet.venue?.capacity}<span class="rsv__muted">{t('venue.capacity_short', locale, { n: sheet.venue.capacity })}</span>{/if}
      </div>
      {#if call?.phone || mapHref}
        <div class="rsv__acts">
          {#if call?.phone}
            <a class="rsv__act" href={telHref(call.phone)} data-testid="roadsheet-call"
              >{t('roadsheet.call', locale, { name: firstName(call.name) })}</a
            >
          {/if}
          {#if mapHref}
            <a class="rsv__act" href={mapHref} target="_blank" rel="noopener noreferrer" data-testid="roadsheet-directions"
              >{t('roadsheet.directions', locale)}</a
            >
          {/if}
        </div>
      {/if}
      {#if venueContacts.length > 0}
        <ul class="rsv__people" role="list" aria-label={t('venue.contacts', locale)}>
          {#each venueContacts as c, i (i)}
            <li>
              <span class="rsv__role">{c.role ?? ''}</span>
              <span class="rsv__name">
                {c.name}
                {#if c.phone || c.email}
                  <span class="rsv__contact">
                    {#if c.phone}<a href={telHref(c.phone)}>{c.phone}</a>{/if}{#if c.phone && c.email}{' · '}{/if}{#if c.email}<a
                        href={safeHref(`mailto:${c.email}`)}>{c.email}</a
                      >{/if}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {@render late?.()}

  {#if points.length > 0 || untimedTrips.length > 0}
    <section class="rsv__section" aria-label={t('roadsheet.day', locale)} data-testid="roadsheet-day">
      <BlockHead title={t('roadsheet.day', locale)} />
      {#each untimedTrips as trip (trip.id)}
        <p class="rsv__trip-head" data-testid="roadsheet-travel">
          <strong>{tripWay(trip)}</strong>
          <span class="rsv__muted">{dayLabel(tripDay(trip), 'long', LOCALE_TAG[locale])}</span>
        </p>
      {/each}
      {#if points.length > 0}
        <ol class="rsv__day" role="list">
          {#each points as p, i (i)}
            {#if nowAt === i}{@render nowLine()}{/if}
            {@const time = dualTime(p.at, p.of === 'stage' ? p.tz || venueTz : venueTz, viewerTz)}
            <li
              class="rsv__point"
              class:rsv__point--past={nowAt !== null && i < nowAt}
              class:rsv__point--show={p.of === 'moment' && p.key === 'start'}
              data-testid={p.of === 'stage' ? 'roadsheet-travel' : 'roadsheet-moment'}
            >
              <span class="rsv__at">
                {time.primary}
                {#if time.secondary}<span class="rsv__muted">{t('roadsheet.time_yours', locale, { time: time.secondary })}</span>{/if}
              </span>
              <span class="rsv__what">
                {pointWord(p)}
                {#if p.of === 'moment' && p.ends_at}
                  <span class="rsv__muted">{t('ahora.until', locale, { time: hour(p.ends_at, venueTz) })}</span>
                {/if}
                {#if p.of === 'moment' && movedWord(p)}
                  <span class="rsv__moved" data-testid="roadsheet-moved">{movedWord(p)}</span>
                {/if}
                {#if p.of === 'stage'}
                  {#if p.stage.arrive_at}<span class="rsv__muted"
                      >{t('ahora.arrives', locale, { time: hour(p.stage.arrive_at, p.stage.arrive_tz ?? p.trip.tz) })}</span
                    >{/if}
                  {#if p.stage.reference}<span class="rsv__contact">{t('ahora.reference', locale)} {p.stage.reference}</span>{/if}
                  {#if p.trip.going.length > 0}<span class="rsv__muted"
                      >{t('commitment.who_goes', locale)}: {p.trip.going.join(', ')}</span
                    >{/if}
                {/if}
              </span>
            </li>
          {/each}
          {#if nowAt === points.length}{@render nowLine()}{/if}
        </ol>
      {/if}
    </section>
  {/if}

  {#if hasJsonContent(sheet.logistics)}
    <section class="rsv__section" aria-label={t('perf.logistics', locale)}>
      <BlockHead title={t('perf.logistics', locale)} />
      <JsonKV value={sheet.logistics} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.hospitality)}
    <section class="rsv__section" aria-label={t('perf.hospitality', locale)}>
      <BlockHead title={t('perf.hospitality', locale)} />
      <JsonKV value={sheet.hospitality} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.technical)}
    <section class="rsv__section" aria-label={t('perf.technical', locale)}>
      <BlockHead title={t('perf.technical', locale)} />
      <JsonKV value={sheet.technical} />
    </section>
  {/if}

  {#if sheet.cast && sheet.cast.length > 0}
    <section class="rsv__section" aria-label={t('perf.cast', locale)}>
      <BlockHead title={t('perf.cast', locale)} />
      <ul class="rsv__people" role="list">
        {#each sheet.cast as m, i (i)}
          <li>
            <span class="rsv__role">{m.role}</span>
            <span class="rsv__name">
              {m.person?.full_name ?? DASH}
              {#if m.replaces}
                <span class="rsv__muted">{t('perf.replaces', locale, { name: m.replaces })}{#if m.reason}: {m.reason}{/if}</span>
              {/if}
              {#if m.person?.email || m.person?.phone}
                <span class="rsv__contact">
                  {#if m.person?.email}{m.person.email}{/if}{#if m.person?.email && m.person?.phone}{' · '}{/if}{#if m.person?.phone}<a
                      href={telHref(m.person.phone)}>{m.person.phone}</a
                    >{/if}
                </span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.crew && sheet.crew.length > 0}
    <section class="rsv__section" aria-label={t('perf.crew', locale)}>
      <BlockHead title={t('perf.crew', locale)} />
      <ul class="rsv__people" role="list">
        {#each sheet.crew as m, i (i)}
          <li>
            <span class="rsv__role">{m.role}</span>
            <span class="rsv__name">
              {m.person?.full_name ?? DASH}
              {#if m.notes}<span class="rsv__muted">{m.notes}</span>{/if}
              {#if m.person?.email || m.person?.phone}
                <span class="rsv__contact">
                  {#if m.person?.email}{m.person.email}{/if}{#if m.person?.email && m.person?.phone}{' · '}{/if}{#if m.person?.phone}<a
                      href={telHref(m.person.phone)}>{m.person.phone}</a
                    >{/if}
                </span>
              {/if}
              {#if hasJsonContent(m.contact_override)}
                <JsonKV value={m.contact_override!} />
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.contacts}
    <section class="rsv__section" aria-label={t('perf.programmer', locale)}>
      <BlockHead title={t('perf.programmer', locale)} />
      <p class="rsv__programmer">
        {sheet.contacts.programmer.full_name}
        {#if sheet.contacts.programmer.email || sheet.contacts.programmer.phone}
          <span class="rsv__contact">
            {[sheet.contacts.programmer.email, sheet.contacts.programmer.phone]
              .filter(Boolean)
              .join(' · ')}
          </span>
        {/if}
      </p>
    </section>
  {/if}

  {#if (sheet.materials?.length ?? 0) > 0 || (sheet.assets?.length ?? 0) > 0}
    <section class="rsv__section" aria-label={t('perf.assets', locale)} data-testid="roadsheet-materials">
      <BlockHead title={t('perf.assets', locale)} />
      <ul class="rsv__people" role="list">
        {#each sheet.materials ?? [] as m, i (i)}
          <li>
            <span class="rsv__role">{enumWord('perf.asset_kind_', m.kind)}</span>
            <a class="rsv__name rsv__link" href={safeHref(m.url)} target="_blank" rel="noopener noreferrer">{materialHost(m.url)}</a>
          </li>
        {/each}
        {#each sheet.assets ?? [] as a, i (i)}
          <li>
            <span class="rsv__role">{enumWord('perf.asset_dir_', a.direction)}</span>
            <span class="rsv__name">{enumWord('perf.asset_kind_', a.kind)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.notes}
    <section class="rsv__section" aria-label={t('perf.notes', locale)}>
      <BlockHead title={t('perf.notes', locale)} />
      <p class="rsv__notes">{sheet.notes}</p>
    </section>
  {/if}
</div>

<style>
  @layer components {

    .rsv__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: 0;
    }

    /* Whose sheet: a personal link says it under the title. */
    .rsv__holder {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    /* A time production moved after a «llego tarde»: said in the hand of a change. */
    .rsv__moved {
      display: block;
      font-size: var(--text-xs);
      color: var(--tone-warning-fg);
    }

    .rsv__venue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    /* «Llamar a Jordi» · «Cómo llegar»: two halves, at the thumb's size. */
    .rsv__acts {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-s);
    }

    .rsv__act {
      display: flex;
      align-items: center;
      justify-content: center;
      min-block-size: calc(var(--touch-target) + var(--space-xl));
      padding: var(--space-xs) var(--space-s);
      border: var(--line-hairline) solid var(--border-color-dark);
      border-radius: var(--radius-m);
      font-size: var(--text-s);
      color: var(--heading-color);
      text-align: center;
      text-decoration: none;
    }

    .rsv__act:hover {
      border-color: var(--heading-color);
    }

    /* The day, an itinerary: the hour, then what. */
    .rsv__point {
      display: grid;
      grid-template-columns: var(--record-label-inline) minmax(0, 1fr);
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-s);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .rsv__at {
      font-family: var(--font-mono);
      font-size: var(--text-s);
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }

    .rsv__what {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__point--show .rsv__what {
      font-weight: var(--today-weight);
      color: var(--heading-color);
    }

    .rsv__point--past .rsv__at,
    .rsv__point--past .rsv__what {
      color: var(--text-faint);
    }

    /* The «now» line: a hairline with its hour, between what is done and what comes. */
    .rsv__now {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding-block: var(--space-2xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--today-ink);
    }

    .rsv__now::after {
      content: '';
      flex: 1;
      border-block-start: var(--line-hairline) solid var(--today-ink);
    }

    @media print {
      .rsv__acts,
      .rsv__now {
        display: none;
      }
    }

    .rsv__trip-head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__people li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .rsv__role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
      min-inline-size: var(--record-label-inline);
    }

    .rsv__name {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__link {
      overflow-wrap: anywhere;
    }

    .rsv__muted {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rsv__contact {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rsv__programmer {
      font-size: var(--text-s);
    }

    .rsv__notes {
      font-size: var(--text-s);
      white-space: pre-wrap;
      line-height: 1.55;
    }

  }
</style>
