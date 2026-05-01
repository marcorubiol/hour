import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry, sentryHandle } from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

if (privateEnv.SENTRY_DSN || env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: privateEnv.SENTRY_DSN ?? env.PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: env.PUBLIC_SENTRY_ENV ?? 'phase0',
  });
}

export const handle = sequence(sentryHandle());
export const handleError = handleErrorWithSentry();
