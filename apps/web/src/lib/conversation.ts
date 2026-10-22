/**
 * Conversation domain helpers: the inline-PATCH contract shared by the API
 * endpoint and every surface that edits a conversation (ADR-040). The
 * relation's vocabulary (labels, tones) lives with it, in
 * `conversation-relation.ts` (ADR-138); `status` is no longer read.
 *
 * Anti-CRM vocabulary (reset v2): no lead / pipeline / funnel / prospect.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { localDayISO, realIsoDate, realIsoInstant } from './datetime';
import { t, type Locale } from './i18n';
import { EVENT_MAIL_SELECT, type EventMailFields } from './mail';
import { relationOf, type ConversationBolo, type Relation, type RelationInput } from './conversation-relation';
import type { RowMailout } from './conversation-overview';
import { TAGGING_EMBED, tagKeysOf, type TaggingEmbed } from './conversation-tags';

export type ConversationStatus = Enums<'conversation_status'>;

/** The old stored status (ADR-138 E4 drops it); only the create still sends its default. */
export const CONVERSATION_STATUSES = Constants.public.Enums.conversation_status;

/**
 * PATCH /api/conversations/:id body. Whitelist of the fields the difusión
 * loop edits inline — unknown keys are stripped by the schema, so
 * RLS-sensitive columns (workspace_id, project_id, created_by…) can never
 * ride along. `next_action_at` travels date-only (the column is
 * timestamptz; Postgres casts) or null to clear.
 */
export const ConversationPatchSchema = v.object({
  // ADR-138: the only relation kept by hand. An object sets it (now, on the
  // server clock, with an optional day to write again); null lifts it. The
  // old `status` is no longer written: the relation is derived.
  not_now: v.optional(v.nullable(v.object({ until: v.optional(v.nullable(realIsoDate)) }))),
  next_action_at: v.optional(v.nullable(realIsoDate)),
  next_action_note: v.optional(
    v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  ),
  // ADR-056: relink the conversation's operational frame. Nullable so a
  // module can detach. Cross-project integrity is the endpoint's guard
  // (pattern ADR-043) — RLS gives zero backup on FK coherence.
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  // ADR-126 § 1: «no pide respuesta». The instant of the reply being
  // settled (its `occurred_at`), not now: a reply synced later but written
  // after it must still put the turn on us. Null clears.
  reply_settled_at: v.optional(
    v.nullable(v.pipe(v.string(), v.check((s) => !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s)))),
  ),
});

export type ConversationPatch = v.InferOutput<typeof ConversationPatchSchema>;

/** The columns a patch writes: `not_now` becomes its two stamps. */
export function conversationPatchColumns(patch: ConversationPatch, now: Date = new Date()): Record<string, unknown> {
  const { not_now, ...rest } = patch;
  if (not_now === undefined) return rest;
  return {
    ...rest,
    not_now_at: not_now ? now.toISOString() : null,
    not_now_until: not_now ? (not_now.until ?? null) : null,
  };
}

// ── The history (ADR-098, contract: build/conversation-event-contract.md) ──

export type ConversationEventKind = Enums<'conversation_event_kind'>;
export type ConversationEventDirection = Enums<'conversation_event_direction'>;
type ConversationEvent = Tables<'conversation_event'>;

export const CONVERSATION_EVENT_KINDS = Constants.public.Enums.conversation_event_kind;
const CONVERSATION_EVENT_DIRECTIONS = Constants.public.Enums.conversation_event_direction;

const EVENT_KIND_KEYS: Record<ConversationEventKind, string> = {
  email: 'conversations.kind_email',
  call: 'conversations.kind_call',
  meeting: 'conversations.kind_meeting',
  message: 'conversations.kind_message',
  note: 'conversations.kind_note',
};

