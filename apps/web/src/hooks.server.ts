import {
  handleErrorWithSentry,
  initCloudflareSentryHandle,
  sentryHandle,
} from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENV } from '$env/static/public';
import { scrubSentryEvent } from '$lib/sentry-scrub';

/**
 * `initCloudflareSentryHandle` is the Workers-runtime-correct equivalent of
 * `Sentry.init()`. It expects a static config object (not a per-request
 * factory), so the DSN is read from `$env/static/public` at build time and
 * baked into the bundle. Sentry DSNs are public-safe by design (they only
 * authorise event ingest, not anything sensitive), so this is fine.
 *
 * If `PUBLIC_SENTRY_DSN` is unset, Sentry initialises with `enabled: false`
 * and silently no-ops — no events shipped, no warnings.
 *
 * PII posture (Phase 0.9): `sendDefaultPii: false` keeps IPs, cookies and
 * headers out of events; `beforeSend` scrubs capability tokens riding in
 * URLs (see $lib/sentry-scrub.ts).
 */
const sentryConfig = {
  dsn: PUBLIC_SENTRY_DSN,
  enabled: Boolean(PUBLIC_SENTRY_DSN),
  environment: PUBLIC_SENTRY_ENV || (dev ? 'phase0-dev' : 'phase0'),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
};

/**
 * Non-CSP security headers (CSP itself is kit.csp in svelte.config.js —
 * SvelteKit owns the nonces for its inline hydration scripts). HSTS only
 * outside dev; frame-ancestors lives in the CSP, x-frame-options covers
 * pre-CSP2 agents.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
  ...(dev ? {} : { 'strict-transport-security': 'max-age=15552000' }),
};

/**
 * Outermost shell: request id + CSRF origin floor + security headers.
 *
 * CSRF: session auth rides an httpOnly cookie (SameSite=Strict already
 * blocks cross-site sends in modern browsers); this check is the second
 * layer — a mutation whose Origin header disagrees with our own origin is
 * rejected outright. Requests WITHOUT an Origin header pass: browsers
 * always send it cross-site, so an absent header means a non-browser
 * client (tests, curl) that can't be CSRF'd into anything.
 */
const requestContext: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID();

  const method = event.request.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = event.request.headers.get('origin');
    if (origin && origin !== event.url.origin) {
      return new Response(JSON.stringify({ error: 'cross_origin' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
  }

  const response = await resolve(event);

  // 101 = WebSocket upgrade (collab) — its headers are immutable and the
  // security headers are meaningless there anyway. Other passthrough
  // responses (redirects) can also carry immutable headers → best-effort.
  if (response.status === 101) return response;
  try {
    response.headers.set('x-request-id', event.locals.requestId);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
  } catch {
    /* immutable headers on a passthrough response — serve it as-is */
  }
  return response;
};

/**
 * 301 redirects for ADR-008 vocab holdovers (room/gig/houses/rooms).
 *
 * The cleanup of 2026-05-19 dropped these names from the schema and the
 * canonical URLs, but in-flight bookmarks, dev branches with stale URLs
 * (e.g. Marco's uncommitted settings page calling /api/houses), and any
 * cached link in shared docs would 404 without these redirects.
 *
 * Browsers + `fetch()` follow 301 transparently so API consumers don't
 * need to change client code. Plan: remove this hook when all references
 * are migrated (Phase 0.2 close, ~2-4 weeks).
 */
const legacyVocabRedirects: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // API endpoints
  if (path === '/api/houses' || path.startsWith('/api/houses?')) {
    return Response.redirect(
      new URL(path.replace('/api/houses', '/api/workspaces'), event.url).toString(),
      301,
    );
  }
  if (path === '/api/rooms' || path.startsWith('/api/rooms?')) {
    return Response.redirect(
      new URL(path.replace('/api/rooms', '/api/projects'), event.url).toString(),
      301,
    );
  }

  // Page routes /h/[ws]/room/[slug]/... → /h/[ws]/project/[slug]/...
  const roomPageMatch = path.match(/^(\/h\/[^/]+)\/room(\/.*)?$/);
  if (roomPageMatch) {
    const dest = new URL(roomPageMatch[1] + '/project' + (roomPageMatch[2] ?? ''), event.url);
    dest.search = event.url.search;
    return Response.redirect(dest.toString(), 301);
  }

  // Page routes /h/[ws]/gig/[slug]/... → /h/[ws]/performance/[slug]/...
  const gigPageMatch = path.match(/^(\/h\/[^/]+)\/gig(\/.*)?$/);
  if (gigPageMatch) {
    const dest = new URL(gigPageMatch[1] + '/performance' + (gigPageMatch[2] ?? ''), event.url);
    dest.search = event.url.search;
    return Response.redirect(dest.toString(), 301);
  }

  // Lens rename (ADR-065): /h/[ws]/agenda → /desk.
  const agendaMatch = path.match(/^(\/h\/[^/]+)\/agenda\/?$/);
  if (agendaMatch) {
    const dest = new URL(agendaMatch[1] + '/desk', event.url);
    dest.search = event.url.search;
    return Response.redirect(dest.toString(), 301);
  }

  // Lens rename (Calendar → Planner): /h/calendar and /h/[ws]/calendar → /h/planner
  // (lenses are space-less since ADR-067; scope rides in ?scope=, preserved).
  if (/^\/h(\/[^/]+)?\/calendar\/?$/.test(path)) {
    const dest = new URL('/h/planner', event.url);
    dest.search = event.url.search;
    return Response.redirect(dest.toString(), 301);
  }

  return resolve(event);
};

export const handle: Handle = sequence(
  requestContext,
  legacyVocabRedirects,
  initCloudflareSentryHandle(sentryConfig),
  sentryHandle(),
);

export const handleError: HandleServerError = handleErrorWithSentry(({ error, event }) => {
  // Structured JSON — Workers observability parses these into queryable
  // fields, and the request id ties the log line to the x-request-id the
  // client saw.
  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'unhandled',
      request_id: event.locals.requestId ?? null,
      route: event.route?.id ?? null,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 1500) : undefined,
    }),
  );
});
