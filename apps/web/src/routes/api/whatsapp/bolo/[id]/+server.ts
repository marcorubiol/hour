/**
 * GET /api/whatsapp/bolo/:id (ADR-189): los mensajes de un grupo de WhatsApp
 * colocados en el tablón de un bolo (ADR-188 § 2), de lo antiguo a lo nuevo.
 * Los lee quien lee el tablón (la RLS de `message_placement` y de
 * `channel_message`); a quien no, una lista vacía.
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import type { BoloChatMessage } from '$lib/wa-import';

const IdSchema = v.pipe(v.string(), v.uuid());
/** Un tablón, no un archivo: lo último. */
const LIMIT = 300;

interface Row {
  m: {
    id: string;
    occurred_at: string;
    direction: 'inbound' | 'outbound';
    sender_name: string;
    body: string | null;
    metadata: { attachments?: BoloChatMessage['attachments'] } | null;
  } | null;
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const id = v.safeParse(IdSchema, params.id);
  if (!id.success) return json({ error: 'invalid_id' }, 400);

  try {
    const { data } = await pgGet<Row>(env, 'message_placement', jwt, {
      search: new URLSearchParams({
        select: 'm:channel_message!inner(id,occurred_at,direction,sender_name,body,metadata)',
        bolo_id: `eq.${id.output}`,
        surface: 'eq.bolo_team',
        removed_at: 'is.null',
        order: 'placed_at.desc',
        limit: String(LIMIT),
      }),
    });
    const items: BoloChatMessage[] = data
      .flatMap((r) => (r.m ? [r.m] : []))
      .map((m) => ({
        id: m.id,
        occurred_at: m.occurred_at,
        direction: m.direction,
        sender_name: m.sender_name,
        body: m.body,
        attachments: m.metadata?.attachments ?? [],
      }))
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    return json({ items });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/whatsapp/bolo/[id]', requestId: locals.requestId }, { passUpstream: [401, 403] });
  }
};
