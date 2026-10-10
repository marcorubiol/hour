/**
 * The server half of the stages endpoints (`/api/dates/[id]/stages`):
 * reading a trip's stages and putting one where its departure says.
 *
 * The RPCs (ADR-097) append a new stage at the end and never reorder on
 * their own. The screen's law is the running order's: a line lands where its
 * hour says. So after a write, the endpoint asks `placeStage` and, only if
 * the order changes, sends the whole list to `reorder_travel_stages`.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { STAGE_SELECT, placeStage, sameOrder, type TravelStageRow } from '$lib/travel-stage';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function stagesOf(env: SupabaseEnv, jwt: string, dateId: string): Promise<TravelStageRow[]> {
  const search = new URLSearchParams();
  search.set('select', STAGE_SELECT);
  search.set('date_id', `eq.${dateId}`);
  search.set('order', 'position.asc');
  const { data } = await pgGet<TravelStageRow>(env, 'travel_stage', jwt, { search });
  return data;
}

/** Move `id` to where its departure belongs, then return the trip's stages. */
export async function placeAndList(
  env: SupabaseEnv,
  jwt: string,
  dateId: string,
  id: string | null,
): Promise<TravelStageRow[]> {
  const stages = await stagesOf(env, jwt, dateId);
  if (!id) return stages;
  const current = stages.map((s) => s.id);
  const wanted = placeStage(stages, id);
  if (sameOrder(current, wanted)) return stages;
  const { data } = await pgPostRpc<TravelStageRow>(env, 'reorder_travel_stages', jwt, {
    p_date_id: dateId,
    p_stage_ids: wanted,
  });
  return [...data].sort((a, b) => a.position - b.position);
}
