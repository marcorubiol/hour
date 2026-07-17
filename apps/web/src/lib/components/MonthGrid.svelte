<script module lang="ts">
  /**
   * Month grid presentation for the Calendar lens — weeks × days with
   * performance/date chips, day numbers, and the quiet per-day "+"
   * affordance. Pure presentation over already-scoped rows: the page owns
   * the feeds and the pins filtering, this component owns bucketing +
   * layout. Grid math stays in $lib/calendar.
   *
   * Class names keep the original `cal__` block from the calendar page —
   * the e2e specs select `.cal__grid` / `.cal__weekday` (Svelte scoping
   * keeps them collision-free anyway).
   */
  import { dayKeyInTz, monthGrid } from '$lib/calendar';

  export type ProjectLite = {
    id: string;
    slug: string;
    name: string;
    accent?: string | null;
    workspace_id: string;
  };

  export type PerformanceEvent = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    start_at: string | null;
    venue_name: string | null;
    city: string | null;
    line_id: string | null;
    project: ProjectLite | null;
    venue: { name: string; city: string | null; timezone: string | null } | null;
  };

  export type DateEvent = {
    id: string;
    kind: string;
    status: string;
    title: string | null;
    starts_at: string;
    all_day: boolean;
    venue_name: string | null;
    city: string | null;
    project: ProjectLite | null;
    venue: { timezone: string | null } | null;
  };

  /** Day bucket of a performance — performed_at is day-level truth. */
  export function perfDayKey(p: PerformanceEvent): string {
    return p.performed_at.slice(0, 10);
  }

  /**
   * Day bucket of a date row. All-day rows are calendar dates, not
   * instants — keep the stored day. Timed rows follow the timezone rule
   * (spec § Timezone rule): the day of THEIR venue when one is linked,
   * the viewer's day otherwise.
   */
  export function dateDayKey(d: DateEvent, timeZone: string): string {
    if (d.all_day) return d.starts_at.slice(0, 10);
    return dayKeyInTz(d.starts_at, d.venue?.timezone || timeZone);
  }

  /** "July 2026" — shared by the page's h1 and the grid's aria-label. */
  export function formatMonthLabel(year: number, month: number): string {
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
</script>

<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { dualTime } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import { performanceStatusTone } from '$lib/performance';

  interface Props {
    year: number;
    /** 1-12, same contract as $lib/calendar. */
    month: number;
    /** Already scope-filtered rows — the grid only buckets and renders. */
    performances: PerformanceEvent[];
    dates: DateEvent[];
    /** Fallback slug for chip hrefs when a perf's workspace isn't resolvable. */
    workspaceSlug: string;
    /** Dims the grid while the page's feeds refetch. */
    loading?: boolean;
    /** When given, each day shows a "+" that reports its ISO date. */
    onDayCreate?: (isoDate: string) => void;
  }

  let {
    year,
    month,
    performances,
    dates,
    workspaceSlug,
    loading = false,
    onDayCreate,
  }: Props = $props();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayIso = dayKeyInTz(new Date().toISOString(), viewerTz);

  // Same cache key the shell/nav keeps warm — resolves each chip's href to
  // its own workspace (a perf can belong to a non-current one).
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceTzById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.timezone])),
  );

  let weeks = $derived(monthGrid(year, month));
  let label = $derived(formatMonthLabel(year, month));

  // Off-grid buckets (the page's padded dates window can fetch an event a
  // day outside the grid) simply find no cell.
  let performancesByDay = $derived.by(() => {
    const map = new Map<string, PerformanceEvent[]>();
    for (const p of performances) {
      const key = perfDayKey(p);
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return map;
  });

  let datesByDay = $derived.by(() => {
    const map = new Map<string, DateEvent[]>();
    for (const d of dates) {
      const key = dateDayKey(d, viewerTz);
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return map;
  });

  function perfHref(p: PerformanceEvent): string | null {
    if (!p.slug || !p.project) return null;
    const ws = workspaceSlugById.get(p.project.workspace_id) ?? workspaceSlug;
    return `/h/${ws}/performance/${p.slug}`;
  }

  function perfLabel(p: PerformanceEvent): string {
    return p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  }

  // Chip times follow the timezone rule: venue wall time on the chip, the
  // viewer's in the tooltip only when the clocks disagree. A venue-less
  // gig falls back to its home space's timezone — the same zone its times
  // were entered in — never silently the browser's. Venue-less DATE rows
  // stay on the viewer's clock on purpose: they bucket on the viewer's
  // day (dateDayKey), and a chip must not show a wall time from a zone
  // other than the one that placed it in its cell.
  function perfTz(p: PerformanceEvent): string | null {
    return p.venue?.timezone ?? workspaceTzById.get(p.project?.workspace_id ?? '') ?? null;
  }
  function perfTime(p: PerformanceEvent): string | null {
    if (!p.start_at) return null;
    return dualTime(p.start_at, perfTz(p), viewerTz).primary;
  }
  function perfTitle(p: PerformanceEvent): string {
    const base = `${perfLabel(p)} — ${p.status}`;
    if (!p.start_at) return base;
    const t = dualTime(p.start_at, perfTz(p), viewerTz);
    return t.secondary ? `${base} · ${t.primary} (${t.secondary} yours)` : `${base} · ${t.primary}`;
  }
  function dateTime(d: DateEvent): string | null {
    if (d.all_day) return null;
    return dualTime(d.starts_at, d.venue?.timezone, viewerTz).primary;
  }
  function dateTitle(d: DateEvent): string {
    const base = d.title ?? d.kind.replace(/_/g, ' ');
    if (d.all_day) return base;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    return t.secondary ? `${base} · ${t.primary} (${t.secondary} yours)` : `${base} · ${t.primary}`;
  }
</script>

<div class="cal__grid" class:cal__grid--loading={loading} aria-label={label}>
  {#each WEEKDAYS as wd (wd)}
    <div class="cal__weekday">{wd}</div>
  {/each}
  {#each weeks as week, wi (wi)}
    {#each week as day (day.iso)}
      {@const perfs = performancesByDay.get(day.iso) ?? []}
      {@const dayDates = datesByDay.get(day.iso) ?? []}
      <div
        class="cal__day"
        class:cal__day--out={!day.inMonth}
        class:cal__day--today={day.iso === todayIso}
      >
        <span class="cal__day-head">
          <span class="cal__day-num">{Number(day.iso.slice(8, 10))}</span>
          {#if onDayCreate}
            <button
              type="button"
              class="cal__day-add"
              aria-label={`New performance on ${day.iso}`}
              onclick={() => onDayCreate?.(day.iso)}
            >+</button>
          {/if}
        </span>
        {#each perfs as p (p.id)}
          {@const href = perfHref(p)}
          {@const time = perfTime(p)}
          {#if href}
            <a
              class="cal__event cal__event--perf"
              data-tone={performanceStatusTone(p.status)}
              style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
              {href}
              title={perfTitle(p)}
            >
              <span class="cal__event-dot" aria-hidden="true"></span>
              {#if time}<span class="cal__event-time">{time}</span>{/if}
              {perfLabel(p)}
            </a>
          {:else}
            <span
              class="cal__event cal__event--perf"
              data-tone={performanceStatusTone(p.status)}
              title={perfTitle(p)}
            >
              <span class="cal__event-dot" aria-hidden="true"></span>
              {#if time}<span class="cal__event-time">{time}</span>{/if}
              {perfLabel(p)}
            </span>
          {/if}
        {/each}
        {#each dayDates as d (d.id)}
          {@const time = dateTime(d)}
          <span
            class="cal__event cal__event--date"
            style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
            title={dateTitle(d)}
          >
            {#if time}<span class="cal__event-time">{time}</span>{/if}
            {d.title ?? d.kind.replace(/_/g, ' ')}
          </span>
        {/each}
      </div>
    {/each}
  {/each}
</div>

<style>
  @layer components {
    .cal__grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-l);
      overflow: hidden;
      background: var(--border-color-light);
      gap: 1px;
      transition: opacity var(--transition);
    }

    .cal__grid--loading {
      opacity: 0.6;
    }

    .cal__weekday {
      background: var(--bg-light);
      padding: var(--space-xs) var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      text-transform: lowercase;
    }

    .cal__day {
      background: var(--bg);
      min-block-size: 6.5rem;
      padding: var(--space-xs);
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }

    .cal__day--out {
      background: var(--bg-light);
    }
    .cal__day--out .cal__day-num {
      color: var(--text-faint);
    }

    .cal__day--today .cal__day-num {
      color: var(--bg);
      background: var(--text-color);
      border-radius: var(--radius-circle);
      inline-size: 1.5rem;
      block-size: 1.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .cal__day-num {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .cal__day-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Quiet add affordance — visible on cell hover (and on focus). */
    .cal__day-add {
      opacity: 0;
      font-family: var(--font-mono);
      font-size: var(--text-s);
      line-height: 1;
      color: var(--text-faint);
      padding: 0 var(--space-2xs);
      transition: opacity var(--transition), color var(--transition);
    }
    .cal__day:hover .cal__day-add,
    .cal__day-add:focus-visible {
      opacity: 1;
    }
    .cal__day-add:hover {
      color: var(--text-color);
    }

    /* Event chip. Project accent on the left rail (--c), status tone on
       the dot (--state-color via the base.css data-tone contract). */
    .cal__event {
      display: flex;
      align-items: center;
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      line-height: 1.3;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-s);
      border-inline-start: 2px solid var(--c, var(--border-color-dark));
      background: var(--bg-ultra-light);
      color: var(--text-color);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    a.cal__event:hover {
      background: var(--bg-hover, var(--bg-light));
    }

    .cal__event--date {
      color: var(--text-muted);
      font-style: italic;
    }

    .cal__event-dot {
      inline-size: 6px;
      block-size: 6px;
      border-radius: var(--radius-circle);
      flex-shrink: 0;
      background: var(--state-color, var(--text-faint));
    }

    /* Venue wall time on the chip (timezone rule) — quiet mono prefix. */
    .cal__event-time {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-style: normal;
      color: var(--text-faint);
      flex: none;
    }
  }
</style>
