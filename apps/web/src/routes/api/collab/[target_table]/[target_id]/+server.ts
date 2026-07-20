/**
 * WebSocket entry for collaborative Yjs editing — gates the upgrade with
 * Supabase JWT + workspace membership, then forwards the request to the
 * RoadsheetCollab DO instance for `(target_table, target_id)`.
 *
 * Client URL pattern:
 *   wss://hour.zerosense.studio/api/collab/<performance|project|line>/<uuid>
 *
 * Auth (Phase 0.9): the upgrade is same-origin, so the httpOnly session
 * cookie rides it — browsers attach cookies to WebSocket handshakes. This
 * replaced the old `?token=<jwt>` query param, which leaked the JWT into
 * every edge/request log. The Authorization header still works for
 * non-browser clients (extractAccessToken checks it first).
 *
 * The DO itself lives in the `hour-collab` Worker (apps/collab/). This
 * endpoint is a thin auth + forward layer.
 */

import { authorizeCollab, isAllowedTargetTable } from '$lib/do/auth';
import { extractAccessToken } from '$lib/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  if (!platform?.env) {
    return new Response('Platform unavailable (running outside Workers?)', { status: 503 });
  }

  const targetTable = params.target_table ?? '';
  const targetId = params.target_id ?? '';
  const jwt = extractAccessToken(request) ?? '';

  if (!isAllowedTargetTable(targetTable)) {
    return new Response('Unsupported target_table', { status: 400 });
  }

  const auth = await authorizeCollab(platform.env, jwt, targetTable, targetId);
  if (!auth.ok) {
    // Reason strings can embed upstream fetch errors — log, don't reflect.
    console.error(
      JSON.stringify({
        level: 'warn',
        kind: 'collab_auth_denied',
        request_id: locals.requestId ?? null,
        target: `${targetTable}:${targetId}`,
        reason: auth.reason,
      }),
    );
    return new Response('forbidden', { status: auth.status });
  }

  // DO instance keyed by ${target_table}:${target_id} — same target across
  // tabs/sessions deterministically lands on the same DO. UUIDs are unique
  // across tables but the prefix makes logs greppable and protects future
  // cross-table collisions.
  const id = platform.env.ROADSHEET_COLLAB.idFromName(`${targetTable}:${targetId}`);
  const stub = platform.env.ROADSHEET_COLLAB.get(id);

  // Forward only verified identity metadata. Strip the browser credential
  // before crossing the Worker boundary; the private DO reauthorizes this
  // user against live database state on a short alarm cadence.
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  headers.set('x-hour-collab-user-id', auth.userId);
  headers.set('x-hour-collab-expires-at', String(auth.expiresAt));
  const forwarded = new Request(request, { headers });

  // partyserver's Server.fetch handles the WebSocket
  // pair construction and returns a 101 response with the server-side
  // socket attached; we pass it through unchanged.
  return stub.fetch(forwarded);
};
