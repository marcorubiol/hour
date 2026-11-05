/**
 * GET /api/organizations/:key?workspace_id=:workspace — la ficha de una
 * organización (ADR-159): la organización, sus conversaciones de todos los
 * proyectos (lo justo para «Falta»; la lista la lee `/api/conversations` con
 * `organization_id`), sus bolos (`conversations_bolos`, con su caché sólo para quien lee dinero) y sus
 * contactos: los de sus conversaciones y quien la tiene en su dossier, y las
 * salas que programa (`venue.organization_id`, 92, ADR-170). `key`
 * es el id o el slug. RLS decide cada lectura: una conversación privada de
 * otro no sale, ni sus bolos ni sus contactos.
 *
 * PATCH /api/organizations/:id — { name, kind, city, email } via
 * `update_workspace_organization` (§ 64): what the file shows, editable.
 * Every field travels; an empty one clears it (not the name; an empty kind
 * is `other`). The RPC gates on owner, admin or member who can read it.
 *
 * DELETE /api/organizations/:id — soft-delete an organization of the
 * workspace through `delete_workspace_organization` (ADR-048: a soft delete
 * never rides a client PATCH). The RPC gates on owner, admin or member of the
 * workspace, and refuses while a live conversation or invoice uses it.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import * as v from 'valibot';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { conversationRelation, type ConversationDbItem } from '$lib/conversation';
import { TURN_EMBEDS, loadConversationBolos, setLastTurnEmbed } from '$lib/server/conversation-overview';
import { ORGANIZATION_KINDS, type OrgBolo, type OrgProject, type OrganizationFile, type OrgConversationContact, type OrgStaff, type OrgVenue } from '$lib/organization-record';
import type { OrgMergeLine } from '$lib/organization-merge';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';

const QuerySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
});

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const query = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!query.success) return json({ error: 'invalid_query', hint: 'workspace_id is required.' }, 400);
  const workspaceId = query.output.workspace_id;
  const key = params.id;
  if (!UUID_RE.test(key) && !/^[a-z0-9-]{1,120}$/.test(key)) return json({ error: 'invalid_id' }, 400);

  try {
    const orgSearch = new URLSearchParams({
      select: 'id,workspace_id,slug,name,kind,city,country,email,phone,website,address',
      workspace_id: `eq.${workspaceId}`,
      deleted_at: 'is.null',
      limit: '1',
    });
    orgSearch.set(UUID_RE.test(key) ? 'id' : 'slug', `eq.${key}`);
    let org = await pgGet<OrganizationFile['organization']>(env, 'workspace_organization', jwt, { search: orgSearch });
    // The slug of an organization merged into this one still opens it
    // (`previous_slugs`, 84); a live slug always wins.
    if (org.data.length === 0 && !UUID_RE.test(key)) {
      const previous = new URLSearchParams(orgSearch);
      previous.delete('slug');
      previous.set('previous_slugs', `cs.{${key}}`);
      org = await pgGet<OrganizationFile['organization']>(env, 'workspace_organization', jwt, { search: previous });
    }
    if (org.data.length === 0) return json({ error: 'not_found' }, 404);
    const o = org.data[0];

    const convSearch = new URLSearchParams({
      select:
        `id,next_action_at,next_action_note,reply_settled_at,last_contacted_at,custom_fields,not_now_at,not_now_until,first_contacted_at,contacted_undated,regular:conversation_regular,project:project_id(id,slug,name,accent,initials),contacts:conversation_contact(person_id,role,since,until,is_primary,person:workspace_person!conversation_contact_workspace_person_fkey(slug,full_name,email,phone)),${TURN_EMBEDS}`,
      workspace_id: `eq.${workspaceId}`,
      organization_id: `eq.${o.id}`,
      deleted_at: 'is.null',
      order: 'updated_at.desc',
      limit: '200',
    });
    // The relation needs the last turn, as in the person's file (ADR-138).
    setLastTurnEmbed(convSearch);
    const staffSearch = new URLSearchParams({
      select: 'person_id,slug,full_name,title,email,phone',
      workspace_id: `eq.${workspaceId}`,
      organization_id: `eq.${o.id}`,
      deleted_at: 'is.null',
      limit: '200',
    });
    type ConvRow = ConversationDbItem & {
      project: OrgProject | null;
      contacts: OrgConversationContact[];
    };
    const venueSearch = new URLSearchParams({
      select: 'id,slug,name,city',
      workspace_id: `eq.${workspaceId}`,
      organization_id: `eq.${o.id}`,
      deleted_at: 'is.null',
      order: 'name.asc',
      limit: '200',
    });
    // The merges this one absorbed and can still undo (`organization_merge`:
    // RLS shows it to the space's admin only; anyone else reads none).
    const mergesSearch = new URLSearchParams({
      select: 'id,merged_at,drop_name:drop_before->>name',
      workspace_id: `eq.${workspaceId}`,
      keep_organization_id: `eq.${o.id}`,
      undone_at: 'is.null',
      order: 'merged_at.desc',
      limit: '5',
    });
    const [conversations, staff, venues, admin, merges] = await Promise.all([
      pgGet<ConvRow>(env, 'conversation', jwt, { search: convSearch }),
      pgGet<OrgStaff>(env, 'workspace_person', jwt, { search: staffSearch }),
      pgGet<OrgVenue>(env, 'venue', jwt, { search: venueSearch }),
      // «Fusionar con…» is the admin's verb, as in the person's file.
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId }),
      pgGet<OrgMergeLine>(env, 'organization_merge', jwt, { search: mergesSearch }),
    ]);

    // Sin `read:performance` la RPC no devuelve nada, así que un bolo nunca
    // hace fallar la ficha.
    const bolos = [...(await loadConversationBolos(env, jwt, conversations.data.map((c) => c.id))).values()].flat();
    const fees = await loadBoloFees(env, jwt, bolos);

    const file: OrganizationFile = {
      organization: o,
      conversations: conversations.data.map((c) => ({
        id: c.id,
        relation: conversationRelation(c),
        next_action_at: c.next_action_at,
        project: c.project,
        // The chat row of each project (mesa, punto 6): the last thing said and the turn.
        next_action_note: c.next_action_note ?? null,
        reply_settled_at: c.reply_settled_at ?? null,
        not_now_at: c.not_now_at ?? null,
        not_now_until: c.not_now_until ?? null,
        last_contacted_at: c.last_contacted_at ?? null,
        first_contacted_at: c.first_contacted_at ?? null,
        contacted_undated: c.contacted_undated ?? false,
        last_turn: c.last_turn ?? null,
        last_in: c.last_in ?? null,
        person: c.contacts?.find((x) => x.is_primary)?.person?.full_name ?? null,
      })),
      contacts: conversations.data.flatMap((c) => c.contacts ?? []),
      staff: staff.data,
      venues: venues.data,
      bolos: bolos.map((b): OrgBolo => {
        const fee = fees.get(b.bolo_id);
        return fee ? { ...b, ...fee } : b;
      }),
      can_merge: admin.data[0] === true,
      merges: merges.data,
    };
    return json(file);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/organizations/[id]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

/**
 * El caché de esos bolos (ADR-177 § 4: «bolos con importe»), por la misma
 * puerta que Cuentas: `list_money_bolos` sólo devuelve filas a quien lee
 * dinero en su proyecto. Sin ellas, o si falla, la ficha sale sin cifras: el
 * dinero nunca hace fallar la ficha, y enmascarado y vacío se ven igual.
 */
