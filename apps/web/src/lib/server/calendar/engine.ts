/**
 * Motor único de sincronización de calendarios (ADR-241 Fases 2-5).
 *
 * Mismo motor para Apple Calendar (CalDAV) y Google Calendar (API v3):
 *   1. Descifra las credenciales con `CALENDAR_TOKEN_KEY` y AAD atado a la fila.
 *   2. Asegura el calendario «Hour» y refresca la lista de calendarios externos.
 *   3. Proyecta los eventos de la persona (`buildPersonalEvents`, idéntico al `.ics`).
 *   4. Compara contra `calendar_event_link` + estado remoto real en «Hour»:
 *      · Nuevo o borrado en remoto → crear (`putEvent`), guardar link.
 *      · Huella cambiada en Hour → actualizar (`putEvent`, sube `sequence`).
 *      · Eliminado/cancelado/«no puedo» en Hour → borrar en remoto (`deleteEvent`).
 *      · Editado en remoto (ETag distinto, huella de Hour igual):
 *          - Si es una **fecha** (`date-*`) y cambiaron sus horas → crear/actualizar
 *            propuesta en «Te espera» (`calendar_change_proposal`, Fase 4) sin pisarla
 *            hasta que la persona pulse Aplicar o Descartar.
 *          - Si es una **función** (`perf-*`) o no aplica propuesta → Hour gana y
 *            repone el evento original.
 *   5. Fase 3: lee ocupado de `busy_calendar_ids` (-7 días a +180 días, nunca
 *      títulos ni lugares) y reemplaza `calendar_busy`.
 *   6. Fase 5: si es Google y el canal `watch` falta o caduca en <24h, lo renueva.
 *   7. Si falla la autenticación (401/403/`invalid_grant`) → marca `status = 'paused'`
 *      (`last_error = 'auth_failed'`), que pinta una sola fila «Reconectar» en «Te espera».
 *
 * Solo imports relativos: empaquetado también por wrangler (`src/worker-cron.ts`).
 */

import { buildPersonalEvents, eventFingerprint, type CalendarEvent } from '../../calendar-events';
import { LOCALES, type Locale } from '../../i18n';
import { caldavAdapter, type CalDavCredentials } from './caldav';
import { calendarCredentialAad, decryptCalendarSecret, importCalendarKey } from './crypto';
import { serviceCalendarDb } from './db';
import { googleCalendarAdapter } from './google';
import {
  CalendarAuthError,
  calendarSyncConfigured,
  type CalendarAdapter,
  type CalendarConnectionRow,
  type CalendarSyncDb,
  type CalendarSyncEnv,
  type FetchFn,
} from './types';

const BUSY_BACK_MS = 7 * 86_400_000;
const BUSY_AHEAD_MS = 180 * 86_400_000;
const WATCH_RENEW_MARGIN_MS = 24 * 3600_000;
const DEFAULT_ORIGIN = 'https://hour.zerosense.studio';

export interface CalendarSyncResult {
  connectionId: string;
  provider: 'icloud' | 'google';
  status: 'ok' | 'paused';
  created: number;
  updated: number;
  deleted: number;
  proposals: number;
  busyCount: number;
  error: string | null;
}

export interface CalendarEngineDeps {
  db: CalendarSyncDb;
  key: CryptoKey;
  origin: string;
  makeAdapter: (conn: CalendarConnectionRow, plainJson: string) => CalendarAdapter;
  now?: () => Date;
}

function resolveLocale(raw: string | null | undefined): Locale {
  return raw && (LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : 'es';
}

function eventTimingKey(e: CalendarEvent): { start: string | null; end: string | null; allDay: boolean } {
  if (e.startUtc) return { start: e.startUtc, end: e.endUtc ?? null, allDay: false };
  return { start: e.startDate ?? null, end: e.endDate ?? null, allDay: true };
}

function timingsDiffer(
  last: { last_start_at: string | null; last_end_at: string | null; last_all_day: boolean },
  remote: { startsAt: string; endsAt: string | null; allDay: boolean },
): boolean {
  if (last.last_all_day !== remote.allDay) return true;
  if (remote.allDay) {
    return (last.last_start_at ?? '').slice(0, 10) !== remote.startsAt.slice(0, 10);
  }
  const aStart = last.last_start_at ? Date.parse(last.last_start_at) : NaN;
  const bStart = Date.parse(remote.startsAt);
  if (Math.abs(aStart - bStart) > 60_000) return true;
  const aEnd = last.last_end_at ? Date.parse(last.last_end_at) : NaN;
  const bEnd = remote.endsAt ? Date.parse(remote.endsAt) : NaN;
  if (!Number.isNaN(aEnd) && !Number.isNaN(bEnd) && Math.abs(aEnd - bEnd) > 60_000) return true;
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200) || err.name;
  return 'unknown_error';
}

