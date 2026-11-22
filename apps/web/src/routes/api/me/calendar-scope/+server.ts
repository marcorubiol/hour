/**
 * Per-workspace personal calendar scope (ADR-241 Fase 1).
 *
 * PUT { workspace_id, calendar_scope: 'mine' | 'all' | 'none' | null }
 *   → `set_my_calendar_scope`, strictly on the caller's own accepted
 *     workspace membership. `null` follows `view_scope` (ADR-151).
 *
 * The read rides on GET /api/workspaces (`calendar_scope` on each item).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { CalendarScopePutSchema } from '$lib/personal-calendar';

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(CalendarScopePutSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  const { workspace_id, calendar_scope } = parsed.output;
  try {
    await pgPostRpc(env, 'set_my_calendar_scope', jwt, {
      p_workspace_id: workspace_id,
      p_scope: calendar_scope,
    });
    return jsonNoStore({ workspace_id, calendar_scope });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/me/calendar-scope', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};
