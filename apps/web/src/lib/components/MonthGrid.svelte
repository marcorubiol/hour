<script module lang="ts">
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
   */
  import { addDaysIso, dayKeyInTz, monthGrid, assignBandLanes } from '$lib/planner';
  import { weekdayLabels } from '$lib/datetime';

  export type ProjectLite = {
    id: string;
    slug: string;
    name: string;
    accent?: string | null;
    /** Stored identity monogram (ADR-081); absent until the migration is
        applied — IdentityMark falls back to initials derived from name. */
    initials?: string | null;
    workspace_id: string;
  };

  export type PerformanceEvent = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    load_in_at?: string | null;
    start_at: string | null;
    venue_name: string | null;
    city: string | null;
    country: string | null;
    line_id: string | null;
    project: ProjectLite | null;
    venue: {
      name: string;
      city: string | null;
      country?: string | null;
      timezone: string | null;
    } | null;
    /** ADR-084 §3 — the operator's readiness ticks, read by the card foot. */
    readiness?: Record<string, boolean> | null;
    /** Present only on ?rosters=1 fetches (conflict engine feed). */
    person_ids?: string[];
  };

  export type DateEvent = {
    id: string;
    kind: string;
    status: string;
    title: string | null;
    starts_at: string;
    ends_at?: string | null;
    all_day: boolean;
    /** ADR-084 §1 — rows sharing this render as one multi-day band. */
    series_id?: string | null;
    venue_name: string | null;
    city: string | null;
    country?: string | null;
    project: ProjectLite | null;
    venue: { timezone: string | null } | null;
    /** ADR-078 columns — absent until the migrations are applied
        (graceful absence: chips render directionless, no away bands). */
    line_id?: string | null;
    travel_direction?: string | null;
    label?: string | null;
  };

  /** A stored blackout, page-shaped for rendering (label already built). */
  export type BlackoutBandVM = {
    id: string;
    /** starts_on / ends_on — inclusive ISO days. */
    from: string;
    to: string;
    company: boolean;
    tentative: boolean;
    label: string;
    note?: string | null;
  };

  /** A derived away band (ADR-078 §6) — display-only inference. */
  export type AwayBandVM = {
    from: string;
    to: string;
    label: string;
  };

  /** One conflict, page-shaped for the day mark + clash card. */
  export type ClashVM = {
    severity: 'people' | 'possible' | 'blackout' | 'blackout-tentative';
    glyph: '!' | '?';
    title: string;
    body: string;
    rows: Array<{ label: string; status: string; accent: string | null }>;
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
  export function formatMonthLabel(year: number, month: number, locale = 'en-GB'): string {
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  /** Month name alone ("May", "maig") — the masthead's serif em. */
  export function monthName(year: number, month: number, locale = 'en-GB'): string {
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
      month: 'long',
      timeZone: 'UTC',
    });
  }

  /**
   * Monday-first short weekday labels — moved to $lib/datetime once the block
   * form needed them too (re-exported so this module's surface is unchanged).
   */
  export { weekdayLabels };
</script>