export async function syncConnection(
  deps: CalendarEngineDeps,
  conn: CalendarConnectionRow,
): Promise<CalendarSyncResult> {
  const now = deps.now?.() ?? new Date();
  const counts = { created: 0, updated: 0, deleted: 0, proposals: 0, busyCount: 0 };

  let plainCreds: string;
  try {
    plainCreds = await decryptCalendarSecret(
      deps.key,
      conn.credentials_ciphertext,
      calendarCredentialAad(conn.user_id, conn.provider, conn.account_email),
    );
  } catch {
    await deps.db.finish(conn.id, {
      status: 'paused',
      syncCursor: null,
      hourCalendarId: null,
      availableCalendars: null,
      error: 'credentials_unreadable',
      clearDirty: false,
    });
    return { connectionId: conn.id, provider: conn.provider, status: 'paused', ...counts, error: 'credentials_unreadable' };
  }

  let adapter: CalendarAdapter;
  try {
    adapter = deps.makeAdapter(conn, plainCreds);
  } catch (err) {
    const msg = errorMessage(err);
    await deps.db.finish(conn.id, {
      status: 'paused',
      syncCursor: null,
      hourCalendarId: null,
      availableCalendars: null,
      error: msg,
      clearDirty: false,
    });
    return { connectionId: conn.id, provider: conn.provider, status: 'paused', ...counts, error: msg };
  }

  try {
    const discovery = await adapter.ensureCalendar();
    const hourCalendarId = discovery.hourCalendarId;

    const [payload, links, remoteList] = await Promise.all([
      deps.db.userPayload(conn.user_id, conn.alarm_mode),
      deps.db.links(conn.id),
      adapter.listHourEvents(hourCalendarId),
    ]);

    const events = buildPersonalEvents(payload, {
      locale: resolveLocale(payload.locale),
      origin: deps.origin,
      alarm: conn.alarm_mode,
    });

    const linkByUid = new Map(links.map((l) => [l.uid, l]));
    const remoteByUid = new Map<string, { remoteId: string; etag: string | null }>();
    const remoteById = new Map<string, { remoteId: string; etag: string | null }>();
    for (const r of remoteList.items) {
      if (r.uid) remoteByUid.set(r.uid, { remoteId: r.remoteId, etag: r.etag });
      remoteById.set(r.remoteId, { remoteId: r.remoteId, etag: r.etag });
    }

    const desiredUids = new Set<string>();

    for (const event of events) {
      desiredUids.add(event.uid);
      const link = linkByUid.get(event.uid) ?? null;
      const remote = (link ? remoteById.get(link.remote_id) : null) ?? remoteByUid.get(event.uid) ?? null;
      const fp = await eventFingerprint(event);
      const timing = eventTimingKey(event);

      // Case 1: missing remotely (first write or user deleted an Hour event → restore it!)
      if (!link || !remote) {
        const seq = link ? link.sequence + 1 : 0;
        const written = await adapter.putEvent(hourCalendarId, { ...event, sequence: seq }, remote, now);
        await deps.db.upsertLink({
          connectionId: conn.id,
          uid: event.uid,
          entityKind: event.entityKind,
          entityId: event.entityId,
          remoteId: written.remoteId,
          remoteEtag: written.etag,
          fingerprint: fp,
          sequence: seq,
          lastStartAt: timing.start,
          lastEndAt: timing.end,
          lastAllDay: timing.allDay,
        });
        counts.created++;
        continue;
      }

      // Case 2: Hour changed (fingerprint differs) → Hour wins and overwrites remote.
      if (link.fingerprint !== fp) {
        const seq = link.sequence + 1;
        const written = await adapter.putEvent(hourCalendarId, { ...event, sequence: seq }, remote, now);
        await deps.db.upsertLink({
          connectionId: conn.id,
          uid: event.uid,
          entityKind: event.entityKind,
          entityId: event.entityId,
          remoteId: written.remoteId,
          remoteEtag: written.etag,
          fingerprint: fp,
          sequence: seq,
          lastStartAt: timing.start,
          lastEndAt: timing.end,
          lastAllDay: timing.allDay,
        });
        counts.updated++;
        continue;
      }

      // Case 3: Hour did NOT change, but remote ETag changed (user edited in Apple/Google!).
      if (remote.etag && link.remote_etag && remote.etag !== link.remote_etag) {
        // Fase 4: for dates (rehearsals, travel, etc.; NEVER performances), check if time moved
        // and surface a proposal in «Te espera» instead of silently overwriting.
        if (event.entityKind === 'date') {
          const remoteTiming = await adapter.getEventTiming(hourCalendarId, remote.remoteId);
          if (remoteTiming && timingsDiffer(link, remoteTiming)) {
            const createdProposal = await deps.db.upsertProposal({
              connectionId: conn.id,
              dateId: event.entityId,
              remoteEtag: remote.etag,
              startsAt: remoteTiming.startsAt,
              endsAt: remoteTiming.endsAt,
              allDay: remoteTiming.allDay,
            });
            if (createdProposal) {
              counts.proposals++;
              continue;
            }
          }
        }
        // Performances (or users without edit permission): Hour wins and restores its version.
        const seq = link.sequence + 1;
        const written = await adapter.putEvent(hourCalendarId, { ...event, sequence: seq }, remote, now);
        await deps.db.upsertLink({
          connectionId: conn.id,
          uid: event.uid,
          entityKind: event.entityKind,
          entityId: event.entityId,
          remoteId: written.remoteId,
          remoteEtag: written.etag,
          fingerprint: fp,
          sequence: seq,
          lastStartAt: timing.start,
          lastEndAt: timing.end,
          lastAllDay: timing.allDay,
        });
        counts.updated++;
      }
    }

    // Delete Hour-managed events that are no longer in the user's feed (cancelled, not_going, removed).
    // Never touch events created manually by the user inside «Hour» (not in `calendar_event_link`).
    for (const link of links) {
      if (desiredUids.has(link.uid)) continue;
      await adapter.deleteEvent(hourCalendarId, link.remote_id);
      await deps.db.deleteLink(conn.id, link.uid);
      counts.deleted++;
    }

    // Fase 3: read busy times from selected external calendars (zero titles, zero locations).
    const busyIds = Array.isArray(conn.busy_calendar_ids) ? conn.busy_calendar_ids.filter(Boolean) : [];
    const busyFrom = new Date(now.getTime() - BUSY_BACK_MS);
    const busyTo = new Date(now.getTime() + BUSY_AHEAD_MS);
    const intervals = busyIds.length > 0 ? await adapter.fetchBusy(busyIds, busyFrom, busyTo) : [];
    counts.busyCount = await deps.db.replaceBusy(conn.id, intervals);

    // Fase 5: ensure/renew Google push watch channel.
    if (adapter.ensureWatch) {
      const expMs = conn.watch_expires_at ? Date.parse(conn.watch_expires_at) : 0;
      if (!conn.watch_channel_id || expMs - now.getTime() < WATCH_RENEW_MARGIN_MS) {
        const watch = await adapter.ensureWatch(
          hourCalendarId,
          `${deps.origin}/api/calendar/google/webhook`,
        );
        if (watch) await deps.db.saveWatch(conn.id, watch);
      }
    }

    await deps.db.finish(conn.id, {
      status: 'ok',
      syncCursor: remoteList.syncCursor,
      hourCalendarId,
      availableCalendars: discovery.availableCalendars,
      error: null,
      clearDirty: true,
    });

    return { connectionId: conn.id, provider: conn.provider, status: 'ok', ...counts, error: null };
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      await deps.db.finish(conn.id, {
        status: 'paused',
        syncCursor: null,
        hourCalendarId: null,
        availableCalendars: null,
        error: 'auth_failed',
        clearDirty: false,
      });
      return { connectionId: conn.id, provider: conn.provider, status: 'paused', ...counts, error: 'auth_failed' };
    }
    const msg = errorMessage(err);
    await deps.db.finish(conn.id, {
      status: 'ok',
      syncCursor: null,
      hourCalendarId: null,
      availableCalendars: null,
      error: msg,
      clearDirty: false,
    });
    return { connectionId: conn.id, provider: conn.provider, status: 'ok', ...counts, error: msg };
  }
}

