/**
 * Google Calendar API v3 adapter (ADR-241 Fase 5).
 *
 * Permisos mínimos (consentimiento propio separado de Buzones/Gmail):
 *   · `calendar.app.created`: crear el calendario secundario «Hour» y gestionar
 *     solo los eventos dentro de él (nunca toca el calendario principal).
 *   · `calendar.freebusy`: leer solo disponibilidad (ocupado/libre) sin títulos
 *     ni lugares (Fase 3).
 *   · `calendar.calendarlist.readonly`: listar los calendarios de la persona
 *     para que elija cuáles cuentan como ocupado.
 *   · `userinfo.email`: conocer el correo de la cuenta conectada para la línea
 *     de estado y el AAD del cifrado.
 *
 * Solo imports relativos: empaquetado también por wrangler (`worker-cron.ts`).
 */

import type { CalendarEvent } from '../../calendar-events';
import { randomCalendarToken, sha256Hex } from './crypto';
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
  type WatchRegistration,
} from './types';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const API = 'https://www.googleapis.com/calendar/v3';
const HOUR_CALENDAR_NAME = 'Hour';

export function googleCalendarAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (opts.loginHint) u.searchParams.set('login_hint', opts.loginHint);
  return u.toString();
}

export function hasCalendarScopes(granted: string | undefined): boolean {
  const set = new Set((granted ?? '').split(/\s+/).filter(Boolean));
  return set.has('https://www.googleapis.com/auth/calendar.app.created');
}

async function readGoogleError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string; status?: string } };
    if (typeof j.error === 'string') return j.error;
    return j.error?.status ?? j.error?.message ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

export async function exchangeGoogleCalendarCode(
  fetchFn: FetchFn,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string },
): Promise<{ accessToken: string; refreshToken: string | null; scope: string }> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      code_verifier: opts.verifier,
      grant_type: 'authorization_code',
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) throw new CalendarProviderError(res.status, await readGoogleError(res));
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!j.access_token) throw new CalendarProviderError(502, 'no_access_token');
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, scope: j.scope ?? '' };
}

export async function fetchGoogleAccountEmail(fetchFn: FetchFn, accessToken: string): Promise<string> {
  const res = await fetchFn(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (res.status === 401) throw new CalendarAuthError('unauthorized');
  if (!res.ok) throw new CalendarProviderError(res.status, await readGoogleError(res));
  const j = (await res.json()) as { email?: string };
  if (!j.email) throw new CalendarProviderError(502, 'no_email');
  return j.email.toLowerCase();
}

async function refreshGoogleAccessToken(
  fetchFn: FetchFn,
  opts: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<string> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (res.status === 400 || res.status === 401) {
    const err = await readGoogleError(res);
    if (err === 'invalid_grant' || err === 'unauthorized_client') throw new CalendarAuthError(err);
    throw new CalendarProviderError(res.status, err);
  }
  if (!res.ok) throw new CalendarProviderError(res.status, await readGoogleError(res));
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new CalendarProviderError(502, 'no_access_token');
  return j.access_token;
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Translate Hour's neutral `CalendarEvent` into Google Calendar API v3 event JSON. */
export function eventToGoogleBody(e: CalendarEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: e.summary,
    location: e.location ?? undefined,
    description: e.description ?? undefined,
    status: e.status === 'TENTATIVE' ? 'tentative' : 'confirmed',
    transparency: e.transparency === 'TRANSPARENT' ? 'transparent' : 'opaque',
    extendedProperties: {
      private: {
        hourUid: e.uid,
        hourEntityKind: e.entityKind,
        hourEntityId: e.entityId,
      },
    },
  };

  if (e.url) {
    body.source = { title: 'Hour', url: e.url };
  }

  if (e.startUtc) {
    body.start = { dateTime: e.startUtc, timeZone: e.timezone || 'UTC' };
    body.end = { dateTime: e.endUtc ?? e.startUtc, timeZone: e.timezone || 'UTC' };
  } else if (e.startDate) {
    body.start = { date: e.startDate };
    body.end = { date: addDaysIso(e.endDate ?? e.startDate, 1) };
  }

  if (e.alarm === 'day_before') {
    body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }] };
  } else if (e.alarm === '2h_before') {
    body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 120 }] };
  } else {
    body.reminders = { useDefault: false, overrides: [] };
  }

  return body;
}

