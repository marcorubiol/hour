/**
 * Road sheet domain — role-filtered projection over a performance bundle
 * (ADR-023: the road sheet is NOT an entity, it's a view over
 * `performance` + junctions, rendered differently per viewer role).
 *
 * The ?role= vocabulary comes from ADR-023 (`venue | performer |
 * tech_manager`) plus `full` for the operator view. ADR-023 left the exact
 * field matrix "finalized at implementation" — this module IS that first
 * implementation (ADR-041, provisional until lived-in):
 *
 *   - Fee/money NEVER appears on a road sheet, any role. Money lives in
 *     the Money lens behind `read:money`; an operational document handed
 *     around a venue is the wrong place for it.
 *   - `hospitality` (per-diem, dietary, dressing rooms) is for the
 *     travelling party: full + performer. Not the venue's business.
 *   - `logistics` mixes venue-facing data (parking, freight) with the
 *     company's own (accommodation, travel) in ONE jsonb — until the
 *     shapes split, the venue role does NOT get it. Conservative by
 *     default: leaking the company's hotel to a venue is worse than the
 *     venue asking about parking.
 *   - `technical` is for whoever builds the show: full + tech_manager +
 *     venue (their stage).
 *   - Personal contact data (email/phone/contact_override) only for
 *     full + tech_manager — they coordinate people. Venue and performer
 *     see names + roles.
 *   - `notes` (free text) and the programmer block (conversation person)
 *     are internal: full only.
 *   - `assets` list for full + tech_manager (riders/plots are theirs);
 *     URLs are R2 keys with no public serving in Phase 0, so only
 *     metadata travels.
 *   - `materials` (88) are the outbound links of the performance and of its
 *     line, which the public sheet reads (`get_public_roadsheet`): the
 *     rider and the plot are what a venue needs, so every role gets them.
 *     Only what the company sends out, never what it received.
 *   - `travel` (ADR-166) is the travelling party's: full + performer +
 *     tech_manager, never the venue. The trips of the performance's day and
 *     its eve, of the same project (`tripsOfPerformance`), with their timed
 *     stages; who goes is only who said «voy» (ADR-147), never the cast.
 *
 * Pure module: the endpoint fetches the bundle, this filters it. Keep it
 * dependency-free so it stays unit-testable.
 */

import type { Json, Tables } from './db-types';
import type { ScheduleMoment, TimeslotFields } from './schedule-slot';
import { localDayISO } from './datetime';
import { addDaysIso, dayKeyInTz } from './planner';
import type { TravelStageRow } from './travel-stage';

export const ROADSHEET_ROLES = ['full', 'venue', 'performer', 'tech_manager'] as const;
export type RoadsheetRole = (typeof ROADSHEET_ROLES)[number];

type RoadsheetSection =
  | 'schedule'
  | 'venue'
  | 'travel'
  | 'logistics'
  | 'hospitality'
  | 'technical'
  | 'cast'
  | 'crew'
  | 'contacts'
  | 'notes'
  | 'assets'
  | 'materials';

export const ROLE_SECTIONS: Record<RoadsheetRole, readonly RoadsheetSection[]> = {
  full: [
    'schedule',
    'venue',
    'travel',
    'logistics',
    'hospitality',
    'technical',
    'cast',
    'crew',
    'contacts',
    'notes',
    'assets',
    'materials',
  ],
  venue: ['schedule', 'venue', 'technical', 'cast', 'crew', 'materials'],
  performer: ['schedule', 'venue', 'travel', 'logistics', 'hospitality', 'cast', 'crew', 'materials'],
  tech_manager: ['schedule', 'venue', 'travel', 'logistics', 'technical', 'cast', 'crew', 'assets', 'materials'],
};

const PERSONAL_CONTACTS: ReadonlySet<RoadsheetRole> = new Set(['full', 'tech_manager']);

/** Person subset as embedded by the detail endpoint. */
export interface RoadsheetPerson {
  full_name: string;
  email?: string | null;
  phone?: string | null;
}

interface CrewEntry {
  role: string;
  person: RoadsheetPerson | null;
  contact_override?: Json | null;
  notes?: string | null;
}

