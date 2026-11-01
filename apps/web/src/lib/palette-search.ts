/**
 * ⌘K, lo que se busca pero no se fija: contactos, organizaciones,
 * conversaciones, salas, funciones y bolos de los espacios de quien busca.
 * Funciones y bolos se encuentran por sala, ciudad, organización y fecha
 * (ADR-162 § 4); un bolo solo sale a quien lee dinero en su proyecto
 * (`bolo_select` pide `read:money`).
 *
 * El equipo (reparto y técnica) sigue siendo el eje de personas que se puede
 * fijar en el ámbito; la agenda de contactos no lo es, porque cientos de
 * programadores no son «nosotros». Pero buscarlos sí: con 24 contactos en el
 * espacio y nadie en un reparto, el ⌘K decía «Todavía no hay nadie», y eso se
 * lee como una búsqueda rota. Estas filas son destinos, como un día: abren su
 * ficha y no entran en el ámbito.
 *
 * La búsqueda es del servidor (`GET /api/search`): la agenda puede tener
 * cientos de filas y no se baja entera para filtrar en el navegador.
 */

import { fetchJSON } from './api';
import type { PeekTarget } from './peek';

/** Un contacto: un dossier del espacio (`workspace_person`). */
export interface SearchPerson {
  workspace_id: string;
  person_id: string;
  slug: string;
  full_name: string;
  organization_name: string | null;
}
/** Una organización (`workspace_organization`) con sus conversaciones vivas. */
export interface SearchOrganization {
  workspace_id: string;
  id: string;
  slug: string;
  name: string;
  conversation_ids: string[];
}
/** Una conversación cuya organización o algún contacto contiene el texto. */
export interface SearchConversation {
  workspace_id: string;
  id: string;
  title: string;
  project_name: string | null;
}
/** Una sala del espacio (`venue`): su nombre o su ciudad contienen el texto. */
export interface SearchVenue {
  workspace_id: string;
  id: string;
  slug: string | null;
  name: string;
  city: string | null;
}
/** Una función cuya sala, ciudad u organización contiene el texto, o del día escrito. */
export interface SearchPerformance {
  workspace_id: string;
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  venue_name: string | null;
  city: string | null;
  project_name: string | null;
}
/** Un bolo, igual que una función; solo con `read:money` en su proyecto. */
export interface SearchBolo {
  workspace_id: string;
  id: string;
  project_id: string;
  venue_name: string | null;
  city: string | null;
  project_name: string | null;
}
export interface PaletteSearchResult {
  persons: SearchPerson[];
  organizations: SearchOrganization[];
  conversations: SearchConversation[];
  venues: SearchVenue[];
  performances: SearchPerformance[];
  bolos: SearchBolo[];
}

/** Filas por grupo: el ⌘K salta, no lista. */
export const SEARCH_LIMIT = 8;

/**
 * El texto que llega a PostgREST: sin sus metacaracteres de patrón (`%`, `_`,
 * `*`) ni los de la gramática de `or=(…)` (`,`, `(`, `)`), con los espacios
 * juntos. Menos de dos letras no busca: una sola letra lo encuentra todo.
 */
