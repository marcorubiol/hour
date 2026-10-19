/**
 * PATCH /api/conversations/:id
 *
 * Inline write path for the difusión loop (ADR-040): update a
 * conversation's «not this time» (ADR-138) / next action fields, plus the line relink
 * (ADR-056). The body schema is a whitelist — anything outside status,
 * not_now, next_action_at, next_action_note, line_id, reply_settled_at is stripped, so RLS-sensitive
 * columns (workspace_id, project_id, created_by…) can never ride along.
 *
 * Contact is not written here. Since ADR-098 a contact is an event
 * (`POST /api/conversations/:id/events`), which moves last_contacted_at in
 * the same transaction; the old `contacted_today` action overwrote the
 * previous date and is gone.
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
  conversationPatchColumns,
  normalizeConversationItem,
  type ConversationDbItem,
} from '$lib/conversation';
import { pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jwtSubject } from '$lib/server/http';
import { TURN_EMBEDS, setLastTurnEmbed } from '$lib/server/conversation-overview';
import { json } from '$lib/server/http';

const IdSchema = v.pipe(v.string(), v.uuid());

/**
 * GET /api/conversations/:id — una conversación, por id o por slug (la ficha
 * llega por `/h/[workspace]/conversation/[slug]`; con slug, `?workspace=` es el
 * slug del espacio). RLS decide: privada de otro o sin permiso = 404.
 *
 * Lleva lo que la ficha puede ofrecer (ADR-124, `permisos.md` § 2 y § 8):
 * `can_edit` (`edit:conversation` en su proyecto) y `can_set_private` (quien
 * edita y, si es compartida, la creó o es admin; si es privada, es suya). Las
 * mismas reglas que la base; la pantalla solo deja de ofrecer lo que la base
 * negaría.
 */
export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const byId = v.safeParse(IdSchema, params.id).success;
  const workspace = url.searchParams.get('workspace');
  if (!byId && (!/^[a-z0-9-]{1,64}$/.test(params.id) || !workspace)) {
    return json({ error: 'invalid_id' }, 400);
  }
  const search = new URLSearchParams({
    // The turn (ADR-126 § 5): the file shows it beside the last contact.
    select: `${CONVERSATION_SELECT},private_to,workspace:workspace_id!inner(slug),${TURN_EMBEDS}`,
    deleted_at: 'is.null',
    limit: '1',
  });
  setLastTurnEmbed(search);
  if (byId) search.set('id', `eq.${params.id}`);
  else {
    search.set('slug', `eq.${params.id}`);
    search.set('workspace.slug', `eq.${workspace}`);
  }
  try {
    type Row = ConversationDbItem & { private_to: string | null };
    let { data } = await pgGet<Row>(env, 'conversation', jwt, { search });
    // ADR-102, añadido, punto 7: un slug anterior (el de la persona, antes de
    // pasar al de la organización) sigue llevando a la conversación.
    if (!data[0] && !byId) {
      const previous = new URLSearchParams(search);
      previous.delete('slug');
      previous.set('previous_slugs', `cs.{${params.id}}`);
      previous.set('order', 'updated_at.desc');
      ({ data } = await pgGet<Row>(env, 'conversation', jwt, { search: previous }));
    }
    const row = data[0];
    if (!row) return json({ error: 'not_found' }, 404);
    const sub = jwtSubject(jwt);
    const [edit, admin] = await Promise.all([
      pgPostRpc<boolean>(env, 'has_permission', jwt, { p_project_id: row.project_id, p_perm: 'edit:conversation' }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: row.workspace_id }),
    ]);
    const canEdit = edit.data[0] === true;
    const canSetPrivate =
      canEdit &&
      (row.private_to !== null
        ? row.private_to === sub
        : row.created_by === sub || admin.data[0] === true);
    return json({
      item: {
        ...normalizeConversationItem(row),
        private: row.private_to !== null,
        can_edit: canEdit,
        can_set_private: canSetPrivate,
      },
    });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/[id]', requestId: locals.requestId });
  }
};

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
        hint: 'Send at least one of: not_now, next_action_at, next_action_note, line_id, reply_settled_at.',
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

    // A genuine status transition stamps last contact in the BEFORE trigger
    // (conversation_contact_timestamps), atomically.
    const search = new URLSearchParams();
    search.set('id', `eq.${idParsed.output}`);
    search.set('deleted_at', 'is.null');
    search.set('select', `${CONVERSATION_SELECT},${TURN_EMBEDS}`);
    setLastTurnEmbed(search);

    const { data } = await pgPatch<ConversationDbItem>(env, 'conversation', jwt, conversationPatchColumns(patch), {
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
