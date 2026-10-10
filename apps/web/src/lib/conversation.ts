/**
 * Conversation domain helpers — single home for the status vocabulary
 * (labels + badge classes) and the inline-PATCH contract shared by the
 * API endpoint and every surface that edits an conversation (ADR-040).
 *
 * Anti-CRM vocabulary (reset v2): no lead / pipeline / funnel / prospect.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { localDayISO, realIsoDate, realIsoInstant } from './datetime';
import { appLocale, t, type Locale } from './i18n';

export type ConversationStatus = Enums<'conversation_status'>;

/** All statuses in schema enum order (runtime mirror of the DB enum). */
export const CONVERSATION_STATUSES = Constants.public.Enums.conversation_status;

/** Dictionary key of each status label (lib/i18n). */
export const STATUS_KEYS: Record<ConversationStatus, string> = {
  contacted: 'conversations.status_contacted',
  in_conversation: 'conversations.status_in_conversation',
  hold: 'conversations.status_hold',
  confirmed: 'conversations.status_confirmed',
  declined: 'conversations.status_declined',
  dormant: 'conversations.status_dormant',
  recurring: 'conversations.status_recurring',
};

/** The status in the viewer's language; an unknown value shows as itself.
    `locale` defaults to the session's, so callers outside this zone keep working. */
export function statusLabel(status: string, locale: Locale = appLocale()): string {
  const key = STATUS_KEYS[status as ConversationStatus];
  return key ? t(key, locale) : status;
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

// ── The history (ADR-098, contract: build/conversation-event-contract.md) ──

export type ConversationEventKind = Enums<'conversation_event_kind'>;
export type ConversationEventDirection = Enums<'conversation_event_direction'>;
export type ConversationEvent = Tables<'conversation_event'>;

export const CONVERSATION_EVENT_KINDS = Constants.public.Enums.conversation_event_kind;
export const CONVERSATION_EVENT_DIRECTIONS = Constants.public.Enums.conversation_event_direction;

export const EVENT_KIND_KEYS: Record<ConversationEventKind, string> = {
  email: 'conversations.kind_email',
  call: 'conversations.kind_call',
  meeting: 'conversations.kind_meeting',
  message: 'conversations.kind_message',
  note: 'conversations.kind_note',
};

export const EVENT_DIRECTION_KEYS: Record<ConversationEventDirection, string> = {
  outbound: 'conversations.dir_outbound',
  inbound: 'conversations.dir_inbound',
};

export function eventKindLabel(kind: ConversationEventKind, locale: Locale): string {
  return t(EVENT_KIND_KEYS[kind], locale);
}

export function eventDirectionLabel(direction: ConversationEventDirection, locale: Locale): string {
  return t(EVENT_DIRECTION_KEYS[direction], locale);
}

/**
 * POST /api/conversations/:id/events body. `source` is not here: what the app
 * records is always `manual`, and the provenance of a connector is not a field
 * a person can claim. `occurred_at` absent means now, on the SERVER clock.
 */
export const ConversationEventCreateSchema = v.object({
  kind: v.picklist(CONVERSATION_EVENT_KINDS),
  direction: v.optional(v.nullable(v.picklist(CONVERSATION_EVENT_DIRECTIONS))),
  body: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(5000)))),
  occurred_at: v.optional(realIsoInstant),
});

export type ConversationEventCreate = v.InferOutput<typeof ConversationEventCreateSchema>;

/**
 * The instant to send for a day picked in the quick add. Today sends nothing,
 * so the server stamps it; any other day is that day at noon in the viewer's
 * zone, which survives every timezone without changing the day it reads as.
 */
export function occurredAtForDay(day: string, now: Date = new Date()): string | undefined {
  if (day === localDayISO(now)) return undefined;
  return new Date(`${day}T12:00:00`).toISOString();
}

/** Columns the timeline reads; the whole envelope stays server-side. */
export const CONVERSATION_EVENT_SELECT =
  'id,conversation_id,occurred_at,recorded_at,kind,source,direction,body';

export type ConversationEventItem = Pick<
  ConversationEvent,
  'id' | 'conversation_id' | 'occurred_at' | 'recorded_at' | 'kind' | 'source' | 'direction' | 'body'
>;

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
export function relativeContactDate(
  iso: string | null,
  locale: Locale,
  nowMs = Date.now(),
): string {
  if (!iso) return '—';
  const atMs = Date.parse(iso);
  if (Number.isNaN(atMs)) return '—';

  const days = Math.max(0, Math.floor((nowMs - atMs) / 86_400_000));
  if (days === 0) return t('conversations.rel_today', locale);
  if (days === 1) return t('conversations.rel_yesterday', locale);
  if (days < 14) return t('conversations.rel_days', locale, { n: days });
  if (days < 60) return t('conversations.rel_weeks', locale, { n: Math.floor(days / 7) });
  if (days < 730) return t('conversations.rel_months', locale, { n: Math.floor(days / 30) });
  return t('conversations.rel_years', locale, { n: Math.floor(days / 365) });
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
