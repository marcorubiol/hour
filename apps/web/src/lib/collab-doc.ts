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
  close: () => void;
}

export function openCollabDoc(table: CollabTable, id: string): CollabDoc {
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
