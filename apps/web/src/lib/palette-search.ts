/**
 * ⌘K, lo que se busca pero no se fija: contactos, organizaciones y
 * conversaciones de los espacios de quien busca.
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
export interface PaletteSearchResult {
  persons: SearchPerson[];
  organizations: SearchOrganization[];
  conversations: SearchConversation[];
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

export function paletteSearchQueryOptions(term: string, workspaceIds: string[]) {
  return {
    queryKey: ['palette-search', term, workspaceIds] as const,
    enabled: term.length >= 2 && workspaceIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<PaletteSearchResult>(
        `/api/search?q=${encodeURIComponent(term)}&workspace_ids=${workspaceIds.join(',')}`,
        signal,
      ),
  };
}

/** Una fila de destino del ⌘K: abre `href`, no se fija. */
export interface FindRow {
  kind: 'contact' | 'organization' | 'conversation';
  /** Única entre todas las filas de la paleta. */
  token: string;
  name: string;
  path: string;
  href: string;
}

/**
 * Las filas de los tres grupos.
 *
 * - Un contacto que ya está en el equipo no se repite: allí se puede fijar.
 * - Una organización con UNA conversación abre esa conversación (no hay ficha
 *   de organización), y esa conversación no se repite en su grupo. Con varias
 *   o ninguna, abre la lente de Conversaciones buscando su nombre.
 * - Un espacio que no está en la lista (no debería pasar) deja la fila fuera:
 *   sin su slug no hay a dónde ir.
 */
export function paletteFindRows(
  result: PaletteSearchResult | undefined,
  o: {
    teamPersonIds: ReadonlySet<string>;
    workspaces: readonly { id: string; slug: string; name: string }[];
    spaceLabel: (name: string) => string;
  },
): { contacts: FindRow[]; organizations: FindRow[]; conversations: FindRow[] } {
  const empty = { contacts: [], organizations: [], conversations: [] };
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

  const opened = new Set<string>();
  const organizations: FindRow[] = [];
  for (const org of result.organizations) {
    const w = ws.get(org.workspace_id);
    if (!w) continue;
    const only = org.conversation_ids.length === 1 ? org.conversation_ids[0] : null;
    if (only) opened.add(only);
    organizations.push({
      kind: 'organization',
      token: `f:org:${org.id}`,
      name: org.name,
      path: many ? o.spaceLabel(w.name) : '',
      href: only
        ? `/h/${w.slug}/conversation/${only}`
        : `/h/conversations?q=${encodeURIComponent(org.name)}`,
    });
  }

  const conversations: FindRow[] = [];
  for (const c of result.conversations) {
    const w = ws.get(c.workspace_id);
    if (!w || opened.has(c.id) || !c.title) continue;
    conversations.push({
      kind: 'conversation',
      token: `f:conv:${c.id}`,
      name: c.title,
      path: c.project_name ?? (many ? o.spaceLabel(w.name) : ''),
      href: `/h/${w.slug}/conversation/${c.id}`,
    });
  }
  return { contacts, organizations, conversations };
}
