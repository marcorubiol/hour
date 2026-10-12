/**
 * «Voy / no voy» from the client (ADR-103): one write and the feeds it moves.
 *
 * Every surface that answers an inference (the rail's NEXT, the date dialog,
 * the performance page) writes through here, so they invalidate the same
 * caches and cannot disagree about who is going after the click.
 */

import type { QueryClient } from '@tanstack/svelte-query';
import { mutateJSON } from '$lib/api';
import type { Commitment, CommitmentState } from '$lib/people';

export type CommitmentTarget = 'performance' | 'date';

/** Every feed that carries `commitments`. */
const FEEDS = [
  'pulse-performances',
  'pulse-dates',
  'planner-performances',
  'planner-dates',
  'performance',
] as const;

export async function setCommitment(
  queryClient: QueryClient,
  target: CommitmentTarget,
  id: string,
  personId: string,
  state: CommitmentState | null,
): Promise<void> {
  await mutateJSON<{ commitment: Commitment | null }>(
    'PUT',
    `/api/commitments/${target}/${id}`,
    { person_id: personId, state },
  );
  await Promise.all(FEEDS.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
}
