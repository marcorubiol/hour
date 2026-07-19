/**
 * `date` domain helpers — the calendar primitive that is NOT a performance
 * (rehearsals, travel days, residencies, press, days off, other). Write
 * contracts for calendar v2 (ADR-072 §3/§4 + ADR-078), one home shared by
 * the /api/dates endpoints and the calendar UI — same rationale as
 * $lib/performance.ts.
 *
 * Contract highlights (ADR-078):
 * - status create-whitelist: tentative | confirmed only (§9 — the dialog's
 *   "Opció" pill; cancelled/done are lifecycle states and only ride PATCH).
 * - travel_direction only on kind='travel_day' (§6 — feeds `awayBands()`).
 * - label (free text) only on kind='other', stored at custom_fields.label
 *   (§8 — the explicit whitelist; nothing else writes custom_fields).
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { realIsoInstant } from './datetime';

export type DateKind = Enums<'date_kind'>;
export type DateStatus = Enums<'date_status'>;

export const DATE_KINDS = Constants.public.Enums.date_kind;
export const DATE_STATUSES = Constants.public.Enums.date_status;

/** ADR-078 §9: the enum of 4 is never exposed at creation. */
export const DATE_CREATE_STATUSES = ['tentative', 'confirmed'] as const;

/**
 * ADR-072 §4: outbound | return | leg, only on kind='travel_day'. TEXT +
 * CHECK in the DB, not an enum — the runtime vocabulary lives here (same
 * pattern as availability certainty).
 */
export const TRAVEL_DIRECTIONS = ['outbound', 'return', 'leg'] as const;

export type TravelDirection = (typeof TRAVEL_DIRECTIONS)[number];

/** The full `date` row, as the write endpoints return it. */
export type DateRow = Tables<'date'>;

const countryField = v.pipe(v.string(), v.regex(/^[A-Za-z]{2}$/, 'ISO 3166 alpha-2'));
const labelField = v.pipe(v.string(), v.trim(), v.maxLength(120));

/**
 * POST /api/dates body. Creation rides the `create_date` RPC —
 * claim-independent, gated on has_permission(project, 'edit:performance'),
 * which also re-enforces every cross-field rule below (strict AI=UI parity,
 * ADR-078 §7: no write path can bypass the contract).
 */
export const DateCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  kind: v.picklist(DATE_KINDS),
  starts_at: realIsoInstant,
  ends_at: v.optional(v.nullable(realIsoInstant)),
  all_day: v.optional(v.boolean()),
  title: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(countryField)),
  status: v.optional(v.picklist(DATE_CREATE_STATUSES)),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  performance_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  travel_direction: v.optional(v.nullable(v.picklist(TRAVEL_DIRECTIONS))),
  label: v.optional(v.nullable(labelField)),
});

export type DateCreate = v.InferOutput<typeof DateCreateSchema>;

/**
 * POST /api/dates/series body (ADR-084 §1) — a multi-day block: N days, one
 * series_id, created atomically by the `create_date_series` RPC.
 *
 * The caller sends the EXACT per-day timestamps. Venue-local hour entry is
 * already resolved client-side (ADR-078 §11); re-deriving "apply this time
 * to those days" server-side would give the two paths two chances to
 * disagree about a timezone. `ends` is either absent or the same length.
 *
 * No `travel_direction` and no `performance_id`: a direction belongs to one
 * travel row, and a block belongs to a project/line, not to a single gig.
 */
export const DateSeriesCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  kind: v.picklist(DATE_KINDS),
  starts: v.pipe(v.array(realIsoInstant), v.minLength(2), v.maxLength(92)),
  ends: v.optional(v.nullable(v.array(realIsoInstant))),
  all_day: v.optional(v.boolean()),
  title: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(countryField)),
  status: v.optional(v.picklist(DATE_CREATE_STATUSES)),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  label: v.optional(v.nullable(labelField)),
});

export type DateSeriesCreate = v.InferOutput<typeof DateSeriesCreateSchema>;

/**
 * PATCH /api/dates/:id body. Whitelist of the operational fields — direct
 * PostgREST PATCH (date_update is permission-gated, not claim-bound, and
 * the row stays SELECT-visible after a field edit; ADR-048 only bites
 * soft-deletes). Scope stays put: NO project_id/workspace_id (rescoping is
 * delete + recreate, the expense rule). `status` accepts the full lifecycle
 * here — cancelled/done are exactly the states an edit reaches (ADR-078 §9:
 * residency holds resolve as 1 confirmed + N cancelled). `label` is not a
 * column: the endpoint folds it into custom_fields (sole writer, §8).
 */
export const DatePatchSchema = v.object({
  kind: v.optional(v.picklist(DATE_KINDS)),
  status: v.optional(v.picklist(DATE_STATUSES)),
  starts_at: v.optional(realIsoInstant),
  ends_at: v.optional(v.nullable(realIsoInstant)),
  all_day: v.optional(v.boolean()),
  title: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(countryField)),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  performance_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  travel_direction: v.optional(v.nullable(v.picklist(TRAVEL_DIRECTIONS))),
  label: v.optional(v.nullable(labelField)),
});

export type DatePatch = v.InferOutput<typeof DatePatchSchema>;

/**
 * Date rows join the performance chip grammar (ADR-078 §9): tentative is a
 * possibility (outline), confirmed/done the quiet solid form, cancelled the
 * dashed leftover. Same three-shape vocabulary as
 * `performanceStatusFamily` — one grammar across both calendar primitives.
 */
export function dateStatusFamily(status: string): 'confirmed' | 'hold' | 'proposed' {
  if (status === 'confirmed' || status === 'done') return 'confirmed';
  if (status === 'tentative') return 'hold';
  return 'proposed';
}
