/**
 * GET /api/persons/:key?workspace_id=:workspace — one workspace's person
 * dossier plus the relationships that belong to that same workspace.
 *
 * `person.id` remains the portable identity link, but names/contact details
 * come from `workspace_person`. The explicit scope prevents a dossier from
 * one company leaking into another company that happens to know the same
 * human.
 *
 * PATCH /api/persons/:person_id — { workspace_id, full_name, email, phone,
 * title } via `update_workspace_person` (ADR-107): what the quick add left
 * for later. Every field travels; an empty one clears it (not the name).
 *
 * DELETE /api/persons/:person_id?workspace_id=:workspace — soft-delete the
 * dossier via `delete_workspace_person` (ADR-048: never by a client PATCH).
 * The global `person` stays. Refused (409) while something live uses it: a
 * conversation, cast, crew, an override, an availability, or a login.
 *
 * Auth: Bearer JWT required. RLS (`can_see_person`) decides visibility; the
 * RPC gates the write.
 */

import { conversationRelation, type ConversationDbItem } from '$lib/conversation';
import { TURN_EMBEDS, setLastTurnEmbed } from '$lib/server/conversation-overview';
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { isUuid } from '$lib/server/performance-bundle';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { unmergedFor, type PersonMergeLine, type UnmergedInvitation } from '$lib/person-merge';

const QuerySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
});

