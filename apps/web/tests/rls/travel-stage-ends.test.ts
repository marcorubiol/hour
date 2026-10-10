import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

/**
 * ADR-089 P2: each end of a stage keeps its own clock, and can be a venue of
 * the space (20261010160000_travel_stage_ends).
 *
 * Fixes:
 * - a stage takes a departure zone and an arrival zone, and reads them back;
 * - NULL is «the space's clock», what every stage meant before;
 * - a zone the catalog does not know is refused (22023 → 400), not stored;
 * - update still REPLACES the stage, zones included (ADR-097);
 * - the Worker before this branch (no zone arguments) keeps writing stages;
 * - an end links only a venue of the trip's own space, and «not there» and
 *   «another space's» are one answer.
 *
 * Red against a base without 20261010160000. Self-cleaning: everything lives
 * in `zzz-e2e-collab` (space `playwright`) and is deleted at the end.
 */
const RUN = Date.now().toString(36);

interface StageRow {
  id: string;
  depart_tz: string | null;
  arrive_tz: string | null;
  mode: string;
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('travel stage ends: zones and venues (ADR-089 P2)', () => {
  let jwt: string;
  let tripId: string;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    expect(p.status).toBe(200);
    const r = await pgRpc<{ id: string }>('create_date', jwt, {
      p_project_id: p.rows[0]!.id,
      p_kind: 'travel_day',
      p_starts_at: '2031-03-02T08:00:00Z',
      p_all_day: true,
      p_title: `ZZZ RLS Zones ${RUN}`,
      p_travel_direction: 'outbound',
    });
    expect(r.status, r.error).toBe(200);
    tripId = one(r.data)!.id;
  });

  afterAll(async () => {
    if (tripId) await pgRpc('delete_date', jwt, { p_date_id: tripId });
  });

  it('a stage leaves in one zone and arrives in another', async () => {
    const r = await pgRpc<StageRow>('create_travel_stage', jwt, {
      p_date_id: tripId,
      p_mode: 'plane',
      p_depart_at: '2031-03-02T07:15:00Z',
      p_arrive_at: '2031-03-02T08:40:00Z',
      p_depart_tz: 'Europe/Madrid',
      p_arrive_tz: ' Europe/London ',
    });
    expect(r.status, r.error).toBe(200);
    expect(one(r.data)).toMatchObject({ depart_tz: 'Europe/Madrid', arrive_tz: 'Europe/London' });
  });

  it('THE RUNNING WORKER STILL WRITES STAGES: no zone arguments, zones null', async () => {
    const r = await pgRpc<StageRow>('create_travel_stage', jwt, { p_date_id: tripId, p_mode: 'bus' });
    expect(r.status, r.error).toBe(200);
    expect(one(r.data)).toMatchObject({ depart_tz: null, arrive_tz: null });
  });

  it('a zone the catalog does not know is refused, not stored', async () => {
    const r = await pgRpc('create_travel_stage', jwt, {
      p_date_id: tripId,
      p_mode: 'train',
      p_arrive_tz: 'Mars/Olympus',
    });
    expect(r.status).toBe(400);
  });

  it('update REPLACES the zones too: what is not sent is cleared', async () => {
    const s = one(
      (
        await pgRpc<StageRow>('create_travel_stage', jwt, {
          p_date_id: tripId,
          p_mode: 'plane',
          p_arrive_tz: 'America/New_York',
        })
      ).data,
    )!;
    const u = await pgRpc<StageRow>('update_travel_stage', jwt, {
      p_stage_id: s.id,
      p_mode: 'plane',
      p_depart_tz: 'Europe/Madrid',
    });
    expect(u.status, u.error).toBe(200);
    expect(one(u.data)).toMatchObject({ depart_tz: 'Europe/Madrid', arrive_tz: null });
  });

  describe('an end can be a venue of the space', () => {
    const NOWHERE = '00000000-0000-4000-8000-000000000000';
    let venueId: string;
    let foreignVenueId: string | null = null;

    beforeAll(async () => {
      const ws = await pgGet<{ id: string; slug: string }>('workspace?select=id,slug', jwt);
      const playwright = ws.rows.find((w) => w.slug === 'playwright')!;
      // create_venue is idempotent on (space, name, city): the same row every run.
      const v = await pgRpc<{ id: string }>('create_venue', jwt, {
        p_workspace_id: playwright.id,
        p_name: 'ZZZ RLS Stage Venue',
        p_city: 'Alacant',
        p_country: 'ES',
        p_timezone: 'Europe/Madrid',
      });
      expect(v.status, v.error).toBe(200);
      venueId = one(v.data)!.id;
      const other = ws.rows.find((w) => w.slug !== 'playwright');
      if (other) {
        const f = await pgRpc<{ id: string }>('create_venue', jwt, {
          p_workspace_id: other.id,
          p_name: 'ZZZ RLS Foreign Stage Venue',
          p_city: 'Lisboa',
        });
        if (f.status === 200) foreignVenueId = one(f.data)!.id;
      }
    });

    it('a stage arrives at a venue of its own space', async () => {
      const r = await pgRpc<StageRow & { to_venue_id: string | null }>('create_travel_stage', jwt, {
        p_date_id: tripId,
        p_mode: 'taxi',
        p_to_venue_id: venueId,
      });
      expect(r.status, r.error).toBe(200);
      expect(one(r.data)?.to_venue_id).toBe(venueId);
    });

    it('a venue that does not exist and one of another space are the same answer', async () => {
      const nowhere = await pgRpc('create_travel_stage', jwt, { p_date_id: tripId, p_mode: 'taxi', p_to_venue_id: NOWHERE });
      expect(nowhere.status).toBe(400);
      if (foreignVenueId) {
        const foreign = await pgRpc('create_travel_stage', jwt, {
          p_date_id: tripId,
          p_mode: 'taxi',
          p_from_venue_id: foreignVenueId,
        });
        expect(foreign.status, 'no existence oracle').toBe(nowhere.status);
        expect(foreign.error).toBe(nowhere.error);
      }
    });

    it('update REPLACES the venues too', async () => {
      const s = one(
        (await pgRpc<StageRow>('create_travel_stage', jwt, { p_date_id: tripId, p_mode: 'car', p_from_venue_id: venueId }))
          .data,
      )!;
      const u = await pgRpc<{ from_venue_id: string | null }>('update_travel_stage', jwt, {
        p_stage_id: s.id,
        p_mode: 'car',
      });
      expect(u.status, u.error).toBe(200);
      expect(one(u.data)?.from_venue_id).toBeNull();
    });
  });

  it('the zones read through the table, like every other column', async () => {
    const r = await pgGet<StageRow>(
      'travel_stage',
      jwt,
      new URLSearchParams({ date_id: `eq.${tripId}`, select: 'id,depart_tz,arrive_tz', order: 'position' }),
    );
    expect(r.status).toBe(200);
    expect(r.rows[0]).toMatchObject({ depart_tz: 'Europe/Madrid', arrive_tz: 'Europe/London' });
  });
});
