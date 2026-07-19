<script lang="ts">
  /**
   * Agenda projection of the Calendar lens (ADR-076 second first-class
   * projection; ADR-078 §10) — the same fetched rows as the month grid,
   * regrouped as pure chronology: sticky day headers, one row per event
   * (time-as-glyph · title · place · project dot · status), clash banners
   * leading each conflicted day, and the blackout rail on the right.
   *
   * Included days = days with events ∪ days inside a stored blackout
   * (agendaDayKeys). Derived away bands never create days — they ride the
   * rail as dotted threads (display-only inference, ADR-078 §6).
   *
   * The rail renders per-day segments (absolute, full row height) instead
   * of measuring offsets: a blackout's covered days are all included by
   * the day rule, so contiguous segments read as one capsule. All persons
   * share ONE neutral availability accent — identity is the vertical mono
   * name, never a per-person hue. Narrow frames collapse the rail to 3px
   * threads; the "blackouts" pill expands the named panel as an overlay.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import {
    dateDayKey,
    perfDayKey,
    type AwayBandVM,
    type BlackoutBandVM,
    type ClashVM,
    type DateEvent,
    type PerformanceEvent,
  } from '$lib/components/MonthGrid.svelte';
  import { agendaDayKeys, assignBandLanes, dayKeyInTz } from '$lib/planner';
  import { dualTime } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { performanceStatusFamily, performanceStatusLabel } from '$lib/performance';
  import { dateStatusFamily } from '$lib/date';

  interface Props {
    /** Ordered ISO days of the visible month. */
    monthDays: string[];
    /** Already scope-filtered rows — same feed as the month grid. */
    performances: PerformanceEvent[];
    dates: DateEvent[];
    /** Fallback slug for row hrefs when a perf's workspace isn't resolvable. */
    workspaceSlug: string;
    loading?: boolean;
    blackouts?: BlackoutBandVM[];
    aways?: AwayBandVM[];
    clashesByDay?: Map<string, ClashVM[]>;
    /** BCP47/locale tag for the day-header labels. */
    locale?: string;
    /** i18n hooks — the page passes t()-backed fns/strings. */
    dateKindLabel?: (kind: string) => string;
    viewerTimeLabel?: (time: string) => string;
    statusLabel?: (status: string) => string;
    emptyLabel?: string;
    blackoutsToggleLabel?: string;
  }

  let {
    monthDays,
    performances,
    dates,
    workspaceSlug,
    loading = false,
    blackouts = [],
    aways = [],
    clashesByDay,
    locale = 'en-GB',
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    viewerTimeLabel = (time: string) => `${time}`,
    statusLabel = performanceStatusLabel,
    emptyLabel = 'Nothing this month.',
    blackoutsToggleLabel = 'blackouts',
  }: Props = $props();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayIso = dayKeyInTz(new Date().toISOString(), viewerTz);

  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceTzById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.timezone])),
  );

  // ── Rows per day ───────────────────────────────────────────────────────
  type Row =
    | { kind: 'perf'; sort: string; perf: PerformanceEvent }
    | { kind: 'date'; sort: string; date: DateEvent };

  let rowsByDay = $derived.by(() => {
    const map = new Map<string, Row[]>();
    const push = (key: string, row: Row) => {
      (map.get(key) ?? map.set(key, []).get(key)!).push(row);
    };
    for (const p of performances) {
      push(perfDayKey(p), { kind: 'perf', sort: perfSortKey(p), perf: p });
    }
    for (const d of dates) {
      push(dateDayKey(d, viewerTz), { kind: 'date', sort: dateSortKey(d), date: d });
    }
    for (const rows of map.values()) {
      // Day-level rows (empty sort key) lead; timed rows follow the clock.
      rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
    }
    return map;
  });

  let shownDays = $derived(
    agendaDayKeys(
      monthDays,
      rowsByDay.keys(),
      blackouts.map((b) => ({ starts_on: b.from, ends_on: b.to })),
    ),
  );

  // ── Time rendering (timezone rule — same as MonthGrid) ────────────────
  function perfTz(p: PerformanceEvent): string | null {
    return p.venue?.timezone ?? workspaceTzById.get(p.project?.workspace_id ?? '') ?? null;
  }
  function perfInstant(p: PerformanceEvent): string | null {
    return p.load_in_at ?? p.start_at;
  }
  function perfDual(p: PerformanceEvent): { primary: string; secondary: string | null } | null {
    const at = perfInstant(p);
    if (!at) return null;
    const t = dualTime(at, perfTz(p), viewerTz);
    return { primary: t.primary, secondary: t.secondary };
  }
  function perfSortKey(p: PerformanceEvent): string {
    return perfDual(p)?.primary ?? '';
  }
  function dateDual(d: DateEvent): { primary: string; secondary: string | null } | null {
    if (d.all_day) return null;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    return { primary: t.primary, secondary: t.secondary };
  }
  function dateSortKey(d: DateEvent): string {
    return dateDual(d)?.primary ?? '';
  }

  function perfHref(p: PerformanceEvent): string | null {
    if (!p.slug || !p.project) return null;
    const ws = workspaceSlugById.get(p.project.workspace_id) ?? workspaceSlug;
    return `/h/${ws}/performance/${p.slug}`;
  }
  function perfName(p: PerformanceEvent): string {
    return p.venue?.name ?? p.venue_name ?? p.city ?? p.project?.name ?? 'Performance';
  }
  function perfCity(p: PerformanceEvent): string | null {
    return p.venue?.city ?? p.city;
  }
  function dateText(d: DateEvent): string {
    if (d.kind === 'other') return d.label ?? d.title ?? dateKindLabel(d.kind);
    if (d.kind === 'day_off') {
      const base = dateKindLabel(d.kind);
      return d.city ? `${base} · ${d.city}` : (d.title ?? base);
    }
    return d.title ?? d.city ?? dateKindLabel(d.kind);
  }
  function travelText(d: DateEvent): string {
    const place = d.city ?? d.title ?? d.venue_name ?? dateKindLabel(d.kind);
    if (d.travel_direction === 'outbound') return `→ ${place}`;
    if (d.travel_direction === 'return') return `${place} →`;
    if (d.travel_direction === 'leg') return `→ ${place} →`;
    return place;
  }

  // ── Day header labels ──────────────────────────────────────────────────
  function headWeekday(iso: string): string {
    return new Date(`${iso}T00:00:00Z`)
      .toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
      .replace(/\.+$/, '')
      .toLowerCase();
  }
  function headMonth(iso: string): string {
    return new Date(`${iso}T00:00:00Z`)
      .toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
      .replace(/\.+$/, '')
      .toLowerCase();
  }

  // ── Blackout rail — shared lane system for capsules + away threads. ───
  type RailItem = {
    from: string;
    to: string;
    away: boolean;
    company: boolean;
    tentative: boolean;
    label: string;
  };
  let railItems = $derived.by((): RailItem[] => [
    ...blackouts.map((b) => ({
      from: b.from,
      to: b.to,
      away: false,
      company: b.company,
      tentative: b.tentative,
      label: b.label,
    })),
    ...aways.map((a) => ({
      from: a.from,
      to: a.to,
      away: true,
      company: false,
      tentative: false,
      label: a.label,
    })),
  ]);
  let railLanes = $derived(assignBandLanes(railItems));
  /** First shown day covering each item — where its vertical name lives. */
  let railLabelDay = $derived(
    railItems.map((it) => shownDays.find((d) => d >= it.from && d <= it.to) ?? it.from),
  );

  // Narrow frames (<~560px) collapse the rail to threads by default; the
  // pill expands the named panel as an overlay (ADR-078 / converged mock).
  let narrow = $state(false);
  let panelOpen = $state(false);
  $effect(() => {
    const mq = matchMedia('(max-width: 560px)');
    const apply = () => {
      narrow = mq.matches;
      if (!mq.matches) panelOpen = false;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });

  let railMode = $derived(narrow ? (panelOpen ? 'panel' : 'threads') : 'side');
  let capW = $derived(railMode === 'threads' ? 3 : railMode === 'panel' ? 20 : 22);
  let laneGap = $derived(railMode === 'threads' ? 4 : 7);
  /** Reserved width — panel mode overlays, so it reserves like threads. */
  let reservedW = $derived.by(() => {
    const n = railLanes.laneCount;
    if (n === 0) return 0;
    const w = railMode === 'panel' ? 3 : capW;
    const g = railMode === 'panel' ? 4 : laneGap;
    return g + n * (w + g);
  });

  function railSegs(day: string): Array<{ item: RailItem; lane: number; i: number }> {
    const out: Array<{ item: RailItem; lane: number; i: number }> = [];
    railItems.forEach((item, i) => {
      if (day >= item.from && day <= item.to) {
        out.push({ item, lane: railLanes.lanes[i], i });
      }
    });
    return out;
  }
</script>

<div
  class="ag"
  class:ag--loading={loading}
  class:ag--panel={railMode === 'panel'}
  data-rail={railMode}
  style={`--ag-rail-reserve: ${reservedW}px; --ag-cap-w: ${capW}px; --ag-lane-gap: ${laneGap}px;`}
>
  {#if narrow && railItems.length > 0}
    <div class="ag__railbar">
      <button
        type="button"
        class="ag__railtoggle"
        class:ag__railtoggle--on={panelOpen}
        aria-pressed={panelOpen}
        onclick={() => (panelOpen = !panelOpen)}
      >
        <span class="ag__railtoggle-dot" aria-hidden="true"></span>
        {blackoutsToggleLabel}
      </button>
    </div>
  {/if}

  {#if shownDays.length === 0}
    <p class="ag__empty">{emptyLabel}</p>
  {:else}
    {#each shownDays as day (day)}
      {@const rows = rowsByDay.get(day) ?? []}
      {@const banners = clashesByDay?.get(day) ?? []}
      {@const segs = railSegs(day)}
      <section class="ag__day" data-day={day}>
        <header class="ag__head" class:ag__head--today={day === todayIso}>
          <span class="ag__wd">{headWeekday(day)}</span>
          <span class="ag__num">{Number(day.slice(8, 10))}</span>
          <span class="ag__mo">{headMonth(day)}</span>
        </header>
        <div class="ag__rows">
          {#each banners as c, ci (ci)}
            <p class="ag__clash" data-severity={c.severity}>
              <span class="ag__clash-mark" data-severity={c.severity} aria-hidden="true"
                >{c.glyph}</span
              >
              <span class="ag__clash-text">{c.body}</span>
            </p>
          {/each}
          {#each rows as row, ri (ri)}
            {#if row.kind === 'perf'}
              {@const p = row.perf}
              {@const t = perfDual(p)}
              {@const href = perfHref(p)}
              {@const family = performanceStatusFamily(p.status)}
              <svelte:element
                this={href ? 'a' : 'div'}
                class="ag__row ag__row--perf"
                data-family={family}
                style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
                href={href ?? undefined}
              >
                <span class="ag__time">{t?.primary ?? '—'}</span>
                <span class="ag__body">
                  <span class="ag__title"
                    ><b>{perfName(p)}</b>{#if perfCity(p)}
                      <span class="ag__city">{perfCity(p)}</span>{/if}</span
                  >
                  <span class="ag__sub">
                    {#if p.project}<IdentityMark variant="compact" accent={accentVarFor(p.project)} initials={p.project.initials} name={p.project.name} size="15px" />{/if}
                    {p.project?.name ?? ''}
                    {#if t?.secondary}<span class="ag__courtesy"
                        >· {viewerTimeLabel(t.secondary)}</span
                      >{/if}
                  </span>
                </span>
                <span class="ag__status">{statusLabel(p.status)}</span>
              </svelte:element>
            {:else}
              {@const d = row.date}
              {@const t = dateDual(d)}
              {#if d.kind === 'travel_day'}
                <div
                  class="ag__row ag__row--travel"
                  style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
                >
                  <span class="ag__time ag__time--meta">{dateKindLabel(d.kind)}</span>
                  <span class="ag__body">
                    <span class="ag__title ag__title--travel">{travelText(d)}</span>
                    <span class="ag__sub">
                      {#if d.project}<IdentityMark variant="compact" accent={accentVarFor(d.project)} initials={d.project.initials} name={d.project.name} size="15px" />{/if}
                      {d.project?.name ?? ''}
                    </span>
                  </span>
                </div>
              {:else}
                <div
                  class="ag__row ag__row--date"
                  data-family={dateStatusFamily(d.status)}
                  style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
                >
                  <span class="ag__time ag__time--meta"
                    >{t?.primary ?? dateKindLabel(d.kind)}</span
                  >
                  <span class="ag__body">
                    <span class="ag__title ag__title--date">{dateText(d)}</span>
                    <span class="ag__sub">
                      {#if d.project}<IdentityMark variant="compact" accent={accentVarFor(d.project)} initials={d.project.initials} name={d.project.name} size="15px" />{/if}
                      {d.project?.name ?? ''}
                      {#if t?.secondary}<span class="ag__courtesy"
                          >· {viewerTimeLabel(t.secondary)}</span
                        >{/if}
                    </span>
                  </span>
                </div>
              {/if}
            {/if}
          {/each}
        </div>
        {#each segs as seg (seg.i)}
          <span
            class="ag__cap"
            class:ag__cap--away={seg.item.away}
            class:ag__cap--company={seg.item.company}
            class:ag__cap--tentative={seg.item.tentative}
            class:ag__cap--start={day === seg.item.from}
            class:ag__cap--end={day === seg.item.to}
            style={`--lane: ${seg.lane};`}
            title={seg.item.label}
            aria-hidden="true"
          >
            {#if railMode !== 'threads' && day === railLabelDay[seg.i]}
              <span class="ag__cap-name">{seg.item.label}</span>
            {/if}
          </span>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  @layer components {
    .ag {
      /* One neutral availability accent for every person (never per-person
         hues); company blackouts sink to ink. */
      --ag-black-accent: var(--cal-accent, var(--warning));
      position: relative;
      display: flex;
      flex-direction: column;
      transition: opacity var(--transition);
    }
    .ag--loading {
      opacity: 0.6;
    }

    .ag__empty {
      padding-block: var(--space-xl);
      text-align: center;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-faint);
    }

    /* ── Day group: sticky header column + rows. ── */
    .ag__day {
      position: relative;
      display: grid;
      grid-template-columns: 6rem 1fr;
      align-items: start;
    }

    .ag__head {
      position: sticky;
      top: 0;
      display: flex;
      flex-direction: column;
      padding: var(--space-m) 0 var(--space-xs) var(--space-xs);
      background: linear-gradient(var(--bg) 78%, transparent);
      z-index: 2;
    }
    .ag__wd,
    .ag__mo {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ag__num {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      line-height: 1.05;
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
      margin-block: var(--space-2xs);
    }
    .ag__head--today .ag__wd,
    .ag__head--today .ag__num,
    .ag__head--today .ag__mo {
      color: var(--ag-black-accent);
    }

    .ag__rows {
      border-inline-start: 1px solid var(--border-color-light);
      padding-block: var(--space-s);
      padding-inline-end: calc(var(--ag-rail-reserve) + var(--space-s));
      min-block-size: 3.25rem;
      min-inline-size: 0;
    }

    /* ── Row DNA: time-as-glyph · body · status. ── */
    .ag__row {
      position: relative;
      display: grid;
      grid-template-columns: 4.5rem 1fr auto;
      gap: var(--space-s);
      align-items: baseline;
      padding: var(--space-xs) var(--space-s) var(--space-xs) var(--space-m);
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-s);
    }
    a.ag__row:hover {
      background: var(--bg-light);
    }
    /* Timeline node on the day line — the status family redeclares the
       node variables (solid = confirmed, outline = hold, faint = rest). */
    .ag__row::before {
      --node-bg: var(--bg);
      --node-border: var(--border-color-dark);
      content: '';
      position: absolute;
      inset-inline-start: calc(-1 * var(--space-2xs) - 3.5px);
      top: 0.85em;
      inline-size: 7px;
      block-size: 7px;
      border-radius: var(--radius-circle);
      background: var(--node-bg);
      border: 1.5px solid var(--node-border);
    }
    .ag__row--perf[data-family='confirmed']::before {
      --node-bg: var(--c, var(--text-muted));
      --node-border: var(--c, var(--text-muted));
    }
    .ag__row--perf[data-family='hold']::before {
      --node-border: var(--c, var(--border-color-dark));
    }

    .ag__time {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .ag__time--meta {
      font-size: 0.85em;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .ag__body {
      min-inline-size: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .ag__title {
      font-size: var(--text-s);
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ag__title b {
      font-weight: 600;
    }
    .ag__row[data-family='proposed'] .ag__title {
      color: var(--text-muted);
    }
    .ag__title--date {
      font-style: italic;
      color: var(--text-muted);
    }
    .ag__title--travel {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: color-mix(in oklch, var(--c, var(--text-muted)) 50%, var(--text-muted));
    }
    .ag__city {
      color: var(--text-faint);
      font-weight: 400;
      /* Svelte trims the whitespace between </b> and this span — restore
         the name–city gap here. */
      margin-inline-start: var(--space-2xs);
    }
    .ag__sub {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-inline-size: 0;
      overflow: hidden;
      white-space: nowrap;
    }
    .ag__courtesy {
      color: color-mix(in oklch, var(--ag-black-accent) 50%, var(--text-faint));
    }
    .ag__status {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      align-self: center;
      white-space: nowrap;
    }

    /* ── Clash banners — same grammar as the month day-marks. ── */
    .ag__clash {
      --clash-bg: var(--bg-light);
      --clash-fg: var(--text-muted);
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: var(--space-2xs) var(--space-s) var(--space-2xs) var(--space-m);
      padding: var(--space-xs) var(--space-s);
      border-radius: var(--radius-m);
      background: var(--clash-bg);
      color: var(--clash-fg);
      font-size: var(--text-xs);
    }
    .ag__clash[data-severity='people'] {
      --clash-bg: color-mix(in oklch, var(--danger) 8%, transparent);
      --clash-fg: color-mix(in oklch, var(--danger) 45%, var(--text-muted));
    }
    .ag__clash[data-severity='blackout'] {
      --clash-bg: color-mix(in oklch, var(--danger) 5%, transparent);
      --clash-fg: color-mix(in oklch, var(--danger) 40%, var(--text-muted));
    }
    .ag__clash[data-severity='blackout-tentative'] {
      --clash-bg: color-mix(in oklch, var(--ag-black-accent) 8%, transparent);
      --clash-fg: var(--text-muted);
    }
    .ag__clash-mark {
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
      flex: none;
    }
    .ag__clash-mark[data-severity='people'] {
      --mark-bg: var(--danger);
      --mark-fg: var(--bg);
    }
    .ag__clash-mark[data-severity='possible'] {
      --mark-border-color: var(--border-color-dark);
      --mark-border-style: dashed;
      --mark-fg: var(--text-faint);
    }
    .ag__clash-mark[data-severity='blackout'] {
      --mark-border-color: var(--danger);
      --mark-fg: var(--danger);
    }
    .ag__clash-mark[data-severity='blackout-tentative'] {
      --mark-border-color: var(--ag-black-accent);
      --mark-border-style: dashed;
      --mark-fg: var(--ag-black-accent);
    }
    .ag__clash-text {
      min-inline-size: 0;
    }

    /* ── Blackout rail — per-day segments; contiguity comes free because
       every day inside a stored blackout is an included day. ── */
    .ag__cap {
      position: absolute;
      top: 0;
      bottom: 0;
      inset-inline-end: calc(
        var(--ag-lane-gap) + var(--lane) * (var(--ag-cap-w) + var(--ag-lane-gap))
      );
      inline-size: var(--ag-cap-w);
      background: color-mix(in oklch, var(--ag-black-accent) 26%, var(--bg));
      border-inline: 1px solid color-mix(in oklch, var(--ag-black-accent) 45%, var(--border-color-light));
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: hidden;
      z-index: 3;
    }
    .ag__cap--start {
      border-start-start-radius: var(--radius-circle);
      border-start-end-radius: var(--radius-circle);
      border-block-start: 1px solid color-mix(in oklch, var(--ag-black-accent) 45%, var(--border-color-light));
      padding-block-start: var(--space-s);
      top: var(--space-xs);
    }
    .ag__cap--end {
      border-end-start-radius: var(--radius-circle);
      border-end-end-radius: var(--radius-circle);
      border-block-end: 1px solid color-mix(in oklch, var(--ag-black-accent) 45%, var(--border-color-light));
      bottom: var(--space-xs);
    }
    .ag__cap--tentative {
      background: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--ag-black-accent) 30%, var(--bg)) 0 5px,
        color-mix(in oklch, var(--ag-black-accent) 11%, var(--bg)) 5px 10px
      );
    }
    .ag__cap--company {
      background: color-mix(in oklch, var(--text-color) 12%, var(--bg));
      border-color: var(--border-color-dark);
    }
    .ag__cap--away {
      background: none;
      border-inline: none;
      border-inline-end: 2px dotted color-mix(in oklch, var(--ag-black-accent) 55%, var(--border-color-dark));
      border-radius: 0;
    }
    .ag__cap-name {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      font-family: var(--font-mono);
      font-size: 0.6rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: color-mix(in oklch, var(--ag-black-accent) 42%, var(--text-color));
      white-space: nowrap;
    }
    .ag__cap--company .ag__cap-name {
      color: var(--text-muted);
    }
    .ag--panel .ag__cap:not(.ag__cap--away) {
      box-shadow: -12px 0 18px -10px color-mix(in oklch, var(--text-color) 35%, transparent);
    }

    /* ── Narrow toggle pill. ── */
    .ag__railbar {
      display: flex;
      justify-content: flex-end;
      padding-block-end: var(--space-xs);
    }
    .ag__railtoggle {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
      background: none;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      padding: var(--space-2xs) var(--space-s);
      cursor: pointer;
    }
    .ag__railtoggle-dot {
      inline-size: 7px;
      block-size: 7px;
      border-radius: var(--radius-circle);
      background: var(--border-color-dark);
    }
    .ag__railtoggle--on .ag__railtoggle-dot {
      background: var(--ag-black-accent);
    }

    @media (max-width: 560px) {
      .ag__day {
        grid-template-columns: 4.25rem 1fr;
      }
      .ag__row {
        grid-template-columns: 3.6rem 1fr auto;
        gap: var(--space-xs);
        padding-inline: var(--space-xs) var(--space-xs);
      }
      .ag__clash {
        margin-inline: var(--space-xs);
      }
    }
  }
</style>
