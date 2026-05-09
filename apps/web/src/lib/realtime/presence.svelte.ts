/**
 * Workspace presence — reactive list of users currently connected to a
 * workspace. Backed by Supabase Realtime's presence feature, which keeps
 * "who's here" state in-memory on the realtime server (no DB writes, no RLS).
 *
 * Lifecycle:
 *   - Constructed in `/h/[workspace]/+layout.svelte` once the workspace is
 *     known. Subscribes to `workspace:{id}:presence`, tracks self, listens
 *     to sync/join/leave events.
 *   - `dispose()` releases the channel. Call from the layout's onDestroy.
 *
 * Phase 0.0 scope: maintain the reactive state. The UI that renders avatars
 * for connected users is Phase 0.1 work.
 */

import type { RealtimeChannel } from '@supabase/realtime-js';
import { getContext, setContext } from 'svelte';
import { channelName } from './channels';
import { useRealtime, type RealtimeHandle } from './client';

export interface PresenceMeta {
  user_id: string;
  online_at: string;
}

/** Online state keyed by user_id. Value is the metadata array (one per
 * concurrent connection — same user, multiple tabs counts twice). */
export type PresenceState = Record<string, PresenceMeta[]>;

export class PresenceStore {
  online = $state<PresenceState>({});

  private channel: RealtimeChannel | null = null;
  private channelKey: string;

  constructor(
    private readonly rt: RealtimeHandle,
    workspaceId: string,
  ) {
    this.channelKey = channelName.workspacePresence(workspaceId);

    const ch = this.rt.channel(this.channelKey, {
      config: { presence: { key: this.rt.userId } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      this.online = ch.presenceState() as PresenceState;
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: this.rt.userId,
          online_at: new Date().toISOString(),
        });
      }
    });

    this.channel = ch;
  }

  /** Number of distinct users online (not connections — same user across tabs counts once). */
  get count(): number {
    return Object.keys(this.online).length;
  }

  /** True if `userId` is currently connected somewhere. */
  isOnline(userId: string): boolean {
    return userId in this.online;
  }

  dispose(): void {
    if (!this.channel) return;
    this.rt.release(this.channelKey);
    this.channel = null;
  }
}

const KEY = Symbol('presence');

export function providePresence(workspaceId: string): PresenceStore {
  const rt = useRealtime();
  const store = new PresenceStore(rt, workspaceId);
  setContext(KEY, store);
  return store;
}

export function usePresence(): PresenceStore {
  const store = getContext<PresenceStore | undefined>(KEY);
  if (!store) {
    throw new Error('usePresence: no PresenceStore in context — call providePresence in /h/[workspace]/+layout.svelte first.');
  }
  return store;
}
