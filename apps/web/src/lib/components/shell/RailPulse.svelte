<script lang="ts">
  /**
   * THE PULSE — the rail's second sentence, under the clock.
   *
   *   NOW   free  UNTIL 15h30
   *   NEXT  [ÚO] 20h  CALL 15h30
   *         Teatre Principal
   *
   * The clock says when you are; this says what you are in. The truth layer
   * is `$lib/pulse` (pure, `now` injected, no words); this file fetches, and
   * translates the keys it gets back.
   *
   * IT NEVER CHANGES HEIGHT. Three lines, always — loading, empty, or full.
   * A block that appears and disappears above the scope list makes the whole
   * rail jump every time a query settles, and the rail is furniture: it must
   * be where it was a second ago. What has no truth draws a dash, which is
   * not the same as drawing nothing and not the same as drawing a guess.
   *
   * IT NEVER FILTERS BY SCOPE. It sits ABOVE the scope list on purpose: the
   * lens narrows what you are looking at, and this says what is happening to
   * you regardless of where you are looking. What it DOES narrow by is the
   * person axis — you — and only on facts (see $lib/pulse § whose day it is).
   *
   * Calm does not touch it (Marco, 2026-08-10): knowing what comes next is
   * the opposite of noise.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { dualTime, hourMark, localeDayMonth, localeWeekdayShort } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import type { DateEvent, PerformanceEvent } from '$lib/month-events';
  import { meQueryOptions, teamQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { buildPersonAttribution } from '$lib/people';
  import { dayKeyInTz } from '$lib/planner';
  import { computePulse, type PulseWord } from '$lib/pulse';
  import type { AvailabilityItem } from '$lib/availability';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';

  interface Props {
    /** The rail's clock, already ticking on the minute — one timer in the
        shell, not two. Everything here re-derives from it. */
    now: Date;
    locale: Locale;
  }

  let { now, locale }: Props = $props();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let today = $derived(dayKeyInTz(now.toISOString(), viewerTz));

  /** A multi-day row that began before today is still running today, and
      `/api/dates` filters on the row's START — so the window reaches back.
      Two weeks covers a residency or a tour leg; a longer one would spend
      the row budget on the past. */
  let datesFrom = $derived(
    new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10),
  );

  const meQuery = createQuery(meQueryOptions());
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let personId = $derived($meQuery.data?.person_id ?? null);
  let workspaces = $derived($workspacesQuery.data?.items ?? []);

  // Today forward, ordered by the server. Its own key: the hall and the desk
  // share `['today-performances']` without rosters, and the person axis needs
  // them — widening their URL would make three surfaces pay for this one.
  const perfQuery = createQuery(
    toStore(() => ({
      queryKey: ['pulse-performances', today] as const,
      staleTime: 5 * 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: PerformanceEvent[] }>(
          `/api/performances?status=any&from=${today}&limit=200&rosters=1`,
          signal,
        ),
    })),
  );

  const datesQuery = createQuery(
    toStore(() => ({
      queryKey: ['pulse-dates', datesFrom] as const,
      staleTime: 5 * 60_000,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: DateEvent[] }>(
            `/api/dates?from=${datesFrom}&limit=200`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          return { items: [] as DateEvent[] };
        }
      },
    })),
  );

  // The inference pool and the gate it stops at — fetched only for a login
  // that IS a person, because without one the axis never narrows anything.
  const teamQuery = createQuery(
    toStore(() =>
      teamQueryOptions(
        workspaces.map((w) => w.id),
        { enabled: Boolean(personId) },
      ),
    ),
  );
  const blocksQuery = createQuery(
    toStore(() => ({
      queryKey: ['pulse-availability', datesFrom] as const,
      enabled: Boolean(personId),
      staleTime: 5 * 60_000,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: AvailabilityItem[] }>(
            `/api/availability?from=${datesFrom}&limit=500`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          return { items: [] as AvailabilityItem[] };
        }
      },
    })),
  );

  let axis = $derived(
    buildPersonAttribution({
      pinnedPersonIds: personId ? [personId] : [],
      team: $teamQuery.data?.items ?? [],
      blocks: $blocksQuery.data?.items ?? [],
    }),
  );

  let pulse = $derived(
    computePulse(
      {
        performances: $perfQuery.data?.items ?? [],
        dates: $datesQuery.data?.items ?? [],
        viewerTz,
        axis,
      },
      now,
    ),
  );

  // Nothing has landed yet: draw the frame, claim nothing. «free» is a
  // statement about the day and an empty cache is not one.
  let settled = $derived($perfQuery.isSuccess && $datesQuery.isSuccess);

  /** A run-sheet key or a date kind → the words the app already owns.
      `start` has no anchor key of its own; the Desk calls that moment the
      show, and one moment may not have two names. */
  function wordLabel(word: PulseWord): string {
    if (word.of === 'step') {
      const key = word.key === 'load_in' ? 'loadin' : word.key === 'start' ? 'show' : word.key;
      return t(`desk.anchor_${key}`, locale);
    }
    return word.label ?? t(`planner.kind_${word.key}`, locale);
  }

  /** Venue-first, the planner's clock. No viewer gloss: the rail has 13rem
      and the clock right above it already says where the reader is. */
  function hour(iso: string, tz: string | null): string {
    return hourMark(dualTime(iso, tz, viewerTz).primary);
  }

  let doingLabel = $derived(pulse.now.doing ? wordLabel(pulse.now.doing.word) : null);
  let untilLabel = $derived(
    pulse.now.until ? hour(pulse.now.until.at, pulse.now.until.tz) : null,
  );
  /** Anything but a fact is a claim, and a claim is drawn as one. */
  let nowGuess = $derived(
    pulse.now.doing ? pulse.now.doing.ref.attribution !== 'explicit' : false,
  );
  let nextGuess = $derived(pulse.next ? pulse.next.ref.attribution !== 'explicit' : false);

  let nextHour = $derived(pulse.next?.at ? hour(pulse.next.at, pulse.next.ref.tz) : null);
  let nextCall = $derived(pulse.next?.call ? hour(pulse.next.call, pulse.next.ref.tz) : null);
  /** A gig is named by its hour and its venue; a rehearsal has to say what
      it is, or the row reads as a show at 10 in the morning. */
  let nextWord = $derived(pulse.next ? wordLabel(pulse.next.word) : '');

  /** Another day gets named; today does not — the clock above already did. */
  let nextDay = $derived.by(() => {
    if (!pulse.next || pulse.next.today) return null;
    const days = Math.round(
      (Date.parse(`${pulse.next.day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    return days <= 6
      ? `${localeWeekdayShort(pulse.next.day, locale)} ${Number(pulse.next.day.slice(8, 10))}`
      : localeDayMonth(pulse.next.day, locale);
  });

  let nextHref = $derived.by(() => {
    const ref = pulse.next?.ref;
    if (!ref || ref.of !== 'performance' || !ref.slug || !ref.project) return null;
    const ws = workspaces.find((w) => w.id === ref.project?.workspace_id);
    return ws ? `/h/${ws.slug}/performance/${ref.slug}` : null;
  });
</script>

<!-- ONE GRID, not two rows that happen to line up: the label column sizes
     itself to the longest word in whatever language is on, and NOW and NEXT
     cannot drift apart when that word changes. -->
<div class="pulse">
  <span class="pulse__k">{t('pulse.now', locale)}</span>
  <span class="pulse__v">
    {#if !settled}
      <span class="pulse__dash">—</span>
    {:else if doingLabel}
      <span class="pulse__doing" class:guess={nowGuess}>{doingLabel}</span>
    {:else}
      <span class="pulse__doing">{t('pulse.free', locale)}</span>
    {/if}
    {#if untilLabel}
      <span class="pulse__note"
        ><span class="pulse__lab">{t('planner.away_until', locale)}</span> {untilLabel}</span
      >
    {/if}
  </span>

  <span class="pulse__k pulse__k--next">{t('pulse.next', locale)}</span>
  <span class="pulse__v pulse__v--next">
    {#if !settled || !pulse.next}
      <span class="pulse__dash">—</span>
    {:else}
      {#if pulse.next.ref.project}
        <IdentityMark
          mini
          accent={accentVarFor(pulse.next.ref.project)}
          name={pulse.next.ref.project.name}
          initials={pulse.next.ref.project.initials}
        />
      {/if}
      {#if nextDay}<span class="pulse__note">{nextDay}</span>{/if}
      <span class="pulse__at" class:guess={nextGuess}>{nextHour ?? nextWord}</span>
      {#if nextHour && pulse.next.ref.of === 'date'}
        <span class="pulse__word">{nextWord}</span>
      {/if}
      {#if nextCall}
        <span class="pulse__note"
          ><span class="pulse__lab">{t('pulse.call', locale)}</span> {nextCall}</span
        >
      {/if}
    {/if}
  </span>

  <!-- The place holds its line whether or not it has anything to say: it is
       the row that would make the rail jump, because a venue name is the last
       thing to arrive and the first thing to be missing. -->
  <p class="pulse__place" class:guess={nextGuess}>
    {#if settled && pulse.next?.ref.place}
      {#if nextHref}
        <a href={nextHref}>{pulse.next.ref.place}</a>
      {:else}
        {pulse.next.ref.place}
      {/if}
    {/if}
  </p>
</div>

<style>
  .pulse {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: baseline;
    column-gap: var(--space-s);
    padding-inline: var(--space-xs);
  }
  /* The air goes BETWEEN the two sentences, not inside one: the venue
     belongs to NEXT and stays tucked under it. */
  .pulse__k--next,
  .pulse__v--next {
    margin-block-start: var(--space-xs);
  }
  /* The rail's own micro-label voice — the same one .side-sec__h and the
     clock's date already speak (uppercase mono, faint, loose). */
  .pulse__k {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .pulse__v {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 var(--space-xs);
    min-inline-size: 0;
  }
  /* What you are in, and the hour of what is next: the two figures that
     carry the block. Mono, because they are read as data. */
  .pulse__doing,
  .pulse__at {
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--heading-color);
  }
  /* Everything that qualifies a figure — until, call, the day — is margin
     voice: it must never compete with the figure it qualifies. */
  .pulse__note,
  .pulse__word {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    color: var(--text-faint);
    white-space: nowrap;
  }
  /* ONLY THE LABEL SHOUTS. `until` and `call` are labels and go up in caps
     with the rest of the rail's furniture; the hour they introduce is a
     VALUE and keeps the planner's own clock, where the `h` is lowercase and
     part of the number. Uppercasing the whole note turned 11h into 11H. */
  .pulse__lab {
    text-transform: uppercase;
  }
  /* A kind is a value too, not a label: a rehearsal says what it is at the
     volume of the hour beside it, and the venue below still gets to speak. */
  .pulse__word {
    color: var(--text-muted);
  }
  .pulse__dash {
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--text-faint);
  }
  /* THE ONE THING THE BLOCK IS ABOUT. Body size, in the sans, under a rail
     that is otherwise all mono furniture — where you are going next is a
     place with a name, and the two hours above it are its coordinates. */
  .pulse__place {
    grid-column: 2;
    margin: 0;
    /* The line is held whether or not it says anything — see the markup. */
    min-block-size: 1lh;
    font-family: var(--font-sans);
    font-size: var(--text-m);
    line-height: 1.25;
    color: var(--text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pulse__place a {
    color: inherit;
    text-decoration: none;
  }
  .pulse__place a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
