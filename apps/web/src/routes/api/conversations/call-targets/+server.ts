/**
 * GET /api/conversations/call-targets?q=&workspace_ids=a,b: «¿Con quién?»
 * de «Apuntar llamada» (121 A, ADR-182; `$lib/call-log`).
 *
 * Personas (dossier del espacio, por nombre o email) y organizaciones (por
 * nombre) de esos espacios, `SEARCH_LIMIT` de cada, con lo que la fila dice
 * (tipo y lugar, ADR-177 § 2), si la persona es del equipo, y sus
 * conversaciones con la última tocada primero. Las de una persona son las
 * suyas como contacto y las de su casa: la conversación es con la
 * organización, la persona sólo sirve para encontrarla.
 *
 * Sin texto, las organizaciones de las últimas conversaciones con contacto.
 *
 * Todo con la RLS de quien busca: lo que no ve no sale, ni cuenta.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { SEARCH_LIMIT, paletteSearchTerm } from '$lib/palette-search';
import {
  byLastTouched,
  mergeCallTargets,
  touchedAt,
  type CallConversation,
  type CallTarget,
  type CallTargetsResponse,
} from '$lib/call-log';

type OrgEmbed = { id: string; name: string; kind: string | null; city: string | null };
type PersonRow = {
  workspace_id: string;
  person_id: string;
  full_name: string;
  title: string | null;
  city: string | null;
  organization_id: string | null;
  organization: OrgEmbed | null;
};
type OrgRow = OrgEmbed & { workspace_id: string };
type ConvRow = {
  id: string;
  workspace_id: string;
  organization_id: string;
  project_id: string;
  last_contacted_at: string | null;
  updated_at: string | null;
  project: { name: string } | null;
};
type ContactRow = { conversation_id: string; workspace_id: string; person_id: string };
type TeamRow = { workspace_id: string; person_id: string };

const ORG_SELECT = 'workspace_id,id,name,kind,city';
const PERSON_SELECT =
  'workspace_id,person_id,full_name,title,city,organization_id,organization:workspace_organization!workspace_person_organization_fkey(id,name,kind,city)';
const CONV_SELECT = 'id,workspace_id,organization_id,project_id,last_contacted_at,updated_at,project:project_id(name)';
/** Cuántas conversaciones recientes se miran sin texto, para sacar sus organizaciones. */
const RECENT_LOOK = '40';
const BATCH = '1000';

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
  const empty: CallTargetsResponse = { persons: [], organizations: [] };
  if (ids.length === 0) return jsonNoStore(empty);

  const inWs = `in.(${ids.join(',')})`;
  const limit = String(SEARCH_LIMIT);
  const like = `*${term}*`;

  try {
    let persons: PersonRow[] = [];
    let orgs: OrgRow[] = [];
    if (term) {
      const [p, o] = await Promise.all([
        pgGet<PersonRow>(env, 'workspace_person', jwt, {
          search: new URLSearchParams({
            select: PERSON_SELECT,
            workspace_id: inWs,
            // Entre comillas: un punto o un espacio del texto no rompen la gramática.
            or: `(full_name.ilike."${like}",email.ilike."${like}")`,
            deleted_at: 'is.null',
            order: 'full_name.asc',
            limit,
          }),
        }),
        pgGet<OrgRow>(env, 'workspace_organization', jwt, {
          search: new URLSearchParams({
            select: ORG_SELECT,
            workspace_id: inWs,
            name: `ilike.${like}`,
            deleted_at: 'is.null',
            order: 'name.asc',
            limit,
          }),
        }),
      ]);
      persons = p.data;
      orgs = o.data;
    } else {
      // Sin texto: con quién se ha hablado último (sus organizaciones).
      const recent = await pgGet<{ workspace_id: string; organization_id: string }>(env, 'conversation', jwt, {
        search: new URLSearchParams({
          select: 'workspace_id,organization_id',
          workspace_id: inWs,
          deleted_at: 'is.null',
          last_contacted_at: 'not.is.null',
          order: 'last_contacted_at.desc',
          limit: RECENT_LOOK,
        }),
      });
      const orgIds = [...new Set(recent.data.map((r) => r.organization_id))].slice(0, SEARCH_LIMIT);
      if (orgIds.length === 0) return jsonNoStore(empty);
      const o = await pgGet<OrgRow>(env, 'workspace_organization', jwt, {
        search: new URLSearchParams({
          select: ORG_SELECT,
          workspace_id: inWs,
          id: `in.(${orgIds.join(',')})`,
          deleted_at: 'is.null',
        }),
      });
      const order = new Map(orgIds.map((id, i) => [id, i]));
      orgs = o.data.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (persons.length === 0 && orgs.length === 0) return jsonNoStore(empty);

    const personIds = [...new Set(persons.map((p) => p.person_id))];
    const inPersons = `in.(${personIds.join(',')})`;
    const roster = (table: 'cast_member' | 'crew_assignment') =>
      pgGet<TeamRow>(env, table, jwt, {
        search: new URLSearchParams({
          select: 'workspace_id,person_id',
          workspace_id: inWs,
          person_id: inPersons,
          deleted_at: 'is.null',
          limit: BATCH,
        }),
      });
    const none = { data: [] as never[] };
    const [contacts, cast, crew, going] = personIds.length
      ? await Promise.all([
          pgGet<ContactRow>(env, 'conversation_contact', jwt, {
            search: new URLSearchParams({
              select: 'conversation_id,workspace_id,person_id',
              workspace_id: inWs,
              person_id: inPersons,
              limit: BATCH,
            }),
          }),
          roster('cast_member'),
          roster('crew_assignment'),
          // ADR-107: whoever said «voy» is on the team too (as `/api/team`).
          pgGet<TeamRow>(env, 'commitment_person', jwt, {
            search: new URLSearchParams({
              select: 'workspace_id,person_id',
              workspace_id: inWs,
              person_id: inPersons,
              state: 'eq.going',
              limit: BATCH,
            }),
          }),
        ])
      : [none, none, none, none];

    const orgIds = [
      ...new Set([...orgs.map((o) => o.id), ...persons.flatMap((p) => (p.organization_id ? [p.organization_id] : []))]),
    ];
    const convIds = [...new Set(contacts.data.map((c) => c.conversation_id))];
    const or = [
      ...(orgIds.length ? [`organization_id.in.(${orgIds.join(',')})`] : []),
      ...(convIds.length ? [`id.in.(${convIds.join(',')})`] : []),
    ];
    const convs = or.length
      ? (
          await pgGet<ConvRow>(env, 'conversation', jwt, {
            search: new URLSearchParams({
              select: CONV_SELECT,
              workspace_id: inWs,
              deleted_at: 'is.null',
              or: `(${or.join(',')})`,
              limit: BATCH,
            }),
          })
        ).data
      : [];

    const view = (c: ConvRow): CallConversation => ({
      id: c.id,
      project_id: c.project_id,
      project_name: c.project?.name ?? null,
      touched_at: touchedAt(c),
    });
    const byOrg = new Map<string, CallConversation[]>();
    const byId = new Map<string, ConvRow>();
    for (const c of convs) {
      byId.set(c.id, c);
      const key = `${c.workspace_id}:${c.organization_id}`;
      byOrg.set(key, [...(byOrg.get(key) ?? []), view(c)]);
    }
    const byPerson = new Map<string, CallConversation[]>();
    for (const cc of contacts.data) {
      const c = byId.get(cc.conversation_id);
      if (!c) continue;
      const key = `${cc.workspace_id}:${cc.person_id}`;
      byPerson.set(key, [...(byPerson.get(key) ?? []), view(c)]);
    }
    const team = new Set([...cast.data, ...crew.data, ...going.data].map((r) => `${r.workspace_id}:${r.person_id}`));

    const personTargets = persons.map((p): CallTarget & { organization_id: string | null } => {
      const key = `${p.workspace_id}:${p.person_id}`;
      const home = p.organization_id ? (byOrg.get(`${p.workspace_id}:${p.organization_id}`) ?? []) : [];
      return {
        kind: 'person',
        workspace_id: p.workspace_id,
        id: p.person_id,
        name: p.full_name,
        title: p.title,
        house: p.organization?.name ?? null,
        org_kind: p.organization?.kind ?? null,
        // La de la persona; si no tiene, la de su casa (ADR-177 § 2, al revés que en la fila).
        city: p.city || p.organization?.city || null,
        team: team.has(key),
        conversations: byLastTouched([...(byPerson.get(key) ?? []), ...home]),
        organization_id: p.organization_id,
      };
    });
    const orgTargets = orgs.map(
      (o): CallTarget => ({
        kind: 'organization',
        workspace_id: o.workspace_id,
        id: o.id,
        name: o.name,
        title: null,
        house: null,
        org_kind: o.kind,
        city: o.city,
        team: false,
        conversations: byLastTouched(byOrg.get(`${o.workspace_id}:${o.id}`) ?? []),
      }),
    );
    return jsonNoStore(mergeCallTargets(personTargets, orgTargets));
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/conversations/call-targets', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
