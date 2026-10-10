/**
 * THE STAGES OF A TRIP, as an editor sees them (ADR-089 P2, ADR-097).
 *
 * A travel day is `origin → destination` on the `date` row; the stages
 * (`travel_stage`) are the fine logistics in between: train, then car, then
 * walk. They are optional, and a trip without them is a whole answer.
 *
 * Pure functions only. The screen (`TravelStages.svelte`) and the endpoints
 * (`/api/dates/[id]/stages`) are the two callers. Hours are typed and read
 * with the running order's clock (`$lib/running-order`): one way to write
 * `20h30` in the whole day view.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { realIsoInstant } from './datetime';

export type TransportMode = Enums<'transport_mode'>;

/** The nine modes, in the enum's order (ADR-089: basics, last mile, sea). */
export const TRANSPORT_MODES: readonly TransportMode[] = Constants.public.Enums.transport_mode;

/** What the screen reads of a stage. The scope columns stay server-side. */
export type TravelStageRow = Pick<
  Tables<'travel_stage'>,
  | 'id'
  | 'position'
  | 'mode'
  | 'from_city'
  | 'from_country'
  | 'from_place'
  | 'to_city'
  | 'to_country'
  | 'to_place'
  | 'depart_at'
  | 'arrive_at'
  | 'depart_tz'
  | 'arrive_tz'
  | 'from_venue_id'
  | 'to_venue_id'
  | 'reference'
  | 'notes'
>;

export const STAGE_SELECT =
  'id,position,mode,from_city,from_country,from_place,to_city,to_country,to_place,depart_at,arrive_at,depart_tz,arrive_tz,from_venue_id,to_venue_id,reference,notes';

const text = (max: number) => v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(max)));

const country = v.nullable(v.pipe(v.string(), v.regex(/^[A-Za-z]{2}$/, 'ISO 3166 alpha-2')));

/** The shape of an IANA name. Whether the zone EXISTS is the RPC's call
    (`travel_stage_zone`, against `pg_timezone_names`). */
const zone = v.nullable(
  v.pipe(v.string(), v.trim(), v.maxLength(64), v.regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/, 'an IANA zone')),
);

/**
 * One stage as the editor sends it, WHOLE: `update_travel_stage` replaces
 * the row, so what is not sent is emptied (ADR-097). Countries are not
 * edited here yet; the RPC leaves them null.
 */
export const StageInputSchema = v.pipe(
  v.object({
    mode: v.picklist(TRANSPORT_MODES),
    from_city: text(120),
    /** ISO-2, from the place picked (`$lib/places`). */
    from_country: v.optional(country, null),
    from_place: text(200),
    to_city: text(120),
    to_country: v.optional(country, null),
    to_place: text(200),
    depart_at: v.nullable(realIsoInstant),
    arrive_at: v.nullable(realIsoInstant),
    /** Null = the space's clock (20261010160000). */
    depart_tz: v.optional(zone, null),
    arrive_tz: v.optional(zone, null),
    /** A venue of the trip's space (the RPC refuses any other). */
    from_venue_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
    to_venue_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
    reference: text(120),
    notes: v.nullable(v.pipe(v.string(), v.maxLength(5000))),
  }),
  v.check(
    (s) =>
      !s.depart_at || !s.arrive_at || new Date(s.arrive_at).getTime() >= new Date(s.depart_at).getTime(),
    'a stage cannot arrive before it departs',
  ),
);

export type StageInput = v.InferOutput<typeof StageInputSchema>;

/** The RPC's named arguments for a stage (create and update share them). */
export function stageRpcArgs(s: StageInput): Record<string, unknown> {
  return {
    p_mode: s.mode,
    p_from_city: s.from_city || null,
    p_from_country: s.from_country || null,
    p_from_place: s.from_place || null,
    p_to_city: s.to_city || null,
    p_to_country: s.to_country || null,
    p_to_place: s.to_place || null,
    p_depart_at: s.depart_at,
    p_arrive_at: s.arrive_at,
    p_depart_tz: s.depart_tz || null,
    p_arrive_tz: s.arrive_tz || null,
    p_from_venue_id: s.from_venue_id || null,
    p_to_venue_id: s.to_venue_id || null,
    p_reference: s.reference || null,
    p_notes: s.notes?.trim() || null,
  };
}

// ── Zones (20261010160000) ─────────────────────────────────────────────

