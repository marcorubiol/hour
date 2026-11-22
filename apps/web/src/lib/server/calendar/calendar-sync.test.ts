import { describe, expect, it, vi } from 'vitest';
import {
  calendarCredentialAad,
  decryptCalendarSecret,
  encryptCalendarSecret,
  importCalendarKey,
  toBase64Url,
} from './crypto';
import { expandTimingToBusy, parseIcsTimings } from './ics-parse';
import { eventToGoogleBody, googleCalendarAuthUrl, hasCalendarScopes } from './google';
import { syncConnection, type CalendarEngineDeps } from './engine';
import {
  CalendarAuthError,
  type CalendarAdapter,
  type CalendarConnectionRow,
  type CalendarEventLinkRow,
  type CalendarSyncDb,
} from './types';
import { buildPersonalEvents, type PersonalCalendarFeed } from '../../calendar-events';

async function testKey(): Promise<CryptoKey> {
  const raw = new Uint8Array(32).fill(7);
  return importCalendarKey(toBase64Url(raw));
}

function baseConn(overrides: Partial<CalendarConnectionRow> = {}): CalendarConnectionRow {
  return {
    id: 'conn-1',
    user_id: 'user-1',
    provider: 'icloud',
    account_email: 'marco@example.test',
    credentials_ciphertext: '',
    key_version: 1,
    hour_calendar_id: 'https://caldav.icloud.com/123/calendars/hour/',
    principal_url: 'https://caldav.icloud.com/123/principal/',
    calendar_home_url: 'https://caldav.icloud.com/123/calendars/',
    sync_cursor: null,
    busy_calendar_ids: ['https://caldav.icloud.com/123/calendars/personal/'],
    available_calendars: [{ id: 'https://caldav.icloud.com/123/calendars/personal/', name: 'Personal' }],
    alarm_mode: 'none',
    status: 'ok',
    dirty: true,
    watch_channel_id: null,
    watch_resource_id: null,
    watch_expires_at: null,
    last_synced_at: null,
    last_error: null,
    ...overrides,
  };
}

function sampleFeed(): PersonalCalendarFeed {
  return {
    alarm_mode: 'none',
    locale: 'es',
    performances: [
      {
        id: '0197f000-0000-7000-8000-000000000001',
        slug: 'teatre-x-2026-12-10',
        performed_at: '2026-12-10',
        status: 'confirmed',
        venue_name: 'Teatre X',
        city: 'Barcelona',
        country: 'ES',
        load_in_at: '2026-12-10T14:00:00Z',
        soundcheck_at: null,
        start_at: '2026-12-10T19:00:00Z',
        loadout_at: null,
        wrap_at: '2026-12-10T22:00:00Z',
        updated_at: '2026-11-22T10:00:00Z',
        unanswered: false,
        schedule: null,
        workspace: { id: 'ws-1', name: 'MüK Cia', slug: 'muk-cia', timezone: 'Europe/Madrid', trade: 'stage' },
        project: { name: 'MaMeMi' },
        venue: null,
      },
    ],
    dates: [
      {
        id: '0197f000-0000-7000-8000-000000000002',
        kind: 'rehearsal',
        status: 'confirmed',
        title: 'Ensayo',
        starts_at: '2026-12-09T10:00:00Z',
        ends_at: '2026-12-09T13:00:00Z',
        all_day: false,
        venue_name: 'Nau',
        city: 'Barcelona',
        updated_at: '2026-11-22T10:00:00Z',
        workspace: { id: 'ws-1', name: 'MüK Cia', slug: 'muk-cia', timezone: 'Europe/Madrid', trade: 'stage' },
        project: { name: 'MaMeMi' },
        stages: [],
      },
    ],
  };
}

describe('calendar crypto (AES-256-GCM)', () => {
  it('encrypts and decrypts bound to AAD and rejects tampered AAD', async () => {
    const key = await testKey();
    const aad = calendarCredentialAad('u1', 'icloud', 'marco@example.test');
    const sealed = await encryptCalendarSecret(key, '{"appPassword":"secret"}', aad);
    expect(sealed).not.toContain('secret');
    expect(await decryptCalendarSecret(key, sealed, aad)).toBe('{"appPassword":"secret"}');
    await expect(
      decryptCalendarSecret(key, sealed, calendarCredentialAad('u2', 'icloud', 'marco@example.test')),
    ).rejects.toThrow();
  });
});

