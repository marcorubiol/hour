import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMissingFacts } from './missing-facts';

const ENV = {
  PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

const NOW = new Date('2026-11-20T12:00:00Z');
const ROWS = [
  { id: 'pf-1', performed_at: '2026-11-21', status: 'confirmed' },
  { id: 'pf-2', performed_at: '2026-11-22', status: 'confirmed' },
  { id: 'pf-3', performed_at: '2026-11-23', status: 'hold' },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMissingFacts', () => {
  it('uses the single batched list_roadsheet_share_counts RPC when available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/rpc/list_performance_bolo_links')) {
        return new Response(JSON.stringify([{ performance_id: 'pf-1', bolo_id: 'b1' }, { performance_id: 'pf-2', bolo_id: null }]));
      }
      if (url.endsWith('/rpc/list_roadsheet_share_counts')) {
        return new Response(JSON.stringify([{ performance_id: 'pf-1', live_count: 2 }, { performance_id: 'pf-2', live_count: 0 }]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const facts = await fetchMissingFacts(ENV, 'jwt', ROWS, NOW);
    expect(facts).toEqual({
      'pf-1': { has_bolo: true, roadsheet_links: 2 },
      'pf-2': { has_bolo: false, roadsheet_links: 0 },
      'pf-3': { has_bolo: null, roadsheet_links: null },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to per-performance list_roadsheet_shares when the batched RPC is not yet migrated (404 / PGRST202)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/rpc/list_performance_bolo_links')) {
        return new Response(JSON.stringify([{ performance_id: 'pf-1', bolo_id: 'b1' }]));
      }
      if (url.endsWith('/rpc/list_roadsheet_share_counts')) {
        return new Response(JSON.stringify({ code: 'PGRST202', message: 'not found' }), { status: 404 });
      }
      if (url.endsWith('/rpc/list_roadsheet_shares')) {
        const body = JSON.parse(String(init?.body)) as { p_performance_id: string };
        return new Response(
          JSON.stringify(
            body.p_performance_id === 'pf-1'
              ? [{ expires_at: null }, { expires_at: '2026-11-19T00:00:00Z' }]
              : [],
          ),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const facts = await fetchMissingFacts(ENV, 'jwt', ROWS, NOW);
    expect(facts['pf-1']).toEqual({ has_bolo: true, roadsheet_links: 1 });
    expect(facts['pf-2']).toEqual({ has_bolo: null, roadsheet_links: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