type WorkspacePersonRow = {
  workspace_id: string;
  person_id: string;
  slug: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  languages: string[];
  title: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  organization: { id: string; slug: string; name: string; kind: string } | null;
};

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const query = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!query.success) return json({ error: 'invalid_query', hint: 'workspace_id is required.' }, 400);

  const key = params.key;
  const workspaceId = query.output.workspace_id;

  try {
    const personSearch = new URLSearchParams();
    personSearch.set(
      'select',
      'workspace_id,person_id,slug,full_name,first_name,last_name,email,phone,website,city,country,languages,title,notes,custom_fields,organization:workspace_organization!workspace_person_organization_fkey(id,slug,name,kind)',
    );
    personSearch.set('workspace_id', `eq.${workspaceId}`);
    personSearch.set(isUuid(key) ? 'person_id' : 'slug', `eq.${key}`);
    personSearch.set('deleted_at', 'is.null');
    personSearch.set('limit', '1');
    let person = await pgGet<WorkspacePersonRow>(env, 'workspace_person', jwt, {
      search: personSearch,
    });
    // The slug of a dossier merged into this one still opens it
    // (`previous_slugs`, person merge phase 2); a live slug always wins.
    if (person.data.length === 0 && !isUuid(key) && /^[a-z0-9-]+$/.test(key)) {
      const previous = new URLSearchParams(personSearch);
      previous.delete('slug');
      previous.set('previous_slugs', `cs.{${key}}`);
      person = await pgGet<WorkspacePersonRow>(env, 'workspace_person', jwt, { search: previous });
    }
    if (person.data.length === 0) return json({ error: 'not_found' }, 404);
    const p = person.data[0];
    const personId = p.person_id;

    // ADR-102: the person's conversations are those where they are a contact
    // (current or past), not only the primary. The `!inner` contact embed
    // filters; the conversation's own RLS hides someone else's private one.
    const engSearch = new URLSearchParams({
      select:
        `id,slug,next_action_at,next_action_note,last_contacted_at,custom_fields,not_now_at,not_now_until,first_contacted_at,contacted_undated,regular:conversation_regular,project:project_id(id,slug,name,workspace_id),organization:workspace_organization!conversation_workspace_organization_fkey(id,slug,name),contact:conversation_contact!inner(role,since,until,is_primary),${TURN_EMBEDS}`,
      workspace_id: `eq.${workspaceId}`,
      'contact.person_id': `eq.${personId}`,
      deleted_at: 'is.null',
      order: 'updated_at.desc',
    });
    setLastTurnEmbed(engSearch);
    // ADR-093 — `note` absorbed `person_note`. No visibility filter and no
    // permission gate: RLS already narrows this to the caller's own notes,
    // because a note is always private. The old policy demanded
    // `read:person_note_private` over some project to read your own.
    const notesSearch = new URLSearchParams({
      select: 'id,body,on_day,workspace_id,author_id,created_at',
      workspace_id: `eq.${workspaceId}`,
      person_id: `eq.${personId}`,
      deleted_at: 'is.null',
      order: 'created_at.desc',
      limit: '50',
    });
    const crewSearch = new URLSearchParams({
      select:
        'id,role,performance:performance_id(id,slug,performed_at,venue_name,city,workspace_id)',
      workspace_id: `eq.${workspaceId}`,
      person_id: `eq.${personId}`,
      deleted_at: 'is.null',
    });
    const castSearch = new URLSearchParams({
      select: 'id,role,project:project_id(id,slug,name,workspace_id)',
      workspace_id: `eq.${workspaceId}`,
      person_id: `eq.${personId}`,
      deleted_at: 'is.null',
    });

    // The merges this file absorbed and can still undo (`person_merge`:
    // RLS shows it to the space's admin only; anyone else reads none).
    const mergesSearch = new URLSearchParams({
      select: 'id,merged_at,drop_name:drop_dossier_before->>full_name',
      workspace_id: `eq.${workspaceId}`,
      keep_person_id: `eq.${personId}`,
      undone_at: 'is.null',
      order: 'merged_at.desc',
      limit: '5',
    });

    const [conversations, notes, crew, cast, admin, merges, unmerged] = await Promise.all([
      pgGet<ConversationDbItem>(env, 'conversation', jwt, { search: engSearch }),
      pgGet(env, 'note', jwt, { search: notesSearch }),
      pgGet(env, 'crew_assignment', jwt, { search: crewSearch }),
      pgGet(env, 'cast_member', jwt, { search: castSearch }),
      // «Invitar a X» (ADR-107) is an admin's verb: the file only offers it
      // to whoever `invite_workspace_person` would let through.
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId }),
      pgGet<PersonMergeLine>(env, 'person_merge', jwt, { search: mergesSearch }),
      // An invitation accepted by an account that was already someone else
      // (plan 2026-10-22 § 6.1): the admin's «Falta». A notice, never a
      // reason for the file to fail: anyone else (42501) or a base without
      // the phase 3 migration reads none.
      pgPostRpc<UnmergedInvitation>(env, 'list_unmerged_invitations', jwt, { p_workspace_id: workspaceId }).catch(
        () => ({ data: [] as UnmergedInvitation[] }),
      ),
    ]);

    return json({
      person: {
        ...p,
        id: p.person_id,
        organization_name: p.organization?.name ?? null,
      },
      // The relation is derived here, as in every conversation endpoint (ADR-138).
      conversations: conversations.data.map((c) => ({ ...c, relation: conversationRelation(c) })),
      notes: notes.data,
      crew: crew.data,
      cast: cast.data,
      can_invite: admin.data[0] === true,
      // «Fusionar con…» is the same admin's verb (plan 2026-10-22 § 5).
      can_merge: admin.data[0] === true,
      merges: merges.data,
      unmerged: admin.data[0] === true ? unmergedFor(personId, unmerged.data) : null,
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/persons/[key]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

const PatchSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  full_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  email: v.nullish(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320))])),
  phone: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(60))),
  title: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(200))),
});

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!isUuid(params.key)) return json({ error: 'invalid_id' }, 400);

  const parsed = v.safeParse(PatchSchema, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const b = parsed.output;

  try {
    const { data } = await pgPostRpc<WorkspacePersonRow>(env, 'update_workspace_person', jwt, {
      p_workspace_id: b.workspace_id,
      p_person_id: params.key,
      p_full_name: b.full_name,
      p_email: b.email || null,
      p_phone: b.phone || null,
      p_title: b.title || null,
    });
    if (data.length === 0) return json({ error: 'update_failed' }, 502);
    return json({ person: data[0] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/persons/[key]', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '23505': { status: 409, error: 'email_taken' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!isUuid(params.key)) return json({ error: 'invalid_id' }, 400);

  const query = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!query.success) return json({ error: 'invalid_query', hint: 'workspace_id is required.' }, 400);

  try {
    await pgPostRpc(env, 'delete_workspace_person', jwt, {
      p_workspace_id: query.output.workspace_id,
      p_person_id: params.key,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/persons/[key]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '23503': { status: 409, error: 'person_in_use', hint: 'Delete what uses this person first.' },
        },
      },
    );
  }
};
