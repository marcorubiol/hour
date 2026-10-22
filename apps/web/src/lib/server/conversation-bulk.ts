/**
 * El lote de `POST /api/conversations/bulk` (plan de la lista § 6.2, fase 2).
 *
 * Hace lo que haría la fila, con el JWT de quien llama y sin `service_role`:
 * - las columnas («no esta vez», siguiente paso, «no pide respuesta», y su
 *   deshacer) van por un PATCH de PostgREST por grupo de conversaciones que
 *   reciben lo mismo (`id=in.(…)`); la política de UPDATE de `conversation`
 *   deja fuera las que no editas, y la representación dice cuáles cambiaron.
 *   Si el grupo entero falla (un 403 de WITH CHECK, la red), se reintenta una
 *   a una para que el fallo sea solo de la suya;
 * - las etiquetas, por `set_conversation_tags`, una conversación cada vez,
 *   leyendo antes las suyas: se pone o se quita una sin tocar las otras.
 *
 * Sin migración y sin RPC nueva. Lo que no se lee vuelve `not_found`; lo que
 * se lee y no se edita, `forbidden`. Nunca se escribe una fila que no se pidió:
 * todo filtro lleva `id=in.(ids pedidos)`.
 */

import { PostgrestError, pgGet, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { SALES } from '$lib/conversation-tags';
import type { BulkReason, BulkRequest, BulkResult, RestoreItem } from '$lib/conversation-bulk';
import { TURN_EMBEDS, setLastTurnEmbed } from './conversation-overview';

/** Lo que el lote pide a PostgREST: inyectable para los tests. */
export interface BulkPg {
  get<T>(path: string, search: URLSearchParams): Promise<T[]>;
  patch<T>(path: string, body: Record<string, unknown>, search: URLSearchParams): Promise<T[]>;
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T[]>;
}

export function bulkPg(env: SupabaseEnv, jwt: string): BulkPg {
  return {
    get: async (path, search) => (await pgGet(env, path, jwt, { search })).data as never,
    patch: async (path, body, search) => (await pgPatch(env, path, jwt, body, { search })).data as never,
    rpc: async (name, args) => (await pgPostRpc(env, name, jwt, args)).data as never,
  };
}

interface Row {
  id: string;
  workspace_id: string;
  not_now_at: string | null;
  not_now_until: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  reply_settled_at: string | null;
  tagging?: { tag_id: string }[] | null;
  last_turn?: { direction: string | null; occurred_at: string }[] | null;
}

type Columns = NonNullable<RestoreItem['columns']>;

/** Escrituras a la vez, una por conversación (las etiquetas). */
const PARALLEL = 5;

function reasonOf(err: unknown): BulkReason {
  if (err instanceof PostgrestError) {
    if (err.status === 403 || err.code === '42501') return 'forbidden';
    if (err.status === 404) return 'not_found';
  }
  return 'error';
}

async function pool<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) await run(items[next++]);
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
}

class Outcome {
  done = new Set<string>();
  failed = new Map<string, BulkReason>();
  undo: RestoreItem[] = [];
  fail(id: string, reason: BulkReason) {
    if (!this.done.has(id)) this.failed.set(id, reason);
  }
  result(order: readonly string[]): BulkResult {
    const doneIds = new Set(this.done);
    return {
      done: order.filter((id) => doneIds.has(id)),
      failed: order.filter((id) => this.failed.has(id) && !doneIds.has(id)).map((id) => ({ id, reason: this.failed.get(id)! })),
      undo: this.undo.filter((u) => doneIds.has(u.id)),
    };
  }
}

