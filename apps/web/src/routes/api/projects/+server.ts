/**
 * GET /api/projects
 *
 * Lists projects (productions) the caller has membership-based access to.
 * RLS scopes by workspace_membership (ADR-029) — user sees projects of any
 * workspace they belong to, not just `current_workspace_id`. The same
 * cache (`['projects', { status: 'active' }]`) is consumed by Plaza,
 * LineList, the project detail page, and Today widgets.
 *
 * Naming: renamed from `/api/rooms` (Room was ADR-008 vocab, dropped by
 * ADR-033). Schema entity is `project`; the route surfaces match.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import type { Enums, Tables } from '$lib/db-types';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const ALLOWED_STATUSES: ReadonlyArray<Enums<'project_status'> | 'any'> = [
  'any',
  'draft',
  'active',
  'archived',
];

const QuerySchema = v.object({
  status: v.optional(v.picklist(ALLOWED_STATUSES), 'active'),
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

type ProjectItem = Pick<
  Tables<'project'>,
  | 'id'
  | 'slug'
  | 'name'
  | 'status'
  | 'workspace_id'
  | 'starts_on'
  | 'ends_on'
  | 'updated_at'
  | 'accent'
  | 'description'
>;

type ProjectRow = Tables<'project'>;

const CreateBodySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  slug: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(64))),
  accent: v.optional(v.pipe(v.string(), v.regex(/^[1-8]$/))),
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(280))),
});

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(CreateBodySchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }

  const args: Record<string, unknown> = {
    p_workspace_id: parsed.output.workspace_id,
    p_name: parsed.output.name,
  };
  if (parsed.output.slug) args.p_slug = parsed.output.slug;
  if (parsed.output.accent) args.p_accent = parsed.output.accent;
  if (parsed.output.description) args.p_description = parsed.output.description;

  try {
    const { data } = await pgPostRpc<ProjectRow>(env, 'create_project', jwt, args);
    const project = data[0];
    if (!project) return json({ error: 'rpc_empty_result' }, 502);
    return json({ project }, 201);
  } catch (err) {
    if (err instanceof PostgrestError) {
      const body = err.body;
      let status = 502;
      if (body.includes('22023')) status = 400;
      else if (body.includes('23505')) status = 409;
      else if (body.includes('42501')) status = 403;
      return json({ error: 'rpc_error', status: err.status, detail: body }, status);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
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
  const { status, limit } = parsed.output;

  const search = new URLSearchParams();
  search.set(
    'select',
    'id,slug,name,status,workspace_id,starts_on,ends_on,updated_at,accent,description',
  );
  search.set('deleted_at', 'is.null');
  if (status !== 'any') search.set('status', `eq.${status}`);
  search.set('order', 'updated_at.desc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<ProjectItem>(env, 'project', jwt, { search });
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
