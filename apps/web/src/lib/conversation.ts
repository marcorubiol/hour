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
  /** Semantic action: the server owns the timestamp; clients cannot forge it. */
  contacted_today: v.optional(v.literal(true)),
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

export interface ConversationContactGroup {
  /** Person id, or a conversation-scoped fallback for a missing embed. */
  key: string;
  person: PersonLite | null;
  conversations: ConversationItem[];
  /** Latest valid contact instant across the loaded conversations. */
  last_contacted_at: string | null;
}

/**
 * Client-side projection used by the contact-book view. It intentionally
 * groups only the loaded page: pagination remains a server concern and the
 * UI states that boundary whenever more rows exist.
 */
export function groupConversationsByContact(
  items: readonly ConversationItem[],
): ConversationContactGroup[] {
  const groups = new Map<string, ConversationContactGroup>();

  for (const item of items) {
    const key = item.person?.id ?? `conversation:${item.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        person: item.person,
        conversations: [],
        last_contacted_at: null,
      };
      groups.set(key, group);
    }
    group.conversations.push(item);

    const nextMs = item.last_contacted_at
      ? Date.parse(item.last_contacted_at)
      : Number.NaN;
    const currentMs = group.last_contacted_at
      ? Date.parse(group.last_contacted_at)
      : Number.NaN;
    if (!Number.isNaN(nextMs) && (Number.isNaN(currentMs) || nextMs > currentMs)) {
      group.last_contacted_at = item.last_contacted_at;
    }
  }

  return [...groups.values()];
}

/** Calm, coarse relative copy: informative without implying urgency. */
export function relativeContactDate(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return '—';
  const atMs = Date.parse(iso);
  if (Number.isNaN(atMs)) return '—';

  const days = Math.max(0, Math.floor((nowMs - atMs) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

type WorkspacePersonEmbed = Omit<PersonLite, 'id' | 'organization_name'> & {
  person_id: string;
  organization: { name: string } | null;
};

export interface ConversationDbItem extends Tables<'conversation'> {
  person: WorkspacePersonEmbed | null;
  project: ProjectLite | null;
}

/** Keep the public API stable while contact data moves to workspace_person. */
export function normalizeConversationItem(item: ConversationDbItem): ConversationItem {
  return {
    ...item,
    person: item.person
      ? {
          id: item.person.person_id,
          slug: item.person.slug,
          full_name: item.person.full_name,
          email: item.person.email,
          organization_name: item.person.organization?.name ?? null,
          country: item.person.country,
          city: item.person.city,
          website: item.person.website,
        }
      : null,
  };
}

/** PostgREST embed clause matching `ConversationItem` — shared by GET + PATCH. */
export const CONVERSATION_SELECT = [
  '*',
  'person:workspace_person!conversation_workspace_person_fkey(person_id,slug,full_name,email,country,city,website,organization:workspace_organization!workspace_person_organization_fkey(name))',
  'project:project_id(id,slug,name,status)',
].join(',');
