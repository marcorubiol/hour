import type { RequestHandler } from './$types';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';

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
 * Pinned to the project's DSN at build time. If the DSN is empty, the
 * tunnel returns 503 — the client SDK won't even initialise without DSN
 * so this branch shouldn't fire in practice.
 *
 * Docs: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */

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
  return `https://${url.hostname}/api/${projectId}/envelope/?${params}`;
})();

export const POST: RequestHandler = async ({ request }) => {
  if (!upstream) {
    return new Response(
      JSON.stringify({ error: 'sentry_not_configured' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const envelope = await request.arrayBuffer();
  const res = await fetch(upstream, {
    method: 'POST',
    body: envelope,
    headers: { 'content-type': 'application/x-sentry-envelope' },
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
  });
};
