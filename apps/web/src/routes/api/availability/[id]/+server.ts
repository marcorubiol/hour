/**
 * PATCH /api/availability/:id — edit a blackout's fields (range, certainty,
 * note). Direct PostgREST PATCH: availability_block_update RLS is
 * workspace-member gated, NOT claim-bound, and the row stays SELECT-visible
 * after a field edit (ADR-048 only bites soft-deletes). Whitelisted by
 * AvailabilityPatchSchema — scope FKs (workspace_id, person_id) stay out:
 * rescoping a blackout is delete + recreate.
 *
 * DELETE /api/availability/:id — soft-delete via the
 * `delete_availability_block` RPC (ADR-048 rule: no DELETE policy and a
 * deleted_at PATCH would be invisible-by-construction).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  AVAILABILITY_SELECT,
  AvailabilityPatchSchema,
  type AvailabilityItem,
} from '$lib/availability';
import { pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const parsed = v.safeParse(AvailabilityPatchSchema, raw);
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
    return json({ error: 'empty_patch' }, 400);
  }

  const search = new URLSearchParams();
  search.set('select', AVAILABILITY_SELECT);
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');

  try {
    const { data } = await pgPatch<AvailabilityItem>(env, 'availability_block', jwt, patch, {
      search,
    });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ block: data[0] });
  } catch (err) {
    // 23514 = the range CHECK (ends_on >= starts_on) on the final row.
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/availability/[id]', requestId: locals.requestId },
      {
        codes: {
          '23514': {
            status: 400,
            error: 'constraint_violation',
            hint: 'ends_on must be on or after starts_on.',
          },
        },
        passUpstream: [401, 403],
      },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_availability_block', jwt, {
      p_availability_block_id: idParsed.output,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    // 42501 collapses not-found and no-membership → 404 (no existence oracle).
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/availability/[id]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