export interface CastEntry {
  role: string;
  person: RoadsheetPerson | null;
  /** Set on overrides: who this entry replaces for this performance. */
  replaces?: string | null;
  reason?: string | null;
}

interface AssetEntry {
  kind: Tables<'asset_version'>['kind'];
  direction: Tables<'asset_version'>['direction'];
  notes: string | null;
  uploaded_at: string | null;
}

/**
 * A material the company sends out, with its link (88): the performance's
 * own and its line's, outbound only, http(s) only. `scope` says which.
 */
export interface RoadsheetMaterial {
  kind: Tables<'asset_version'>['kind'];
  url: string;
  uploaded_at: string | null;
  scope: 'performance' | 'line';
}

/** What a link says of itself on the sheet: its host (`drive.google.com`), else the link. */
export function materialHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export interface VenueBlock {
  name: string;
  city: string | null;
  country: string | null;
  address: string | null;
  capacity: number | null;
  timezone: string | null;
  /** Venue contacts jsonb — venue-side coordination data, not person PII. */
  contacts: Json;
}

/** What a sheet draws of a stage: the line Ahora draws (ADR-146), no more. */
export type RoadsheetStage = Pick<
  TravelStageRow,
  | 'mode'
  | 'from_city'
  | 'from_place'
  | 'to_city'
  | 'to_place'
  | 'depart_at'
  | 'arrive_at'
  | 'depart_tz'
  | 'arrive_tz'
  | 'reference'
>;

/**
 * A trip on the sheet (ADR-166). `tz` is the trip's venue zone: the clock of
 * a stage end that names none, as in Ahora. `going` is who said «voy» to it,
 * by name; empty is a company trip, and nobody is guessed (ADR-147).
 */
export interface RoadsheetTrip {
  id: string;
  title: string | null;
  starts_at: string;
  all_day: boolean;
  origin_city: string | null;
  destination_city: string | null;
  tz: string | null;
  /** The stages with an hour, in time order (`timedStages`). */
  stages: RoadsheetStage[];
  going: string[];
}

/** A `date` row as the sheet's endpoint reads it, before the cut. */
export interface TripRow {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  origin_city: string | null;
  destination_city: string | null;
  venue: { timezone: string | null } | null;
  stages: TravelStageRow[] | null;
  commitments: Array<{ person_id: string; state: string }> | null;
}

/** Local day of an instant; an all-day row keeps its stored day (`dateDayKey`). */
function tripDay(at: string, allDay: boolean, tz: string): string {
  return allDay ? at.slice(0, 10) : dayKeyInTz(at, tz);
}

/**
 * WHICH TRIP IS «OF THIS PERFORMANCE» (ADR-166 § 2): a `travel_day` of the
 * same project (the endpoint asks for that), not cancelled, that touches the
 * performance's day or the day before. A trip's days are read on its own
 * venue's clock, else on the performance's (UTC when neither has a zone);
 * an all-day trip keeps its stored days, as the Planner does. Touching: it starts on one of them, or starts
 * before and is still running on the eve. The way home the day after is the
 * next sheet's business, or nobody's.
 *
 * `names` maps a person id to the name the space knows them by; a «voy»
 * without a name in the space is left out rather than shown as an id.
 */
