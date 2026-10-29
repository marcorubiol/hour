/**
 * Ahora's reads (ADR-146): the pulse's two feeds (shared, `createPulseFeeds`)
 * plus the road sheet of each performance in the next 48 hours, under one key
 * per performance and role. The trips' stages ride on the pulse's dates feed
 * (`?stages=1`), so they cost nothing more.
 *
 * PRELOADED ON OPEN, NOT ON ENTRY (§ 3, amends ADR-144 § 6): the device cache
 * keeps only what was asked, and in a basement with no signal «asked» has to
 * have happened before. `useAhoraPreload` runs in the /h frame and asks for
 * tomorrow's road sheet whether or not Ahora is ever opened.
 */
import { useQueryClient } from '@tanstack/svelte-query';
import { fetchJSON } from '$lib/api';
import { addDaysIso } from '$lib/planner';
import { perfWorkspaceId, type PerformanceEvent } from '$lib/month-events';
import type { Roadsheet } from '$lib/roadsheet';
import type { NavWorkspace } from '$lib/nav';
import { ahoraRoadsheetRole } from '$lib/ahora';
import { createPulseFeeds } from '$lib/pulse-feeds.svelte';

export interface AhoraRoadsheet {
  roadsheet: Roadsheet;
  venue_timezone: string | null;
}

export function ahoraRoadsheetQuery(id: string, role: 'full' | 'tech_manager') {
  return {
    queryKey: ['ahora-roadsheet', id, role] as const,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<AhoraRoadsheet>(`/api/performances/${id}/roadsheet?role=${role}`, signal),
  };
}

/** The role to ask for a performance, by the viewer's role in its space. */
export function roleFor(p: PerformanceEvent, workspaces: readonly NavWorkspace[]): 'full' | 'tech_manager' {
  const ws = workspaces.find((w) => w.id === perfWorkspaceId(p));
  return ahoraRoadsheetRole(ws?.my_role);
}

/** Today and tomorrow, viewer zone: the window Ahora can show. */
export function inAhoraWindow(day: string, today: string): boolean {
  return day >= addDaysIso(today, -1) && day <= addDaysIso(today, 1);
}

/** Call synchronously from the /h frame's init. */
export function useAhoraPreload(today: () => string) {
  const queryClient = useQueryClient();
  const feeds = createPulseFeeds(today);
  $effect(() => {
    if (!feeds.settled) return;
    const day = today();
    for (const p of feeds.performances) {
      if (p.status === 'cancelled' || !inAhoraWindow(p.performed_at.slice(0, 10), day)) continue;
      void queryClient.prefetchQuery(ahoraRoadsheetQuery(p.id, roleFor(p, feeds.workspaces)));
    }
  });
}
