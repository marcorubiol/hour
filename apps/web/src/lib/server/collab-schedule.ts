/**
 * A server-side change to a running order, made THROUGH its collab doc
 * (ADR-090 P2).
 *
 * The doc manda (Marco, 2026-10-10): nothing writes `schedule_slot` around
 * the doc, or the doc's next save would overwrite it. When the server itself
 * has to move a running order (today, one case: a gig relinked to a venue in
 * another zone keeps its wall clock, `reinterpretSlots`), it asks the
 * RoadsheetCollab Durable Object, over the internal door of `onRequest`:
 *
 *   GET  /schedule        → the order as the live doc has it
 *   POST /schedule/hours  → move hours compare-and-set; the DO materializes
 *                           the rows before it answers
 *
 * The DO re-checks that `userId` may write this order and writes the rows as
 * them. The rule (which hours, to what) stays here, in the app: the DO knows
 * the doc, not the domain.
 */

import { reinterpretSlots } from '$lib/schedule-slot';

type ScheduleTarget = 'performance' | 'date';

interface DocSlot {
  id: string;
  at: string;
  ends_at: string | null;
}

interface HoursMoved {
  applied: number;
  skipped: number;
  /** The rows already say it (false: the doc has it, the rows will follow). */
  materialized: boolean;
}

function stubFor(ns: DurableObjectNamespace, target: ScheduleTarget, id: string) {
  // Same name as the WebSocket path (`/api/collab/...`): one doc per target.
  return ns.get(ns.idFromName(`${target}:${id}`));
}

/**
 * Keep the running order's wall clock when its zone changes: every moment's
 * hours are read in `fromTz` and written as the same wall time in `toTz`.
 * Nothing to move (an empty order, or the same zone) asks nothing of the doc.
 */
export async function rezoneScheduleInDoc(
  ns: DurableObjectNamespace,
  target: ScheduleTarget,
  id: string,
  userId: string,
  fromTz: string,
  toTz: string,
): Promise<HoursMoved> {
  const stub = stubFor(ns, target, id);
  const read = await stub.fetch('https://collab.internal/schedule');
  if (!read.ok) throw new Error(`collab schedule read: ${read.status}`);
  const { slots } = (await read.json()) as { slots: DocSlot[] };

  const moved = reinterpretSlots(slots, fromTz, toTz);
  const updates = slots
    .map((s, i) => ({
      id: s.id,
      from: { at: s.at, ends_at: s.ends_at },
      to: { at: moved[i].at, ends_at: moved[i].ends_at },
    }))
    .filter((u) => u.from.at !== u.to.at || u.from.ends_at !== u.to.ends_at);
  if (updates.length === 0) return { applied: 0, skipped: 0, materialized: true };

  const write = await stub.fetch('https://collab.internal/schedule/hours', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hour-collab-user-id': userId },
    body: JSON.stringify({ updates }),
  });
  if (!write.ok) throw new Error(`collab schedule hours: ${write.status}`);
  return (await write.json()) as HoursMoved;
}

/** The doc no longer holds the moment at the time the move starts from. */
export class MomentChangedError extends Error {
  constructor() {
    super('the moment is not at the time the move starts from');
  }
}

/**
 * Move ONE moment's start (121 B, «Mover <moment> a HH:MM»), and nothing
 * else: the other moments keep their hours (Marco, 2026-11-05). Its end stays
 * where it was unless the new start passes it; then the end keeps the
 * moment's length. Compare-and-set: if the doc no longer has the moment at
 * `fromAt` (someone edited it meanwhile), nothing moves and
 * `MomentChangedError` says so.
 */
export async function moveMomentInDoc(
  ns: DurableObjectNamespace,
  target: ScheduleTarget,
  id: string,
  userId: string,
  slotId: string,
  fromAt: string,
  toAt: string,
): Promise<HoursMoved> {
  const stub = stubFor(ns, target, id);
  const read = await stub.fetch('https://collab.internal/schedule');
  if (!read.ok) throw new Error(`collab schedule read: ${read.status}`);
  const { slots } = (await read.json()) as { slots: DocSlot[] };

  const slot = slots.find((s) => s.id === slotId);
  if (!slot || Date.parse(slot.at) !== Date.parse(fromAt)) throw new MomentChangedError();

  const update = {
    id: slot.id,
    from: { at: slot.at, ends_at: slot.ends_at },
    to: { at: new Date(Date.parse(toAt)).toISOString(), ends_at: movedEnd(slot, toAt) },
  };
  const write = await stub.fetch('https://collab.internal/schedule/hours', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hour-collab-user-id': userId },
    body: JSON.stringify({ updates: [update] }),
  });
  if (!write.ok) throw new Error(`collab schedule hours: ${write.status}`);
  const moved = (await write.json()) as HoursMoved;
  if (moved.applied === 0) throw new MomentChangedError();
  return moved;
}

/** The end after moving the start: unchanged, unless the start now passes it. */
export function movedEnd(slot: Pick<DocSlot, 'at' | 'ends_at'>, toAt: string): string | null {
  if (!slot.ends_at) return null;
  const end = Date.parse(slot.ends_at);
  const to = Date.parse(toAt);
  if (end >= to) return slot.ends_at;
  return new Date(to + (end - Date.parse(slot.at))).toISOString();
}
