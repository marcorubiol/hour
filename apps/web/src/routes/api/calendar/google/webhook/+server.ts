/**
 * POST /api/calendar/google/webhook — Google Calendar push channel notification
 * (ADR-241 Fase 5).
 *
 * Google sends only headers (`X-Goog-Channel-ID`, `X-Goog-Channel-Token`,
 * `X-Goog-Resource-State`). We verify `sha256(token)` against the stored
 * `watch_token_hash`, mark the connection dirty, and trigger an async sync pass.
 */

import type { RequestHandler } from './$types';
import { sha256Hex } from '$lib/server/calendar/crypto';
import { serviceCalendarDb } from '$lib/server/calendar/db';
import { runCalendarSync } from '$lib/server/calendar/engine';
import { calendarSyncConfigured, type CalendarSyncEnv } from '$lib/server/calendar/types';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env as unknown as CalendarSyncEnv | undefined;
  if (!calendarSyncConfigured(env)) return new Response(null, { status: 204 });

  const channelId = request.headers.get('x-goog-channel-id')?.trim();
  const token = request.headers.get('x-goog-channel-token')?.trim();
  const state = request.headers.get('x-goog-resource-state')?.trim();

  if (!channelId || !token) return new Response(null, { status: 400 });
  if (state === 'sync') return new Response(null, { status: 200 });

  const tokenHash = await sha256Hex(token);
  const db = serviceCalendarDb(env, fetch);
  const connectionId = await db.markDirtyByWatch(channelId, tokenHash).catch(() => null);
  if (connectionId && platform?.ctx) {
    platform.ctx.waitUntil(
      runCalendarSync(env, { connectionId }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return new Response(null, { status: 200 });
};