async function liveDeps(env: CalendarSyncEnv, fetchFn: FetchFn = fetch): Promise<CalendarEngineDeps | null> {
  if (!calendarSyncConfigured(env)) return null;
  const key = await importCalendarKey(env.CALENDAR_TOKEN_KEY);
  const db = serviceCalendarDb(env, fetchFn);
  const origin = env.PUBLIC_APP_ORIGIN || DEFAULT_ORIGIN;

  return {
    db,
    key,
    origin,
    makeAdapter(conn, plainJson) {
      if (conn.provider === 'icloud') {
        const creds = JSON.parse(plainJson) as CalDavCredentials;
        return caldavAdapter(fetchFn, creds, {
          principalUrl: conn.principal_url,
          calendarHomeUrl: conn.calendar_home_url,
          hourCalendarId: conn.hour_calendar_id,
        });
      }
      if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
        throw new Error('google_oauth_not_configured');
      }
      const { refreshToken } = JSON.parse(plainJson) as { refreshToken: string };
      return googleCalendarAdapter(fetchFn, {
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken,
        hourCalendarId: conn.hour_calendar_id,
      });
    },
  };
}

/**
 * Disconnect: deletes the remote «Hour» calendar, revokes OAuth token (Google),
 * and deletes the connection row (cascading links, busy times, and proposals).
 */
