/**
 * GET /api/search?q=&workspace_ids=a,b[&day=YYYY-MM-DD]: lo que el ⌘K
 * encuentra y no fija (`$lib/palette-search`): contactos, organizaciones,
 * conversaciones, salas, funciones y bolos de esos espacios, cada grupo con
 * `SEARCH_LIMIT` filas como mucho.
 *
 * Todo con la RLS de quien busca. Las conversaciones van por
 * `conversation_search` (ADR-102), la misma que la lente: organización o
 * cualquier contacto, nombre o email. Funciones y bolos (ADR-164 § 4): por
 * sala o ciudad, y por la organización de su conversación. TODO EN UNA VUELTA
 * (ADR-167 § 3): lo de la organización iba en una segunda, con los ids de las
 * conversaciones de las organizaciones encontradas, y cada vuelta es otro
 * viaje a la base; ahora es un filtro sobre la conversación embebida
 * (`conversation!inner`), en paralelo con lo demás. Con `day`, también las
 * funciones de ese día y, por `list_performance_bolo_links`, sus bolos (esa
 * cadena sí espera: solo cuando se escribe una fecha). Un bolo se lee de su
 * tabla, cuya política pide `read:money`: quien no lee dinero no recibe
 * ninguno, sin error.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import {
  SEARCH_LIMIT,
  paletteSearchTerm,
  type PaletteSearchResult,
  searchPerformanceOrder,
  type SearchBolo,
  type SearchConversation,
  type SearchOrganization,
  type SearchPerformance,
  type SearchPerson,
  type SearchVenue,
} from '$lib/palette-search';

type PersonRow = Omit<SearchPerson, 'organization_name'> & { organization: { name: string } | null };
type ConvRow = {
  id: string;
  workspace_id: string;
  project: { name: string } | null;
  organization: { name: string } | null;
  contacts: { is_primary: boolean; person: { full_name: string } | null }[] | null;
};
type PerfRow = Omit<SearchPerformance, 'project_name'> & { project: { name: string } | null };
type BoloRow = Omit<SearchBolo, 'project_name'> & { project: { name: string } | null };

const PERF_SELECT = 'workspace_id,id,slug,performed_at,status,venue_name,city,project:project_id(name)';
const BOLO_SELECT = 'workspace_id,id,project_id,venue_name,city,project:project_id(name)';
/** Solo filtra: la organización de la conversación de la fila (vacío, no vuelve en la respuesta). */
const BY_ORG = 'conversation!inner(organization:workspace_organization!conversation_workspace_organization_fkey!inner())';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const term = paletteSearchTerm(url.searchParams.get('q') ?? '');
  const ids = [
    ...new Set(
      (url.searchParams.get('workspace_ids') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => UUID_RE.test(x)),
    ),
  ];
  const empty: PaletteSearchResult = {
    persons: [],
    organizations: [],
    conversations: [],
    venues: [],
    performances: [],
    bolos: [],
  };
  const dayParam = url.searchParams.get('day');
  const day = dayParam && DAY_RE.test(dayParam) ? dayParam : null;
  if (!term || ids.length === 0) return jsonNoStore(empty);

  const inWs = `in.(${ids.join(',')})`;
  const like = `*${term}*`;
  const limit = String(SEARCH_LIMIT);

  const persons = new URLSearchParams({
    select:
      'workspace_id,person_id,slug,full_name,organization:workspace_organization!workspace_person_organization_fkey(name)',
    workspace_id: inWs,
    // Entre comillas: un punto o un espacio del texto no rompen la gramática.
    or: `(full_name.ilike."${like}",email.ilike."${like}")`,
    deleted_at: 'is.null',
    order: 'full_name.asc',
    limit,
  });
  const orgs = new URLSearchParams({
    select: 'workspace_id,id,slug,name',
    workspace_id: inWs,
    name: `ilike.${like}`,
    deleted_at: 'is.null',
    order: 'name.asc',
    limit,
  });
  const convs = new URLSearchParams({
    select:
      'id,workspace_id,project:project_id(name),organization:workspace_organization!conversation_workspace_organization_fkey(name),contacts:conversation_contact(is_primary,person:workspace_person!conversation_contact_workspace_person_fkey(full_name))',
    p_q: term,
    workspace_id: inWs,
    deleted_at: 'is.null',
    // Sin `order`: sobre esta RPC, la PostgREST local responde 42703
    // («column conversation.updated_at does not exist») a cualquier orden.
    // Las filas se ordenan aquí por título.
    limit,
  });

  const byPlace = `(venue_name.ilike."${like}",city.ilike."${like}")`;
  const venues = new URLSearchParams({
    select: 'workspace_id,id,slug,name,city',
    workspace_id: inWs,
    or: `(name.ilike."${like}",city.ilike."${like}")`,
    deleted_at: 'is.null',
    order: 'name.asc',
    limit,
  });
  const perfSearch = (filter: Record<string, string>, select = PERF_SELECT) =>
    new URLSearchParams({
      select,
      workspace_id: inWs,
      deleted_at: 'is.null',
      order: 'performed_at.desc',
      limit,
      ...filter,
    });
  const boloSearch = (filter: Record<string, string>, select = BOLO_SELECT) =>
    new URLSearchParams({ select, workspace_id: inWs, deleted_at: 'is.null', limit, ...filter });
  const byOrg = { 'conversation.organization.name': `ilike.${like}`, 'conversation.deleted_at': 'is.null' };

  try {
    const [p, o, c, v, perfPlace, perfDay, boloPlace, perfOrg, boloOrg] = await Promise.all([
      pgGet<PersonRow>(env, 'workspace_person', jwt, { search: persons }),
      pgGet<SearchOrganization>(env, 'workspace_organization', jwt, { search: orgs }),
      pgGet<ConvRow>(env, 'rpc/conversation_search', jwt, { search: convs }),
      pgGet<SearchVenue>(env, 'venue', jwt, { search: venues }),
      pgGet<PerfRow>(env, 'performance', jwt, { search: perfSearch({ or: byPlace }) }),
      day ? pgGet<PerfRow>(env, 'performance', jwt, { search: perfSearch({ performed_at: `eq.${day}` }) }) : null,
      pgGet<BoloRow>(env, 'bolo', jwt, { search: boloSearch({ or: byPlace }) }),
      pgGet<PerfRow>(env, 'performance', jwt, { search: perfSearch(byOrg, `${PERF_SELECT},${BY_ORG}`) }),
      pgGet<BoloRow>(env, 'bolo', jwt, { search: boloSearch(byOrg, `${BOLO_SELECT},${BY_ORG}`) }),
    ]);

    // Solo con una fecha escrita: los bolos de las funciones de ese día.
    const dayPerfIds = (perfDay?.data ?? []).map((r) => r.id);
    const dayLinks = dayPerfIds.length
      ? await pgPostRpc<{ performance_id: string; bolo_id: string | null }>(env, 'list_performance_bolo_links', jwt, {
          p_performance_ids: dayPerfIds,
        })
      : null;
    const dayBoloIds = [...new Set((dayLinks?.data ?? []).flatMap((l) => (l.bolo_id ? [l.bolo_id] : [])))];
    const boloDay = dayBoloIds.length
      ? await pgGet<BoloRow>(env, 'bolo', jwt, { search: boloSearch({ id: `in.(${dayBoloIds.join(',')})` }) })
      : null;

    const today = new Date().toISOString().slice(0, 10);
    const perfOut = ({ project, ...r }: PerfRow): SearchPerformance => ({ ...r, project_name: project?.name ?? null });
    const boloOut = ({ project, ...r }: BoloRow): SearchBolo => ({ ...r, project_name: project?.name ?? null });
    // Lo del día primero: una fecha escrita es lo que se busca.
    const bolosAll = [...(boloDay?.data ?? []), ...boloPlace.data, ...boloOrg.data];
    const result: PaletteSearchResult = {
      persons: p.data.map(({ organization, ...r }) => ({ ...r, organization_name: organization?.name ?? null })),
      organizations: o.data,
      conversations: c.data.map(
        (r): SearchConversation => ({
          id: r.id,
          workspace_id: r.workspace_id,
          title:
            r.organization?.name ||
            r.contacts?.find((x) => x.is_primary)?.person?.full_name ||
            r.contacts?.[0]?.person?.full_name ||
            '',
          project_name: r.project?.name ?? null,
        }),
      ).sort((a, b) => a.title.localeCompare(b.title)),
      venues: v.data,
      performances: searchPerformanceOrder(
        [...(perfDay?.data ?? []), ...perfPlace.data, ...perfOrg.data],
        today,
      ).map(perfOut),
      bolos: [...new Map(bolosAll.map((b) => [b.id, b])).values()].slice(0, SEARCH_LIMIT).map(boloOut),
    };
    return jsonNoStore(result);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/search', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