<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { dualTime } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import IdentityQuickPanel from '$lib/components/IdentityQuickPanel.svelte';
  import { isReady, performanceStatusFamily } from '$lib/performance';
  import { dateStatusFamily } from '$lib/date';

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
    const m = new Map<string, { id: string; initials?: string | null }>();
    for (const p of performances)
      if (p.project) m.set(p.project.id, { id: p.project.id, initials: p.project.initials });
    for (const d of dates)
      if (d.project) m.set(d.project.id, { id: d.project.id, initials: d.project.initials });
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

  function perfHref(p: PerformanceEvent): string | null {
    if (!p.slug || !p.project) return null;
    const ws = workspaceSlugById.get(p.project.workspace_id) ?? workspaceSlug;
    return `/h/${ws}/performance/${p.slug}`;
  }

  function perfLabel(p: PerformanceEvent): string {
    return p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  }

  // Chip times follow the timezone rule: venue wall time on the chip, the
  // viewer's as a faint courtesy only when the clocks disagree. A
  // venue-less gig falls back to its home space's timezone — the same zone
  // its times were entered in — never silently the browser's. Venue-less
  // DATE rows stay on the viewer's clock on purpose: they bucket on the
  // viewer's day (dateDayKey), and a chip must not show a wall time from a
  // zone other than the one that placed it in its cell.
  function perfTz(p: PerformanceEvent): string | null {
    return p.venue?.timezone ?? workspaceTzById.get(p.project?.workspace_id ?? '') ?? null;
  }
  /** ADR-078: the working time — load-in when known, else show start. */
  function perfInstant(p: PerformanceEvent): string | null {
    return p.load_in_at ?? p.start_at;
  }
  function perfTime(p: PerformanceEvent): { primary: string; secondary: string | null } | null {
    const at = perfInstant(p);
    if (!at) return null;
    const t = dualTime(at, perfTz(p), viewerTz);
    return { primary: t.primary, secondary: t.secondary };
  }
  function perfTitle(p: PerformanceEvent): string {
    const base = `${perfLabel(p)} — ${p.status.replace(/_/g, ' ')}`;
    const at = perfInstant(p);
    if (!at) return base;
    const t = dualTime(at, perfTz(p), viewerTz);
    return t.secondary ? `${base} · ${t.primary} (${t.secondary} yours)` : `${base} · ${t.primary}`;
  }
  function dateTime(
    d: DateEvent,
  ): { primary: string; secondary: string | null; end: string | null } | null {
    if (d.all_day) return null;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    // A day says its hours as a RANGE when it has an end. On a block's
    // continuation cell the range is the ONLY thing there is room for, and
    // "10:00" alone would hide that Wednesday runs four hours longer than
    // Tuesday — which is the whole reason the days are separate rows.
    const end =
      d.ends_at && d.ends_at !== d.starts_at
        ? dualTime(d.ends_at, d.venue?.timezone, viewerTz).primary
        : null;
    return { primary: t.primary, secondary: t.secondary, end };
  }
  function dateText(d: DateEvent): string {
    // "Altres" rows carry their free label; day_off shows its city if any.
    if (d.kind === 'other') return d.label ?? d.title ?? dateKindLabel(d.kind);
    if (d.kind === 'day_off') return d.city ?? d.title ?? '';
    return d.title ?? d.city ?? '';
  }
  function dateTitle(d: DateEvent): string {
    const base = d.title ?? dateKindLabel(d.kind);
    if (d.all_day) return base;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    return t.secondary ? `${base} · ${t.primary} (${t.secondary} yours)` : `${base} · ${t.primary}`;
  }
  function travelText(d: DateEvent): string {
    const place = d.city ?? d.title ?? d.venue_name ?? dateKindLabel(d.kind);
    if (d.travel_direction === 'outbound') return `→ ${place}`;
    if (d.travel_direction === 'return') return `${place} →`;
    if (d.travel_direction === 'leg') return `→ ${place} →`;
    return place;
  }

  // The chip's second row (venue on top, city underneath). Suppressed when
  // the label ALREADY fell back to the city — a chip never prints the same
  // place twice.
  function perfCity(p: PerformanceEvent): string | null {
    const city = p.venue?.city ?? p.city ?? null;
    return city && city !== perfLabel(p) ? city : null;
  }
  function dateCity(d: DateEvent): string | null {
    const city = d.city ?? null;
    return city && city !== dateText(d) ? city : null;
  }

  // The ISO code beside the city (Marco, 2026-07-20): two letters are enough
  // to tell a Barcelona from a Bayonne at a glance, and unlike a full country
  // name they cannot wrap the line. The venue's own country wins over the
  // denormalised trio — the linked entity is the better truth.
  function perfCountry(p: PerformanceEvent): string | null {
    const cc = p.venue?.country ?? p.country ?? null;
    return cc ? cc.toUpperCase() : null;
  }
  function dateCountry(d: DateEvent): string | null {
    return d.country ? d.country.toUpperCase() : null;
  }

  /**
   * ADR-002 — the status the FOOT should speak, given the workspace's hold
   * convention. A ranked hold only means something where the convention is a
   * priority queue: in a `simple` workspace (theatre/dance) hold_1 and
   * hold_2 are the same thing — two holds coexisting on a slot — so printing
   * "1st hold" would invent a hierarchy the company does not run.
   *
   * The stored status is NOT rewritten; only the word changes. A workspace
   * that later switches to `prioritized` gets its ranks back untouched.
   */
  function footStatus(p: PerformanceEvent): string {
    const mode = workspaceModeById.get(p.project?.workspace_id ?? '') ?? 'simple';
    if (mode === 'prioritized') return p.status;
    return p.status.startsWith('hold') ? 'hold' : p.status;
  }

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

