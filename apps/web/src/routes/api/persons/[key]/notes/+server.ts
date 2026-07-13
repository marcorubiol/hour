/**
 * POST /api/persons/:key/notes — add a workspace-scoped note to a person
 * (ADR-045). Goes through the `create_person_note` RPC (the direct
 * INSERT policy is claim-bound). Visibility: `workspace` (any member of
 * that workspace reads it) or `private` (author only, gated further by
 * read:person_note_private on the read path).
 *
 * Body: { workspace_id, body, visibility? }.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { isUuid } from '$lib/server/performance-bundle';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const BodySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
  visibility: v.optional(v.picklist(['workspace', 'private'])),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((pp) => pp.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  try {
    let personId = params.key;
    if (!isUuid(personId)) {
      const lookup = new URLSearchParams({
        select: 'id',
        slug: `eq.${personId}`,
        deleted_at: 'is.null',
        limit: '1',
      });
      const found = await pgGet<{ id: string }>(env, 'person', jwt, { search: lookup });
      if (found.data.length === 0) return json({ error: 'not_found' }, 404);
      personId = found.data[0].id;
    }

    const { data } = await pgPostRpc(env, 'create_person_note', jwt, {
      p_person_id: personId,
      p_workspace_id: input.workspace_id,
      p_body: input.body,
      p_visibility: input.visibility ?? 'workspace',
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ note: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/persons/[key]/notes', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
