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
 *
 * Pure module: the endpoint fetches the bundle, this filters it. Keep it
 * dependency-free so it stays unit-testable.
 */

import type { Json, Tables } from './db-types';

export const ROADSHEET_ROLES = ['full', 'venue', 'performer', 'tech_manager'] as const;
export type RoadsheetRole = (typeof ROADSHEET_ROLES)[number];

export type RoadsheetSection =
  | 'schedule'
  | 'venue'
  | 'logistics'
  | 'hospitality'
  | 'technical'
  | 'cast'
  | 'crew'
  | 'contacts'
  | 'notes'
  | 'assets';

export const ROLE_SECTIONS: Record<RoadsheetRole, readonly RoadsheetSection[]> = {
  full: [
    'schedule',
    'venue',
    'logistics',
    'hospitality',
    'technical',
    'cast',
    'crew',
    'contacts',
    'notes',
    'assets',
  ],
  venue: ['schedule', 'venue', 'technical', 'cast', 'crew'],
  performer: ['schedule', 'venue', 'logistics', 'hospitality', 'cast', 'crew'],
  tech_manager: ['schedule', 'venue', 'logistics', 'technical', 'cast', 'crew', 'assets'],
};

const PERSONAL_CONTACTS: ReadonlySet<RoadsheetRole> = new Set(['full', 'tech_manager']);

/** Person subset as embedded by the detail endpoint. */
export interface RoadsheetPerson {
  full_name: string;
  email?: string | null;
  phone?: string | null;
}

export interface CrewEntry {
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

export interface AssetEntry {
  kind: Tables<'asset_version'>['kind'];
  direction: Tables<'asset_version'>['direction'];
  notes: string | null;
  uploaded_at: string | null;
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
    | 'load_in_at'
    | 'soundcheck_at'
    | 'start_at'
    | 'loadout_at'
    | 'wrap_at'
    | 'notes'
  > & {
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
  } | null;
  venue: VenueBlock | null;
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
}

export function isRoadsheetRole(value: string): value is RoadsheetRole {
  return (ROADSHEET_ROLES as readonly string[]).includes(value);
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
        }
      : null,
    venue: has('venue') ? bundle.venue : null,
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
    assets: has('assets') ? bundle.assets : null,
  };
}
