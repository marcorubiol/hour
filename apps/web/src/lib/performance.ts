/**
 * Performance domain helpers — status → tone/label vocabulary and the
 * write contracts (ADR-043), in one place (same rationale as
 * $lib/conversation.ts).
 *
 * Tone mapping follows the show lifecycle reading documented on
 * StateBadge: proposed → neutral · holds → info · confirmed → success ·
 * invoiced → warning · paid/done → faint · cancelled → danger.
 */

import * as v from 'valibot';
import { addDaysIso } from './planner';
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

/**
 * The chip grammar's three shapes (ADR-072 §5 / ADR-078): solid =
 * commitment (confirmed and its aftermath), outline = possibility held
 * (hold*), dashed = intention (proposed; cancelled joins it as the only
 * remaining honest non-solid rendering). Unknown statuses read as dashed —
 * never a false commitment.
 */
export type StatusFamily = 'confirmed' | 'hold' | 'proposed';

const FAMILIES: Record<PerformanceStatus, StatusFamily> = {
  proposed: 'proposed',
  hold: 'hold',
  hold_1: 'hold',
  hold_2: 'hold',
  hold_3: 'hold',
  confirmed: 'confirmed',
  invoiced: 'confirmed',
  done: 'confirmed',
  paid: 'confirmed',
  cancelled: 'proposed',
};

export function performanceStatusFamily(status: string): StatusFamily {
  return FAMILIES[status as PerformanceStatus] ?? 'proposed';
}

/** hold / hold_1..3 — the statuses where a decision is still pending. */
export function isHoldStatus(status: string): boolean {
  return performanceStatusFamily(status) === 'hold';
}

/**
 * ADR-080 §2 — the standard hold-decision notice, in days before the gig.
 * `performance.hold_notice_days` NULL means "follow this default"; the
 * constant lives app-side on purpose (no DB default) so NULL keeps meaning
 * "standard" if the standard ever moves.
 */
export const HOLD_NOTICE_DEFAULT = 30;

/**
 * The decide-by day of a hold (ADR-080 §2): gig day − effective notice.
 * Derived, never stored — the queue re-reads the truth on every render.
 *
 * `startAtIso` is an ISO day or instant; its date part is the gig day
 * (string day-precision compare, same convention as $lib/planner).
 * `holdNoticeDays` NULL/undefined → HOLD_NOTICE_DEFAULT; `0` = no notice,
 * so there is no decide-by day at all → null (this hold never turns
 * urgent). Copy stays honest: "decidir abans de {decideBy(...)}".
 */
export function decideBy(
  startAtIso: string,
  holdNoticeDays: number | null | undefined,
): string | null {
  const notice = holdNoticeDays ?? HOLD_NOTICE_DEFAULT;
  if (notice === 0) return null;
  return addDaysIso(startAtIso.slice(0, 10), -notice);
}

/**
 * A client-side `hold_notice_days` value the PATCH schema will accept —
 * THE validation rule for the field (create form and edit dialog both use
 * it; the schema below is the same rule server-side). null/undefined =
 * empty field = "standard default", always valid; otherwise an integer
 * 0..365. The native input's min/max/step are hints, not enforcement.
 */
export function isValidHoldNotice(value: number | null | undefined): boolean {
  return value == null || (Number.isInteger(value) && value >= 0 && value <= 365);
}

/**
 * The readiness checklist shown on a confirmed gig's card foot (ADR-084 §3).
 * The DB holds the SHAPE (a jsonb object on `performance.readiness`); the
 * WORDS live here, so adding an item costs a line of app code and never a
 * migration. Array order is display order.
 */
export const READINESS_KEYS = ['hotel', 'technical'] as const;

export type ReadinessKey = (typeof READINESS_KEYS)[number];

/** i18n key for a checklist item's word. */
export function readinessLabelKey(key: string): string {
  return `planner.ready_${key}`;
}

/** An absent key reads as NOT ticked — never as unknown. */
export function isReady(
  readiness: Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  return readiness?.[key] === true;
}

/** UI label — holds keep their rank visible (hold 1 beats hold 3). */
export function performanceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/**
 * i18n key for the word on a month card's FOOT.
 *
 * Every card gets a foot on purpose: without one the confirmed card is a row
 * shorter than a hold, so the most important gig reads as the smallest thing
 * on the grid (Marco, 2026-07-19). Holds show their RANK — folding hold_1..3
 * into one family is right for the chip's SHAPE (ADR-072 §5) but loses the
 * very thing the operator decides between. Cancelled says nothing: those rows
 * are filtered out of the grid upstream.
 */
export function statusFootKey(status: string): string | null {
  switch (status) {
    case 'hold_1':
      return 'planner.hold_rank_1';
    case 'hold_2':
      return 'planner.hold_rank_2';
    case 'hold_3':
      return 'planner.hold_rank_3';
    case 'hold':
      return 'planner.hold_plain';
    case 'confirmed':
      return 'planner.legend_confirmed';
    case 'proposed':
      return 'planner.state_proposed';
    case 'invoiced':
      return 'planner.state_invoiced';
    case 'paid':
      return 'planner.state_paid';
    case 'done':
      return 'planner.state_done';
    default:
      return null;
  }
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
  conversation_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

export type PerformanceCreate = v.InferOutput<typeof PerformanceCreateSchema>;

/**
 * PATCH /api/performances/:key body. Whitelist of the operational fields
 * (status lifecycle, day, the 5 timeslots, denormalized venue trio,
 * conversation/line links). NO fee columns (edit:money trigger + Money
 * lens own the money path) and NO notes (the collab doc owns it,
 * ADR-042). Timeslot ordering is enforced by the DB CHECK — the endpoint
 * maps that violation to a 400.
 */
export const PerformancePatchSchema = v.object({
  status: v.optional(v.picklist(PERFORMANCE_STATUSES)),
  performed_at: v.optional(isoDateField),
  // ADR-080 §2 — hold decision notice (NULL = default 30 · 0 = none · N =
  // days before). PATCH-only on purpose: the create RPC doesn't know the
  // column, so creation sends it via a follow-up PATCH (PerformanceForm).
  hold_notice_days: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
  ),
  load_in_at: v.optional(v.nullable(isoInstantField)),
  soundcheck_at: v.optional(v.nullable(isoInstantField)),
  start_at: v.optional(v.nullable(isoInstantField)),
  loadout_at: v.optional(v.nullable(isoInstantField)),
  wrap_at: v.optional(v.nullable(isoInstantField)),
  venue_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  city: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  country: v.optional(v.nullable(countryField)),
  venue_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  conversation_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  // ADR-084 §3 — the readiness ticks. The KEY SET is closed on purpose: the
  // DB only guarantees "an object", so this is where the vocabulary is
  // actually enforced. A client cannot invent `readiness.whatever` and have
  // it silently persist, which is how a jsonb column rots into a junk
  // drawer. Adding an item = adding it to READINESS_KEYS, still no migration.
  readiness: v.optional(v.record(v.picklist([...READINESS_KEYS]), v.boolean())),
});

export type PerformancePatch = v.InferOutput<typeof PerformancePatchSchema>;
