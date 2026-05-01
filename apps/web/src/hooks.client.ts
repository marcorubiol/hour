import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENV } from '$env/static/public';

if (PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: PUBLIC_SENTRY_DSN,
    enabled: true,
    environment: PUBLIC_SENTRY_ENV || (dev ? 'phase0-dev' : 'phase0'),
    tracesSampleRate: 0.1,
    sendDefaultPii: true,
    // Replays: 10 % of normal sessions + 100 % of sessions with errors. Free
    // plan ships 50 replays/month so this is generous for Phase 0 traffic.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.replayIntegration()],
  });
}

export const handleError: HandleClientError = handleErrorWithSentry(
  ({ error, event }) => {
    console.error('Client error', { error, route: event.route?.id });
  },
);