/** `Europe/London` → `London`, `America/New_York` → `New York`. */
export function zoneLabel(tz: string): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

/** What to store: the space's own zone is NULL (it is what NULL means). */
export function storedZone(tz: string | null | undefined, spaceTz: string): string | null {
  const z = tz?.trim();
  return z && z !== spaceTz ? z : null;
}

/**
 * The zones a line must say, or null: only the ends whose clock is not the
 * space's. `→ London` (lands elsewhere), `Lisbon →`, `Lisbon → London`.
 */
export function zoneNote(
  s: Pick<TravelStageRow, 'depart_tz' | 'arrive_tz'>,
  spaceTz: string,
): string | null {
  const a = storedZone(s.depart_tz, spaceTz);
  const b = storedZone(s.arrive_tz, spaceTz);
  if (!a && !b) return null;
  if (a && b) return a === b ? zoneLabel(a) : `${zoneLabel(a)} → ${zoneLabel(b)}`;
  return a ? `${zoneLabel(a)} →` : `→ ${zoneLabel(b as string)}`;
}

/** A stage's end, as one word: the place if somebody named it, else the city. */
export function stagePlace(city: string | null, place: string | null): string | null {
  return place || city || null;
}

/**
 * WHERE A NEW STAGE LEAVES FROM: where the stage before it arrived, else
 * where the trip starts. Nobody types «Madrid» twice to change from the
 * train to the car; the chain fills it, and the person overwrites it only
 * when the trip jumps (a night in a hotel, a different station).
 *
 * «Before it» is where its departure will put it (`placeStage`'s law): a
 * stage typed at 9h30 on a list that starts at 10h leaves from the trip's
 * origin, not from wherever the 10h one arrives. Without an hour it goes at
 * the end, after the last stage.
 */
export function chainedFrom(
  stages: ReadonlyArray<
    Pick<TravelStageRow, 'to_city' | 'to_place'> & {
      depart_at?: string | null;
      arrive_tz?: string | null;
      to_country?: string | null;
      to_venue_id?: string | null;
    }
  >,
  tripOrigin: string | null,
  departAt: string | null = null,
): { city: string | null; place: string | null; country: string | null; tz: string | null; venueId: string | null } {
  let at = stages.length;
  if (departAt) {
    const t = new Date(departAt).getTime();
    const later = stages.findIndex((s) => s.depart_at != null && new Date(s.depart_at).getTime() > t);
    if (later >= 0) at = later;
  }
  const prev = stages[at - 1];
  // A stage leaves in the clock the one before it arrived in: the plane
  // landed in London, so the taxi leaves on London time.
  const tz = prev?.arrive_tz ?? null;
  if (prev && (prev.to_city || prev.to_place)) {
    return {
      city: prev.to_city,
      place: prev.to_place,
      country: prev.to_country ?? null,
      tz,
      venueId: prev.to_venue_id ?? null,
    };
  }
  return { city: tripOrigin, place: null, country: null, tz, venueId: null };
}

/**
 * Where a stage belongs, by its departure: the ids in their new order.
 *
 * Only `id` moves (the others keep the order somebody gave them), the same
 * law as the running order's `placeByTime`. A stage without an hour stays
 * where it is: an unknown departure is not «before everything». Equal hours
 * keep arrival order: the moved one goes after the ones already there.
 */
export function placeStage(
  stages: ReadonlyArray<Pick<TravelStageRow, 'id' | 'position' | 'depart_at'>>,
  id: string,
): string[] {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const me = sorted.find((s) => s.id === id);
  const ids = sorted.map((s) => s.id);
  if (!me || !me.depart_at) return ids;
  const t = new Date(me.depart_at).getTime();
  const rest = sorted.filter((s) => s.id !== id);
  const at = rest.findIndex((s) => s.depart_at !== null && new Date(s.depart_at).getTime() > t);
  const out = rest.map((s) => s.id);
  if (at < 0) {
    // Nothing timed departs later: it goes after the last timed stage, and
    // if it already sits further down (behind untimed stages placed there by
    // hand), it stays put.
    let lastTimed = -1;
    rest.forEach((s, i) => {
      if (s.depart_at !== null) lastTimed = i;
    });
    out.splice(Math.max(lastTimed + 1, ids.indexOf(id)), 0, id);
    return out;
  }
  out.splice(at, 0, id);
  return out;
}

/** True when two id lists are the same order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