export function tripsOfPerformance(
  rows: readonly TripRow[],
  performedAt: string,
  zone: string | null,
  names: ReadonlyMap<string, string>,
): RoadsheetTrip[] {
  const tz = zone || 'UTC';
  const day = performedAt.slice(0, 10);
  const eve = addDaysIso(day, -1);
  return rows
    .filter((r) => r.kind === 'travel_day' && r.status !== 'cancelled')
    .filter((r) => {
      const own = r.venue?.timezone || tz;
      const first = tripDay(r.starts_at, r.all_day, own);
      const end = r.ends_at ? tripDay(r.ends_at, r.all_day, own) : first;
      const last = end > first ? end : first;
      return first <= day && last >= eve;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .map((r) => ({
      id: r.id,
      title: r.title,
      starts_at: r.starts_at,
      all_day: r.all_day,
      origin_city: r.origin_city,
      destination_city: r.destination_city,
      tz: r.venue?.timezone ?? null,
      stages: [...(r.stages ?? [])]
        .filter((s) => s.depart_at && Number.isFinite(Date.parse(s.depart_at)))
        .sort((a, b) => Date.parse(a.depart_at!) - Date.parse(b.depart_at!))
        .map((s) => ({
          mode: s.mode,
          from_city: s.from_city,
          from_place: s.from_place,
          to_city: s.to_city,
          to_place: s.to_place,
          depart_at: s.depart_at,
          arrive_at: s.arrive_at,
          depart_tz: s.depart_tz,
          arrive_tz: s.arrive_tz,
          reference: s.reference,
        })),
      going: (r.commitments ?? [])
        .filter((c) => c.state === 'going')
        .map((c) => names.get(c.person_id))
        .filter((n): n is string => Boolean(n)),
    }));
}

export interface PerformanceBundle {
  performance: Pick<
    Tables<'performance'>,
    | 'id'
    | 'slug'
    | 'performed_at'
    | 'status'
    | 'venue_name'
    | 'city'
    | 'country'
    | 'notes'
  > &
    // ADR-090: derived from `schedule_slot` by the bundle.
    TimeslotFields & {
    /** ADR-090 P3: the whole order. Absent from the public projection. */
    schedule?: ScheduleMoment[];
    logistics: Json;
    hospitality: Json;
    technical: Json;
  };
  project: { name: string; slug: string } | null;
  venue: VenueBlock | null;
  programmer: RoadsheetPerson | null;
  cast: CastEntry[];
  crew: CrewEntry[];
  assets: AssetEntry[];
  /** The outbound links of the performance and its line (88); absent = not read. */
  materials?: RoadsheetMaterial[];
  /** The trips of the day and its eve (`tripsOfPerformance`); absent = not read. */
  travel?: RoadsheetTrip[];
}

export interface Roadsheet {
  role: RoadsheetRole;
  sections: readonly RoadsheetSection[];
  title: string;
  performed_at: string;
  status: string;
  project: { name: string; slug: string } | null;
  schedule: {
    load_in_at: string | null;
    soundcheck_at: string | null;
    start_at: string | null;
    loadout_at: string | null;
    wrap_at: string | null;
    /** ADR-090 P3: the whole running order. The public projection carries it
        too since 20261010180000; a sheet without it falls back to the five. */
    moments?: ScheduleMoment[];
  } | null;
  venue: VenueBlock | null;
  /** ADR-166. On the public sheet since 20261102150000: `get_public_roadsheet`
      sends the trips already cut, for performer and tech_manager only. */
  travel?: RoadsheetTrip[] | null;
  /** Denormalized fallback when there is no venue row. */
  venue_name: string | null;
  city: string | null;
  country: string | null;
  logistics: Json | null;
  hospitality: Json | null;
  technical: Json | null;
  cast: CastEntry[] | null;
  crew: CrewEntry[] | null;
  contacts: { programmer: RoadsheetPerson } | null;
  notes: string | null;
  assets: AssetEntry[] | null;
  /** 88: the links the company sends out. The same section as `assets` on screen. */
  materials?: RoadsheetMaterial[] | null;
}

export function isRoadsheetRole(value: string): value is RoadsheetRole {
  return (ROADSHEET_ROLES as readonly string[]).includes(value);
}

/** Workspace roles that are the company's own crew (`is_workspace_internal_member`). */
const INTERNAL_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member', 'viewer']);

/**
 * WHO MAY READ THE WHOLE SHEET (ADR-146 § 6). `full` carries the company's
 * internal notes and the programmer: it is for the space's own crew. Anyone
 * else asking for it — a bolo guest (ADR-142), or a login with no membership
 * row in the space — gets the technician's cut, `tech_manager`: schedule,
 * venue, logistics, technical, crew and cast with phones, never notes and
 * never money. The other roles are previews and only ever show less, so
 * they pass as asked. The server applies it; the screen only asks.
 */
export function roadsheetRoleFor(
  requested: RoadsheetRole,
  workspaceRole: string | null | undefined,
): RoadsheetRole {
  if (requested !== 'full') return requested;
  return workspaceRole && INTERNAL_ROLES.has(workspaceRole) ? 'full' : 'tech_manager';
}

function stripPerson(p: RoadsheetPerson | null): RoadsheetPerson | null {
  return p ? { full_name: p.full_name } : null;
}

function filterCrew(crew: CrewEntry[], withContacts: boolean): CrewEntry[] {
  if (withContacts) return crew;
  return crew.map(({ role, person }) => ({ role, person: stripPerson(person) }));
}

function filterCast(cast: CastEntry[], withContacts: boolean): CastEntry[] {
  if (withContacts) return cast;
  return cast.map(({ role, person, replaces, reason }) => ({
    role,
    person: stripPerson(person),
    replaces,
    reason,
  }));
}

/** An http(s) link only: the sheet is handed around, a stored `javascript:` must not travel. */
const HTTP_LINK = /^https?:\/\//i;

/**
 * The performance's own assets that a material already shows with its link
 * are not listed twice: same kind, same upload, outbound.
 */
function assetsBesideMaterials(assets: AssetEntry[], materials: readonly RoadsheetMaterial[]): AssetEntry[] {
  const linked = new Set(
    materials.filter((m) => m.scope === 'performance').map((m) => `${m.kind}|${m.uploaded_at}`),
  );
  return assets.filter((a) => !(a.direction === 'outbound' && linked.has(`${a.kind}|${a.uploaded_at}`)));
}

/**
 * Project the bundle down to what `role` gets to see. Sections outside the
 * role's list come back null — the page renders only non-null sections,
 * and the server never ships the hidden data.
 */
export function buildRoadsheet(bundle: PerformanceBundle, role: RoadsheetRole): Roadsheet {
  const sections = ROLE_SECTIONS[role];
  const has = (s: RoadsheetSection) => sections.includes(s);
  const withContacts = PERSONAL_CONTACTS.has(role);
  const p = bundle.performance;
  const materials = has('materials') ? (bundle.materials ?? []).filter((m) => HTTP_LINK.test(m.url)) : null;

  return {
    role,
    sections,
    title: bundle.venue?.name ?? p.venue_name ?? bundle.project?.name ?? 'Performance',
    performed_at: p.performed_at,
    status: p.status,
    project: bundle.project,
    schedule: has('schedule')
      ? {
          load_in_at: p.load_in_at,
          soundcheck_at: p.soundcheck_at,
          start_at: p.start_at,
          loadout_at: p.loadout_at,
          wrap_at: p.wrap_at,
          moments: p.schedule,
        }
      : null,
    venue: has('venue') ? bundle.venue : null,
    travel: has('travel') ? (bundle.travel ?? []) : null,
    venue_name: has('venue') ? p.venue_name : null,
    city: has('venue') ? p.city : null,
    country: has('venue') ? p.country : null,
    logistics: has('logistics') ? p.logistics : null,
    hospitality: has('hospitality') ? p.hospitality : null,
    technical: has('technical') ? p.technical : null,
    cast: has('cast') ? filterCast(bundle.cast, withContacts) : null,
    crew: has('crew') ? filterCrew(bundle.crew, withContacts) : null,
    contacts:
      has('contacts') && bundle.programmer ? { programmer: bundle.programmer } : null,
    notes: has('notes') ? p.notes : null,
    // An asset's note is the company's own (the sheet never draws it): only `full` carries it.
    assets: has('assets')
      ? assetsBesideMaterials(bundle.assets, materials ?? []).map((a) => (role === 'full' ? a : { ...a, notes: null }))
      : null,
    materials,
  };
}

// ── Public links: when they stop opening (ADR-163 § 2) ─────────────────────

/** A public road sheet link as `/api/performances/:key/roadsheet/shares` returns it. */
export interface RoadsheetShare {
  id: string;
  token: string;
  role: string;
  created_at: string;
  /** The first instant the link no longer opens. */
  expires_at: string;
}

/** The last day the link opens (`YYYY-MM-DD`, this device's day): the instant before it expires. */
export function shareLastDay(expiresAt: string): string {
  return localDayISO(new Date(Date.parse(expiresAt) - 1));
}

/** Whether the link no longer opens. */
export function shareExpired(expiresAt: string, now: Date = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}
