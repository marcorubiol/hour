/**
 * GET /api/conversations/overview: el dashboard de «con quién hablas»
 * (ADR-117, propuesta A). Los bloques ya calculados en una sola petición: te
 * toca, la temporada, caliente, se enfría, el último envío y los hilos del
 * equipo con nuevos.
 *
 * Query: `project_ids`, `workspace_ids` (el alcance de la lista, unión; sin
 * ninguno, todo) y `line_ids` (las líneas fijadas en la barra: acotan la
 * temporada, ADR-117 § 3).
 *
 * Auth: Bearer JWT (o la cookie de sesión). Todo con la RLS de quien llama.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decodeJwtPayload } from '$lib/server/session';
import { loadThreadFeed } from '$lib/server/threads';
import { loadLastMailout, loadOverviewRows } from '$lib/server/conversation-overview';
import { buildOverview, type OverviewResponse } from '$lib/conversation-overview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cuántos hilos con nuevos enseña «Del equipo»; el resto, en «De qué se habla». */
const TEAM_ROWS = 2;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseIds(raw: string | null): string[] {
  return raw ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))] : [];
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const me = decodeJwtPayload(jwt)?.sub;
  if (typeof me !== 'string') return json({ error: 'missing_authorization' }, 401);

  const scope = {
    projectIds: parseIds(url.searchParams.get('project_ids')),
    workspaceIds: parseIds(url.searchParams.get('workspace_ids')),
  };
  const lineIds = parseIds(url.searchParams.get('line_ids'));

  try {
    const [rows, feed] = await Promise.all([loadOverviewRows(env, jwt, scope), loadThreadFeed(env, jwt, me, scope)]);
    const unread = feed.threads.filter((th) => th.unread_count > 0);
    const shown = unread.slice(0, TEAM_ROWS);
    const authorIds = new Set(shown.map((th) => th.last_message.author_id));
    const body: OverviewResponse = {
      ...buildOverview(rows, new Date(), { lineIds }),
      last_mailout: await loadLastMailout(env, jwt, scope, rows),
      team: {
        count: unread.length,
        me,
        threads: shown,
        authors: Object.fromEntries(Object.entries(feed.authors).filter(([id]) => authorIds.has(id))),
      },
    };
    return json(body);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/overview', requestId: locals.requestId });
  }
};
