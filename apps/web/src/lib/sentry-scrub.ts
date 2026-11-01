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

function scrubUrl(url: string): string {
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

/** `/api/team?workspace_ids=…` → `/api/team`; `/api/persons/anouk/notes/7` → `/api/persons/*`. */
function pathShape(url: string): string {
  let path: string;
  try {
    path = new URL(url, 'https://x.invalid').pathname;
  } catch {
    return '*';
  }
  // Hashed build assets name no one: kept, they say which chunk was slow.
  if (path.startsWith('/_app/')) return path;
  const [first, second, ...rest] = path.split('/').filter(Boolean);
  if (!first) return '/';
  if (first !== 'api') return '/*';
  return `/api/${second ?? ''}${rest.length ? '/*' : ''}`;
}

interface TransactionEvent extends UrlBearingEvent {
  transaction?: string;
  contexts?: { trace?: { data?: Record<string, unknown> } };
  spans?: Array<{ op?: string; description?: string; data?: Record<string, unknown> }>;
}

const URL_KEYS = ['url', 'http.url', 'url.full', 'url.path', 'url.query', 'http.query', 'server.address', 'http.fragment'];

/**
 * beforeSendTransaction on the client (ADR-157): a transaction is for
 * timings, so it carries the route and the timings and nothing that names a
 * person, a space or a record. The page URL becomes the route pattern
 * (`/h/[workspace]/…`, the transaction's name); every span keeps its op and
 * its times, and its URL is cut to a shape: no query, no ids, no slugs.
 * Measurements (LCP, FCP, TTFB, CLS, `hoy.content`) are numbers and stay.
 */
export function scrubTransaction<T extends TransactionEvent>(event: T): T {
  scrubSentryEvent(event);
  if (event.request) event.request.url = event.transaction ?? '*';
  // The root span: its URL attributes, and the URL of an image that was the LCP.
  for (const key of [...URL_KEYS, 'lcp.url']) delete event.contexts?.trace?.data?.[key];
  for (const span of event.spans ?? []) {
    for (const key of URL_KEYS) delete span.data?.[key];
    if (!span.description) continue;
    if (span.op?.startsWith('navigation') || span.op?.startsWith('ui')) {
      span.description = event.transaction ?? span.op;
    } else if (/^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS) /.test(span.description)) {
      const [method, url] = span.description.split(' ');
      span.description = `${method} ${pathShape(url)}`;
    } else if (/^(https?:\/\/|\/)/.test(span.description)) {
      span.description = pathShape(span.description);
    }
  }
  return event;
}