export async function disconnectCalendarConnection(
  env: CalendarSyncEnv,
  connectionId: string,
  userId: string,
  fetchFn: FetchFn = fetch,
): Promise<{ deleted: boolean; remoteDeleted: boolean }> {
  const deps = await liveDeps(env, fetchFn);
  if (!deps) return { deleted: false, remoteDeleted: false };

  const conn = await deps.db.secretForUser(connectionId, userId);
  if (!conn) return { deleted: false, remoteDeleted: false };

  let remoteDeleted = false;
  try {
    const plain = await decryptCalendarSecret(
      deps.key,
      conn.credentials_ciphertext,
      calendarCredentialAad(conn.user_id, conn.provider, conn.account_email),
    );
    const adapter = deps.makeAdapter(conn, plain);
    if (conn.hour_calendar_id) {
      await adapter.deleteHourCalendar(conn.hour_calendar_id);
      remoteDeleted = true;
    }
    if (adapter.revoke) await adapter.revoke();
  } catch {
    // Always allow disconnecting locally even if the user already revoked credentials externally.
  }

  const deleted = await deps.db.deleteConnection(connectionId, userId);
  return { deleted, remoteDeleted };
}

/** Runs one sync batch (used by both crons and «Sincronizar ahora»). */
export async function runCalendarSync(
  env: CalendarSyncEnv,
  opts: { dirtyOnly?: boolean; limit?: number; connectionId?: string } = {},
  fetchFn: FetchFn = fetch,
): Promise<CalendarSyncResult[]> {
  const deps = await liveDeps(env, fetchFn);
  if (!deps) return [];
  const claimed = await deps.db.claim(opts.limit ?? 3, opts.dirtyOnly ?? false, opts.connectionId);
  const results: CalendarSyncResult[] = [];
  for (const conn of claimed) {
    results.push(await syncConnection(deps, conn));
  }
  if (results.length > 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'calendar_sync',
        dirtyOnly: Boolean(opts.dirtyOnly),
        connections: results.length,
        created: results.reduce((n, r) => n + r.created, 0),
        updated: results.reduce((n, r) => n + r.updated, 0),
        deleted: results.reduce((n, r) => n + r.deleted, 0),
        proposals: results.reduce((n, r) => n + r.proposals, 0),
        errors: results.filter((r) => r.error).map((r) => ({ id: r.connectionId, error: r.error })),
      }),
    );
  }
  return results;
}
