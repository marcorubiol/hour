<script lang="ts">
  /**
   * PassSheet — the pass in READ MODE (ADR-224, «el pase es la hoja de ruta»).
   * What a person with no account opens from a link, and what the operator's
   * «view as» shows: the same filled piece as the record's, drawn only from a
   * road sheet projection the server already cut to the reader's role. It
   * decides nothing and hides nothing itself: every fold is drawn only when
   * its data is there.
   *
   *   [piece]   FUNCIÓN · EN 3 DÍAS · state · the hour · show · room, city
   *             ┄┄┄ stub: «Hoja de Pau Roca · luces» / «Hoja para la sala»
   *             [Llamar a Pere] [Mapa]
   *   «Llego tarde» (personal link, on the day)
   *   the note for whoever receives the sheet (every role, ADR-226)
   *   EL DÍA, PARADA A PARADA — a vertical line of stops, the show the big one
   *   folds: contacts · logistics · hospitality · technical and materials ·
   *   who goes (team) / who comes (venue) · programmer · notes
   *
   * Light on purpose: the public page has no app shell, so this imports
   * nothing that reads an authenticated feed. The hours come only from the
   * plan (`roadsheetDay`); the «now» line, moved times and the two time zones
   * are as the road sheet had them (ADR-177, ADR-183).
   */

  import { flushSync, onMount, type Snippet } from 'svelte';
  import { DASH } from '$lib/glyphs';
  import Fold from '$lib/components/Fold.svelte';
  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import RecordPass, { passToneVar, type PassAct } from './RecordPass.svelte';
  import { dayLabel, dualTime, hourMark, viewerTimeZone } from '$lib/datetime';
  import { dayKeyInTz } from '$lib/planner';
  import { stageRoute } from '$lib/travel-stage';
  import { LOCALE_TAG, appLocale, t, type Locale } from '$lib/i18n';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { materialHost, type Roadsheet, type RoadsheetTrip } from '$lib/roadsheet';
  import { nowLineIndex, roadsheetDay, type RoadsheetDayPoint } from '$lib/roadsheet-day';
  import { MAPS_APP_NAME, mapsHref, telHref, venueCall } from '$lib/ahora';
  import { mapsPref } from '$lib/maps-app.svelte';
  import MapLink from '$lib/components/MapLink.svelte';
  import { firstName } from '$lib/acquaintance';
  import { momentWordKey } from '$lib/month-events';
  import { foldKeeps, jsonSummary, passEyebrow, passFigure, peopleSummary, showStartAt } from '$lib/pass-read';
  import type { VenueContact } from '$lib/venue';
  import { safeHref } from '$lib/utils/safe-url';

  let {
    sheet,
    venueTz = null,
    holder = null,
    late,
    heading = true,
    locale = appLocale(),
  }: {
    sheet: Roadsheet;
    venueTz?: string | null;
    /** Whose sheet this is, already said («Hoja de Pau Roca · luces»). Personal link only. */
    holder?: string | null;
    /** «Llego tarde», under the piece. Personal link only. */
    late?: Snippet;
    /** The visually hidden h1. Off where the page already has one (the operator's head). */
    heading?: boolean;
    /** The reader's language: whoever is looking (operator) or the browser's if Hour speaks it. */
    locale?: Locale;
  } = $props();

  /** The word for a DB enum value; the raw value with spaces when the dictionary has none. */
  function enumWord(prefix: string, value: string): string {
    const key = prefix + value;
    const word = t(key, locale);
    return word === key ? value.replace(/_/g, ' ') : word;
  }

  const viewerTz = viewerTimeZone();
  let dayTz = $derived(venueTz || viewerTz);

  /** The minute, for the «now» line and the eyebrow. Read on load and every 30 s. */
  let now = $state(new Date());
  /** Printing opens every fold: a pinned sheet has nothing to tap. */
  let printing = $state(false);
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 30_000);
    const before = () => {
      printing = true;
      flushSync();
    };
    const after = () => (printing = false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  });

  // ── The piece ──────────────────────────────────────────────────────────
  let today = $derived(dayKeyInTz(now.toISOString(), dayTz));
  let eyebrow = $derived(passEyebrow(t('perf.label', locale), today, sheet.performed_at, locale));
  let figure = $derived(passFigure(showStartAt(sheet.schedule), dayTz));
  let roomName = $derived(sheet.venue?.name ?? sheet.venue_name);
  let city = $derived(sheet.venue?.city ?? sheet.city);
  let placeLine = $derived([roomName, city].filter(Boolean).join(' · '));
  let stubLine = $derived(holder ?? t(`pass.sheet_for_${sheet.role}`, locale));

  // ── Where (120): the address, whom to call, how to get there ──────────
  /** The venue's technician first, else production, else the main contact (Ahora's rule). */
  let call = $derived(venueCall(sheet.venue?.contacts));
  let mapParts = $derived(
    sheet.venue?.address
      ? [sheet.venue.address, sheet.venue.city ?? sheet.city, sheet.venue.country ?? sheet.country]
      : [sheet.venue?.name ?? sheet.venue_name, sheet.venue?.city ?? sheet.city, sheet.venue?.country ?? sheet.country],
  );
  let mapHref = $derived(mapsHref(mapParts));
  /** «Cambiar»: there are no Settings on a public sheet, so the choice changes here. */
  let mapLink: ReturnType<typeof MapLink> | undefined = $state();
  /**
   * Whom the call act dials. The venue's own technician (`call`) makes no
   * sense on the venue's sheet: there the call is the company's (ADR-226), a
   * person by first name and the company by its name. Every other role keeps
   * the venue's contact.
   */
  let companyCall = $derived(sheet.role === 'venue' ? sheet.company_contact : null);
  let acts = $derived.by<PassAct[]>(() => {
    const out: PassAct[] = [];
    if (sheet.role === 'venue') {
      if (companyCall?.phone) {
        out.push({
          id: 'call',
          label: t('roadsheet.call', locale, {
            name: companyCall.kind === 'person' ? firstName(companyCall.name) : companyCall.name,
          }),
          href: telHref(companyCall.phone),
          testid: 'roadsheet-company-call',
        });
      }
    } else if (call?.phone) {
      out.push({
        id: 'call',
        label: t('roadsheet.call', locale, { name: firstName(call.name) }),
        href: telHref(call.phone),
        testid: 'roadsheet-call',
      });
    }
    if (mapHref) {
      out.push({ id: 'map', label: t('ahora.map', locale), map: mapParts, changeIn: 'here', testid: 'roadsheet-directions' });
    }
    return out;
  });
  let address = $derived(
    [sheet.venue?.address, sheet.venue?.city ?? sheet.city].filter((x): x is string => Boolean(x)).join(' · '),
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
  let nowAt = $derived(nowLineIndex(points, now, dayTz));

  /** An hour on the clock of the end it belongs to; the trip's zone, else the viewer's. */
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  function tripDay(trip: RoadsheetTrip): string {
    return trip.all_day ? trip.starts_at.slice(0, 10) : dayKeyInTz(trip.starts_at, trip.tz || venueTz || viewerTz);
  }
  function tripWay(trip: RoadsheetTrip): string {
    return [trip.origin_city, trip.destination_city].filter(Boolean).join(' → ') || trip.title || t('planner.kind_travel_day', locale);
  }
  const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

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

  // ── The folds ──────────────────────────────────────────────────────────
  /** Which folds the reader opened; printing opens all of them. */
  let opened = $state<Record<string, boolean>>({});
  const isOpen = (id: string) => printing || !!opened[id];
  const setOpen = (id: string, v: boolean) => (opened[id] = v);

  const hasContact = (m: { person: { email?: string | null; phone?: string | null } | null; contact_override?: unknown }) =>
    Boolean(m.person?.email || m.person?.phone || hasJsonContent(m.contact_override as never));
  let team = $derived([...(sheet.cast ?? []), ...(sheet.crew ?? [])]);
  let teamKeeps = $derived(peopleSummary(team.length, team.some(hasContact), locale));
  let contactsKeeps = $derived(
    peopleSummary(venueContacts.length, venueContacts.some((c) => c.phone || c.email), locale),
  );
  let materialWords = $derived(
    [...new Set((sheet.materials ?? []).map((m) => enumWord('perf.asset_kind_', m.kind)))].slice(0, 3),
  );
  let hasTech = $derived(
    hasJsonContent(sheet.technical) || (sheet.materials?.length ?? 0) > 0 || (sheet.assets?.length ?? 0) > 0,
  );
  let techKeeps = $derived(foldKeeps(materialWords.join(' · '), jsonSummary(sheet.technical, 2)));
</script>

{#snippet nowLine()}
  <li class="ps__now" data-testid="roadsheet-now">
    <span class="ps__now-body">
      {t('roadsheet.now', locale, { time: dualTime(now.toISOString(), venueTz, viewerTz).primary })}
    </span>
  </li>
{/snippet}

<div class="ps">
  <!-- The page's one heading: the pass draws the show as a figure, not a title. -->
  {#if heading}<h1 class="visually-hidden">{sheet.title}</h1>{/if}

  <RecordPass
    read
    {locale}
    project={sheet.project ? { slug: sheet.project.slug, name: sheet.project.name, accent: null } : null}
    {eyebrow}
    dayIso={sheet.performed_at.slice(0, 10)}
    time={figure}
    show={sheet.project?.name ?? null}
    place={placeLine}
    {acts}
    boxes={[]}
    {stubLine}
    stubTestid={holder ? 'roadsheet-holder' : undefined}
    bind:mapLink
  >
    {#snippet tag()}
      <span class="pass__tag" style={`--pass-tone: ${passToneVar(performanceStatusTone(sheet.status))}`}
        >{performanceStatusLabel(sheet.status, locale)}</span
      >
    {/snippet}
  </RecordPass>

  {#if roomName || address}
    <div class="ps__where" data-testid="roadsheet-where">
      {#if address}<span>{address}</span>{/if}
      {#if call}<span>{call.name}{call.role ? ` · ${call.role}` : ''}</span>{/if}
      {#if sheet.venue?.capacity}<span>{t('venue.capacity_short', locale, { n: sheet.venue.capacity })}</span>{/if}
      {#if mapHref && mapsPref.app}
        <!-- «Abre en Waze · Cambiar», quiet, only once an app is saved. -->
        <span class="ps__maps" data-testid="roadsheet-maps-app">
          {t('maps.opens_in', locale, { app: MAPS_APP_NAME[mapsPref.app] })}
          <button type="button" class="ps__maps-change" onclick={() => mapLink?.choose()}>{t('maps.change', locale)}</button>
        </span>
      {/if}
    </div>
  {/if}

  {#if late}
    <div class="ps__late">{@render late()}</div>
  {/if}

  <!-- ADR-226: what the company wants said to whoever opens the sheet. Quiet, before the day. -->
  {#if sheet.shared_note}
    <section class="ps__shared" aria-label={t('pass.shared_note', locale)} data-testid="roadsheet-shared-note">
      <h2 class="ps__label">{t('pass.shared_note', locale)}</h2>
      <p class="ps__shared-text">{sheet.shared_note}</p>
    </section>
  {/if}

  {#if points.length > 0 || untimedTrips.length > 0}
    <section class="ps__day-block" aria-label={t('pass.day_stops', locale)} data-testid="roadsheet-day">
      <h2 class="ps__label">{t('pass.day_stops', locale)}</h2>
      {#each untimedTrips as trip (trip.id)}
        <p class="ps__trip-head" data-testid="roadsheet-travel">
          <strong>{tripWay(trip)}</strong>
          <span class="ps__muted">{dayLabel(tripDay(trip), 'long', LOCALE_TAG[locale])}</span>
        </p>
      {/each}
      {#if points.length > 0}
        <ol class="ps__day" role="list">
          {#each points as p, i (i)}
            {#if nowAt === i}{@render nowLine()}{/if}
            {@const time = dualTime(p.at, p.of === 'stage' ? p.tz || venueTz : venueTz, viewerTz)}
            <li
              class="ps__point"
              class:ps__point--past={nowAt !== null && i < nowAt}
              class:ps__point--show={p.of === 'moment' && p.key === 'start'}
              data-testid={p.of === 'stage' ? 'roadsheet-travel' : 'roadsheet-moment'}
            >
              <span class="ps__at">
                {#if p.of === 'stage' && time.primaryDay !== sheet.performed_at.slice(0, 10)}
                  <span class="ps__muted">{dayLabel(time.primaryDay, 'short', LOCALE_TAG[locale])} · </span>
                {/if}
                {time.primary}
                {#if time.secondary}<span class="ps__muted">{t('roadsheet.time_yours', locale, { time: time.secondary })}</span>{/if}
              </span>
              <span class="ps__what">
                <span class="ps__word">{pointWord(p)}</span>
                {#if p.of === 'moment' && p.ends_at}
                  <span class="ps__muted">{t('ahora.until', locale, { time: hour(p.ends_at, venueTz) })}</span>
                {/if}
                {#if p.of === 'moment' && movedWord(p)}
                  <span class="ps__moved" data-testid="roadsheet-moved">{movedWord(p)}</span>
                {/if}
                {#if p.of === 'stage'}
                  {#if p.stage.arrive_at}<span class="ps__muted"
                      >{t('ahora.arrives', locale, { time: hour(p.stage.arrive_at, p.stage.arrive_tz ?? p.trip.tz) })}</span
                    >{/if}
                  {#if p.stage.reference}<span class="ps__muted">{t('ahora.reference', locale)} {p.stage.reference}</span>{/if}
                  {#if p.trip.going.length > 0}<span class="ps__muted"
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

  <div class="ps__folds">
    {#if venueContacts.length > 0}
      <Fold word={t('venue.contacts', locale)} keeps={contactsKeeps} id="ps-contacts" testid="roadsheet-contacts" bind:open={() => isOpen('contacts'), (v) => setOpen('contacts', v)}>
        <ul class="ps__people" role="list" aria-label={t('venue.contacts', locale)}>
          {#each venueContacts as c, i (i)}
            <li>
              <span class="ps__role">{c.role ?? ''}</span>
              <span class="ps__name">
                {c.name}
                {#if c.phone || c.email}
                  <span class="ps__contact">
                    {#if c.phone}<a href={telHref(c.phone)}>{c.phone}</a>{/if}{#if c.phone && c.email}{' · '}{/if}{#if c.email}<a
                        href={safeHref(`mailto:${c.email}`)}>{c.email}</a
                      >{/if}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </Fold>
    {/if}

    {#if hasJsonContent(sheet.logistics)}
      <Fold word={t('perf.logistics', locale)} keeps={jsonSummary(sheet.logistics, 2)} id="ps-logistics" bind:open={() => isOpen('logistics'), (v) => setOpen('logistics', v)}>
        <JsonKV value={sheet.logistics!} />
      </Fold>
    {/if}

    {#if hasJsonContent(sheet.hospitality)}
      <Fold word={t('perf.hospitality', locale)} keeps={jsonSummary(sheet.hospitality, 2)} id="ps-hospitality" bind:open={() => isOpen('hospitality'), (v) => setOpen('hospitality', v)}>
        <JsonKV value={sheet.hospitality!} />
      </Fold>
    {/if}

    {#if hasTech}
      <Fold word={t('pass.fold_tech', locale)} keeps={techKeeps} id="ps-tech" testid="roadsheet-materials" bind:open={() => isOpen('tech'), (v) => setOpen('tech', v)}>
        {#if hasJsonContent(sheet.technical)}<JsonKV value={sheet.technical!} />{/if}
        {#if (sheet.materials?.length ?? 0) > 0 || (sheet.assets?.length ?? 0) > 0}
          <ul class="ps__people" role="list" aria-label={t('perf.assets', locale)}>
            {#each sheet.materials ?? [] as m, i (i)}
              <li>
                <span class="ps__role">{enumWord('perf.asset_kind_', m.kind)}</span>
                <a class="ps__name ps__link" href={safeHref(m.url)} target="_blank" rel="noopener noreferrer">{materialHost(m.url)}</a>
              </li>
            {/each}
            {#each sheet.assets ?? [] as a, i (i)}
              <li>
                <span class="ps__role">{enumWord('perf.asset_dir_', a.direction)}</span>
                <span class="ps__name">{enumWord('perf.asset_kind_', a.kind)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </Fold>
    {/if}

    {#if team.length > 0}
      <Fold
        word={t(sheet.role === 'venue' ? 'pass.people_comes' : 'pass.people_goes', locale)}
        keeps={teamKeeps}
        id="ps-team"
        testid="roadsheet-team"
        bind:open={() => isOpen('team'), (v) => setOpen('team', v)}
      >
        {#if sheet.cast && sheet.cast.length > 0}
          <ul class="ps__people" role="list" aria-label={t('perf.cast', locale)}>
            {#each sheet.cast as m, i (i)}
              <li>
                <span class="ps__role">{m.role}</span>
                <span class="ps__name">
                  {m.person?.full_name ?? DASH}
                  {#if m.replaces}
                    <span class="ps__muted">{t('perf.replaces', locale, { name: m.replaces })}{#if m.reason}: {m.reason}{/if}</span>
                  {/if}
                  {#if m.person?.email || m.person?.phone}
                    <span class="ps__contact">
                      {#if m.person?.email}{m.person.email}{/if}{#if m.person?.email && m.person?.phone}{' · '}{/if}{#if m.person?.phone}<a
                          href={telHref(m.person.phone)}>{m.person.phone}</a
                        >{/if}
                    </span>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if sheet.crew && sheet.crew.length > 0}
          <ul class="ps__people" role="list" aria-label={t('perf.crew', locale)}>
            {#each sheet.crew as m, i (i)}
              <li>
                <span class="ps__role">{m.role}</span>
                <span class="ps__name">
                  {m.person?.full_name ?? DASH}
                  {#if m.notes}<span class="ps__muted">{m.notes}</span>{/if}
                  {#if m.person?.email || m.person?.phone}
                    <span class="ps__contact">
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
        {/if}
      </Fold>
    {/if}

    {#if sheet.contacts}
      <Fold word={t('perf.programmer', locale)} keeps={sheet.contacts.programmer.full_name} id="ps-programmer" bind:open={() => isOpen('programmer'), (v) => setOpen('programmer', v)}>
        <p class="ps__programmer">
          {sheet.contacts.programmer.full_name}
          {#if sheet.contacts.programmer.email || sheet.contacts.programmer.phone}
            <span class="ps__contact">
              {[sheet.contacts.programmer.email, sheet.contacts.programmer.phone].filter(Boolean).join(' · ')}
            </span>
          {/if}
        </p>
      </Fold>
    {/if}

    {#if sheet.notes}
      <Fold word={t('perf.notes', locale)} keeps={sheet.notes.length > 40 ? `${sheet.notes.slice(0, 39)}…` : sheet.notes} id="ps-notes" bind:open={() => isOpen('notes'), (v) => setOpen('notes', v)}>
        <p class="ps__notes">{sheet.notes}</p>
      </Fold>
    {/if}
  </div>
</div>

<style>
  @layer components {
    /* One column, the pass's width: it never stretches (a phone's size on any
       screen), and on a phone it is the whole width. */
    .ps {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-m);
      inline-size: min(100%, var(--pass-width));
      min-inline-size: 0;
    }

    /* Under the piece: the address and whom the call goes to, quiet. */
    .ps__where {
      display: grid;
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .ps__maps {
      color: var(--text-faint);
    }
    .ps__maps-change {
      min-block-size: var(--touch-target);
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--text-muted);
      text-decoration: underline;
      text-underline-offset: var(--link-underline-offset);
      cursor: pointer;
    }

    .ps__day-block {
      display: block;
      margin-block-start: var(--space-s);
    }
    .ps__label {
      margin: 0 0 var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 400;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }

    /* The shared note: a quiet block, the text in the body's ink on a faint ground. */
    .ps__shared {
      display: block;
      padding: var(--space-s) var(--space-m);
      border-inline-start: calc(var(--border-width) * 2) solid var(--border-color-dark);
      background: var(--bg-light);
    }
    .ps__shared .ps__label {
      margin-block-end: var(--space-2xs);
    }
    .ps__shared-text {
      margin: 0;
      font-size: var(--text-s);
      line-height: 1.5;
      color: var(--text-color);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .ps__trip-head {
      display: grid;
      gap: var(--space-2xs);
      margin: 0 0 var(--space-s);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    /* THE DAY, a line of stops (the record's `.ro--stops`, read only): the
       hour in mono at left, the dot on the line, the word and what it
       carries under it. The hour column is as wide as its widest hour. */
    .ps__day {
      --stop-ink: var(--text-muted);
      --stop-line: var(--border-color-dark);
      /* Where a dot's centre sits, from the top of a row. */
      --stop-mid: calc(var(--space-xs) + 0.7em);
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      column-gap: var(--space-s);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ps__point,
    .ps__now {
      position: relative;
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: baseline;
      padding-block: var(--space-xs);
    }
    /* The line, row by row, in the dots' column: first dot to last dot. */
    .ps__point::before,
    .ps__now::before {
      content: '';
      position: absolute;
      grid-column: 2 / 3;
      inset-block: 0;
      inset-inline-start: calc(0.375rem - var(--line-hairline) / 2);
      inline-size: var(--line-hairline);
      background: var(--stop-line);
    }
    .ps__day > :first-child::before {
      inset-block-start: var(--stop-mid);
    }
    .ps__day > :last-child::before {
      inset-block-end: auto;
      block-size: var(--stop-mid);
    }
    .ps__day > :only-child::before {
      display: none;
    }
    .ps__at {
      justify-self: end;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }
    .ps__what {
      position: relative;
      display: grid;
      gap: var(--space-2xs);
      padding-inline-start: 1.5rem;
      font-size: var(--text-m);
      color: var(--text-color);
    }
    .ps__what::before {
      content: '';
      position: absolute;
      inset-inline-start: 0;
      inset-block-start: 0.35em;
      inline-size: 0.75rem;
      block-size: 0.75rem;
      border: var(--line-hairline) solid var(--stop-ink);
      border-radius: var(--radius-50);
      background: var(--bg);
    }
    .ps__muted {
      display: block;
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .ps__at .ps__muted {
      font-size: var(--text-2xs);
    }

    /* The show is the big stop: the display face, a filled dot. */
    .ps__point--show .ps__at {
      font-weight: 600;
      color: var(--text-color);
    }
    .ps__point--show .ps__what::before {
      inset-inline-start: -0.125rem;
      inset-block-start: 0.3em;
      inline-size: 1rem;
      block-size: 1rem;
      border-color: var(--text-color);
      background: var(--text-color);
    }
    .ps__point--show .ps__word {
      font-family: var(--font-display);
      font-size: var(--text-l);
    }

    /* What is already past is dimmed. */
    .ps__point--past .ps__at,
    .ps__point--past .ps__what,
    .ps__point--past .ps__muted {
      color: var(--text-faint);
    }

    /* A time production moved after a «llego tarde»: said in the hand of a change.
       Amber because it IS a change someone must see (ADR-183). */
    .ps__moved {
      display: block;
      font-size: var(--text-s);
      color: var(--tone-warning-fg);
    }

    /* The «now» line: a rule across the day with a filled dot on the line, and
       the hour under it. */
    .ps__now {
      padding-block: var(--space-xs);
    }
    .ps__now-body {
      grid-column: 2 / 3;
      position: relative;
      display: block;
      padding-block-start: var(--space-2xs);
      padding-inline-start: 1.5rem;
      border-block-start: var(--line-thin) solid var(--today-ink);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      font-variant-numeric: tabular-nums;
      color: var(--today-ink);
    }
    .ps__now-body::before {
      content: '';
      position: absolute;
      inset-inline-start: 0;
      inset-block-start: -0.4rem;
      inline-size: 0.625rem;
      block-size: 0.625rem;
      border-radius: var(--radius-50);
      background: var(--today-ink);
    }

    /* THE FOLDS: the lid of the record, each saying what it keeps. */
    .ps__folds {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-m);
      margin-block-start: var(--space-s);
    }
    /* The page's own `section` padding is for the app's screens, not for this column. */
    .ps__day-block,
    .ps__folds :global(.fold),
    .ps :global(section.pass) {
      padding: 0;
    }
    /* A phone is narrow: what the lid keeps drops under its word, so the
       chevron stays in sight. */
    .ps__folds :global(.lid) {
      flex-wrap: wrap;
      row-gap: var(--space-2xs);
    }
    .ps__folds :global(.lid__n) {
      margin-inline-start: auto;
      text-align: end;
    }
    .ps__folds :global(.fold__body) {
      gap: var(--space-s);
    }
    .ps__people {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ps__people li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .ps__role {
      flex: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
      min-inline-size: var(--record-label-inline);
    }
    .ps__name {
      min-inline-size: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .ps__link {
      overflow-wrap: anywhere;
    }
    .ps__contact {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .ps__programmer,
    .ps__notes {
      margin: 0;
      font-size: var(--text-s);
    }
    .ps__notes {
      white-space: pre-wrap;
      line-height: 1.55;
    }

    @media print {
      .ps {
        inline-size: 100%;
      }
      .ps__now,
      .ps__maps {
        display: none;
      }
      .ps__point,
      .ps__folds :global(.fold) {
        break-inside: avoid;
      }
      /* Folds are open on paper: the lid stays as the heading, its sign goes. */
      .ps__folds :global(.lid__sign) {
        display: none;
      }
    }
  }
</style>
