/**
 * The history of a conversation (ADR-098, contract:
 * build/conversation-event-contract.md).
 *
 * GET  /api/conversations/:id/events — the events, most recent first. RLS on
 *      `conversation_event` inherits the conversation's own frontier, so a
 *      conversation the caller cannot read answers an empty list: never a 404
 *      that would confirm it exists.
 * POST /api/conversations/:id/events — { kind, direction?, body?,
 *      occurred_at? } through `record_conversation_event`, gated on
 *      edit:conversation. Without `occurred_at` the server stamps now. A
 *      contact kind moves last_contacted_at in the same transaction.
 *
 * Append-only: there is no PATCH or DELETE. A correction is another event.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  CONVERSATION_EVENT_SELECT,
  ConversationEventCreateSchema,
  type ConversationEventItem,
} from '$lib/conversation';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

/** A timeline, not an archive: the screen reads the latest. */
const LIMIT = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const search = new URLSearchParams({
      select: CONVERSATION_EVENT_SELECT,
      conversation_id: `eq.${idParsed.output}`,
      order: 'occurred_at.desc,recorded_at.desc',
      limit: String(LIMIT),
    });
    const { data } = await pgGet<ConversationEventItem>(env, 'conversation_event', jwt, {
      search,
    });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/conversations/[id]/events', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
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
  const parsed = v.safeParse(ConversationEventCreateSchema, raw);
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
  const event = parsed.output;

  try {
    const { data } = await pgPostRpc<ConversationEventItem>(
      env,
      'record_conversation_event',
      jwt,
      {
        p_conversation_id: idParsed.output,
        p_kind: event.kind,
        p_direction: event.direction ?? null,
        p_body: event.body || null,
        // Absent → the RPC stamps statement_timestamp(): the server owns now.
        ...(event.occurred_at ? { p_occurred_at: event.occurred_at } : {}),
      },
    );
    const row = data[0];
    if (!row) return json({ error: 'not_found' }, 404);
    const item: ConversationEventItem = {
      id: row.id,
      conversation_id: row.conversation_id,
      occurred_at: row.occurred_at,
      recorded_at: row.recorded_at,
      kind: row.kind,
      source: row.source,
      direction: row.direction,
      body: row.body,
    };
    return json({ item }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/conversations/[id]/events', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '22023': {
            status: 400,
            error: 'invalid_event',
            hint: 'An event cannot happen in the future.',
          },
        },
      },
    );
  }
};
