import type { RequestHandler } from './$types';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import { allowRequest, clientIp } from '$lib/server/rate-limit';

/**
 * Sentry tunnel — proxies envelopes from the browser SDK to the configured
 * Sentry ingest host so adblockers / browser tracking-protection (Firefox
 * ETP, Brave Shields, uBlock Origin) don't drop them. The browser POSTs
 * to `/api/sentry-tunnel` (same-origin, never blocked); we forward to the
 * upstream ingest URL embedded in the DSN.
 *
 * Auth is passed as query params (`sentry_version`, `sentry_key`,
 * `sentry_client`) so envelope kinds that don't include `dsn` in their
 * leading header (replays, sessions) still authenticate correctly.
 *
 * Abuse posture (Phase 0.9): the endpoint is necessarily unauthenticated
 * (errors on the login page must report too), so it's bounded instead —
 * per-IP rate limit, envelope size cap, and a DSN check on envelopes that
 * declare one (the Worker relays to OUR project only, it's not an open
 * Sentry proxy).
 *
 * Pinned to the project's DSN at build time. If the DSN is empty, the
 * tunnel returns 503 — the client SDK won't even initialise without DSN
 * so this branch shouldn't fire in practice.
 *
 * Docs: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */

const MAX_ENVELOPE_BYTES = 1_000_000; // replay segments stay well under 1 MB
const TUNNEL_RULE = { limit: 300, windowSec: 300 };

const upstream = (() => {
  if (!PUBLIC_SENTRY_DSN) return null;
  const url = new URL(PUBLIC_SENTRY_DSN);
  const projectId = url.pathname.replace(/^\/+/, '');
  const sentryKey = url.username;
  const params = new URLSearchParams({
    sentry_version: '7',
    sentry_key: sentryKey,
    sentry_client: 'hour-tunnel/1.0',
  });
  return {
    url: `https://${url.hostname}/api/${projectId}/envelope/?${params}`,
    host: url.hostname,
    projectId,
  };
})();

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!upstream) {
    return new Response(
      JSON.stringify({ error: 'sentry_not_configured' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const kv = (platform?.env as unknown as { RATE_LIMIT?: KVNamespace } | undefined)?.RATE_LIMIT;
  if (!(await allowRequest(kv, `tunnel:${clientIp(request)}`, TUNNEL_RULE))) {
    return new Response(null, { status: 429 });
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 });
  }
  const envelope = await request.arrayBuffer();
  if (envelope.byteLength > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 });
  }

  // Envelope header (first newline-delimited JSON line) may declare a DSN —
  // when it does, it must be ours. Headerless kinds (sessions, replays)
  // pass; they authenticate via the pinned query params upstream anyway.
  try {
    const firstLine = new TextDecoder().decode(
      envelope.slice(0, Math.min(envelope.byteLength, 2048)),
    );
    const header = JSON.parse(firstLine.split('\n', 1)[0]) as { dsn?: string };
    if (header.dsn) {
      const dsn = new URL(header.dsn);
      if (dsn.hostname !== upstream.host || dsn.pathname.replace(/^\/+/, '') !== upstream.projectId) {
        return new Response(null, { status: 403 });
      }
    }
  } catch {
    return new Response(null, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(upstream.url, {
      method: 'POST',
      body: envelope,
      headers: { 'content-type': 'application/x-sentry-envelope' },
    });
  } catch {
    // Upstream unreachable — swallow instead of 500ing (a tunnel failure
    // must never cascade into the app's own error reporting).
    return new Response(null, { status: 502 });
  }

  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
  });
};
