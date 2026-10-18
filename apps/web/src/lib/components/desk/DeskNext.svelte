<script lang="ts">
  /**
   * «LO SIGUIENTE» — band 1 of the Desk (ADR-117). The rail's NEXT, given room:
   * the same `computePulse` answer over the same feeds ($lib/pulse-feeds), the
   * same Slip for what it is called and where (ADR-095 § 0), plus what the rail
   * cannot afford: the day in words, the running order, the road sheet, and
   * whatever else lands within 48 hours as one line under it.
   *
   * Like the rail, it never follows the scope (ADR-096 § 5): it says what is
   * happening to you, wherever you are looking. And it never changes height
   * while the answer lands: the card is drawn with dashes first.
   */
  import { useQueryClient } from '@tanstack/svelte-query';
  import { addToast } from '$lib/components/Toast.svelte';
  import { ApiError } from '$lib/api';
  import { dualTime, hourMark, localeDayMonth, localeDayMonthNear, localeWeekdayShort } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { dayMoments, type SlipContext, type SlipKind } from '$lib/month-events';
  import { setCommitment } from '$lib/commitments';
  import { plannerDayHref } from '$lib/planner';
  import type { CommitmentState } from '$lib/people';
  import type { PulseNext } from '$lib/pulse';
  import { pulseSlip } from '$lib/pulse-feeds.svelte';
  import Slip from '$lib/components/planner/Slip.svelte';

  interface Props {
    next: PulseNext | null;
    /** A second thing within 48 h of the first, as one line. */
    then: PulseNext | null;
    /** The line comes before the card, the same day (the trip to the show). */
    thenBefore?: boolean;
    settled: boolean;
    errored: boolean;
    today: string;
    viewerTz: string;
    personId: string | null;
    slipCtx: SlipContext;
    locale: Locale;
  }

  let { next, then, thenBefore = false, settled, errored, today, viewerTz, personId, slipCtx, locale }: Props = $props();

  const kindLabel = (kind: SlipKind) => t(`planner.kind_${kind}`, locale);
  const queryClient = useQueryClient();

  let slip = $derived(next ? pulseSlip(next.ref, next.day, slipCtx) : null);
  let thenSlip = $derived(then ? pulseSlip(then.ref, then.day, slipCtx) : null);

  function daysTo(day: string): number {
    return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  }
  function relDay(day: string): string {
    const n = daysTo(day);
    return n <= 0 ? t('desk.next_today', locale) : n === 1 ? t('desk.next_tomorrow', locale) : t('desk.next_in_days', locale, { n });
  }
  const dateWords = (day: string) => `${localeWeekdayShort(day, locale)} ${localeDayMonth(day, locale)}`;
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);

  /** The running order, venue-first; a free moment keeps its own name. */
  let moments = $derived(
    next
      ? dayMoments(next.ref.row).map((m) => ({
          label: m.label ?? (m.key ? t(`desk.anchor_${m.key === 'load_in' ? 'loadin' : m.key === 'start' ? 'show' : m.key}`, locale) : ''),
          at: hour(m.at, next.ref.tz),
        }))
      : [],
  );

  let roadsheet = $derived(slip && next?.ref.of === 'performance' && slip.href ? `${slip.href}/roadsheet` : null);
  let guess = $derived(next ? next.ref.attribution !== 'explicit' : false);

  // ADR-103: only an inferred row asks; an unattributed one is the company's day.
  let answering = $state(false);
  let canAnswer = $derived(Boolean(personId) && next?.ref.attribution === 'inferred' && !answering);
  async function answer(state: CommitmentState) {
    if (!next || !personId) return;
    answering = true;
    try {
      await setCommitment(queryClient, next.ref.of, next.ref.id, personId, state);
    } catch (err) {
      addToast({ tone: 'danger', title: t('desk.toast_change_failed', locale), message: err instanceof ApiError ? err.message : t('perf.unexpected', locale) });
    } finally {
      answering = false;
    }
  }
</script>

