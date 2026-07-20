/**
 * GET /api/persons/:key?workspace_id=:workspace — one workspace's person
 * dossier plus the relationships that belong to that same workspace.
 *
 * `person.id` remains the portable identity link, but names/contact details
 * come from `workspace_person`. The explicit scope prevents a dossier from
 * one company leaking into another company that happens to know the same
 * human.
 *
 * Auth: Bearer JWT required. RLS (`can_see_person`) decides visibility.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { isUuid } from '$lib/server/performance-bundle';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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
    const person = await pgGet<WorkspacePersonRow>(env, 'workspace_person', jwt, {
      search: personSearch,
    });
    if (person.data.length === 0) return json({ error: 'not_found' }, 404);
    const p = person.data[0];
    const personId = p.person_id;

    const engSearch = new URLSearchParams({
      select:
        'id,slug,status,next_action_at,next_action_note,last_contacted_at,custom_fields,project:project_id(id,slug,name,workspace_id)',
      workspace_id: `eq.${workspaceId}`,
      person_id: `eq.${personId}`,
      deleted_at: 'is.null',
      order: 'updated_at.desc',
    });
    const notesSearch = new URLSearchParams({
      select: 'id,body,visibility,workspace_id,author_id,created_at',
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

    const [conversations, notes, crew, cast] = await Promise.all([
      pgGet(env, 'conversation', jwt, { search: engSearch }),
      pgGet(env, 'person_note', jwt, { search: notesSearch }),
      pgGet(env, 'crew_assignment', jwt, { search: crewSearch }),
      pgGet(env, 'cast_member', jwt, { search: castSearch }),
    ]);

    return json({
      person: {
        ...p,
        id: p.person_id,
        organization_name: p.organization?.name ?? null,
      },
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