/** Las filas pedidas que quien llama lee; las demás, `not_found`. */
async function readRows(pg: BulkPg, ids: readonly string[], extra: { tags?: boolean; turn?: boolean }): Promise<Map<string, Row>> {
  const select = [
    'id,workspace_id,not_now_at,not_now_until,next_action_at,next_action_note,reply_settled_at',
    extra.tags ? 'tagging:conversation_tagging(tag_id)' : null,
    extra.turn ? TURN_EMBEDS : null,
  ]
    .filter(Boolean)
    .join(',');
  const search = new URLSearchParams({ select, id: `in.(${ids.join(',')})`, deleted_at: 'is.null' });
  if (extra.turn) setLastTurnEmbed(search);
  const rows = await pg.get<Row>('conversation', search);
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Escribe columnas: un PATCH por grupo que recibe lo mismo. Las que vuelven
 * cambiaron; las que no, la política las dejó fuera (`forbidden`).
 */
async function patchColumns(pg: BulkPg, out: Outcome, writes: { id: string; columns: Columns }[]): Promise<void> {
  const groups = new Map<string, { columns: Columns; ids: string[] }>();
  for (const w of writes) {
    const key = JSON.stringify(Object.entries(w.columns).sort(([a], [b]) => a.localeCompare(b)));
    const g = groups.get(key) ?? { columns: w.columns, ids: [] };
    g.ids.push(w.id);
    groups.set(key, g);
  }
  async function patch(ids: string[], columns: Columns): Promise<void> {
    const search = new URLSearchParams({ id: `in.(${ids.join(',')})`, deleted_at: 'is.null', select: 'id' });
    const changed = new Set((await pg.patch<{ id: string }>('conversation', columns, search)).map((r) => r.id));
    for (const id of ids) {
      if (changed.has(id)) out.done.add(id);
      else out.fail(id, 'forbidden');
    }
  }
  for (const { columns, ids } of groups.values()) {
    try {
      await patch(ids, columns);
    } catch (err) {
      if (ids.length === 1) {
        out.fail(ids[0], reasonOf(err));
        continue;
      }
      // El grupo entero cayó: una a una, para que el fallo sea solo de la suya.
      for (const id of ids) {
        try {
          await patch([id], columns);
        } catch (e) {
          out.fail(id, reasonOf(e));
        }
      }
    }
  }
}

function before(row: Row, keys: (keyof Columns)[]): RestoreItem {
  return { id: row.id, columns: Object.fromEntries(keys.map((k) => [k, row[k]])) as Columns };
}

/** La última respuesta que espera: la del turno, si vino de fuera. */
function pendingReply(row: Row): string | null {
  const last = row.last_turn?.[0];
  if (!last || last.direction !== 'inbound') return null;
  if (row.reply_settled_at && Date.parse(row.reply_settled_at) >= Date.parse(last.occurred_at)) return null;
  return last.occurred_at;
}

interface TagVocab {
  /** El id de una clave en un espacio: la propia del espacio, o la estándar. */
  idIn(workspaceId: string, key: string): string | null;
  inactive(workspaceId: string): Set<string>;
}

async function readVocab(pg: BulkPg, key: string, workspaceIds: readonly string[]): Promise<TagVocab> {
  const keys = [...new Set([key, SALES])];
  const [tags, settings] = await Promise.all([
    pg.get<{ id: string; key: string; workspace_id: string | null }>(
      'conversation_tag',
      new URLSearchParams({ select: 'id,key,workspace_id', key: `in.(${keys.join(',')})` }),
    ),
    workspaceIds.length === 0
      ? Promise.resolve([])
      : pg.get<{ workspace_id: string; tag_id: string }>(
          'workspace_conversation_tag_setting',
          new URLSearchParams({ select: 'workspace_id,tag_id', active: 'eq.false', workspace_id: `in.(${workspaceIds.join(',')})` }),
        ),
  ]);
  return {
    idIn: (ws, k) =>
      tags.find((x) => x.key === k && x.workspace_id === ws)?.id ?? tags.find((x) => x.key === k && x.workspace_id === null)?.id ?? null,
    inactive: (ws) => new Set(settings.filter((s) => s.workspace_id === ws).map((s) => s.tag_id)),
  };
}

/**
 * Poner o quitar una etiqueta. Una conversación sin ninguna se lee Difusión
 * (`tagKeysOf`): poner otra le deja también Difusión, y quitar Difusión a una
 * sin etiquetas es quitarle la única (`last_tag`), como el PUT de la ficha,
 * que pide al menos una.
 */
async function tagRows(pg: BulkPg, out: Outcome, rows: Row[], key: string, op: 'add' | 'remove'): Promise<void> {
  const vocab = await readVocab(pg, key, [...new Set(rows.map((r) => r.workspace_id))]);
  await pool(rows, async (row) => {
    const inactive = vocab.inactive(row.workspace_id);
    const target = vocab.idIn(row.workspace_id, key);
    if (!target || inactive.has(target)) return out.fail(row.id, 'tag_unavailable');
    const untagged = (row.tagging ?? []).length === 0;
    const active = (row.tagging ?? []).map((g) => g.tag_id).filter((id) => !inactive.has(id));
    const sales = vocab.idIn(row.workspace_id, SALES);
    const shown = untagged && sales && !inactive.has(sales) ? [sales] : active;
    let next: string[];
    if (op === 'add') {
      if (shown.includes(target)) return void out.done.add(row.id);
      next = [...shown, target];
    } else {
      if (!shown.includes(target)) return void out.done.add(row.id);
      next = shown.filter((id) => id !== target);
      if (next.length === 0) return out.fail(row.id, 'last_tag');
    }
    try {
      await pg.rpc('set_conversation_tags', { p_conversation_id: row.id, p_tag_ids: next });
      out.done.add(row.id);
      out.undo.push({ id: row.id, tag_ids: untagged ? [] : active });
    } catch (err) {
      out.fail(row.id, reasonOf(err));
    }
  });
}

async function restoreTags(pg: BulkPg, out: Outcome, items: RestoreItem[]): Promise<void> {
  await pool(items, async (item) => {
    try {
      await pg.rpc('set_conversation_tags', { p_conversation_id: item.id, p_tag_ids: item.tag_ids });
      out.done.add(item.id);
    } catch (err) {
      out.fail(item.id, reasonOf(err));
    }
  });
}

/** Aplica la acción a cada conversación pedida; nunca aborta por una. */
export async function runConversationBulk(pg: BulkPg, req: BulkRequest, now: Date = new Date()): Promise<BulkResult> {
  const out = new Outcome();
  const ids = req.action === 'restore' ? [...new Set(req.items.map((x) => x.id))] : [...new Set(req.ids)];

  if (req.action === 'restore') {
    const items = req.items.filter((x, i) => req.items.findIndex((y) => y.id === x.id) === i);
    const cols = items.filter((x) => x.columns && Object.keys(x.columns).length > 0);
    await patchColumns(pg, out, cols.map((x) => ({ id: x.id, columns: x.columns! })));
    // Una conversación con columnas y etiquetas no la da ninguna acción; si llega, cuentan las dos.
    const tags = items.filter((x) => x.tag_ids !== undefined);
    const colsFailed = new Set(cols.filter((x) => out.failed.has(x.id)).map((x) => x.id));
    await restoreTags(pg, out, tags.filter((x) => !colsFailed.has(x.id)));
    for (const id of ids) if (!out.done.has(id) && !out.failed.has(id)) out.fail(id, 'error');
    return out.result(ids);
  }

  const rows = await readRows(pg, ids, { tags: req.action === 'tag', turn: req.action === 'settle' });
  for (const id of ids) if (!rows.has(id)) out.fail(id, 'not_found');
  const seen = ids.filter((id) => rows.has(id)).map((id) => rows.get(id)!);

  switch (req.action) {
    case 'not_now': {
      const columns: Columns = { not_now_at: now.toISOString(), not_now_until: req.until ?? null };
      out.undo.push(...seen.map((r) => before(r, ['not_now_at', 'not_now_until'])));
      await patchColumns(pg, out, seen.map((r) => ({ id: r.id, columns })));
      break;
    }
    case 'next_step': {
      const columns: Columns = { next_action_at: req.next_action_at, next_action_note: req.next_action_note || null };
      out.undo.push(...seen.map((r) => before(r, ['next_action_at', 'next_action_note'])));
      await patchColumns(pg, out, seen.map((r) => ({ id: r.id, columns })));
      break;
    }
    case 'settle': {
      const writes: { id: string; columns: Columns }[] = [];
      for (const r of seen) {
        const at = pendingReply(r);
        if (!at) out.fail(r.id, 'not_due');
        else writes.push({ id: r.id, columns: { reply_settled_at: at } });
      }
      out.undo.push(...seen.map((r) => before(r, ['reply_settled_at'])));
      await patchColumns(pg, out, writes);
      break;
    }
    case 'tag':
      await tagRows(pg, out, seen, req.key, req.op);
      break;
  }
  return out.result(ids);
}
