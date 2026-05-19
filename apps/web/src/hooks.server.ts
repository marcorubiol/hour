import {
  handleErrorWithSentry,
  initCloudflareSentryHandle,
  sentryHandle,
} from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENV } from '$env/static/public';

/**
 * `initCloudflareSentryHandle` is the Workers-runtime-correct equivalent of
 * `Sentry.init()`. It expects a static config object (not a per-request
 * factory), so the DSN is read from `$env/static/public` at build time and
 * baked into the bundle. Sentry DSNs are public-safe by design (they only
 * authorise event ingest, not anything sensitive), so this is fine.
 *
 * If `PUBLIC_SENTRY_DSN` is unset, Sentry initialises with `enabled: false`
 * and silently no-ops — no events shipped, no warnings.
 */
const sentryConfig = {
  dsn: PUBLIC_SENTRY_DSN,
  enabled: Boolean(PUBLIC_SENTRY_DSN),
  environment: PUBLIC_SENTRY_ENV || (dev ? 'phase0-dev' : 'phase0'),
  tracesSampleRate: 0.1,
  sendDefaultPii: true,
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

  return resolve(event);
};

export const handle: Handle = sequence(
  legacyVocabRedirects,
  initCloudflareSentryHandle(sentryConfig),
  sentryHandle(),
);

export const handleError: HandleServerError = handleErrorWithSentry(
  ({ error, event }) => {
    console.error('Server error', { error, route: event.route?.id });
  },
);
