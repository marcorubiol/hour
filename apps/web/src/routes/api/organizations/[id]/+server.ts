/**
 * GET /api/organizations/:key?workspace_id=:workspace — la ficha de una
 * organización (ADR-156): la organización, sus conversaciones de todos los
 * proyectos (lo justo para «Falta»; la lista la lee `/api/conversations` con
 * `organization_id`), sus bolos (`conversation_bolos`, sin dinero) y sus
 * contactos: los de sus conversaciones y quien la tiene en su dossier. `key`
 * es el id o el slug. RLS decide cada lectura: una conversación privada de
 * otro no sale, ni sus bolos ni sus contactos.
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
import type { ConversationBolo } from '$lib/conversation-relation';
import { TURN_EMBEDS, setLastTurnEmbed } from '$lib/server/conversation-overview';
import type { OrganizationFile, OrgConversationContact, OrgStaff } from '$lib/organization-record';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';

const QuerySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
});

/** Bolos de como mucho tantas conversaciones (una RPC cada una). */
const BOLO_READS_MAX = 40;

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
    const org = await pgGet<OrganizationFile['organization']>(env, 'workspace_organization', jwt, { search: orgSearch });
    if (org.data.length === 0) return json({ error: 'not_found' }, 404);
    const o = org.data[0];

    const convSearch = new URLSearchParams({
      select:
        `id,next_action_at,last_contacted_at,custom_fields,not_now_at,not_now_until,first_contacted_at,contacted_undated,regular:conversation_regular,project:project_id(id,slug,name),contacts:conversation_contact(person_id,role,since,until,is_primary,person:workspace_person!conversation_contact_workspace_person_fkey(slug,full_name,email,phone)),${TURN_EMBEDS}`,
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
      project: { id: string; slug: string; name: string } | null;
      contacts: OrgConversationContact[];
    };
    const [conversations, staff] = await Promise.all([
      pgGet<ConvRow>(env, 'conversation', jwt, { search: convSearch }),
      pgGet<OrgStaff>(env, 'workspace_person', jwt, { search: staffSearch }),
    ]);

    // Quien no lee las funciones del proyecto recibe una lista vacía (la RPC
    // lo decide), así que un bolo nunca hace fallar la ficha.
    const bolos = await Promise.all(
      conversations.data.slice(0, BOLO_READS_MAX).map((c) =>
        pgPostRpc<ConversationBolo>(env, 'conversation_bolos', jwt, { p_conversation_id: c.id })
          .then((r) => r.data)
          .catch(() => [] as ConversationBolo[]),
      ),
    );

    const file: OrganizationFile = {
      organization: o,
      conversations: conversations.data.map((c) => ({
        id: c.id,
        relation: conversationRelation(c),
        next_action_at: c.next_action_at,
        project: c.project,
      })),
      contacts: conversations.data.flatMap((c) => c.contacts ?? []),
      staff: staff.data,
      bolos: bolos.flat(),
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