const EVENT_DIRECTION_KEYS: Record<ConversationEventDirection, string> = {
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
const CONVERSATION_EVENT_SELECT =
  'id,conversation_id,occurred_at,recorded_at,kind,source,direction,body';

export type ConversationEventItem = Pick<
  ConversationEvent,
  'id' | 'conversation_id' | 'occurred_at' | 'recorded_at' | 'kind' | 'source' | 'direction' | 'body'
> &
  EventMailFields & {
    /** Quien lo apuntó o lo envió desde Hour; null si lo trajo la sincronización. */
    created_by?: string | null;
  };

/** La lectura de la ficha: el registro más lo que se enseña de un correo. */
export const CONVERSATION_EVENT_FULL_SELECT = `${CONVERSATION_EVENT_SELECT},created_by,${EVENT_MAIL_SELECT}`;

/** The database caps a contact's role at 200 characters (ADR-102). */
export const CONTACT_ROLE_MAX = 200;

/**
 * POST /api/conversations body (ADR-051, ADR-102). The conversation is with an
 * organization; the person is optional and becomes its primary contact.
 *   · organization_id — an existing organization of the workspace
 *   · organization    — by name: found (case-insensitive) or created
 *   · person_id       — link an existing person (server re-checks visibility)
 *   · person          — inline fields; the RPC find-or-creates on email
 * At most one of each pair, and at least one of the four: with only a person,
 * the organization is the person's, or one named after them (an independent
 * programmer). The endpoint enforces the pairs; the schema keeps all optional
 * so the error message can be specific.
 */
export const ConversationCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  organization_id: v.optional(v.pipe(v.string(), v.uuid())),
  organization: v.optional(
    v.object({
      name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    }),
  ),
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
  role: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(CONTACT_ROLE_MAX)))),
  next_action_at: v.optional(v.nullable(realIsoDate)),
  next_action_note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
  // ADR-056: capture straight into a line (the module context or the
  // optional Line select in the global dialog). The RPC guards project
  // membership of the line.
  line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  // ADR-138 fase 2: the tags it is born with (`set_conversation_tags` after
  // the create). Absent, it carries none and reads as `sales`.
  tag_ids: v.optional(v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(32))),
});

/** Why a create body is not acceptable beyond its shape, or null if it is. */
export function conversationCreateProblem(input: ConversationCreate): string | null {
  if (input.organization_id && input.organization) return 'Send at most one of organization_id or organization.';
  if (input.person_id && input.person) return 'Send at most one of person_id or person.';
  if (!input.organization_id && !input.organization && !input.person_id && !input.person) {
    return 'Send an organization (organization_id or organization) or a person (person_id or person).';
  }
  return null;
}

/**
 * The id of the conversation a create clashed with, from the PostgREST error
 * body of `create_conversation`'s 23505 (DETAIL `conversation_id=<uuid>`).
 * Only the organization clash carries it; the caller can see that row.
 */
export function existingConversationId(errorBody: string): string | null {
  try {
    const details = (JSON.parse(errorBody) as { details?: unknown }).details;
    const m = typeof details === 'string' ? /^conversation_id=([0-9a-f-]{36})$/i.exec(details) : null;
    return m ? m[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * What the capture dialogs send for "who": the person (with the organization
 * by name) when there is a name, or the organization alone (ADR-102). Null
 * when there is neither: the dialog asks for one.
 */
export function conversationWhoBody(fields: {
  name: string;
  email?: string;
  phone?: string;
  organization: string;
}):
  | { person: { full_name: string; email: string | null; phone?: string | null; organization_name: string | null } }
  | { organization: { name: string } }
  | null {
  const name = fields.name.trim();
  const organization = fields.organization.trim();
  if (name) {
    return {
      person: {
        full_name: name,
        email: fields.email?.trim() || null,
        ...(fields.phone !== undefined ? { phone: fields.phone.trim() || null } : {}),
        organization_name: organization || null,
      },
    };
  }
  return organization ? { organization: { name: organization } } : null;
}

// ── Contacts (ADR-102): the people of a conversation with a venue ──

/**
 * POST /api/conversations/:id/contacts — add a contact or redo theirs.
 * `since` absent keeps the one they already have (the RPC would clear it).
 */
export const ContactSetSchema = v.object({
  person_id: v.pipe(v.string(), v.uuid()),
  role: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(CONTACT_ROLE_MAX)))),
  since: v.optional(v.nullable(realIsoDate)),
  is_primary: v.optional(v.boolean()),
});
type ContactSet = v.InferOutput<typeof ContactSetSchema>;

/**
 * POST /api/conversations/:id/contacts with a person who may have no dossier
 * yet («Añadir como contacto» after the create 409): found by email in the
 * workspace, or created (`add_conversation_contact`).
 */
