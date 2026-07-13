/**
 * Sentry PII scrubbing shared by hooks.client.ts and hooks.server.ts
 * (Phase 0.9 hardening gate).
 *
 * What gets scrubbed and why:
 *   - Capability tokens in public-share URLs (/public/roadsheet/<token>,
 *     /api/public/calendar/<token>) — the URL IS the secret; an event or
 *     navigation breadcrumb that captures it would hand out the share.
 *   - token / apikey / sentry_key query params, defensively — the collab
 *     WS token param died with the cookie migration, but a regression
 *     shouldn't turn Sentry into a token log.
 *
 * `sendDefaultPii: false` (set in both hooks) already keeps IPs, cookies
 * and headers out; this covers what rides inside URLs.
 */

const CAPABILITY_PATH = /(\/(?:roadsheet|calendar)\/)[0-9a-f]{16,}/gi;
const SENSITIVE_QUERY = /([?&](?:token|apikey|sentry_key)=)[^&#\s]+/gi;

export function scrubUrl(url: string): string {
  return url.replace(CAPABILITY_PATH, '$1[token]').replace(SENSITIVE_QUERY, '$1[redacted]');
}

interface UrlBearingEvent {
  request?: { url?: string; query_string?: unknown };
  breadcrumbs?: Array<{
    data?: Record<string, unknown>;
    message?: string;
  }>;
}

/**
 * beforeSend / beforeSendTransaction hook. Generic over the event type so
 * the client and server SDK variants both typecheck without casts.
 */
export function scrubSentryEvent<T extends UrlBearingEvent>(event: T): T {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (event.request?.query_string) delete event.request.query_string;
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.url === 'string') crumb.data.url = scrubUrl(crumb.data.url);
    if (typeof crumb.data?.to === 'string') crumb.data.to = scrubUrl(crumb.data.to);
    if (typeof crumb.data?.from === 'string') crumb.data.from = scrubUrl(crumb.data.from);
    if (typeof crumb.message === 'string') crumb.message = scrubUrl(crumb.message);
  }
  return event;
}
