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

import { Server, type Connection, type ConnectionContext } from 'partyserver';
import { withYjs } from 'y-partyserver';
import * as Y from 'yjs';
import {
  fetchTargetMeta,
  loadLatestSnapshot,
  pruneSnapshots,
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
import {
  canUserWriteCollab,
  connectionStateFromRequest,
  isConnectionState,
  sessionNeedsReauthentication,
  type CollabConnectionState,
} from './authorization';

/** The shared text field inside every collab doc (ADR-025 scope). */
const NOTES_FIELD = 'notes';
const AUTHORIZATION_RECHECK_MS = 30_000;
const REAUTHENTICATE_CODE = 4401;
const REAUTHENTICATE_REASON = 'reauthentication required';
/** Snapshot rows to keep behind the latest (the rest are dead weight). */
const SNAPSHOT_RETENTION = 3;

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
  // Set when a notes materialization failed; retried on the next alarm or on
  // reactivation so the denormalized column can't diverge forever.
  notesDirty: 'notes_dirty',
} as const;

const ALLOWED_TABLES = new Set(['performance', 'project', 'line']);

// Avoid deploying a "headless" DO that accepts traffic but can't persist.
class RoadsheetCollabBase extends Server<CollabEnv> {
  // PartyServer defaults to in-memory sockets. Persisting connection state in
  // attachments only becomes useful when hibernation is enabled; with this
  // option the DO can sleep while idle sockets remain connected and wake for
  // alarms/messages with userId + JWT expiry intact.
  static override options = { hibernate: true };

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

  override async onStart(): Promise<void> {
    await super.onStart();
    if ([...this.getConnections()].length > 0) {
      await this.ensureAuthorizationAlarm();
    }
  }

  override async onConnect(
    connection: Connection<CollabConnectionState>,
    context: ConnectionContext,
  ): Promise<void> {
    const state = connectionStateFromRequest(context.request);
    if (!state || sessionNeedsReauthentication(state)) {
      connection.close(REAUTHENTICATE_CODE, REAUTHENTICATE_REASON);
      return;
    }

    connection.setState(state);
    await super.onConnect(connection, context);
    await this.ensureAuthorizationAlarm();
  }

  /**
   * workerd delivers binary frames as Blob (the WHATWG default on recent
   * compatibility dates); y-partyserver 2.2.0 only understands
   * ArrayBuffer/TypedArray and silently decodes an empty buffer otherwise
   * ("Unexpected end of array", found live 2026-07-02 — the reason the
   * 2026-05-09 scaffold never actually synced). Normalize before handing
   * off. CRDT semantics tolerate the await's potential reordering.
   */
  override async onMessage(
    conn: Connection<CollabConnectionState>,
    message: ArrayBuffer | string,
  ): Promise<void> {
    if (sessionNeedsReauthentication(conn.state)) {
      conn.close(REAUTHENTICATE_CODE, REAUTHENTICATE_REASON);
      return;
    }
    const normalized =
      typeof message !== 'string' && message instanceof Blob
        ? await (message as Blob).arrayBuffer()
        : message;
    await super.onMessage(conn, normalized as never);
  }

  override async onClose(
    connection: Connection<CollabConnectionState>,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    await super.onClose(connection, code, reason, wasClean);
    if ([...this.getConnections()].length === 0) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  override async onAlarm(): Promise<void> {
    const target = this.parseName();
    const connections = [...this.getConnections<CollabConnectionState>()];
    if (!target || connections.length === 0) return;

    const nowSeconds = Math.floor(Date.now() / 1_000);
    const active = connections.filter((connection) => {
      if (sessionNeedsReauthentication(connection.state, nowSeconds)) {
        connection.close(REAUTHENTICATE_CODE, REAUTHENTICATE_REASON);
        return false;
      }
      return true;
    });

    // Per-user recheck. A THROWN recheck is inconclusive (e.g. a transient
    // Supabase blip), NOT a denial — booting every collaborator on one flaky
    // RPC is worse than trusting the still-unexpired JWT for another 30 s.
    // Only a definitive `false` closes a connection.
    const decisions = new Map<string, boolean>();
    await Promise.all(
      [...new Set(active.map((connection) => connection.state!.userId))].map(
        async (userId) => {
          try {
            decisions.set(userId, await canUserWriteCollab(this.env, target, userId));
          } catch (error) {
            console.error('[collab] live authorization inconclusive, keeping session:', error);
          }
        },
      ),
    );

    let authorizedConnections = 0;
    for (const connection of active) {
      const state = connection.state;
      if (!isConnectionState(state) || decisions.get(state.userId) === false) {
        // Unknown state or a definitive denial closes. An inconclusive recheck
        // (userId absent from `decisions`) keeps the unexpired session.
        connection.close(REAUTHENTICATE_CODE, REAUTHENTICATE_REASON);
      } else {
        authorizedConnections += 1;
      }
    }

    if (authorizedConnections > 0) {
      await this.flushPendingNotes(target);
      await this.ensureAuthorizationAlarm();
    }
  }

  /**
   * Retry a notes materialization that failed on an earlier save. The current
   * in-memory doc text is authoritative (it equals the latest snapshot), so we
   * push that rather than any stale captured text. Best-effort: on failure the
   * dirty flag stays set for the next attempt.
   */
  private async flushPendingNotes(target: CollabTarget): Promise<void> {
    const dirty = await this.ctx.storage.get<unknown>(STORAGE_KEYS.notesDirty);
    if (!dirty) return;
    try {
      const notes = this.document.getText(NOTES_FIELD).toString();
      await writeNotesColumn(this.env, target.table, target.id, notes);
      await this.ctx.storage.delete(STORAGE_KEYS.notesDirty);
    } catch (error) {
      console.error('[collab] pending notes flush failed, will retry:', error);
    }
  }

  private async ensureAuthorizationAlarm(): Promise<void> {
    const alarm = await this.ctx.storage.getAlarm();
    const latestAcceptable = Date.now() + AUTHORIZATION_RECHECK_MS;
    if (alarm === null || alarm > latestAcceptable) {
      await this.ctx.storage.setAlarm(latestAcceptable);
    }
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

      // Reactivation flush: if a prior save left the denormalized notes column
      // behind (materialize failed, then everyone disconnected so no alarm
      // retried), catch it up now from the authoritative hydrated text.
      if (await this.ctx.storage.get<unknown>(STORAGE_KEYS.notesDirty)) {
        try {
          await writeNotesColumn(
            this.env,
            target.table,
            target.id,
            hydratedDocument.getText(NOTES_FIELD).toString(),
          );
          await this.ctx.storage.delete(STORAGE_KEYS.notesDirty);
        } catch (error) {
          console.error('[collab] reactivation notes flush failed, will retry:', error);
        }
      }

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
          await this.ctx.storage.delete(STORAGE_KEYS.notesDirty);
        } catch (error) {
          // The immutable snapshot is authoritative and already committed. Mark
          // the column dirty so the next alarm / reactivation retries the write
          // even if the doc is never edited again (the old "future edit retries"
          // assumption failed when "never edited again" was the steady state).
          await this.ctx.storage.put(STORAGE_KEYS.notesDirty, true);
          console.error('[collab] writeNotesColumn failed, marked dirty:', error);
        }
      },
    });
    this.hydration = committed;

    // Prune superseded snapshot rows — only the latest is ever read. Best-effort:
    // a failed prune must never fail the save that already committed.
    try {
      await pruneSnapshots(this.env, target.table, target.id, committed.version - SNAPSHOT_RETENTION);
    } catch (error) {
      console.error('[collab] snapshot prune failed (non-fatal):', error);
    }
  }
}
