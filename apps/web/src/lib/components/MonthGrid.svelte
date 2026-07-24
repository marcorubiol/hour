<script lang="ts">
  /**
   * Month grid presentation for the Calendar lens — weeks × days with
   * performance/date chips, day numbers, and the quiet per-day "+"
   * affordance. Calendar v2 (ADR-072/076/078) adds the chip grammar
   * (solid = commitment, outline = hold, dashed = possibility), travel
   * direction chips, blackout/away bands and conflict day-marks with the
   * clash-card popover. Pure presentation over already-scoped rows: the
   * page owns the feeds, the pins filtering, the conflict engine and the
   * i18n — this component owns bucketing + layout. Grid math stays in
   * $lib/planner.
   *
   * Class names keep the original `cal__` block from the calendar page —
   * the e2e specs select `.cal__grid` / `.cal__weekday` (Svelte scoping
   * keeps them collision-free anyway).
   *
   * Split (2026-07-24): the event types + pure day/label helpers live in
   * $lib/month-events; the chips (PerfChip/DateChip), the legend
   * (CalLegend) and the clash popover (ClashCard) are components under
   * planner/. The chips are styleless on purpose — the hand-tuned
   * `.cal__event*` grammar stays HERE, one :global rule-set for every
   * card, so the shared design layer cannot fork per chip kind.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { addDaysIso, dayKeyInTz, monthGrid, assignBandLanes } from '$lib/planner';
  import { weekdayLabels } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import type { IdentitySibling } from '$lib/utils/identity';
  import IdentityQuickPanel from '$lib/components/IdentityQuickPanel.svelte';
  import { performanceStatusFamily } from '$lib/performance';
  import {
    perfDayKey,
    dateDayKey,
    formatMonthLabel,
    perfInstant,
    type ProjectLite,
    type PerformanceEvent,
    type DateEvent,
    type BlackoutBandVM,
    type AwayBandVM,
    type ClashVM,
  } from '$lib/month-events';
  import CalLegend from '$lib/components/planner/CalLegend.svelte';
  import ClashCard from '$lib/components/planner/ClashCard.svelte';
  import PerfChip from '$lib/components/planner/PerfChip.svelte';
  import DateChip from '$lib/components/planner/DateChip.svelte';

  interface Props {
    year: number;
    /** 1-12, same contract as $lib/planner. */
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
    /** Stored blackouts to paint as day-cell bands (page-scoped VMs). */
    blackouts?: BlackoutBandVM[];
    /** Derived away bands — quieter than any blackout, display-only. */
    aways?: AwayBandVM[];
    /** Conflicts per ISO day — the day marks + clash-card popovers. */
    clashesByDay?: Map<string, ClashVM[]>;
    /** BCP47/locale tag for weekday + month labels. */
    locale?: string;
    /** i18n hooks — the page passes t()-backed fns; defaults stay English. */
    dateKindLabel?: (kind: string) => string;
    createLabel?: (isoDate: string) => string;
    /**
     * The word on a card's FOOT — "confirmat", "1r hold", "proposat".
     * EVERY card carries one: without it a confirmed gig is a row shorter
     * than a hold, so the most important thing on the grid reads as the
     * smallest (Marco, 2026-07-19). Holds show their rank — the family
     * folds hold_1..3 into one SHAPE (ADR-072 §5), the rank is what is
     * actually being decided between.
     */
    stateLabel?: (status: string) => string | null;
    /**
     * The readiness checklist a CONFIRMED gig shows on its foot, in display
     * order (ADR-084 §3). A settled gig's foot answers "is it sorted?"
     * instead of restating "confirmed" — which the fill already says. Items
     * always print; the tick is what varies, so the foot never collapses.
     */
    readinessItems?: { key: string; label: string }[];
    /** Legend key words (project row + the confirmed/hold swatches). */
    legendConfirmedLabel?: string;
    legendHoldLabel?: string;
  }

  /** English fallbacks for the card foot; the page overrides these with t(). */
  const EN_STATE_WORDS: Record<string, string> = {
    hold_1: '1st hold',
    hold_2: '2nd hold',
    hold_3: '3rd hold',
    hold: 'hold',
    confirmed: 'confirmed',
    proposed: 'proposed',
    invoiced: 'invoiced',
    paid: 'paid',
    done: 'done',
  };

  let {
    year,
    month,
    performances,
    dates,
    workspaceSlug,
    loading = false,
    onDayCreate,
    blackouts = [],
    aways = [],
    clashesByDay,
    locale = 'en-GB',
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    createLabel = (iso: string) => `New performance on ${iso}`,
    stateLabel = (status: string) => EN_STATE_WORDS[status] ?? null,
    readinessItems = [
      { key: 'hotel', label: 'hotel' },
      { key: 'technical', label: 'technical' },
    ],
    legendConfirmedLabel = 'confirmed',
    legendHoldLabel = 'hold',
  }: Props = $props();

  // ── Identity quick-edit (ADR-081): a monogram click opens the editor at a
  // fixed rect so it escapes the month cells' overflow:hidden. The event stays
  // a link; the monogram intercepts its own click (preventDefault/stop).
  let markPop = $state<{ project: ProjectLite; rect: DOMRect } | null>(null);
  let markPopEl: HTMLElement | undefined = $state();
  let markSiblings = $derived.by(() => {
    const m = new Map<string, IdentitySibling>();
    const add = (p: ProjectLite) =>
      m.set(p.id, {
        id: p.id,
        initials: p.initials,
        slug: p.slug,
        name: p.name,
        accent: p.accent,
      });
    for (const p of performances) if (p.project) add(p.project);
    for (const d of dates) if (d.project) add(d.project);
    return [...m.values()];
  });
  function openMark(e: MouseEvent, project: ProjectLite | null) {
    if (!project) return;
    e.preventDefault();
    e.stopPropagation();
    markPop = { project, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() };
  }
  function markPopStyle(rect: DOMRect): string {
    const w = 240;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(rect.left, vw - w - 8));
    return `top: ${rect.bottom + 4}px; left: ${left}px`;
  }
  $effect(() => {
    if (!markPop) return;
    const onDown = (e: MouseEvent) => {
      if (!markPopEl?.contains(e.target as Node)) markPop = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') markPop = null;
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

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
  /**
   * ADR-002 — the hold convention this workspace follows. The month can show
   * several workspaces at once, so the mode is resolved PER CHIP from its
   * own project's workspace, never once for the whole view.
   */
  let workspaceModeById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.booking_mode ?? 'simple'])),
  );

  let weeks = $derived(monthGrid(year, month));
  let label = $derived(formatMonthLabel(year, month, locale));
  let wkLabels = $derived(weekdayLabels(locale));

  // Off-grid buckets (the page's padded dates window can fetch an event a
  // day outside the grid) simply find no cell.
  // Gigs lead the cell (they render before dates), and inside them the
  // SETTLED one leads: a confirmed gig is what the day actually is, a hold
  // or a proposal is a maybe — a maybe must never sit above the real thing
  // (Marco, 2026-07-19). Ties break on the working time so the order is
  // stable rather than feed order.
  const PERF_RANK: Record<string, number> = { confirmed: 0, hold: 1, proposed: 2 };
  let performancesByDay = $derived.by(() => {
    const map = new Map<string, PerformanceEvent[]>();
    for (const p of performances) {
      const key = perfDayKey(p);
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    for (const list of map.values())
      list.sort((a, b) => {
        const ra = PERF_RANK[performanceStatusFamily(a.status)] ?? 9;
        const rb = PERF_RANK[performanceStatusFamily(b.status)] ?? 9;
        if (ra !== rb) return ra - rb;
        return (perfInstant(a) ?? '').localeCompare(perfInstant(b) ?? '');
      });
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

  // ── Multi-day blocks (ADR-084 §1) ────────────────────────────────────
  // A block is N rows sharing a series_id. The BAND is a rendering of those
  // rows: which day is an edge is derived here on every paint, never stored.
  // That is the whole reason for per-day rows — confirm one day of a run and
  // it simply shows as itself inside the band; there is no stored span to
  // fall out of sync with the days it claims to cover.
  let seriesDays = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    for (const d of dates) {
      if (!d.series_id) continue;
      const day = dateDayKey(d, viewerTz);
      (m.get(d.series_id) ?? m.set(d.series_id, new Set<string>()).get(d.series_id)!).add(day);
    }
    return m;
  });

  /**
   * Sessions of ONE block on one day collapse into a single chip with a
   * count; anything else stays its own chip.
   *
   * A rehearsal day holds a morning and an afternoon and both matter, but a
   * card cannot grow — so the card shows the first hour and says how many
   * more there are, and the hover carries all of them. Two different gigs on
   * a day are NOT this case: those are two things, and both names have to be
   * readable (Marco, 2026-07-20).
   */
  function groupDates(list: DateEvent[]): DateEvent[][] {
    const out: DateEvent[][] = [];
    const bySeries = new Map<string, DateEvent[]>();
    for (const d of list) {
      if (!d.series_id) {
        out.push([d]);
        continue;
      }
      const g = bySeries.get(d.series_id);
      if (g) g.push(d);
      else {
        const started = [d];
        bySeries.set(d.series_id, started);
        out.push(started);
      }
    }
    // Clock order, so "the first hour" means the earliest one.
    for (const g of out) if (g.length > 1) g.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    return out;
  }

  /** Null when the row stands alone — a "series" of one is just a date. */
  function seriesEdges(d: DateEvent, iso: string): { first: boolean; last: boolean } | null {
    if (!d.series_id) return null;
    const days = seriesDays.get(d.series_id);
    if (!days || days.size < 2) return null;
    return { first: !days.has(addDaysIso(iso, -1)), last: !days.has(addDaysIso(iso, 1)) };
  }

  /**
   * Projects that actually PAINT a chip in a rendered cell — walked from the
   * grid's own days, not from the feed. The page fetches with a ±1 day pad
   * (timestamptz rows can bucket outside the month), so both the raw props
   * AND the bucketed maps still carry off-grid rows; a project whose only row
   * lands on a pad day would get a legend entry with no card to match it.
   */
  let legendProjects = $derived.by(() => {
    const m = new Map<string, ProjectLite>();
    for (const week of weeks)
      for (const day of week) {
        for (const p of performancesByDay.get(day.iso) ?? [])
          if (p.project) m.set(p.project.id, p.project);
        for (const d of datesByDay.get(day.iso) ?? [])
          if (d.project) m.set(d.project.id, d.project);
      }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  // Clicking a legend entry mutes that project in this view. Ephemeral,
  // view-local state (like the clash popover) — it deliberately does NOT
  // touch the app-wide scope: this is "let me look without them for a
  // second", not "change what I am working on".
  let hiddenProjects = $state<string[]>([]);
  function toggleProject(id: string) {
    hiddenProjects = hiddenProjects.includes(id)
      ? hiddenProjects.filter((x) => x !== id)
      : [...hiddenProjects, id];
  }
  function projectShown(e: { project?: ProjectLite | null }): boolean {
    return !e.project || !hiddenProjects.includes(e.project.id);
  }

  type BandSlot =
    | { kind: 'blackout'; band: BlackoutBandVM; from: string; to: string }
    | { kind: 'away'; band: AwayBandVM; from: string; to: string };

  // Every band gets ONE stable lane for its whole span (Marco 2026-07-19):
  // a multi-day band must sit on the same row across all its days and never
  // reorder when a neighbouring day carries an extra band — otherwise a
  // continuing band appears to "jump lanes" (the day-21 black hole).
  // Blackouts listed before aways so aways settle into the lower lanes.
  let laneBands = $derived.by(() => {
    const combined: BandSlot[] = [
      ...blackouts.map((b) => ({ kind: 'blackout' as const, band: b, from: b.from, to: b.to })),
      ...aways.map((a) => ({ kind: 'away' as const, band: a, from: a.from, to: a.to })),
    ];
    const { lanes } = assignBandLanes(combined);
    return { combined, lanes };
  });

  /** Lanes in use across a whole week row — every cell reserves this many
   *  slots so a lane sits at the same height in every day of the week. */
  function weekLaneCount(week: { iso: string }[]): number {
    const { combined, lanes } = laneBands;
    let max = -1;
    for (const day of week) {
      combined.forEach((c, i) => {
        if (day.iso >= c.from && day.iso <= c.to) max = Math.max(max, lanes[i]);
      });
    }
    return max + 1;
  }

  /** The band occupying each lane on a given day (null = reserved spacer). */
  function laneSlotsOn(iso: string, count: number): (BandSlot | null)[] {
    const slots: (BandSlot | null)[] = new Array(count).fill(null);
    const { combined, lanes } = laneBands;
    combined.forEach((c, i) => {
      if (iso >= c.from && iso <= c.to && lanes[i] < count) slots[lanes[i]] = c;
    });
    return slots;
  }

  // ── Clash-card popover — one open at a time, keyed day:index. ──────────
  let openClash = $state<string | null>(null);
  let gridEl: HTMLElement | undefined = $state();

  function toggleClash(iso: string, i: number) {
    const key = `${iso}:${i}`;
    openClash = openClash === key ? null : key;
  }

  $effect(() => {
    if (!openClash || !gridEl) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.cal__clashcard') && !t.closest('.cal__mark')) openClash = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openClash = null;
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if legendProjects.length > 0}
  <CalLegend
    projects={legendProjects}
    hidden={hiddenProjects}
    onToggle={toggleProject}
    confirmedLabel={legendConfirmedLabel}
    holdLabel={legendHoldLabel}
  />
{/if}

<div
  class="cal__grid"
  class:cal__grid--loading={loading}
  aria-label={label}
  bind:this={gridEl}
>
  {#each wkLabels as wd (wd)}
    <div class="cal__weekday">{wd}</div>
  {/each}
  {#each weeks as week, wi (wi)}
    {@const wlc = weekLaneCount(week)}
    {#each week as day, di (day.iso)}
      {@const perfs = (performancesByDay.get(day.iso) ?? []).filter(projectShown)}
      {@const dateGroups = groupDates((datesByDay.get(day.iso) ?? []).filter(projectShown))}
      {@const clashes = clashesByDay?.get(day.iso) ?? []}
      {@const bandSlots = laneSlotsOn(day.iso, wlc)}
      <div
        class="cal__day"
        class:cal__day--out={!day.inMonth}
        class:cal__day--today={day.iso === todayIso}
      >
        <span class="cal__day-head">
          <span class="cal__day-num">{Number(day.iso.slice(8, 10))}</span>
          {#if clashes.length > 0}
            <span class="cal__marks">
              {#each clashes as c, i (i)}
                <button
                  type="button"
                  class="cal__mark"
                  data-severity={c.severity}
                  aria-label={c.title}
                  aria-expanded={openClash === `${day.iso}:${i}`}
                  onclick={() => toggleClash(day.iso, i)}
                >{c.glyph}</button>
              {/each}
            </span>
          {/if}
          {#if onDayCreate}
            <button
              type="button"
              class="cal__day-add"
              aria-label={createLabel(day.iso)}
              onclick={() => onDayCreate?.(day.iso)}
            >+</button>
          {/if}
        </span>
        {#each clashes as c, i (i)}
          {#if openClash === `${day.iso}:${i}`}
            <!-- Bottom rows open upward: the grid's overflow (rounded
                 corners) would clip a downward card past the last cells. -->
            <ClashCard {c} up={wi >= weeks.length - 2} flip={di >= 5} />
          {/if}
        {/each}
        {#each perfs as p (p.id)}
          <PerfChip
            {p}
            {workspaceSlug}
            {workspaceSlugById}
            {workspaceTzById}
            {workspaceModeById}
            {viewerTz}
            {stateLabel}
            {readinessItems}
            onMarkOpen={openMark}
          />
        {/each}
        {#each dateGroups as g (g[0].id)}
          <DateChip
            {g}
            edges={seriesEdges(g[0], day.iso)}
            {di}
            {viewerTz}
            {dateKindLabel}
            onMarkOpen={openMark}
          />
        {/each}
        {#if wlc > 0}
          <span class="cal__bands">
            {#each bandSlots as entry, lane (lane)}
              {#if entry === null}
                <!-- reserved spacer: keeps the lane above at the same height
                     across days so no band ever jumps rows. -->
                <span class="cal__band cal__band--spacer" aria-hidden="true"></span>
              {:else}
                {@const showLabel = day.iso === entry.from || di === 0}
                {#if entry.kind === 'blackout'}
                  <span
                    class="cal__band"
                    class:cal__band--company={entry.band.company}
                    class:cal__band--person={!entry.band.company}
                    class:cal__band--tentative={entry.band.tentative}
                    title={entry.band.label}
                  >
                    {showLabel ? entry.band.label : ''}
                    {#if day.iso === entry.from && entry.band.note}<i
                        class="cal__band-note">{entry.band.note}</i
                      >{/if}
                  </span>
                {:else}
                  <span class="cal__band cal__band--away" title={entry.band.label}>
                    {showLabel ? entry.band.label : ''}
                  </span>
                {/if}
              {/if}
            {/each}
          </span>
        {/if}
      </div>
    {/each}
  {/each}
</div>

{#if markPop}
  <div class="cal__markpop" bind:this={markPopEl} style={markPopStyle(markPop.rect)}>
    <IdentityQuickPanel
      project={markPop.project}
      siblings={markSiblings}
      onclose={() => (markPop = null)}
    />
  </div>
{/if}

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
      position: relative;
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
      gap: var(--space-2xs);
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

    /* ── Conflict day-marks (ADR-072 grammar, EXACT):
       people = solid red circle "!" · possible = dashed line-2 circle "?"
       blackout = red OUTLINE circle · blackout-tentative = accent dashed.
       Anchored :global under .cal__grid — ClashCard renders the static
       head mark, so one rule-set styles both it and the day-head marks. */
    .cal__marks {
      display: inline-flex;
      gap: 3px;
      margin-inline-start: auto;
    }
    .cal__grid :global(.cal__mark) {
      /* Variable contract — each severity redeclares, never re-styles. */
      --mark-bg: var(--bg);
      --mark-fg: var(--text-muted);
      --mark-border-color: transparent;
      --mark-border-style: solid;
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: var(--radius-circle);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 500;
      line-height: 1;
      background: var(--mark-bg);
      color: var(--mark-fg);
      border: 1px var(--mark-border-style) var(--mark-border-color);
      cursor: pointer;
      flex: none;
    }
    .cal__grid :global(.cal__mark[data-severity='people']) {
      --mark-bg: var(--danger);
      --mark-fg: var(--bg);
    }
    .cal__grid :global(.cal__mark[data-severity='possible']) {
      --mark-border-color: var(--border-color-dark);
      --mark-border-style: dashed;
      --mark-fg: var(--text-faint);
    }
    .cal__grid :global(.cal__mark[data-severity='blackout']) {
      --mark-border-color: var(--danger);
      --mark-fg: var(--danger);
    }
    .cal__grid :global(.cal__mark[data-severity='blackout-tentative']) {
      --mark-border-color: var(--cal-accent, var(--warning));
      --mark-border-style: dashed;
      --mark-fg: var(--cal-accent, var(--warning));
    }
    .cal__grid :global(.cal__mark--static) {
      cursor: default;
    }

    /* Monogram as its own click zone inside the event link (ADR-081): opens
       the identity editor instead of following the chip's href. */
    .cal__grid :global(.cal__markbtn) {
      all: unset;
      display: inline-flex;
      cursor: pointer;
      border-radius: calc(var(--mark, 14px) * 0.28);
    }
    .cal__grid :global(.cal__markbtn:focus-visible) {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 1px;
    }
    .cal__markpop {
      position: fixed;
      z-index: 200;
    }

    /* ── Event chip — the hold grammar (ADR-072 §5): project accent on
       the left rail (--c); the STATUS family redeclares the chip
       variables (solid tint = confirmed, outline = hold, dashed =
       possibility), never the properties.
       The chips render in PerfChip/DateChip (styleless children) — every
       .cal__event* rule stays HERE, anchored :global under .cal__grid, so
       the hand-tuned card grammar remains ONE rule-set for all cards. */
    .cal__grid :global(.cal__event) {
      --chip-bg: var(--bg-ultra-light);
      /* Hold's hatch rides as an IMAGE so the family still only redeclares
         variables, never properties (philosophy §3). */
      --chip-bg-image: none;
      --chip-fg: var(--text-color);
      /* The project accent IS the whole border of the card — no left rail —
         and it is ONE mix for every family (Marco, 2026-07-19). The border
         says WHOSE this is; settledness is said by the fill, the dash and
         the radius. Mixing it differently per family made two cards of the
         same project read as two different colours. */
      --chip-border-color: color-mix(
        in oklch,
        var(--c, var(--border-color-dark)) 45%,
        var(--border-color-light)
      );
      --chip-border-style: solid;
      /* Square until settled — see the radius rule below. */
      --chip-radius: var(--radius-none);
      /* Flat by default; only the settled gig earns lift (see below). */
      --chip-shadow: none;
      --mark: 14px;
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: var(--text-xs);
      line-height: 1.3;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--chip-radius);
      border: 1px var(--chip-border-style) var(--chip-border-color);
      box-shadow: var(--chip-shadow);
      background-color: var(--chip-bg);
      background-image: var(--chip-bg-image);
      color: var(--chip-fg);
      text-decoration: none;
      overflow: hidden;
      min-inline-size: 0;
    }

    /* The radius is EARNED. Only a settled thing gets rounded corners; a
       hold, a proposal, a tentative rehearsal keeps square ones — propose
       five weeks of rehearsals and the three that never get confirmed keep
       reading as unsettled without anyone having to read the word (Marco,
       2026-07-19). One rule for gigs and dates alike: the family is the
       whole story, so the shape stays true wherever the grammar is used. */
    .cal__grid :global(.cal__event[data-family='confirmed']) {
      --chip-radius: var(--radius-s);
    }

    /* Card rows: name + monogram on top, place + time under, state at the
       foot. Monogram and time never shrink; the name and city take the
       squeeze so a long venue can't push the meta out of the cell. */
    .cal__grid :global(.cal__event-top),
    .cal__grid :global(.cal__event-line) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .cal__grid :global(.cal__event-line) {
      color: var(--text-muted);
    }
    .cal__grid :global(.cal__event-city) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }
    /* The ISO code rides INSIDE the city span so the two ellipsis together
       as one place — a truncated "Barcelo…" must not leave a stranded "FR"
       claiming to be somewhere it isn't. */
    .cal__grid :global(.cal__event-cc) {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      margin-inline-start: 0.35em;
    }
    /* The chip's foot — hold rank on a gig, kind word on a date. */
    .cal__grid :global(.cal__event-foot),
    .cal__grid :global(.cal__event-kind) {
      margin-block-start: 1px;
      padding-block-start: 1px;
      border-block-start: 1px solid
        color-mix(in oklch, var(--c, var(--border-color-dark)) 16%, var(--border-color-light));
    }
    .cal__grid :global(.cal__event-foot) {
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }
    /* Readiness ticks: the WORD always prints, only the ✓ varies. "Not
       sorted" then reads as a visible absence rather than as nothing at
       all — and the settled gig's foot never collapses to empty. */
    .cal__grid :global(.cal__event-foot--ready) {
      display: flex;
      gap: var(--space-xs);
      letter-spacing: var(--mono-letter-spacing);
      min-inline-size: 0;
    }
    .cal__grid :global(.cal__ready) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cal__grid :global(.cal__ready--on) {
      color: var(--text-muted);
    }
    .cal__grid :global(.cal__ready--on::before) {
      content: '✓';
      margin-inline-end: 0.2em;
      color: var(--success, currentColor);
    }

    .cal__grid :global(a.cal__event:hover) {
      filter: brightness(0.97);
    }

    /* The settled gig is the day's anchor: it leads the cell AND lifts off
       it. Lift is earned like the radius — a hold stays flat on the page. */
    .cal__grid :global(.cal__event--perf[data-family='confirmed']) {
      --chip-bg: color-mix(in oklch, var(--c, var(--border-color-dark)) 13%, var(--bg-ultra-light));
      --chip-shadow:
        0 1px 2px color-mix(in oklch, var(--text-color) 10%, transparent),
        0 2px 5px color-mix(in oklch, var(--text-color) 6%, transparent);
    }
    /* Lift needs room to land: the cell's 2px gap is thinner than the
       shadow, so whatever follows a lifted gig would sit inside it. Only
       the chip actually behind one pays the extra space — a lone gig, or
       the last in the cell, keeps the tight rhythm (Marco, 2026-07-19). */
    .cal__grid :global(.cal__event--perf[data-family='confirmed'] + .cal__event) {
      margin-block-start: var(--space-xs);
    }
    /* Options — held or proposed, gig or date — are ONE card (Marco
       2026-07-23): the family ALONE drives the "not settled" grammar, so a
       held gig and a tentative rehearsal share the exact same rule, texture
       and dashed edge — no per-type branch to drift apart. Solid fill stays
       reserved for settled things. (Travel carries no family, so it keeps its
       bare form; tentative blackout bands keep their own accent hatch.) */
    .cal__grid :global(.cal__event[data-family='hold']),
    .cal__grid :global(.cal__event[data-family='proposed']) {
      --chip-bg: var(--bg-ultra-light);
      /* The "not settled" texture: a faint neutral dot stipple — pencilled in,
         not inked. Grey, never the project accent; colour lives in the dashed
         border and the monogram, so the month reads calm, not multicolour. */
      --chip-bg-image: radial-gradient(
        color-mix(in oklch, var(--text-color) 11%, transparent) 1px,
        transparent 1.3px
      );
      background-size: 7px 7px;
      --chip-border-style: dashed;
    }
    /* Ink is the one axis that still steps by depth: held a shade quieter, and
       proposed — the least committed — the faintest, and the SAME on a gig or
       a date. A gig's base ink is full strength (the settled tint needs it),
       so held gigs are pulled to muted here; dates already sit muted. */
    .cal__grid :global(.cal__event--perf[data-family='hold']) {
      --chip-fg: var(--text-muted);
    }
    .cal__grid :global(.cal__event[data-family='proposed']) {
      --chip-fg: var(--text-faint);
    }

    .cal__grid :global(.cal__event-name) {
      /* The chip's title — bold on EVERY kind (gig, rehearsal, residency,
         press, day-off) so it reads apart from its city/time line and foot.
         Settled-vs-held is said by fill, dash, hatch and radius, not weight. */
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }

    /* Date chip — quieter ink than a gig, mono small-caps kind label at the
       foot. Tentative dates read as possibility through the shared option
       grammar above (dashed + square + dot texture); a held date keeps this
       base muted ink and a proposed one drops to the faintest via the shared
       proposed rule; confirmed stays the quiet solid form. */
    .cal__grid :global(.cal__event--date) {
      --chip-fg: var(--text-muted);
    }

    /* A multi-day block reads as one strip across the cells. The join is
       VISUAL only — every day is still its own row carrying its own state,
       so a confirmed day inside a tentative run shows as itself and the
       strip tells the truth about a half-confirmed week. The chip bleeds
       into the cell padding so the run crosses the grid's hairline. */
    .cal__grid :global(.cal__event--run) {
      margin-inline: calc(-1 * var(--space-xs));
      padding-inline: var(--space-xs);
      border-inline: 0;
      border-radius: 0;
    }
    .cal__grid :global(.cal__event--run-first) {
      margin-inline-start: 0;
      border-inline-start: 1px var(--chip-border-style) var(--chip-border-color);
      border-start-start-radius: var(--chip-radius);
      border-end-start-radius: var(--chip-radius);
    }
    .cal__grid :global(.cal__event--run-last) {
      margin-inline-end: 0;
      border-inline-end: 1px var(--chip-border-style) var(--chip-border-color);
      border-start-end-radius: var(--chip-radius);
      border-end-end-radius: var(--chip-radius);
    }
    /* Continuation day: its hours sit at the run's right edge, so the times
       line up down the week instead of drifting with each label. */
    .cal__grid :global(.cal__event-line--cont) {
      justify-content: flex-end;
    }
    .cal__grid :global(.cal__event--off) {
      --chip-fg: var(--text-faint);
      border-inline-start-style: dotted;
    }

    .cal__grid :global(.cal__event-kind) {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      flex: none;
    }

    /* Travel chip — shares the SAME container as every other option (Marco
       2026-07-23): it carries a data-family, so the shared grammar above gives
       it the chip fill, the dashed edge when tentative and the earned radius
       when confirmed — no bare exception. Only its CONTENT stays its own: mono
       text where the direction arrows carry the meaning, on one row. */
    .cal__grid :global(.cal__event--travel) {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: color-mix(in oklch, var(--c, var(--text-muted)) 55%, var(--text-muted));
      /* Row so the monogram pins RIGHT like every other chip (Marco,
         2026-07-23). The text span takes the squeeze and ellipsizes — the
         base chip's column flex + a bare text node defeated text-overflow,
         which is why this used to be display:block with the mark inline-left. */
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .cal__grid :global(.cal__travel-text) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }

    /* Venue wall time on the chip (timezone rule) — quiet mono prefix;
       the viewer's clock rides as a fainter courtesy when it differs. */
    .cal__grid :global(.cal__event-time) {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-style: normal;
      color: var(--text-faint);
      flex: none;
    }
    .cal__grid :global(.cal__event-time i) {
      font-style: normal;
      color: color-mix(in oklch, var(--text-faint) 62%, transparent);
      /* Svelte trims the leading space inside <i> — restore the gap here. */
      margin-inline-start: var(--space-2xs);
    }
    /* "+2" — the day holds more sessions than the card can print. It reads as
       part of the time rather than as a badge, because it is the same fact
       continued: the hover carries the hours themselves. */
    .cal__grid :global(.cal__event-time i.cal__event-more) {
      color: color-mix(in oklch, var(--text-faint) 85%, var(--text-color));
      margin-inline-start: 0.3em;
    }

    /* ── Blackout bands (ADR-078 §4/§5): company = full-width quiet ink,
       person = availability-accent tint + name, tentative = hatched +
       dashed. Derived away band (§6) is QUIETER still — transparent,
       dotted top border, faint mono label. Bands sit at the cell floor,
       full-bleed across the cell padding. */
    .cal__bands {
      margin-block-start: auto;
      margin-inline: calc(-1 * var(--space-xs));
      margin-block-end: calc(-1 * var(--space-xs));
      display: flex;
      flex-direction: column;
    }
    .cal__band {
      --band-bg: transparent;
      --band-fg: var(--text-faint);
      --band-border-color: var(--border-color-light);
      --band-border-style: solid;
      /* Constant height across ALL days — labelled, empty, first-day or a
         continuation segment — so a multi-day band reads as one clean strip
         (Marco 2026-07-19). Flex-centre keeps text vertically centred within
         the fixed box; line-height:1 stops text inflating the height. */
      block-size: 1.15rem;
      line-height: 1;
      display: flex;
      align-items: center;
      padding-block: 0;
      padding-inline: var(--space-xs);
      font-family: var(--font-mono);
      font-size: 0.6rem;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--band-bg);
      color: var(--band-fg);
      border-block-start: 1px var(--band-border-style) var(--band-border-color);
    }
    .cal__band > * {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cal__band--company {
      /* Subtle: a faint grey wash with the base-light border and a faint
         label — the band should whisper, not box the day (Marco 2026-07-23). */
      --band-bg: color-mix(in oklch, var(--text-color) 6%, transparent);
      --band-fg: var(--text-faint);
      --band-border-color: var(--border-color-light);
    }
    .cal__band--person {
      /* Subtle accent wash — just enough hue to say WHOSE, no more. The
         tentative hatch (below) stays as-is; Marco kept that one. */
      --band-bg: color-mix(in oklch, var(--cal-accent, var(--warning)) 7%, transparent);
      --band-fg: color-mix(in oklch, var(--cal-accent, var(--warning)) 40%, var(--text-faint));
      --band-border-color: color-mix(in oklch, var(--cal-accent, var(--warning)) 18%, var(--border-color-light));
    }
    .cal__band--tentative {
      --band-bg: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--cal-accent, var(--warning)) 9%, transparent) 0 6px,
        transparent 6px 12px
      );
      --band-fg: var(--text-muted);
      --band-border-color: var(--border-color-dark);
      --band-border-style: dashed;
    }
    .cal__band--away {
      --band-border-style: dotted;
      text-transform: none;
      letter-spacing: var(--mono-letter-spacing);
    }
    /* Reserved-but-empty lane: invisible, holds height only so the bands
       above/below keep their row across every day of the week. */
    .cal__band--spacer {
      background: none;
      border-block-start-color: transparent;
    }
    .cal__band-note {
      text-transform: none;
      letter-spacing: 0;
      font-style: italic;
      font-family: var(--font-display);
      color: var(--text-faint);
      margin-inline-start: var(--space-xs);
    }
  }
</style>
