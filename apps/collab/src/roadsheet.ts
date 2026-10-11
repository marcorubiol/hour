/**
 * RoadsheetCollab — per-document Durable Object for collaborative Yjs
 * editing of the notes of a performance, a project or a line (ADR-025) and of
 * the running order of a performance or a day (ADR-090 P2).
 * (ADR-036 renamed show -> performance; DO names use the live table name.)
 *
 * Naming: instance addressed via `idFromName('${target_table}:${target_id}')`,
 * so all clients of the same target hit the same DO. y-partyserver handles
 * the WebSocket/sync protocol; we override `onLoad`/`onSave` for snapshot
 * persistence to Postgres `collab_snapshot`.
 *
 * What a doc holds is `DOC_FIELDS` (persistence-guard): a `notes` Y.Text and,
 * on a performance or a day, a `schedule` Y.Array (`schedule.ts`). Each is
 * MATERIALIZED after the snapshot commits: the notes into the target's
 * `notes` column, the running order into `schedule_slot` rows. The doc
 * MANDA on both (Marco, 2026-10-10): nothing else writes those rows of a
 * running order; a server-side change (a venue that moved zone) comes IN
 * through the doc (`onRequest`), never around it.
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
 * client-controllable headers; and the running order is materialized with
 * the permission of the person who edited it, re-checked by the database.
 */

import { Server, type Connection, type ConnectionContext } from 'partyserver';
import { withYjs } from 'y-partyserver';
import * as Y from 'yjs';
import {
  PostgrestError,
  fetchScheduleRows,
  fetchTargetMeta,
  loadLatestSnapshot,
  pruneSnapshots,
  replaceScheduleSlots,
  saveSnapshot,
  writeNotesColumn,
} from './persistence';
import {
  DOC_FIELDS,
  assertSnapshotDidNotRegress,
  commitSnapshotThenMaterialize,
  createHydratedMarker,
  isCollabTargetTable,
  isHydratedFor,
  loadHydrationInputs,
  type CollabTarget,
  type HydratedMarker,
} from './persistence-guard';
import {
  applyHoursUpdates,
  isScheduleSeeded,
  readSchedule,
  scheduleForRows,
  scheduleOf,
  seedSchedule,
  type ScheduleHoursUpdate,
  type ScheduleSlot,
} from './schedule';
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
/**
 * Said to every client once the running order reached the rows, so the read
 * surfaces (the strip, Desk, the road sheet) refetch them. A y-partyserver
 * custom message: it rides the same socket, outside the CRDT.
 */
const SCHEDULE_MATERIALIZED = 'schedule:materialized';

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
  // The same for the running order's rows, plus who to write them as: the
  // in-memory last editor does not survive an eviction.
  scheduleDirty: 'schedule_dirty',
  scheduleEditor: 'schedule_editor',
} as const;

type ScheduleTarget = CollabTarget & { table: 'performance' | 'date' };

