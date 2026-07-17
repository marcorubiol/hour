/**
 * Performance domain helpers — status → tone/label vocabulary and the
 * write contracts (ADR-043), in one place (same rationale as
 * $lib/engagement.ts).
 *
 * Tone mapping follows the show lifecycle reading documented on
 * StateBadge: proposed → neutral · holds → info · confirmed → success ·
 * invoiced → warning · paid/done → faint · cancelled → danger.
 */

import * as v from 'valibot';
import { Constants, type Enums } from './db-types';
import { realIsoDate } from './datetime';

export type PerformanceStatus = Enums<'performance_status'>;

export const PERFORMANCE_STATUSES = Constants.public.Enums.performance_status;

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'faint';

const TONES: Record<PerformanceStatus, StatusTone> = {
  proposed: 'neutral',
  hold: 'info',
  hold_1: 'info',
  hold_2: 'info',
  hold_3: 'info',
  confirmed: 'success',
  invoiced: 'warning',
  done: 'faint',
  paid: 'faint',
  cancelled: 'danger',
};

export function performanceStatusTone(status: string): StatusTone {
  return TONES[status as PerformanceStatus] ?? 'neutral';
}

/** UI label — holds keep their rank visible (hold 1 beats hold 3). */
export function performanceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

// Date-only contract — the one shared realIsoDate (see $lib/datetime).
const isoDateField = realIsoDate;

const isoInstantField = v.pipe(
  v.string(),
  v.check((s) => {
    const t = new Date(s).getTime();
    return !Number.isNaN(t);
  }, 'Not a valid timestamp'),
);

const countryField = v.pipe(v.string(), v.regex(/^[A-Za-z]{2}$/, 'ISO 3166 alpha-2'));

/**
 * POST /api/performances body (ADR-043). Creation goes through the
 * `create_performance` RPC — claim-independent, permission-gated
 * server-side, slug auto-generated with collision suffixes.
 */
export const PerformanceCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  performed_at: isoDateField,
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(countryField)),
  status: v.optional(v.picklist(PERFORMANCE_STATUSES)),
  engagement_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

export type PerformanceCreate = v.InferOutput<typeof PerformanceCreateSchema>;

/**
 * PATCH /api/performances/:key body. Whitelist of the operational fields
 * (status lifecycle, day, the 5 timeslots, denormalized venue trio,
 * engagement/line links). NO fee columns (edit:money trigger + Money
 * lens own the money path) and NO notes (the collab doc owns it,
 * ADR-042). Timeslot ordering is enforced by the DB CHECK — the endpoint
 * maps that violation to a 400.
 */
export const PerformancePatchSchema = v.object({
  status: v.optional(v.picklist(PERFORMANCE_STATUSES)),
  performed_at: v.optional(isoDateField),
  load_in_at: v.optional(v.nullable(isoInstantField)),
  soundcheck_at: v.optional(v.nullable(isoInstantField)),
  start_at: v.optional(v.nullable(isoInstantField)),
  loadout_at: v.optional(v.nullable(isoInstantField)),
  wrap_at: v.optional(v.nullable(isoInstantField)),
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(countryField)),
  venue_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  engagement_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

export type PerformancePatch = v.InferOutput<typeof PerformancePatchSchema>;
