/**
 * RoadsheetCollab — per-document Durable Object for collaborative Yjs
 * editing of `performance.notes` / `project.notes` (and future text fields).
 * (ADR-036 renamed show -> performance; DO names use the live table name.)
 *
 * Naming: instance addressed via `idFromName('${target_table}:${target_id}')`,
 * so all clients of the same target hit the same DO. y-partyserver handles
 * the WebSocket/sync protocol; we override `onLoad`/`onSave` for snapshot
 * persistence to Postgres `collab_snapshot`.
 *
 * Hibernation: SQLite-backed (`new_sqlite_classes` in wrangler.jsonc), so
 * `this.ctx.storage.get/put` survive between cold starts. We cache
 * `workspace_id` and the last persisted `version` there to avoid round-trips
 * on every save.
 *
 * Auth posture: the DO trusts that hour-web validated the user before
 * forwarding the request. workers_dev:false on this Worker prevents direct
 * external traffic. Defence in depth: the workspace_id used for snapshot
 * writes is fetched independently via `service_role`, not taken from
 * client-controllable headers.
 */

import { Server } from 'partyserver';
import { withYjs } from 'y-partyserver';
import * as Y from 'yjs';
import {
  fetchTargetMeta,
  loadLatestSnapshot,
  saveSnapshot,
  writeNotesColumn,
} from './persistence';
import {
  assertSnapshotDidNotRegress,
  commitSnapshotThenMaterialize,
  createHydratedMarker,
  isHydratedFor,
  loadHydrationInputs,
  type CollabTarget,
  type CollabTargetTable,
  type HydratedMarker,
} from './persistence-guard';

/** The shared text field inside every collab doc (ADR-025 scope). */
const NOTES_FIELD = 'notes';

export interface CollabEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SECRET_KEY: string;
  ROADSHEET_COLLAB: DurableObjectNamespace;
}

const STORAGE_KEYS = {
  workspaceId: 'workspace_id',
  version: 'snapshot_version',
  hydration: 'hydration_state',
} as const;

const ALLOWED_TABLES = new Set(['performance', 'project', 'line']);

// Avoid deploying a "headless" DO that accepts traffic but can't persist.
class RoadsheetCollabBase extends Server<CollabEnv> {
  // Inherit fetch/onConnect/onClose from partyserver — they handle the
  // WebSocket lifecycle. We only customize the Yjs persistence hooks.
}

const WithYjs = withYjs(RoadsheetCollabBase);

export class RoadsheetCollab extends WithYjs {
  /**
   * This activation must itself complete hydration. A durable marker from a
   * previous activation is necessary but not sufficient to authorize saves.
   */
  private hydration: HydratedMarker | null = null;

  /** Serialize debounced saves; external fetches otherwise allow overlap. */
  private saveQueue: Promise<void> = Promise.resolve();

  /**
   * workerd delivers binary frames as Blob (the WHATWG default on recent
   * compatibility dates); y-partyserver 2.2.0 only understands
   * ArrayBuffer/TypedArray and silently decodes an empty buffer otherwise
   * ("Unexpected end of array", found live 2026-07-02 — the reason the
   * 2026-05-09 scaffold never actually synced). Normalize before handing
   * off. CRDT semantics tolerate the await's potential reordering.
   */
  override async onMessage(
    conn: Parameters<InstanceType<typeof WithYjs>['onMessage']>[0],
    message: ArrayBuffer | string,
  ): Promise<void> {
    const normalized =
      typeof message !== 'string' && message instanceof Blob
        ? await (message as Blob).arrayBuffer()
        : message;
    super.onMessage(conn, normalized as never);
  }

  /**
   * Resolve `[targetTable, targetId]` from `this.name`. Returns null when
   * the name doesn't fit the expected pattern; load/save callers then
   * reject the operation.
   */
  private parseName(): CollabTarget | null {
    const [table, id] = this.name.split(':');
    if (!table || !id) return null;
    if (!ALLOWED_TABLES.has(table)) return null;
    return { table: table as CollabTargetTable, id };
  }