function holdsSchedule(target: CollabTarget): target is ScheduleTarget {
  return DOC_FIELDS[target.table].schedule;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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

  /** Whose edit the next running-order materialization is written as. */
  private lastEditor: string | null = null;

  /** The running order changed since it was last materialized. */
  private scheduleChanged = false;

  override async onStart(): Promise<void> {
    await super.onStart();
    this.watchDocument();
    if ([...this.getConnections()].length > 0) {
      await this.ensureAuthorizationAlarm();
    }
  }

  /**
   * Attached AFTER super.onStart() applied the hydrated doc, so loading a
   * snapshot (or the seed) never counts as an edit.
   */
  private watchDocument(): void {
    const target = this.parseName();
    if (!target) return;
    // y-partyserver applies a client's update with its Connection as the
    // transaction origin: that is the person who edited.
    this.document.on('update', (_update: Uint8Array, origin: unknown) => {
      const state = (origin as { state?: unknown } | null)?.state;
      if (isConnectionState(state)) this.lastEditor = state.userId;
    });
    if (holdsSchedule(target)) {
      scheduleOf(this.document).observeDeep(() => {
        this.scheduleChanged = true;
      });
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

  /** Clients send no custom messages; the server only speaks them. */
  override onCustomMessage(): void {}

  /**
   * The internal door for hour-web (never reachable from outside:
   * workers_dev is off and only hour-web holds the binding). It exists so a
   * server-side change to a running order goes THROUGH the doc, which manda:
   *
   *   GET  /schedule        → `{ slots }`, the order as the doc has it now
   *   POST /schedule/hours  → `{ updates: ScheduleHoursUpdate[] }`, moves
   *                           hours compare-and-set, materializes at once,
   *                           → `{ applied, skipped, materialized }`
   *
   * The POST carries `x-hour-collab-user-id`, the person whose PATCH caused
   * it; their write permission is re-checked here, and the rows are written
   * as them.
   */
  override async onRequest(request: Request): Promise<Response> {
    const target = this.parseName();
    if (!target || !holdsSchedule(target)) return json({ error: 'not_found' }, 404);
    const path = new URL(request.url).pathname;

    if (request.method === 'GET' && path.endsWith('/schedule')) {
      return json({ slots: readSchedule(this.document) });
    }

    if (request.method === 'POST' && path.endsWith('/schedule/hours')) {
      const userId = request.headers.get('x-hour-collab-user-id');
      if (!userId) return json({ error: 'missing_user' }, 400);
      if (!(await canUserWriteCollab(this.env, target, userId))) {
        return json({ error: 'forbidden' }, 403);
      }
      const body = (await request.json().catch(() => null)) as {
        updates?: unknown;
      } | null;
      const updates = Array.isArray(body?.updates)
        ? (body.updates as unknown[]).filter(isHoursUpdate)
        : null;
      if (!updates) return json({ error: 'invalid_body' }, 400);

      this.lastEditor = userId;
      const result = applyHoursUpdates(this.document, updates, 'server');
      if (result.applied > 0) {
        // Persist and materialize now, not on the debounce: the PATCH that
        // asked answers with the rows already moved.
        await this.onSave();
      }
      const dirty = await this.ctx.storage.get<unknown>(STORAGE_KEYS.scheduleDirty);
      return json({ ...result, materialized: !dirty });
    }

    return json({ error: 'not_found' }, 404);
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
      await this.flushPending(target, this.document);
      await this.ensureAuthorizationAlarm();
    }
  }

  /**
   * Retry a materialization that failed on an earlier save. The doc given is
   * authoritative (it equals the latest snapshot), so we push what it says
   * rather than anything captured before. Best-effort: on failure the dirty
   * flag stays set for the next attempt.
   */
  private async flushPending(target: CollabTarget, doc: Y.Doc): Promise<void> {
    if (
      DOC_FIELDS[target.table].notes &&
      (await this.ctx.storage.get<unknown>(STORAGE_KEYS.notesDirty))
    ) {
      try {
        await writeNotesColumn(
          this.env,
          target.table,
          target.id,
          doc.getText(NOTES_FIELD).toString(),
        );
        await this.ctx.storage.delete(STORAGE_KEYS.notesDirty);
      } catch (error) {
        console.error('[collab] pending notes flush failed, will retry:', error);
      }
    }
    if (
      holdsSchedule(target) &&
      (await this.ctx.storage.get<unknown>(STORAGE_KEYS.scheduleDirty))
    ) {
      await this.materializeSchedule(target, scheduleForRows(doc));
    }
  }

  /**
   * Write the running order into `schedule_slot`, as somebody who may: the
   * last person who edited it, else whoever is connected (every socket here
   * passed the edit gate). The database re-checks `edit:performance` of that
   * person; a refusal tries the next one. Never throws: a failure marks the
   * order dirty (with its editor) for the alarm or the next activation.
   */
  private async materializeSchedule(
    target: ScheduleTarget,
    { slots, dropped }: { slots: ScheduleSlot[]; dropped: number },
  ): Promise<void> {
    if (dropped > 0) {
      console.warn(
        `[collab] ${target.table}/${target.id}: ${dropped} moment(s) the rows cannot hold were left out`,
      );
    }
    const stored = await this.ctx.storage.get<unknown>(STORAGE_KEYS.scheduleEditor);
    const candidates = [
      ...new Set(
        [
          this.lastEditor,
          typeof stored === 'string' ? stored : null,
          ...[...this.getConnections<CollabConnectionState>()].map((c) =>
            isConnectionState(c.state) ? c.state.userId : null,
          ),
        ].filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    let failure: unknown = new Error('nobody to write the running order as');
    for (const userId of candidates) {
      try {
        await replaceScheduleSlots(this.env, userId, target.table, target.id, slots);
        await this.ctx.storage.delete([STORAGE_KEYS.scheduleDirty, STORAGE_KEYS.scheduleEditor]);
        this.broadcastCustomMessage(SCHEDULE_MATERIALIZED);
        return;
      } catch (error) {
        failure = error;
        // 401/403: this person may not write it (any more). Try the next.
        if (error instanceof PostgrestError && (error.status === 401 || error.status === 403)) {
          continue;
        }
        break;
      }
    }

    // The snapshot is authoritative and already committed. Mark the rows
    // dirty so the next alarm / reactivation retries even if the order is
    // never edited again.
    await this.ctx.storage.put<boolean | string>({
      [STORAGE_KEYS.scheduleDirty]: true,
      ...(candidates[0] ? { [STORAGE_KEYS.scheduleEditor]: candidates[0] } : {}),
    });
    console.error('[collab] running order materialization failed, marked dirty:', failure);
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
    if (!isCollabTargetTable(table)) return null;
    return { table, id };
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
    const fields = DOC_FIELDS[target.table];

    const previousMarker = await this.ctx.storage.get<unknown>(STORAGE_KEYS.hydration);
    // The last known-good durable marker is an integrity lower bound. Do not
    // overwrite it while loading: a crash or failed fetch must not erase the
    // version needed to reject a later empty/older snapshot response. The
    // activation-local marker below is the fail-closed loading gate.
    this.hydration = null;

    try {
      const { meta, snapshot: latest } = await loadHydrationInputs(
        target,
        () => fetchTargetMeta(this.env, target.table, target.id, fields.notes),
        () => loadLatestSnapshot(this.env, target.table, target.id),
      );
      assertSnapshotDidNotRegress(previousMarker, target, latest?.version ?? null);

      // Build off to the side. y-partyserver applies this document only
      // after onLoad resolves, so a failed hydrate never exposes partial or
      // empty state to a WebSocket client.
      const hydratedDocument = new Y.Doc();
      let version = latest?.version ?? 0;
      if (latest) {
        Y.applyUpdate(hydratedDocument, latest.snapshot);
      } else if (fields.notes && meta.notes) {
        hydratedDocument.getText(NOTES_FIELD).insert(0, meta.notes);
      }

      // ADR-090 risk 1: a doc that never held the running order (a fresh
      // one, or one saved before P2 with only its notes) is seeded from the
      // rows, once, with the mark IN the doc. And the seed is committed as a
      // snapshot HERE, before any client sees it: a seed that only lived in
      // memory would be seeded again by the next activation, and a client
      // holding both would merge two copies of every moment.
      if (holdsSchedule(target) && !isScheduleSeeded(hydratedDocument)) {
        seedSchedule(
          hydratedDocument,
          await fetchScheduleRows(this.env, target.table, target.id),
        );
        version += 1;
        await saveSnapshot(
          this.env,
          meta.workspace_id,
          target.table,
          target.id,
          Y.encodeStateAsUpdate(hydratedDocument),
          version,
        );
      }

      const marker = createHydratedMarker(target, version);
      await this.ctx.storage.put<string | number | HydratedMarker>({
        [STORAGE_KEYS.workspaceId]: meta.workspace_id,
        [STORAGE_KEYS.version]: version,
        [STORAGE_KEYS.hydration]: marker,
      });
      this.hydration = marker;

      // Reactivation flush: if a prior save left a projection behind
      // (materialize failed, then everyone disconnected so no alarm
      // retried), catch it up now from the authoritative hydrated doc.
      await this.flushPending(target, hydratedDocument);

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
    const fields = DOC_FIELDS[target.table];

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

    // Everything this save writes is read from the doc at ONE instant, the
    // one the snapshot encodes.
    const snapshot = Y.encodeStateAsUpdate(this.document);
    const notes = fields.notes ? this.document.getText(NOTES_FIELD).toString() : null;
    const scheduleChanged = this.scheduleChanged;
    const schedule = holdsSchedule(target) ? scheduleForRows(this.document) : null;
    this.scheduleChanged = false;

    let committed: HydratedMarker;
    try {
      committed = await commitSnapshotThenMaterialize(storedMarker, {
        persistSnapshot: (version) =>
          saveSnapshot(this.env, wsId, target.table, target.id, snapshot, version),
        persistHydration: (marker) =>
          this.ctx.storage.put<number | HydratedMarker>({
            [STORAGE_KEYS.version]: marker.version,
            [STORAGE_KEYS.hydration]: marker,
          }),
        materialize: async () => {
          if (notes !== null) {
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
          }
          // Only when the order changed (or an earlier write is owed): a
          // notes-only save must not rewrite the rows.
          if (
            schedule !== null &&
            holdsSchedule(target) &&
            (scheduleChanged ||
              (await this.ctx.storage.get<unknown>(STORAGE_KEYS.scheduleDirty)))
          ) {
            await this.materializeSchedule(target, schedule);
          }
        },
      });
    } catch (error) {
      // Nothing was materialized: the change is still owed.
      if (scheduleChanged) this.scheduleChanged = true;
      throw error;
    }
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

function isHoursUpdate(value: unknown): value is ScheduleHoursUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const u = value as Partial<ScheduleHoursUpdate>;
  const hours = (h: unknown): boolean =>
    typeof h === 'object' &&
    h !== null &&
    typeof (h as { at?: unknown }).at === 'string' &&
    ((h as { ends_at?: unknown }).ends_at === null ||
      typeof (h as { ends_at?: unknown }).ends_at === 'string');
  return typeof u.id === 'string' && hours(u.from) && hours(u.to);
}