async function loadBoloFees(
  env: SupabaseEnv,
  jwt: string,
  bolos: readonly { bolo_id: string; project_id: string }[],
): Promise<Map<string, { fee_amount: number | null; fee_currency: string | null }>> {
  const out = new Map<string, { fee_amount: number | null; fee_currency: string | null }>();
  if (bolos.length === 0) return out;
  const wanted = new Set(bolos.map((b) => b.bolo_id));
  try {
    const { data } = await pgPostRpc<{ id: string; fee_amount: number | null; fee_currency: string | null }>(
      env,
      'list_money_bolos',
      jwt,
      {
        p_project_ids: [...new Set(bolos.map((b) => b.project_id))],
        // Filtros en unión: sólo los proyectos, o saldría todo el espacio.
        p_workspace_ids: null,
        p_line_ids: null,
        p_from: null,
        p_to: null,
        p_limit: 500,
      },
    );
    for (const r of data) if (wanted.has(r.id)) out.set(r.id, { fee_amount: r.fee_amount, fee_currency: r.fee_currency });
  } catch {
    // Sin dinero no hay cifra; la ficha sigue.
  }
  return out;
}

const PatchSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  kind: v.nullish(v.union([v.literal(''), v.picklist(ORGANIZATION_KINDS)])),
  city: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(120))),
  email: v.nullish(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320))])),
});

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  const parsed = v.safeParse(PatchSchema, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const b = parsed.output;

  try {
    const { data } = await pgPostRpc<OrganizationFile['organization']>(env, 'update_workspace_organization', jwt, {
      p_organization_id: params.id,
      p_name: b.name,
      p_kind: b.kind || null,
      p_city: b.city || null,
      p_email: b.email || null,
    });
    if (data.length === 0) return json({ error: 'update_failed' }, 502);
    const o = data[0];
    // Only what the file reads: the row also carries notes and custom fields.
    return json({
      organization: {
        id: o.id,
        workspace_id: o.workspace_id,
        slug: o.slug,
        name: o.name,
        kind: o.kind,
        city: o.city,
        country: o.country,
        email: o.email,
        phone: o.phone,
        website: o.website,
        address: o.address,
      },
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/organizations/[id]', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '23505': { status: 409, error: 'name_taken' },
          '42501': { status: 404, error: 'not_found' },
        },
      },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_workspace_organization', jwt, { p_organization_id: params.id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/organizations/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '23503': {
            status: 409,
            error: 'organization_in_use',
            hint: 'Delete its conversations and invoices first.',
          },
        },
      },
    );
  }
};
