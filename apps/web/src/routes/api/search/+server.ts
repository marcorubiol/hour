/**
 * GET /api/search?q=&workspace_ids=a,b: lo que el ⌘K encuentra y no fija
 * (`$lib/palette-search`): contactos, organizaciones y conversaciones de esos
 * espacios, cada grupo con `SEARCH_LIMIT` filas como mucho.
 *
 * Tres lecturas en paralelo con la RLS de quien busca. Las conversaciones van
 * por `conversation_search` (ADR-102), la misma que la lente: organización o
 * cualquier contacto, nombre o email.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import {
  SEARCH_LIMIT,
  paletteSearchTerm,
  type PaletteSearchResult,
  type SearchConversation,
  type SearchOrganization,
  type SearchPerson,
} from '$lib/palette-search';

type PersonRow = Omit<SearchPerson, 'organization_name'> & { organization: { name: string } | null };
type OrgRow = Omit<SearchOrganization, 'conversation_ids'> & { conversations: { id: string }[] | null };
type ConvRow = {
  id: string;
  workspace_id: string;
  project: { name: string } | null;
  organization: { name: string } | null;
  contacts: { is_primary: boolean; person: { full_name: string } | null }[] | null;
};

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
  const empty: PaletteSearchResult = { persons: [], organizations: [], conversations: [] };
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
    select: 'workspace_id,id,name,conversations:conversation!conversation_workspace_organization_fkey(id)',
    workspace_id: inWs,
    name: `ilike.${like}`,
    deleted_at: 'is.null',
    'conversations.deleted_at': 'is.null',
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

  try {
    const [p, o, c] = await Promise.all([
      pgGet<PersonRow>(env, 'workspace_person', jwt, { search: persons }),
      pgGet<OrgRow>(env, 'workspace_organization', jwt, { search: orgs }),
      pgGet<ConvRow>(env, 'rpc/conversation_search', jwt, { search: convs }),
    ]);
    const result: PaletteSearchResult = {
      persons: p.data.map(({ organization, ...r }) => ({ ...r, organization_name: organization?.name ?? null })),
      organizations: o.data.map(({ conversations, ...r }) => ({
        ...r,
        conversation_ids: (conversations ?? []).map((x) => x.id),
      })),
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
