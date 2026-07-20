/**
 * PATCH /api/conversations/:id
 *
 * Inline write path for the difusión loop (ADR-040): update an
 * conversation's status / next action fields, plus the line relink
 * (ADR-056). The body schema is a whitelist — anything outside status,
 * next_action_at, next_action_note, line_id is stripped, so RLS-sensitive
 * columns (workspace_id, project_id, created_by…) can never ride along.
 *
 * RLS enforces `has_permission(project_id, 'edit:conversation')` on UPDATE.
 * An empty representation (no row matched `id` + `deleted_at IS NULL`, or
 * RLS denied) maps to 404 without confirming whether the row exists.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  CONVERSATION_SELECT,
  ConversationPatchSchema,
  normalizeConversationItem,
  type ConversationDbItem,
} from '$lib/conversation';
import { pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
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

  const parsed = v.safeParse(ConversationPatchSchema, raw);
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
        hint: 'Send at least one of: status, next_action_at, next_action_note, line_id.',
      },
      400,
    );
  }

  try {
    // Relink guard (ADR-056, pattern ADR-043): a patched line_id must
    // belong to the conversation's project — the FK is unscoped and RLS
    // only checks the conversation's project. Needs a pre-lookup for the
    // project; `line_id: null` (detach) skips the check.
    if (patch.line_id) {
      const lookup = new URLSearchParams();
      lookup.set('select', 'id,project_id');
      lookup.set('id', `eq.${idParsed.output}`);
      lookup.set('deleted_at', 'is.null');
      lookup.set('limit', '1');
      const found = await pgGet<{ id: string; project_id: string }>(
        env,
        'conversation',
        jwt,
        { search: lookup },
      );
      if (found.data.length === 0) return json({ error: 'not_found' }, 404);

      const check = new URLSearchParams();
      check.set('select', 'id');
      check.set('id', `eq.${patch.line_id}`);
      check.set('project_id', `eq.${found.data[0].project_id}`);
      check.set('deleted_at', 'is.null');
      check.set('limit', '1');
      const row = await pgGet<{ id: string }>(env, 'line', jwt, { search: check });
      if (row.data.length === 0) {
        return json(
          { error: 'cross_project_link', hint: "line_id must belong to the conversation's project." },
          400,
        );
      }
    }

    const search = new URLSearchParams();
    search.set('id', `eq.${idParsed.output}`);
    search.set('deleted_at', 'is.null');
    search.set('select', CONVERSATION_SELECT);

    const { data } = await pgPatch<ConversationDbItem>(env, 'conversation', jwt, patch, {
      search,
    });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ item: normalizeConversationItem(data[0]) });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/conversations/[id]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

/**
 * DELETE /api/conversations/:id — soft-delete a mistyped contact capture
 * (ADR-051). Goes through the `delete_conversation` RPC (ADR-048 rule:
 * soft-deletes never ride a client PATCH). Gated on
 * has_permission(project, 'edit:conversation').
 *
 * Live performances referencing the conversation block deletion (409).
 * Re-adding the same person to the project later resurrects the row
 * (create_conversation handles the FULL unique constraint).
 */
export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_conversation', jwt, { p_conversation_id: params.id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/conversations/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '23503': {
            status: 409,
            error: 'conversation_has_performances',
            hint: 'Unlink or delete its performances first.',
          },
        },
      },
    );
  }
};
