<script module lang="ts">
  /**
   * One inline contested-hold band (ADR-080 §4 surfaced in the book): the
   * two competing performance ids and a pre-localized reason header. The
   * pick/release actions stay in the DecisionBand above — the agenda only
   * *shows* the tension, it never duplicates the write UI.
   */
  export type AgendaDecision = {
    /** The two performance ids in tension — both rows are wrapped. */
    ids: [string, string];
    /** Localized reason ("… a dues reserves el mateix dia", "Sense dades…"). */
    reason: string;
    severity: 'people' | 'possible' | 'double';
  };
</script>

<script lang="ts">
  /**
   * Agenda projection of the Calendar lens (ADR-076) — the same fetched
   * rows as the month grid, regrouped as a continuous multi-month BOOK:
   * a serif month divider opens each month, every day of the span gets a
   * row (empty days a hairline, kept ones their events), and the reader
   * scrolls to summon more months (an end sentinel asks the page to extend
   * the span; a top "earlier" action prepends with scroll-anchoring).
   *
   * Each day: a weekday+number header column, one row per event
   * (meta[time·status | kind badge] · title · place · project chip),
   * clash banners leading a conflicted day, contested holds wrapped under
   * a reason band, and the blackout/festival rail on the right.
   *
   * The page owns the feeds, the conflict/decision engines, the i18n and
   * the multi-month span; this component is pure presentation. Days are
   * given whole (`days`) — the "days with events" inclusion rule is gone,
   * the book shows the calendar entire.
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
  } from '$lib/month-events';
  import { assignBandLanes, dayKeyInTz } from '$lib/planner';
  import { dualTime, hourMark, localeWeekdayShort } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { performanceStatusFamily, performanceStatusLabel } from '$lib/performance';
  import { dateStatusFamily } from '$lib/date';

  interface Props {
    /** Ordered ISO days across the whole agenda span (multi-month). */
    days: string[];
    /** Already scope-filtered rows — same feed as the month grid. */
    performances: PerformanceEvent[];
    dates: DateEvent[];
    /** Fallback slug for row hrefs when a perf's workspace isn't resolvable. */
    workspaceSlug: string;
    loading?: boolean;
    blackouts?: BlackoutBandVM[];
    aways?: AwayBandVM[];
    clashesByDay?: Map<string, ClashVM[]>;
    /** Contested holds per day (ADR-080 §4) — reason + the two perf ids. */
    decisionsByDay?: Map<string, AgendaDecision[]>;
    /** Today's day key (viewer tz) — the accented number. */
    todayIso?: string;
    /** BCP47/locale tag for the day-header/divider labels. */
    locale?: string;
    /** i18n hooks — the page passes t()-backed fns/strings. */
    dateKindLabel?: (kind: string) => string;
    viewerTimeLabel?: (time: string) => string;
    statusLabel?: (status: string) => string;
    travelDirLabel?: (dir: string) => string;
    emptyLabel?: string;
    blackoutsToggleLabel?: string;
    earlierLabel?: string;
    decideLabel?: string;
    /** Header of the right-hand dot-grid notes column. */
    notesLabel?: string;
    /** «show» — the kind word a performance row carries in its pack. */
    showWord?: string;
    /** «let go» — the word a released row carries. */
    releasedWord?: string;
    /** «no hour» — a hold nobody has timed. NEVER a dash. */
    noHourWord?: string;
    /** «all day» — a row that lasts the day, which is not the same as no hour. */
    allDayWord?: string;
    /** Scroll reached the end → page appends the next month. */
    onReachEnd?: () => void;
    /** Top "earlier months" action → page prepends (scroll-anchored). */
    onReachStart?: () => void;
    /** Jump to the DecisionBand (where the pick/release actions live). */
    onDecideJump?: () => void;
    /**
     * Date row click — opens the page's edit dialog. Absent ⇒ the rows
     * stay inert divs, as the book has always rendered them. A gig row
     * keeps its link: a performance has a page, a date does not.
     */
    onDateOpen?: (d: DateEvent) => void;
  }

  let {
    days,
    performances,
    dates,
    workspaceSlug,
    loading = false,
    blackouts = [],
    aways = [],
    clashesByDay,
    decisionsByDay,
    locale = 'en-GB',
    todayIso = dayKeyInTz(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone),
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    viewerTimeLabel = (time: string) => `${time}`,
    statusLabel = performanceStatusLabel,
    travelDirLabel = (dir: string) => dir,
    emptyLabel = 'Nothing this month.',
    blackoutsToggleLabel = 'blackouts',
    earlierLabel = '↑ earlier',
    decideLabel = 'decide ↑',
    notesLabel = 'NOTES',
    showWord = 'show',
    releasedWord = 'let go',
    noHourWord = 'no hour',
    allDayWord = 'all day',
    onReachEnd,
    onReachStart,
    onDecideJump,
    onDateOpen,
  }: Props = $props();

  /**
   * The shell a date row renders as. `svelte:element` swaps the tag; the
   * button-only attributes ride as a spread so a plain div never carries a
   * stray type="button". IdentityMark is a span, so unlike the month chip
   * there is no nested interactive content to work around here.
   */
  function rowShellProps(d: DateEvent): Record<string, unknown> {
    return onDateOpen ? { type: 'button', onclick: () => onDateOpen(d) } : {};
  }

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
      /* TIMED FIRST, then the un-timed — the running order of the day.
         It used to be the other way round: the empty sort key sorted before
         every clock, so a hold nobody had timed opened the day above the gig
         that actually happens at 20h. A day reads forwards. */
      rows.sort((a, b) => {
        const ra = a.sort ? 0 : 1;
        const rb = b.sort ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;
      });
    }
    return map;
  });

  // The book shows every day of the span — no inclusion filter.
  let shownDays = $derived(days);

  // First day of each month → where the serif divider opens.
  let monthBreaks = $derived.by(() => {
    const s = new Set<string>();
    let prev = '';
    for (const d of days) {
      const mk = d.slice(0, 7);
      if (mk !== prev) {
        s.add(d);
        prev = mk;
      }
    }
    return s;
  });

  // ── Render items per day: loose rows, with contested holds folded into a
  // band at the position of their first member (both members must be
  // present — a status filter can hide one, then it just reads as a row). ─
  type ContestGroup = { dec: AgendaDecision; a: Row; b: Row };
  type RenderItem = { contest: ContestGroup } | { row: Row };

  function dayItems(day: string): RenderItem[] {
    const rows = rowsByDay.get(day) ?? [];
    const decs = decisionsByDay?.get(day);
    if (!decs || decs.length === 0) return rows.map((row) => ({ row }));

    const rowByPerf = new Map<string, Row>();
    for (const r of rows) if (r.kind === 'perf') rowByPerf.set(r.perf.id, r);

    const grouped = new Set<string>();
    const firstMember = new Map<string, ContestGroup>();
    for (const dec of decs) {
      if (grouped.has(dec.ids[0]) || grouped.has(dec.ids[1])) continue;
      const a = rowByPerf.get(dec.ids[0]);
      const b = rowByPerf.get(dec.ids[1]);
      if (!a || !b) continue;
      const g: ContestGroup = { dec, a, b };
      grouped.add(dec.ids[0]);
      grouped.add(dec.ids[1]);
      firstMember.set(rows.indexOf(a) <= rows.indexOf(b) ? dec.ids[0] : dec.ids[1], g);
    }
    if (grouped.size === 0) return rows.map((row) => ({ row }));

    const out: RenderItem[] = [];
    for (const r of rows) {
      const pid = r.kind === 'perf' ? r.perf.id : null;
      if (pid && grouped.has(pid)) {
        const g = firstMember.get(pid);
        if (g) out.push({ contest: g });
        continue;
      }
      out.push({ row: r });
    }
    return out;
  }

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
  /* THE SORT KEY STAYS ON THE WIRE CLOCK. `hourMark` is a reading, not an
     ordering: `9h` sorts above `20h30` by codepoint, so the day's running
     order would invert the moment the hour lost its leading zero. Formatting
     happens where it is printed and nowhere else. */
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
    // `other` names itself with its custom label (badge), so the body shows
    // the real title (+ place) — e.g. "Mescla · Tamarit", badge "ESTUDI".
    if (d.kind === 'other') {
      return [d.title ?? d.label, d.city].filter(Boolean).join(' · ') || dateKindLabel(d.kind);
    }
    if (d.kind === 'day_off') {
      const base = dateKindLabel(d.kind);
      return d.city ? `${base} · ${d.city}` : (d.title ?? base);
    }
    return d.title ?? d.city ?? dateKindLabel(d.kind);
  }
  // The meta badge: `other` shows its custom label (custom_fields.label,
  // ADR-078 §8) uppercased; every other kind shows the kind name.
  function dateBadge(d: DateEvent): string {
    if (d.kind === 'other' && d.label) return d.label;
    return dateKindLabel(d.kind);
  }
  function travelText(d: DateEvent): string {
    const place = d.city ?? d.title ?? d.venue_name ?? dateKindLabel(d.kind);
    const dir = d.travel_direction ? travelDirLabel(d.travel_direction) : null;
    return dir ? `✈ ${place} · ${dir}` : `✈ ${place}`;
  }

  // ── Day header + month divider labels ──────────────────────────────────
  function headWeekday(iso: string): string {
    return localeWeekdayShort(iso, locale).toLowerCase();
  }
  function monthDivName(iso: string): string {
    const raw = new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'long',
      timeZone: 'UTC',
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  function monthDivYear(iso: string): string {
    return iso.slice(0, 4);
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
  // The NOTES column (dot grid) lives on the right at wide sizes; the rail
  // floats OVER it (ADR mock — "blackouts encima"), so content reserves
  // nothing there. Narrow collapses the notes away and the rail reserves
  // a thread strip inside the content like before.
  let notesW = $derived(narrow ? 0 : 240);
  /** Content reserve — 0 at side (rail over notes); threads/panel reserve. */
  let reservedW = $derived.by(() => {
    const n = railLanes.laneCount;
    if (n === 0 || railMode === 'side') return 0;
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

  // ── Lazy end-extension: a sentinel below the last day asks the page to
  // append the next month. Re-observed on every span change so a sentinel
  // still in view after one extension re-fires (fills the viewport). ─────
  let endSentinel = $state<HTMLElement>();
  $effect(() => {
    void days.length;
    const el = endSentinel;
    if (!el || !onReachEnd) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) onReachEnd?.();
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  });
</script>

<div
  class="ag"
  class:ag--loading={loading}
  class:ag--panel={railMode === 'panel'}
  data-rail={railMode}
  style={`--ag-rail-reserve: ${reservedW}px; --ag-cap-w: ${capW}px; --ag-lane-gap: ${laneGap}px; --ag-notes-w: ${notesW}px;`}
>
  {#if notesW > 0}
    <!-- The dot-grid notes margin (mock) — a real bullet-journal column;
         the blackout rail floats over its left edge ("blackouts encima"). -->
    <aside class="ag__notes">
      <span class="ag__notes-head">{notesLabel}</span>
    </aside>
  {/if}

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
    {#if onReachStart}
      <button type="button" class="ag__earlier" onclick={onReachStart}>{earlierLabel}</button>
    {/if}

    {#each shownDays as day (day)}
      {#if monthBreaks.has(day)}
        <h2 class="ag__monthdiv">
          <span class="ag__monthdiv-name">{monthDivName(day)}</span>
          <span class="ag__monthdiv-year">{monthDivYear(day)}</span>
        </h2>
      {/if}
      {@const items = dayItems(day)}
      {@const banners = clashesByDay?.get(day) ?? []}
      {@const segs = railSegs(day)}
      {@const empty = items.length === 0 && banners.length === 0}
      <section
        class="ag__day"
        class:ag__day--empty={empty}
        class:ag__day--today={day === todayIso}
        data-day={day}
      >
        <header class="ag__head">
          <span class="ag__wd">{headWeekday(day)}</span>
          <span class="ag__num">{Number(day.slice(8, 10))}</span>
        </header>
        <div class="ag__rows">
          {#each banners as c, ci (ci)}
            <p class="ag__clash" data-severity={c.severity}>
              <span class="ag__clash-mark" data-severity={c.severity} aria-hidden="true"
                >!</span
              >
              <span class="ag__clash-text">{c.body}</span>
            </p>
          {/each}
          {#each items as it, ii (ii)}
            {#if 'contest' in it}
              <div class="ag__contest" data-severity={it.contest.dec.severity}>
                <p class="ag__contest-head">
                  <span
                    class="ag__contest-mark"
                    data-severity={it.contest.dec.severity}
                    aria-hidden="true">{it.contest.dec.severity === 'possible' ? '?' : '!'}</span
                  >
                  <span class="ag__contest-reason">{it.contest.dec.reason}</span>
                  {#if onDecideJump}<button
                      type="button"
                      class="ag__contest-jump"
                      onclick={onDecideJump}>{decideLabel}</button
                    >{/if}
                </p>
                {@render eventRow(it.contest.a)}
                {@render eventRow(it.contest.b)}
              </div>
            {:else}
              {@render eventRow(it.row)}
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

    {#if onReachEnd}<div class="ag__sentinel" bind:this={endSentinel} aria-hidden="true"></div>{/if}
  {/if}
</div>

{#snippet eventRow(row: Row)}
  <!-- THE IDENTITY OPENS THE ROW (ADR-095). Three columns: a fixed identity
       column, the name, and a slot reserved for the verbs.

       In the identity column the PACK comes first — monogram + the kind word —
       then the state, and the HOUR SITS UNDER THEM. That is the one place the
       Flow differs from the month on purpose: here the hour is a COLUMN of the
       sheet, so it aligns down the page and you can scan time with your eye.
       Before this the row opened with the hour and buried the project in a
       second line of the BODY, so the token the whole app is colour-coded by
       was the last thing you reached. -->
  {#if row.kind === 'perf'}
    {@const p = row.perf}
    {@const t = perfDual(p)}
    {@const href = perfHref(p)}
    {@const family = performanceStatusFamily(p.status)}
    {@const held = family === 'hold' || family === 'proposed'}
    <svelte:element
      this={href ? 'a' : 'div'}
      class="ag__row ag__row--perf"
      data-family={family}
      style={p.project ? `--c: ${accentVarFor(p.project)}` : undefined}
      href={href ?? undefined}
    >
      <span class="ag__id">
        <span class="ag__pack">
          {#if p.project}<IdentityMark
              mini
              variant="compact"
              accent={accentVarFor(p.project)}
              initials={p.project.initials}
              name={p.project.name}
            />{/if}
          <span class="ag__kind" class:ag__kind--q={held}
            >{showWord}{#if held}?{/if}</span
          >
        </span>
        {#if family === 'hold'}
          <!-- Plain text, never a pill: a pill here reads louder than the venue
               you came to read. It is allowed to turn a line in 118px. -->
          <span class="ag__hold">{statusLabel(p.status)}</span>
        {:else if family === 'released'}
          <span class="ag__hold">{releasedWord}</span>
        {/if}
        <!-- NO HOUR IS A FACT, not a typographic shrug. A hold is a date
             somebody ASKED for, so most arrive without one; a dash reads as an
             hour that failed to print. -->
        <span class="ag__time" class:ag__time--none={!t?.primary}
          >{t?.primary ? hourMark(t.primary) : noHourWord}</span
        >
        {#if t?.secondary}<span class="ag__courtesy">{viewerTimeLabel(hourMark(t.secondary))}</span>{/if}
      </span>
      <span class="ag__body">
        <!-- The name is NEVER truncated: a row may grow, and «Teatre Nacional
             de Cataluny…» is a name you cannot look up. The city sits UNDER
             it — one line for what it is, one for where it is. -->
        <span class="ag__title">{perfName(p)}</span>
        {#if perfCity(p)}<span class="ag__city">{perfCity(p)}</span>{/if}
      </span>
      <span class="ag__acts"></span>
    </svelte:element>
  {:else}
    {@const d = row.date}
    {@const t = dateDual(d)}
    {@const fam = dateStatusFamily(d.status)}
    {@const held = fam === 'hold' || fam === 'proposed'}
    <svelte:element
      this={onDateOpen ? 'button' : 'div'}
      class="ag__row ag__row--date"
      class:ag__row--openable={onDateOpen}
      class:ag__row--travel={d.kind === 'travel_day'}
      data-family={fam}
      style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
      {...rowShellProps(d)}
    >
      <span class="ag__id">
        <span class="ag__pack">
          {#if d.project}<IdentityMark
              mini
              variant="compact"
              accent={accentVarFor(d.project)}
              initials={d.project.initials}
              name={d.project.name}
            />{/if}
          <span class="ag__kind" class:ag__kind--q={held}
            >{dateKindLabel(d.kind)}{#if held}?{/if}</span
          >
        </span>
        {#if fam === 'released'}
          <span class="ag__hold">{releasedWord}</span>
        {/if}
        {#if d.all_day}
          <span class="ag__time ag__time--none">{allDayWord}</span>
        {:else}
          <span class="ag__time" class:ag__time--none={!t?.primary}
            >{t?.primary ? hourMark(t.primary) : noHourWord}</span
          >
        {/if}
        {#if t?.secondary}<span class="ag__courtesy">{viewerTimeLabel(hourMark(t.secondary))}</span>{/if}
      </span>
      <span class="ag__body">
        <span class="ag__title">{d.kind === 'travel_day' ? travelText(d) : dateText(d)}</span>
        {#if d.city && d.kind !== 'travel_day'}<span class="ag__city">{d.city}</span>{/if}
      </span>
      <span class="ag__acts"></span>
    </svelte:element>
  {/if}
{/snippet}

<style>
  @layer components {
    .ag {
      /* One neutral availability accent for every person (never per-person
         hues); company blackouts sink to ink. */
      --ag-black-accent: var(--cal-accent, var(--warning));
      position: relative;
      display: grid;
      grid-template-columns: 1fr var(--ag-notes-w, 0px);
      align-content: start;
      transition: opacity var(--transition);
    }
    /* The book stacks in column 1; the notes margin spans every row in 2. */
    .ag > :not(.ag__notes) {
      grid-column: 1;
      min-inline-size: 0;
    }
    .ag--loading {
      opacity: 0.6;
    }

    /* ── NOTES margin — a dot-grid bullet-journal column on the right. ── */
    .ag__notes {
      grid-column: 2;
      grid-row: 1 / -1;
      position: relative;
      border-inline-start: 1px solid var(--border-color-light);
      background-image: radial-gradient(
        circle,
        color-mix(in oklch, var(--text-faint) 45%, transparent) 1px,
        transparent 1.5px
      );
      background-size: 22px 22px;
      background-position: 18px 44px;
      z-index: 0;
    }
    .ag__notes-head {
      position: sticky;
      top: 0;
      display: block;
      padding: var(--space-m) var(--space-s) var(--space-s) var(--space-l);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .ag__empty {
      padding-block: var(--space-xl);
      text-align: center;
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-faint);
    }

    /* Top "earlier months" — quiet, centered, prepends with anchoring. */
    .ag__earlier {
      justify-self: center;
      margin-block: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      background: none;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-circle);
      padding: var(--space-2xs) var(--space-m);
      cursor: pointer;
      transition: color var(--transition), border-color var(--transition);
    }
    .ag__earlier:hover {
      color: var(--text-muted);
      border-color: var(--border-color-dark);
    }

    /* ── Serif month divider — the book's chapter head. ── */
    .ag__monthdiv {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      margin-block: var(--space-l) var(--space-2xs);
      padding-inline-start: var(--space-xs);
      font-weight: 400;
    }
    .ag__monthdiv:first-child {
      margin-block-start: var(--space-2xs);
    }
    .ag__monthdiv-name {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      color: var(--text-color);
    }
    .ag__monthdiv-year {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }

    /* ── Day group: header column + rows, a ledger rule beneath. ── */
    .ag__day {
      position: relative;
      display: grid;
      grid-template-columns: 6rem 1fr;
      align-items: start;
      border-block-end: 1px solid var(--border-color-light);
    }
    .ag__day--empty {
      min-block-size: 2.5rem;
    }

    .ag__head {
      display: flex;
      flex-direction: column;
      padding: var(--space-s) 0 var(--space-xs) var(--space-xs);
    }
    .ag__day--empty .ag__head {
      padding-block: var(--space-xs);
    }
    .ag__wd {
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
      margin-block-start: var(--space-2xs);
    }
    .ag__day--empty .ag__num {
      font-size: var(--text-l);
      color: var(--text-muted);
    }
    .ag__day--today .ag__wd,
    .ag__day--today .ag__num {
      color: var(--ag-black-accent);
    }

    .ag__rows {
      padding-block: var(--space-s);
      padding-inline-end: calc(var(--ag-rail-reserve) + var(--space-s));
      min-inline-size: 0;
    }
    .ag__day:not(.ag__day--empty) .ag__rows {
      border-inline-start: 1px solid var(--border-color-light);
    }
    .ag__day--empty .ag__rows {
      padding-block: var(--space-xs);
      min-block-size: 0;
    }

    /* ── Row DNA: meta[time·status | badge] · body. ── */
    .ag__row {
      position: relative;
      display: grid;
      /* identity · the name · the verbs' reserved slot. The identity column is
         fixed so the names line up down the page; the verb slot is reserved so
         the row cannot change height when the pointer crosses it. */
      grid-template-columns: 7.5rem minmax(0, 1fr) auto;
      gap: 0 var(--space-m);
      align-items: baseline;
      padding: var(--space-xs) var(--space-s) var(--space-xs) var(--space-m);
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-s);
    }
    a.ag__row:hover,
    .ag__row--openable:hover {
      background: var(--bg-light);
    }
    /* An openable date row is a <button>: undo the widget defaults the
       grid layout above assumes (font, centred text, intrinsic width,
       chrome border) without touching the row DNA itself. */
    .ag__row--openable {
      inline-size: 100%;
      border: none;
      background: none;
      font: inherit;
      text-align: start;
      cursor: pointer;
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

    .ag__meta {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .ag__time {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .ag__time--date {
      color: var(--text-faint);
    }
    /* Status pill — bordered, project-accent tinted (CONFIRMAT / 1R HOLD). */
    .ag__state {
      align-self: flex-start;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: color-mix(in oklch, var(--c, var(--text-muted)) 55%, var(--text-muted));
      border: 1px solid color-mix(in oklch, var(--c, var(--border-color-dark)) 40%, var(--border-color-light));
      border-radius: var(--radius-s);
      padding: 1px var(--space-xs);
      white-space: nowrap;
    }
    .ag__row--perf[data-family='hold'] .ag__state {
      border-style: dashed;
    }
    /* Type badge for dates — ASSAIG / PREMSA / VIATGE … */
    .ag__badge {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      white-space: nowrap;
    }

    .ag__body {
      min-inline-size: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    /* NO VIEW TRUNCATES A NAME (ADR-095). A row is allowed to grow, and
       «Teatre Nacional de Cataluny…» is a name you cannot look up. The
       ellipsis was not arbitrary — the name used to be `nowrap` with VISIBLE
       overflow and printed over the row's actions — but wrapping fixes that
       too: inside a `minmax(0, 1fr)` column a wrapped name cannot leave its
       track. */
    .ag__title {
      font-size: var(--text-s);
      color: var(--text-color);
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      text-wrap: pretty;
      overflow-wrap: break-word;
      line-height: 1.2;
    }
    .ag__title b {
      font-weight: 600;
    }
    /* ── THE ROW · three columns (ADR-095) ────────────────────────────
       identity (fixed) · the name · a slot reserved for the verbs, so the row
       never changes height when the pointer crosses it. */
    .ag__id {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-inline-size: 0;
    }
    .ag__pack {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }
    .ag__kind {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      white-space: nowrap;
    }
    .ag__kind--q {
      font-style: italic;
    }
    /* Plain text, and allowed to turn a line in a 118px column. */
    .ag__hold {
      display: block;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      line-height: 1.2;
      white-space: normal;
    }
    /* One hour, one size, one colour. It used to grow and darken when a date
       became firm, so certainty was said twice in the clock on top of every
       other mark that already says it. An hour is an hour. */
    .ag__time--none {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      font-variant-numeric: normal;
    }
    .ag__acts {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      min-inline-size: 7rem;
    }

    .ag__row[data-family='proposed'] .ag__title {
      color: var(--text-muted);
    }
    /* RELEASED — the fourth certainty (ADR-095 §0). Kept as memory: struck
       through at the faintest ink, in the row exactly as on the month slip.
       Without this rule a released row inherits the plain title, which is the
       confirmed treatment — the loudest possible lie about a gig you lost. */
    .ag__row[data-family='released'] .ag__title,
    .ag__row[data-family='released'] .ag__time {
      color: var(--text-faint);
      text-decoration: line-through;
      text-decoration-thickness: 1px;
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
    /* THE CITY SITS UNDER THE NAME — one line for what it is, one for where
       it is — and it is QUIETER: the name is the assertion, the place is the
       gloss. It used to ride inline behind the name, where it inherited the
       name's size and read as part of it. */
    .ag__city {
      display: block;
      margin-inline-start: 0;
      margin-block-start: 1px;
      font-size: var(--text-xs);
      font-weight: 400;
      color: var(--text-faint);
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

    /* ── Contested holds — a heavier clash band wrapping the two rows. ── */
    .ag__contest {
      margin: var(--space-2xs) var(--space-s) var(--space-xs) var(--space-m);
      border: 1px solid color-mix(in oklch, var(--danger) 22%, var(--border-color-light));
      border-radius: var(--radius-m);
      background: color-mix(in oklch, var(--danger) 4%, transparent);
      overflow: hidden;
    }
    .ag__contest[data-severity='possible'] {
      border-color: var(--border-color-dark);
      background: var(--bg-light);
    }
    .ag__contest-head {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: var(--space-xs) var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
      border-block-end: 1px solid color-mix(in oklch, var(--danger) 12%, var(--border-color-light));
    }
    .ag__contest[data-severity='possible'] .ag__contest-head {
      border-block-end-color: var(--border-color-light);
    }
    .ag__contest-mark {
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: var(--radius-circle);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      line-height: 1;
      background: var(--danger);
      color: var(--bg);
      flex: none;
    }
    .ag__contest-mark[data-severity='possible'] {
      background: var(--bg);
      color: var(--text-faint);
      border: 1px dashed var(--border-color-dark);
    }
    .ag__contest-reason {
      min-inline-size: 0;
      flex: 1;
    }
    .ag__contest-jump {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      background: none;
      border: none;
      cursor: pointer;
      flex: none;
      white-space: nowrap;
    }
    .ag__contest-jump:hover {
      color: var(--text-muted);
    }
    .ag__contest .ag__row {
      padding-inline-start: var(--space-s);
    }
    .ag__contest .ag__row::before {
      display: none;
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
    /* ONE MARK, ONE MEANING — the same law the month draws (see MonthGrid).
       Four circular badges said four kinds of problem where there is one:
       something to decide on this day. Red is a real clash of people and
       nothing else earns it; everything else is a call to make. */
    .ag__clash-mark {
      --mark-fg: var(--info);
      flex: none;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      color: var(--mark-fg);
    }
    .ag__clash-mark[data-severity='people'],
    .ag__clash-mark[data-severity='blackout'] {
      --mark-fg: var(--danger);
    }
    .ag__clash-text {
      min-inline-size: 0;
    }

    /* ── Blackout / festival rail — per-day segments; contiguity comes
       free because every day inside a stored blackout is included. ── */
    .ag__cap {
      position: absolute;
      top: 0;
      bottom: 0;
      /* Negative → the capsule crosses the book/notes boundary and floats
         OVER the dot-grid notes column ("blackouts encima"). Narrow mode
         flips this back to a positive in-content reserve (media query). */
      inset-inline-end: calc(
        -1 * (var(--ag-lane-gap) + var(--lane) * (var(--ag-cap-w) + var(--ag-lane-gap)) + var(--ag-cap-w))
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

    .ag__sentinel {
      block-size: 1px;
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
        grid-template-columns: 4.25rem 1fr;
        gap: var(--space-xs);
        padding-inline: var(--space-xs) var(--space-xs);
      }
      .ag__clash,
      .ag__contest {
        margin-inline: var(--space-xs);
      }
      /* No notes column here — the rail reserves a thread strip in-content. */
      .ag__cap {
        inset-inline-end: calc(
          var(--ag-lane-gap) + var(--lane) * (var(--ag-cap-w) + var(--ag-lane-gap))
        );
      }
    }
  }
</style>
