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

export const handle: Handle = sequence(
  initCloudflareSentryHandle(sentryConfig),
  sentryHandle(),
);

export const handleError: HandleServerError = handleErrorWithSentry(
  ({ error, event }) => {
    console.error('Server error', { error, route: event.route?.id });
  },
);