  /**
   * Called by y-partyserver once when the doc is initialized for this DO
   * instance. We seed the Yjs document from the latest snapshot in
   * `collab_snapshot` and cache the workspace_id for subsequent saves.
   */
  override async onLoad(): Promise<Y.Doc> {
    const target = this.parseName();
    if (!target) {
      throw new Error(`Invalid collaborative document name: ${this.name}`);
    }

    const previousMarker = await this.ctx.storage.get<unknown>(STORAGE_KEYS.hydration);
    // The last known-good durable marker is an integrity lower bound. Do not
    // overwrite it while loading: a crash or failed fetch must not erase the
    // version needed to reject a later empty/older snapshot response. The
    // activation-local marker below is the fail-closed loading gate.
    this.hydration = null;

    try {
      const { meta, snapshot: latest } = await loadHydrationInputs(
        target,
        () => fetchTargetMeta(this.env, target.table, target.id),
        () => loadLatestSnapshot(this.env, target.table, target.id),
      );
      assertSnapshotDidNotRegress(previousMarker, target, latest?.version ?? null);

      // Build off to the side. y-partyserver applies this document only
      // after onLoad resolves, so a failed hydrate never exposes partial or
      // empty state to a WebSocket client.
      const hydratedDocument = new Y.Doc();
      const version = latest?.version ?? 0;
      if (latest) {
        Y.applyUpdate(hydratedDocument, latest.snapshot);
      } else if (meta.notes) {
        hydratedDocument.getText(NOTES_FIELD).insert(0, meta.notes);
      }

      const marker = createHydratedMarker(target, version);
      await this.ctx.storage.put<string | number | HydratedMarker>({
        [STORAGE_KEYS.workspaceId]: meta.workspace_id,
        [STORAGE_KEYS.version]: version,
        [STORAGE_KEYS.hydration]: marker,
      });
      this.hydration = marker;
      return hydratedDocument;
    } catch (error) {
      console.error('[collab] hydration failed:', error);
      throw new Error('Collaborative document is temporarily unavailable', {
        cause: error,
      });
    }
  }

  /**
   * Called by y-partyserver after callbackOptions thresholds (default: 30
   * updates / 60s). Encodes the full doc state and writes a new
   * `collab_snapshot` row. Saves are serialized and require matching
   * in-memory + durable hydration markers.
   */
  override onSave(): Promise<void> {
    const queued = this.saveQueue.then(() => this.saveHydratedDocument());
    // Keep the queue usable after a failed save while returning the original
    // rejection to y-partyserver for observability.
    this.saveQueue = queued.catch(() => undefined);
    return queued;
  }

  private async saveHydratedDocument(): Promise<void> {
    const target = this.parseName();
    if (!target) {
      throw new Error(`Invalid collaborative document name: ${this.name}`);
    }

    const storedMarker = await this.ctx.storage.get<unknown>(STORAGE_KEYS.hydration);
    if (
      this.hydration === null ||
      !isHydratedFor(storedMarker, target) ||
      storedMarker.version !== this.hydration.version
    ) {
      throw new Error('Refusing to save an unhydrated collaborative document');
    }

    const wsId = await this.ctx.storage.get<unknown>(STORAGE_KEYS.workspaceId);
    if (typeof wsId !== 'string' || wsId.length === 0) {
      throw new Error('Refusing to save without a hydrated workspace_id');
    }

    const snapshot = Y.encodeStateAsUpdate(this.document);
    const notes = this.document.getText(NOTES_FIELD).toString();
    const committed = await commitSnapshotThenMaterialize(storedMarker, {
      persistSnapshot: (version) =>
        saveSnapshot(this.env, wsId, target.table, target.id, snapshot, version),
      persistHydration: (marker) =>
        this.ctx.storage.put<number | HydratedMarker>({
          [STORAGE_KEYS.version]: marker.version,
          [STORAGE_KEYS.hydration]: marker,
        }),
      materializeNotes: async () => {
        try {
          await writeNotesColumn(this.env, target.table, target.id, notes);
        } catch (error) {
          // The immutable snapshot is authoritative and already committed.
          // A future edit retries materialization with fresher text.
          console.error('[collab] writeNotesColumn failed:', error);
        }
      },
    });
    this.hydration = committed;
  }
}
