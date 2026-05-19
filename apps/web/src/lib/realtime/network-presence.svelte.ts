/**
 * Network presence — aggregated "who's online across all my workspaces"
 * view. Subscribes to one presence channel per workspace the user belongs
 * to and unions the resulting presence states.
 *
 * Hybrid model B (Marco's call 2026-05-18): the topbar shows this network
 * view ("Anouk está conectada a Hour ahora mismo, en algún sitio que
 * compartimos"), while future per-Project / per-RoadSheet badges (Phase 0.2)
 * will surface contextual presence at the artifact level ("Anouk también
 * está mirando este road sheet contigo"). Both layers compose; this is
 * the wider one.
 *
 * Lifecycle:
 *   - One instance per /h/[workspace]/ layout mount.
 *   - `setWorkspaces(slugs)` is idempotent — call whenever the user's
 *     membership list changes. Workspaces removed from the input get
 *     their channel released; new ones get subscribed.
 *   - `dispose()` releases all channels.
 *
 * The store sits ON TOP of the same workspace presence channels used by
 * the existing PresenceStore — Supabase Realtime tracks each (channel,
 * presence-key) tuple once, so the user joining via NetworkPresenceStore
 * is the same join a future per-workspace badge would see.
 */

import type { RealtimeChannel } from '@supabase/realtime-js';
import { getContext, setContext } from 'svelte';
import { channelName } from './channels';
import { useRealtime, type RealtimeHandle } from './client';
import type { PresenceState } from './presence.svelte';

export class NetworkPresenceStore {
  /** Workspace slug -> presence state. */
  byWorkspace = $state<Record<string, PresenceState>>({});

  private channels = new Map<string, RealtimeChannel>();

  constructor(private readonly rt: RealtimeHandle) {}

  /**
   * Reconcile subscriptions to the given workspace slug list:
   *  - subscribes to slugs not yet tracked,
   *  - releases channels for slugs no longer in the list.
   * Calling with the same slugs again is a no-op.
   */
  setWorkspaces(slugs: readonly string[]): void {
    const next = new Set(slugs);

    // Subscribe to new ones.
    for (const slug of slugs) {
      if (this.channels.has(slug)) continue;
      this.subscribe(slug);
    }

    // Release dropped ones.
    for (const slug of Array.from(this.channels.keys())) {
      if (!next.has(slug)) this.unsubscribe(slug);
    }
  }

  private subscribe(slug: string): void {
    const key = channelName.workspacePresence(slug);
    const ch = this.rt.channel(key, {
      config: { presence: { key: this.rt.userId } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      // Mutating reassignment so $state notifies subscribers reliably.
      this.byWorkspace = {
        ...this.byWorkspace,
        [slug]: ch.presenceState() as PresenceState,
      };
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: this.rt.userId,
          online_at: new Date().toISOString(),
        });
      }
    });

    this.channels.set(slug, ch);
  }

  private unsubscribe(slug: string): void {
    const key = channelName.workspacePresence(slug);
    this.rt.release(key);
    this.channels.delete(slug);
    const next = { ...this.byWorkspace };
    delete next[slug];
    this.byWorkspace = next;
  }

  /**
   * Distinct users online across all subscribed workspaces. Self is
   * counted (so "1 online" with a gray dot means "you're alone in your
   * whole network", not "no one is here").
   */
  get count(): number {
    const distinct = new Set<string>();
    for (const state of Object.values(this.byWorkspace)) {
      for (const userId of Object.keys(state)) distinct.add(userId);
    }
    return distinct.size;
  }

  /** True if userId is online in at least one of the subscribed workspaces. */
  isOnline(userId: string): boolean {
    for (const state of Object.values(this.byWorkspace)) {
      if (userId in state) return true;
    }
    return false;
  }

  dispose(): void {
    for (const slug of Array.from(this.channels.keys())) {
      this.rt.release(channelName.workspacePresence(slug));
    }
    this.channels.clear();
    this.byWorkspace = {};
  }
}

const KEY = Symbol('network-presence');

export function provideNetworkPresence(): NetworkPresenceStore {
  const rt = useRealtime();
  const store = new NetworkPresenceStore(rt);
  setContext(KEY, store);
  return store;
}

export function useNetworkPresence(): NetworkPresenceStore {
  const store = getContext<NetworkPresenceStore | undefined>(KEY);
  if (!store) {
    throw new Error(
      'useNetworkPresence: no NetworkPresenceStore in context — call provideNetworkPresence in /h/[workspace]/+layout.svelte first.',
    );
  }
  return store;
}
