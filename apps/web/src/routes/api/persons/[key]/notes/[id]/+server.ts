/**
 * DELETE /api/persons/:key/notes/:id — soft-delete a person note via the
 * `delete_person_note` RPC (author-only, enforced in the RPC). Direct
 * PATCH soft-deletes are impossible by construction: the updated row must
 * stay SELECT-visible to the updater, and `deleted_at IS NOT NULL` fails
 * the SELECT policy (mechanism confirmed 2026-07-02, see _decisions.md).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_person_note', jwt, { p_note_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/persons/[key]/notes/[id]', requestId: locals.requestId },
      {
        // RPC raises 42501 for both "not found" and "not yours" — by design.
        codes: {
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
      },
    );
  }
};
