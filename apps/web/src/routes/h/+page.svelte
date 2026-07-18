<script lang="ts">
  /**
   * /h — the hall: the calm landing behind the logo (Marco's design,
   * 2026-07-16 → clock redesign 2026-07-18). The layout, top to bottom:
   *
   *   · a big serif CLOCK — the brand signature (the app is Hour); the
   *     one live-ticking element the rest reads from,
   *   · a quiet RELATION line to the next timed moment, but only when it
   *     is genuinely imminent (≤18h) — the day horizon is the sentence's job,
   *   · a time-aware GREETING + name,
   *   · the AI STATUS SENTENCE (ADR-068/069; spec § /h — the hall),
   *   · two doors — "posa'm al dia" straight to /h/desk, and "Nou apunt"
   *     (a new free task, authored on the Desk composer),
   *   · a subordinate day TEASER: today's timed moments + open notes.
   *
   * The cross-space digest that used to live here died 2026-07-17: Desk IS
   * the catch-up surface (ADR-065), no intermediate page.
   *
   * Every dynamic string is truth-computed from the same caches Desk reads,
   * never decorative. While a query loads — or fails — its element stays
   * absent (sentence, relation, teaser): silence over lies. The clock and
   * greeting are the only always-present copy.
   */
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchJSON } from '$lib/api';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { session } from '$lib/session.svelte';
  import { detectLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import {
    computeHallStatus,
    hallSentence,
    nextTimedMoment,
    todayMoments,
    type HallConversation,
    type HallPerformance,
    type HallTask,
  } from '$lib/hall-status';

  // The /h subtree renders client-only (ssr = false in +layout.ts), so
  // navigator is safe at init. detectLocale carries the TODO for the
  // intended source, user_profile.locale.
  const locale = detectLocale(navigator.language);

  // ── The clock ──────────────────────────────────────────────────────
  // The hall lives while it's open, so unlike the old mount-frozen date
  // this ticks on the minute (the clock shows HH:MM). Greeting, date and
  // the relation line all read this one source, so they cross midnight and
  // the matí/tarda/nit boundary together — live, never stale.
  let clockNow = $state(new Date());
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        clockNow = new Date();
        tick();
      }, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let clockTime = $derived(timeFmt.format(clockNow));

  // Matí / tarda / nit — derived from the tick, so it flips live at 6/14/21h.
  let greeting = $derived.by(() => {
    const h = clockNow.getHours();
    return t(
      h < 6 || h >= 21
        ? 'hall.greeting_night'
        : h < 14
          ? 'hall.greeting_morning'
          : 'hall.greeting_afternoon',
      locale,
    );
  });

  let firstName = $derived(
    (session.user?.name ?? session.user?.email?.split('@')[0] ?? '').split(/\s+/)[0] ?? '',
  );

  // ── Status-sentence inputs ─────────────────────────────────────────
  // Every query key is shared with an existing surface (Desk / HomeView /
  // PerformanceCreateDialog invalidation) so the hall reads warm caches
  // instead of refetching — rename keys there and here together, or nowhere.
  const conversationsQuery = createQuery({
    queryKey: ['conversations', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: HallConversation[] }>('/api/conversations?status=any&limit=100', signal),
  });
  const performancesQuery = createQuery({
    queryKey: ['today-performances'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: HallPerformance[] }>(
        `/api/performances?status=any&from=${new Date().toISOString().slice(0, 10)}&limit=200`,
        signal,
      ),
  });
  const tasksQuery = createQuery({
    queryKey: ['tasks', 'open'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: HallTask[] }>('/api/tasks?status=open&limit=200', signal),
  });
  // Home timezones for venue-less show days (timezone rule) — the shell
  // keeps this cache warm; the sentence does NOT wait for it (it only
  // sharpens the zone fallback once it lands).
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let homeTzById = $derived(
    Object.fromEntries(
      ($workspacesQuery.data?.items ?? [])
        .filter((w) => w.timezone)
        .map((w) => [w.id, w.timezone as string]),
    ),
  );

  // Truth rule: only settled data speaks. Pending or errored → null →
  // no sentence element at all (no placeholder, no spinner text).
  let status = $derived.by(() => {
    if (
      !$conversationsQuery.isSuccess ||
      !$performancesQuery.isSuccess ||
      !$tasksQuery.isSuccess
    ) {
      return null;
    }
    return computeHallStatus(
      {
        conversations: $conversationsQuery.data.items,
        performances: $performancesQuery.data.items,
        tasks: $tasksQuery.data.items,
        homeTzById,
      },
      clockNow,
    );
  });
  let sentence = $derived(status ? hallSentence(status, locale) : null);

  // ── Relation line ──────────────────────────────────────────────────
  // The next timed moment, surfaced only while it is imminent. Beyond the
  // horizon there is no relation line — the sentence already carries the
  // day ("la propera espera fins dijous"), so the two never say the same
  // thing twice.
  const RELATION_HORIZON_MIN = 18 * 60;
  let nextMoment = $derived(
    $performancesQuery.isSuccess ? nextTimedMoment($performancesQuery.data.items, clockNow) : null,
  );
  let relation = $derived.by(() => {
    if (!nextMoment) return null;
    const mins = Math.round((Date.parse(nextMoment.at) - clockNow.getTime()) / 60_000);
    if (mins <= 0 || mins > RELATION_HORIZON_MIN) return null;
    const when =
      mins < 60
        ? t('hall.relation_minutes', locale, { m: mins })
        : t('hall.relation_hours', locale, { h: Math.round(mins / 60) });
    return `${when} · ${nextMoment.place}`;
  });

  // ── Day teaser ─────────────────────────────────────────────────────
  // Today's timed moments + the open-notes count, from the same caches.
  // A quiet recap and a glance into the Desk — never a second agenda.
  let teaserTimes = $derived(
    ($performancesQuery.isSuccess ? todayMoments($performancesQuery.data.items, clockNow) : []).map(
      (m) => ({ time: timeFmt.format(new Date(m.at)), place: m.place }),
    ),
  );
  let openNotes = $derived(
    $tasksQuery.isSuccess ? $tasksQuery.data.items.filter((task) => task.status === 'open').length : 0,
  );
  let notesLabel = $derived(
    !$tasksQuery.isSuccess || openNotes === 0
      ? null
      : openNotes === 1
        ? t('hall.teaser_notes_one', locale)
        : t('hall.teaser_notes_many', locale, { n: openNotes }),
  );
  let hasTeaser = $derived(teaserTimes.length > 0 || notesLabel !== null);
