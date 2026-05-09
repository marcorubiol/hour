/**
 * WebSocket entry for collaborative Yjs editing — gates the upgrade with
 * Supabase JWT + workspace membership, then forwards the request to the
 * RoadsheetCollab DO instance for `(target_table, target_id)`.
 *
 * Client URL pattern:
 *   wss://hour.zerosense.studio/api/collab/show/<uuid>?token=<jwt>
 *
 * Why query string for the JWT: browser WebSocket clients can't set custom
 * headers on the upgrade request. A per-connection token in the URL is the
 * standard workaround. The token never gets persisted server-side here —
 * we only use it to validate this single upgrade.
 *
 * The DO itself lives in the `hour-collab` Worker (apps/collab/). This
 * endpoint is a thin auth + forward layer.
 */

import { authorizeCollab, isAllowedTargetTable } from '$lib/do/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params, platform, url }) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  if (!platform?.env) {
    return new Response('Platform unavailable (running outside Workers?)', { status: 503 });
  }

  const targetTable = params.target_table ?? '';
  const targetId = params.target_id ?? '';
  const jwt = url.searchParams.get('token') ?? '';

  if (!isAllowedTargetTable(targetTable)) {
    return new Response('Unsupported target_table', { status: 400 });
  }

  const auth = await authorizeCollab(platform.env, jwt, targetTable, targetId);
  if (!auth.ok) {
    return new Response(`auth: ${auth.reason}`, { status: auth.status });
  }

  // DO instance keyed by ${target_table}:${target_id} — same target across
  // tabs/sessions deterministically lands on the same DO. UUIDs are unique
  // across tables but the prefix makes logs greppable and protects future
  // cross-table collisions.
  const id = platform.env.ROADSHEET_COLLAB.idFromName(`${targetTable}:${targetId}`);
  const stub = platform.env.ROADSHEET_COLLAB.get(id);

  // Forward the upgrade. partyserver's Server.fetch handles the WebSocket
  // pair construction and returns a 101 response with the server-side
  // socket attached; we pass it through unchanged.
  return stub.fetch(request);
};
