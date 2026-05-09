/**
 * RoadsheetCollab — per-document Durable Object for collaborative Yjs
 * editing of `show.notes` / `project.notes` (and future text fields).
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
import { fetchWorkspaceId, loadLatestSnapshot, saveSnapshot } from './persistence';

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

const ALLOWED_TABLES = new Set(['show', 'project']);

// Avoid deploying a "headless" DO that accepts traffic but can't persist.
class RoadsheetCollabBase extends Server<CollabEnv> {
  // Inherit fetch/onConnect/onClose from partyserver — they handle the
  // WebSocket lifecycle. We only customize the Yjs persistence hooks.
}

const WithYjs = withYjs(RoadsheetCollabBase);

export class RoadsheetCollab extends WithYjs {
  /**
   * Resolve `[targetTable, targetId]` from `this.name`. Returns null when
   * the name doesn't fit the expected pattern — we refuse to load/save in
   * that case rather than crashing.
   */
  private parseName(): [table: 'show' | 'project', id: string] | null {
    const [table, id] = this.name.split(':');
    if (!table || !id) return null;
    if (!ALLOWED_TABLES.has(table)) return null;
    return [table as 'show' | 'project', id];
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
    if (!wsId) {
      try {
        wsId = (await fetchWorkspaceId(this.env, targetTable, targetId)) ?? undefined;
        if (wsId) await this.ctx.storage.put(STORAGE_KEYS.workspaceId, wsId);
      } catch (e) {
        console.warn('[collab] fetchWorkspaceId failed:', e);
      }
    }

    try {
      const latest = await loadLatestSnapshot(this.env, targetTable, targetId);
      if (latest) {
        Y.applyUpdate(this.document, latest.snapshot);
        await this.ctx.storage.put(STORAGE_KEYS.version, latest.version);
      } else {
        // Fresh doc — version 0 means "nothing persisted yet".
        await this.ctx.storage.put(STORAGE_KEYS.version, 0);
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

    const wsId = (await this.ctx.storage.get(STORAGE_KEYS.workspaceId)) as string | undefined;
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
  }
}
