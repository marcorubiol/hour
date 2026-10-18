/**
 * Planner engine — the derived layer of /h/planner, out of the page so a
 * second drawing (the season overview, ADR-117) can read the same answers.
 *
 * `createPlannerEngine` turns the rows the page already narrowed (scope +
 * person axis) into the conflict list, the derived tours, the window census
 * and the decisions queue. It owns no fetch and no word: the feeds stay in
 * `$lib/planner-feeds.svelte`, the filters and every `t()` in the page.
 *
 * Same contract as the feeds: called synchronously from component init,
 * every input a GETTER, so the `$derived`s below keep tracking the page's
 * state across the module boundary. The result exposes getters too — read
 * them as `engine.conflicts`, never destructure (that would freeze them).
 */
import {
  awayBands,
  conflictsFor,
  tourTrips,
  daysCoveredBy,
  decisionsFor,
  nightsFree,
  type DecisionPerformance,
  type PlannerEvent,
} from '$lib/planner';
import { dateDayKey, perfDayKey, type DateEvent, type PerformanceEvent } from '$lib/month-events';
import { performanceStatusFamily } from '$lib/performance';
import { hourMark, timeInTz } from '$lib/datetime';
import type { AvailabilityItem } from '$lib/availability';
import type { DateRow } from '$lib/date';
import type { DecisionPerfItem } from '$lib/planner-feeds.svelte';

/** The stretch a census counts: first and last ISO day, and every day between. */
export interface EngineWindow {
  first: string;
  last: string;
  days: string[];
}

export interface PlannerEngineInputs {
  /** Rows after scope + person narrowing — what the engine reasons over. */
  scopedPerfs: () => PerformanceEvent[];
  scopedDates: () => DateEvent[];
  /** Rows as they arrive, unnarrowed: nobody is free because you hid a project. */
  rawPerfs: () => PerformanceEvent[];
  rawDates: () => DateEvent[];
  /** Every block RLS lets through — the conflict engine reads all of them. */
  allBlackouts: () => AvailabilityItem[];
  /** The scope's blocks, empty under calm — what the census counts. */
  visibleBlackouts: () => AvailabilityItem[];
  /** The window the census counts (the month, or the season horizon). */
  window: () => EngineWindow;
  /** Decisions-window rows, already scope-filtered. */
  decisionPerfs: () => DecisionPerfItem[];
  viewerTz: string;
  todayIso: string;
}

