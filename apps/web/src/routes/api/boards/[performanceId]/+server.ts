/**
 * GET /api/boards/:performanceId: el tablón del bolo de una función
 * (ADR-106, pregunta 1), con los mensajes de sus hilos.
 *
 * `bolo_board` da el bolo SIN dinero (sala y ciudad), sus funciones hermanas y
 * los hilos que el que llama puede leer, existan ya o no, con recuento y no
 * leídos. Una función sin bolo responde `bolo: null`: sin bolo, sin tablón.
 * Una función ajena o inexistente, 404 (la RPC da el mismo 42501 a las dos).
 *
 * Los mensajes se leen en una sola consulta por los hilos que ya existen
 * (`loadThreadMessages`), nunca hilo a hilo.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decodeJwtPayload } from '$lib/server/session';
import { loadThreadMessages } from '$lib/server/threads';
import type { BoardView, BoloBoard } from '$lib/threads';
import { json } from '$lib/server/http';

const IdSchema = v.pipe(v.string(), v.uuid());

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const me = decodeJwtPayload(jwt)?.sub;
  if (typeof me !== 'string') return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.performanceId);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const { data } = await pgPostRpc<BoloBoard>(env, 'bolo_board', jwt, {
      p_performance_id: idParsed.output,
    });
    const board = data[0];
    if (!board) return json({ error: 'not_found' }, 404);

    const threadIds = board.threads.map((th) => th.thread_id).filter((id): id is string => Boolean(id));
    const loaded = await loadThreadMessages(env, jwt, threadIds);
    const view: BoardView = { ...board, me, ...loaded };
    return json(view);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/boards/[performanceId]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
