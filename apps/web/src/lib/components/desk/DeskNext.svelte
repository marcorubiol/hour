<script lang="ts">
  /**
   * «LO SIGUIENTE» — band 1 of the Desk (ADR-117). The day as a short agenda
   * with what is on now opened as the card (ADR-150, option D of the Hoy
   * review; it was a card per day, ADR-149):
   *
   *   09h12  TREN  a Girona                    (gone by: dimmed)
   *   ┌ AHORA · Gota ─────────────────────────┐
   *   │ Carga · hasta las 17h                 │  what you do now + its hour
   *   │ Teatre de Salt · Girona               │  where, small: you know it
   *   │            Llamar  Mapa  Ahora  Hoja ↗│
   *   └───────────────────────────────────────┘
   *   12h    ENSAYO  Sala 2 · Avi
   *   17h    prueba de sonido
   *   20h30  función · Teatre de Salt          (the day's main event: marked)
   *
   * The truth is `$lib/day-agenda` (the pulse's rows and segments, Ahora's
   * headline rule); this file words and draws. The card moves with the day:
   * the train in the morning, the load-in at noon, the show at night. The
   * next three things of other days follow under it, one line each
   * («Después», ADR-149).
   *
   * Like the rail, it never follows the scope (ADR-096 § 5). It never changes
   * height while the answer lands: the card is drawn with dashes first. When
   * the agenda is today's, Hoy's headline names the day (ADR-148), so on a
   * phone the band's head is heard and not seen. Hour asks nothing here:
   * who goes is a roster or a «voy» (ADR-147).
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import Button from '$lib/components/Button.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { dualTime, hourMark, localeDayMonth, localeDayMonthNear, localeWeekdayShort } from '$lib/datetime';
  import { LOCALE_TAG, t, type Locale } from '$lib/i18n';
  import { holdDeadlineLabel } from '$lib/performance';
  import { statusWord } from '$lib/planner';
  import { momentWordKey, type DateEvent, type PerformanceEvent, type SlipContext, type SlipKind } from '$lib/month-events';
  import { stagePlace } from '$lib/travel-stage';
  import { plannerDayHref } from '$lib/planner';
  import { lensOn } from '$lib/lenses.svelte';
  import type { PulseNext } from '$lib/pulse';
  import type { AgendaPoint, DayAgenda } from '$lib/day-agenda';
  import { countdownParts, mapsHref, minutesTo, telHref, venueCall } from '$lib/ahora';
  import { ahoraRoadsheetQuery, roleFor, type AhoraRoadsheet } from '$lib/ahora-feeds.svelte';
  import type { NavWorkspace } from '$lib/nav';
  import { pulseSlip } from '$lib/pulse-feeds.svelte';

  interface Props {
    /** The day in order, with its card (`dayAgenda`); null with nothing near. */
    agenda: DayAgenda | null;
    /** The next thing when it is more than two weeks away (one sentence), or null. */
    far?: PulseNext | null;
    /** The next things of other days, one line each under the card (ADR-149). */
    after?: PulseNext[];
    settled: boolean;
    errored: boolean;
    /** «Reintentar»: read again what failed (the one voice of a failure). */
    onretry: () => void;
    today: string;
    viewerTz: string;
    /** The viewer's clock (the page's minute tick): countdowns read it. */
    now: Date;
    /** New messages on the card's board (a performance's bolo), 0 without. */
    boardNew?: number;
    slipCtx: SlipContext;
    /** For the road sheet's role (Llamar, Mapa: preloaded for Ahora). */
    workspaces: readonly NavWorkspace[];
    /** Ahora's door (ADR-146), in the card's foot while it applies; never
        enters by itself. */
    ahoraHref?: string | null;
    locale: Locale;
  }

  let { agenda, far = null, after = [], settled, errored, onretry, today, viewerTz, now, boardNew = 0, slipCtx, workspaces, ahoraHref = null, locale }: Props = $props();

  const kindLabel = (kind: SlipKind) => t(`planner.kind_${kind}`, locale);
  const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  const dateWords = (day: string) => `${localeWeekdayShort(day, locale)} ${localeDayMonth(day, locale)}`;
  function daysTo(day: string): number {
    return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  }
  function relDay(day: string): string {
    const n = daysTo(day);
    return n <= 0 ? t('desk.next_today', locale) : n === 1 ? t('desk.next_tomorrow', locale) : t('desk.next_in_days', locale, { n });
  }
  /** One figure, never split across two lines: its spaces do not break. */
  function inWords(minutes: number): string {
    const { h, m } = countdownParts(minutes);
    const words = h === 0 ? t('ahora.in_min', locale, { m }) : m === 0 ? t('ahora.in_h', locale, { h }) : t('ahora.in_hm', locale, { h, m });
    return words.replace(/ /g, ' ');
  }

  /** What a point IS, in the house words: the moment, the mode, the kind. */
  function word(p: AgendaPoint): string {
    const w = p.what;
    if (w.of === 'stage') return t(`planner.mode_${w.mode}`, locale);
    if (w.of === 'date') return w.label || kindLabel((['show', 'rehearsal', 'residency', 'travel_day', 'press', 'day_off'].includes(w.kind) ? w.kind : 'other') as SlipKind);
    if (w.label) return w.label;
    return w.key ? t(momentWordKey(w.key), locale) : '';
  }
  /** Where a point is, small: the venue and city, a stage's route, a date's place. */
  function place(p: AgendaPoint): string {
    const w = p.what;
    if (w.of === 'stage') {
      const route = [stagePlace(w.stage.from_city, w.stage.from_place), stagePlace(w.stage.to_city, w.stage.to_place)].filter(Boolean).join(' → ');
      return [route, w.stage.arrive_at ? t('ahora.arrives', locale, { time: hour(w.stage.arrive_at, w.stage.arrive_tz ?? p.tz) }) : null, w.stage.reference]
        .filter(Boolean)
        .join(' · ');
    }
    const sl = pulseSlip(p.ref, agenda?.day ?? today, slipCtx);
    const title = p.ref.of === 'date' ? (p.ref.row as DateEvent).title : null;
    return [title && title !== word(p) ? title : null, sl.name !== title ? sl.name : null, sl.city && sl.city !== sl.name ? sl.city : null]
      .filter(Boolean)
      .join(' · ');
  }
  /* A hold says what it is in the house word («1.ª opción · vence lun»). */
  function holdLabel(p: AgendaPoint): string | null {
    const sl = pulseSlip(p.ref, agenda?.day ?? today, slipCtx);
    if (sl.cert !== 'hold' || !sl.hold) return null;
    const rank = statusWord(sl.hold.rank ? `hold_${sl.hold.rank}` : 'hold', locale);
    return sl.hold.expires ? `${rank} · ${holdDeadlineLabel(sl.hold.expires, today, locale, LOCALE_TAG[locale], true)}` : rank;
  }

  let focus = $derived(agenda && agenda.focus !== null ? agenda.points[agenda.focus] : null);
  /* The card's big line: WHAT you do now and its time (Marco, 31-10). The
     venue goes small: on a gig day you know where you are. */
  let big = $derived.by(() => {
    if (!agenda || !focus) return '';
    const w = cap(word(focus)) + (focus.ref.tentative ? '?' : '');
    if (agenda.headline === 'countdown') return `${w} ${inWords(minutesTo(focus.at!, now))}`;
    if (agenda.headline === 'doing') {
      if (agenda.until) return `${w} · ${t('ahora.until', locale, { time: hour(agenda.until, focus.tz) })}`;
      return focus.at ? `${w} · ${hour(focus.at, focus.tz)}` : `${w} · ${t('planner.all_day', locale)}`;
    }
    return focus.at ? `${w} · ${hour(focus.at, focus.tz)}` : w;
  });
  let eye = $derived(
    agenda && focus
      ? [agenda.headline === 'doing' ? t('ahora.title', locale) : `${relDay(agenda.day)} · ${dateWords(agenda.day)}`, focus.ref.row.project?.name]
          .filter(Boolean)
          .join(' · ')
      : '',
  );
  let small = $derived(focus ? [place(focus), holdLabel(focus)].filter(Boolean).join(' · ') : '');

  /* The card's actions are the performance's: the focus when it is one, else
     the day's main event (on the train, the venue is where you are going). */
  let actionPoint = $derived(
    focus?.ref.of === 'performance' ? focus : (agenda?.points.find((p) => p.main) ?? null),
  );
  let actionPerf = $derived(actionPoint ? (actionPoint.ref.row as PerformanceEvent) : null);
  let actionSlip = $derived(actionPoint ? pulseSlip(actionPoint.ref, agenda!.day, slipCtx) : null);
  // The road sheet Ahora preloads for today and tomorrow: one cache, no new read.
  const sheetQuery = createQuery(
    toStore(() => ({
      ...ahoraRoadsheetQuery(actionPerf?.id ?? '', actionPerf ? roleFor(actionPerf, workspaces) : 'full'),
      enabled: Boolean(actionPerf),
    })),
  );
  let sheet = $derived(actionPerf ? (($sheetQuery.data as AhoraRoadsheet | undefined)?.roadsheet ?? null) : null);
  let call = $derived(venueCall(sheet?.venue?.contacts));
  let map = $derived.by(() => {
    if (sheet) {
      const v = sheet.venue;
      return mapsHref(v?.address ? [v.address, v.city ?? sheet.city] : [v?.name ?? sheet.venue_name, v?.city ?? sheet.city]);
    }
    if (focus?.what.of === 'stage') return mapsHref([stagePlace(focus.what.stage.to_city, focus.what.stage.to_place)]);
    if (actionPerf) return mapsHref([actionPerf.venue_name, actionPerf.city]);
    return null;
  });
  let roadsheet = $derived(actionSlip?.href ? `${actionSlip.href}/roadsheet` : null);
  // Without its project (read through a bolo: a guest) nobody here edits «quién va».
  let whoHref = $derived(focus?.ref.of === 'performance' && actionSlip?.href && actionPerf?.project ? `${actionSlip.href}#who-goes` : null);
  /* «Tablón · 3 nuevos» (plan 2026-10-22 § 3.3): only when it has news. */
  let boardHref = $derived(actionSlip?.href && boardNew > 0 ? `${actionSlip.href}#board` : null);
  let hasFoot = $derived(Boolean(call?.phone || map || ahoraHref || roadsheet || whoHref || boardHref));

  /* The agenda is today's: Hoy's headline already names the day (ADR-148). */
  let headlined = $derived(settled && !errored && agenda !== null && daysTo(agenda.day) <= 0);
  let farHref = $derived.by(() => {
    if (!far) return undefined;
    return pulseSlip(far.ref, far.day, slipCtx).href ?? (lensOn('planner') ? plannerDayHref('day', far.day) : undefined);
  });
  /** A row's own address: its record, else the day in the Planner. */
  const rowHref = (p: AgendaPoint) => pulseSlip(p.ref, agenda!.day, slipCtx).href ?? undefined;