describe('ics-parse (Fase 3 busy + RRULE expansion)', () => {
  it('expands weekly recurring events, honors EXDATE, skips TRANSPARENT, and extracts zero titles', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:dentist@test',
      'SUMMARY:Secret Medical Appointment',
      'LOCATION:Private Clinic',
      'DTSTART:20261201T090000Z',
      'DTEND:20261201T100000Z',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'EXDATE:20261208T090000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:free@test',
      'DTSTART;VALUE=DATE:20261205',
      'DTEND;VALUE=DATE:20261206',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const timings = parseIcsTimings(ics);
    expect(timings).toHaveLength(2);
    // Security: no title/location field exists on ParsedVEventTiming
    expect(JSON.stringify(timings)).not.toContain('Secret Medical');
    expect(JSON.stringify(timings)).not.toContain('Private Clinic');

    const winStart = new Date('2026-11-30T00:00:00Z');
    const winEnd = new Date('2026-12-31T00:00:00Z');
    const busy = timings.flatMap((t) => expandTimingToBusy(t, winStart, winEnd));
    // Dec 1 and Dec 15 (Dec 8 excluded by EXDATE; Dec 5 skipped as TRANSPARENT)
    expect(busy).toHaveLength(2);
    expect(busy[0].starts_at).toBe('2026-12-01T09:00:00.000Z');
    expect(busy[1].starts_at).toBe('2026-12-15T09:00:00.000Z');
  });
});

describe('google calendar adapter helpers (Fase 5)', () => {
  it('builds minimal consent URL and maps neutral CalendarEvent to Google JSON', () => {
    const url = googleCalendarAuthUrl({
      clientId: 'cid',
      redirectUri: 'https://hour.zerosense.studio/api/calendar/oauth/google/callback',
      state: 'st',
      codeChallenge: 'cc',
    });
    expect(url).toContain('calendar.app.created');
    expect(url).toContain('calendar.freebusy');
    expect(url).toContain('calendar.calendarlist.readonly');
    expect(url).not.toContain('gmail');
    expect(hasCalendarScopes('https://www.googleapis.com/auth/calendar.app.created')).toBe(true);
    expect(hasCalendarScopes('https://www.googleapis.com/auth/userinfo.email')).toBe(false);

    const [ev] = buildPersonalEvents(sampleFeed(), { locale: 'es', origin: 'https://hour.zerosense.studio', alarm: '2h_before' });
    const g = eventToGoogleBody(ev);
    expect(g.summary).toBe('MaMeMi · Teatre X · 20h');
    expect(g.status).toBe('confirmed');
    expect(g.transparency).toBe('opaque');
    expect((g.reminders as { overrides: Array<{ minutes: number }> }).overrides[0].minutes).toBe(120);
    expect((g.extendedProperties as { private: { hourUid: string } }).private.hourUid).toBe(ev.uid);
  });
});