export const ContactAddInlineSchema = v.object({
  person: v.object({
    full_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(254), v.email()))),
    phone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(40)))),
  }),
  role: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(CONTACT_ROLE_MAX)))),
});

/** PATCH /api/conversations/:id/contacts — close a contact (until, default today). */
export const ContactEndSchema = v.object({
  person_id: v.pipe(v.string(), v.uuid()),
  until: v.optional(v.nullable(realIsoDate)),
});

export interface ContactRowLite {
  person_id: string;
  role: string | null;
  since: string | null;
  until: string | null;
  is_primary: boolean;
}

/**
 * The arguments for `set_conversation_contact`. The RPC rewrites `since` and
 * `role` on every call, so what the body leaves out is carried over from the
 * contact as it is (review of phase 1: a role change must not erase since).
 */
export function contactSetArgs(
  conversationId: string,
  input: ContactSet,
  current: ContactRowLite | null,
): Record<string, unknown> {
  return {
    p_conversation_id: conversationId,
    p_person_id: input.person_id,
    p_role: input.role !== undefined ? input.role : (current?.role ?? null),
    p_since: input.since !== undefined ? input.since : (current?.since ?? null),
    p_is_primary: input.is_primary ?? current?.is_primary ?? false,
  };
}

type ConversationCreate = v.InferOutput<typeof ConversationCreateSchema>;

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

type OrganizationLite = Pick<
  Tables<'workspace_organization'>,
  'id' | 'slug' | 'name' | 'kind' | 'city'
>;

/** A contact of the conversation, with their dossier (ADR-102). */
export interface ConversationContact extends ContactRowLite {
  person: { slug: string; full_name: string; email: string | null; phone: string | null } | null;
}

/** The contacts embed as PostgREST returns it: the dossier carries what `person` needs. */
type ContactDbEmbed = ContactRowLite & {
  person:
    | (ConversationContact['person'] & Omit<WorkspacePersonEmbed, 'slug' | 'full_name' | 'email'>)
    | null;
};

export interface ConversationItem extends Tables<'conversation'> {
  /** The primary contact's person (from `contacts`), for the views that name one. */
  person: PersonLite | null;
  project: ProjectLite | null;
  /** Who the conversation is with (ADR-102). Null only for pre-phase-1 rows. */
  organization: OrganizationLite | null;
  /** Primary first, then current, then closed; empty if none is readable. */
  contacts: ConversationContact[];
  /** Its last directional email, message or call (GET /api/conversations, ADR-117): whose turn it is. */
  last_turn?: { direction: 'inbound' | 'outbound'; occurred_at: string; kind?: string | null; subject?: string | null }[] | null;
  /** Its last inbound one: whether they ever answered (ADR-138). */
  last_in?: { occurred_at: string }[] | null;
  /** Its organization has a done bolo in an earlier season (`conversation_regular`). */
  regular?: boolean | null;
  /** The derived relation, computed by the Worker (`relationOf`, ADR-138 § 4). */
  relation: Relation;
  /** Its tag keys (ADR-138 § 1); none read as `sales` (`tagKeysOf`). */
  tags: string[];
  /** New for the caller (`conversation_feed`); absent where the list does not read it. */
  unread_count?: number;
  /** Its bolos without money (ADR-138 § 3); absent without `read:performance` or when unread. */
  bolos?: ConversationBolo[];
  /** The last mailout it received (plan de la lista § 3). */
  last_mailout?: RowMailout | null;
}

/**
 * The primary contact's person out of a contacts embed. ADR-102 phase 4: the
 * conversation has no person of its own, only contacts (`conversation_contact`).
 */
export function primaryContactPerson<P>(
  contacts: readonly { is_primary: boolean; person: P | null }[] | null | undefined,
): P | null {
  return contacts?.find((c) => c.is_primary)?.person ?? null;
}

/** The title of a conversation: its organization, or its person before ADR-102. */
export function conversationTitle(
  item: Pick<ConversationItem, 'organization' | 'person'>,
): string {
  return item.organization?.name || item.person?.full_name || item.person?.organization_name || '';
}

/** Current contacts (until empty or not past), primary first. */
export function currentContacts(
  contacts: readonly ConversationContact[],
  today: string = localDayISO(new Date()),
): ConversationContact[] {
  return contacts.filter((c) => !c.until || c.until >= today);
}

