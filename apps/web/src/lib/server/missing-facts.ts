/**
 * The two facts «Falta» needs that a performance row does not carry (ADR-211
 * § 3): whether it hangs from a bolo and how many road sheet links are live.
 * The record reads them one by one; the feeds that draw the signal (Hoy's
 * tiles, the Agenda's amber) ask `?missing=1` and get them here, only for the
 * rows the rule can reach: from yesterday to 15 days out, UTC (the client
 * applies the reader's 14 days).
 *
 * Each fact keeps its own door: the bolo through `read:money`
 * (`list_performance_bolo_links`), the links through `edit:performance`
 * (`list_roadsheet_shares`). A fact the reader cannot see comes back `null`
 * and asks for nothing, as on the record.
 */

import { PostgrestError, pgPostRpc, type SupabaseEnv } from '$lib/supabase';

export interface MissingFacts {
  has_bolo: boolean | null;
  roadsheet_links: number | null;
}

const DAY_MS = 86_400_000;

async function fetchRoadsheetCounts(
  env: SupabaseEnv,
  jwt: string,
  near: ReadonlyArray<{ id: string; status: string }>,
  now: Date,
): Promise<(number | null)[]> {
  const confirmedIds = near.filter((r) => r.status === 'confirmed').map((r) => r.id);
  if (confirmedIds.length === 0) return near.map(() => null);

  // Batched RPC path (migration 20261120230000_perf_rpcs_and_rls): 1 call
  // instead of N. Falls back gracefully if the migration is not yet applied.
  try {
    const { data } = await pgPostRpc<{ performance_id: string; live_count: number }>(
      env,
      'list_roadsheet_share_counts',
      jwt,
      { p_performance_ids: confirmedIds },
    );
    const byId = new Map(data.map((row) => [row.performance_id, Number(row.live_count)]));
    return near.map((r) => (r.status === 'confirmed' ? (byId.get(r.id) ?? null) : null));
  } catch (err) {
    if (!(err instanceof PostgrestError && (err.status === 404 || err.code === 'PGRST202'))) {
      return near.map(() => null);
    }
  }

  return Promise.all(
    near.map((r) =>
      r.status !== 'confirmed'
        ? null
        : pgPostRpc<{ expires_at: string | null }>(env, 'list_roadsheet_shares', jwt, { p_performance_id: r.id }).then(
            (s) => s.data.filter((l) => !l.expires_at || Date.parse(l.expires_at) > now.getTime()).length,
            () => null,
          ),
    ),
  );
}

export async function fetchMissingFacts(
  env: SupabaseEnv,
  jwt: string,
  rows: ReadonlyArray<{ id: string; performed_at: string; status: string }>,
  now = new Date(),
): Promise<Record<string, MissingFacts>> {
  const from = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 15 * DAY_MS).toISOString().slice(0, 10);
  const near = rows.filter((r) => r.status !== 'cancelled' && r.performed_at >= from && r.performed_at.slice(0, 10) <= to);
  const out: Record<string, MissingFacts> = {};
  if (near.length === 0) return out;

  const bolos = pgPostRpc<{ performance_id: string; bolo_id: string | null }>(env, 'list_performance_bolo_links', jwt, {
    p_performance_ids: near.map((r) => r.id),
  }).then(
    (r) => new Map(r.data.map((l) => [l.performance_id, l.bolo_id !== null])),
    () => new Map<string, boolean>(),
  );
  // Only a confirmed row asks for its links; an expired link opens nothing.
  const links = fetchRoadsheetCounts(env, jwt, near, now);
  const [bolo, live] = await Promise.all([bolos, links]);
  near.forEach((r, i) => {
    out[r.id] = { has_bolo: bolo.get(r.id) ?? null, roadsheet_links: live[i] };
  });
  return out;
}
