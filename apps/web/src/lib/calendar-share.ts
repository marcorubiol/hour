/**
 * Calendar feed links (ADR-054): what a link shows and how one is asked for.
 *
 * `scope` (90, 20261102160000): `all` is the whole space, as every link was
 * before; `mine` is only what is the creator's own (cast, crew or «voy»,
 * ADR-151), read again on every poll. The database checks it too
 * (`calendar_share_scope_check`, `create_calendar_share`).
 */

import * as v from 'valibot';

export const CALENDAR_SHARE_SCOPES = ['all', 'mine'] as const;
export type CalendarShareScope = (typeof CALENDAR_SHARE_SCOPES)[number];

/** POST /api/calendar-shares body. No scope is the whole space. */
export const CalendarShareCreateSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  scope: v.optional(v.picklist(CALENDAR_SHARE_SCOPES), 'all'),
});

/** A feed link as `/api/calendar-shares` returns it. */
export interface CalendarShare {
  id: string;
  token: string;
  workspace_id: string;
  created_at: string;
  scope: CalendarShareScope;
}

/** A row from `list_calendar_shares` / `create_calendar_share`; a row older than the column reads as `all`. */
export function toCalendarShare(s: {
  id: string;
  token: string;
  workspace_id: string;
  created_at: string;
  scope?: string | null;
}): CalendarShare {
  return {
    id: s.id,
    token: s.token,
    workspace_id: s.workspace_id,
    created_at: s.created_at,
    scope: s.scope === 'mine' ? 'mine' : 'all',
  };
}
