/**
 * One collaborative doc, opened (ADR-025 transport, ADR-090 P2).
 *
 * The connection every collab surface makes: a Y.Doc, its local mirror in
 * IndexedDB (the doc survives a reload offline), and the y-partyserver
 * provider through the authenticated proxy at `/api/collab/<table>/<id>`,
 * which gates the upgrade on the edit permission and forwards to the
 * RoadsheetCollab Durable Object. The notes (`YNotes`) and the running order
 * (`RunningOrder`) open the same doc of a performance through here; what each
 * reads inside it is theirs.
 *
 * Browser only: call it from `onMount` or an `$effect`, and `close()` on
 * teardown.
 */

import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { getAccessToken } from '$lib/session.svelte';

/** The docs the collab Worker hosts; mirrors `DOC_FIELDS` in apps/collab. */
export type CollabTable = 'performance' | 'project' | 'line' | 'date';

export interface CollabDoc {
  doc: Y.Doc;
  provider: YProvider;
  /** Runs once the doc has synced with the server, now if it already has. */
  onSynced: (fn: () => void) => void;
  /** Connection status on every change, and now if already connected. */
  onStatus: (fn: (connected: boolean) => void) => void;
  /** A custom message from the Durable Object. */
  onMessage: (fn: (message: string) => void) => void;
  close: () => void;
}

/**
 * One connection per doc and tab. The notes and the running order of a
 * performance both open it; two providers would be two awareness clients, so
 * every person would count twice in the presence line. Each open() shares the
 * live doc and close() releases it; the last release tears it down.
 */
interface Connection {
  doc: Y.Doc;
  provider: YProvider;
  close: () => void;
}

const open = new Map<string, { collab: Connection; refs: number }>();

export function openCollabDoc(table: CollabTable, id: string): CollabDoc {
  const key = `${table}:${id}`;
  let entry = open.get(key);
  if (!entry) {
    entry = { collab: connect(table, id), refs: 0 };
    open.set(key, entry);
  }
  entry.refs += 1;
  const shared = entry;
  const { provider } = shared.collab;
  // What this opener listens to leaves with it: the provider outlives it.
  const off: Array<() => void> = [];
  let released = false;
  return {
    doc: shared.collab.doc,
    provider,
    onSynced: (fn) => {
      if (provider.synced) return fn();
      const once = (synced: boolean) => {
        if (!synced) return;
        provider.off('synced', once);
        fn();
      };
      provider.on('synced', once);
      off.push(() => provider.off('synced', once));
    },
    onStatus: (fn) => {
      const listen = ({ status }: { status: string }) => fn(status === 'connected');
      provider.on('status', listen);
      off.push(() => provider.off('status', listen));
      if (provider.wsconnected) fn(true);
    },
    onMessage: (fn) => {
      provider.on('custom-message', fn);
      off.push(() => provider.off('custom-message', fn));
    },
    close: () => {
      if (released) return;
      released = true;
      for (const f of off) f();
      shared.refs -= 1;
      if (shared.refs === 0) {
        open.delete(key);
        shared.collab.close();
      }
    },
  };
}

function connect(table: CollabTable, id: string): Connection {
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(`hour-collab-${table}-${id}`, doc);

  // With `prefix`, YProvider uses it as the FULL path (the room only
  // names the BroadcastChannel) — so the target id goes in the prefix.
  const provider = new YProvider(location.host, id, doc, {
    prefix: `/api/collab/${table}/${id}`,
    protocol: location.protocol === 'https:' ? 'wss' : 'ws',
    // Auth rides the httpOnly session cookie on the same-origin upgrade.
    // Async params run on every (re)connect: awaiting the token endpoint
    // refreshes a stale access cookie BEFORE the handshake, so reconnects
    // after a laptop-lid nap don't hit the gate with a dead cookie.
    params: async () => {
      await getAccessToken();
      return {};
    },
  });

  return {
    doc,
    provider,
    close: () => {
      provider.destroy();
      // Closes the IndexedDB connection (clearData() would wipe it).
      void idb.destroy();
      doc.destroy();
    },
  };
}
