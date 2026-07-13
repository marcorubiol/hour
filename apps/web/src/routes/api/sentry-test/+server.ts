import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * Smoke endpoint — throws an uncaught error so the server-side Sentry handle
 * (`initCloudflareSentryHandle` + `sentryHandle`) captures it and ships an
 * event to the configured Sentry project.
 *
 * Dev-only, hard. The old `?force=1` production escape hatch died in the
 * Phase 0.9 hardening pass: anyone who knew the URL could burn Sentry quota
 * and pollute alerting. To smoke-test production wiring, trigger a real
 * error behind auth or use a one-off deploy — don't resurrect the flag.
 */
export const GET: RequestHandler = async () => {
  if (!dev) error(404, 'Not Found');
  throw new Error(`Hour server smoke ${new Date().toISOString()}`);
};