describe('syncConnection engine (Fases 2, 3, 4)', () => {
  function makeInMemory(initialLinks: CalendarEventLinkRow[] = [], feed = sampleFeed()) {
    const links = new Map(initialLinks.map((l) => [l.uid, { ...l }]));
    const proposals: Array<{ dateId: string; startsAt: string }> = [];
    const busyStored: unknown[] = [];
    let lastFinish: Record<string, unknown> | null = null;

    const db: CalendarSyncDb = {
      claim: async () => [],
      secretForUser: async () => null,
      deleteConnection: async () => true,
      userPayload: async () => feed,
      links: async () => [...links.values()],
      upsertLink: async (a) => {
        links.set(a.uid, {
          id: `link-${a.uid}`,
          connection_id: a.connectionId,
          uid: a.uid,
          entity_kind: a.entityKind,
          entity_id: a.entityId,
          remote_id: a.remoteId,
          remote_etag: a.remoteEtag,
          fingerprint: a.fingerprint,
          sequence: a.sequence,
          last_start_at: a.lastStartAt,
          last_end_at: a.lastEndAt,
          last_all_day: a.lastAllDay,
        });
      },
      deleteLink: async (_cid, uid) => {
        links.delete(uid);
      },
      replaceBusy: async (_cid, intervals) => {
        busyStored.splice(0, busyStored.length, ...intervals);
        return intervals.length;
      },
      upsertProposal: async (a) => {
        proposals.push({ dateId: a.dateId, startsAt: a.startsAt });
        return true;
      },
      finish: async (_cid, a) => {
        lastFinish = a as unknown as Record<string, unknown>;
      },
      saveWatch: async () => {},
      markDirtyByWatch: async () => null,
    };

    return { db, links, proposals, busyStored, getFinish: () => lastFinish };
  }

  it('creates events, skips unchanged on second pass, restores deleted Hour event, and proposes moved date (Fase 4)', async () => {
    const key = await testKey();
    const conn = baseConn();
    conn.credentials_ciphertext = await encryptCalendarSecret(
      key,
      JSON.stringify({ appleId: 'marco@example.test', appPassword: 'abcd-efgh-ijkl-mnop' }),
      calendarCredentialAad(conn.user_id, conn.provider, conn.account_email),
    );

    const remoteStore = new Map<string, { uid: string; etag: string; startsAt: string; endsAt: string | null }>();
    let etagSeq = 0;

    const adapter: CalendarAdapter = {
      provider: 'icloud',
      ensureCalendar: async () => ({
        hourCalendarId: conn.hour_calendar_id!,
        availableCalendars: conn.available_calendars,
      }),
      listHourEvents: async () => ({
        items: [
          ...[...remoteStore.entries()].map(([remoteId, r]) => ({ uid: r.uid, remoteId, etag: r.etag })),
          // Manual event created by the user inside «Hour» — Hour must NEVER delete it!
          { uid: 'user-manual@apple', remoteId: 'remote-manual', etag: 'e-manual' },
        ],
        syncCursor: 'tok-1',
      }),
      getEventTiming: async (_cal, remoteId) => {
        const r = remoteStore.get(remoteId);
        return r ? { startsAt: r.startsAt, endsAt: r.endsAt, allDay: false, etag: r.etag } : null;
      },
      putEvent: async (_cal, event, existing) => {
        etagSeq++;
        const remoteId = existing?.remoteId ?? `remote-${event.uid}`;
        const etag = `etag-${etagSeq}`;
        remoteStore.set(remoteId, {
          uid: event.uid,
          etag,
          startsAt: event.startUtc ?? `${event.startDate}T00:00:00.000Z`,
          endsAt: event.endUtc ?? null,
        });
        return { remoteId, etag };
      },
      deleteEvent: vi.fn(async (_cal, remoteId) => {
        remoteStore.delete(remoteId);
      }),
      deleteHourCalendar: vi.fn(async () => {}),
      fetchBusy: async () => [
        {
          starts_at: '2026-12-12T00:00:00.000Z',
          ends_at: '2026-12-13T00:00:00.000Z',
          all_day: true,
          source_calendar_id: conn.busy_calendar_ids[0],
        },
      ],
    };

    const mem = makeInMemory();
    const deps: CalendarEngineDeps = {
      db: mem.db,
      key,
      origin: 'https://hour.zerosense.studio',
      makeAdapter: () => adapter,
      now: () => new Date('2026-11-22T23:00:00Z'),
    };

    // Pass 1: creates 1 performance + 1 date and pulls 1 busy day
    const r1 = await syncConnection(deps, conn);
    expect(r1.status).toBe('ok');
    expect(r1.created).toBe(2);
    expect(r1.updated).toBe(0);
    expect(r1.busyCount).toBe(1);
    expect(mem.links.size).toBe(2);

    // Pass 2: identical state → zero writes (no echo loop)
    const r2 = await syncConnection(deps, conn);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(0);
    expect(r2.deleted).toBe(0);
    expect(r2.proposals).toBe(0);

    // Pass 3: user deletes the performance in Apple Calendar AND moves the rehearsal to 17h
    const perfUid = 'perf-0197f000-0000-7000-8000-000000000001@hour.zerosense.studio';
    const dateUid = 'date-0197f000-0000-7000-8000-000000000002@hour.zerosense.studio';
    remoteStore.delete(`remote-${perfUid}`);
    remoteStore.set(`remote-${dateUid}`, {
      uid: dateUid,
      etag: 'etag-user-moved',
      startsAt: '2026-12-09T16:00:00.000Z',
      endsAt: '2026-12-09T19:00:00.000Z',
    });

    const r3 = await syncConnection(deps, conn);
    // Performance is restored; rehearsal move becomes a Fase 4 proposal!
    expect(r3.created).toBe(1);
    expect(r3.proposals).toBe(1);
    expect(mem.proposals).toEqual([
      { dateId: '0197f000-0000-7000-8000-000000000002', startsAt: '2026-12-09T16:00:00.000Z' },
    ]);
    // Manual event untouched
    expect(adapter.deleteEvent).not.toHaveBeenCalledWith(expect.anything(), 'remote-manual');
  });

  it('pauses the connection cleanly on CalendarAuthError', async () => {
    const key = await testKey();
    const conn = baseConn();
    conn.credentials_ciphertext = await encryptCalendarSecret(
      key,
      JSON.stringify({ appleId: 'marco@example.test', appPassword: 'revoked-password' }),
      calendarCredentialAad(conn.user_id, conn.provider, conn.account_email),
    );
    const mem = makeInMemory();
    const deps: CalendarEngineDeps = {
      db: mem.db,
      key,
      origin: 'https://hour.zerosense.studio',
      makeAdapter: () => ({
        provider: 'icloud',
        ensureCalendar: async () => {
          throw new CalendarAuthError('caldav_auth_401');
        },
        listHourEvents: async () => ({ items: [], syncCursor: null }),
        getEventTiming: async () => null,
        putEvent: async () => ({ remoteId: '', etag: null }),
        deleteEvent: async () => {},
        deleteHourCalendar: async () => {},
        fetchBusy: async () => [],
      }),
    };

    const res = await syncConnection(deps, conn);
    expect(res.status).toBe('paused');
    expect(res.error).toBe('auth_failed');
    expect(mem.getFinish()?.status).toBe('paused');
  });
});