export function createPlannerEngine(inputs: PlannerEngineInputs) {
  const { viewerTz, todayIso } = inputs;

  // ── Conflict engine (ADR-072 §1) — over the UNFILTERED scoped rows:
  // hiding chips behind calm never hides a real clash. ──────────────────
  const engineEvents = $derived.by(() => {
    const out: PlannerEvent[] = [];
    for (const p of inputs.scopedPerfs()) {
      if (p.status === 'cancelled' || !p.project) continue;
      out.push({
        id: p.id,
        day: perfDayKey(p),
        project_id: p.project.id,
        workspace_id: p.project.workspace_id,
      });
    }
    for (const d of inputs.scopedDates()) {
      if (d.status === 'cancelled' || !d.project) continue;
      out.push({
        id: d.id,
        day: dateDayKey(d, viewerTz),
        project_id: d.project.id,
        workspace_id: d.project.workspace_id,
      });
    }
    return out;
  });
  const rosters = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const p of inputs.scopedPerfs()) {
      if (p.person_ids) map[p.id] = p.person_ids;
    }
    return map;
  });
  /** ADR-103 — whoever said «voy»: on the event for the engine, even on a
      date, which has no roster of its own. */
  const committed = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const row of [...inputs.scopedPerfs(), ...inputs.scopedDates()]) {
      const going = (row.commitments ?? [])
        .filter((c) => c.state === 'going')
        .map((c) => c.person_id);
      if (going.length > 0) map[row.id] = going;
    }
    return map;
  });
  const conflicts = $derived(conflictsFor(engineEvents, rosters, inputs.allBlackouts(), committed));
  const eventDayById = $derived(new Map(engineEvents.map((e) => [e.id, e.day])));

  // ── Derived away bands (ADR-078 §6) — display-only inference. ────────
  const ownEventDays = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const e of engineEvents) {
      (map[e.project_id] ??= []).push(e.day);
    }
    return map;
  });
  const travels = $derived.by(() => {
    const travels: Array<
      Pick<DateRow, 'id' | 'project_id' | 'line_id' | 'kind' | 'travel_direction' | 'starts_at'>
    > = [];
    for (const d of inputs.scopedDates()) {
      if (d.kind !== 'travel_day' || d.status === 'cancelled' || !d.project) continue;
      travels.push({
        id: d.id,
        project_id: d.project.id,
        line_id: d.line_id ?? null,
        kind: 'travel_day',
        travel_direction: d.travel_direction ?? null,
        starts_at: d.starts_at,
      });
    }
    return travels;
  });
  const aways = $derived(awayBands(travels, ownEventDays));
  /** Whole trips, gig days included — what the Season calls a tour. */
  const trips = $derived(tourTrips(travels));

  /** Every day something of the company's own sits on — unnarrowed and
      uncancelled. Shared by nights free and the season's gaps. */
  const occupiedDays = $derived.by(() => {
    const occupied = new Set<string>();
    for (const p of inputs.rawPerfs()) {
      if (p.status === 'cancelled') continue;
      occupied.add(perfDayKey(p));
    }
    for (const d of inputs.rawDates()) {
      if (d.status === 'cancelled') continue;
      occupied.add(dateDayKey(d, viewerTz));
    }
    return occupied;
  });

  const tourDays = $derived(daysCoveredBy(aways));
  /** The census's rule for one night: from today, nothing of the company's
      own on it, not on tour. The agenda's weekly tally asks this too. */
  function isFreeNight(day: string): boolean {
    return day >= todayIso && !occupiedDays.has(day) && !tourDays.has(day);
  }

  // ── Census — counts of the window, every figure a real row (ADR-078
  // §12; no read:money gate — nothing monetary here). ───────────────────
  const stats = $derived.by(() => {
    const { first, last, days } = inputs.window();
    let confirmed = 0;
    let holds = 0;
    for (const p of inputs.scopedPerfs()) {
      const day = perfDayKey(p);
      if (day < first || day > last) continue;
      const family = performanceStatusFamily(p.status);
      if (family === 'confirmed') confirmed++;
      // A PROPOSAL IS AN OPTION ON PAPER: every drawing gives it the grain and
      // the `?` of a hold, and the agenda's week and the board already counted
      // it so. The census was the one that left it out (revisión, 2026-10-18).
      else if (family === 'hold' || family === 'proposed') holds++;
    }
    let conflictCount = 0;
    for (const c of conflicts) {
      const day = eventDayById.get(c.event_ids[0]);
      if (day && day >= first && day <= last) conflictCount++;
    }
    let blackoutCount = 0;
    for (const b of inputs.visibleBlackouts()) {
      if (b.starts_on <= last && b.ends_on >= first) blackoutCount++;
    }

    /* NIGHTS FREE — inventory unsold, and the only figure here that is about
       the business rather than the calendar.
       Two things it must get right, and both are easy to miss:
       · Availability IGNORES the narrowing. Nobody is free because you hid the
         project that is occupying them — so this walks the raw rows, as they
         arrive, not the scoped ones.
       · A NIGHT ON TOUR IS NOT A FREE NIGHT: between an outbound leg and its
         return there is nothing of its own on the calendar and still nothing
         to sell, because the company is 1.200km from home.
       HONEST LIMIT, written where the cost goes: with project pins set, the
       server already filtered the unpinned rows out before they reached the
       browser (`/api/performances` narrows by project_ids ∪ workspace_ids), so
       what arrives is the widest set this page CAN see, not the widest that
       exists. The counter can therefore still read high under a project pin.
       The fix is an unfiltered availability feed — the precedent is the
       blackouts, already fetched without a workspace filter for exactly this
       reason. */
    // FROM TODAY: a night already lived is not for sale (revisión del
    // Planner, 2026-10-18 — October said 27 with 18 days gone).
    const free = nightsFree(
      days.filter((d) => d >= todayIso),
      occupiedDays,
      tourDays,
    );

    return { confirmed, holds, conflicts: conflictCount, blackouts: blackoutCount, free };
  });

  // ── Decisions queue (ADR-080 §1/§4) — derived, nothing stored. ───────
  const decisionPerfById = $derived(new Map(inputs.decisionPerfs().map((p) => [p.id, p])));
  const decisionRosters = $derived.by(() => {
    const map: Record<string, string[]> = {};
    for (const p of inputs.decisionPerfs()) {
      if (p.person_ids) map[p.id] = p.person_ids;
    }
    return map;
  });
  const decisionInput = $derived.by((): DecisionPerformance[] => {
    const rows: DecisionPerformance[] = [];
    for (const p of inputs.decisionPerfs()) {
      if (!p.project) continue;
      rows.push({
        id: p.id,
        day: perfDayKey(p),
        project_id: p.project.id,
        workspace_id: p.project.workspace_id,
        status: p.status,
        hold_notice_days: p.hold_notice_days ?? null,
        project: p.project.name,
        venue: p.venue?.name ?? p.venue_name,
        city: p.venue?.city ?? p.city,
        time: p.start_at ? hourMark(timeInTz(p.start_at, p.venue?.timezone || viewerTz)) : null,
      });
    }
    return rows;
  });
  const decisionQueue = $derived(
    decisionsFor({
      performances: decisionInput,
      rosters: decisionRosters,
      today: todayIso,
    }),
  );

  return {
    get engineEvents() {
      return engineEvents;
    },
    get conflicts() {
      return conflicts;
    },
    get eventDayById() {
      return eventDayById;
    },
    get aways() {
      return aways;
    },
    get trips() {
      return trips;
    },
    get occupiedDays() {
      return occupiedDays;
    },
    get stats() {
      return stats;
    },
    isFreeNight,
    get decisionPerfById() {
      return decisionPerfById;
    },
    get decisionRosters() {
      return decisionRosters;
    },
    get decisionQueue() {
      return decisionQueue;
    },
  };
}
