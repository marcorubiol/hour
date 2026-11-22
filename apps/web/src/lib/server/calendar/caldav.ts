/**
 * Apple iCloud (y cualquier servidor CalDAV estándar: Fastmail, Nextcloud…)
 * adapter (ADR-241 Fases 2-4).
 *
 * Basado en los hallazgos verificados en Fase 0 sobre `workerd`:
 *   · `fetch()` con `redirect: 'manual'` reenviando Basic auth en saltos
 *     `*.icloud.com` (evita que Fetch borre `Authorization` al cambiar de host).
 *   · `MKCOL` extendido (RFC 5689) para crear el calendario «Hour» (`workerd`
 *     rechaza `MKCALENDAR`, e iCloud responde `201 Created` a `MKCOL`).
 *   · `PROPFIND` Depth: 1 con `getetag` + `decodeURIComponent(href)` para listar
 *     eventos del calendario «Hour» con total fiabilidad.
 *   · `REPORT calendar-query` con `time-range` sobre los calendarios externos
 *     elegidos (Fase 3) + `parseIcsTimings` / `expandTimingToBusy` (nunca se
 *     leen ni guardan títulos ni lugares).
 *
 * Solo imports relativos: empaquetado también por wrangler (`worker-cron.ts`).
 */

import { buildSingleEventIcs, type CalendarEvent } from '../../calendar-events';
import { expandTimingToBusy, parseIcsTimings } from './ics-parse';
import {
  CalendarAuthError,
  CalendarProviderError,
  type BusyInterval,
  type CalendarAdapter,
  type DiscoveryResult,
  type FetchFn,
  type RemoteCalendar,
  type RemoteEventSummary,
  type RemoteEventTiming,
} from './types';

const ICLOUD_ROOT = 'https://caldav.icloud.com/';
const HOUR_CALENDAR_NAME = 'hour';
const XML_CT = { 'content-type': 'application/xml; charset=utf-8' };

export interface CalDavCredentials {
  appleId: string;
  appPassword: string;
  serverUrl?: string;
}