</script>

<section class="hall" aria-label="Home">
  <div class="hall__center">
    <time class="hall__clock" datetime={clockTime}>{clockTime}</time>

    {#if relation}
      <p class="hall__relation">{relation}</p>
    {/if}

    <h1 class="hall__greeting">{greeting}{firstName ? `, ${firstName}` : ''}</h1>

    {#if sentence}
      <p class="hall__status">{sentence}</p>
    {/if}

    <div class="hall__actions">
      <Button variant="primary" size="s" onclick={() => goto('/h/desk')}>
        {t('hall.door', locale)}
        {#snippet tail()}<span aria-hidden="true">→</span>{/snippet}
      </Button>
      <Button variant="outline" size="s" onclick={() => goto('/h/desk?compose=1')}>
        {t('hall.action_note', locale)}
      </Button>
    </div>

    {#if hasTeaser}
      <p class="hall__teaser">
        {#each teaserTimes as item, i (item.time + item.place + i)}<span
            class="hall__teaser-time">{item.time}</span
          > {item.place}{#if i < teaserTimes.length - 1 || notesLabel}<span
            class="hall__teaser-sep" aria-hidden="true"> · </span>{/if}{/each}{#if notesLabel}{notesLabel}{/if}
      </p>
    {/if}
  </div>
</section>

<style>
  .hall {
    /* Fill the content column: viewport minus the top bar minus the shell
       content paddings (--space-l top, --space-xxl bottom) — true by
       construction. --header-height cascades from .shell in the layout. */
    min-block-size: calc(100vh - var(--header-height) - var(--space-l) - var(--space-xxl));
    display: grid;
    place-items: center;
    /* The warm halo behind the clock. Mixed from bg tokens so both themes
       hold (ADR-059: light AND dark are contracts). */
    background: radial-gradient(
      ellipse 48% 46% at 50% 44%,
      color-mix(in oklch, var(--bg-ultra-light) 85%, var(--bg)),
      transparent 72%
    );
  }

  .hall__center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-inline-size: 54ch;
  }

  /* The signature: the clock IS the brand (the app is Hour). Biggest
     element on the page — the greeting sits a step under it. */
  .hall__clock {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(3.5rem, 12vw, 9.5rem);
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--heading-color);
    font-variant-numeric: tabular-nums;
  }

  /* Relation to the next timed moment — quiet mono caps under the clock. */
  .hall__relation {
    margin: 0;
    margin-block-start: var(--space-m);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .hall__greeting {
    margin: 0;
    margin-block-start: var(--space-l);
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(1.75rem, 4.5vw, 2.75rem);
    letter-spacing: -0.02em;
    line-height: 1.1;
    color: var(--heading-color);
  }

  .hall__status {
    margin: 0;
    margin-block-start: var(--space-m);
    max-inline-size: 46ch;
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-l);
    line-height: var(--text-line-height);
    color: var(--text-color);
    text-wrap: balance;
  }

  /* Two-pill actions. The pill radius comes from the button's variable
     contract (principle 3): the shared Button defaults to the 6px card
     radius; the hall redeclares it to a full circle without touching the
     component. */
  .hall__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-s);
    margin-block-start: var(--space-xl);
    --btn-border-radius: var(--radius-circle);
    --btn-padding-inline: var(--space-l);
    --btn-padding-block: var(--space-s);
  }

  /* The day teaser — a quiet recap, clearly subordinate to the sentence.
     A flowing line that wraps centered, not a second agenda. */
  .hall__teaser {
    margin: 0;
    margin-block-start: var(--space-xl);
    max-inline-size: 54ch;
    font-size: var(--text-s);
    line-height: 1.8;
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .hall__teaser-time {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    color: var(--text-color);
  }
  .hall__teaser-sep {
    color: var(--text-faint);
  }
</style>
