/**
 * Conversation domain helpers — single home for the status vocabulary
 * (labels + badge classes) and the inline-PATCH contract shared by the
 * API endpoint and every surface that edits an conversation (ADR-040).
 *
 * Anti-CRM vocabulary (reset v2): no lead / pipeline / funnel / prospect.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { realIsoDate } from './datetime';

export type ConversationStatus = Enums<'conversation_status'>;

/** All statuses in schema enum order (runtime mirror of the DB enum). */
export const CONVERSATION_STATUSES = Constants.public.Enums.conversation_status;

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  hold: 'Hold',
  confirmed: 'Confirmed',
  declined: 'Declined',
  dormant: 'Dormant',
  recurring: 'Recurring',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as ConversationStatus] ?? status;
}

/** Badge variants in base.css mirror the enum with underscores → dashes. */
export function statusBadgeClass(status: string): string {
  return `badge--${status.replace(/_/g, '-')}`;
}

/**
 * PATCH /api/conversations/:id body. Whitelist of the fields the difusión
 * loop edits inline — unknown keys are stripped by the schema, so
 * RLS-sensitive columns (workspace_id, project_id, created_by…) can never
 * ride along. `next_action_at` travels date-only (the column is
 * timestamptz; Postgres casts) or null to clear.
 */
export const ConversationPatchSchema = v.object({
  status: v.optional(v.picklist(CONVERSATION_STATUSES)),
  next_action_at: v.optional(v.nullable(realIsoDate)),
  next_action_note: v.optional(
    v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  ),
  // ADR-056: relink the conversation's operational frame. Nullable so a
  // module can detach. Cross-project integrity is the endpoint's guard
  // (pattern ADR-043) — RLS gives zero backup on FK coherence.
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

export type ConversationPatch = v.InferOutput<typeof ConversationPatchSchema>;

/**
 * POST /api/conversations body (ADR-051). Two shapes, exactly one:
 *   · person_id — link an existing person (server re-checks visibility)
 *   · person    — inline fields; the RPC find-or-creates on email
 * The endpoint enforces the exactly-one rule; the schema keeps both
 * optional so the error message can be specific.
 */
export const ConversationCreateSchema = v.object({
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
  status: v.optional(v.picklist(CONVERSATION_STATUSES), 'contacted'),
  role: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120)))),
  next_action_at: v.optional(v.nullable(realIsoDate)),
  next_action_note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
  // ADR-056: capture straight into a line (the module context or the
  // optional Line select in the global dialog). The RPC guards project
  // membership of the line.
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

export type ConversationCreate = v.InferOutput<typeof ConversationCreateSchema>;

/**
 * Shape the conversation endpoints return: the row plus the person/project
 * embeds the UI renders. Kept next to the schema so GET list, PATCH and
 * the client agree on one contract.
 */
export type PersonLite = Pick<
  Tables<'person'>,
  'id' | 'slug' | 'full_name' | 'email' | 'organization_name' | 'country' | 'city' | 'website'
>;
export type ProjectLite = Pick<Tables<'project'>, 'id' | 'slug' | 'name' | 'status'>;

export interface ConversationItem extends Tables<'conversation'> {
  person: PersonLite | null;
  project: ProjectLite | null;
}

/** PostgREST embed clause matching `ConversationItem` — shared by GET + PATCH. */
export const CONVERSATION_SELECT = [
  '*',
  'person:person_id(id,slug,full_name,email,organization_name,country,city,website)',
  'project:project_id(id,slug,name,status)',
].join(',');
