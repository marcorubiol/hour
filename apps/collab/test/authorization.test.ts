import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  canUserWriteCollab,
  connectionStateFromRequest,
  isConnectionState,
  sessionNeedsReauthentication,
} from '../src/authorization.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('forwarded identity becomes durable connection state', () => {
  const request = new Request('https://internal.example', {
    headers: {
      'x-hour-collab-user-id': 'user-1',
      'x-hour-collab-expires-at': '200',
    },
  });

  assert.deepEqual(connectionStateFromRequest(request), {
    userId: 'user-1',
    expiresAt: 200,
  });
  assert.equal(isConnectionState({ userId: 'user-1', expiresAt: 200 }), true);
  assert.equal(sessionNeedsReauthentication({ userId: 'user-1', expiresAt: 200 }, 199), false);
  assert.equal(sessionNeedsReauthentication({ userId: 'user-1', expiresAt: 200 }, 200), true);
});

test('missing or malformed forwarded identity fails closed', () => {
  assert.equal(connectionStateFromRequest(new Request('https://internal.example')), null);
  assert.equal(isConnectionState({ userId: '', expiresAt: 200 }), false);
  assert.equal(isConnectionState({ userId: 'user-1', expiresAt: 1.5 }), false);
  assert.equal(sessionNeedsReauthentication(null, 100), true);
});

test('live authorization uses the service-role-only RPC', async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.pathname, '/rest/v1/rpc/can_user_write_collab');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).apikey, 'secret-key');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      p_user_id: 'user-1',
      p_target_table: 'performance',
      p_target_id: 'performance-1',
    });
    return Response.json(true);
  };

  assert.equal(
    await canUserWriteCollab(
      { PUBLIC_SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'secret-key' },
      { table: 'performance', id: 'performance-1' },
      'user-1',
    ),
    true,
  );
});

test('live authorization propagates upstream failures', async () => {
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(
    canUserWriteCollab(
      { PUBLIC_SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'secret-key' },
      { table: 'line', id: 'line-1' },
      'user-1',
    ),
    /canUserWriteCollab: 503/,
  );
});