{#snippet thenLine()}
  {#if then && thenSlip}
    {@const held = thenSlip.cert === 'hold' || thenSlip.cert === 'proposed'}
    {@const when = thenBefore ? (then.at ? hour(then.at, then.ref.tz) : '') : dateWords(then.day)}
    {@const place = [
      thenSlip.lead ? `${t('planner.slip_to', locale)} ${thenSlip.name}` : thenSlip.name,
      thenSlip.origin ? `${t('planner.slip_from', locale)} ${thenSlip.origin}` : null,
      thenSlip.city,
    ]
      .filter(Boolean)
      .join(' · ')}
    <!-- The slip's own grammar in one line: the kind word, «?» and a leaning
         name while it is not firm (certainty.css § INFERENCE voice). -->
    <p class="then">
      <span class="then__k">{t(thenBefore ? 'desk.next_before' : 'desk.next_then', locale)}</span>
      <svelte:element this={thenSlip.href ? 'a' : 'span'} href={thenSlip.href} class="then__what">
        {#if when}<span class="then__when">{when}</span>{/if}
        <span class="then__kind">{kindLabel(thenSlip.kind)}{held ? '?' : ''}</span>
        <span class:guess={held}>{place}</span>
      </svelte:element>
    </p>
  {/if}
{/snippet}

<section class="dband next" aria-labelledby="desk-next-h">
  <h2 class="dband__h">
    <span id="desk-next-h">{t('desk.band_next', locale)}</span>
    <a class="dband__more" href="/h/planner">{t('lens.planner', locale)} →</a>
  </h2>

  {#if errored}
    <p class="load-fail">{t('desk.next_error', locale)}</p>
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
    <p class="dband__empty">{t('desk.next_empty', locale)}</p>
  {:else if daysTo(next.day) > 14}
    <!-- Far away is still «the next thing»: the band says which, as the rail does. -->
    <p class="dband__empty">
      <a href={slip.href ?? plannerDayHref('day', next.day)}
        >{t('desk.next_far', locale, { day: localeDayMonthNear(next.day, today, locale), place: slip.city || slip.name })} →</a
      >
    </p>
  {:else}
    {#if thenBefore}{@render thenLine()}{/if}
    <div class="card" data-testid="desk-next">
      <div class="card__eye">
        <span class="card__when">{relDay(next.day)} · {dateWords(next.day)}</span>{#if next.ref.row.project?.name}{' · '}<span class="card__proj"
            >{next.ref.row.project.name}</span
          >{/if}
      </div>
      <div class="card__slip">
        <Slip {slip} {kindLabel} stateLabel={() => null} showCountry ground="bare" placing="cell" size="l" {guess} />
      </div>
      {#if moments.length > 0}
        <div class="card__slots">
          {#each moments as m, i (i)}<span><span class="card__k">{m.label}</span> {m.at}</span>{/each}
        </div>
      {/if}
      {#if canAnswer || roadsheet}
        <div class="card__foot">
          {#if canAnswer}
            <span class="card__ask">
              {t('desk.next_ask', locale)}
              <!-- The same answer as a «¿vas?» row of «Te espera»: the system's button. -->
              <button
                type="button"
                class="card__btn btn--outline btn--xs"
                aria-label={t('desk.going_aria', locale, { subject: slip.name })}
                onclick={() => answer('going')}>{t('pulse.going', locale)}</button
              ><button
                type="button"
                class="card__btn card__btn--quiet btn--outline btn--xs"
                aria-label={t('desk.not_going_aria', locale, { subject: slip.name })}
                onclick={() => answer('not_going')}>{t('pulse.not_going', locale)}</button
              >
            </span>
          {/if}
          {#if roadsheet}<a class="card__rs btn--outline btn--s" href={roadsheet}>{t('desk.roadsheet', locale)} ↗</a>{/if}
        </div>
      {/if}
    </div>
    {#if !thenBefore}{@render thenLine()}{/if}
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: var(--space-xs);
    padding: var(--space-m) var(--space-l);
    border: 1px solid var(--suggest-edge);
    background: var(--suggest-wash);
    border-radius: var(--radius-l);
    /* The answer's room is held before the answer lands. */
    min-block-size: 7.5rem;
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
  .card__ask {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    color: var(--text-faint);
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }
  .card__btn {
    --btn-padding-block: var(--space-2xs);
    --btn-padding-inline: var(--space-s);
  }
  .card__btn--quiet {
    --btn-border-color: transparent;
    --btn-background-hover: transparent;
    --btn-text-color: var(--text-faint);
  }
  .card__rs {
    flex: none;
    --btn-padding-block: var(--space-2xs);
    white-space: nowrap;
  }
  .then {
    display: flex;
    gap: var(--space-s);
    align-items: baseline;
    margin: var(--space-s) 0 0;
    /* On the card's text edge: its padding plus its 1px border. */
    padding-inline: calc(var(--space-l) + 1px);
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  /* The trip before the show sits above its card. */
  .then:has(+ .card) {
    margin: 0 0 var(--space-s);
  }
  .then__what {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-xs);
    color: inherit;
    text-decoration: none;
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
    .then {
      padding-inline: calc(var(--space-m) + 1px);
    }
  }
</style>
