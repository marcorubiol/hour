<script lang="ts">
  /**
   * /h — the hall: the calm landing behind the logo (Marco's design,
   * 2026-07-16). A time-aware greeting, today's date, the status sentence
   * (ADR-068/069; spec § /h — the hall), and one door — "posa'm al dia" —
   * straight to /h/desk. The cross-space digest that used to live here
   * died 2026-07-17: Desk IS the catch-up surface (ADR-065), no
   * intermediate page. The left rail's scope rows also navigate to
   * /h/desk when clicked from here (see the shell).
   *
   * The status sentence is the AI layer's first voice surface (ADR-069):
   * truth-computed from the same caches Desk reads, never decorative.
   * While its data loads — or fails — the hall stays silent (greeting
   * only): silence over lies.
   */
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchJSON } from '$lib/api';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { session } from '$lib/session.svelte';
  import { detectLocale, t } from '$lib/i18n';
  import {
    computeHallStatus,
    hallSentence,
    type HallEngagement,
    type HallPerformance,
    type HallTask,
  } from '$lib/hall-status';

  // The /h subtree renders client-only (ssr = false in +layout.ts), so
  // navigator is safe at init. detectLocale carries the TODO for the
  // intended source, user_profile.locale.
  const locale = detectLocale(navigator.language);

  // Matí / tarda / nit — recomputed on each mount (every landing).
  const hourNow = new Date().getHours();
  const greeting = t(
    hourNow < 6 || hourNow >= 21
      ? 'hall.greeting_night'
      : hourNow < 14
        ? 'hall.greeting_morning'
        : 'hall.greeting_afternoon',
    locale,
  );

  let firstName = $derived(
    (session.user?.name ?? session.user?.email?.split('@')[0] ?? '').split(/\s+/)[0] ?? '',
  );

  // "divendres · 17 juliol" — CSS mono-caps does the shouting.
  const today = new Date();
  const dateLabel = `${new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(today)} · ${today.getDate()} ${new Intl.DateTimeFormat(locale, { month: 'long' }).format(today)}`;

  // Status sentence inputs. Every query key is shared with an existing
  // surface (Desk / HomeView / PerformanceCreateDialog invalidation) so
  // the hall reads warm caches instead of refetching — rename keys there
  // and here together, or nowhere.
  const engagementsQuery = createQuery({
    queryKey: ['engagements', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: HallEngagement[] }>('/api/engagements?status=any&limit=100', signal),
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
      !$engagementsQuery.isSuccess ||
      !$performancesQuery.isSuccess ||
      !$tasksQuery.isSuccess
    ) {
      return null;
    }
    return computeHallStatus(
      {
        engagements: $engagementsQuery.data.items,
        performances: $performancesQuery.data.items,
        tasks: $tasksQuery.data.items,
        homeTzById,
      },
      new Date(),
    );
  });
  let sentence = $derived(status ? hallSentence(status, locale) : null);
</script>

<section class="hall" aria-label="Home">
    <div class="hall__center">
      <h1 class="hall__greeting">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
      <p class="hall__date">{dateLabel}</p>
      {#if sentence}
        <p class="hall__status">{sentence}</p>
      {/if}
      <button type="button" class="hall__door" onclick={() => goto('/h/desk')}>
        <span class="hall__door-glyph" aria-hidden="true">✻</span>
        <span>{t('hall.door', locale)}</span>
      </button>
    </div>
  </section>

<style>
  .hall {
    /* Fill the content column: viewport minus the top bar minus the shell
       content paddings (--space-l top, --space-xxl bottom) — true by
       construction, no approximations. --header-height cascades from
       .shell in the layout. */
    min-block-size: calc(100vh - var(--header-height) - var(--space-l) - var(--space-xxl));
    display: grid;
    place-items: center;
    /* The warm halo behind the greeting. Mixed from bg tokens so both
       themes hold (ADR-059: light AND dark are contracts). */
    background: radial-gradient(
      ellipse 46% 40% at 50% 46%,
      color-mix(in oklch, var(--bg-ultra-light) 85%, var(--bg)),
      transparent 72%
    );
  }

  .hall__center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .hall__greeting {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(3rem, 7vw, 6.5rem);
    letter-spacing: -0.02em;
    line-height: 1.05;
    color: var(--heading-color);
  }

  .hall__date {
    margin: 0;
    margin-block-start: var(--space-l);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .hall__status {
    margin: 0;
    margin-block-start: var(--space-xl);
    max-inline-size: 44ch;
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-l);
    line-height: var(--text-line-height);
    color: var(--text-color);
    text-wrap: balance;
  }

  .hall__door {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-xl);
    padding-block: var(--space-s);
    padding-inline: var(--space-l);
    background: color-mix(in oklch, var(--bg) 55%, transparent);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      border-color var(--transition),
      background var(--transition);
  }
  .hall__door:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
    background: var(--bg-ultra-light);
  }

  .hall__door-glyph {
    color: var(--accent-7);
    line-height: 1;
  }
</style>
