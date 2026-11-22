/**
 * GET /api/calendar/waiting — paused calendar connections (Fase 2) and pending
 * date-change proposals (Fase 4) for «Te espera».
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';

export interface CalendarWaitingPayload {
  paused: Array<{
    id: string;
    provider: 'icloud' | 'google';
    account_email: string;
    last_error: string | null;
    updated_at: string;
  }>;
  proposals: Array<{
    id: string;
    date_id: string;
    proposed_starts_at: string;
    proposed_ends_at: string | null;
    proposed_all_day: boolean;
    current_starts_at: string;
    current_ends_at: string | null;
    current_all_day: boolean;
    date_kind: string;
    date_title: string | null;
    workspace_id: string;
    project_id: string | null;
    project_name: string | null;
    workspace_timezone: string | null;
    created_at: string;
  }>;
}

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    const { data } = await pgPostRpc<CalendarWaitingPayload>(env, 'list_my_calendar_waiting', jwt, {});
    return jsonNoStore(data[0] ?? { paused: [], proposals: [] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/calendar/waiting', requestId: locals.requestId },
      { codes: { '42501': { status: 401, error: 'unauthorized' } } },
    );
  }
};
