/**
 * PATCH /api/lines/:id — edit a line's module stack (ADR-056).
 *
 * Whitelist is `modules` ONLY: an ordered array of known module keys
 * (validated against the closed vocabulary in $lib/line-templates — no
 * garbage jsonb reaches the DB). Everything else is stripped; `notes` is
 * deliberately NOT here (the collab doc owns it, same rule as
 * performance PATCH), and name/status/dates wait for a line-settings
 * surface.
 *
 * Direct PostgREST PATCH is RLS-viable: line_update gates on
 * has_permission(project_id, 'edit:show' | 'edit:project_meta') and the
 * row stays SELECT-visible after the update (ADR-048 only bites
 * soft-deletes). Zero rows → 404 without confirming existence.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { LineModulesSchema } from '$lib/line-templates';
import { pgPatch, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const IdSchema = v.pipe(v.string(), v.uuid());

const LinePatchSchema = v.object({
  modules: v.optional(LineModulesSchema),
});

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

  const parsed = v.safeParse(LinePatchSchema, raw);
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
  if (patch.modules === undefined) {
    return json({ error: 'empty_patch', hint: 'Send modules.' }, 400);
  }

  const search = new URLSearchParams();
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');
  search.set(
    'select',
    'id,slug,name,kind,status,modules,project_id,workspace_id,updated_at',
  );

  try {
    const { data } = await pgPatch<Record<string, unknown>>(env, 'line', jwt, patch, {
      search,
    });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ line: data[0] });
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
