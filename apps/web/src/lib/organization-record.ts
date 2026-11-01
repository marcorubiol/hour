/**
 * La ficha de organización (ADR-159): la sala o quien programa, con quien es
 * la conversación de difusión (ADR-102). Lo que la ficha dice de sus
 * contactos y de sus bolos, y lo que le falta.
 *
 * Sin red: `today` (día local, `YYYY-MM-DD`) se inyecta.
 */

import type { ConversationBolo } from './conversation-relation';
import type { OrgMergeLine } from './organization-merge';
import { MISSING_MAX, personMissing, type PersonMissing, type PersonMissingConversation } from './record-missing';

/** Los tipos de organización (`workspace_organization_kind_check`). */
export const ORGANIZATION_KINDS = [
  'company',
  'festival',
  'theatre',
  'presenter',
  'agency',
  'institution',
  'other',
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** Una persona como contacto de una conversación de la organización. */
export interface OrgConversationContact {
  person_id: string;
  role: string | null;
  since: string | null;
  until: string | null;
  is_primary: boolean;
  person: { slug: string; full_name: string; email: string | null; phone: string | null } | null;
}

/** Una persona cuyo dossier dice que trabaja ahí (`workspace_person.organization_id`). */
export interface OrgStaff {
  person_id: string;
  slug: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

/** Lo que lee la ficha: `GET /api/organizations/:key`. */
export interface OrganizationFile {
  organization: {
    id: string;
    workspace_id: string;
    slug: string;
    name: string;
    kind: string | null;
    city: string | null;
    country: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    address: string | null;
  };
  conversations: Array<{
    id: string;
    relation: string;
    next_action_at: string | null;
    project: { id: string; slug: string; name: string } | null;
  }>;
  contacts: OrgConversationContact[];
  staff: OrgStaff[];
  bolos: ConversationBolo[];
  /** «Fusionar con…» (84): only the space's admin. */
  can_merge?: boolean;
  /** The merges this one absorbed, not undone (admin only). */
  merges?: OrgMergeLine[];
}

export interface OrgContact {
  personId: string;
  slug: string;
  name: string;
  /** Su papel en la conversación vigente, si no el de su dossier. */
  role: string | null;
  /** Cómo se le escribe: el correo, si no el teléfono. */
  reach: string | null;
  reachHref: string | null;
  /** Ya no está: el último día en que fue contacto. Null mientras sigue. */
  until: string | null;
  primary: boolean;
}

function vigente(c: OrgConversationContact, today: string): boolean {
  return !c.until || c.until.slice(0, 10) >= today;
}

/**
 * Los contactos de la organización: quien es contacto de alguna de sus
 * conversaciones y quien la tiene en su dossier, una vez cada persona.
 * Primero los que siguen (el principal delante, después por nombre); detrás
 * los que se fueron, el más reciente primero.
 */
export function orgContacts(
  conversationContacts: readonly OrgConversationContact[],
  staff: readonly OrgStaff[],
  today: string,
): OrgContact[] {
  const byPerson = new Map<string, OrgContact>();
  const reachOf = (email: string | null, phone: string | null) =>
    email ? { reach: email, reachHref: `mailto:${email}` } : phone ? { reach: phone, reachHref: `tel:${phone}` } : { reach: null, reachHref: null };

  for (const c of conversationContacts) {
    if (!c.person) continue;
    const now = vigente(c, today);
    const prev = byPerson.get(c.person_id);
    const until = now ? null : c.until!.slice(0, 10);
    if (!prev) {
      byPerson.set(c.person_id, {
        personId: c.person_id,
        slug: c.person.slug,
        name: c.person.full_name,
        role: c.role,
        ...reachOf(c.person.email, c.person.phone),
        until,
        primary: now && c.is_primary,
      });
      continue;
    }
    // Sigue si sigue en alguna; si no, se fue el último de sus días.
    const stillHere = prev.until === null || now;
    prev.until = stillHere ? null : [prev.until!, until!].sort().at(-1)!;
    if (now) {
      prev.primary ||= c.is_primary;
      prev.role = c.role ?? prev.role;
    }
  }

  for (const s of staff) {
    const prev = byPerson.get(s.person_id);
    if (prev) {
      // Su dossier dice que está ahí: sigue, aunque su conversación acabara.
      prev.until = null;
      prev.role ??= s.title;
      continue;
    }
    byPerson.set(s.person_id, {
      personId: s.person_id,
      slug: s.slug,
      name: s.full_name,
      role: s.title,
      ...reachOf(s.email, s.phone),
      until: null,
      primary: false,
    });
  }

  return [...byPerson.values()].sort((a, b) => {
    if ((a.until === null) !== (b.until === null)) return a.until === null ? -1 : 1;
    if (a.until !== null && b.until !== null && a.until !== b.until) return b.until.localeCompare(a.until);
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const DEAD = new Set(['cancelled']);

/**
 * Sus bolos, en el orden en que importan: los que vienen, el más cercano
 * primero; después los pasados, el último primero; los que no tienen fecha,
 * al final. Un cancelado no se cuenta.
 */
export function orgBolos(bolos: readonly ConversationBolo[], today: string): ConversationBolo[] {
  const live = bolos.filter((b) => !DEAD.has(b.status));
  const day = (b: ConversationBolo) => (b.last_performed_at ?? b.first_performed_at)?.slice(0, 10) ?? null;
  const coming = live.filter((b) => day(b) !== null && day(b)! >= today);
  const past = live.filter((b) => day(b) !== null && day(b)! < today);
  const undated = live.filter((b) => day(b) === null);
  coming.sort((a, b) => a.first_performed_at!.localeCompare(b.first_performed_at!));
  past.sort((a, b) => day(b)!.localeCompare(day(a)!));
  return [...coming, ...past, ...undated];
}

export type OrgMissing = { kind: 'fiscal' } | PersonMissing;

/**
 * La franja «Falta» (ADR-139 p2): los datos fiscales cuando paga algún bolo
 * vivo y quien mira puede escribirlos (el pagador es la organización,
 * ADR-102 § 5); después sus conversaciones con el paso vencido. Tres como
 * mucho, como en toda ficha.
 */
export function orgMissing(input: {
  conversations: readonly PersonMissingConversation[];
  bolos: readonly ConversationBolo[];
  /** Null mientras no se sabe (la lectura de los fiscales no ha vuelto). */
  fiscal: { has: boolean; canEdit: boolean } | null;
  today: string;
}): OrgMissing[] {
  const fiscal: OrgMissing[] =
    input.fiscal && !input.fiscal.has && input.fiscal.canEdit && input.bolos.some((b) => !DEAD.has(b.status))
      ? [{ kind: 'fiscal' }]
      : [];
  return [...fiscal, ...personMissing(input.conversations, input.today)].slice(0, MISSING_MAX);
}
