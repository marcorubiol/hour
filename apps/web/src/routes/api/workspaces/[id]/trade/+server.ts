/**
 * El oficio del espacio (ADR-128): con qué palabras habla la app en él.
 *
 * GET → { trade, booking_mode, can_edit }: `booking_mode` is the convention the
 *     space speaks (stored, or its trade's, `$lib/booking-mode`). The setting
 *     lives under the trade in Ajustes (tarea 140) and is written by
 *     `PATCH /api/workspaces/[id]`.
 * PUT { trade } → lo cambia un owner/admin por `update_workspace`; a los
 *     demás, 403.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { TRADES } from '$lib/i18n/trade.svelte';
import { bookingModeOf } from '$lib/booking-mode';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const BodySchema = v.object({ trade: v.picklist(TRADES) });

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  try {
    const [ws, admin] = await Promise.all([
      pgGet<{ trade: string; booking_mode: string | null }>(env, 'workspace', jwt, {
        search: { select: 'trade,booking_mode:settings->>booking_mode', id: `eq.${params.id}` },
      }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: params.id }),
    ]);
    const row = ws.data[0];
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({
      trade: row.trade,
      booking_mode: bookingModeOf(row),
      can_edit: admin.data[0] === true,
    });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/workspaces/[id]/trade', requestId: locals.requestId });
  }
};

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  try {
    const { data } = await pgPostRpc<{ trade: string }>(env, 'update_workspace', jwt, {
      p_workspace_id: params.id,
      p_patch: { trade: parsed.output.trade },
    });
    if (!data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ trade: data[0].trade });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/workspaces/[id]/trade', requestId: locals.requestId },
      {
        codes: {
          '23514': { status: 400, error: 'rpc_error' },
          '42501': { status: 403, error: 'forbidden' },
          P0002: { status: 404, error: 'not_found' },
        },
        passUpstream: [],
      },
    );
  }
};
