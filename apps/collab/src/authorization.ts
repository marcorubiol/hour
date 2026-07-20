import type { PersistEnv } from './persistence';
import type { CollabTarget } from './persistence-guard';

export interface CollabConnectionState {
  userId: string;
  /** Supabase access-token expiry, as Unix seconds. */
  expiresAt: number;
}

export function connectionStateFromRequest(request: Request): CollabConnectionState | null {
  const userId = request.headers.get('x-hour-collab-user-id');
  const expiresAt = Number(request.headers.get('x-hour-collab-expires-at'));
  if (
    !userId ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0
  ) {
    return null;
  }
  return { userId, expiresAt };
}

export function isConnectionState(
  value: unknown,
): value is Readonly<CollabConnectionState> {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<CollabConnectionState>;
  return (
    typeof state.userId === 'string' &&
    state.userId.length > 0 &&
    typeof state.expiresAt === 'number' &&
    Number.isSafeInteger(state.expiresAt) &&
    state.expiresAt > 0
  );
}

export function sessionNeedsReauthentication(
  state: unknown,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  return !isConnectionState(state) || state.expiresAt <= nowSeconds;
}

/**
 * Re-check a connected editor against current database state. The secret key
 * is held only by the private Worker and the RPC is executable only by
 * service_role; clients cannot call this user-id-parameterized seam.
 */
export async function canUserWriteCollab(
  env: PersistEnv,
  target: CollabTarget,
  userId: string,
): Promise<boolean> {
  const response = await fetch(
    new URL('/rest/v1/rpc/can_user_write_collab', env.PUBLIC_SUPABASE_URL),
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_target_table: target.table,
        p_target_id: target.id,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`canUserWriteCollab: ${response.status}`);
  }
  return (await response.json()) === true;
}
