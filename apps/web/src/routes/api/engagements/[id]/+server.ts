/**
 * PATCH /api/engagements/:id
 *
 * Inline write path for the difusión loop (ADR-040): update an
 * engagement's status / next action fields. The body schema is a
 * whitelist — anything outside status, next_action_at, next_action_note
 * is stripped, so RLS-sensitive columns (workspace_id, project_id,
 * created_by…) can never ride along.
 *
 * RLS enforces `has_permission(project_id, 'edit:engagement')` on UPDATE.
 * An empty representation (no row matched `id` + `deleted_at IS NULL`, or
 * RLS denied) maps to 404 without confirming whether the row exists.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import {
  ENGAGEMENT_SELECT,
  EngagementPatchSchema,
  type EngagementItem,
} from '$lib/engagement';
import { pgPatch, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const PATCH: RequestHandler = async ({ request, params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) {
    return json(
      { error: 'missing_authorization', hint: 'Send Authorization: Bearer <supabase_jwt>.' },
      401,
    );
  }

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const parsed = v.safeParse(EngagementPatchSchema, raw);
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
  const patch = parsed.output;
  if (Object.keys(patch).length === 0) {
    return json(
      {
        error: 'empty_patch',
        hint: 'Send at least one of: status, next_action_at, next_action_note.',
      },
      400,
    );
  }

  const search = new URLSearchParams();
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');
  search.set('select', ENGAGEMENT_SELECT);

  try {
    const { data } = await pgPatch<EngagementItem>(env, 'engagement', jwt, patch, {
      search,
    });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ item: data[0] });
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