/** Order the contacts embed: primary, then current by name, then closed by until desc. */
export function sortContacts(contacts: readonly ConversationContact[]): ConversationContact[] {
  return [...contacts].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    if (!a.until !== !b.until) return a.until ? 1 : -1;
    if (a.until && b.until && a.until !== b.until) return a.until < b.until ? 1 : -1;
    return (a.person?.full_name ?? '').localeCompare(b.person?.full_name ?? '');
  });
}

/**
 * Calm, coarse relative copy: informative without implying urgency. Counts
 * calendar days in the viewer's zone, like the dashboard (`daysSince`): an
 * email from yesterday at 16:00 is «yesterday» at 06:40 today, not «today»
 * (ADR-126 § 6).
 */
export function relativeContactDate(
  iso: string | null,
  locale: Locale,
  nowMs = Date.now(),
): string {
  if (!iso) return '—';
  const atMs = Date.parse(iso);
  if (Number.isNaN(atMs)) return '—';
  const midnight = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return daysAgoLabel(Math.max(0, Math.round((midnight(nowMs) - midnight(atMs)) / 86_400_000)), locale);
}

/** «hoy», «ayer», «hace 4 días», «hace 3 semanas»: one scale for every «how long» of the lens. */
export function daysAgoLabel(days: number, locale: Locale): string {
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
  project: ProjectLite | null;
  organization?: OrganizationLite | null;
  contacts?: ContactDbEmbed[] | null;
  last_turn?: ConversationItem['last_turn'];
  last_in?: ConversationItem['last_in'];
  regular?: boolean | null;
  tagging?: TaggingEmbed;
}

/** The old status someone set by hand, kept by the E1 migration (ADR-138 § 8.5). */
function legacyStatus(customFields: unknown): string | null {
  const v = (customFields as { legacy_status?: unknown } | null)?.legacy_status;
  return typeof v === 'string' ? v : null;
}

/** What the relation reads of a conversation row as the endpoints return it (with `last_turn`, `last_in`, `regular`). */
export function relationInputOf(item: ConversationDbItem | ConversationItem): RelationInput {
  return {
    not_now_at: item.not_now_at ?? null,
    not_now_until: item.not_now_until ?? null,
    last: item.last_turn?.[0] ?? null,
    last_in: item.last_in?.[0] ?? null,
    last_contacted_at: item.last_contacted_at ?? null,
    first_contacted_at: item.first_contacted_at ?? null,
    contacted_undated: item.contacted_undated ?? false,
    legacy_status: legacyStatus(item.custom_fields),
    regular: item.regular ?? false,
  };
}

export function conversationRelation(item: ConversationDbItem, now: Date = new Date()): Relation {
  return relationOf(relationInputOf(item), now);
}

/** `person` is the primary contact's dossier; `contacts` keep the four fields they show. */
export function normalizeConversationItem(item: ConversationDbItem, now: Date = new Date()): ConversationItem {
  const contacts = item.contacts ?? [];
  const primary = primaryContactPerson(contacts);
  const { tagging, ...row } = item;
  return {
    ...row,
    relation: conversationRelation(item, now),
    tags: tagKeysOf(tagging),
    organization: item.organization ?? null,
    contacts: sortContacts(
      contacts.map(({ person, ...row }) => ({
        ...row,
        person: person
          ? { slug: person.slug, full_name: person.full_name, email: person.email, phone: person.phone }
          : null,
      })),
    ),
    person: primary
      ? {
          id: primary.person_id,
          slug: primary.slug,
          full_name: primary.full_name,
          email: primary.email,
          organization_name: primary.organization?.name ?? null,
          country: primary.country,
          city: primary.city,
          website: primary.website,
        }
      : null,
  };
}

/** PostgREST embed clause matching `ConversationItem` — shared by GET + PATCH. */
export const CONVERSATION_SELECT = [
  '*',
  'regular:conversation_regular',
  'project:project_id(id,slug,name,status)',
  'organization:workspace_organization!conversation_workspace_organization_fkey(id,slug,name,kind,city)',
  TAGGING_EMBED,
  'contacts:conversation_contact(person_id,role,since,until,is_primary,person:workspace_person!conversation_contact_workspace_person_fkey(person_id,slug,full_name,email,phone,country,city,website,organization:workspace_organization!workspace_person_organization_fkey(name)))',
].join(',');
