/**
 * Realtime — Svelte 5 wrapper around @supabase/realtime-js (D-PRE-06).
 *
 * Mount in `/h/[workspace]/+layout.svelte`:
 *
 *     <script>
 *       import { onDestroy } from 'svelte';
 *       import { provideRealtime, providePresence } from '$lib/realtime';
 *
 *       const rt = provideRealtime(env, jwt);
 *       const presence = providePresence(workspaceId);
 *
 *       onDestroy(() => {
 *         presence.dispose();
 *         rt.dispose();
 *       });
 *     </script>
 *
 * Use from a child page:
 *
 *     import { usePresence } from '$lib/realtime';
 *     const presence = usePresence();
 *     // presence.online, presence.count, presence.isOnline(uid)
 */

export { channelName } from './channels';
export {
  createRealtimeClient,
  decodeJwtSub,
  useRealtime,
  provideRealtime,
  type RealtimeEnv,
  type RealtimeHandle,
} from './client';
export {
  usePresence,
  PresenceStore,
  providePresence,
  type PresenceMeta,
  type PresenceState,
} from './presence.svelte';
