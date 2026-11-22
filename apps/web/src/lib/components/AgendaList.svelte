<script module lang="ts">
  /**
   * One inline contested-hold band (ADR-080 §4 surfaced in the book): the
   * two competing performance ids and a pre-localized reason header. The
   * pick/release actions stay in the DecisionBand above — the agenda only
   * *shows* the tension, it never duplicates the write UI.
   */
  export type AgendaDecision = {
    /** The two performance ids in tension. */
    ids: [string, string];
    /** Localized reason ("… a dues reserves el mateix dia", "Sense dades…"). */
    reason: string;
    severity: 'people' | 'double';
  };

  /**
   * What the margin writer hands back (ADR-093). At most one of the two
   * anchor ids is set — a day's own entry the writer chose. Neither set
   * means the note falls to the page's fallback (pinned scope → company).
   */
  export type NoteDraft = {
    body: string;
    on_day: string;
    performance_id?: string;
    date_id?: string;
  };

  /** What a performance still needs, as the row says it (ADR-211 § 3). */
  export type AgendaMissing = { noTime: boolean; words: { text: string; urgent: boolean; dot?: boolean }[] };
</script>

<script lang="ts">
  /**
   * THE AGENDA (ADR-211, the drawing of ADR-209 § 3): a list from top to
   * bottom of the days with something. Each day is a row: its weekday and
   * number, then one line per thing — the monogram, the CITY as the strong
   * word with the venue under it, the hour at the end. A trip is a leg
   * between two days, not a row; three free nights or more are one line; the
   * week is a stronger rule above its first row, and «semana» is said nowhere.
   * What a performance in the next two weeks still has open is said beside it
   * in the record's own words, grey; amber only when it has hurry.
   *
   * The structure is `$lib/agenda-items` (pure, tested). The page owns the
   * feeds, the engines, the words and the span; this draws. The margin
   * (steps, calls to make, my notes) is the old diary's, kept: on a phone the
   * day's steps fold into one line that opens.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { MediaQuery, SvelteSet } from 'svelte/reactivity';
  import { bookingModeOf } from '$lib/booking-mode';
  import {
    dateDayKey,
    dateSlip,
    deducedPhrase,
    performanceSlip,
    perfDayKey,
    perfWorkspaceId,
    travelOriginFinder,
    type AwayBandVM,
    type BlackoutBandVM,
    type ClashVM,
    type DateEvent,
    type NoteEvent,
    type PerformanceEvent,
    type Slip,
  } from '$lib/month-events';
  import { dayKeyInTz, statusWord } from '$lib/planner';
  import { agendaItems, quietTail } from '$lib/agenda-items';
  import { awayRest, coversDay } from '$lib/away';
  import { MOBILE_QUERY } from '$lib/breakpoints';
  import { dualTime, hourMark, localeDayMonth, localeWeekdayShort, viewerTimeZone } from '$lib/datetime';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import PlannerSteps, { type StepVM } from '$lib/components/planner/PlannerSteps.svelte';
  import { performanceStatusFamily } from '$lib/performance';
  import { appLocale, appLocaleTag, t, tradeFor, type Voice } from '$lib/i18n';

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
    /** Today's day key (viewer tz). */
    todayIso?: string;
    /** BCP47/locale tag for the day and month labels. */
    locale?: string;
    dateKindLabel?: (kind: string, voice?: Voice) => string;
    statusLabel?: (status: string) => string;
    emptyLabel?: string;
    /** «sin hora» — said in amber when a confirmed performance lacks it. */
    noHourWord?: string;
    /** «a» — a trip whose origin nobody knows goes «viaje · a Bilbao». */
    toWord?: string;
    /** The free runs the Month hatches (`gapWindows`), named here. */
    gaps?: ReadonlyArray<{ from: string; nights: number }>;
    gapLabel?: (nights: number) => string;
    /** The one rule of «Falta» (ADR-211 § 3), already windowed and worded. */
    missingOf?: (perf: PerformanceEvent) => AgendaMissing;
    /** Who goes: names on file, [] for nobody, null when the feed did not
        say (then nothing is drawn). Desktop only (Marco, 16-11). */
    castOf?: (perf: PerformanceEvent) => string[] | null;
    noCastWord?: (voice?: Voice) => string;
    /** «alguien está en dos sitios». */
    twoPlacesLabel?: string;
    /** «14 pasos ›» — the phone's folded steps. */
    stepsFoldLabel?: (n: number) => string;
    /** THE VERB, on the row: confirming a hold is a question the list asks. */
    onConfirm?: (perfId: string) => void;
    pendingId?: string | null;
    confirmLabel?: string;
    awayUntilWord?: string;
    awayLeftWord?: string;
    awayLeftOneWord?: string;
    awayBackWord?: string;
    /** The day's number is a door to that day. */
    onDayOpen?: (isoDate: string) => void;
    /** «to decide» — the margin card's own eyebrow. */
    decideCardLabel?: string;
    /** My post-its (ADR-093), keyed by on_day. */
    notesByDay?: Map<string, NoteEvent[]>;
    /** The next steps that wait on each day (ADR-138 § 6): the margin, never the rows. */
    stepsByDay?: Map<string, StepVM[]>;
    stepsLabel?: string;
    /** Absent ⇒ the margin only reads. */
    onNoteCreate?: (draft: NoteDraft) => Promise<boolean>;
    onNoteDelete?: (id: string) => void;
    noteFallbackLabel?: string;
    noteFallbackIsSpace?: boolean;
    notePlaceholder?: string;
    noteAddLabel?: string;
    noteDeleteLabel?: string;
    /** Scroll nears the foot → the page grows the list forward. */
    onReachEnd?: () => void;
    /** The past, on request (the head's line and the overpull). */
    onReachStart?: () => void | Promise<void>;
    earlierLabel?: string;
    loadingLabel?: string;
    noEarlierLabel?: string;
    /** The list's tail went quiet: the page looks ahead once. */
    onPlanEnds?: () => void;
    endLabel?: string;
    endBeyond?: { label: string; onGo: () => void };
    /** A date's row opens the page's edit dialog. */
    onDateOpen?: (d: DateEvent) => void;
  }

  const L = appLocale();

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
    locale = appLocaleTag(),
    todayIso = dayKeyInTz(new Date().toISOString(), viewerTimeZone()),
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    statusLabel = (status: string) => statusWord(status, L),
    emptyLabel = t('planner.empty_month', L),
    noHourWord = t('planner.no_hour', L),
    toWord = t('planner.slip_to', L),
    gaps = [],
    gapLabel = (n: number) => `${n} ${t('planner.stat_free', L)}`,
    missingOf,
    castOf,
    noCastWord = (voice?: Voice) => t('planner.no_cast', L, undefined, voice),
    twoPlacesLabel = t('planner.agenda_two_places', L),
    stepsFoldLabel = (n: number) => `${t('planner.steps_n', L, { n })} ›`,
    onConfirm,
    pendingId = null,
    confirmLabel = t('planner.dec_confirm_short', L),
    awayUntilWord = t('planner.away_until', L),
    awayLeftWord = t('planner.away_left', L, { n: '{n}' }),
    awayLeftOneWord = t('planner.away_left_one', L),
    awayBackWord = t('planner.away_back', L),
    onDayOpen,
    decideCardLabel = t('planner.dec_card', L),
    notesByDay,
    stepsByDay,
    stepsLabel = t('planner.steps', L),
    onNoteCreate,
    onNoteDelete,
    noteFallbackLabel = t('planner.note_company', L),
    noteFallbackIsSpace = false,
    notePlaceholder = t('planner.note_placeholder', L),
    noteAddLabel = t('planner.note_add', L),
    noteDeleteLabel = t('planner.note_delete', L),
    onReachEnd,
    onReachStart,
    earlierLabel = t('planner.agenda_earlier', L),
    loadingLabel = t('planner.agenda_loading', L),
    noEarlierLabel,
    onPlanEnds,
    endLabel,
    endBeyond,
    onDateOpen,
  }: Props = $props();

  const viewerTz = viewerTimeZone();
  const phone = new MediaQuery(MOBILE_QUERY, false);

  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaces = $derived($workspacesQuery.data?.items ?? []);
  let slipCtx = $derived({
    workspaceSlug,
    workspaceSlugById: new Map(workspaces.map((w) => [w.id, w.slug])),
    workspaceTzById: new Map(workspaces.map((w) => [w.id, w.timezone])),
    workspaceModeById: new Map(workspaces.map((w) => [w.id, bookingModeOf(w)])),
    viewerTz,
    kindLabel: (k: string, voice?: Voice) => dateKindLabel(k, voice),
    statusLabel,
    viewerTimeLabel: (time: string) => t('planner.viewer_time', L, { time }),
    fallbackName: (voice: Voice) => t('create.type_performance', L, undefined, voice),
    dualTime,
    originOf: travelOriginFinder(performances, dates, viewerTz),
  });

  // ── What each day holds ──────────────────────────────────────────────
  type Row =
    | { kind: 'perf'; sort: string; perf: PerformanceEvent; slip: Slip }
    | { kind: 'date'; sort: string; date: DateEvent; slip: Slip };

  /** Timed first, by the clock; then the un-timed: the day reads forwards. */
  function byClock(a: Row, b: Row): number {
    if (!a.sort !== !b.sort) return a.sort ? -1 : 1;
    return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;
  }
  /* THE SORT KEY STAYS ON THE WIRE CLOCK: `9h` sorts above `20h30` by
     codepoint, so the printed hour cannot order the day. */
  /* A PERFORMANCE SAYS WHEN IT STARTS (the drawing): the get-in is the
     Day's business, and a row that printed it read as the show's hour. */
  function perfSort(p: PerformanceEvent): string {
    if (!p.start_at) return '';
    const tz = p.venue?.timezone ?? slipCtx.workspaceTzById.get(perfWorkspaceId(p) ?? '') ?? null;
    return dualTime(p.start_at, tz, viewerTz).primary;
  }
  function hourOf(row: Row): string | null {
    if (row.kind === 'date') return row.slip.time?.primary ?? null;
    return row.sort ? hourMark(row.sort) : null;
  }
  function dateSort(d: DateEvent): string {
    return d.all_day ? '' : dualTime(d.starts_at, d.venue?.timezone, viewerTz).primary;
  }

  let byDay = $derived.by(() => {
    const rows = new Map<string, Row[]>();
    const legs = new Map<string, Row[]>();
    const push = (m: Map<string, Row[]>, key: string, row: Row) => (m.get(key) ?? m.set(key, []).get(key)!).push(row);
    for (const p of performances) {
      push(rows, perfDayKey(p), { kind: 'perf', sort: perfSort(p), perf: p, slip: performanceSlip(p, slipCtx) });
    }
    for (const d of dates) {
      const row: Row = { kind: 'date', sort: dateSort(d), date: d, slip: dateSlip(d, slipCtx) };
      push(d.kind === 'travel_day' ? legs : rows, dateDayKey(d, viewerTz), row);
    }
    for (const list of rows.values()) list.sort(byClock);
    for (const list of legs.values()) list.sort(byClock);
    return { rows, legs };
  });
  let legById = $derived(new Map([...byDay.legs.values()].flat().map((r) => [r.slip.id, r])));

  let writingDay = $state<string | null>(null);
  /** A day gets a row when something is on it that is not a trip: a thing,
      a step, a call to make or a note — the margin is part of the day. */
  function kept(day: string): boolean {
    return Boolean(
      byDay.rows.get(day)?.length ||
        stepsByDay?.get(day)?.length ||
        decisionsByDay?.get(day)?.length ||
        notesByDay?.get(day)?.length ||
        writingDay === day,
    );
  }
  let items = $derived(
    agendaItems({ days, kept, legs: (d) => (byDay.legs.get(d) ?? []).map((r) => r.slip.id), gaps }),
  );
  let keptDays = $derived(items.flatMap((i) => (i.t === 'day' ? [i.day] : [])));

  /* THE LIST STOPS GROWING WHERE THE PLAN STOPS: a quiet last month turns
     the sentinel off and the page looks ahead once. */
  let endStop = $derived(quietTail(days, todayIso, (d) => kept(d) || byDay.legs.has(d)));
  $effect(() => {
    void days.length;
    if (endStop) onPlanEnds?.();
  });

  // ── The row's words ──────────────────────────────────────────────────
  /** The strong word is the city; the venue (or, for a date, its kind and
      title) goes under it. A slip never prints the same place twice. */
  function strong(sl: Slip): string {
    return sl.city ?? sl.name;
  }
  function under(row: Row): string | null {
    const sl = row.slip;
    if (row.kind === 'perf') return sl.city ? sl.name : null;
    const raw = dateKindLabel(row.date.kind === 'other' && row.date.label ? row.date.label : row.date.kind);
    const kind = raw.charAt(0).toUpperCase() + raw.slice(1);
    const what = sl.city ? sl.name : null;
    if (what && what.toLowerCase() !== raw.toLowerCase()) return `${kind} · ${what}`;
    // A date named by its kind («día libre») does not say it twice.
    return strong(sl).toLowerCase() === raw.toLowerCase() ? null : kind;
  }
  function legText(row: Row): string {
    const d = (row as Extract<Row, { kind: 'date' }>).date;
    const sl = row.slip;
    const dest = d.destination_city ?? d.city ?? sl.name;
    const where = sl.origin ? `${sl.origin} → ${dest}` : `${toWord} ${dest}`;
    return [dateKindLabel(d.kind), where, sl.time?.primary].filter(Boolean).join(' · ');
  }
  function held(sl: Slip): boolean {
    return sl.cert === 'hold' || sl.cert === 'proposed';
  }
  /** A person booked twice, or across an absence, on a firm row: the one
      clash the list draws (the drawing's «alguien está en dos sitios»). */
  function personClash(day: string): boolean {
    const list = clashesByDay?.get(day) ?? [];
    return (byDay.rows.get(day) ?? []).some(
      (r) =>
        r.kind === 'perf' &&
        performanceStatusFamily(r.perf.status) === 'confirmed' &&
        list.some((c) => c.event_ids?.includes(r.perf.id) && (c.severity === 'people' || c.severity === 'blackout')),
    );
  }

  function headWeekday(iso: string): string {
    return localeWeekdayShort(iso, locale).toLowerCase();
  }
  function monthName(iso: string): string {
    const raw = new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // ── The margin: calls to make, steps, my notes ───────────────────────
  function marginCards(day: string) {
    const decs = decisionsByDay?.get(day) ?? [];
    if (decs.length === 0) return [];
    const byId = new Map((byDay.rows.get(day) ?? []).filter((r) => r.kind === 'perf').map((r) => [r.perf.id, r]));
    return decs.map((d, i) => ({
      key: `${day}:${i}`,
      reason: d.reason,
      severity: d.severity,
      sides: d.ids.flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ id, name: r.slip.name, time: r.slip.time?.primary ?? null, project: r.slip.project }] : [];
      }),
    }));
  }
  /* THE MARGIN IS DRAWN WHEN THE WINDOW USES IT (ADR-167 § 2): one card,
     step or note in the window and the column is there for every day. */
  let marginUsed = $derived(
    writingDay !== null ||
      keptDays.some(
        (d) => (stepsByDay?.get(d)?.length ?? 0) > 0 || (decisionsByDay?.get(d)?.length ?? 0) > 0 || (notesByDay?.get(d)?.length ?? 0) > 0,
      ),
  );
  /** On a phone the day's steps are one line until it is opened. */
  const stepsOpen = new SvelteSet<string>();

  /* THE POST-IT'S WRITER (ADR-093): a day with one entry pre-fills that
     anchor, a day with several asks which, an empty day says where it falls. */
  type NoteAnchorOption = { key: string; label: string; performance_id?: string; date_id?: string };
  function noteAnchorOptions(day: string): NoteAnchorOption[] {
    return (byDay.rows.get(day) ?? []).map((r) =>
      r.kind === 'perf'
        ? { key: `p:${r.perf.id}`, label: r.slip.name, performance_id: r.perf.id }
        : { key: `d:${r.date.id}`, label: r.slip.name, date_id: r.date.id },
    );
  }
  let noteDraft = $state('');
  let noteAnchorKey = $state('');
  let notePending = $state(false);
  function openNoteWriter(day: string) {
    writingDay = day;
    noteDraft = '';
    noteAnchorKey = noteAnchorOptions(day)[0]?.key ?? '';
  }
  function closeNoteWriter() {
    writingDay = null;
    noteDraft = '';
    notePending = false;
  }
  async function saveNote(day: string) {
    if (!onNoteCreate || notePending) return;
    const body = noteDraft.trim();
    if (!body) return;
    const opt = noteAnchorOptions(day).find((o) => o.key === noteAnchorKey);
    notePending = true;
    const ok = await onNoteCreate({
      body,
      on_day: day,
      ...(opt?.performance_id ? { performance_id: opt.performance_id } : {}),
      ...(opt?.date_id ? { date_id: opt.date_id } : {}),
    });
    notePending = false;
    if (ok) closeNoteWriter();
  }
  function noteKeydown(e: KeyboardEvent, day: string) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveNote(day);
    } else if (e.key === 'Escape') {
      closeNoteWriter();
    }
  }

  // ── An absence is a sentence at the foot of the first row it covers ──
  let railItems = $derived([
    ...blackouts.map((b) => ({ from: b.from, to: b.to, label: b.label, tentative: b.tentative, deduced: undefined as string | undefined })),
    ...aways.map((a) => ({ from: a.from, to: a.to, label: a.label, tentative: false, deduced: deducedPhrase(a.deduced) })),
  ]);
  let railLabelDay = $derived(railItems.map((it) => keptDays.find((d) => d >= it.from && d <= it.to) ?? null));
  let awayWords = $derived({ until: awayUntilWord, back: awayBackWord, left: awayLeftWord, leftOne: awayLeftOneWord });
  function awayLines(day: string) {
    return railItems.flatMap((item, i) =>
      coversDay(day, item.from, item.to) && railLabelDay[i] === day
        ? [
            {
              key: `${i}:${day}`,
              who: item.label,
              rest: awayRest(day, item.to, awayWords, (iso) => localeDayMonth(iso, locale)) + (item.deduced ? ` · ${item.deduced}` : ''),
              tentative: Boolean(item.tentative),
            },
          ]
        : [],
    );
  }

  /* `Now` RESETS THE LIST: the page snaps the span's start forward to today
     (loading only ever moves it back), and the past's line hides again. */
  let prevStart = '';
  $effect(() => {
    const start = days[0] ?? '';
    if (prevStart && start > prevStart) earlierRevealed = false;
    prevStart = start;
  });

  /* ── THE LIST LOADS FORWARDS BY ITSELF, AND BACKWARDS ON PURPOSE ──────
     One sentinel below the last row asks for another month 800px early.
     Backwards is an ACT (ADR of 2026-08-02): the quiet line at the head, or
     the overpull — already at the very top, a second deliberate pull. */
  let endSentinel = $state<HTMLElement>();
  const REACH_END = 800;
  function watch(el: HTMLElement | undefined, fire: (() => void) | undefined, reach: number) {
    if (!el || !fire) return;
    const io = new IntersectionObserver(
      () => {
        const r = el.getBoundingClientRect();
        if (r.bottom > -reach && r.top < window.innerHeight + reach) fire();
      },
      { rootMargin: `${reach}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }
  $effect(() => {
    void days.length;
    return watch(endSentinel, onReachEnd, REACH_END);
  });

  /* THE OVERPULL: the flick that arrives at the top does not count (its
     momentum tail keeps emitting); a new gesture after a quiet gap arms it,
     and the load fires when the wheel goes quiet — a wheel has no mouseup. */
  const OVERPULL_PX = 120;
  const GESTURE_GAP_MS = 160;
  const RELEASE_QUIET_MS = 400;
  let pullArmed = false;
  let pullAcc = 0;
  let lastPullAt = 0;
  let pullTimer: ReturnType<typeof setTimeout> | undefined;
  let earlierRevealed = $state(false);
  let pullPending = $state(false);
  let pullLoading = $state(false);
  async function fireEarlier() {
    if (!onReachStart || pullLoading) return;
    pullLoading = true;
    try {
      await onReachStart();
    } finally {
      pullLoading = false;
    }
  }
  $effect(() => {
    if (!onReachStart) return;
    const release = () => {
      if (!pullPending) return;
      pullPending = false;
      pullArmed = false;
      pullAcc = 0;
      void fireEarlier();
    };
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const gap = performance.now() - lastPullAt;
      lastPullAt = performance.now();
      if (dy >= 0 || window.scrollY > 0) {
        pullArmed = false;
        pullAcc = 0;
        if (pullPending) {
          pullPending = false;
          clearTimeout(pullTimer);
        }
        return;
      }
      if (!pullArmed) {
        if (gap < GESTURE_GAP_MS) return;
        pullArmed = true;
        pullAcc = 0;
        earlierRevealed = true;
      } else if (gap > GESTURE_GAP_MS && !pullPending) {
        pullAcc = 0;
      }
      pullAcc += -dy;
      if (pullAcc >= OVERPULL_PX) pullPending = true;
      if (pullPending) {
        clearTimeout(pullTimer);
        pullTimer = setTimeout(release, RELEASE_QUIET_MS);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      clearTimeout(pullTimer);
    };
  });
</script>

<div class="ag" class:ag--loading={loading} class:ag--bare={!marginUsed} data-help-step="planner-agenda">
  {#if onReachStart}
    <button
      type="button"
      class="ag__earlier"
      class:ag__earlier--in={earlierRevealed}
      disabled={pullLoading}
      onclick={() => void fireEarlier()}>{pullPending || pullLoading ? loadingLabel : earlierLabel}</button
    >
  {:else if noEarlierLabel}
    <p class="ag__end">{noEarlierLabel}</p>
  {/if}

  {#if items.length === 0 && !loading}
    <p class="ag__empty">{emptyLabel}</p>
  {/if}

  {#each items as it (it.key)}
    {#if it.t === 'month'}
      <h2 class="ag__month" data-month={it.day.slice(0, 7)}>
        {monthName(it.day)} <small class="ag__month-yr">{it.day.slice(0, 4)}</small>
      </h2>
    {:else if it.t === 'free'}
      <p class="ag__free" data-day={it.day} data-testid="agenda-free">{gapLabel(it.nights)}</p>
    {:else if it.t === 'leg'}
      {@const leg = legById.get(it.id)}
      {#if leg}
        <svelte:element
          this={onDateOpen ? 'button' : 'p'}
          class="ag__leg"
          data-day={it.day}
          data-testid="agenda-leg"
          {...onDateOpen && leg.kind === 'date' ? { type: 'button', onclick: () => onDateOpen?.(leg.date) } : {}}
        >
          {#if leg.slip.project}<IdentityMark
              mini
              accent={accentVarFor(leg.slip.project)}
              name={leg.slip.project.name}
              initials={leg.slip.project.initials}
            />{/if}
          <span>{legText(leg)}</span>
        </svelte:element>
      {/if}
    {:else}
      {@const day = it.day}
      {@const rows = byDay.rows.get(day) ?? []}
      {@const clashed = personClash(day)}
      {@const steps = stepsByDay?.get(day) ?? []}
      {@const cards = marginCards(day)}
      {@const lone =
        steps.length === 0 && cards.length === 0 && !notesByDay?.get(day)?.length && writingDay !== day}
      <section
        class="ag__day"
        class:ag__day--lone={lone}
        class:ag__day--week={it.weekTurn}
        class:ag__day--today={day === todayIso}
        data-day={day}
        data-testid="agenda-day"
      >
        <svelte:element
          this={onDayOpen ? 'button' : 'header'}
          class="ag__head"
          {...onDayOpen ? { type: 'button', onclick: () => onDayOpen?.(day) } : {}}
        >
          <span class="ag__wd">{headWeekday(day)}</span>
          <span class="ag__num">{Number(day.slice(8, 10))}</span>
        </svelte:element>
        <div class="ag__rows" class:ag__rows--clash={clashed}>
          {#each rows as row (row.slip.id)}
            {@const sl = row.slip}
            {@const miss = row.kind === 'perf' ? missingOf?.(row.perf) : undefined}
            {@const sub = under(row)}
            {@const cast = row.kind === 'perf' && !phone.current ? (castOf?.(row.perf) ?? null) : null}
            {@const open = row.kind === 'date' && onDateOpen ? () => onDateOpen?.(row.date) : undefined}
            <div
              class="ag__it"
              class:ag__it--held={held(sl)}
              class:ag__it--gone={sl.cert === 'released'}
              data-family={sl.cert}
              data-testid="agenda-row"
              title={sl.title}
            >
              <span class="ag__mark"
                >{#if sl.project}<IdentityMark
                    mini
                    accent={accentVarFor(sl.project)}
                    name={sl.project.name}
                    initials={sl.project.initials}
                  />{/if}</span
              >
              <svelte:element
                this={sl.href ? 'a' : open ? 'button' : 'span'}
                class="ag__what"
                {...sl.href ? { href: sl.href } : open ? { type: 'button', onclick: open } : {}}
              >
                <span class="ag__city">{strong(sl)}{#if held(sl)}?{/if}</span>
                {#if sub || miss?.words.length}
                  <span class="ag__ven"
                    >{sub ?? ''}{#each miss?.words ?? [] as w, wi (w.text)}{#if sub || wi}{' '}{/if}<span class="ag__miss"
                        >{#if sub || wi}·&nbsp;{/if}<span class="missing-word" class:missing-word--urgent={w.urgent} data-testid="agenda-missing"
                          >{#if w.dot}<i class="missing-dot missing-dot--s" aria-hidden="true"></i>{/if}{w.text}</span
                        ></span
                      >{/each}</span
                  >
                {/if}
                <!-- WHO GOES, the third line (Marco, 16-11; `styles/cast.css`),
                     on a desktop: the phone keeps the row to two lines. -->
                {#if cast && row.kind === 'perf'}
                  <span class="ag__cast cast-line" class:cast-line--none={cast.length === 0}
                    >{cast.length > 0 ? cast.join(' · ') : noCastWord(tradeFor(perfWorkspaceId(row.perf)))}</span
                  >
                {/if}
              </svelte:element>
              <span class="ag__hh">
                {#if hourOf(row)}{hourOf(row)}{:else if miss?.noTime}<span class="missing-word" data-testid="agenda-missing"
                    >{noHourWord}</span
                  >{/if}
                {#if row.kind === 'perf' && onConfirm && held(sl)}
                  <button
                    type="button"
                    class="ag__do"
                    disabled={pendingId === row.perf.id}
                    onclick={() => onConfirm?.(row.perf.id)}>{confirmLabel}</button
                  >
                {/if}
              </span>
            </div>
          {/each}
          {#if clashed}<p class="ag__clash">{twoPlacesLabel}</p>{/if}
          {#each awayLines(day) as a (a.key)}
            <p class="away-line ag__away" class:away-line--tent={a.tentative}>
              <span class="away-line__who">{a.who}</span>{a.rest}
            </p>
          {/each}
        </div>
        <!-- A div, not an <aside>: a landmark inside <main> nobody reaches (axe). -->
        <div class="ag__marg">
          {#if steps.length > 0}
            {#if phone.current && !stepsOpen.has(day)}
              <button type="button" class="ag__fold" aria-expanded="false" onclick={() => stepsOpen.add(day)}
                >{stepsFoldLabel(steps.length)}</button
              >
            {:else}
              <PlannerSteps {steps} label={stepsLabel} />
            {/if}
          {/if}
          {#each cards as card (card.key)}
            <div class="ag__card" data-severity={card.severity}>
              <p class="ag__card-eyebrow">{decideCardLabel}</p>
              <p class="ag__card-say">{card.reason}</p>
              {#each card.sides as side (side.id)}
                <p class="ag__card-side">
                  {#if side.project}<IdentityMark
                      mini
                      accent={accentVarFor(side.project)}
                      name={side.project.name}
                      initials={side.project.initials}
                    />{/if}
                  <span class="ag__card-venue">{side.name}</span>
                  {#if side.time}<span class="ag__card-time">{side.time}</span>{/if}
                </p>
              {/each}
            </div>
          {/each}
          {#each notesByDay?.get(day) ?? [] as n (n.id)}
            <div class="ag__note">
              <p class="ag__note-body">{n.body}</p>
              {#if onNoteDelete}
                <button type="button" class="ag__note-x" aria-label={noteDeleteLabel} onclick={() => onNoteDelete?.(n.id)}
                  >×</button
                >
              {/if}
            </div>
          {/each}
          {#if onNoteCreate}
            {#if writingDay === day}
              {@const opts = noteAnchorOptions(day)}
              <div class="ag__note ag__note--edit">
                <!-- svelte-ignore a11y_autofocus — the writer exists because
                     the reader just asked to write; focus IS the answer. -->
                <textarea
                  class="ag__note-input"
                  rows="2"
                  autofocus
                  placeholder={notePlaceholder}
                  bind:value={noteDraft}
                  disabled={notePending}
                  onkeydown={(e) => noteKeydown(e, day)}
                ></textarea>
                {#if opts.length > 1}
                  <select class="ag__note-anchor" bind:value={noteAnchorKey} disabled={notePending}>
                    {#each opts as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
                    <option value="" class:ag__note-anchor--space={noteFallbackIsSpace}>{noteFallbackLabel}</option>
                  </select>
                {:else}
                  <p class="ag__note-anchorword" class:ag__note-anchor--space={!opts[0] && noteFallbackIsSpace}>
                    {opts[0]?.label ?? noteFallbackLabel}
                  </p>
                {/if}
              </div>
            {:else if !phone.current}
              <!-- Not on a phone (ADR-236): «+ fecha» above is the one «+». -->
              <button type="button" class="ag__note-add" aria-label={noteAddLabel} onclick={() => openNoteWriter(day)}
                >＋</button
              >
            {/if}
          {/if}
        </div>
      </section>
    {/if}
  {/each}

  {#if endLabel}
    <p class="ag__end">
      {endLabel}{#if endBeyond}{' · '}<button type="button" class="ag__beyond" onclick={endBeyond.onGo}
          >{endBeyond.label} ›</button
        >{/if}
    </p>
  {:else if onReachEnd && !endStop}
    <div class="ag__sentinel" bind:this={endSentinel} aria-hidden="true"></div>
  {/if}
</div>

<style>
  @layer components {
    /* THE LIST AND ITS MARGIN. The reading column keeps the drawing's measure
       (`--agenda-measure`): where the Day will open beside it (ADR-209 § 6),
       the margin holds the day's steps, calls and notes meanwhile. */
    .ag {
      --ag-margin: 15rem;
      display: grid;
      grid-template-columns: minmax(0, var(--agenda-measure)) var(--ag-margin);
      align-content: start;
      transition: opacity var(--transition);
    }
    .ag > * {
      grid-column: 1;
      min-inline-size: 0;
    }
    /* EVERY RULE OF THE LIST IS ONE MEASURE: the month's and the free run's
       run to the margin's edge, as the days' do. */
    .ag > .ag__month,
    .ag > .ag__free {
      grid-column: 1 / -1;
    }
    .ag--bare {
      --ag-margin: 0;
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

    /* «↑ earlier months»: hidden and heightless until the overpull summons
       it or the keyboard focuses it; never display:none. */
    .ag__earlier {
      display: block;
      inline-size: 100%;
      padding-block: var(--space-xs);
      opacity: 1;
      border: 0;
      background: none;
      text-align: center;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
      cursor: pointer;
      transition: color var(--transition);
    }
    .ag__earlier--in,
    .ag__earlier:focus-visible {
      color: var(--text-color);
    }
    .ag__earlier:hover {
      color: var(--text-color);
    }
    .ag__earlier:disabled {
      cursor: default;
    }
    .ag__end {
      margin: 0;
      padding-block: var(--space-s);
      text-align: center;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ag__beyond {
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      color: var(--text-color);
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    /* A landing (`Now`, ‹ ›) goes under the stuck title row. */
    .ag__day,
    .ag__month,
    .ag__leg,
    .ag__free {
      scroll-margin-block-start: var(--month-axis-top, calc(var(--header-height) + 3rem));
    }

    /* The month turn: its name, as the title says it. */
    .ag__month {
      margin: var(--space-l) 0 0;
      padding-block-end: var(--space-2xs);
      border-block-end: var(--line-hairline) solid var(--month-rule);
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-weight: 400;
      color: var(--text-color);
    }
    .ag__month-yr {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-l);
      color: var(--text-muted);
    }

    /* ── THE DAY · its date, its things, its margin ── */
    .ag__day {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .ag__day > :not(.ag__marg) {
      grid-column: 1;
    }
    /* The date and the things share the reading column. */
    .ag__day {
      --ag-date: 4.5rem;
    }
    .ag__head,
    .ag__rows {
      grid-row: 1;
    }
    .ag__head {
      display: flex;
      flex-direction: column;
      align-self: start;
      inline-size: var(--ag-date);
      padding: var(--space-s) 0;
      border: 0;
      background: none;
      text-align: start;
      color: inherit;
    }
    button.ag__head {
      cursor: pointer;
    }
    .ag__rows {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      margin-inline-start: var(--ag-date);
      padding-block: var(--space-s);
      min-inline-size: 0;
    }
    /* THE WEEK IS A RULE (ADR-209 § 2): stronger above its first row. */
    .ag__day--week {
      border-block-start: var(--line-thin) solid var(--month-rule);
    }
    .ag__wd {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .ag__num {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      line-height: 1;
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
    }
    .ag__day--today .ag__wd,
    .ag__day--today .ag__num {
      color: var(--today-ink);
      font-weight: var(--today-weight);
    }
    button.ag__head:hover .ag__num {
      text-decoration: underline;
      text-decoration-thickness: var(--line-hairline);
      text-underline-offset: 4px;
    }

    /* ── ONE THING · monogram, the city over the venue, the hour ── */
    .ag__it {
      display: grid;
      grid-template-columns: calc(var(--mark-mini) * 5 / 3) minmax(0, 1fr) auto;
      column-gap: var(--space-s);
      align-items: baseline;
    }
    .ag__mark {
      display: flex;
      align-self: start;
      padding-block-start: var(--space-2xs);
    }
    .ag__what {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      text-align: start;
      color: inherit;
      text-decoration: none;
    }
    button.ag__what {
      cursor: pointer;
    }
    .ag__city {
      font-family: var(--font-display);
      font-size: var(--text-l);
      line-height: 1.15;
      color: var(--text-color);
      overflow-wrap: anywhere;
    }
    a.ag__what:hover .ag__city,
    button.ag__what:hover .ag__city {
      text-decoration: underline;
      text-decoration-thickness: var(--line-hairline);
      text-underline-offset: 3px;
    }
    .ag__ven {
      font-size: var(--text-s);
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }
    .ag__cast {
      margin-block-start: var(--space-2xs);
    }
    /* The «·» travels with its word: when the amber wraps at 390 px the
       separator goes down with it instead of hanging at the end of the
       venue («La Fàbrica ·»). The break is the plain space before it. */
    .ag__miss {
      white-space: nowrap;
    }
    .ag__hh {
      display: flex;
      flex-direction: column;
      align-items: end;
      gap: var(--space-2xs);
      font-family: var(--font-mono);
      font-size: var(--text-s);
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    /* AN OPTION IS A QUESTION: the city leans and quiets, with its «?». */
    .ag__it--held .ag__city {
      font-style: italic;
      color: var(--text-muted);
    }
    .ag__it--gone .ag__city {
      color: var(--text-faint);
      text-decoration: line-through;
    }
    /* SOMEBODY IN TWO PLACES: a red rule down the day's things and the
       sentence under them. The one clash that takes red (ADR-095). */
    .ag__rows--clash {
      padding-inline-start: var(--space-s);
      border-inline-start: var(--line-thin) solid var(--danger);
    }
    .ag__clash {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-xl);
      text-transform: uppercase;
      color: var(--danger);
    }
    .ag__away {
      padding: 0;
    }

    /* A TRIP IS A LEG BETWEEN TWO DAYS: a dashed thread down the date
       column and the way in mono, in the margin's voice. */
    .ag__leg {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      margin: 0 0 0 calc(var(--space-m));
      padding: var(--space-xs) 0 var(--space-xs) calc(var(--ag-date) - var(--space-m));
      border: 0;
      border-inline-start: var(--line-thin) dashed var(--text-faint);
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-muted);
      text-align: start;
    }
    button.ag__leg {
      cursor: pointer;
    }
    button.ag__leg:hover {
      color: var(--text-color);
    }
    /* Three free nights or more: one line, where they begin. */
    .ag__free {
      margin: 0;
      padding: var(--space-s) 0 var(--space-s) var(--ag-date);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ag__free,
    .ag__leg {
      --ag-date: 4.5rem;
    }

    /* THE VERB WAITS TO BE NEEDED, under the pointer. */
    .ag__do {
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--duration-fast);
    }
    .ag__it:hover .ag__do,
    .ag__do:focus-visible {
      opacity: 1;
    }
    .ag__do:hover {
      color: var(--text-color);
    }
    .ag__do:disabled {
      cursor: default;
      opacity: 0.4;
    }

    /* ── THE MARGIN ── */
    .ag__marg {
      position: relative;
      grid-column: 2;
      grid-row: 1;
      padding: var(--space-s) 0 var(--space-s) var(--space-s);
      border-inline-start: var(--line-hairline) solid var(--border-color-dark);
    }
    /* A margin that holds only the `＋` takes no column: it waits at the foot
       of the date, in a row of its own under the date's, which the things
       span. Pinned to the day's foot instead, a day of one or two lines (a
       phone's, always) put it on the number (Marco, 17-11). */
    .ag__day--lone > .ag__rows {
      grid-row: 1 / span 2;
    }
    .ag__day--lone > .ag__marg {
      grid-column: 1;
      grid-row: 2;
      align-self: end;
      justify-self: start;
      /* It borrows the date's air below the number: the day grows by the
         ＋ alone, and only where the things are shorter than the date. */
      margin-block-start: calc(-1 * var(--space-s));
      padding: 0;
      border: 0;
    }
    .ag__fold {
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--danger);
      cursor: pointer;
    }
    .ag__card {
      padding-block-start: var(--space-2xs);
      border-block-start: var(--line-thin) solid var(--info);
    }
    .ag__card[data-severity='people'] {
      border-block-start-color: var(--danger);
    }
    .ag__card + .ag__card,
    .ag__card + .ag__note {
      margin-block-start: var(--space-s);
    }
    .ag__card-eyebrow {
      margin: 0 0 var(--space-2xs);
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-xl);
      text-transform: uppercase;
      color: var(--info);
    }
    .ag__card[data-severity='people'] .ag__card-eyebrow {
      color: var(--danger);
    }
    .ag__card-say {
      margin: 0 0 var(--space-xs);
      font-size: var(--text-s);
      line-height: 1.35;
      color: var(--text-color);
    }
    .ag__card-side {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      margin: 0 0 var(--space-2xs);
      min-inline-size: 0;
    }
    .ag__card-venue {
      font-size: var(--text-s);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ag__card-time {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* THE POST-IT (ADR-093): serif italic, a hand in the margin. */
    .ag__note {
      position: relative;
      padding-block: var(--space-2xs);
    }
    .ag__note-body {
      margin: 0;
      padding-inline-end: var(--space-s);
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      line-height: 1.4;
      color: var(--text-muted);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .ag__note-x {
      position: absolute;
      inset-inline-end: 0;
      inset-block-start: var(--space-2xs);
      padding: 0;
      border: 0;
      background: none;
      font-size: var(--text-xs);
      line-height: 1;
      color: var(--text-faint);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--duration-fast);
    }
    .ag__note:hover .ag__note-x,
    .ag__note-x:focus-visible {
      opacity: 1;
    }
    .ag__note-x:hover {
      color: var(--text-color);
    }
    .ag__note-input {
      display: block;
      inline-size: 100%;
      padding: 0;
      border: 0;
      background: none;
      resize: none;
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      line-height: 1.4;
      color: var(--text-color);
    }
    .ag__note-input:focus {
      outline: none;
    }
    .ag__note-input::placeholder {
      color: var(--text-faint);
    }
    .ag__note-anchor,
    .ag__note-anchorword {
      margin: var(--space-2xs) 0 0;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-xl);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .ag__note-anchor {
      cursor: pointer;
      max-inline-size: 100%;
    }
    .ag__note-anchor--space {
      text-transform: none;
    }
    .ag__note-add {
      min-inline-size: var(--touch-target);
      min-block-size: var(--touch-target);
      padding: 0;
      border: 0;
      background: none;
      font-size: var(--text-s);
      line-height: 1;
      color: var(--text-faint);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--duration-fast);
    }
    .ag__day:hover .ag__note-add,
    .ag__note-add:focus-visible {
      opacity: 1;
    }
    .ag__note-add:hover {
      color: var(--text-color);
    }
    .ag__sentinel {
      block-size: var(--line-hairline);
    }

    @media (max-width: 47.999rem) {
      /* No margin column on a phone: the annotation falls under its day. */
      .ag {
        --ag-margin: 0;
      }
      .ag__day,
      .ag__free,
      .ag__leg {
        --ag-date: 3.5rem;
      }
      .ag__marg {
        grid-column: 1;
        grid-row: 2;
        padding: 0 0 var(--space-s) var(--ag-date);
        border: 0;
      }
      .ag__marg:empty {
        display: none;
      }
      .ag__note-add {
        opacity: 1;
      }
    }
  }
</style>
