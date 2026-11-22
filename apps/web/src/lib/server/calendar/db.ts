/**
 * Service-role DB gateway for the calendar sync Worker (ADR-241 Fases 2-5).
 *
 * Calls ONLY the `calendar_*` RPCs granted to `service_role` in migration
 * `20261122120000_calendar_sync.sql`. Only relative imports (bundled into
 * `src/worker-cron.ts`).
 */

import type { PersonalCalendarFeed } from '../../calendar-events';
import type {
  CalendarConnectionRow,
  CalendarEventLinkRow,
  CalendarSyncDb,
  CalendarSyncEnv,
  FetchFn,
} from './types';

class CalendarDbError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`calendar db ${status}: ${body.slice(0, 200)}`);
  }
}

export function serviceCalendarDb(
  env: CalendarSyncEnv & { SUPABASE_SERVICE_ROLE_KEY: string },
  fetchFn: FetchFn = fetch,
): CalendarSyncDb {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers: Record<string, string> = {
    apikey: key,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
  };

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(new URL(`/rest/v1/rpc/${name}`, env.PUBLIC_SUPABASE_URL).toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) throw new CalendarDbError(res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    claim: (limit, dirtyOnly, connectionId) =>
      rpc<CalendarConnectionRow[]>('calendar_sync_claim', {
        p_limit: limit,
        p_dirty_only: dirtyOnly,
        ...(connectionId ? { p_connection_id: connectionId } : {}),
      }),
    secretForUser: async (connectionId, userId) =>
      (
        await rpc<CalendarConnectionRow[]>('calendar_connection_secret_for_user', {
          p_connection_id: connectionId,
          p_user_id: userId,
        })
      )[0] ?? null,
    deleteConnection: (connectionId, userId) =>
      rpc<boolean>('calendar_delete_connection_service', {
        p_connection_id: connectionId,
        p_user_id: userId,
      }),
    userPayload: (userId, alarmMode) =>
      rpc<PersonalCalendarFeed>('calendar_user_payload', {
        p_user_id: userId,
        p_alarm_mode: alarmMode,
      }),
    links: (connectionId) =>
      rpc<CalendarEventLinkRow[]>('calendar_connection_links', {
        p_connection_id: connectionId,
      }),
    upsertLink: async (a) => {
      await rpc('calendar_upsert_event_link', {
        p_connection_id: a.connectionId,
        p_uid: a.uid,
        p_entity_kind: a.entityKind,
        p_entity_id: a.entityId,
        p_remote_id: a.remoteId,
        p_remote_etag: a.remoteEtag,
        p_fingerprint: a.fingerprint,
        p_sequence: a.sequence,
        p_last_start_at: a.lastStartAt,
        p_last_end_at: a.lastEndAt,
        p_last_all_day: a.lastAllDay,
      });
    },
    deleteLink: async (connectionId, uid) => {
      await rpc('calendar_delete_event_link', { p_connection_id: connectionId, p_uid: uid });
    },
    replaceBusy: (connectionId, intervals) =>
      rpc<number>('calendar_replace_busy', {
        p_connection_id: connectionId,
        p_intervals: intervals,
      }),
    upsertProposal: (a) =>
      rpc<boolean>('calendar_upsert_proposal', {
        p_connection_id: a.connectionId,
        p_date_id: a.dateId,
        p_remote_etag: a.remoteEtag,
        p_starts_at: a.startsAt,
        p_ends_at: a.endsAt,
        p_all_day: a.allDay,
      }),
    finish: async (connectionId, a) => {
      await rpc('calendar_sync_finish', {
        p_connection_id: connectionId,
        p_status: a.status,
        p_sync_cursor: a.syncCursor,
        p_hour_calendar_id: a.hourCalendarId,
        p_available_calendars: a.availableCalendars,
        p_error: a.error,
        p_clear_dirty: a.clearDirty,
      });
    },
    saveWatch: async (connectionId, w) => {
      await rpc('calendar_watch_save', {
        p_connection_id: connectionId,
        p_channel_id: w.channelId,
        p_resource_id: w.resourceId,
        p_token_hash: w.tokenHash,
        p_expires_at: w.expiresAt,
      });
    },
    markDirtyByWatch: (channelId, tokenHash) =>
      rpc<string | null>('calendar_mark_dirty_by_watch', {
        p_channel_id: channelId,
        p_token_hash: tokenHash,
      }),
  };
}
