/**
 * POST /api/conversations/bulk: { action, ids, …args } o { action: 'restore', items }.
 *
 * Una acción de la barra de selección (plan de la lista § 6.2) sobre hasta
 * `BULK_MAX` conversaciones: «no esta vez», siguiente paso, «no pide
 * respuesta», poner o quitar una etiqueta, y el deshacer de cualquiera de
 * ellas. Cada una con el JWT de quien llama: la RLS decide fila a fila y el
 * lote no se aborta por una. Responde 200 con `{ done, failed, undo }`
 * (`$lib/conversation-bulk`); la pantalla parte selecciones más largas.
 *
 * Auth: Bearer JWT. Sin migración ni `service_role` (`$lib/server/conversation-bulk`).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { BulkSchema } from '$lib/conversation-bulk';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { bulkPg, runConversationBulk } from '$lib/server/conversation-bulk';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BulkSchema, raw);
  if (!parsed.success) {
    return jsonNoStore(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({ path: i.path?.map((p) => p.key).join('.'), message: i.message })),
      },
      400,
    );
  }

  try {
    return jsonNoStore(await runConversationBulk(bulkPg(env, jwt), parsed.output));
  } catch (err) {
    // Solo las lecturas del principio llegan aquí: las escrituras fallan por fila.
    return pgErrorResponse(err, { route: 'POST /api/conversations/bulk', requestId: locals.requestId }, { passUpstream: [401, 403] });
  }
};
