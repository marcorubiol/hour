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
 * PATCH /api/engagements/:id body. Whitelist of the fields the difusión
 * loop edits inline — unknown keys are stripped by the schema, so
 * RLS-sensitive columns (workspace_id, project_id, created_by…) can never
 * ride along. `next_action_at` travels date-only (the column is
 * timestamptz; Postgres casts) or null to clear.
 */
export const EngagementPatchSchema = v.object({
  status: v.optional(v.picklist(ENGAGEMENT_STATUSES)),
  // isoDate is regex-only (accepts 2026-02-31); the round-trip check keeps
  // impossible calendar dates from reaching Postgres as a 5xx.
  next_action_at: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.isoDate(),
        // Valibot runs later pipe actions even when isoDate already
        // failed, so guard the Invalid Date case before toISOString().
        v.check((s) => {
          const d = new Date(`${s}T00:00:00Z`);
          return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
        }, 'Not a real calendar date'),
      ),
    ),
  ),
  next_action_note: v.optional(
    v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  ),
});

export type EngagementPatch = v.InferOutput<typeof EngagementPatchSchema>;

/**
 * Shape the engagement endpoints return: the row plus the person/project
 * embeds the UI renders. Kept next to the schema so GET list, PATCH and
 * the client agree on one contract.
 */
export type PersonLite = Pick<
  Tables<'person'>,
  'id' | 'full_name' | 'email' | 'organization_name' | 'country' | 'city' | 'website'
>;
export type ProjectLite = Pick<Tables<'project'>, 'id' | 'slug' | 'name' | 'status'>;

export interface EngagementItem extends Tables<'engagement'> {
  person: PersonLite | null;
  project: ProjectLite | null;
}

/** PostgREST embed clause matching `EngagementItem` — shared by GET + PATCH. */
export const ENGAGEMENT_SELECT = [
  '*',
  'person:person_id(id,full_name,email,organization_name,country,city,website)',
  'project:project_id(id,slug,name,status)',
].join(',');
