/**
 * The writes behind «Añadir al plan», one home each (ADR-139 p3): a
 * performance (or a run of them), a date (or a series), an unavailability.
 * The quick add and the line module's performance form call the same ones, so
 * the hold-notice follow-up, the feeds a write refreshes and what «Deshacer»
 * deletes are written once.
 *
 * Only the existing endpoints: POST /api/performances(/series), /api/dates
 * (/series), /api/availability. No migration behind any of this.
 */

import { fetchJSON, mutateJSON } from './api';
import { invalidateDateFeeds } from './date';
import type { PerformanceCreate, PerformanceSeriesCreate } from './performance';
import { isHoldStatus, isValidHoldNotice } from './performance';

type Client = {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void>;
};

export type CreatedPerformance = { id: string; slug: string | null; workspace_id: string };

/**
 * ¿Escribe en el plan en ALGÚN proyecto? (`edit:performance`, la regla de
 * funciones y fechas). La puerta de «Nueva función / fecha» en ⌘K. Solo un
 * «no» explícito esconde: mientras no responde, o si falla, se ofrece (la
 * escritura sigue gateada por la RPC).
 */
export function planAccessQueryOptions() {
  return {
    queryKey: ['plan-access'] as const,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<{ edit: boolean }>('/api/performances/access', signal),
  };
}

/** Every feed that draws a performance. */
export const PERF_FEEDS = [
  'planner-performances',
  'line-performances',
  'line-money-fees',
  'money-bolos',
  'today-performances',
  'pulse-performances',
] as const;

export async function invalidatePerformanceFeeds(client: Client): Promise<void> {
  await Promise.all(PERF_FEEDS.map((k) => client.invalidateQueries({ queryKey: [k] })));
}

/**
 * The notice to send after create, or undefined: only a hold carries one, and
 * an empty field means «the standard default», which NULL already says.
 */
export function holdNoticeToSend(status: string | undefined, notice: number | null): number | undefined {
  if (!status || !isHoldStatus(status)) return undefined;
  if (notice == null || !isValidHoldNotice(notice)) return undefined;
  return notice;
}

/**
 * One performance, or a run (two or more days: ONE atomic write, ADR-084 §1).
 * The create RPC does not know `hold_notice_days`, so a typed notice rides a
 * follow-up PATCH; its failure does not undo the gig (`noticeFailed`).
 */
export async function createPerformances(
  input: PerformanceCreate | PerformanceSeriesCreate,
  notice: number | null,
): Promise<{ rows: CreatedPerformance[]; noticeFailed: boolean }> {
  let rows: CreatedPerformance[];
  if (Array.isArray(input.performed_at)) {
    const body = await mutateJSON<{ performances: CreatedPerformance[] }>('POST', '/api/performances/series', input);
    rows = body?.performances ?? [];
  } else {
    const body = await mutateJSON<{ performance: CreatedPerformance }>('POST', '/api/performances', input);
    rows = body?.performance ? [body.performance] : [];
  }
  if (rows.length === 0) throw new Error('Malformed response');
  const send = holdNoticeToSend(input.status, notice);
  let noticeFailed = false;
  if (send !== undefined) {
    try {
      await Promise.all(rows.map((r) => mutateJSON('PATCH', `/api/performances/${r.id}`, { hold_notice_days: send })));
    } catch {
      noticeFailed = true;
    }
  }
  return { rows, noticeFailed };
}

export async function undoPerformances(ids: readonly string[], client: Client): Promise<void> {
  await Promise.all(ids.map((id) => mutateJSON('DELETE', `/api/performances/${id}`)));
  await invalidatePerformanceFeeds(client);
}

/** One date row, or a series (ADR-084 §1). Returns the ids «Deshacer» deletes. */
export async function createDates(input: { series: boolean; body: Record<string, unknown> }): Promise<string[]> {
  if (input.series) {
    const body = await mutateJSON<{ dates: { id: string }[] }>('POST', '/api/dates/series', input.body);
    return (body?.dates ?? []).map((r) => r.id);
  }
  const body = await mutateJSON<{ date: { id: string } }>('POST', '/api/dates', input.body);
  if (!body?.date) throw new Error('Malformed response');
  return [body.date.id];
}

export async function undoDates(ids: readonly string[], client: Client): Promise<void> {
  await Promise.all(ids.map((id) => mutateJSON('DELETE', `/api/dates/${id}`)));
  invalidateDateFeeds(client);
}

export type AvailabilityInput = {
  workspace_id: string;
  person_id: string | null;
  starts_on: string;
  ends_on: string;
  certainty: 'unavailable' | 'tentative';
  note: string | null;
};

export async function createAvailability(input: AvailabilityInput): Promise<string | null> {
  const body = await mutateJSON<{ block?: { id?: string } }>('POST', '/api/availability', input);
  return body?.block?.id ?? null;
}

export async function undoAvailability(id: string, client: Client): Promise<void> {
  await mutateJSON('DELETE', `/api/availability/${id}`);
  await client.invalidateQueries({ queryKey: ['planner-availability'] });
}
