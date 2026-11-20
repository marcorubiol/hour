/**
 * «AHORA NO» Y LO ANTIGUO EN «TE ESPERA» (revisión TDAH, fase 5; ADR-231).
 *
 * Two ways a row leaves the head of the block without being deleted:
 *
 * - SET ASIDE: the viewer says «ahora no» and picks when it comes back
 *   (tomorrow, in three days, in a week). It is the viewer's alone
 *   (`desk_set_aside`, one row per login); the conversation, task or invoice
 *   is not touched, so it still calls whoever else it calls. On the day it
 *   comes back it is a row again, where it was.
 * - OLD: what has waited more than a month is no longer «today's» and only
 *   weighs. It drops into «Antiguo · N» at the foot, folded, and leaves the
 *   block's count and its «vencidas».
 *
 * Pure: the split is a function of the feed, what is set aside and the day.
 * The session state (one read per start, optimistic writes) is
 * `set-aside.svelte.ts`.
 */
import type { DeskBucket, DeskItem } from './desk-feed';

/** `{ "conv-…": "2026-11-23" }`: a Hoy row's id and the day it comes back. */
export type SetAside = Record<string, string>;

/** The same rule as `set_aside_desk_item` (20261120030000_desk_set_aside). */
export const SET_ASIDE_KEY = /^[a-z]{1,16}-[A-Za-z0-9_:.+-]{1,120}$/;

/** «Ahora no» offers these: tomorrow, in three days, in a week. */
export const SET_ASIDE_SPANS = [1, 3, 7] as const;

/** What has waited more days than this is old. */
export const OLD_AFTER_DAYS = 30;

/** YYYY-MM-DD plus `n` calendar days (date-only, no clock). */
export function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** The day a row comes back, while it is still away; null when it is here. */
export function asideUntil(aside: SetAside, id: string, today: string): string | null {
  const until = aside[id];
  return typeof until === 'string' && until > today ? until : null;
}

/** An item that has waited more than a month (its day, before today − 30). */
export function isOld(item: Pick<DeskItem, 'day'>, today: string): boolean {
  return item.day !== null && item.day < plusDays(today, -OLD_AFTER_DAYS);
}

export interface WaitingSplit {
  /** The feed without what is set aside or old: what the block ranks. */
  feed: DeskBucket[];
  /** Set aside, soonest back first. */
  aside: { item: DeskItem; until: string }[];
  /** Old, oldest first. */
  old: DeskItem[];
}

/** Takes the set-aside and the old rows out of the feed (buckets left empty go too). */
export function splitWaiting(feed: readonly DeskBucket[], aside: SetAside, today: string): WaitingSplit {
  const away: WaitingSplit['aside'] = [];
  const old: DeskItem[] = [];
  const kept: DeskBucket[] = [];
  for (const b of feed) {
    const runs = [];
    for (const r of b.runs) {
      const items = r.items.filter((item) => {
        const until = asideUntil(aside, item.id, today);
        if (until) {
          away.push({ item, until });
          return false;
        }
        if (isOld(item, today)) {
          old.push(item);
          return false;
        }
        return true;
      });
      if (items.length > 0) runs.push(items.length === r.items.length ? r : { ...r, items });
    }
    if (runs.length > 0) kept.push(runs.length === b.runs.length && runs.every((r, i) => r === b.runs[i]) ? b : { ...b, runs });
  }
  away.sort((a, b) => a.until.localeCompare(b.until));
  old.sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''));
  return { feed: kept, aside: away, old };
}
