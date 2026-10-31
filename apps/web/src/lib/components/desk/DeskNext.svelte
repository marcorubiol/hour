<script lang="ts">
  /**
   * «LO SIGUIENTE» — band 1 of the Desk (ADR-117). The rail's NEXT, given room:
   * the same `computePulse` answer over the same feeds ($lib/pulse-feeds), the
   * same Slip for what it is called and where (ADR-095 § 0), plus what the rail
   * cannot afford: the day in words, the running order, the road sheet. The
   * card is a DAY (ADR-149, `dayCard`): its performance titles it, its other
   * things are lines inside with their hour, and the next three things of
   * other days follow under it, one line each («Después»).
   *
   * Like the rail, it never follows the scope (ADR-096 § 5): it says what is
   * happening to you, wherever you are looking. And it never changes height
   * while the answer lands: the card is drawn with dashes first.
   *
   * THE CARD FIRST (ADR-148): when the card is today's, Hoy's headline is its
   * title, so on a phone the band's head is heard and not seen; the trip
   * before the show is a line inside the card, and «Ahora» is a door in its
   * foot, next to the road sheet. One fact, said once. Hour asks nothing
   * here: who goes is a roster or a «voy» (ADR-147).
   */
  import Button from '$lib/components/Button.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { dualTime, hourMark, localeDayMonth, localeDayMonthNear, localeWeekdayShort } from '$lib/datetime';
  import { LOCALE_TAG, t, type Locale } from '$lib/i18n';
  import { holdDeadlineLabel } from '$lib/performance';
  import { statusWord } from '$lib/planner';
  import { dayMoments, momentWordKey, type DateEvent, type SlipContext, type SlipKind } from '$lib/month-events';
  import { timedStages } from '$lib/pulse';
  import { stagePlace } from '$lib/travel-stage';
  import { plannerDayHref } from '$lib/planner';
  import { lensOn } from '$lib/lenses.svelte';
  import { castNames } from '$lib/people';
  import type { PerformanceEvent } from '$lib/month-events';
  import type { PulseNext } from '$lib/pulse';
  import { pulseSlip } from '$lib/pulse-feeds.svelte';
  import Slip from '$lib/components/planner/Slip.svelte';

  interface Props {
    /** The card: the next day's performance, else its first thing (`dayCard`). */
    next: PulseNext | null;
    /** The card's day before it and after it (the train to the show, a
        rehearsal after): lines inside the card, with their hour. */
    before?: PulseNext[];
    later?: PulseNext[];
    /** The next things of other days, one line each under the card (ADR-149). */
    after?: PulseNext[];
    settled: boolean;
    errored: boolean;
    /** «Reintentar»: read again what failed (the one voice of a failure). */
    onretry: () => void;
    today: string;
    viewerTz: string;
    /** New messages on the card's board (a performance's bolo), 0 without. */
    boardNew?: number;
    slipCtx: SlipContext;
    /** The roster's names, as the Day draws them ($lib/people `castNames`);
        null while the names are loading, so «sin reparto» never flashes. */
    personNames: ReadonlyMap<string, string> | null;
    /** Ahora's door (ADR-146), in the card's foot while it applies; never
        enters by itself. */
    ahoraHref?: string | null;
    locale: Locale;
  }

  let { next, before = [], later = [], after = [], settled, errored, onretry, today, viewerTz, boardNew = 0, slipCtx, personNames, ahoraHref = null, locale }: Props = $props();

  const kindLabel = (kind: SlipKind) => t(`planner.kind_${kind}`, locale);
  /* A hold says what it is in the house word («1.ª opción · vence lun»), as
     the month and the diary do: the card has the room the rail does not. */
  function stateLabel(sl: NonNullable<typeof slip>): string | null {
    if (sl.cert !== 'hold' || !sl.hold) return null;
    const rank = statusWord(sl.hold.rank ? `hold_${sl.hold.rank}` : 'hold', locale);
    return sl.hold.expires ? `${rank} · ${holdDeadlineLabel(sl.hold.expires, today, locale, LOCALE_TAG[locale], true)}` : rank;
  }

  let slip = $derived(next ? pulseSlip(next.ref, next.day, slipCtx) : null);
  // Its own page, else the day in the Planner while the space uses it (ADR-132).
  let farHref = $derived(slip?.href ?? (next && lensOn('planner') ? plannerDayHref('day', next.day) : undefined));

  function daysTo(day: string): number {
    return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  }
  function relDay(day: string): string {
    const n = daysTo(day);
    return n <= 0 ? t('desk.next_today', locale) : n === 1 ? t('desk.next_tomorrow', locale) : t('desk.next_in_days', locale, { n });
  }
  const dateWords = (day: string) => `${localeWeekdayShort(day, locale)} ${localeDayMonth(day, locale)}`;
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);

  /** The running order, venue-first; a free moment keeps its own name. A
      trip says its stages instead (ADR-146): the train at 9h12, its
      reference, not «viaje». */
  let moments = $derived.by(() => {
    if (!next) return [];
    const stages = next.ref.of === 'date' ? timedStages(next.ref.row as DateEvent) : [];
    if (stages.length > 0)
      return stages.map((s) => ({
        label: [t(`planner.mode_${s.mode}`, locale), stagePlace(s.to_city, s.to_place), s.reference].filter(Boolean).join(' · '),
        at: hour(s.depart_at!, s.depart_tz ?? next.ref.tz),
      }));
    return dayMoments(next.ref.row).map((m) => ({
      label: m.label ?? (m.key ? t(momentWordKey(m.key), locale) : ''),
      at: hour(m.at, next.ref.tz),
    }));
  });

  let roadsheet = $derived(slip && next?.ref.of === 'performance' && slip.href ? `${slip.href}/roadsheet` : null);
  /* WHO GOES: a show has a cast, a trip or a press call does not (the Day's
     law, Slip `cast`). The editor (`WhoGoes`) does not fit a card: the line
     says who, and «Quién va» opens it in the sheet. */
  let cast = $derived(
    next?.ref.of === 'performance' && personNames
      ? castNames((next.ref.row as PerformanceEvent).person_ids, personNames)
      : null,
  );
  // Without its project (read through a bolo: a guest) nobody here edits
  // «quién va», and the record draws no list to land on.
  let whoHref = $derived(
    next?.ref.of === 'performance' && slip?.href && next.ref.row.project ? `${slip.href}#who-goes` : null,
  );
  /* «Tablón · 3 nuevos» (plan 2026-10-22 § 3.3): only when it has news, and
     straight to the board (`#board`). */
  let boardHref = $derived(next?.ref.of === 'performance' && slip?.href && boardNew > 0 ? `${slip.href}#board` : null);
  /* Anything but a fact is drawn as a claim: a company date nobody is
     named on is shown, not claimed for you (ADR-147). */
  let guess = $derived(next ? next.ref.attribution !== 'explicit' : false);
  /* The card is today's: Hoy's headline already names it (ADR-148). */
  let headlined = $derived(settled && !errored && next !== null && daysTo(next.day) <= 0);