export function paletteSearchTerm(raw: string): string {
  const term = raw
    .replace(/[%_*,()"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return term.length >= 2 ? term : '';
}

/**
 * `day` (YYYY-MM-DD) es la fecha que el texto nombra entera (`parseDayQuery`
 * en la paleta): con ella, también las funciones de ese día y sus bolos.
 */
export function paletteSearchQueryOptions(term: string, workspaceIds: string[], day: string | null = null) {
  return {
    queryKey: ['palette-search', term, workspaceIds, day] as const,
    enabled: term.length >= 2 && workspaceIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<PaletteSearchResult>(
        `/api/search?q=${encodeURIComponent(term)}&workspace_ids=${workspaceIds.join(',')}${day ? `&day=${day}` : ''}`,
        signal,
      ),
  };
}

/**
 * Las funciones en el orden en que se buscan: las que vienen, la más cercana
 * primero; después las pasadas, la última primero. Una vez cada una, y
 * `SEARCH_LIMIT` como mucho.
 */
export function searchPerformanceOrder<T extends { id: string; performed_at: string }>(rows: readonly T[], today: string): T[] {
  const once = [...new Map(rows.map((r) => [r.id, r])).values()];
  const day = (r: T) => r.performed_at.slice(0, 10);
  const coming = once.filter((r) => day(r) >= today).sort((a, b) => day(a).localeCompare(day(b)));
  const past = once.filter((r) => day(r) < today).sort((a, b) => day(b).localeCompare(day(a)));
  return [...coming, ...past].slice(0, SEARCH_LIMIT);
}

/** Una fila de destino del ⌘K: abre `href`, no se fija. */
export interface FindRow {
  kind: 'contact' | 'organization' | 'conversation' | 'venue' | 'performance' | 'bolo';
  /** Única entre todas las filas de la paleta. */
  token: string;
  name: string;
  path: string;
  /** Su página; vacío cuando no tiene (un bolo), y entonces abre `peek`. */
  href: string;
  /** Lo que no tiene página se abre en el vistazo (un bolo, ADR-139 p1). */
  peek?: PeekTarget;
}

/** Cada grupo de filas de destino, en el orden de la paleta. */
export interface FindRows {
  contacts: FindRow[];
  organizations: FindRow[];
  conversations: FindRow[];
  venues: FindRow[];
  performances: FindRow[];
  bolos: FindRow[];
}

/**
 * Las filas de los grupos.
 *
 * - Un contacto que ya está en el equipo no se repite: allí se puede fijar.
 * - Una organización abre su ficha (ADR-159), tenga una conversación o
 *   varias; sus conversaciones salen en su grupo, cada una a lo suyo.
 * - Una sala abre su ficha (ADR-162); una función, la suya, con su día y su
 *   proyecto al lado; un bolo, su vistazo (no tiene página).
 * - Un espacio que no está en la lista (no debería pasar) deja la fila fuera:
 *   sin su slug no hay a dónde ir.
 */
export function paletteFindRows(
  result: PaletteSearchResult | undefined,
  o: {
    teamPersonIds: ReadonlySet<string>;
    workspaces: readonly { id: string; slug: string; name: string }[];
    spaceLabel: (name: string) => string;
    /** Cómo se dice el día de una función en su fila. */
    dayLabel: (iso: string) => string;
  },
): FindRows {
  const empty = { contacts: [], organizations: [], conversations: [], venues: [], performances: [], bolos: [] };
  if (!result) return empty;
  const ws = new Map(o.workspaces.map((w) => [w.id, w]));
  const many = o.workspaces.length > 1;

  const contacts: FindRow[] = [];
  for (const p of result.persons) {
    const w = ws.get(p.workspace_id);
    if (!w || o.teamPersonIds.has(p.person_id)) continue;
    contacts.push({
      kind: 'contact',
      token: `f:person:${p.workspace_id}:${p.person_id}`,
      name: p.full_name,
      path: p.organization_name ?? (many ? o.spaceLabel(w.name) : ''),
      href: `/h/${w.slug}/person/${p.slug}/`,
    });
  }

  const organizations: FindRow[] = [];
  for (const org of result.organizations) {
    const w = ws.get(org.workspace_id);
    if (!w) continue;
    organizations.push({
      kind: 'organization',
      token: `f:org:${org.id}`,
      name: org.name,
      path: many ? o.spaceLabel(w.name) : '',
      href: `/h/${w.slug}/organization/${encodeURIComponent(org.slug)}`,
    });
  }

  const conversations: FindRow[] = [];
  for (const c of result.conversations) {
    const w = ws.get(c.workspace_id);
    if (!w || !c.title) continue;
    conversations.push({
      kind: 'conversation',
      token: `f:conv:${c.id}`,
      name: c.title,
      path: c.project_name ?? (many ? o.spaceLabel(w.name) : ''),
      href: `/h/${w.slug}/conversation/${c.id}`,
    });
  }

  // Una respuesta de antes de estos grupos (la caché del dispositivo) no los trae.
  const venues: FindRow[] = [];
  for (const v of result.venues ?? []) {
    const w = ws.get(v.workspace_id);
    if (!w) continue;
    venues.push({
      kind: 'venue',
      token: `f:venue:${v.id}`,
      name: v.name,
      path: v.city ?? (many ? o.spaceLabel(w.name) : ''),
      href: `/h/${w.slug}/venue/${encodeURIComponent(v.slug ?? v.id)}`,
    });
  }

  const performances: FindRow[] = [];
  for (const p of result.performances ?? []) {
    const w = ws.get(p.workspace_id);
    if (!w || !p.slug) continue;
    performances.push({
      kind: 'performance',
      token: `f:perf:${p.id}`,
      name: p.venue_name || p.city || p.project_name || o.dayLabel(p.performed_at),
      path: [o.dayLabel(p.performed_at), p.project_name].filter(Boolean).join(' · '),
      href: `/h/${w.slug}/performance/${encodeURIComponent(p.slug)}`,
    });
  }

  const bolos: FindRow[] = [];
  for (const b of result.bolos ?? []) {
    const w = ws.get(b.workspace_id);
    const name = b.venue_name || b.city || b.project_name;
    if (!w || !name) continue;
    bolos.push({
      kind: 'bolo',
      token: `f:bolo:${b.id}`,
      name,
      path: b.project_name ?? '',
      href: '',
      peek: { kind: 'bolo', projectId: b.project_id, id: b.id },
    });
  }

  return { contacts, organizations, conversations, venues, performances, bolos };
}
