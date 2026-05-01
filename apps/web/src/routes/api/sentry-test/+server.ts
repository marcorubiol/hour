import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * Smoke endpoint — throws an uncaught error so the server-side Sentry handle
 * (`initCloudflareSentryHandle` + `sentryHandle`) captures it and ships an
 * event to the configured Sentry project.
 *
 * Dev-only by default. In production, accessible with `?force=1` so we can
 * verify the deployed Worker's Sentry wiring without exposing the path to
 * drive-by traffic.
 */
export const GET: RequestHandler = async ({ url }) => {
  if (!dev && url.searchParams.get('force') !== '1') {
    error(404, 'Not Found');
  }
  throw new Error(`Hour server smoke ${new Date().toISOString()}`);
};