<!-- One chip body, two shells: a gig with a slug is a link, one without is
     inert. The body lives in a snippet so the card grammar is written once. -->
{#snippet perfBody(p: PerformanceEvent)}
  {@const time = perfTime(p)}
  {@const city = perfCity(p)}
  {@const cc = perfCountry(p)}
  {@const foot = stateLabel(footStatus(p))}
  <span class="cal__event-top">
    <span class="cal__event-name">{perfLabel(p)}</span>
    {#if p.project}<button
        type="button"
        class="cal__markbtn"
        onclick={(e) => openMark(e, p.project)}
      ><IdentityMark
          accent={accentVarFor(p.project)}
          name={p.project.name}
          initials={p.project.initials}
        /></button>{/if}
  </span>
  {#if city || time}
    <span class="cal__event-line">
      <span class="cal__event-city"
        >{city ?? ''}{#if city && cc}<i class="cal__event-cc">{cc}</i>{/if}</span
      >
      {#if time}<span class="cal__event-time"
          >{time.primary}{#if time.secondary}<i> {time.secondary}</i>{/if}</span
        >{/if}
    </span>
  {/if}
  {#if performanceStatusFamily(p.status) === 'confirmed' && readinessItems.length > 0}
    <!-- A settled gig's foot answers "is it sorted?" — restating "confirmed"
         would only repeat what the fill and the radius already say. -->
    <span class="cal__event-foot cal__event-foot--ready">
      {#each readinessItems as item (item.key)}
        <span class="cal__ready" class:cal__ready--on={isReady(p.readiness, item.key)}
          >{item.label}</span
        >
      {/each}
    </span>
  {:else if foot}
    <span class="cal__event-foot">{foot}</span>
  {/if}
{/snippet}

{#if legendProjects.length > 0}
  <div class="cal__legend">
    {#each legendProjects as pr (pr.id)}
      {@const shown = !hiddenProjects.includes(pr.id)}
      <button
        type="button"
        class="cal__legend-item"
        class:cal__legend-item--muted={!shown}
        aria-pressed={shown}
        onclick={() => toggleProject(pr.id)}
        ><IdentityMark
          accent={accentVarFor(pr)}
          name={pr.name}
          initials={pr.initials}
        />{pr.name}</button
      >
    {/each}
    <span class="cal__legend-sep" aria-hidden="true"></span>
    <span class="cal__legend-key"
      ><span class="cal__legend-swatch" data-family="confirmed" aria-hidden="true"
      ></span>{legendConfirmedLabel}</span
    >
    <span class="cal__legend-key"
      ><span class="cal__legend-swatch" data-family="hold" aria-hidden="true"
      ></span>{legendHoldLabel}</span
    >
  </div>
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
      {@const dayDates = (datesByDay.get(day.iso) ?? []).filter(projectShown)}
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
            <div
              class="cal__clashcard"
              class:cal__clashcard--up={wi >= weeks.length - 2}
              class:cal__clashcard--flip={di >= 5}
              role="dialog"
              aria-label={c.title}
            >
              <p class="cal__clashcard-head">
                <span class="cal__mark cal__mark--static" data-severity={c.severity}
                  >{c.glyph}</span
                >
                {c.title}
              </p>
              <p class="cal__clashcard-body">{c.body}</p>
              {#each c.rows as row, ri (ri)}
                <p class="cal__clashcard-row">
                  <span
                    class="cal__clashcard-dot"
                    style={row.accent ? `--c: ${row.accent}` : undefined}
                    aria-hidden="true"
                  ></span>
                  <span class="cal__clashcard-label">{row.label}</span>
                  <span class="cal__clashcard-status">{row.status}</span>
                </p>
              {/each}
            </div>
          {/if}
        {/each}
        {#each perfs as p (p.id)}
          {@const href = perfHref(p)}
          {@const family = performanceStatusFamily(p.status)}
          {#if href}
            <a
              class="cal__event cal__event--perf"
              data-family={family}
              style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
              {href}
              title={perfTitle(p)}
            >{@render perfBody(p)}</a>
          {:else}
            <span
              class="cal__event cal__event--perf"
              data-family={family}
              style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
              title={perfTitle(p)}
            >{@render perfBody(p)}</span>
          {/if}
        {/each}
        {#each dayDates as d (d.id)}
          {#if d.kind === 'travel_day'}
            <span
              class="cal__event cal__event--travel"
              style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
              title={dateTitle(d)}
            >{#if d.project}<button type="button" class="cal__markbtn" onclick={(e) => openMark(e, d.project)}><IdentityMark accent={accentVarFor(d.project)} name={d.project.name} initials={d.project.initials} /></button>{/if}{travelText(d)}</span>
          {:else}
            {@const time = dateTime(d)}
            {@const city = dateCity(d)}
            {@const cc = dateCountry(d)}
            {@const edges = seriesEdges(d, day.iso)}
            {@const head = !edges || edges.first || di === 0}
            <span
              class="cal__event cal__event--date"
              class:cal__event--off={d.kind === 'day_off'}
              class:cal__event--run={!!edges}
              class:cal__event--run-first={edges?.first}
              class:cal__event--run-last={edges?.last}
              data-family={dateStatusFamily(d.status)}
              style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
              title={dateTitle(d)}
            >
              {#if head}
                <span class="cal__event-top">
                  <span class="cal__event-name">{dateText(d)}</span>
                  {#if d.project}<button
                      type="button"
                      class="cal__markbtn"
                      onclick={(e) => openMark(e, d.project)}
                    ><IdentityMark
                        accent={accentVarFor(d.project)}
                        name={d.project.name}
                        initials={d.project.initials}
                      /></button>{/if}
                </span>
                {#if city || time}
                  <span class="cal__event-line">
                    <span class="cal__event-city"
                      >{city ?? ''}{#if city && cc}<i class="cal__event-cc">{cc}</i>{/if}</span
                    >
                    {#if time}<span class="cal__event-time"
                        >{time.primary}{#if time.end}–{time.end}{/if}</span
                      >{/if}
                  </span>
                {/if}
                <span class="cal__event-kind">{dateKindLabel(d.kind)}</span>
              {:else if time}
                <!-- A continuation day carries only its OWN hours. The block
                     said its name at the head; repeating it would print the
                     same words across five cells. -->
                <span class="cal__event-line cal__event-line--cont">
                  <span class="cal__event-time"
                    >{time.primary}{#if time.end}–{time.end}{/if}</span
                  >
                </span>
              {/if}
            </span>
          {/if}
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
       blackout = red OUTLINE circle · blackout-tentative = accent dashed. */
    .cal__marks {
      display: inline-flex;
      gap: 3px;
      margin-inline-start: auto;
    }
    .cal__mark {
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
    .cal__mark[data-severity='people'] {
      --mark-bg: var(--danger);
      --mark-fg: var(--bg);
    }
    .cal__mark[data-severity='possible'] {
      --mark-border-color: var(--border-color-dark);
      --mark-border-style: dashed;
      --mark-fg: var(--text-faint);
    }
    .cal__mark[data-severity='blackout'] {
      --mark-border-color: var(--danger);
      --mark-fg: var(--danger);
    }
    .cal__mark[data-severity='blackout-tentative'] {
      --mark-border-color: var(--cal-accent, var(--warning));
      --mark-border-style: dashed;
      --mark-fg: var(--cal-accent, var(--warning));
    }
    .cal__mark--static {
      cursor: default;
    }

    /* Clash card — the popover naming shared people + the two bookings. */
    .cal__clashcard {
      position: absolute;
      z-index: var(--z-dropdown);
      top: 2rem;
      inset-inline-start: var(--space-xs);
      inline-size: 15.5rem;
      max-inline-size: 60vw;
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-l);
      box-shadow: var(--box-shadow-3);
      padding: var(--space-s) var(--space-m);
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      white-space: normal;
    }
    .cal__clashcard--up {
      top: auto;
      bottom: 2rem;
    }
    /* Weekend columns anchor to the cell's right edge — a leftward card
       would run past the grid boundary and get clipped. */
    .cal__clashcard--flip {
      inset-inline-start: auto;
      inset-inline-end: var(--space-xs);
    }
    .cal__clashcard-head {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-s);
      font-weight: 600;
      color: var(--text-color);
    }
    .cal__clashcard-body {
      font-size: var(--text-s);
      color: var(--text-muted);
      line-height: 1.45;
    }
    .cal__clashcard-row {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .cal__clashcard-dot {
      inline-size: 7px;
      block-size: 7px;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
      flex: none;
    }
    .cal__clashcard-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cal__clashcard-status {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      flex: none;
    }

    /* Monogram as its own click zone inside the event link (ADR-081): opens
       the identity editor instead of following the chip's href. */
    .cal__markbtn {
      all: unset;
      display: inline-flex;
      cursor: pointer;
      border-radius: calc(var(--mark, 14px) * 0.28);
    }
    .cal__markbtn:focus-visible {
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
       possibility), never the properties. */
    .cal__event {
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
    .cal__event[data-family='confirmed'] {
      --chip-radius: var(--radius-s);
    }

    /* Card rows: name + monogram on top, place + time under, state at the
       foot. Monogram and time never shrink; the name and city take the
       squeeze so a long venue can't push the meta out of the cell. */
    .cal__event-top,
    .cal__event-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .cal__event-line {
      color: var(--text-muted);
    }
    .cal__event-city {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }
    /* The ISO code rides INSIDE the city span so the two ellipsis together
       as one place — a truncated "Barcelo…" must not leave a stranded "FR"
       claiming to be somewhere it isn't. */
    .cal__event-cc {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      margin-inline-start: 0.35em;
    }
    /* The chip's foot — hold rank on a gig, kind word on a date. */
    .cal__event-foot,
    .cal__event-kind {
      margin-block-start: 1px;
      padding-block-start: 1px;
      border-block-start: 1px solid
        color-mix(in oklch, var(--c, var(--border-color-dark)) 16%, var(--border-color-light));
    }
    .cal__event-foot {
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }
    /* Readiness ticks: the WORD always prints, only the ✓ varies. "Not
       sorted" then reads as a visible absence rather than as nothing at
       all — and the settled gig's foot never collapses to empty. */
    .cal__event-foot--ready {
      display: flex;
      gap: var(--space-xs);
      letter-spacing: var(--mono-letter-spacing);
      min-inline-size: 0;
    }
    .cal__ready {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cal__ready--on {
      color: var(--text-muted);
    }
    .cal__ready--on::before {
      content: '✓';
      margin-inline-end: 0.2em;
      color: var(--success, currentColor);
    }

    a.cal__event:hover {
      filter: brightness(0.97);
    }

    /* The settled gig is the day's anchor: it leads the cell AND lifts off
       it. Lift is earned like the radius — a hold stays flat on the page. */
    .cal__event--perf[data-family='confirmed'] {
      --chip-bg: color-mix(in oklch, var(--c, var(--border-color-dark)) 13%, var(--bg-ultra-light));
      --chip-shadow:
        0 1px 2px color-mix(in oklch, var(--text-color) 10%, transparent),
        0 2px 5px color-mix(in oklch, var(--text-color) 6%, transparent);
    }
    /* Lift needs room to land: the cell's 2px gap is thinner than the
       shadow, so whatever follows a lifted gig would sit inside it. Only
       the chip actually behind one pays the extra space — a lone gig, or
       the last in the cell, keeps the tight rhythm (Marco, 2026-07-19). */
    .cal__event--perf[data-family='confirmed'] + .cal__event {
      margin-block-start: var(--space-xs);
    }
    .cal__event--perf[data-family='confirmed'] .cal__event-name {
      font-weight: 600;
    }
    /* Hold = possibility held: dashed edge + the 135° hatch that means
       "not settled" everywhere in this view (tentative blackouts use it
       too), so the state reads before the words do. */
    .cal__event--perf[data-family='hold'] {
      --chip-bg: var(--bg-ultra-light);
      --chip-bg-image: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--c, var(--border-color-dark)) 11%, var(--bg-ultra-light)) 0 5px,
        var(--bg-ultra-light) 5px 10px
      );
      --chip-border-style: dashed;
      --chip-fg: var(--text-muted);
    }
    .cal__event--perf[data-family='proposed'] {
      --chip-bg: var(--bg);
      --chip-border-style: dashed;
      --chip-fg: var(--text-muted);
    }

    /* Legend — the month's colour key, readable without opening anything.
       The swatches restate the two shapes the chips use (solid = settled,
       hatched+dashed = held), in neutral ink so they read as a key and not
       as one more project. */
    .cal__legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
      margin-block-end: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .cal__legend-item,
    .cal__legend-key {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
    }
    /* The project entries ARE the view's filter — click one to mute it. */
    .cal__legend-item {
      appearance: none;
      border: 0;
      padding: 0;
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
      border-radius: var(--radius-s);
      transition: opacity var(--transition);
    }
    .cal__legend-item:hover {
      color: var(--text-color);
    }
    .cal__legend-item--muted {
      opacity: 0.4;
      text-decoration: line-through;
    }
    .cal__legend-item:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }
    .cal__legend-sep {
      inline-size: 1px;
      block-size: 1em;
      background: var(--border-color-dark);
    }
    /* The key restates the chips' own grammar — square until settled — so it
       stays true rather than decorative. */
    .cal__legend-swatch {
      inline-size: 0.85em;
      block-size: 0.85em;
      border-radius: var(--radius-none);
      border: 1px solid var(--border-color-dark);
    }
    .cal__legend-swatch[data-family='confirmed'] {
      border-radius: var(--radius-s);
      border-color: transparent;
      background: color-mix(in oklch, var(--text-color) 22%, var(--bg-ultra-light));
    }
    .cal__legend-swatch[data-family='hold'] {
      border-style: dashed;
      background-image: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--text-color) 16%, var(--bg-ultra-light)) 0 4px,
        var(--bg-ultra-light) 4px 8px
      );
    }

    .cal__event-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }

    /* Date chip — quieter ink, mono small-caps kind label at the foot.
       Tentative dates read as possibility (dashed + square) — the grammar
       extends (ADR-078 §9); confirmed stays the quiet solid form. */
    .cal__event--date {
      --chip-fg: var(--text-muted);
    }
    .cal__event--date[data-family='hold'] {
      --chip-bg: var(--bg);
      --chip-border-style: dashed;
    }
    .cal__event--date[data-family='proposed'] {
      --chip-fg: var(--text-faint);
      --chip-border-style: dashed;
    }

    /* A multi-day block reads as one strip across the cells. The join is
       VISUAL only — every day is still its own row carrying its own state,
       so a confirmed day inside a tentative run shows as itself and the
       strip tells the truth about a half-confirmed week. The chip bleeds
       into the cell padding so the run crosses the grid's hairline. */
    .cal__event--run {
      margin-inline: calc(-1 * var(--space-xs));
      padding-inline: var(--space-xs);
      border-inline: 0;
      border-radius: 0;
    }
    .cal__event--run-first {
      margin-inline-start: 0;
      border-inline-start: 1px var(--chip-border-style) var(--chip-border-color);
      border-start-start-radius: var(--chip-radius);
      border-end-start-radius: var(--chip-radius);
    }
    .cal__event--run-last {
      margin-inline-end: 0;
      border-inline-end: 1px var(--chip-border-style) var(--chip-border-color);
      border-start-end-radius: var(--chip-radius);
      border-end-end-radius: var(--chip-radius);
    }
    /* Continuation day: its hours sit at the run's right edge, so the times
       line up down the week instead of drifting with each label. */
    .cal__event-line--cont {
      justify-content: flex-end;
    }
    .cal__event--off {
      --chip-fg: var(--text-faint);
      border-inline-start-style: dotted;
    }

    .cal__event-kind {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      flex: none;
    }

    /* Travel chip — bare mono, direction arrows carry the meaning. */
    .cal__event--travel {
      --chip-bg: transparent;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: color-mix(in oklch, var(--c, var(--text-muted)) 55%, var(--text-muted));
      border: none;
      white-space: nowrap;
      /* Bare text node — the base chip's flex display defeats text-overflow,
         and without overflow:hidden the label hard-clips at the cell edge
         mid-glyph. Block + hidden lets the ellipsis work. */
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Venue wall time on the chip (timezone rule) — quiet mono prefix;
       the viewer's clock rides as a fainter courtesy when it differs. */
    .cal__event-time {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-style: normal;
      color: var(--text-faint);
      flex: none;
    }
    .cal__event-time i {
      font-style: normal;
      color: color-mix(in oklch, var(--text-faint) 62%, transparent);
      /* Svelte trims the leading space inside <i> — restore the gap here. */
      margin-inline-start: var(--space-2xs);
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
      --band-bg: color-mix(in oklch, var(--text-color) 9%, transparent);
      --band-fg: var(--text-muted);
      --band-border-color: var(--border-color-dark);
    }
    .cal__band--person {
      --band-bg: color-mix(in oklch, var(--cal-accent, var(--warning)) 15%, transparent);
      --band-fg: color-mix(in oklch, var(--cal-accent, var(--warning)) 50%, var(--text-muted));
      --band-border-color: color-mix(in oklch, var(--cal-accent, var(--warning)) 30%, var(--border-color-light));
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
