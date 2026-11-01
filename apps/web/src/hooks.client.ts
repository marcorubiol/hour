import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENV } from '$env/static/public';
import { scrubSentryEvent, scrubTransaction } from '$lib/sentry-scrub';

if (PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: PUBLIC_SENTRY_DSN,
    enabled: true,
    environment: PUBLIC_SENTRY_ENV || (dev ? 'phase0-dev' : 'phase0'),
    // Tunnel envelopes through our own origin so Firefox ETP, Brave Shields,
    // uBlock Origin, and similar tracking-protection layers don't drop them.
    // Server-side endpoint at src/routes/api/sentry-tunnel/+server.ts
    // forwards to the configured Sentry ingest host.
    tunnel: '/api/sentry-tunnel',
    // A page load (the Web Vitals and `hoy.content`, $lib/vitals) at 50 %:
    // with a handful of people, 10 % is a few opens a week, too few to see a
    // phone getting slower. Everything else stays at 10 % (ADR-157).
    tracesSampler: ({ attributes, inheritOrSampleWith }) =>
      attributes?.['sentry.op'] === 'pageload' ? 0.5 : inheritOrSampleWith(0.1),
    // PII posture (Phase 0.9): no IPs/cookies/headers on events, capability
    // tokens scrubbed out of URLs (see $lib/sentry-scrub.ts).
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    // A transaction carries timings and the route, never a URL with ids,
    // slugs or a query (ADR-157).
    beforeSendTransaction: scrubTransaction,
    // Replays: 10 % of normal sessions + 100 % of sessions with errors. Free
    // plan ships 50 replays/month so this is generous for Phase 0 traffic.
    // Masking explicit (they're also the defaults): external users' text
    // and media never leave the page.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
  });
}

export const handleError: HandleClientError = handleErrorWithSentry(
  ({ error, event }) => {
    console.error('Client error', { error, route: event.route?.id });
  },
);
