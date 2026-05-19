/**
 * GET /api/sections
 *
 * Lists sections of a project (e.g. tour, season, residency block). Scope is
 * driven by `?project_id=<uuid>`; the caller (RoomStructure) already has the
 * project_id from the rooms cache, so we ask for it directly instead of
 * resolving slug → project → workspace.
 *
 * RLS scopes by workspace membership (ADR-029): user sees sections of any
 * project in any workspace they belong to. No `current_workspace_id` claim
 * needed.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const ALLOWED_STATUSES = ['any', 'open', 'closed', 'archived'] as const;

const ALLOWED_KINDS = [
  'any',
  'tour',
  'season',
  'phase',
  'circuit',
  'residency',
  'other',
  'creation',
  'campaign',
  'comms',
  'misc',
] as const;

const QuerySchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  status: v.optional(v.picklist(ALLOWED_STATUSES), 'any'),
  kind: v.optional(v.picklist(ALLOWED_KINDS), 'any'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(100),
    ),
    '50',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type SectionItem = {
  id: string;
  slug: string | null;
  name: string;
  kind: string;
  status: string;
  territory: string | null;
  start_date: string | null;
  end_date: string | null;
  project_id: string;
  workspace_id: string;
  updated_at: string;
};

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) {
    return json({ error: 'platform_unavailable' }, 500);
  }
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) {
    return json(
      {
        error: 'missing_authorization',
        hint: 'Send Authorization: Bearer <supabase_jwt>.',
      },
      401,
    );
  }

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_query',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const { project_id, status, kind, limit } = parsed.output;

  const search = new URLSearchParams();
  search.set(
    'select',
    'id,slug,name,kind,status,territory,start_date,end_date,project_id,workspace_id,updated_at',
  );
  search.set('project_id', `eq.${project_id}`);
  search.set('deleted_at', 'is.null');
  if (status !== 'any') search.set('status', `eq.${status}`);
  if (kind !== 'any') search.set('kind', `eq.${kind}`);
  search.set('order', 'start_date.asc.nullslast,name.asc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<SectionItem>(env, 'section', jwt, { search });
    return json({ items: data });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
