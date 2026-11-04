/**
 * La ficha de organización (ADR-159): la sala o quien programa, con quien es
 * la conversación de difusión (ADR-102). Lo que la ficha dice de sus
 * contactos y de sus bolos, y lo que le falta.
 *
 * Sin red: `today` (día local, `YYYY-MM-DD`) se inyecta.
 */

import type { ConversationBolo } from './conversation-relation';
import type { OrgMergeLine } from './organization-merge';
import { orderBolos } from './sheet-mirror';
import { MISSING_MAX, personMissing, type PersonMissing, type PersonMissingConversation } from './record-missing';

/** Los tipos de organización (`workspace_organization_kind_check`). */
export const ORGANIZATION_KINDS = [
  'company',
  'festival',
  'theatre',
  'presenter',
  'agency',
  'institution',
  // «Por libre» (ADR-177 § 3, 115): dicho por alguien; sin él, `conversation_feed` lo deduce.
  'solo',
  'other',
] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/**
 * Lo que se pregunta a un contacto sin tipo (ADR-177 § 2, punto 115): en la
 * conversación, de uno en uno, y en la selección de la lista, en bloque.
 * «Ayuntamiento» es `institution`: la fila dice lo que se guardó.
 */
export const ASKED_KINDS = ['theatre', 'festival', 'institution', 'solo'] as const satisfies readonly OrganizationKind[];
export type AskedKind = (typeof ASKED_KINDS)[number];

/** Si a la organización le falta el tipo: ni tipo (salvo «otra») ni «por libre». */
export function needsKind(place: { kind?: string | null; solo?: boolean | null } | null | undefined): boolean {
  if (!place || place.solo) return false;
  return !place.kind || place.kind === 'other';
}

/**
 * «Por libre» deducido, la regla de `conversation_feed` (ADR-177 § 3): una
 * sola persona viva de la organización, que se llama como ella sin
 * mayúsculas ni espacios de más. O el tipo `solo`, dicho por alguien.
 */
export function isSolo(org: { name: string; kind?: string | null }, people: readonly { full_name: string }[]): boolean {
  if (org.kind === 'solo') return true;
  const norm = (s: string) => s.trim().toLowerCase();
  return people.length === 1 && norm(people[0].full_name) === norm(org.name);
}

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

/** Una sala que la organización programa (`venue.organization_id`, 92). */
export interface OrgVenue {
  id: string;
  slug: string | null;
  name: string;
  city: string | null;
}

/** El proyecto de una conversación, con su color (ADR-177 § 4: una fila por espectáculo). */
export interface OrgProject {
  id: string;
  slug: string;
  name: string;
  accent: string | null;
  initials: string | null;
}

/** Un bolo de la organización, con su importe si quien mira lee dinero. */
export type OrgBolo = ConversationBolo & { fee_amount?: number | null; fee_currency?: string | null };

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
    project: OrgProject | null;
  }>;
  contacts: OrgConversationContact[];
  staff: OrgStaff[];
  venues: OrgVenue[];
  /** Con su caché cuando quien mira lee dinero (`list_money_bolos`); sin él, sin cifra. */
  bolos: OrgBolo[];
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
  /** Para llamar: la ficha de la sala sirve para preparar una llamada (ADR-177 § 4). */
  phone: string | null;
  email: string | null;
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
  const reachOf = (email: string | null, phone: string | null) => ({
    phone: phone || null,
    email: email || null,
    ...(email ? { reach: email, reachHref: `mailto:${email}` } : phone ? { reach: phone, reachHref: `tel:${phone}` } : { reach: null, reachHref: null }),
  });

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
      prev.phone ??= s.phone || null;
      prev.email ??= s.email || null;
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

/** Sus bolos, en el orden en que importan (`orderBolos`, el mismo del espejo). */
export function orgBolos<B extends ConversationBolo>(bolos: readonly B[], today: string): B[] {
  return orderBolos(bolos, today);
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
