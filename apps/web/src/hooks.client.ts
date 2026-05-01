import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

if (env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: env.PUBLIC_SENTRY_ENV ?? 'phase0',
  });
}

export const handleError = handleErrorWithSentry();