</script>

{#snippet then(item: PulseNext, label: string | null)}
  {@const sl = pulseSlip(item.ref, item.day, slipCtx)}
  {@const held = sl.cert === 'hold' || sl.cert === 'proposed'}
  {@const when = [dateWords(item.day), item.at ? hour(item.at, item.ref.tz) : null].filter(Boolean).join(' · ')}
  {@const where = [
    sl.lead ? `${t('planner.slip_to', locale)} ${sl.name}` : sl.name,
    sl.origin ? `${t('planner.slip_from', locale)} ${sl.origin}` : null,
    sl.city && sl.city !== sl.name ? sl.city : null,
  ]
    .filter(Boolean)
    .join(' · ')}
  <li class="then">
    <span class="then__k" class:then__k--none={!label}>{label ?? ''}</span>
    <span class="then__when">{when}</span>
    <svelte:element this={sl.href ? 'a' : 'span'} href={sl.href} class="then__what">
      <span class="then__kind">{kindLabel(sl.kind)}{held ? '?' : ''}</span>
      <span class:guess={held}>{where}</span>
    </svelte:element>
  </li>
{/snippet}

{#snippet row(p: AgendaPoint, past: boolean)}
  {@const href = rowHref(p)}
  {@const where = place(p)}
  <li class="agenda__row" class:agenda__row--past={past} class:agenda__row--main={p.main} data-testid={p.main ? 'desk-agenda-main' : undefined}>
    <span class="agenda__h">{p.at ? hour(p.at, p.tz) : t('planner.all_day', locale)}</span>
    <svelte:element this={href ? 'a' : 'span'} {href} class="agenda__what">
      {#if p.what.of !== 'moment' || p.main}<span class="agenda__k">{word(p)}{p.ref.tentative ? '?' : ''}</span>{:else}{cap(word(p))}{/if}
      {#if p.what.of !== 'moment' || p.main}{#if where}<span class:guess={p.ref.tentative}>{where}</span>{/if}{/if}
    </svelte:element>
  </li>
{/snippet}

<section class="dband next" aria-labelledby="desk-next-h">
  <div class="next__head" class:visually-hidden--narrow={headlined}>
    <BlockHead title={t('desk.band_next', locale)} titleId="desk-next-h" />
  </div>

  {#if errored}
    <p class="load-fail" role="alert"><span>{t('desk.next_error', locale)}</span><Button size="xs" variant="secondary" onclick={onretry}>{t('ui.retry', locale)}</Button></p>
  {:else if !settled}
    <!-- The wait holds a row, the card (eyebrow, its big line, the place, the
         foot) and a row, so «Te espera» does not move when the answer lands. -->
    <ol class="agenda" aria-hidden="true">
      <li class="agenda__row"><span class="ghost-line" style:inline-size="35%">&nbsp;</span></li>
      <li class="card card--wait">
        <span class="card__eye"><span class="ghost-line" style:inline-size="30%">&nbsp;</span></span>
        <span class="card__now"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></span>
        <span class="card__where"><span class="ghost-line" style:inline-size="40%">&nbsp;</span></span>
      </li>
      <li class="agenda__row"><span class="ghost-line" style:inline-size="45%">&nbsp;</span></li>
    </ol>
  {:else if far}
    <!-- Far away is still «the next thing»: one sentence (ADR-149). -->
    {@const sl = pulseSlip(far.ref, far.day, slipCtx)}
    {@const farText = t('desk.next_far', locale, { day: localeDayMonthNear(far.day, today, locale), place: sl.city || sl.name })}
    <p class="empty-line">
      {#if farHref}<a class="empty-line__text next__far" href={farHref}>{farText} →</a>{:else}<span class="empty-line__text">{farText}</span>{/if}
    </p>
  {:else if !agenda || agenda.points.length === 0}
    <EmptyLine text={t('desk.next_empty', locale)} />
  {:else}
    <ol class="agenda" data-testid="desk-agenda">
      {#each agenda.points as p, i (p.key)}
        {#if i === agenda.focus}
          <li class="card" class:card--main={p.main} data-testid="desk-next">
            <span class="card__eye">{eye}</span>
            <span class="card__now" data-testid="desk-next-now">{big}</span>
            {#if small}<span class="card__where" class:guess={p.ref.tentative}>{small}</span>{/if}
            {#if hasFoot}
              <span class="card__foot">
                {#if boardHref}<a class="block-head__act" href={boardHref} data-testid="desk-next-board"
                    >{boardNew === 1 ? t('desk.next_board_one', locale) : t('desk.next_board', locale, { n: boardNew })} →</a
                  >{/if}
                {#if whoHref}<a class="block-head__act" href={whoHref}>{t('commitment.who_goes', locale)} →</a>{/if}
                <span class="card__acts">
                  {#if call?.phone}<a class="btn--secondary btn--s" href={telHref(call.phone)} aria-label={t('ahora.call_aria', locale, { name: call.name })}>{t('ahora.call', locale)}</a>{/if}
                  {#if map}<a class="btn--secondary btn--s" href={map} target="_blank" rel="noopener">{t('ahora.map', locale)}</a>{/if}
                  {#if ahoraHref}<a class="btn--secondary btn--s" href={ahoraHref} aria-label={t('ahora.enter_aria', locale)} data-testid="ahora-enter">{t('ahora.title', locale)}</a>{/if}
                  {#if roadsheet}<a class="btn--secondary btn--s" href={roadsheet} aria-label={t('desk.roadsheet', locale)}
                      ><span class="card__wide">{t('desk.roadsheet', locale)}</span><span class="card__narrow">{t('ahora.sheet', locale)}</span> ↗</a
                    >{/if}
                </span>
              </span>
            {/if}
          </li>
        {:else}
          {@render row(p, agenda.past[i])}
        {/if}
      {/each}
    </ol>
    {#if after.length > 0}
      <ul class="lines next__after" data-testid="desk-after">
        {#each after as item, i (item.ref.of + item.ref.id)}{@render then(item, i === 0 ? t('desk.next_after', locale) : null)}{/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .next__head {
    margin-block-end: var(--space-s);
  }
  @media (max-width: 47.999rem) {
    .next__head.visually-hidden--narrow {
      margin: calc(-1 * var(--line-hairline));
    }
  }

  /* THE AGENDA: hour · what, one column each, the card spanning both. The
     hours sit on the card's text edge (its padding plus its border), so the
     rows and the card read as one list. */
  .agenda {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-m);
    row-gap: var(--space-xs);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .agenda__row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
    padding-inline: calc(var(--space-l) + var(--line-hairline));
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  /* What has gone by steps back; it is still there to read. */
  .agenda__row--past {
    color: var(--text-faint);
  }
  /* The day's main event keeps the ink of the page, whatever the hour. */
  .agenda__row--main,
  .agenda__row--main .agenda__k {
    color: var(--text-color);
    font-weight: 500;
  }
  .agenda__row--main.agenda__row--past,
  .agenda__row--main.agenda__row--past .agenda__k {
    color: var(--text-muted);
  }
  .agenda__h {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--mono-letter-spacing);
  }
  .agenda__what {
    min-inline-size: 0;
    color: inherit;
    text-decoration: none;
  }
  a.agenda__what:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .agenda__k {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    text-transform: uppercase;
    color: var(--text-faint);
    margin-inline-end: var(--space-xs);
  }
  .agenda__row--past .agenda__k {
    color: inherit;
  }

  .card {
    grid-column: 1 / -1;
    display: grid;
    gap: var(--space-2xs);
    padding: var(--space-m) var(--space-l);
    margin-block: var(--space-2xs);
    border: var(--line-hairline) solid var(--suggest-edge);
    background: var(--suggest-wash);
    border-radius: var(--radius-l);
    align-content: start;
  }
  .card--wait {
    color: var(--text-faint);
  }
  .card__eye {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--heading-color);
  }
  /* What you do now, and its time: the card's one big line. */
  .card__now {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    line-height: 1.15;
    color: var(--text-color);
    text-wrap: balance;
  }
  .card__where {
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .card__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-s) var(--space-m);
    margin-block-start: var(--space-xs);
  }
  .card__acts {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-xs);
  }
  .card__acts > a {
    flex: none;
    white-space: nowrap;
  }

  /* «Después»: label · when · what, one column each (subgrid), on the card's
     text edge. */
  .lines {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    column-gap: var(--space-s);
    row-gap: var(--space-2xs);
    list-style: none;
    margin: var(--space-s) 0 0;
    padding: 0 calc(var(--space-l) + var(--line-hairline));
  }
  .then {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .next__far {
    color: inherit;
    text-decoration: none;
  }
  .next__far:hover {
    color: var(--text-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .then__what {
    min-inline-size: 0;
    color: inherit;
    text-decoration: none;
  }
  .then__what .then__kind {
    margin-inline-end: var(--space-xs);
  }
  a.then__what:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .then__when,
  .then__kind,
  .then__k {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
  }
  .then__when {
    white-space: nowrap;
  }
  .then__kind,
  .then__k {
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .then__k {
    letter-spacing: var(--mono-letter-spacing-loose);
  }
  .card__narrow {
    display: none;
  }
  @media (max-width: 47.999rem) {
    .card {
      padding: var(--space-s) var(--space-m);
    }
    /* The four thumb actions in one row: the road sheet says «Hoja», as in Ahora. */
    .card__wide {
      display: none;
    }
    .card__narrow {
      display: inline;
    }
    .card__acts {
      flex-wrap: nowrap;
    }
    .agenda__row,
    .lines {
      padding-inline: calc(var(--space-m) + var(--line-hairline));
    }
    /* «Después» on a phone: its word heads the group on a row of its own,
       and each line is two: the day and hour, then the name with the whole
       width (at 390 a day and an hour beside the name wrapped every name). */
    .lines {
      grid-template-columns: minmax(0, 1fr);
    }
    .then__k {
      grid-column: 1 / -1;
    }
    .then__k--none {
      display: none;
    }
    .then {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 0;
    }
    .then__what {
      padding-block-end: var(--space-2xs);
    }
  }
</style>