export function googleCalendarAdapter(
  fetchFn: FetchFn,
  opts: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    initialAccessToken?: string;
    hourCalendarId?: string | null;
  },
): CalendarAdapter {
  let cachedToken = opts.initialAccessToken ?? null;

  async function accessToken(): Promise<string> {
    if (cachedToken) return cachedToken;
    cachedToken = await refreshGoogleAccessToken(fetchFn, {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      refreshToken: opts.refreshToken,
    });
    return cachedToken;
  }

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await accessToken();
    const res = await fetchFn(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (res.status === 401) throw new CalendarAuthError('unauthorized');
    if (res.status === 204) return undefined as T;
    if (!res.ok) throw new CalendarProviderError(res.status, await readGoogleError(res));
    return (await res.json()) as T;
  }

  return {
    provider: 'google',

    async ensureCalendar(): Promise<DiscoveryResult> {
      const availableCalendars: RemoteCalendar[] = [];
      let hourCalendarId = opts.hourCalendarId ?? null;
      let hourExists = false;

      try {
        const list = await call<{
          items?: Array<{ id: string; summary?: string; backgroundColor?: string; primary?: boolean; deleted?: boolean }>;
        }>('/users/me/calendarList?maxResults=100');
        for (const item of list.items ?? []) {
          if (item.deleted) continue;
          if ((hourCalendarId && item.id === hourCalendarId) || item.summary === HOUR_CALENDAR_NAME) {
            hourCalendarId = item.id;
            hourExists = true;
          } else if (item.summary) {
            availableCalendars.push({
              id: item.id,
              name: item.summary,
              color: item.backgroundColor ?? null,
              primary: Boolean(item.primary),
            });
          }
        }
      } catch (err) {
        if (err instanceof CalendarAuthError) throw err;
        // If calendarlist.readonly wasn't granted, still verify/create Hour calendar.
      }

      if (!hourExists) {
        const created = await call<{ id: string }>('/calendars', {
          method: 'POST',
          body: JSON.stringify({
            summary: HOUR_CALENDAR_NAME,
            description: 'Hour · calendario gestionado automáticamente',
          }),
        });
        hourCalendarId = created.id;
      }

      return { hourCalendarId: hourCalendarId!, availableCalendars };
    },

    async listHourEvents(hourCalendarId: string): Promise<{ items: RemoteEventSummary[]; syncCursor: string | null }> {
      const items: RemoteEventSummary[] = [];
      let pageToken: string | undefined;
      let syncCursor: string | null = null;

      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({
          maxResults: '250',
          singleEvents: 'false',
          showDeleted: 'false',
        });
        if (pageToken) q.set('pageToken', pageToken);
        const r = await call<{
          items?: Array<{
            id: string;
            etag?: string;
            extendedProperties?: { private?: { hourUid?: string } };
          }>;
          nextPageToken?: string;
          nextSyncToken?: string;
        }>(`/calendars/${encodeURIComponent(hourCalendarId)}/events?${q}`);

        for (const ev of r.items ?? []) {
          items.push({
            uid: ev.extendedProperties?.private?.hourUid ?? null,
            remoteId: ev.id,
            etag: ev.etag ? ev.etag.replace(/^"|"$/g, '') : null,
          });
        }
        if (r.nextSyncToken) syncCursor = r.nextSyncToken;
        if (!r.nextPageToken) break;
        pageToken = r.nextPageToken;
      }

      return { items, syncCursor };
    },

    async getEventTiming(hourCalendarId: string, remoteId: string): Promise<RemoteEventTiming | null> {
      try {
        const ev = await call<{
          status?: string;
          etag?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
        }>(`/calendars/${encodeURIComponent(hourCalendarId)}/events/${encodeURIComponent(remoteId)}`);
        if (ev.status === 'cancelled') return null;
        if (ev.start?.date) {
          return {
            startsAt: `${ev.start.date}T00:00:00.000Z`,
            endsAt: ev.end?.date ? `${ev.end.date}T00:00:00.000Z` : null,
            allDay: true,
            etag: ev.etag ? ev.etag.replace(/^"|"$/g, '') : null,
          };
        }
        if (ev.start?.dateTime) {
          return {
            startsAt: new Date(ev.start.dateTime).toISOString(),
            endsAt: ev.end?.dateTime ? new Date(ev.end.dateTime).toISOString() : null,
            allDay: false,
            etag: ev.etag ? ev.etag.replace(/^"|"$/g, '') : null,
          };
        }
        return null;
      } catch (err) {
        if (err instanceof CalendarProviderError && err.status === 404) return null;
        throw err;
      }
    },

    async putEvent(
      hourCalendarId: string,
      event: CalendarEvent,
      existing: { remoteId: string; etag: string | null } | null,
    ): Promise<{ remoteId: string; etag: string | null }> {
      const body = JSON.stringify(eventToGoogleBody(event));
      const calEnc = encodeURIComponent(hourCalendarId);
      if (existing?.remoteId) {
        try {
          const updated = await call<{ id: string; etag?: string }>(
            `/calendars/${calEnc}/events/${encodeURIComponent(existing.remoteId)}`,
            { method: 'PUT', body },
          );
          return { remoteId: updated.id, etag: updated.etag ? updated.etag.replace(/^"|"$/g, '') : null };
        } catch (err) {
          // If deleted remotely (404/410), recreate it cleanly.
          if (!(err instanceof CalendarProviderError && (err.status === 404 || err.status === 410))) {
            throw err;
          }
        }
      }
      const created = await call<{ id: string; etag?: string }>(`/calendars/${calEnc}/events`, {
        method: 'POST',
        body,
      });
      return { remoteId: created.id, etag: created.etag ? created.etag.replace(/^"|"$/g, '') : null };
    },

    async deleteEvent(hourCalendarId: string, remoteId: string): Promise<void> {
      try {
        await call(
          `/calendars/${encodeURIComponent(hourCalendarId)}/events/${encodeURIComponent(remoteId)}`,
          { method: 'DELETE' },
        );
      } catch (err) {
        if (err instanceof CalendarProviderError && (err.status === 404 || err.status === 410)) return;
        throw err;
      }
    },

    async deleteHourCalendar(hourCalendarId: string): Promise<void> {
      try {
        await call(`/calendars/${encodeURIComponent(hourCalendarId)}`, { method: 'DELETE' });
      } catch (err) {
        if (err instanceof CalendarProviderError && (err.status === 404 || err.status === 410)) return;
        throw err;
      }
    },

    async fetchBusy(calendarIds: string[], from: Date, to: Date): Promise<BusyInterval[]> {
      if (calendarIds.length === 0) return [];
      const res = await call<{
        calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
      }>('/freeBusy', {
        method: 'POST',
        body: JSON.stringify({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          items: calendarIds.slice(0, 20).map((id) => ({ id })),
        }),
      });
      const out: BusyInterval[] = [];
      for (const [calId, info] of Object.entries(res.calendars ?? {})) {
        for (const slot of info.busy ?? []) {
          const startMs = Date.parse(slot.start);
          const endMs = Date.parse(slot.end);
          if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;
          // 24h+ blocks count as full-day unavailable (ADR-241 § 2.2).
          const allDay = endMs - startMs >= 23.5 * 3600_000;
          out.push({
            starts_at: new Date(startMs).toISOString(),
            ends_at: new Date(endMs).toISOString(),
            all_day: allDay,
            source_calendar_id: calId,
          });
        }
      }
      return out;
    },

    async ensureWatch(hourCalendarId: string, webhookUrl: string): Promise<WatchRegistration | null> {
      const channelId = crypto.randomUUID();
      const rawToken = randomCalendarToken(24);
      const tokenHash = await sha256Hex(rawToken);
      try {
        const res = await call<{ id: string; resourceId: string; expiration?: string }>(
          `/calendars/${encodeURIComponent(hourCalendarId)}/events/watch`,
          {
            method: 'POST',
            body: JSON.stringify({
              id: channelId,
              type: 'web_hook',
              address: webhookUrl,
              token: rawToken,
            }),
          },
        );
        const expMs = res.expiration ? Number(res.expiration) : Date.now() + 6 * 86_400_000;
        return {
          channelId: res.id,
          resourceId: res.resourceId,
          tokenHash,
          expiresAt: new Date(expMs).toISOString(),
        };
      } catch {
        // Watch channels require a verified domain; periodic polling stays active regardless.
        return null;
      }
    },

    async revoke(): Promise<void> {
      try {
        await fetchFn(REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: opts.refreshToken }),
        });
      } catch {
        // Best-effort revoke.
      }
    },
  };
}
