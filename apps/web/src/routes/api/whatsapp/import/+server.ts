/**
 * POST /api/whatsapp/import (ADR-189): escribe un chat exportado, ya revisado
 * en el dispositivo. Sólo viajan las tandas que quien importa marcó.
 *
 * Body: `ImportRequestSchema` ({ workspace_id, chat, members, messages }).
 * Trocea en tandas de 500 por `import_whatsapp_chat`: la primera crea el chat
 * (o usa el propio ya importado) y las siguientes van con su id. Idempotente
 * por huella: reimportar sólo escribe lo nuevo. Si una tanda falla, las
 * anteriores se quedan (volver a importar las completa).
 *
 * Auth: Bearer JWT. 404 si el espacio, una conversación o un bolo no son
 * tuyos para colocar; 400 `team_chat` si es un chat 1 a 1 con alguien del
 * equipo.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { chunk, ImportRequestSchema, type ImportResult } from '$lib/wa-import';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
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
  const parsed = v.safeParse(ImportRequestSchema, raw);
  if (!parsed.success) {
    return json(
      { error: 'invalid_body', issues: parsed.issues.slice(0, 5).map((i) => ({ path: i.path?.map((p) => p.key).join('.'), message: i.message })) },
      400,
    );
  }
  const { workspace_id, chat, members, messages } = parsed.output;

  const total: ImportResult = { chat_id: chat.id ?? '', created: 0, skipped: 0, placed: 0 };
  try {
    for (const [i, batch] of chunk(messages).entries()) {
      const { data } = await pgPostRpc<ImportResult>(env, 'import_whatsapp_chat', jwt, {
        p_workspace_id: workspace_id,
        p_chat: { ...chat, id: total.chat_id || null },
        // Quién es quién va con la primera tanda; las demás lo encuentran guardado.
        p_members: i === 0 ? members : [],
        p_messages: batch,
      });
      const r = data[0];
      if (!r) return json({ error: 'not_found' }, 404);
      total.chat_id = r.chat_id;
      total.created += r.created;
      total.skipped += r.skipped;
      total.placed += r.placed;
    }
    return json(total, 201);
  } catch (err) {
    if (err instanceof PostgrestError && err.code === '22023' && /own team/.test(err.body)) {
      return json({ error: 'team_chat' }, 400);
    }
    return pgErrorResponse(
      err,
      { route: 'POST /api/whatsapp/import', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_import' } } },
    );
  }
};
