<script lang="ts">
  /**
   * AHORA (ADR-146): the gig day, one screen. A mode of Hoy, not a lens: the
   * selector keeps Hoy marked. On a phone it covers the frame, the bar of
   * sections included, as the vistazo and the dialogs do (ADR-140 § 4), with
   * three thumb actions at the foot (Llamar, Mapa, Hoja) and «Salir» at the
   * top; on a desktop it is the same column inside the page.
   *
   * Three layers (ADR-139 § 6): always (the headline: what you are in, or a
   * countdown in minutes to what comes next), at a glance (the trip's
   * stages, the venue and who to call, the rest of the running order, who is
   * on today) and on demand (the details, folded). Each block says which
   * company it is with its monogram: a technician can work for one space in
   * the morning and another at night.
   *
   * The truth is `$lib/ahora` (pure, tested); this file reads, words, draws.
   */
  import { createQueries, createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import { dualTime, hourMark, localeDayMonth, localeWeekdayShort } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { addDaysIso, dayKeyInTz } from '$lib/planner';
  import {
    dateSlip,
    momentWordKey,
    performanceSlip,
    type DateEvent,
    type PerformanceEvent,
    type SlipContext,
  } from '$lib/month-events';
  import type { PersonAttributionScope } from '$lib/people';
  import type { NavWorkspace } from '$lib/nav';
  import { stagePlace } from '$lib/travel-stage';
  import { accentVarFor } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { teamQueryOptions } from '$lib/nav-queries';
  import { ahoraRoadsheetQuery, roleFor, type AhoraRoadsheet } from '$lib/ahora-feeds.svelte';
  import {
    ahoraDay,
    ahoraItems,
    ahoraState,
    ahoraTimeline,
    countdownParts,
    freshnessShown,
    logisticsLines,
    mapsHref,
    minutesTo,
    pointPast,
    telHref,
    venueCall,
    type AhoraItem,
    type AhoraPoint,
  } from '$lib/ahora';

  interface Props {
    performances: PerformanceEvent[];
    dates: DateEvent[];
    axis: PersonAttributionScope | null;
    workspaces: NavWorkspace[];
    settled: boolean;
    /** When the pulse's feeds last answered (ms), for the freshness line. */
    updatedAt: number | null;
    now: Date;
    viewerTz: string;
    slipCtx: SlipContext;
    exitHref: string;
    locale: Locale;
  }

  let { performances, dates, axis, workspaces, settled, updatedAt, now, viewerTz, slipCtx, exitHref, locale }: Props = $props();

  // ── The network, for the freshness line ─────────────────────────────────
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  $effect(() => {
    const on = () => (online = true);
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });

  let items = $derived(ahoraItems({ performances, dates, viewerTz, axis }));
  let day = $derived(ahoraDay(items, now, viewerTz));
  let timeline = $derived(day ? ahoraTimeline(items, day) : { items: [], points: [] });
  let clock = $derived(ahoraState(timeline.points, now));
  let today = $derived(dayKeyInTz(now.toISOString(), viewerTz));
  /** What the eve and the night ask: the first thing of the day after. */
  let after = $derived.by(() => {
    if (!day) return null;
    const next = ahoraTimeline(items, addDaysIso(day, 1));
    const first = next.points[0];
    return first ? { point: first, item: next.items.find((i) => i.id === first.itemId)! } : null;
  });

  // ── Road sheets of the day's performances (preloaded on open) ──────────
  let dayPerfs = $derived(timeline.items.filter((i) => i.of === 'performance'));
  const sheets = createQueries({
    queries: toStore(() =>
      dayPerfs.map((i) => ahoraRoadsheetQuery(i.id, roleFor(i.row as PerformanceEvent, workspaces))),
    ),
  });
  let sheetById = $derived(
    new Map(dayPerfs.map((i, n) => [i.id, ($sheets[n]?.data as AhoraRoadsheet | undefined)?.roadsheet ?? null])),
  );
  /** The oldest answer on screen: the line says how old the data is. */
  let oldest = $derived.by(() => {
    const ats = [updatedAt, ...$sheets.map((q) => q.dataUpdatedAt || null)].filter((n): n is number => !!n);
    return ats.length ? Math.min(...ats) : null;
  });
  let fresh = $derived(freshnessShown(oldest, now.getTime(), online));
  let freshLabel = $derived.by(() => {
    if (!oldest) return '';
    const iso = new Date(oldest).toISOString();
    const time = hourMark(dualTime(iso, null, viewerTz).primary);
    const d = dayKeyInTz(iso, viewerTz);
    return d === today
      ? t('ahora.fresh', locale, { time })
      : t('ahora.fresh_day', locale, { day: `${localeWeekdayShort(d, locale)} ${localeDayMonth(d, locale)}`, time });
  });

  // Who goes, by name (the Planner's team feed, one cache with Hoy).
  const teamQuery = createQuery(toStore(() => teamQueryOptions(workspaces.map((w) => w.id))));
  let names = $derived(new Map(($teamQuery.data?.items ?? []).map((m) => [m.person_id, m.full_name])));

  // ── Words ──────────────────────────────────────────────────────────────
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  /** One figure, never split across two lines: its spaces do not break. */
  function inWords(minutes: number): string {
    const { h, m } = countdownParts(minutes);
    const words = h === 0 ? t('ahora.in_min', locale, { m }) : m === 0 ? t('ahora.in_h', locale, { h }) : t('ahora.in_hm', locale, { h, m });
    return words.replace(/ /g, '\u00a0');
  }
  function pointWord(p: AhoraPoint): string {
    if (p.of === 'stage') return t(`planner.mode_${p.mode}`, locale);
    if (p.label) return p.label;
    return p.key ? t(momentWordKey(p.key), locale) : '';
  }
  const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
  function route(p: Extract<AhoraPoint, { of: 'stage' }>): string {
    const from = stagePlace(p.stage.from_city, p.stage.from_place);
    const to = stagePlace(p.stage.to_city, p.stage.to_place);
    return [from, to].filter(Boolean).join(' → ');
  }

  const wsById = $derived(new Map(workspaces.map((w) => [w.id, w])));
  function company(i: AhoraItem): NavWorkspace | null {
    return (i.workspaceId && wsById.get(i.workspaceId)) || null;
  }
  /** Where a block is: the venue and city of a show, the destination of a trip. */
  function where(i: AhoraItem): string {
    if (i.of === 'date') {
      const d = i.row as DateEvent;
      const to = d.destination_city ?? d.city ?? dateSlip(d, slipCtx).city;
      return to ? t('ahora.trip_to', locale, { place: to }) : t('planner.kind_travel_day', locale);
    }
    const slip = performanceSlip(i.row as PerformanceEvent, slipCtx);
    return [slip.name, slip.city].filter(Boolean).join(', ');
  }
  /** The road sheet's own page: the performance's address, as every slip gives it. */
  function sheetHref(i: AhoraItem): string | null {
    if (i.of !== 'performance') return null;
    const href = performanceSlip(i.row as PerformanceEvent, slipCtx).href;
    return href ? `${href}/roadsheet` : null;
  }

  // ── The headline ───────────────────────────────────────────────────────
  let focusPoint = $derived(clock.headline === 'doing' ? clock.current : clock.next);
  let focusItem = $derived(focusPoint ? (timeline.items.find((i) => i.id === focusPoint!.itemId) ?? null) : null);
  let headline = $derived.by(() => {
    if (clock.headline === 'done' || !focusPoint) return null;
    if (clock.headline === 'doing') {
      const sub = [
        clock.currentUntil ? t('ahora.until', locale, { time: hour(clock.currentUntil, focusPoint.tz) }) : null,
        clock.next ? `${pointWord(clock.next)} ${inWords(minutesTo(clock.next.at, now))}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { eye: t('ahora.title', locale), big: cap(pointWord(focusPoint)), sub, at: null as string | null };
    }
    const p = focusPoint;
    const sub =
      p.of === 'stage'
        ? [route(p), p.stage.arrive_at ? t('ahora.arrives', locale, { time: hour(p.stage.arrive_at, p.stage.arrive_tz ?? p.tz) }) : null]
            .filter(Boolean)
            .join(' · ')
        : focusItem
          ? where(focusItem)
          : '';
    return { eye: cap(pointWord(p)), big: inWords(minutesTo(p.at, now)), sub, at: hour(p.at, p.tz) };
  });

  // ── The thumb actions: the performance the day is about ────────────────
  let actionItem = $derived(
    focusItem?.of === 'performance' ? focusItem : (dayPerfs.find((i) => i.end > now.getTime()) ?? dayPerfs[0] ?? null),
  );
  let actionSheet = $derived(actionItem ? (sheetById.get(actionItem.id) ?? null) : null);
  let call = $derived(venueCall(actionSheet?.venue?.contacts));
  let map = $derived.by(() => {
    if (actionSheet) {
      const v = actionSheet.venue;
      return mapsHref(v?.address ? [v.address, v.city ?? actionSheet.city] : [v?.name ?? actionSheet.venue_name, v?.city ?? actionSheet.city]);
    }
    if (focusPoint?.of === 'stage') return mapsHref([stagePlace(focusPoint.stage.to_city, focusPoint.stage.to_place)]);
    return null;
  });
  let sheet = $derived(actionItem ? sheetHref(actionItem) : null);
</script>

{#snippet mark(i: AhoraItem)}
  {@const ws = company(i)}
  <p class="ahora__co">
    {#if ws}<IdentityMark accent={accentVarFor(ws)} name={spaceName(ws.name)} variant="full" mini />{/if}
    <span class="ahora__where">{where(i)}</span>
  </p>
{/snippet}

{#snippet trip(item: AhoraItem)}
  {@const d = item.row as DateEvent}
  {#if item.points.length === 0}
    <p class="ahora__line">{[d.origin_city, d.destination_city ?? d.city].filter(Boolean).join(' → ')}</p>
  {:else}
    <ul class="ahora__list" role="list">
      {#each item.points as p, n (n)}
        {#if p.of === 'stage'}
          <li class:past={pointPast(p, clock, now)} class:cur={p === clock.current}>
            <span class="ahora__t">{hour(p.at, p.tz)}</span>
            <span>
              {cap(pointWord(p))}{route(p) ? ` · ${route(p)}` : ''}{#if p.stage.arrive_at}<span class="ahora__muted"
                  >{` · ${t('ahora.arrives', locale, { time: hour(p.stage.arrive_at, p.stage.arrive_tz ?? p.tz) })}`}</span
                >{/if}
              {#if p.stage.reference}<span class="ahora__ref"
                  ><span class="ahora__muted">{t('ahora.reference', locale)}</span> {p.stage.reference}</span
                >{/if}
            </span>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
{/snippet}

<section class="ahora" aria-labelledby="ahora-h" data-testid="ahora">
  <header class="ahora__top">
    <h1 id="ahora-h" class="ahora__mode">{t('ahora.title', locale)}</h1>
    {#if fresh}<span class="ahora__fresh" data-testid="ahora-fresh">{freshLabel}</span>{/if}
    <a class="ahora__exit" href={exitHref} data-sveltekit-replacestate>{t('ahora.exit', locale)}</a>
  </header>

  <div class="ahora__body">
    {#if !settled}
      <p class="ahora__eye ghost-line" aria-hidden="true">&nbsp;</p>
      <p class="ahora__big ghost-line" aria-hidden="true">&nbsp;</p>
    {:else if !day}
      <EmptyLine text={t('ahora.empty', locale)} />
    {:else}
      <!-- ALWAYS: what you are in, or the minutes to what comes next. -->
      <div class="ahora__head" data-testid="ahora-head" aria-live="polite">
        {#if focusItem}{@render mark(focusItem)}{/if}
        {#if headline}
          <p class="ahora__eye">{headline.eye}</p>
          <p class="ahora__big">{headline.big}</p>
          {#if headline.at || headline.sub}
            <p class="ahora__sub">{#if headline.at}<b>{headline.at}</b>{headline.sub ? ' · ' : ''}{/if}{headline.sub}</p>
          {/if}
        {:else}
          <p class="ahora__big">{t('ahora.done', locale)}</p>
        {/if}
      </div>

      {#each timeline.items as item (item.id)}
        {#if item.of === 'date'}
          {#if item.end <= now.getTime()}
            <!-- A trip that has arrived folds to one line: the day moved on. -->
            <details class="ahora__fold" data-testid="ahora-trip">
              <summary>{t('ahora.done_line', locale, { what: cap(where(item)) })}</summary>
              {@render trip(item)}
            </details>
          {:else}
            <section class="ahora__block" data-testid="ahora-trip">
              <BlockHead title={t('ahora.stages', locale)} />
              {@render mark(item)}
              {@render trip(item)}
            </section>
          {/if}
        {:else}
          {@const rs = sheetById.get(item.id) ?? null}
          {@const lines = logisticsLines(rs?.logistics)}
          {@const who = venueCall(rs?.venue?.contacts)}
          {@const moments = item.points}
          {@const past = moments.filter((p) => pointPast(p, clock, now))}
          {@const rest = moments.filter((p) => !pointPast(p, clock, now))}
          {@const going = ((item.row as PerformanceEvent).commitments ?? []).filter((c) => c.state === 'going').map((c) => names.get(c.person_id)).filter(Boolean)}
          {@const crew = [...(rs?.crew ?? []), ...(rs?.cast ?? [])].filter((c) => c.person)}
          <section class="ahora__block" data-testid="ahora-venue">
            <BlockHead title={t('ahora.venue', locale)} />
            {@render mark(item)}
            {#if rs?.venue?.address}<p class="ahora__line">{[rs.venue.address, rs.venue.city ?? rs.city].filter(Boolean).join(', ')}</p>{/if}
            {#if lines.load_access}<p class="ahora__kv"><span>{t('ahora.load_access', locale)}</span> {lines.load_access}</p>{/if}
            {#if lines.parking}<p class="ahora__kv"><span>{t('ahora.parking', locale)}</span> {lines.parking}</p>{/if}
            {#if who}
              <p class="ahora__kv" data-testid="ahora-contact">
                <span>{t(`ahora.contact_${who.by}`, locale)}</span>
                {who.name}{#if who.phone}{' · '}<a href={telHref(who.phone)}>{who.phone}</a>{/if}
              </p>
            {/if}
            {#if lines.hotel}<p class="ahora__kv"><span>{t('ahora.hotel', locale)}</span> {lines.hotel}</p>{/if}
          </section>

          {#if moments.length > 0}
            <section class="ahora__block" data-testid="ahora-order">
              <BlockHead title={t(past.length > 0 ? 'ahora.order_rest' : 'ahora.order', locale)} />
              {#if past.length > 0}
                <details class="ahora__fold">
                  <summary>{t('ahora.earlier', locale, { n: past.length })}</summary>
                  <ul class="ahora__list" role="list">
                    {#each past as p, n (n)}<li class="past"><span class="ahora__t">{hour(p.at, p.tz)}</span><span>{cap(pointWord(p))}</span></li>{/each}
                  </ul>
                </details>
              {/if}
              <ul class="ahora__list" role="list">
                {#each rest as p, n (n)}
                  <li class:cur={p === clock.current}><span class="ahora__t">{hour(p.at, p.tz)}</span><span>{cap(pointWord(p))}</span></li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if crew.length > 0 || going.length > 0}
            <section class="ahora__block" data-testid="ahora-crew">
              <BlockHead title={t('ahora.crew', locale)} />
              {#if crew.length > 0}
                <ul class="ahora__people" role="list">
                  {#each crew as c, n (n)}
                    <li>
                      {#if c.person?.phone}<a href={telHref(c.person.phone)}>{c.person.full_name}</a>{:else}{c.person?.full_name}{/if}
                      {#if c.role}<span class="ahora__muted">{c.role}</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if going.length > 0}<p class="ahora__kv"><span>{t('ahora.going', locale)}</span> {going.join(', ')}</p>{/if}
            </section>
          {/if}

          {#if rs && (hasJsonContent(rs.logistics) || hasJsonContent(rs.technical) || hasJsonContent(rs.hospitality) || rs.notes)}
            <details class="ahora__fold ahora__details">
              <summary>{t('ahora.details', locale)}</summary>
              {#if rs.notes}<p class="ahora__kv"><span>{t('ahora.notes', locale)}</span> {rs.notes}</p>{/if}
              {#if hasJsonContent(rs.technical)}<p class="ahora__sublabel">{t('perf.technical', locale)}</p><JsonKV value={rs.technical} />{/if}
              {#if hasJsonContent(rs.logistics)}<p class="ahora__sublabel">{t('perf.logistics', locale)}</p><JsonKV value={rs.logistics} />{/if}
              {#if hasJsonContent(rs.hospitality)}<p class="ahora__sublabel">{t('perf.hospitality', locale)}</p><JsonKV value={rs.hospitality} />{/if}
            </details>
          {/if}
        {/if}
      {/each}

      {#if after && day === today}
        <section class="ahora__block">
          <BlockHead title={t('ahora.tomorrow', locale)} />
          <p class="ahora__kv">
            <b>{hour(after.point.at, after.point.tz)}</b>
            {pointWord(after.point)}{after.point.of === 'stage' && route(after.point) ? ` · ${route(after.point)}` : ` · ${where(after.item)}`}
          </p>
        </section>
      {/if}
    {/if}
  </div>

  {#if call?.phone || map || sheet}
    <nav class="ahora__actions" aria-label={t('ahora.actions', locale)}>
      {#if call?.phone}<a class="ahora__act ahora__act--main" href={telHref(call.phone)} aria-label={t('ahora.call_aria', locale, { name: call.name })}>{t('ahora.call', locale)}</a>{/if}
      {#if map}<a class="ahora__act" href={map} target="_blank" rel="noopener">{t('ahora.map', locale)}</a>{/if}
      {#if sheet}<a class="ahora__act" href={sheet}>{t('ahora.sheet', locale)}</a>{/if}
    </nav>
  {/if}
</section>

<style>
  @layer components {
    /* A column at a reading measure, in the page on a desktop. */
    .ahora {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      max-inline-size: var(--calm-measure);
      margin-inline: auto;
      inline-size: 100%;
    }
    .ahora__top {
      display: flex;
      align-items: baseline;
      gap: var(--space-m);
      padding-block-end: var(--space-s);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .ahora__mode {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--heading-color);
    }
    .ahora__fresh {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .ahora__exit {
      margin-inline-start: auto;
      font-size: var(--text-s);
      color: var(--text-muted);
      text-underline-offset: 3px;
      min-block-size: var(--touch-target);
      display: inline-flex;
      align-items: center;
    }
    .ahora__body {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .ahora__co {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: 0 0 var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .ahora__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .ahora__eye {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    /* The one figure (ADR-146): big, the minutes to what comes next. */
    .ahora__big {
      margin: 0;
      font-family: var(--font-sans);
      font-size: var(--h1);
      font-weight: 600;
      line-height: 1.05;
      letter-spacing: var(--tracking-s);
      color: var(--heading-color);
      font-variant-numeric: tabular-nums;
    }
    .ahora__sub {
      margin: 0;
      font-size: var(--text-l);
      color: var(--text-color);
    }
    .ahora__block :global(.block-head) {
      margin-block-end: var(--space-xs);
    }
    .ahora__line,
    .ahora__kv {
      margin: 0 0 var(--space-2xs);
      font-size: var(--text-m);
    }
    .ahora__kv > span:first-child,
    .ahora__muted {
      color: var(--text-muted);
    }
    .ahora__kv > span:first-child {
      margin-inline-end: var(--space-2xs);
    }
    .ahora__ref {
      display: block;
    }
    .ahora__list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .ahora__list li {
      display: grid;
      grid-template-columns: 4em minmax(0, 1fr);
      gap: var(--space-s);
      padding-block: var(--space-2xs);
      font-size: var(--text-m);
    }
    .ahora__t {
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }
    .ahora__list li.past,
    .ahora__list li.past .ahora__t {
      color: var(--text-faint);
    }
    .ahora__list li.cur {
      font-weight: 600;
    }
    .ahora__list li.cur .ahora__t {
      color: var(--heading-color);
    }
    .ahora__people {
      list-style: none;
      margin: 0 0 var(--space-xs);
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
      font-size: var(--text-m);
    }
    .ahora__people .ahora__muted {
      margin-inline-start: var(--space-2xs);
    }
    .ahora__people a,
    .ahora__kv a {
      color: inherit;
      text-underline-offset: 3px;
    }
    .ahora__fold > summary {
      cursor: pointer;
      font-size: var(--text-s);
      color: var(--text-muted);
      min-block-size: var(--touch-target);
      display: flex;
      align-items: center;
    }
    .ahora__sublabel {
      margin: var(--space-s) 0 var(--space-2xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    /* The thumb's three: a row at the end of the column on a desktop. */
    .ahora__actions {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-s);
      padding-block: var(--space-m);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .ahora__act {
      display: flex;
      align-items: center;
      justify-content: center;
      min-block-size: calc(var(--touch-target) + var(--space-xs));
      padding-block: var(--space-s);
      border: var(--line-hairline) solid var(--heading-color);
      border-radius: var(--radius-m);
      font-size: var(--text-m);
      font-weight: 600;
      color: var(--heading-color);
      text-decoration: none;
    }
    .ahora__act--main {
      background: var(--heading-color);
      color: var(--bg);
    }

    /* THE PHONE: the whole screen, over the frame and its bar of sections
       (ADR-140 § 4, like the vistazo), the actions at the thumb. */
    @media (max-width: 47.999rem) {
      .ahora {
        position: fixed;
        inset: 0;
        z-index: var(--z-modal);
        max-inline-size: none;
        gap: 0;
        background: var(--bg);
      }
      .ahora__top {
        padding: max(var(--space-s), env(safe-area-inset-top)) var(--shell-gutter) var(--space-xs);
      }
      .ahora__body {
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: var(--space-m) var(--shell-gutter) var(--space-l);
      }
      .ahora__actions {
        padding: var(--space-s) var(--shell-gutter) max(var(--space-s), env(safe-area-inset-bottom));
        background: var(--bg);
      }
    }
  }
</style>
