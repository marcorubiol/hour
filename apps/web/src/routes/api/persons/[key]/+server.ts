/**
 * GET /api/persons/:key — the person file (ADR-045): contact data plus
 * everything the caller's RLS lets them see about the relationship —
 * conversations across projects, workspace-scoped notes (visibility rules
 * in RLS), and cast/crew appearances.
 *
 * `:key` is a uuid or the person's slug (persons are GLOBAL — no
 * workspace scoping on the row itself, ADR vocab "person (global,
 * shared)"; slug is globally unique).
 *
 * Auth: Bearer JWT required. RLS (`can_see_person`) decides visibility.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { isUuid } from '$lib/server/performance-bundle';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import type { Tables } from '$lib/db-types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type PersonRow = Tables<'person'>;

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const key = params.key;

  try {
    const personSearch = new URLSearchParams();
    personSearch.set('select', '*');
    personSearch.set(isUuid(key) ? 'id' : 'slug', `eq.${key}`);
    personSearch.set('deleted_at', 'is.null');
    personSearch.set('limit', '1');
    const person = await pgGet<PersonRow>(env, 'person', jwt, { search: personSearch });
    if (person.data.length === 0) return json({ error: 'not_found' }, 404);
    const p = person.data[0];

    const engSearch = new URLSearchParams({
      select:
        'id,slug,status,next_action_at,next_action_note,last_contacted_at,custom_fields,project:project_id(id,slug,name,workspace_id)',
      person_id: `eq.${p.id}`,
      deleted_at: 'is.null',
      order: 'updated_at.desc',
    });
    const notesSearch = new URLSearchParams({
      select: 'id,body,visibility,workspace_id,author_id,created_at',
      person_id: `eq.${p.id}`,
      deleted_at: 'is.null',
      order: 'created_at.desc',
      limit: '50',
    });
    const crewSearch = new URLSearchParams({
      select:
        'id,role,performance:performance_id(id,slug,performed_at,venue_name,city,workspace_id)',
      person_id: `eq.${p.id}`,
      deleted_at: 'is.null',
    });
    const castSearch = new URLSearchParams({
      select: 'id,role,project:project_id(id,slug,name,workspace_id)',
      person_id: `eq.${p.id}`,
      deleted_at: 'is.null',
    });

    const [conversations, notes, crew, cast] = await Promise.all([
      pgGet(env, 'conversation', jwt, { search: engSearch }),
      pgGet(env, 'person_note', jwt, { search: notesSearch }),
      pgGet(env, 'crew_assignment', jwt, { search: crewSearch }),
      pgGet(env, 'cast_member', jwt, { search: castSearch }),
    ]);

    return json({
      person: p,
      conversations: conversations.data,
      notes: notes.data,
      crew: crew.data,
      cast: cast.data,
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/persons/[key]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
