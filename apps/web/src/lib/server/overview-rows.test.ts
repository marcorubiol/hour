import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOverviewRows } from './conversation-overview';

// 2026-11-01: the bolos no longer wait for the heavy rows read; their ids come
// from a light read of the same scope, alongside.

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };

afterEach(() => vi.unstubAllGlobals());

describe('loadOverviewRows', () => {
  it('asks for the bolos while the rows are still on the wire, and joins them by id', async () => {
    let rowsAnswered = false;
    let bolosAskedBeforeRows: boolean | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        const path = url.pathname.replace('/rest/v1/', '');
        const select = url.searchParams.get('select') ?? '';
        let body: unknown = [];
        if (path === 'conversation' && select === 'id') body = [{ id: 'c1' }];
        else if (path === 'conversation') {
          await new Promise((r) => setTimeout(r, 30));
          rowsAnswered = true;
          body = [{ id: 'c1', workspace_id: 'w1', project_id: 'p1', organization: { name: 'Sala' }, contacts: [], tagging: [], last_turn: [], last_in: [] }];
        } else if (path === 'rpc/conversations_bolos') {
          bolosAskedBeforeRows = !rowsAnswered;
          body = [{ conversation_id: 'c1', bolo_id: 'b1', status: 'done' }];
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const rows = await loadOverviewRows(env as never, 'jwt', { projectIds: [], workspaceIds: ['w1'] });
    expect(bolosAskedBeforeRows).toBe(true);
    expect(rows[0].bolos).toEqual([{ conversation_id: 'c1', bolo_id: 'b1', status: 'done' }]);
    expect(rows[0].title).toBe('Sala');
  });
});
