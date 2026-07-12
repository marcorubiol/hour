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
   * the name doesn't fit the expected pattern — we refuse to load/save in
   * that case rather than crashing.
   */
  private parseName(): [table: 'performance' | 'project' | 'line', id: string] | null {
    const [table, id] = this.name.split(':');
    if (!table || !id) return null;
    if (!ALLOWED_TABLES.has(table)) return null;
    return [table as 'performance' | 'project' | 'line', id];
  }

  /**
   * Called by y-partyserver once when the doc is initialized for this DO
   * instance. We seed the Yjs document from the latest snapshot in
   * `collab_snapshot` and cache the workspace_id for subsequent saves.
   */
  override async onLoad(): Promise<Y.Doc | void> {
    const parsed = this.parseName();
    if (!parsed) {
      console.warn('[collab] onLoad: bad name', this.name);
      return;
    }
    const [targetTable, targetId] = parsed;

    // Cache workspace_id once per DO lifecycle. Survives hibernation.
    let wsId = (await this.ctx.storage.get(STORAGE_KEYS.workspaceId)) as string | undefined;
    let seedNotes: string | null = null;
    if (!wsId) {
      try {
        const meta = await fetchTargetMeta(this.env, targetTable, targetId);
        if (meta) {
          wsId = meta.workspace_id;
          seedNotes = meta.notes;
          await this.ctx.storage.put(STORAGE_KEYS.workspaceId, wsId);
        }
      } catch (e) {
        console.warn('[collab] fetchTargetMeta failed:', e);
      }
    }

    try {
      const latest = await loadLatestSnapshot(this.env, targetTable, targetId);
      if (latest) {
        Y.applyUpdate(this.document, latest.snapshot);
        await this.ctx.storage.put(STORAGE_KEYS.version, latest.version);
      } else {
        // Fresh doc — version 0 means "nothing persisted yet". Seed from
        // the notes column so pre-collab text isn't lost on first save.
        await this.ctx.storage.put(STORAGE_KEYS.version, 0);
        if (seedNotes) {
          const text = this.document.getText(NOTES_FIELD);
          if (text.length === 0) text.insert(0, seedNotes);
        }
      }
    } catch (e) {
      console.warn('[collab] loadLatestSnapshot failed:', e);
    }
  }

  /**
   * Called by y-partyserver after callbackOptions thresholds (default: 30
   * updates / 60s). Encodes the full doc state and writes a new
   * `collab_snapshot` row. Skips the write if `workspace_id` couldn't be
   * resolved — better to lose a snapshot than violate the FK.
   */
  override async onSave(): Promise<void> {
    const parsed = this.parseName();
    if (!parsed) return;
    const [targetTable, targetId] = parsed;

    let wsId = (await this.ctx.storage.get(STORAGE_KEYS.workspaceId)) as string | undefined;
    if (!wsId) {
      // Self-heal: onLoad's fetch can fail transiently and onLoad never
      // re-runs while the DO is warm — retry here instead of skipping
      // every save until eviction.
      try {
        const meta = await fetchTargetMeta(this.env, targetTable, targetId);
        if (meta) {
          wsId = meta.workspace_id;
          await this.ctx.storage.put(STORAGE_KEYS.workspaceId, wsId);
        }
      } catch (e) {
        console.warn('[collab] onSave meta retry failed:', e);
      }
    }
    if (!wsId) {
      console.warn('[collab] onSave: missing workspace_id, skipping snapshot');
      return;
    }

    const prev = ((await this.ctx.storage.get(STORAGE_KEYS.version)) as number | undefined) ?? 0;
    const next = prev + 1;

    const snapshot = Y.encodeStateAsUpdate(this.document);

    try {
      await saveSnapshot(this.env, wsId, targetTable, targetId, snapshot, next);
      await this.ctx.storage.put(STORAGE_KEYS.version, next);
    } catch (e) {
      // Most likely cause: unique-violation on (target_table, target_id, version)
      // which means another DO instance racing — rare with idFromName but
      // possible during cold-start migration. Don't bump version on failure;
      // next save retries with the same `next`.
      console.error('[collab] saveSnapshot failed:', e);
    }

    // Materialize the notes text into the target's column so non-collab
    // readers (road sheet projection, detail endpoint) see current content.
    // Best-effort: a failure never blocks the snapshot chain; the next
    // save retries with fresher text anyway.
    try {
      await writeNotesColumn(
        this.env,
        targetTable,
        targetId,
        this.document.getText(NOTES_FIELD).toString(),
      );
    } catch (e) {
      console.error('[collab] writeNotesColumn failed:', e);
    }
  }
}
