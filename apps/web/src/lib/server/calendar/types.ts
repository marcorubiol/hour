/**
 * Shared types for the calendar sync engine and its two adapters (Apple CalDAV
 * and Google Calendar API v3) — ADR-241 Fases 2-5.
 *
 * Only relative imports: bundled by wrangler for `src/worker-cron.ts`.
 */

import type { CalendarAlarmMode, CalendarEvent, PersonalCalendarFeed } from '../../calendar-events';

export type CalendarProvider = 'icloud' | 'google';
export type FetchFn = typeof fetch;

export interface CalendarSyncEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CALENDAR_TOKEN_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  PUBLIC_APP_ORIGIN?: string;
}

export function calendarSyncConfigured(env: Partial<CalendarSyncEnv> | undefined | null): env is CalendarSyncEnv & {
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CALENDAR_TOKEN_KEY: string;
} {
  return Boolean(env?.PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.CALENDAR_TOKEN_KEY);
}

export function googleCalendarConfigured(env: Partial<CalendarSyncEnv> | undefined | null): env is CalendarSyncEnv & {
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CALENDAR_TOKEN_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
} {
  return Boolean(
    calendarSyncConfigured(env) && env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

export interface RemoteCalendar {
  id: string;
  name: string;
  color?: string | null;
  primary?: boolean;
}

export interface CalendarConnectionRow {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  account_email: string;
  credentials_ciphertext: string;
  key_version: number;
  hour_calendar_id: string | null;
  principal_url: string | null;
  calendar_home_url: string | null;
  sync_cursor: string | null;
  busy_calendar_ids: string[];
  available_calendars: RemoteCalendar[];
  alarm_mode: CalendarAlarmMode;
  status: 'ok' | 'paused';
  dirty: boolean;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expires_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface CalendarEventLinkRow {
  id: string;
  connection_id: string;
  uid: string;
  entity_kind: 'performance' | 'date';
  entity_id: string;
  remote_id: string;
  remote_etag: string | null;
  fingerprint: string;
  sequence: number;
  last_start_at: string | null;
  last_end_at: string | null;
  last_all_day: boolean;
}

export interface RemoteEventSummary {
  /** Hour UID if known (from href or extendedProperties). */
  uid: string | null;
  remoteId: string;
  etag: string | null;
}

export interface RemoteEventTiming {
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  etag: string | null;
}

export interface BusyInterval {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  source_calendar_id: string;
}

export interface DiscoveryResult {
  hourCalendarId: string;
  principalUrl?: string | null;
  calendarHomeUrl?: string | null;
  availableCalendars: RemoteCalendar[];
}

export interface WatchRegistration {
  channelId: string;
  resourceId: string;
  tokenHash: string;
  expiresAt: string;
}

export class CalendarAuthError extends Error {
  constructor(message = 'auth_failed') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export class CalendarProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarProviderError';
  }
}

export interface CalendarAdapter {
  readonly provider: CalendarProvider;
  /** Discover or create the «Hour» calendar and list external calendars for Fase 3. */
  ensureCalendar(): Promise<DiscoveryResult>;
  /** List remote events currently inside the «Hour» calendar. */
  listHourEvents(hourCalendarId: string): Promise<{ items: RemoteEventSummary[]; syncCursor: string | null }>;
  /** Read timing of one remote event (used only for Fase 4 date-change proposals). */
  getEventTiming(hourCalendarId: string, remoteId: string): Promise<RemoteEventTiming | null>;
  /** Create or update one Hour event in the «Hour» calendar. */
  putEvent(
    hourCalendarId: string,
    event: CalendarEvent,
    existing: { remoteId: string; etag: string | null } | null,
    now: Date,
  ): Promise<{ remoteId: string; etag: string | null }>;
  /** Delete one event from the «Hour» calendar. */
  deleteEvent(hourCalendarId: string, remoteId: string): Promise<void>;
  /** Delete the entire «Hour» calendar on disconnect. */
  deleteHourCalendar(hourCalendarId: string): Promise<void>;
  /** Fetch busy intervals from selected non-Hour calendars (NO titles, NO locations). */
  fetchBusy(calendarIds: string[], from: Date, to: Date): Promise<BusyInterval[]>;
  /** Optional: ensure push watch channel (Google Fase 5). */
  ensureWatch?(hourCalendarId: string, webhookUrl: string): Promise<WatchRegistration | null>;
  /** Optional: revoke OAuth token on disconnect (Google Fase 5). */
  revoke?(): Promise<void>;
}

export interface CalendarSyncDb {
  claim(limit: number, dirtyOnly: boolean, connectionId?: string): Promise<CalendarConnectionRow[]>;
  secretForUser(connectionId: string, userId: string): Promise<CalendarConnectionRow | null>;
  deleteConnection(connectionId: string, userId: string): Promise<boolean>;
  userPayload(userId: string, alarmMode: CalendarAlarmMode): Promise<PersonalCalendarFeed>;
  links(connectionId: string): Promise<CalendarEventLinkRow[]>;
  upsertLink(args: {
    connectionId: string;
    uid: string;
    entityKind: 'performance' | 'date';
    entityId: string;
    remoteId: string;
    remoteEtag: string | null;
    fingerprint: string;
    sequence: number;
    lastStartAt: string | null;
    lastEndAt: string | null;
    lastAllDay: boolean;
  }): Promise<void>;
  deleteLink(connectionId: string, uid: string): Promise<void>;
  replaceBusy(connectionId: string, intervals: BusyInterval[]): Promise<number>;
  upsertProposal(args: {
    connectionId: string;
    dateId: string;
    remoteEtag: string | null;
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
  }): Promise<boolean>;
  finish(
    connectionId: string,
    args: {
      status: 'ok' | 'paused';
      syncCursor: string | null;
      hourCalendarId: string | null;
      availableCalendars: RemoteCalendar[] | null;
      error: string | null;
      clearDirty: boolean;
    },
  ): Promise<void>;
  saveWatch(connectionId: string, watch: WatchRegistration): Promise<void>;
  markDirtyByWatch(channelId: string, tokenHash: string): Promise<string | null>;
}
