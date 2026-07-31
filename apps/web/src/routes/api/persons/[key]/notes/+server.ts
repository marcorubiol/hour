/**
 * POST /api/persons/:key/notes — add a note about a person (ADR-045, rebuilt
 * on ADR-093). Goes through the `create_note` RPC (the direct INSERT policy
 * is claim-bound).
 *
 * There is no visibility any more: a note is ALWAYS private, and what the team
 * sees is comms (ADR-093 §2). `on_day` is the day the note lives on — the
 * client sends its own local day, since the server's is UTC and a note written
 * at 00:30 in Barcelona belongs to the day the writer thinks it does.
 *
 * Body: { workspace_id, body, on_day? }.
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
  on_day: v.optional(v.pipe(v.string(), v.isoDate())),
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
        select: 'person_id',
        workspace_id: `eq.${input.workspace_id}`,
        slug: `eq.${personId}`,
        deleted_at: 'is.null',
        limit: '1',
      });
      const found = await pgGet<{ person_id: string }>(env, 'workspace_person', jwt, {
        search: lookup,
      });
      if (found.data.length === 0) return json({ error: 'not_found' }, 404);
      personId = found.data[0].person_id;
    } else {
      const lookup = new URLSearchParams({
        select: 'person_id',
        workspace_id: `eq.${input.workspace_id}`,
        person_id: `eq.${personId}`,
        deleted_at: 'is.null',
        limit: '1',
      });
      const found = await pgGet<{ person_id: string }>(env, 'workspace_person', jwt, {
        search: lookup,
      });
      if (found.data.length === 0) return json({ error: 'not_found' }, 404);
    }

    const { data } = await pgPostRpc(env, 'create_note', jwt, {
      p_person_id: personId,
      p_workspace_id: input.workspace_id,
      p_body: input.body,
      p_on_day: input.on_day ?? new Date().toISOString().slice(0, 10),
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
