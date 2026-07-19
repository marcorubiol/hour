/**
 * PATCH /api/projects/[id]
 *
 * Edit a project's identity/content (name, description, accent, initials) via
 * the `update_project` SECURITY DEFINER RPC — owner/admin/member of the
 * project's workspace (ADR-081). Only fields present in the body are patched;
 * a present field with '' / null clears it (nullable columns). slug/status are
 * not editable here.
 *
 * Auth: Bearer JWT / httpOnly cookie. RLS + the RPC's membership check gate it.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import type { Tables } from '$lib/db-types';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const PatchBodySchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))),
  // '' clears (RPC NULLIFs). accent/initials accept null to clear.
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(280))),
  accent: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^([1-9]|1[0-2])$/)))),
  // Monogram: 0..3 non-space chars, mixed case kept. '' / null clears.
  initials: v.optional(
    v.nullable(v.pipe(v.string(), v.trim(), v.regex(/^\S{0,3}$/, 'monogram: up to 3 non-space chars'))),
  ),
});

type ProjectRow = Tables<'project'>;

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PatchBodySchema, raw);
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

  // Forward only the keys the client actually sent (undefined = "leave as-is";
  // null / '' = "clear"). update_project applies present keys only.
  const patch = Object.fromEntries(
    Object.entries(parsed.output).filter(([, val]) => val !== undefined),
  );
  if (Object.keys(patch).length === 0) return json({ error: 'empty_patch' }, 400);

  try {
    const { data } = await pgPostRpc<ProjectRow>(env, 'update_project', jwt, {
      p_project_id: id,
      p_patch: patch,
    });
    const project = data[0];
    if (!project) return json({ error: 'rpc_empty_result' }, 502);
    return json({ project });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/projects/[id]', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'rpc_error' },
          '22P02': { status: 400, error: 'rpc_error' },
          '23514': { status: 400, error: 'rpc_error' },
          '42501': { status: 403, error: 'forbidden' },
          P0002: { status: 404, error: 'not_found' },
        },
        passUpstream: [],
      },
    );
  }
};
