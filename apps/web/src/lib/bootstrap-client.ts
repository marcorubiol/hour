/**
 * Client-side bootstrap hydration for Hoy (`GET /api/bootstrap`).
 *
 * On a cold open (or after a `CACHE_SCHEMA` bump), the phone used to fire
 * 11+ separate HTTP requests in waves before painting Hoy. One call to
 * `/api/bootstrap` lets the Worker (colocated near Supabase via Smart
 * Placement) resolve them in parallel and return a single compressed payload,
 * which we seed into the existing TanStack query keys so every lens and
 * invalidation keeps working unchanged.
 */

import type { QueryClient } from '@tanstack/svelte-query';
import { fetchJSON } from './api';
import { moneyAccessAnyQueryOptions } from './bolo-queries';
import { conversationAccessQueryOptions } from './conversation-access';
import { seedSetAside } from './set-aside.svelte';
import type { SetAside } from './set-aside';

export interface BootstrapResponse {
  workspaces?: { items: unknown[] };
  projects?: { items: unknown[] };
  lines?: { items: unknown[] };
  me?: { person_id: string | null; full_name: string; dossiers: unknown[] };
  money_access?: { read_money: boolean };
  conversation_access?: { read: boolean; edit: boolean };
  set_aside?: { items: SetAside };
  performances?: { items: unknown[] };
  dates?: { items: unknown[] };
  tasks?: { items: unknown[] };
  conversations?: { limit: number; offset: number; items: unknown[] };
}

const DAY_MS = 86_400_000;

export function bootstrapDatesFrom(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - 14 * DAY_MS).toISOString().slice(0, 10);
}

/** Apply a bootstrap payload onto the exact existing TanStack query keys. */
export function applyBootstrapPayload(
  client: QueryClient,
  payload: BootstrapResponse,
  window: { today: string; datesFrom: string },
  updatedAt = Date.now(),
): void {
  const opts = { updatedAt };
  if (payload.workspaces) client.setQueryData(['workspaces'], payload.workspaces, opts);
  if (payload.projects) client.setQueryData(['projects', { status: 'active' }], payload.projects, opts);
  if (payload.lines) client.setQueryData(['lines', 'all'], payload.lines, opts);
  if (payload.me) client.setQueryData(['me'], payload.me, opts);
  if (payload.money_access) client.setQueryData(moneyAccessAnyQueryOptions().queryKey, payload.money_access, opts);
  if (payload.conversation_access) {
    client.setQueryData(conversationAccessQueryOptions().queryKey, payload.conversation_access, opts);
  }
  if (payload.set_aside) seedSetAside(payload.set_aside.items);
  if (payload.performances) client.setQueryData(['pulse-performances', window.today], payload.performances, opts);
  if (payload.dates) client.setQueryData(['pulse-dates', window.datesFrom], payload.dates, opts);
  if (payload.tasks) client.setQueryData(['tasks', 'open'], payload.tasks, opts);
  if (payload.conversations) client.setQueryData(['conversations', 'today'], payload.conversations, opts);
}

let inFlight: Promise<boolean> | null = null;

/**
 * Fetch `/api/bootstrap` once per cold boot and seed the QueryClient.
 * Never throws: if unavailable, individual queries fall back seamlessly.
 */
export function hydrateFromBootstrap(client: QueryClient, today: string): Promise<boolean> {
  if (inFlight) return inFlight;
  const datesFrom = bootstrapDatesFrom(today);
  inFlight = (async () => {
    try {
      const qs = new URLSearchParams({ today, dates_from: datesFrom });
      const payload = await fetchJSON<BootstrapResponse>(`/api/bootstrap?${qs}`);
      applyBootstrapPayload(client, payload, { today, datesFrom });
      return true;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
