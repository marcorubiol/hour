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
   * $lib/month-events; everything that happens draws as `Slip`, and the
   * clash popover is `ClashCard`. There is no second card grammar left in
   * this file to fork from the first.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { addDaysIso, dayKeyInTz, isoWeek, monthGrid, assignBandLanes } from '$lib/planner';
  import { weekdayLabels, localeMonthShort } from '$lib/datetime';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import type { IdentitySibling } from '$lib/utils/identity';
  import IdentityQuickPanel from '$lib/components/IdentityQuickPanel.svelte';
  import { performanceStatusFamily } from '$lib/performance';
  import { dualTime } from '$lib/datetime';
  import {
    performanceSlip,
    dateSlip,
    type Slip as SlipVM,
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
  import ClashCard from '$lib/components/planner/ClashCard.svelte';
  import Slip from '$lib/components/planner/Slip.svelte';

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
    /** When given, date chips open — the page owns the edit dialog. */
    onDateOpen?: (d: DateEvent) => void;
    /**
     * The day NUMBER is a door to that day's own drawing.
     *
     * The month answers «what is this month shaped like»; the moment you have
     * found the day you were looking for, the next question is always «what
     * does that day look like», and the number is the thing your eye is
     * already on. Out-of-month numbers stay inert — they are orientation, and
     * the sheet does not own days it is not drawing.
     */
    onDayOpen?: (isoDate: string) => void;
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
    /** «hasta 15 jul · 10 días» / «desde 6 jul · 10 días» — la frase que una
        mitad de tanda le debe a la otra. */
    runUntilLabel?: (isoDate: string, days: number) => string;
    runFromLabel?: (isoDate: string, days: number) => string;
    /** Qué dice el número del día, que ES la puerta al Día. Sin nombre, un
        número en una esquina no se lee como control ni lo anuncia un lector
        de pantalla. */
    openDayLabel?: (isoDate: string) => string;
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
    /** «more» — the word after the +N door on a full cell. */
    moreLabel?: string;
    /** «week 27» — the gutter's own label. */
    isoWeekLabel?: (n: number) => string;
    /** «let go» — the word a released slip carries. */
    releasedLabel?: string;
    /** «expires Mon» — the deadline phrase, given the decide-by ISO day. */
    expiresLabel?: (isoDay: string) => string;
    /** The kind word a band carries: an absence says «away», a tour says
        «on tour». They are two different claims and never the same word —
        an absence is a fact somebody wrote down, a tour is inferred. */
    awayWord?: string;
    tourWord?: string;
    /** «until 20 jul» — a band that opened before this week. */
    untilLabel?: (day: string) => string;
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
    onDateOpen,
    onDayOpen,
    blackouts = [],
    aways = [],
    clashesByDay,
    locale = 'en-GB',
    dateKindLabel = (kind: string) => kind.replace(/_/g, ' '),
    createLabel = (iso: string) => `New performance on ${iso}`,
    openDayLabel = (iso: string) => `Open ${iso}`,
    runUntilLabel = (iso: string, n: number) => `until ${iso} · ${n} days`,
    runFromLabel = (iso: string, n: number) => `from ${iso} · ${n} days`,
    stateLabel = (status: string) => EN_STATE_WORDS[status] ?? null,
    readinessItems = [
      { key: 'hotel', label: 'hotel' },
      { key: 'technical', label: 'technical' },
    ],
    moreLabel = 'more',
    isoWeekLabel = (n: number) => `week ${n}`,
    releasedLabel = 'let go',
    expiresLabel = (iso: string) => `expires ${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
    awayWord = 'away',
    tourWord = 'on tour',
    untilLabel = (day: string) => `until ${day}`,
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

  /** The state line: released says `let go`, a hold says its rank and its
      deadline. A FIRM SHOW AND A PROPOSED ONE BOTH SAY NOTHING — the geometry
      already carries them, and the `?` on the kind word carries the option. */
  function slipState(sl: SlipVM): string | null {
    if (sl.cert === 'released') return releasedLabel;
    if (sl.cert === 'hold' && sl.hold) {
      const rank = sl.hold.rank ? stateLabel(`hold_${sl.hold.rank}`) : stateLabel('hold');
      if (!sl.hold.expires) return rank;
      // THE MONTH SAYS THE WEEKDAY, NOT THE DATE. `hold · expires 25 jun` is
      // 21 characters in a 76px box: it wrapped to two lines and then printed
      // `HOLD · EXPIRES 25/0…`, clipping the one thing on a held card that is
      // not a maybe. `hold · Thu` is nine, fits on one line, and is the more
      // useful reading anyway — a deadline inside the next week is a weekday,
      // and the full date is on the card and in the title.
      return `${rank} · ${expiresLabel(sl.hold.expires)}`;
    }
    return null;
  }

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

  /* ── ONE OBJECT, NOT TWO CHIPS (ADR-095 §0) ────────────────────────────
     The cell renders `Slip`, and both primitives reach it through the same
     normaliser. `PerfChip` and `DateChip` are both gone — the run of days
     that was `DateChip`'s last excuse is a band now, not a stack of chips.

     THE CELL CAPS AT THREE, and the rest becomes `+N more`. Without the cap
     the row height is set by the fullest day, and that day can hold nine
     things — so a quiet week could never look short, which is half of what
     the month is for. */
  let slipCtx = $derived({
    workspaceSlug,
    workspaceSlugById,
    workspaceTzById,
    workspaceModeById,
    viewerTz,
    kindLabel: (k: string) => dateKindLabel(k),
    dualTime,
    originOf: travelOrigin,
  });

  /* WHERE YOU WERE IS WHERE THE SHEET LAST PUT YOU (see `Slip.origin`).
     The nearest event BEFORE this travel day that names a city. It reads the
     whole loaded window, not the visible month, so a leg on the 1st still
     knows it left from wherever the 28th was. Null when nothing precedes —
     an absent origin is a real answer and stays absent. */
  let placedDays = $derived.by(() => {
    const out: Array<{ day: string; city: string; project: string | null }> = [];
    for (const p of performances) {
      const city = p.venue?.city ?? p.city;
      if (city) out.push({ day: perfDayKey(p), city, project: p.project?.id ?? null });
    }
    for (const d of dates) {
      // A travel day names where it is GOING, so it cannot say where you were.
      if (d.kind === 'travel_day' || !d.city) continue;
      out.push({ day: dateDayKey(d, viewerTz), city: d.city, project: d.project?.id ?? null });
    }
    return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  });
  function travelOrigin(d: DateEvent): string | null {
    const day = dateDayKey(d, viewerTz);
    // THE PROJECT'S OWN LAST PLACE, not the sheet's. Two companies share this
    // calendar: on a night MaMeMi is in London and Última òrbita is in
    // Barcelona, «where were you» has two answers and only one of them is
    // this leg's. Unscoped, MaMeMi's flight home read as leaving from the
    // city it was flying to, and the line simply vanished.
    const mine = d.project?.id ?? null;
    let best: string | null = null;
    for (const p of placedDays) {
      if (p.day >= day) break;
      if (mine && p.project !== mine) continue;
      best = p.city;
    }
    return best && best !== (d.city ?? null) ? best : null;
  }
  const CELL_CAP = 3;

  /**
   * The cell's contents in ONE ordered list, because a cap that only counts
   * gigs is a cap that lets a day with four rehearsals grow anyway.
   *
   * Order is the running order of the day: things with an hour first, by the
   * clock; things without an hour after them. A hold nobody has timed is the
   * normal case, not an error, so it sorts last rather than to 00:00.
   *
   * A multi-day SERIES still renders through `DateChip` — it is a band, not a
   * slip, and turning it into one element that spans columns is the next step.
   */
  function cellSlips(
    perfs: PerformanceEvent[],
    groups: DateEvent[][],
  ): Array<{
    key: string;
    slip: SlipVM;
    dateGroup?: DateEvent[];
    dateRow?: DateEvent;
    sortAt: string;
  }> {
    const out: Array<{
      key: string;
      slip: SlipVM;
      dateGroup?: DateEvent[];
      dateRow?: DateEvent;
      sortAt: string;
    }> = [];
    for (const p of perfs) {
      // Una tanda salió de la celda: ahora es la banda de la semana, dibujada
      // UNA vez sobre los días que cubre. Sin esto se dibujaría dos veces.
      // Y la ley que esto NO rompe: dos funciones DISTINTAS el mismo día
      // siguen siendo dos cards — solo se va la que comparte serie.
      if (isRun(p.series_id)) continue;
      const slip = performanceSlip(p, slipCtx);
      out.push({ key: p.id, slip, sortAt: perfInstant(p) ?? '~' });
    }
    for (const g of groups) {
      // A multi-day run left the cell: it is the week's band now, drawn once
      // over the days it covers with each day's own hours under it.
      if (isSeriesBand(g)) continue;
      out.push({
        key: g[0].id,
        slip: dateSlip(g[0], slipCtx),
        dateRow: g[0],
        sortAt: g[0].all_day ? '~' : g[0].starts_at,
      });
    }
    // `~` sorts after every digit, so the un-timed fall to the bottom without
    // a second comparator and without pretending to be midnight.
    //
    // NOT `localeCompare`, and this is not a style preference: locale collation
    // reorders punctuation, so `'~'.localeCompare('2')` is -1 and every un-timed
    // hold jumped to the TOP of its day, above the gig that actually has an
    // hour. Caught on screen, 2026-07-31. These are ISO strings and a sentinel;
    // codepoint order is the order we mean.
    return out.sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : 0));
  }

  /* ── WHICH TWO COLLIDE ────────────────────────────────────────────────
     `ClashVM.event_ids` names the pair. It was added to the VM for exactly
     this and then never read: the month could say THAT something clashed —
     the `!` on the day number — and never which two, which is the half of the
     message you can act on.

     A RULE THAT POINTS AT TWO AND SHOWS ONE IS A LIE. Narrow the scope so
     that only one half of the pair is on the sheet and the rule leaves with
     it; the mark on the day number stays, because it never asked the filter,
     and it is the honest thing left to say. */
  function clashFlags(
    lead: Array<{ slip: SlipVM }>,
    clashes: ClashVM[],
  ): { on: boolean[]; hard: boolean[]; people: boolean[] } {
    const ids = new Set(clashes.flatMap((c) => c.event_ids));
    const on = lead.map((e) => ids.has(e.slip.id));
    const none = on.map(() => false);
    if (on.filter(Boolean).length < 2) return { on: none, hard: none, people: none };
    /* THE RULE SPEAKS ABOUT THE CARD IT IS DRAWN ON. Solid when THIS thing is
       real, dashed while it is still an option.

       Two wrong answers came before it. The first asked «is anything on this
       date confirmed?», so a day holding one real gig drew every other
       collision on it as settled — two holds colliding with each other were
       reported as a hard problem because a third, unrelated thing beside them
       was inked. The second asked «is the OTHER half of the pair confirmed?»,
       which inverted the day: the confirmed gig came out dashed and the two
       holds around it came out solid.

       The answer Marco asked for is the one the rest of this drawing already
       uses: geometry states the certainty, per object. A solid red rule on a
       dashed-edged option card is two claims about one thing. */
    const hard = lead.map((e, i) => on[i] && e.slip.cert === 'confirmed');
    /* RED IS BOUND TO THE MARK'S OWN TEST. The `!` on the day number goes red
       for `people` and `blackout` — a real human double-booked, or booked
       across an absence they wrote down — and the rule beside it must use the
       same test or the same day prints two levels of alarm about one fact.
       That contradiction is exactly what Marco read on 9 July: a blue mark
       next to a red rule. */
    const people = lead.map(
      (e, i) =>
        on[i] &&
        clashes.some(
          (c) =>
            (c.severity === 'people' || c.severity === 'blackout') &&
            c.event_ids.includes(e.slip.id),
        ),
    );
    return { on, hard, people };
  }

  /** verb-cal only while the clock is actually running (ADR-080 §2). */
  function isUrgentHold(sl: SlipVM): boolean {
    return Boolean(sl.hold?.expires && sl.hold.expires <= todayIso);
  }

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
    const add = (sid: string | null | undefined, day: string) => {
      if (!sid) return;
      (m.get(sid) ?? m.set(sid, new Set<string>()).get(sid)!).add(day);
    };
    for (const d of dates) add(d.series_id, dateDayKey(d, viewerTz));
    // ADR-084 §1 — las funciones también duran varios días desde
    // `20260829100000`. La cuenta es la misma: una tanda es una serie que
    // toca dos días o más, sea de ensayos o de bolos.
    for (const p of performances) add(p.series_id, perfDayKey(p));
    return m;
  });

  /** ¿Esta serie es una tanda de verdad? Dos días o más. */
  function isRun(sid: string | null | undefined): boolean {
    return Boolean(sid && (seriesDays.get(sid)?.size ?? 0) >= 2);
  }

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

  /** True while these rows are a real multi-day run — the test the cell uses
      to hand the group to the band instead of drawing it as a slip. */
  function isSeriesBand(g: DateEvent[]): boolean {
    return isRun(g[0]?.series_id);
  }

  /* ── A RUN OF DAYS IS ONE BAND, NOT N LOOSE CARDS ──────────────────────
     A block of rehearsals is not one thing lasting five days: it is five
     entries that share a name, each with its own real hours (the 8th is
     10–18, the 10th is 10–13). Repeating the same empty card five times is
     noise; repeating it with DIFFERENT INFORMATION is telling the truth.

     So the run draws once — name, project and place said one time — with a
     seven-column strip under it carrying each day's own sessions. That strip
     is the entire argument for per-day rows, and until now the month threw it
     away: the group rendered as a chip in the first day's cell and the other
     days got an orphan time box with no name attached to it (seen on screen,
     2026-07-31 — a bare `12:00–16:00` floating in Sunday).

     A session is a LINE. Two sessions in one day are two lines, never one
     line with a separator: at a 72px column `10h–14h · 16h–18h` needs 93px
     and the cell hides its overflow, so it printed `10h–14h · 16h—` and lost
     an hour. A clipped hour is the one thing this drawing will not do. */
  /**
   * UNA CELDA DE BANDA NO SABE DE QUÉ ESTÁ HECHA (ADR-084 §1).
   *
   * La banda dibujaba solo tandas de `date`. Desde `20260829100000` una
   * FUNCIÓN también puede durar varios días, y la ley de arriba —«una tanda es
   * un elemento, y lleva las horas de cada día»— no cambia por el tipo de fila.
   * Así que la celda deja de llevar un `DateEvent` y lleva lo que el dibujo
   * necesita: si hay algo ese día, sus horas, y QUÉ HACE al pulsarla.
   *
   * Y ahí está la única asimetría real: una fecha no tiene página y abre su
   * diálogo (`onDateOpen`), una función SÍ la tiene y es un enlace. Por eso
   * hay `open` y `href`, y no un solo callback: convertir el enlace de una
   * función en un botón le quitaría el clic central, el copiar-enlace y el
   * foco que trae gratis.
   */
  type SeriesCell = {
    iso: string;
    hours: SlipVM['time'][];
    /** Hay fila ese día. Un hueco en medio de la tanda es un día sin nada. */
    filled: boolean;
    open: (() => void) | null;
    href: string | null;
  };
  type WeekSeries = {
    key: string;
    /** The row this run sits on, 0-based — packed, not stacked. */
    lane: number;
    colStart: number;
    colEnd: number;
    project: ProjectLite | null;
    kindWord: string;
    label: string;
    city: string | null;
    cert: SlipVM['cert'];
    title: string;
    /** La tanda sigue antes / después de esta semana: el lado se dibuja
        ABIERTO, porque una caja cerrada en los dos lados afirma un final que
        la tanda no tiene ahí (Marco, 2026-08-30). */
    cutLeft: boolean;
    cutRight: boolean;
    /** CADA MITAD NOMBRA EL EXTREMO QUE NO ENSEÑA: la de arriba no ve el
        final y dice «hasta»; la de abajo no ve el principio y dice «desde». Y
        las dos dicen cuántos días son, que es lo que ninguna de las dos puede
        contar sola. */
    note: string | null;
    cells: SeriesCell[];
  };
  /** Una fila de tanda, ya normalizada: el mínimo que la banda dibuja. */
  type RunRow = {
    sid: string;
    iso: string;
    /** Para ordenar dentro de un día. Las fechas traen instante; las
        funciones, la hora que el slip resuelva. */
    at: string;
    time: SlipVM['time'];
    open: (() => void) | null;
    href: string | null;
  };

  function weekSeries(week: { iso: string }[]): WeekSeries[] {
    const grouped = new Map<
      string,
      { rows: RunRow[]; cols: number[]; head: SlipVM; project: ProjectLite | null; kindWord: string }
    >();
    week.forEach((day, ci) => {
      const push = (r: RunRow, head: SlipVM, project: ProjectLite | null, kindWord: string) => {
        const g = grouped.get(r.sid) ?? { rows: [], cols: [], head, project, kindWord };
        g.rows.push(r);
        if (!g.cols.includes(ci)) g.cols.push(ci);
        grouped.set(r.sid, g);
      };
      for (const d of datesByDay.get(day.iso) ?? []) {
        if (!isRun(d.series_id)) continue;
        const sl = dateSlip(d, slipCtx);
        push(
          {
            sid: d.series_id!,
            iso: day.iso,
            at: d.starts_at,
            time: sl.time,
            open: onDateOpen ? () => onDateOpen?.(d) : null,
            href: null,
          },
          sl,
          d.project,
          dateKindLabel(d.kind),
        );
      }
      for (const p of performancesByDay.get(day.iso) ?? []) {
        if (!isRun(p.series_id)) continue;
        const sl = performanceSlip(p, slipCtx);
        push(
          {
            sid: p.series_id!,
            iso: day.iso,
            at: perfInstant(p) ?? '~',
            time: sl.time,
            open: null,
            href: sl.href ?? null,
          },
          sl,
          p.project,
          // La misma resolución que el resto del mes usa para cualquier slip
          // (`slipCtx.kindLabel`): un bolo dice «show» con la palabra del
          // vocabulario, no con una segunda opinión propia de esta banda.
          dateKindLabel(sl.kind),
        );
      }
    });
    const out: WeekSeries[] = [];
    for (const [sid, g] of grouped) {
      const a = Math.min(...g.cols);
      const b = Math.max(...g.cols);
      const head = g.head;
      const cells: SeriesCell[] = [];
      for (let c = a; c <= b; c++) {
        const iso = week[c].iso;
        const rows = g.rows
          .filter((r) => r.iso === iso)
          .sort((x, y) => (x.at < y.at ? -1 : 1));
        cells.push({
          iso,
          hours: rows.map((r) => r.time),
          filled: rows.length > 0,
          open: rows[0]?.open ?? null,
          href: rows[0]?.href ?? null,
        });
      }
      // Los días de la SERIE ENTERA, no los de esta semana: la tanda continúa
      // si tiene algún día fuera del tramo que esta hoja dibuja aquí.
      const all = [...(seriesDays.get(sid) ?? [])].sort();
      const cutL = Boolean(all.length) && all[0] < week[a].iso;
      const cutR = Boolean(all.length) && all[all.length - 1] > week[b].iso;
      out.push({
        key: `${sid}:${week[0].iso}`,
        lane: 0,
        colStart: a + 1,
        colEnd: b + 2,
        cutLeft: cutL,
        cutRight: cutR,
        note: cutR
          ? runUntilLabel(all[all.length - 1], all.length)
          : cutL
            ? runFromLabel(all[0], all.length)
            : null,
        project: g.project,
        kindWord: g.kindWord,
        label: head.name,
        city: head.city,
        cert: head.cert,
        title: head.title,
        cells,
      });
    }
    out.sort((x, y) => x.colStart - y.colStart);
    /* LANES ARE PACKED, NOT STACKED. Nth-in-the-list was the row, so a run on
       Saturday sat on the third row because two unrelated runs earlier in the
       week had taken the first two — two empty lanes above it, and its own
       days pushed a third of a cell down for nothing. Two runs that do not
       share a column share a row. (Unlike a BAND, whose lane is reserved for
       the whole week precisely so it cannot jump.) */
    const ends: number[] = [];
    for (const s of out) {
      let lane = ends.findIndex((e) => e <= s.colStart);
      if (lane === -1) lane = ends.length;
      ends[lane] = s.colEnd;
      s.lane = lane;
    }
    return out;
  }

  /**
   * HOW MANY RUN ROWS ACTUALLY SIT OVER THIS DAY — the day's contents start
   * under the last one, and NOT under the last one of the week.
   *
   * The run rows used to be reserved for the whole week: every cell began
   * below every band, so a Monday with no run at all opened with forty pixels
   * of nothing between its number and its first card, and a run two days long
   * put that hole in the other five days (Marco, day 10). A lane is reserved
   * for a BAND, which must keep its height across the days it spans; a run is
   * one element on one row, and the days it does not cross owe it nothing.
   */
  function runRowsOver(series: WeekSeries[], di: number): number {
    let n = 0;
    for (const s of series) {
      if (s.colStart <= di + 1 && di + 1 < s.colEnd) n = Math.max(n, s.lane + 1);
    }
    return n;
  }

  /** How many run rows the week needs at all — one more than its last lane. */
  function runRowCount(series: WeekSeries[]): number {
    let n = 0;
    for (const s of series) n = Math.max(n, s.lane + 1);
    return n;
  }

  /* THE LEGEND IS NOT A FILTER ANY MORE (ADR-095 §3). Its project entries were
     the month's own narrowing machine — a second one, a hundred pixels under
     the scope bar that already does exactly this. What the legend keeps is the
     part the drawing cannot say on its own (solid / dashed / `!`), and even
     that leaves the sheet: its subject is the grammar of all four views, not
     the month, and the foot of a drawing three screens tall is where nobody
     who needs teaching will ever arrive. */

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

  /**
   * A BAND IS ONE ELEMENT THAT SPANS COLUMNS (ADR-095), not N slices glued
   * edge to edge — and it lives at the FOOT of its week, which is where the
   * design puts absences and tours.
   *
   * Before this it was a per-cell lane system: every day of the week reserved
   * an empty slot for every lane so the pieces would line up, and the label
   * was reprinted on the first day of each week. That kept seven copies of one
   * fact in the DOM and could never draw a terminus — an arrowhead only means
   * something on an element that has an end.
   *
   * Clipping is per ISO week because a band that runs past Sunday does not end
   * there: it loses its arrowhead and says `until <date>` instead, so the
   * geometry never claims something the calendar cannot show.
   */
  type WeekBand = {
    key: string;
    kind: 'blackout' | 'away';
    colStart: number;
    colEnd: number;
    /**
     * THREE FIELDS IN THREE VOICES, never one composed sentence. `word` is
     * what kind of band this is (mono, the margin voice), `subject` is who or
     * where (text, full ink — it is the thing you are reading), `span` is when
     * (mono again, quietest).
     *
     * It was `away · MaMeMi` in one 9px mono string, which drew the SUBJECT —
     * the only part you actually look for — at the size and weight of its own
     * label. The design's band has had the three-part shape from the start.
     */
    word: string;
    subject: string;
    span: string | null;
    /**
     * Tours travel with their project: at one column wide the coloured
     * monogram is the only thing that survives.
     *
     * ALREADY RESOLVED. `AwayBandVM.accent` is the CSS value the page built
     * with `accentVarFor`; running it through that helper a SECOND time was a
     * real defect — `var(--accent-7)` is not a shape it recognises, so it fell
     * back to hashing the slug, and the synthetic object had no slug. The
     * tour's monogram came out a different colour from the same project's
     * monogram on the gig beside it. Marco saw it.
     */
    accent: string | null;
    initials: string | null;
    projectName: string | null;
    label: string;
    note?: string | null;
    tentative: boolean;
    /** The band continues past this week's edge — no terminus on that side. */
    cutLeft: boolean;
    cutRight: boolean;
    lane: number;
  };
  /** «15 jul → 20 jul», or «until 20 jul» when the band opened before this
      week: an arrowhead cannot claim a start the sheet is not showing. */
  function bandSpan(from: string, to: string, cutLeft: boolean): string {
    const d = (iso: string) => `${Number(iso.slice(8, 10))} ${localeMonthShort(iso, locale)}`;
    return cutLeft ? untilLabel(d(to)) : `${d(from)} → ${d(to)}`;
  }
  function weekBands(week: { iso: string }[]): WeekBand[] {
    const first = week[0].iso;
    const last = week[6].iso;
    const out: WeekBand[] = [];
    const { combined, lanes } = laneBands;
    combined.forEach((slot, i) => {
      if (slot.to < first || slot.from > last) return;
      const from = slot.from < first ? first : slot.from;
      const to = slot.to > last ? last : slot.to;
      const colStart = week.findIndex((d) => d.iso === from) + 1;
      const colEnd = week.findIndex((d) => d.iso === to) + 2;
      if (colStart < 1 || colEnd < 2) return;
      const isBlackout = slot.kind === 'blackout';
      const cutLeft = slot.from < first;
      const bo = slot.band as BlackoutBandVM;
      const aw = slot.band as AwayBandVM;
      out.push({
        key: `${slot.kind}:${i}:${first}`,
        kind: slot.kind,
        colStart,
        colEnd,
        word: isBlackout ? awayWord : tourWord,
        // An absence names a PERSON; a tour names a PLACE — and when nobody
        // wrote the place down it names the project instead of inventing one.
        subject: isBlackout ? (bo.subject ?? bo.label) : (aw.place ?? aw.projectName ?? ''),
        // A tour says no dates: it is inferred from two travel legs, and the
        // legs are already drawn on the sheet as the days they are.
        span: isBlackout ? bandSpan(slot.from, slot.to, cutLeft) : null,
        accent: isBlackout ? null : aw.accent,
        initials: isBlackout ? null : aw.initials,
        projectName: isBlackout ? null : aw.projectName,
        label: slot.band.label,
        note: isBlackout ? bo.note : null,
        tentative: isBlackout ? bo.tentative : false,
        cutLeft,
        cutRight: slot.to > last,
        lane: lanes[i] ?? 0,
      });
    });
    return out.sort((a, b) => a.lane - b.lane || a.colStart - b.colStart);
  }

  /** Lanes in use across a whole week row — every cell reserves this many
   *  slots so a lane sits at the same height in every day of the week. */
  /* THE DENSITY ROW IS GONE, and it went by Marco's own hand: «sé que estos
     puntos estaban en el diseño, pero no veo que realmente funcionen».

     Seven marks per week in four textures — solid, ring, rule, faint dot —
     asked the reader to hold a four-symbol legend in order to learn what the
     SEVEN CELLS BESIDE THEM already say at full size, in words, with names on
     them. It is a miniature of the drawing it is printed next to, and a month
     is not a chart that needs a sparkline. The counts it summarised survive
     where they are read: the meta band, once, for the whole window.

     `tourDays` went with it — it had no other reader — and so did the four
     count words that only its tooltip needed. */

  /**
   * The week is as tall as its FULLEST day, so a quiet week is visibly short
   * without drawing anything to say so. Four steps, and the cap is what makes
   * them mean something (see CELL_CAP).
   *
   * Out-of-month days count too, on purpose: without them a week whose only
   * slip falls on the 1st of the next month asks for 32% of a cell and the
   * slip comes out taller than the row.
   */
  const WEEK_FILL = [0.34, 0.62, 0.85, 1];
  function weekFill(week: { iso: string }[]): number {
    let max = 0;
    for (const d of week) {
      // A run of days is NOT in the cell — it is the week's own band, on its
      // own row. Counting it here asked for a full-height cell to hold
      // nothing, so a week whose only content was one rehearsal block drew as
      // tall as the busiest week of the month (seen on screen, 2026-07-31).
      const inCell = (datesByDay.get(d.iso) ?? []).filter((x) => !isSeriesBand([x])).length;
      const perfsInCell = (performancesByDay.get(d.iso) ?? []).filter(
        (x) => !isRun(x.series_id),
      ).length;
      const n = perfsInCell + inCell;
      max = Math.max(max, Math.min(n, CELL_CAP));
    }
    return WEEK_FILL[max];
  }

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

  /* THE HOVERED DAY, in state and not in CSS. A cell is TWO grid items — the
     number row and the contents, with any run of days between them — so no
     single element can carry a `:hover` that means «this day» without also
     lighting the other six. One string, set by both halves. */
  let hoverDay = $state<string | null>(null);

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

<!-- THE CELL IS NOT A DOOR ANY MORE (Marco, 2026-07-31), and this is a
     simplification with teeth. It used to be: click anywhere the click did not
     land on something else, and a create dialog opened. That makes every
     harmless gesture in the sheet — a stray click while reading, a click to
     dismiss a popover, a drag that ends nowhere — a request to make a gig.
     An affordance that fires on «you did not hit anything» is not an
     affordance, it is a tripwire.
     The invitation is now ONE explicit control, in the cell's header, and it
     is the only thing that opens the dialog. -->
<div
  class="cal__grid"
  class:cal__grid--loading={loading}
  role="grid"
  tabindex="-1"
  aria-label={label}
  bind:this={gridEl}
>
  <!-- THE WEEKDAY AXIS NEVER GOES. It costs fourteen pixels once for the whole
       sheet, and there is no weekend wash by law — in this trade Saturday is
       the best working day — so without the names you cannot tell which column
       is Saturday except by counting from a number. The axis is the reading. -->
  <div class="cal__wkh">
    <span></span>
    {#each wkLabels as wd (wd)}
      <span class="cal__weekday">{wd}</span>
    {/each}
  </div>
  {#each weeks as week, wi (wi)}
    {@const wlc = weekLaneCount(week)}
    {@const bands = weekBands(week)}
    {@const series = weekSeries(week)}
    <!-- A ROW OF THE MONTH IS A WEEK, and each week is its own block: a gutter
         that counts it, then its seven days. -->
    <div class="cal__wk" style="--wf: {weekFill(week)}">
      <div class="cal__wkg">
        <span class="cal__wkn">{isoWeekLabel(isoWeek(week[0].iso))}</span>
      </div>
      <!-- ONE GRID PER WEEK, THREE BANDS OF ROWS: the day numbers on row 1,
           the runs of days under them, and the day cells on the last row —
           all of them placed, none of them auto-flowed. A run belongs
           BETWEEN the number and the day's own contents: above the number it
           reads as a header for the week, below the contents it lands under
           the `+N more` door. It is the frame the days sit inside. -->
      <!-- EL CUERPO DE LA SEMANA: las celdas y su pie, dentro del mismo
           reglado. Las siete verticales eran un gradiente sobre `.cal__wkc`,
           que es solo la fila de celdas, así que las líneas morían encima de
           la banda y una ausencia se leía como algo pegado por debajo del mes
           en vez de como parte de los días que mide (Marco, en pantalla,
           2026-08-29). La regla sube aquí: no se duplica, se muda. -->
      <div class="cal__wkbody">
      <div class="cal__wkc">
        {#each week as day, di (day.iso)}
          {@const clashes = clashesByDay?.get(day.iso) ?? []}
          <div
            class="cal__num"
            class:cal__day--out={!day.inMonth}
            class:cal__day--today={day.iso === todayIso}
            data-hover={hoverDay === day.iso ? '' : undefined}
            style="grid-row: 1; grid-column: {di + 1}"
            onmouseenter={() => (hoverDay = day.iso)}
            onmouseleave={() => (hoverDay = hoverDay === day.iso ? null : hoverDay)}
            role="presentation"
          >
            <span class="cal__day-head">
              <!-- A DAY OUTSIDE THE MONTH DRAWS ITS CONTENT AND NEVER ITS
                   NUMBER (ADR-095). It used to do the opposite — number and
                   grey wash, the noise without the information. The ABSENCE
                   of the number is the whole of the mark, and there is no
                   fade: a weaker CLAIM is not fainter INK. -->
              <!-- THREE SLOTS, ALWAYS, so the middle one is a real centre and
                   not «whatever is left». A quiet day draws no mark but keeps
                   its column. -->
              {#if day.inMonth && onDayOpen}
                <button
                  type="button"
                  class="cal__day-num"
                  title={openDayLabel(day.iso)}
                  aria-label={openDayLabel(day.iso)}
                  onclick={() => onDayOpen?.(day.iso)}>{Number(day.iso.slice(8, 10))}</button
                >
              {:else}
                <span class="cal__day-num">{Number(day.iso.slice(8, 10))}</span>
              {/if}
              {#if day.inMonth && onDayCreate}
                <button
                  type="button"
                  class="cal__new"
                  aria-label={createLabel(day.iso)}
                  onclick={() => onDayCreate?.(day.iso)}>+</button
                >
              {:else}
                <span></span>
              {/if}
              <span class="cal__marks">
                {#each clashes as c, i (i)}
                  <button
                    type="button"
                    class="cal__mark"
                    data-severity={c.severity}
                    aria-label={c.title}
                    aria-expanded={openClash === `${day.iso}:${i}`}
                    onclick={() => toggleClash(day.iso, i)}>!</button
                  >
                {/each}
              </span>
            </span>
            {#each clashes as c, i (i)}
              {#if openClash === `${day.iso}:${i}`}
                <!-- Bottom rows open upward: a downward card would run off
                     the foot of the sheet. -->
                <ClashCard {c} up={wi >= weeks.length - 2} flip={di >= 5} />
              {/if}
            {/each}
          </div>
        {/each}
        {#each series as s (s.key)}
          <div
            class="cal__run"
            class:cal__run--cutl={s.cutLeft}
            class:cal__run--cutr={s.cutRight}
            data-family={s.cert}
            style="grid-row: {s.lane + 2}; grid-column: {s.colStart} / {s.colEnd}; --run-cols: {s.cells
              .length}{s.project ? `; --c: ${accentVarFor(s.project)}` : ''}"
            title={s.title}
          >
              <span class="cal__run-h">
                <span class="cal__run-k">
                  {#if s.project}
                    <IdentityMark
                      mini
                      accent={accentVarFor(s.project)}
                      name={s.project.name}
                      initials={s.project.initials}
                    />
                  {/if}
                  <span class="cal__run-w">{s.kindWord}</span>
                </span>
                <b>{s.label}</b>
                {#if s.city}<span class="cal__run-c">{s.city}</span>{/if}
                {#if s.note}<span class="cal__run-n">{s.note}</span>{/if}
              </span>
              <!-- Each day's OWN hours. This strip is the whole reason a run
                   is stored as per-day rows rather than a span. -->
              <span
                class="cal__run-g"
                style="grid-template-columns: repeat({s.cells.length}, minmax(0, 1fr))"
              >
                {#each s.cells as c (c.iso)}
                  {#if c.filled && c.href}
                    <!-- Una función tiene página: enlace, no botón. -->
                    <a class="cal__run-d" href={c.href} title={c.iso}>
                      {#each c.hours as h, hi (hi)}
                        <i>{h?.primary ?? '·'}{#if h?.end}<u>–{h.end}</u>{/if}</i>
                      {/each}
                    </a>
                  {:else if c.filled && c.open}
                    <button type="button" class="cal__run-d" onclick={c.open} title={c.iso}>
                      {#each c.hours as h, hi (hi)}
                        <i>{h?.primary ?? '·'}{#if h?.end}<u>–{h.end}</u>{/if}</i>
                      {/each}
                    </button>
                  {:else}
                    <span class="cal__run-d" class:cal__run-d--off={!c.filled}>
                      {#if c.filled}
                        {#each c.hours as h, hi (hi)}
                          <i>{h?.primary ?? '·'}{#if h?.end}<u>–{h.end}</u>{/if}</i>
                        {/each}
                      {:else}<i>–</i>{/if}
                    </span>
                  {/if}
                {/each}
              </span>
            </div>
        {/each}
    {#each week as day, di (day.iso)}
      {@const perfs = performancesByDay.get(day.iso) ?? []}
      {@const runRows = runRowsOver(series, di)}
      {@const runLanes = runRowCount(series)}
      {@const dateGroups = groupDates(datesByDay.get(day.iso) ?? [])}
      {@const entries = cellSlips(perfs, dateGroups)}
      {@const overflow = entries.length - CELL_CAP}
      {@const lead = entries.slice(0, CELL_CAP)}
      {@const cf = clashFlags(lead, clashesByDay?.get(day.iso) ?? [])}
      <!-- A DATE IS A PLACE, SO A NEW DATE IS MADE AT THE PLACE (ADR-095 §7).
           THE CELL ITSELF is the door — not a button laid over its foot. The
           old `+` was absolute, reserved 16px of a foot that reserves 10, and
           covered the bottom half of anything below it: clicks meant for one
           control fired the other. `opacity: 0` hides a thing; it does not stop
           it being hit. The hint is a `::after` with no pointer-events, and the
           handler only fires when the click landed on nothing else.
           And the door is THIS MONTH'S only: you cannot point at a day that is
           not on this sheet and mean it. -->
      <div
        class="cal__day"
        class:cal__day--out={!day.inMonth}
        class:cal__day--today={day.iso === todayIso}
        style="grid-row: {runRows + 2} / {runLanes + 3}; grid-column: {di + 1}"
        onmouseenter={() => (hoverDay = day.iso)}
        onmouseleave={() => (hoverDay = hoverDay === day.iso ? null : hoverDay)}
        role="presentation"
      >
        <!-- Three, then a door. The cap is what lets a quiet week look short:
             the row is as tall as its fullest day, and without it that day can
             hold nine things. -->
        {#each lead as entry, ei (entry.key)}
          <Slip
            slip={entry.slip}
            kindLabel={(k) => dateKindLabel(k)}
            stateLabel={slipState}
            stateUrgent={isUrgentHold(entry.slip)}
            showCountry={false}
            clash={cf.on[ei] ? (cf.hard[ei] ? 'hard' : 'soft') : 'none'}
            clashPeople={cf.people[ei]}
            onMarkOpen={openMark}
            onOpen={entry.dateRow && onDateOpen ? () => onDateOpen?.(entry.dateRow!) : undefined}
          />
        {/each}
        {#if overflow > 0}
          <button type="button" class="cal__more" onclick={() => onDayCreate?.(day.iso)}
            >+{overflow} {moreLabel}</button
          >
        {/if}

      </div>
    {/each}
      </div>
      {#if bands.length > 0}
        <!-- The foot of the week: absences and tours, each ONE element measured
             over the days it covers. -->
        <div class="cal__wkb">
          {#each bands as b (b.key)}
            <span
              class="cal__band"
              class:cal__band--away={b.kind === 'away'}
              class:cal__band--tent={b.tentative}
              class:grain={b.tentative}
              class:cal__band--cutl={b.cutLeft}
              class:cal__band--cutr={b.cutRight}
              style="grid-column: {b.colStart} / {b.colEnd}"
              title={b.note ? `${b.label} · ${b.note}` : b.label}
            >
              <span class="cal__band-k">
                {#if b.accent}
                  <IdentityMark
                    mini
                    accent={b.accent}
                    name={b.projectName}
                    initials={b.initials}
                  />
                {/if}
                <!-- UNA OPCIÓN PREGUNTA, igual que en la tarjeta: allí el
                     `SHOW` de un hold se dibuja `SHOW?` y se inclina
                     (`Slip § slip__kind--q`). La banda tiene que hablar el
                     mismo idioma o son dos vocabularios para una duda. -->
                <span class="cal__band-w" class:cal__band-w--q={b.tentative}
                  >{b.word}{#if b.tentative}?{/if}</span
                >
              </span>
              {#if b.subject}<span class="cal__band-n" class:guess={b.kind === 'away'}
                  >{b.subject}</span
                >{/if}
              {#if b.span}<em class="cal__band-s">{b.span}</em>{/if}
              <!-- The rule with its terminus. It is not drawn when the band runs
                   past the week's edge: an arrowhead there would claim an end
                   the calendar cannot show. -->
              <span class="cal__band-r"></span>
            </span>
          {/each}
        </div>
      {/if}
      </div>
    </div>
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
    /* THE SHEET · a stack of week blocks, not one flat grid of 42 cells.
       A row of the month IS a week, and a week that has to carry a gutter, a
       density row and a band spanning columns cannot be seven loose cells of
       somebody else's grid. */
    /* THE SHEET IS NOT A WIDGET. It had a 1px border, a large radius,
       `overflow: hidden` and a card fill — a rounded panel sitting on the
       page, which is the shape of a component and not the shape of a month.
       The design draws PAPER: the rules of the grid are the only lines, the
       ground is the page's own, and nothing is clipped at a corner. The fill
       also broke the column ruling — the cells painted `--card` OVER the
       gradient that draws the seven verticals (see `.cal__wkc`). */
    .cal__grid {
      --cal-wk-gutter: 66px;
      --cal-cell-h: 128px;
      /* The air between a card and the column rule beside it. One number,
         because the day cell and the run that crosses it have to agree —
         they are siblings of the week grid, not parent and child. */
      --cal-cell-pad: 5px;
      display: flex;
      flex-direction: column;
      transition: opacity var(--transition);
    }
    .cal__wkh {
      display: grid;
      grid-template-columns: var(--cal-wk-gutter) repeat(7, minmax(0, 1fr));
      margin-block-start: 12px;
      border-block-end: 1px solid var(--border-color-light);
    }
    .cal__wk {
      display: grid;
      grid-template-columns: var(--cal-wk-gutter) minmax(0, 1fr);
      border-block-end: 1px solid var(--border-color-light);
    }
    .cal__wk:last-child {
      border-block-end: 0;
    }
    /* The gutter counts the week WITHOUT WORDS. */
    .cal__wkg {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      padding: 9px 9px 10px 0;
      border-inline-end: 1px solid var(--border-color-light);
      /* The gutter spans the WHOLE week block — the run strip, the days and
         the foot bands are three rows in column 2, and without this the
         gutter would take one of them and the days would fall to column 1. */
      grid-column: 1;
      grid-row: 1 / -1;
    }
    .cal__wkn {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      /* One step above the marks it labels: the number is read, the marks are
         seen. */
      color: var(--text-muted);
    }
    /* The seven days. The 1px rules ARE the grid — a background-image column
       ruling, so a cell can never be pushed out of alignment by a border. */
    /* THE FOOT OF THE WEEK · absences and tours. */
    .cal__wkb {
      /* Ya no necesita `grid-column: 2`: vive dentro de `.cal__wkbody`, que es
         la columna de contenido. Antes era hermana del gutter y sin esto la
         banda dibujaba bajo el número de semana (visto en pantalla el
         2026-07-31); el envoltorio lo resuelve por posición. */
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px 0;
      /* Aire ARRIBA y ninguno abajo (Marco, 2026-08-30): la banda se separa de
         las cards que la preceden y se apoya en el borde de la semana, que es
         donde acaba el día que mide. */
      padding: 8px 0 0;
    }
    /* THE RULE BELONGS TO THE BAND, NOT TO THE ROW. A `border-block-start` on
       the container drew a hairline the full width of the week whenever ANY
       band existed — a line that measures seven days for a fact that lasts
       two. The band's own top border spans exactly the columns it covers,
       which is the whole point of measuring it. */
    .cal__band {
      display: flex;
      /* TODAS LAS PALABRAS EN EL MISMO SUELO. Con `center` cada trozo se
         centraba en SU caja, y las tres voces de la banda tienen cuerpos
         distintos —`AWAY` a 9px mono, el sujeto a 10.5px, el tramo a 9px—, así
         que ninguna se apoyaba donde las otras y el conjunto no leía ni
         centrado ni alineado (Marco, en pantalla, 2026-08-29). La línea base
         es lo que comparten, y es lo que hay que alinear. */
      align-items: baseline;
      gap: 9px;
      min-inline-size: 0;
      padding: 1px 8px 2px;
      border-block-start: 1px solid var(--border-color-light);
      overflow: visible;
      white-space: nowrap;
    }
    /* UNA AUSENCIA NO LLEVA TAPA (Marco, 2026-08-30). El `--away` de estas
       clases son las GIRAS, no las ausencias: lo que rotula «AWAY» es un
       `blackout`, que no tiene clase propia. La línea de arriba le ponía un
       techo que la leía como una fila más del mes; lo que la banda tiene que
       decir ya lo dice su propia regla con terminus, a la derecha. */
    .cal__band:not(.cal__band--away) {
      border-block-start: 0;
    }
    /* SIN PAPEL BAJO LAS PALABRAS, y es una decisión, no una omisión.
       Cuando las verticales pasaron a llegar hasta el pie, cruzaban por detrás
       del texto; el arreglo fue una tira de papel que las rompiera donde hay
       algo que leer. Se fue por dos vueltas: opaca se comía el grano, y con
       grano propio quedaba peor todavía — `.grain::after` lleva una máscara
       diagonal pensada para una caja grande, y en una tira estrecha alrededor
       de unas palabras produce un borde y una fase rota.
       Marco lo zanjó mirándolo: «limpia el background de las letras y déjame
       ver las líneas verticales, prefiero eso». La pauta cruza, y ya está. */
    .cal__band-k {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    /* La palabra y su `?` se inclinan juntas, calcado de `.slip__kind--q`. */
    .cal__band-w--q {
      font-style: italic;
    }
    .cal__band-w {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--away-word);
    }
    /* The subject is the thing you are reading, so it is TEXT, not a label:
       the one field on the band drawn in the body voice. */
    .cal__band-n {
      flex: none;
      font-size: 11px;
      color: var(--away-subject);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cal__band-s {
      flex: none;
      font-family: var(--font-mono);
      font-style: normal;
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--away-phrase);
    }
    /* A rule with a terminus — never a box. An absence is a stretch of days,
       and a box says «a thing that happened», which is what it is not. */
    .cal__band-r {
      /* La regla NO tiene línea base: es una caja vacía con un borde arriba, y
         alineada por baseline se colgaría por su borde inferior. Se centra
         ella sola — el suelo es de las palabras. */
      align-self: center;
      flex: 1;
      min-inline-size: 12px;
      position: relative;
      block-size: 0;
      border-block-start: 1px solid var(--away-rule);
    }
    .cal__band-r::after {
      content: '';
      position: absolute;
      inset-inline-end: -1px;
      inset-block-start: -2.5px;
      inline-size: 5px;
      block-size: 5px;
      border-block-start: 1px solid var(--away-terminus);
      border-inline-end: 1px solid var(--away-terminus);
      transform: rotate(45deg);
    }
    /* Runs past the week's edge: no terminus on that side. */
    .cal__band--cutr .cal__band-r::after {
      display: none;
    }
    /* ON TOUR is QUIETER THAN AN ABSENCE: an absence is a fact somebody wrote
       down, this is deduced from two travel legs, and they cannot weigh the
       same.
       PERO LA DIFERENCIA NO ES EL TRAZO, Y ASÍ ESTABA MAL. La gira iba de
       puntos «porque pesa menos», y una ausencia TENTATIVA también va de
       puntos — porque duda. Dos significados con un material, separados solo
       por 4 puntos de tinta (20% contra 16%), que a ojo no es nada: Marco leyó
       la gira como algo sin confirmar, que es justo lo que no es.
       `certainty.css` ya tiene los dos ejes separados y avisa de esto — «no
       deben tomarse prestado el material el uno al otro»: `.grain` es la duda
       sobre el HECHO, `.guess` es la duda sobre la ATRIBUCIÓN, y su voz es la
       cursiva. Una gira es exactamente un `guess`: nadie la escribió, se
       dedujo. Así que va con regla CONTINUA y en cursiva, y lo que la mantiene
       más callada es la tinta, no el trazo. */
    .cal__band--away .cal__band-n {
      font-size: 10.5px;
      color: var(--away-phrase);
    }
    .cal__band--away .cal__band-w {
      color: var(--away-phrase);
    }
    .cal__band--away .cal__band-r {
      border-block-start-color: var(--away-rule-derived);
    }
    .cal__band--away .cal__band-r::after {
      display: none;
    }
    /* An absence that is settled is ink; one that is not is faint and leans —
       the certainty axis, same as everywhere else. La tapa discontinua que
       había aquí murió con la línea superior (arriba): la duda la dicen ahora
       la cursiva, el grano y la regla de puntos de la derecha. */
    .cal__band--tent .cal__band-n {
      color: var(--away-phrase);
      /* CON CURSIVA, y el intento de quitarla fue un error mío corregido por
         Marco el 2026-08-30. El razonamiento era que la cursiva pertenece a
         `.guess` —la inferencia— y que una tentativa no se dedujo. Cierto en
         la teoría del token y falso en la app: LA TARJETA YA INCLINA SUS
         OPCIONES (`Slip § slip__kind--q`), así que una banda tentativa que no
         se inclina habla otro idioma que la card del mismo día. Manda el
         vocabulario que ya está en pantalla, no el mapa de ejes.
         La gira sigue distinguiéndose por lo demás: regla continua, sin grano
         y sin `?`. */
      font-style: italic;
      /* EL HUECO SE MIDE ENTRE CAJAS Y LA CURSIVA VUELA FUERA DE LA SUYA.
         Con `gap: 9px` la caja está separada, pero la última letra inclinada
         —la «l» de «marco rubiol»— cae encima del `3 DEC` que viene detrás y
         se lee como un RECORTE: Marco lo vio así y preguntó si el nombre
         estaba cortado. No lo estaba (`scrollWidth == clientWidth` a 900,
         1024, 1280 y 1600); lo que fallaba era el aire, no el texto.
         Va en `em` porque el que vuela es el glifo: si el cuerpo cambia, el
         vuelo cambia con él. Y solo en la cursiva — la redonda no lo necesita
         y no debe pagarlo. */
      padding-inline-end: 0.18em;
    }
    /* Dotted AND one ink lighter — the board says doubt this way and the
       month said it half-way, keeping the settled 45% under a dotted rule. */
    .cal__band--tent .cal__band-r {
      border-block-start-style: dotted;
      border-block-start-color: var(--away-rule-tent);
    }
    .cal__band--tent .cal__band-r::after {
      border-color: var(--away-terminus-tent);
    }

    /* The day NUMBER is its own cell on row 1 of the week's grid, so a run of
       days can sit between it and the day's contents. It also means the
       numbers line up across a week whose days hold different things. */
    .cal__num {
      position: relative;
      min-inline-size: 0;
      padding: 6px 8px 2px;
    }

    /* ── THE RUN · one band, its days' hours under it ─────────────────── */
    /* The same box as a slip — a run IS a slip with a longer life, and giving
       it its own shape is how a fifth vocabulary gets invented. SAME MEANS
       SAME: the slip's edge (the ink mixed 15% into the line colour, not the
       9% hairline this box used to wear), the slip's 3px corner, and the
       slip's own 5px of air on both sides — the run ran to the column rules
       and printed its border over them, which is the one thing no other card
       in the sheet does (Marco, 2026-08-10). */
    .cal__run {
      /* Contenedor de sí misma: la nota de arriba se pregunta por el ancho de
         LA TANDA, no el de la celda — una tanda de cuatro días y otra de dos
         viven en la misma semana y no pueden responder lo mismo. */
      container-type: inline-size;
      position: relative;
      isolation: isolate;
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      /* 1px over, so a run and a card on the day beside it begin at the same
         line — the cell's own top padding is 1px too. 2px under, so the run
         and the first card below it are the 3px apart that two cards are. */
      margin: 1px var(--cal-cell-pad) 2px;
      padding: 3px 6px;
      background: var(--bg-ultra-light);
      border: 1px solid color-mix(in oklch, var(--text-color) 15%, var(--border-color-light));
      border-radius: 3px;
    }
    /* UNA TANDA QUE SIGUE NO SE CIERRA POR ESE LADO (Marco, 2026-08-30).
       La banda se recorta por semana ISO, así que una tanda de diez días son
       dos dibujos; cerrarlos por los cuatro costados afirma dos finales que no
       existen. El de arriba queda abierto a la derecha y el de abajo a la
       izquierda, y por ese lado se va también el margen: una caja abierta que
       no llega al borde de la celda parece rota, no continuada. */
    /* La frase va al otro extremo de la cabecera, en voz de margen: es una
       nota sobre la tanda, no una segunda medida de ella.
       Y SE VA CUANDO NO CABE, porque EL NOMBRE MANDA (Marco, 2026-08-30). Una
       mitad de dos días no da para las dos cosas y el título salía cortado —
       «Reside…»—, que es peor que no saber cuántos días dura: el nombre es lo
       que identifica la tanda; la nota solo la sitúa.
       El umbral está MEDIDO sobre la residencia de enero, no elegido: la
       cabecera pide 76 (marca + tipo) + 118 (nombre) + 43 (ciudad) + 118
       (nota), más 12 de padding y tres huecos de 8 = 391. Por debajo de eso
       algo tiene que irse, y se va la nota. */
    /* EL ORDEN EN QUE SE SUELTA LO QUE NO CABE, y no es una preferencia mía:
       lo copia de la tarjeta, que ya lo tenía resuelto —«un gloss es lo PRIMERO
       que se va, y nunca la hora»— y de la regla que este mismo fichero escribe
       para la banda a una columna: «lo único que sobrevive es el monograma».
       Nada se recorta a medias; se suelta entero.

       MEDIDO sobre la residencia de enero, a 1600: monograma 15 · palabra de
       tipo 57 · nombre 118 · ciudad 43 · nota 118 · padding 12 · huecos de 8.
       De ahí salen los tres umbrales, sumando lo que queda en cada escalón:

         391 = 76 + 118 + 43 + 118 + 12 + 3×8   todo
         265 = 76 + 118 + 43      + 12 + 2×8   sin nota
         214 = 76 + 118           + 12 + 1×8   sin ciudad
         153 = 15 + 118           + 12 + 1×8   solo el monograma

       Por debajo de 153 el nombre se recorta, y ahí ya no queda nada que dar
       sin borrar la identidad de la tanda. */
    @container (max-width: 391px) {
      .cal__run-n {
        display: none;
      }
    }
    /* La ciudad es el gloss de la tanda: dice DÓNDE, y el nombre dice QUÉ. */
    @container (max-width: 265px) {
      .cal__run-c {
        display: none;
      }
    }
    /* Y al final solo el monograma, que en un glifo dice de quién es. */
    @container (max-width: 214px) {
      .cal__run-w {
        display: none;
      }
    }
    .cal__run-n {
      margin-inline-start: auto;
      flex: none;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      white-space: nowrap;
    }
    .cal__run--cutr {
      margin-inline-end: 0;
      border-inline-end: 0;
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }
    .cal__run--cutl {
      margin-inline-start: 0;
      border-inline-start: 0;
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
    /* …and the same certainty grammar, so a tentative run says «not sure» at
       exactly the volume a tentative gig does. */
    .cal__run[data-family='hold'],
    .cal__run[data-family='proposed'] {
      border-style: dashed;
      border-color: color-mix(in oklch, var(--text-color) 13%, var(--border-color-light));
    }
    .cal__run[data-family='released'] {
      border-style: dotted;
      background: transparent;
    }
    .cal__run[data-family='released'] b {
      text-decoration: line-through;
      color: var(--text-faint);
    }
    /* THE DAY BOUNDARIES CROSS THE BAND. The seven column rules are painted
       on `.cal__wkc`, behind everything, so a band that spans days covered
       them and read as one box floating over the week instead of a run
       measured in days. Drawn back on top — same hairline, same pitch, no
       pointer events — the band is visibly four days long without a word.
       (Marco's experiment, 2026-07-31.) */
    /* The pitch is the COLUMN's, not the box's: now that the run sits 5px
       inside its columns, dividing its own width by `--run-cols` puts the
       rules a couple of pixels off the verticals they are meant to continue.
       `100%` here is the run's padding box — its border box less the two 1px
       edges — so the column is that plus the two margins and the two borders,
       and the first rule starts one border and one margin to the left. */
    .cal__run::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(
        to right,
        var(--border-color-light) 0 1px,
        transparent 1px
      );
      background-size: calc((100% + 2px + var(--cal-cell-pad) * 2) / var(--run-cols, 1)) 100%;
      background-position: calc(-1px - var(--cal-cell-pad)) 0;
      background-repeat: repeat-x;
    }
    .cal__run-h {
      display: flex;
      align-items: center;
      /* The hours sit directly under this line, so the two need a hairline of
         air or the name and its own clock read as one wrapped sentence. */
      margin-block-end: 3px;
      gap: 8px;
      min-inline-size: 0;
      white-space: nowrap;
      overflow: hidden;
      line-height: 1.1;
    }
    .cal__run-k {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .cal__run-w {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__run-h b {
      font-weight: 400;
      font-size: 11px;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cal__run-c {
      font-size: 9px;
      color: var(--text-faint);
      white-space: nowrap;
    }
    /* EVERY HOUR HANGS AT THE RIGHT OF THE DAY IT BELONGS TO — the same edge
       as the day column above it, so the strip reads as a row of the grid and
       not as a sentence. */
    .cal__run-g {
      display: grid;
      align-items: center;
      font-family: var(--font-mono);
      font-size: 9px;
      line-height: 1.15;
      /* Full ink. These hours are the ONLY thing the band says that its own
         title does not — the whole argument for storing a run as per-day rows
         is that the 8th is 10–18 and the 10th is 10–13. At muted they read as
         a caption on the name above them. */
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
    }
    .cal__run-d {
      padding: 0 6px 0 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
    }
    button.cal__run-d {
      cursor: pointer;
    }
    button.cal__run-d:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    /* A session is a LINE. Two sessions in one day are two lines — never one
       line with a separator, which is how an hour got clipped in a 72px cell. */
    .cal__run-d i {
      display: block;
      font-style: normal;
    }
    .cal__run-d u {
      text-decoration: none;
    }
    .cal__run-d--off {
      color: var(--text-faint);
      opacity: 0.6;
    }

    /* Las siete verticales viven AQUÍ y no en la fila de celdas, para que
       lleguen hasta abajo del día — el pie de la semana es parte del día que
       mide, no una tira suelta debajo del mes. */
    .cal__wkbody {
      grid-column: 2;
      min-inline-size: 0;
      background-image: linear-gradient(to right, var(--border-color-light) 0 1px, transparent 1px);
      background-size: calc(100% / 7) 100%;
      background-position: -1px 0;
      background-repeat: repeat-x;
    }
    .cal__wkc {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      align-items: stretch;
    }

    .cal__grid--loading {
      opacity: 0.6;
    }

    /* The weekday axis is a LABEL, not a header bar: a filled band turns the
       row into a table chrome the month does not have. One hairline under it
       is the whole of the separation. */
    .cal__weekday {
      padding: 7px 9px;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.14em;
      color: var(--text-faint);
      text-transform: uppercase;
    }

    .cal__day {
      /* The CELL decides what a slip can afford — measured, never declared. */
      container-type: inline-size;
      position: relative;
      min-block-size: calc(var(--cal-cell-h) * var(--wf, 1));
      min-inline-size: 0;
      display: flex;
      flex-direction: column;
      /* THE FOOT RESERVES THE HINT, it does not lend it space. The hint is
         10px tall at `bottom: 1px` — eleven — and the foot only held back
         nine, so on a full cell it printed straight over the last card.
         An affordance that covers the thing it is offered beside is worse
         than no affordance: you cannot read what is already there.
         (Marco asked to see this exact case before trusting it. He was
         right to: 2026-07-31, day 9, two gigs and a clash.) */
      padding: 1px var(--cal-cell-pad) 13px;
      overflow: hidden;
    }

    /* ── THE INVITATION · one `+`, dead centre, only under the pointer ─
       Three placings were tried before this one. Laid over the FOOT with a
       `::after` it printed across the last card on a full day — an affordance
       that covers the thing it is offered beside is worse than none, because
       you can no longer read what is already there. In flow at the foot it
       stopped overlapping but sat under the day's contents, which is not
       where you point. At the header's right edge it queued behind the marks.

       The number row is the one strip of a cell that is ALWAYS reserved and
       never fills: a number, and at most two marks. The middle of it is empty
       in every cell of every month, so that is where the `+` goes — and it is
       a bare glyph, no box, because a chip in a header full of 9px marks
       reads as a fourth kind of badge. */
    .cal__new {
      justify-self: center;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1;
      /* THE LINE TOKEN, not an ink one — and it is a token, not a bespoke
         mix. `--border-color-dark` is the neutral at 18% alpha: the value
         this app uses for «a line you can just see», which is the whole
         register of a glyph that only has to be findable. It is an OFFER
         sitting in a row of FACTS (the date, the marks), so it must be the
         quietest thing there even while it is the only one that moves. */
      color: var(--border-color-dark);
      cursor: pointer;
      visibility: hidden;
      transition: color 0.1s;
    }
    .cal__num[data-hover] .cal__new,
    .cal__new:focus-visible {
      visibility: visible;
    }
    .cal__new:hover {
      color: var(--text-color);
    }

    .cal__more {
      align-self: flex-start;
      margin-block-start: 3px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .cal__more:hover {
      color: var(--text-muted);
    }
    /* A DAY OUTSIDE THE MONTH KEEPS ITS NUMBER, ATTENUATED — Marco,
       2026-08-01, and it reverses a law of the design that this file carried
       until today («the missing number is the whole of the mark»).

       That law was right about the CONTENT and wrong about the number. What
       it was defending against is fading a venue behind a tint — a weaker
       claim is not fainter ink, and an August gig is not a weaker claim. But
       the number is not a claim at all: it is the ORIENTATION, and a run of
       five blank cells at the head of a sheet asks the reader to count. So
       the content keeps its full ink and the number takes the faintest step
       the app has — the same token as the `+`, which is the register of
       «findable, never read». */
    .cal__day--out .cal__day-num {
      color: var(--border-color-dark);
    }
    /* LO QUE NO ES DE ESTA HOJA SE LEE COMO NO SIENDO DE ESTA HOJA.
       El número del día ya lo decía —los del mes vecino van en tinta de
       borde— y lo que caía dentro seguía a plena voz: una función del 4 de
       diciembre gritaba en la hoja de noviembre (Marco, en pantalla,
       2026-08-30).
       Y ES OTRO EJE, no el de la certeza. La ley «un reclamo más débil no es
       tinta más pálida» gobierna la duda: una opción no es un confirmado
       desvaído, y por eso el board tuvo que quitar su `.62 opacity`. Esto no
       dice «quizá no pase»: dice «esto no es de esta hoja», que es exactamente
       lo que el número ya dice bajando de tinta. El sangrado del mes vecino es
       CONTEXTO, y el contexto puede bajar la voz.
       Y va con `:global()` a propósito: las entradas son componentes `<Slip>`,
       así que el CSS con ámbito de este fichero no las alcanza — el primer
       intento fue `> :not(.cal__day-head)` y Svelte lo dejó sin efecto, cosa
       que solo se vio midiendo la opacidad en la página. */
    .cal__day--out :global(.slip),
    .cal__day--out .cal__more,
    .cal__day--out .cal__marks {
      opacity: 0.62;
    }

    /* TODAY IS INK AND A WASH — never a filled pill. The pill was the loudest
       object on the whole sheet: a black disc that outranked every gig on it,
       to say something the reader already knows (it is the one date they did
       not have to look up). Colour is project identity and nothing else, and
       the same law governs all four drawings: today is the cell's 4% wash and
       one step of weight on its number. */
    .cal__day--today {
      background: color-mix(in oklch, var(--text-color) 4%, transparent);
    }
    .cal__day--today .cal__day-num {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-color);
    }

    .cal__day-num {
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: 15px;
      line-height: 1;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    /* EL NÚMERO ES LA PUERTA AL DÍA, y hasta hoy no lo parecía.
       Solo se oscurecía al pasar, que es lo que hace la tinta cuando algo se
       enfoca — no dice «esto se pulsa». El subrayado sí, y es el registro más
       callado que hay para decirlo: no añade forma, no compite con las cards,
       y desaparece cuando no hace falta. Nada de píldoras — hoy mismo es una
       tinta y un lavado, no un disco. */
    button.cal__day-num {
      cursor: pointer;
      text-decoration: underline solid transparent 1px;
      text-underline-offset: 3px;
      transition:
        color 0.12s,
        text-decoration-color 0.12s;
    }
    button.cal__day-num:hover {
      color: var(--text-color);
      text-decoration-color: currentColor;
    }
    button.cal__day-num:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
      border-radius: 2px;
    }

    /* THREE COLUMNS, so the middle is a TRUE centre: the number holds the
       left, the marks hold the right, and the invitation sits on the cell's
       own axis whatever their widths. `space-between` on a flex row cannot do
       this — it centres between the neighbours, so the invitation would slide
       sideways on any day that happens to carry a mark. */
    .cal__day-head {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 6px;
      margin-block-end: 4px;
      min-block-size: 16px;
    }
    .cal__day-head > :first-child {
      justify-self: start;
    }
    .cal__day-head > :last-child {
      justify-self: end;
    }

    /* Quiet add affordance — visible on cell hover (and on focus). */

    /* ══ ONE MARK, ONE MEANING ══════════════════════════════════════════
       There is something to DECIDE on this day. That is the whole message.

       It used to be four badges — a filled red disc, a dashed circle with a
       `?`, a red ring, an amber dashed ring — which read as four different
       KINDS of problem when there is one problem seen at four moments. Worse,
       the `!`/`?` fork said «this one is urgent» in a slot that cannot carry
       urgency: WHEN a hold's clock runs out is said by the hold chip inside
       the slip, in words, where you can act on it. The number's mark only
       says THAT there is a call to make.

       And the circles were the loudest objects in a cell full of gigs, for a
       flag. Now it is a glyph: red when people actually collide, verb-cal
       when they do not — the one colour law the Planner already declares
       (red is conflict and only conflict; verb-cal is a call to make). */
    .cal__marks {
      display: inline-flex;
      gap: 3px;
      margin-inline-start: auto;
    }
    .cal__grid :global(.cal__mark) {
      --mark-fg: var(--info);
      flex: none;
      padding: 0 0 0 1px;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      color: var(--mark-fg);
      cursor: pointer;
    }
    .cal__grid :global(.cal__mark:hover) {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    /* Red is a REAL clash of people, and nothing else earns it. */
    .cal__grid :global(.cal__mark[data-severity='people']),
    .cal__grid :global(.cal__mark[data-severity='blackout']) {
      --mark-fg: var(--danger);
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

    .cal__grid :global(a.cal__event:hover),
    .cal__grid :global(.cal__event--openable:hover) {
      filter: brightness(0.97);
    }

    /* A date chip that can be opened (task 15). The hit target is a bare
       button stretched over the card — see DateChip for why it is a
       sibling and not a wrapper. It sits UNDER the monogram and OVER the
       text, which is inert anyway. */
    .cal__grid :global(.cal__event--openable) {
      position: relative;
      cursor: pointer;
    }
    .cal__grid :global(.cal__event-hit) {
      all: unset;
      position: absolute;
      inset: 0;
      cursor: pointer;
    }
    .cal__grid :global(.cal__event-hit:focus-visible) {
      outline: 2px solid var(--focus-ring, var(--text-color));
      outline-offset: -2px;
    }
    /* The monogram keeps its own click through the hit layer. */
    .cal__grid :global(.cal__event--openable .cal__markbtn) {
      position: relative;
      z-index: 1;
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
    /* RELEASED — was real, isn't any more (ADR-095 §0, the fourth certainty).
       It is kept as MEMORY, not dropped: what you let go of is the thing you
       most need to see when you look back at the month. Struck through and at
       the faintest ink, with a dotted edge — dotted is a fourth line style, so
       it can never be confused with held/proposed (dashed) or firm (solid).
       Before this rule existed `cancelled` fell into `proposed`, and then into
       the BASE chip style once it stopped being proposed — which is the
       confirmed look. A gig the company lost would have drawn as real. */
    .cal__grid :global(.cal__event[data-family='released']) {
      --chip-fg: var(--text-faint);
      --chip-bg: transparent;
      --chip-border-style: dotted;
    }
    .cal__grid :global(.cal__event[data-family='released'] .cal__event-name),
    .cal__grid :global(.cal__event[data-family='released'] .cal__event-time),
    .cal__grid :global(.cal__event[data-family='released'] .cal__event-city) {
      text-decoration: line-through;
      text-decoration-thickness: 1px;
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
    /* THE RUN NO LONGER BLEEDS INTO ITS NEIGHBOUR. It used to simulate a band
       with negative inline margins, which worked while the sheet was ONE flat
       grid of 42 cells: the bleed landed inside the next cell of the same grid.
       Now that a week is its own block, the bleed escapes the week and prints
       past the right edge of the sheet — visible on 2026-07-31 with a Sat→Sun
       rehearsal.
       The real fix is the law this drawing still owes: a thing that lasts more
       than a day is ONE element that spans columns (`grid-column: a / b`), not
       N chips glued edge to edge. Until that lands the run stays inside its own
       day, which is honest and does not lie about where the week ends. */
    .cal__grid :global(.cal__event--run) {
      margin-inline: 0;
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
    /* Reserved-but-empty lane: invisible, holds height only so the bands
       above/below keep their row across every day of the week. */
  }
</style>