function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTagHref(xml: string, tagName: string): string | null {
  const blockRe = new RegExp(
    `<(?:[a-z0-9_-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tagName}>`,
    'i',
  );
  const block = blockRe.exec(xml);
  if (!block) return null;
  const href = /<(?:[a-z0-9_-]+:)?href\b[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?href>/i.exec(block[1]);
  return href ? decodeXmlEntities(href[1].trim()) : null;
}

function extractTextTag(xml: string, tagName: string): string | null {
  const re = new RegExp(
    `<(?:[a-z0-9_-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tagName}>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
  return cdata ? cdata[1].trim() : decodeXmlEntities(raw);
}

function extractResponses(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:[a-z0-9_-]+:)?response\b[^>]*>[\s\S]*?<\/(?:[a-z0-9_-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}

function normalizeEtag(raw: string | null): string | null {
  if (!raw) return null;
  return raw.trim().replace(/^W\//i, '').replace(/^"|"$/g, '') || null;
}

function uidFromHref(href: string): string | null {
  const decoded = decodeURIComponent(href);
  const m = /([^/]+)\.ics$/i.exec(decoded);
  return m ? m[1] : null;
}

function toCaldavUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function allowedRedirectHost(fromUrl: string, nextUrl: URL): boolean {
  const from = new URL(fromUrl);
  if (nextUrl.hostname === from.hostname) return true;
  return nextUrl.protocol === 'https:' && nextUrl.hostname.endsWith('.icloud.com');
}

async function davRequest(
  fetchFn: FetchFn,
  url: string,
  auth: string,
  opts: { method: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; ok: boolean; url: string; etag: string | null; text: string }> {
  let currentUrl = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetchFn(currentUrl, {
      method: opts.method,
      headers: {
        authorization: auth,
        'user-agent': 'Hour-Calendar-Sync/1.0',
        ...opts.headers,
      },
      body: opts.body,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) {
        const nextUrl = new URL(loc, currentUrl);
        if (allowedRedirectHost(currentUrl, nextUrl)) {
          currentUrl = nextUrl.toString();
          continue;
        }
      }
    }

    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new CalendarAuthError(`caldav_auth_${res.status}`);
    }
    return {
      status: res.status,
      ok: res.ok || res.status === 207,
      url: currentUrl,
      etag: normalizeEtag(res.headers.get('etag')),
      text,
    };
  }
  throw new CalendarProviderError(508, 'caldav_too_many_redirects');
}

export function caldavAdapter(
  fetchFn: FetchFn,
  creds: CalDavCredentials,
  cached?: { principalUrl?: string | null; calendarHomeUrl?: string | null; hourCalendarId?: string | null },
): CalendarAdapter {
  const rootUrl = creds.serverUrl || ICLOUD_ROOT;
  const auth = basicAuth(creds.appleId.trim(), creds.appPassword.trim());

  async function discoverHome(): Promise<{ principalUrl: string; homeUrl: string }> {
    let principalUrl = cached?.principalUrl ?? null;
    if (!principalUrl) {
      const p1 = await davRequest(fetchFn, rootUrl, auth, {
        method: 'PROPFIND',
        headers: { ...XML_CT, depth: '0' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
      });
      if (!p1.ok) throw new CalendarProviderError(p1.status, 'caldav_principal_failed');
      const href = extractTagHref(p1.text, 'current-user-principal');
      if (!href) throw new CalendarProviderError(502, 'caldav_principal_missing');
      principalUrl = new URL(href, p1.url).toString();
    }

    let homeUrl = cached?.calendarHomeUrl ?? null;
    if (!homeUrl) {
      const p2 = await davRequest(fetchFn, principalUrl, auth, {
        method: 'PROPFIND',
        headers: { ...XML_CT, depth: '0' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
          '<d:prop><c:calendar-home-set/></d:prop></d:propfind>',
      });
      if (!p2.ok) throw new CalendarProviderError(p2.status, 'caldav_home_failed');
      const href = extractTagHref(p2.text, 'calendar-home-set');
      if (!href) throw new CalendarProviderError(502, 'caldav_home_missing');
      homeUrl = new URL(href.endsWith('/') ? href : `${href}/`, p2.url).toString();
    }

    return { principalUrl, homeUrl };
  }

  return {
    provider: 'icloud',

    async ensureCalendar(): Promise<DiscoveryResult> {
      const { principalUrl, homeUrl } = await discoverHome();

      const list = await davRequest(fetchFn, homeUrl, auth, {
        method: 'PROPFIND',
        headers: { ...XML_CT, depth: '1' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">' +
          '<d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/></d:prop>' +
          '</d:propfind>',
      });
      if (!list.ok) throw new CalendarProviderError(list.status, 'caldav_list_calendars_failed');

      let hourCalendarId = cached?.hourCalendarId ?? null;
      let hourFound = false;
      let hourNeedsRename = false;
      const availableCalendars: RemoteCalendar[] = [];

      for (const block of extractResponses(list.text)) {
        const href = extractTextTag(block, 'href');
        if (!href) continue;
        const fullUrl = new URL(href.endsWith('/') ? href : `${href}/`, list.url).toString();
        if (fullUrl === homeUrl) continue;
        // Must be a calendar collection supporting VEVENT (skip VTODO / inbox / outbox / notifications).
        const isCalendar = /<(?:[a-z0-9_-]+:)?calendar\b/i.test(block);
        if (!isCalendar) continue;
        const hasCompSet = /supported-calendar-component-set/i.test(block);
        if (hasCompSet && !/name=["']VEVENT["']/i.test(block)) continue;

        const name = extractTextTag(block, 'displayname') || '';
        const color = extractTextTag(block, 'calendar-color');

        if ((hourCalendarId && fullUrl === hourCalendarId) || name.trim().toLowerCase() === HOUR_CALENDAR_NAME) {
          hourCalendarId = fullUrl;
          hourFound = true;
          if (name.trim() !== HOUR_CALENDAR_NAME) hourNeedsRename = true;
        } else if (name.trim()) {
          availableCalendars.push({ id: fullUrl, name: name.trim(), color });
        }
      }

      if (hourFound && hourNeedsRename && hourCalendarId) {
        // Best-effort PROPPATCH to normalize legacy «Hour» displayname to lowercase «hour».
        try {
          await davRequest(fetchFn, hourCalendarId, auth, {
            method: 'PROPPATCH',
            headers: XML_CT,
            body:
              '<?xml version="1.0" encoding="utf-8"?>' +
              '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop>' +
              `<d:displayname>${HOUR_CALENDAR_NAME}</d:displayname>` +
              '</d:prop></d:set></d:propertyupdate>',
          });
        } catch {
          // Non-fatal: sync continues even if the server refuses rename.
        }
      }

      if (!hourFound) {
        const slug = `hour-${crypto.randomUUID().slice(0, 8)}/`;
        const targetUrl = new URL(slug, homeUrl).toString();
        // RFC 5689 Extended MKCOL — verified in Phase 0 against workerd + caldav.icloud.com.
        const created = await davRequest(fetchFn, targetUrl, auth, {
          method: 'MKCOL',
          headers: XML_CT,
          body:
            '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
            '<d:set><d:prop>' +
            '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>' +
            `<d:displayname>${HOUR_CALENDAR_NAME}</d:displayname>` +
            '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>' +
            '</d:prop></d:set></d:mkcol>',
        });
        if (!created.ok) throw new CalendarProviderError(created.status, 'caldav_mkcol_failed');
        hourCalendarId = targetUrl;
      }

      return {
        hourCalendarId: hourCalendarId!,
        principalUrl,
        calendarHomeUrl: homeUrl,
        availableCalendars,
      };
    },

    async listHourEvents(hourCalendarId: string): Promise<{ items: RemoteEventSummary[]; syncCursor: string | null }> {
      const res = await davRequest(fetchFn, hourCalendarId, auth, {
        method: 'PROPFIND',
        headers: { ...XML_CT, depth: '1' },
        body:
          '<?xml version="1.0" encoding="utf-8"?>' +
          '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:sync-token/></d:prop></d:propfind>',
      });
      if (res.status === 404) {
        return { items: [], syncCursor: null };
      }
      if (!res.ok) throw new CalendarProviderError(res.status, 'caldav_list_events_failed');

      const items: RemoteEventSummary[] = [];
      let syncCursor: string | null = null;
      const baseNormalized = hourCalendarId.endsWith('/') ? hourCalendarId : `${hourCalendarId}/`;

      for (const block of extractResponses(res.text)) {
        const href = extractTextTag(block, 'href');
        if (!href) continue;
        const fullUrl = new URL(href, res.url).toString();
        const token = extractTextTag(block, 'sync-token');
        if (token) syncCursor = token;
        if (fullUrl === baseNormalized || !/\.ics$/i.test(fullUrl)) continue;
        const etag = normalizeEtag(extractTextTag(block, 'getetag'));
        items.push({
          uid: uidFromHref(fullUrl),
          remoteId: fullUrl,
          etag,
        });
      }
      return { items, syncCursor };
    },

    async getEventTiming(_hourCalendarId: string, remoteId: string): Promise<RemoteEventTiming | null> {
      const res = await davRequest(fetchFn, remoteId, auth, { method: 'GET' });
      if (res.status === 404) return null;
      if (!res.ok) throw new CalendarProviderError(res.status, 'caldav_get_event_failed');
      const parsed = parseIcsTimings(res.text)[0];
      if (!parsed || parsed.cancelled) return null;
      return {
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        allDay: parsed.allDay,
        etag: res.etag,
      };
    },

    async putEvent(
      hourCalendarId: string,
      event: CalendarEvent,
      existing: { remoteId: string; etag: string | null } | null,
      now: Date,
    ): Promise<{ remoteId: string; etag: string | null }> {
      const base = hourCalendarId.endsWith('/') ? hourCalendarId : `${hourCalendarId}/`;
      const targetUrl = existing?.remoteId || new URL(`${encodeURIComponent(event.uid)}.ics`, base).toString();
      const ics = buildSingleEventIcs(event, now, { useLocalTz: true });
      const res = await davRequest(fetchFn, targetUrl, auth, {
        method: 'PUT',
        headers: { 'content-type': 'text/calendar; charset=utf-8' },
        body: ics,
      });
      if (!res.ok) throw new CalendarProviderError(res.status, 'caldav_put_event_failed');
      return { remoteId: targetUrl, etag: res.etag };
    },

    async deleteEvent(_hourCalendarId: string, remoteId: string): Promise<void> {
      const res = await davRequest(fetchFn, remoteId, auth, { method: 'DELETE' });
      if (res.status !== 404 && !res.ok) {
        throw new CalendarProviderError(res.status, 'caldav_delete_event_failed');
      }
    },

    async deleteHourCalendar(hourCalendarId: string): Promise<void> {
      const res = await davRequest(fetchFn, hourCalendarId, auth, { method: 'DELETE' });
      if (res.status !== 404 && !res.ok) {
        throw new CalendarProviderError(res.status, 'caldav_delete_calendar_failed');
      }
    },

    async fetchBusy(calendarIds: string[], from: Date, to: Date): Promise<BusyInterval[]> {
      const out: BusyInterval[] = [];
      const startStr = toCaldavUtc(from);
      const endStr = toCaldavUtc(to);

      for (const calUrl of calendarIds.slice(0, 8)) {
        const res = await davRequest(fetchFn, calUrl, auth, {
          method: 'REPORT',
          headers: { ...XML_CT, depth: '1' },
          body:
            '<?xml version="1.0" encoding="utf-8"?>' +
            '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
            '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
            '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
            `<c:time-range start="${startStr}" end="${endStr}"/>` +
            '</c:comp-filter></c:comp-filter></c:filter>' +
            '</c:calendar-query>',
        });
        if (res.status === 404 || !res.ok) continue;

        for (const block of extractResponses(res.text)) {
          const ics = extractTextTag(block, 'calendar-data');
          if (!ics) continue;
          for (const timing of parseIcsTimings(ics)) {
            for (const interval of expandTimingToBusy(timing, from, to)) {
              out.push({ ...interval, source_calendar_id: calUrl });
            }
          }
        }
      }

      return out;
    },
  };
}