</script>

{#snippet line(item: PulseNext, label: string | null, withDay: boolean)}
  {@const sl = pulseSlip(item.ref, item.day, slipCtx)}
  {@const held = sl.cert === 'hold' || sl.cert === 'proposed'}
  {@const when = [withDay ? dateWords(item.day) : null, item.at ? hour(item.at, item.ref.tz) : null].filter(Boolean).join(' · ')}
  {@const place = [
    sl.lead ? `${t('planner.slip_to', locale)} ${sl.name}` : sl.name,
    sl.origin ? `${t('planner.slip_from', locale)} ${sl.origin}` : null,
    sl.city && sl.city !== sl.name ? sl.city : null,
  ]
    .filter(Boolean)
    .join(' · ')}
  <!-- The slip's own grammar in one line: the kind word, «?» and a leaning
       name while it is not firm (certainty.css § INFERENCE voice). The label
       is said once, on the first line of its group; its column stays. -->
  <li class="then">
    <span class="then__k" class:then__k--none={!label}>{label ?? ''}</span>
    <span class="then__when">{when}</span>
    <svelte:element this={sl.href ? 'a' : 'span'} href={sl.href} class="then__what">
      <span class="then__kind">{kindLabel(sl.kind)}{held ? '?' : ''}</span>
      <span class:guess={held}>{place}</span>
    </svelte:element>
  </li>
{/snippet}

{#snippet lines(items: PulseNext[], label: string, withDay: boolean)}
  {#if items.length > 0}
    <ul class="lines">
      {#each items as item, i (item.ref.of + item.ref.id)}{@render line(item, i === 0 ? label : null, withDay)}{/each}
    </ul>
  {/if}
{/snippet}

<section class="dband next" aria-labelledby="desk-next-h">
  <!-- No «Planificador →» here (ADR-145, fase 2): the bar of sections already
       goes there, and the day below opens the Planner on itself. -->
  <div class="next__head" class:visually-hidden--narrow={headlined}>
    <BlockHead title={t('desk.band_next', locale)} titleId="desk-next-h" />
  </div>

  {#if errored}
    <p class="load-fail" role="alert"><span>{t('desk.next_error', locale)}</span><Button size="xs" variant="secondary" onclick={onretry}>{t('ui.retry', locale)}</Button></p>
  {:else if !settled}
    <!-- The wait holds the lines a card usually draws (eyebrow, the slip's
         head, its name, the running order, the foot) and the line under it,
         so «Te espera» does not move when the answer lands (diseño M5). -->
    <div class="card card--wait" aria-hidden="true">
      <span class="card__eye"><span class="ghost-line" style:inline-size="40%">&nbsp;</span></span>
      <span class="card__eye"><span class="ghost-line" style:inline-size="18%">&nbsp;</span></span>
      <span class="card__dash"><span class="ghost-line" style:inline-size="55%">&nbsp;</span></span>
      <span class="card__slots"><span class="ghost-line" style:inline-size="45%">&nbsp;</span></span>
    </div>
    <p class="then" aria-hidden="true"><span class="ghost-line" style:inline-size="35%">&nbsp;</span></p>
  {:else if !next || !slip}
    <EmptyLine text={t('desk.next_empty', locale)} />
  {:else if daysTo(next.day) > 14}
    <!-- Far away is still «the next thing»: one sentence says there is
         nothing near and what comes, and opens it (ADR-149). -->
    {@const far = t('desk.next_far', locale, { day: localeDayMonthNear(next.day, today, locale), place: slip.city || slip.name })}
    <p class="empty-line">
      {#if farHref}<a class="empty-line__text next__far" href={farHref}>{far} →</a>{:else}<span class="empty-line__text">{far}</span>{/if}
    </p>
  {:else}
    <div class="card" data-testid="desk-next">
      <div class="card__eye">
        <span class="card__when">{relDay(next.day)} · {dateWords(next.day)}</span>{#if next.ref.row.project?.name}{' · '}<span class="card__proj"
            >{next.ref.row.project.name}</span
          >{/if}
      </div>
      <div class="card__slip">
        <Slip
          {slip}
          {kindLabel}
          {stateLabel}
          stateUrgent={Boolean(slip.hold?.expires && slip.hold.expires <= today)}
          showCountry
          ground="bare"
          placing="cell"
          size="l"
          {guess}
          {cast}
          noCastWord={t('planner.no_cast', locale)}
        />
      </div>
      {#if moments.length > 0}
        <div class="card__slots">
          {#each moments as m, i (i)}<span><span class="card__k">{m.label}</span> {m.at}</span>{/each}
        </div>
      {/if}
      <!-- The card's day, in order around it: the train before the show,
           a rehearsal after it (ADR-149; was one «Antes» line, ADR-148 § 4). -->
      {@render lines(before, t('desk.next_before', locale), false)}
      {@render lines(later, t('desk.next_then', locale), false)}
      {#if roadsheet || whoHref || boardHref || ahoraHref}
        <div class="card__foot">
          <span class="card__links">
            {#if boardHref}<a class="block-head__act" href={boardHref} data-testid="desk-next-board"
                >{boardNew === 1 ? t('desk.next_board_one', locale) : t('desk.next_board', locale, { n: boardNew })} →</a
              >{/if}
            {#if whoHref}<a class="block-head__act" href={whoHref}>{t('commitment.who_goes', locale)} →</a>{/if}
            {#if ahoraHref}<a class="card__rs btn--secondary btn--s" href={ahoraHref} aria-label={t('ahora.enter_aria', locale)} data-testid="ahora-enter"
                >{t('ahora.title', locale)}</a
              >{/if}
            {#if roadsheet}<a class="card__rs btn--secondary btn--s" href={roadsheet}>{t('desk.roadsheet', locale)} ↗</a>{/if}
          </span>
        </div>
      {/if}
    </div>
    <!-- What follows on other days, the next three, one line each (ADR-149). -->
    {#if after.length > 0}<div class="next__after" data-testid="desk-after">{@render lines(after, t('desk.next_after', locale), true)}</div>{/if}
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: var(--space-xs);
    padding: var(--space-m) var(--space-l);
    border: var(--line-hairline) solid var(--suggest-edge);
    background: var(--suggest-wash);
    border-radius: var(--radius-l);
    /* The answer's room is held before the answer lands. */
    min-block-size: 7.5rem;
    align-content: start;
  }
  /* The band's head, wrapped so a phone can hear it without seeing it when the
     headline already names the card (ADR-148): then it keeps no room either. */
  .next__head {
    margin-block-end: var(--space-s);
  }
  @media (max-width: 47.999rem) {
    .next__head.visually-hidden--narrow {
      margin: calc(-1 * var(--line-hairline));
    }
  }
  .card--wait {
    color: var(--text-faint);
  }
  .card__eye {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .card__when {
    color: var(--heading-color);
  }
  /* A project keeps its own name: neutral ink, its case, no tint (the slip
     already carries its monogram). */
  .card__proj {
    text-transform: none;
    letter-spacing: var(--mono-letter-spacing);
  }
  .card__dash {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    line-height: 1.15;
  }
  /* The slip, with room: `size="l"` sets its type (never rescaled here). */
  .card__slip {
    container-type: inline-size;
  }
  .card__slots {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-m);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .card__k {
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--mono-letter-spacing-loose);
  }
  .card__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-s) var(--space-m);
    margin-block-start: var(--space-2xs);
  }
  .card__links {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-s) var(--space-m);
    margin-inline-start: auto;
  }
  .card__rs {
    flex: none;
    white-space: nowrap;
  }
  /* LINES: label · when · what, one column each down the group (subgrid),
     so «Antes», «Luego» and «Después» and their hours fall on one vertical. */
  .lines {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    column-gap: var(--space-s);
    row-gap: var(--space-2xs);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .then {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  /* The wait's ghost line, and «Después» under the card: on the card's text
     edge (its padding plus its 1px border). */
  p.then,
  .next__after {
    margin: var(--space-s) 0 0;
    padding-inline: calc(var(--space-l) + var(--line-hairline));
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
  /* The kind word and the name run as one text, so a long name wraps under
     itself instead of dropping the whole name below its kind. */
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
  .then__kind {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
  }
  .then__kind {
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .then__k {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  @media (max-width: 47.999rem) {
    .card {
      padding: var(--space-s) var(--space-m);
      min-block-size: 6rem;
    }
    p.then,
    .next__after {
      padding-inline: calc(var(--space-m) + var(--line-hairline));
    }
    /* «Después» on a phone: its word heads the group on a row of its own, so
       the day and the name keep the width (three columns wrapped every name). */
    .next__after .lines {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .next__after .then__k {
      grid-column: 1 / -1;
    }
    .next__after .then__k--none {
      display: none;
    }
  }
</style>
