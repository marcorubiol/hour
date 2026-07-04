/**
 * Engagement domain helpers — single home for the status vocabulary
 * (labels + badge classes) and the inline-PATCH contract shared by the
 * API endpoint and every surface that edits an engagement (ADR-040).
 *
 * Anti-CRM vocabulary (reset v2): no lead / pipeline / funnel / prospect.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';

export type EngagementStatus = Enums<'engagement_status'>;

/** All statuses in schema enum order (runtime mirror of the DB enum). */
export const ENGAGEMENT_STATUSES = Constants.public.Enums.engagement_status;

export const STATUS_LABELS: Record<EngagementStatus, string> = {
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  hold: 'Hold',
  confirmed: 'Confirmed',
  declined: 'Declined',
  dormant: 'Dormant',
  recurring: 'Recurring',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as EngagementStatus] ?? status;
}

/** Badge variants in base.css mirror the enum with underscores → dashes. */
export function statusBadgeClass(status: string): string {
  return `badge--${status.replace(/_/g, '-')}`;
}

/**
 * "YYYY-MM-DD that is a real calendar day". isoDate is regex-only
 * (2026-02-31 passes it), so the round-trip check keeps impossible dates
 * from reaching Postgres as a 5xx. One home — shared by the PATCH and
 * CREATE next_action_at fields. (Valibot runs later pipe actions even
 * when isoDate already failed, so the Invalid-Date guard sits before
 * toISOString().)
 */
const realIsoDate = v.pipe(
  v.string(),
  v.isoDate(),
  v.check((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date'),
);

/**
 * PATCH /api/engagements/:id body. Whitelist of the fields the difusión
 * loop edits inline — unknown keys are stripped by the schema, so
 * RLS-sensitive columns (workspace_id, project_id, created_by…) can never
 * ride along. `next_action_at` travels date-only (the column is
 * timestamptz; Postgres casts) or null to clear.
 */
export const EngagementPatchSchema = v.object({
  status: v.optional(v.picklist(ENGAGEMENT_STATUSES)),
  next_action_at: v.optional(v.nullable(realIsoDate)),
  next_action_note: v.optional(
    v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  ),
});

export type EngagementPatch = v.InferOutput<typeof EngagementPatchSchema>;

/**
 * POST /api/engagements body (ADR-051). Two shapes, exactly one:
 *   · person_id — link an existing person (server re-checks visibility)
 *   · person    — inline fields; the RPC find-or-creates on email
 * The endpoint enforces the exactly-one rule; the schema keeps both
 * optional so the error message can be specific.
 */
export const EngagementCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  person_id: v.optional(v.pipe(v.string(), v.uuid())),
  person: v.optional(
    v.object({
      full_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
      email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(254), v.email()))),
      phone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(40)))),
      organization_name: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
      title: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
    }),
  ),
  status: v.optional(v.picklist(ENGAGEMENT_STATUSES), 'contacted'),
  role: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  next_action_at: v.optional(v.nullable(realIsoDate)),
  next_action_note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type EngagementCreate = v.InferOutput<typeof EngagementCreateSchema>;

/**
 * Shape the engagement endpoints return: the row plus the person/project
 * embeds the UI renders. Kept next to the schema so GET list, PATCH and
 * the client agree on one contract.
 */
export type PersonLite = Pick<
  Tables<'person'>,
  'id' | 'slug' | 'full_name' | 'email' | 'organization_name' | 'country' | 'city' | 'website'
>;
export type ProjectLite = Pick<Tables<'project'>, 'id' | 'slug' | 'name' | 'status'>;

export interface EngagementItem extends Tables<'engagement'> {
  person: PersonLite | null;
  project: ProjectLite | null;
}

/** PostgREST embed clause matching `EngagementItem` — shared by GET + PATCH. */
export const ENGAGEMENT_SELECT = [
  '*',
  'person:person_id(id,slug,full_name,email,organization_name,country,city,website)',
  'project:project_id(id,slug,name,status)',
].join(',');
