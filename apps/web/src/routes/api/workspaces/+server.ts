/**
 * GET /api/workspaces
 *
 * Lists workspaces visible to the caller. RLS gates this to workspaces the
 * user has an accepted membership in (workspace_membership.accepted_at).
 * Cross-account memberships supported (ADR-029): one user crosses N
 * workspaces belonging to N accounts.
 *
 * Naming: renamed from `/api/houses` (House was ADR-008 vocab, dropped by
 * ADR-033). Schema entity is `workspace`; the route surfaces match.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import type { Tables } from '$lib/db-types';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const QuerySchema = v.object({
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

type WorkspaceItem = Pick<
  Tables<'workspace'>,
  'id' | 'slug' | 'name' | 'kind' | 'timezone' | 'country' | 'accent' | 'description'
>;

const CreateBodySchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  slug: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(64))),
  // Palette index '1'..'8'. Empty / omitted = let the server fall through
  // to the hash(slug) default. Future free-form colors will widen this
  // schema in parallel with the DB CHECK constraint relaxation.
  accent: v.optional(v.pipe(v.string(), v.regex(/^[1-8]$/))),
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(280))),
});

type WorkspaceRow = Tables<'workspace'>;

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

  const args: Record<string, unknown> = { p_name: parsed.output.name };
  if (parsed.output.slug) args.p_slug = parsed.output.slug;
  if (parsed.output.accent) args.p_accent = parsed.output.accent;
  if (parsed.output.description) args.p_description = parsed.output.description;

  try {
    const { data } = await pgPostRpc<WorkspaceRow>(env, 'create_workspace', jwt, args);
    const workspace = data[0];
    if (!workspace) return json({ error: 'rpc_empty_result' }, 502);
    return json({ workspace }, 201);
  } catch (err) {
    if (err instanceof PostgrestError) {
      // 22023 = invalid name/slug format, 23505 = collision (shouldn't reach
      // here — RPC retries), 42501 = caller has no personal account.
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
  const { limit } = parsed.output;

  const search = new URLSearchParams();
  search.set('select', 'id,slug,name,kind,timezone,country,accent,description');
  search.set('deleted_at', 'is.null');
  search.set('order', 'created_at.asc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<WorkspaceItem>(env, 'workspace', jwt, { search });
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
