/**
 * The Desk as a dashboard (ADR-117): the arithmetic of the bands that are not
 * «Te espera» (that one is `rankWaiting` in $lib/desk-feed). Pure, `now`
 * injected, no words: every label is the page's.
 *
 *   «Lo siguiente»   → `computePulse` ($lib/pulse), the rail's own truth.
 *   «Voy · no voy»   → `goingAsks`: what Hour guesses you are on, unanswered.
 *   «Ha cambiado»    → `changesSince`: threads, replies, the last send, payments.
 *   «La temporada»   → `plannerDoor`: the Planner's own figures, same window.
 */
import { addDaysIso } from './planner';
import { dateDayKey, perfDayKey, type DateEvent, type PerformanceEvent } from './month-events';
import type { PersonAttributionScope } from './people';
import type { HotRow, LastMailout } from './conversation-overview';
import type { FeedThread } from './threads';
import type { MoneyBolo, MoneyInvoiceItem } from './money';

const DAY_MS = 86_400_000;

// ── Voy · no voy ─────────────────────────────────────────────────────────

interface GoingAsk {
  of: 'performance' | 'date';
  id: string;
  day: string;
  row: PerformanceEvent | DateEvent;
}

/**
 * The rows of the next `days` days that count you IN BY INFERENCE (the
 * project's cast, nobody said «voy» or «no voy»): the questions Hour has for
 * you. A roster or an answer is a fact and asks nothing; an `unattributed`
 * row is the company's day, not a guess about you (ADR-103, as the rail).
 * Without a person behind the login the axis is inactive and nothing asks.
 */
export function goingAsks(
  input: {
    performances: readonly PerformanceEvent[];
    dates: readonly DateEvent[];
    axis: PersonAttributionScope;
    viewerTz: string;
  },
  today: string,
  days: number,
  exclude: ReadonlySet<string> = new Set(),
): GoingAsk[] {
  if (!input.axis.active) return [];
  const last = addDaysIso(today, days);
  const out: GoingAsk[] = [];
  for (const p of input.performances) {
    if (p.status === 'cancelled' || exclude.has(p.id)) continue;
    const day = perfDayKey(p);
    if (day < today || day > last) continue;
    const verdict = input.axis.attribute({
      projectId: p.project?.id ?? null,
      day,
      roster: p.person_ids,
      commitments: p.commitments,
    });
    if (verdict === 'inferred') out.push({ of: 'performance', id: p.id, day, row: p });
  }
  for (const d of input.dates) {
    if (d.status === 'cancelled' || exclude.has(d.id)) continue;
    const day = dateDayKey(d, input.viewerTz);
    if (day < today || day > last) continue;
    const verdict = input.axis.attribute({ projectId: d.project?.id ?? null, day, commitments: d.commitments });
    if (verdict === 'inferred') out.push({ of: 'date', id: d.id, day, row: d });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// ── Ha cambiado ──────────────────────────────────────────────────────────

/** How many lines «Ha cambiado» draws. */
export const CHANGED_ROWS = 5;
/** With no visit on file, «since» is this far back. */
const FIRST_VISIT_DAYS = 7;
/** The last send stays news this long after it went out. */
const MAILOUT_NEWS_DAYS = 14;

export type Change =
  | { kind: 'thread'; at: string; thread: FeedThread }
  | { kind: 'reply'; at: string; row: HotRow }
  | { kind: 'mailout'; at: string; mailout: LastMailout }
  | { kind: 'payment'; at: string; payment: PaymentNews };

/** A payment as `/api/payments?recorded_since=…&others=1` returns it. */
export interface RecordedPayment {
  id: string;
  invoice_id: string | null;
  bolo_id: string | null;
  amount: number;
  created_at: string;
}

/** «Cobrado X»: a payment someone else recorded, named by its deal. */
interface PaymentNews {
  id: string;
  at: string;
  amount: number;
  currency: string | null;
  /** The deal it pays, straight or through its invoice; null when neither says. */
  bolo: Pick<MoneyBolo, 'id' | 'venue_name' | 'city' | 'project'> | null;
  /** The invoice's payer, when there is no deal to name it by. */
  payer: string | null;
}

/**
 * A payment recorded since the last visit is the one money event Hour can
 * read as news without a history (ADR-133): the row is append-only, with its
 * own `created_at`. It is named by its deal (the bolo it hangs from, or the
 * one its invoice bills), in the deal's currency. A status change has no
 * such trace, so it is not here.
 */
export function paymentNews(
  payments: readonly RecordedPayment[],
  bolos: ReadonlyMap<string, MoneyBolo>,
  invoices: ReadonlyMap<string, Pick<MoneyInvoiceItem, 'currency' | 'lines' | 'payer'>>,
): PaymentNews[] {
  const out: PaymentNews[] = [];
  for (const p of payments) {
    if (!(Number(p.amount) > 0)) continue;
    const inv = p.invoice_id ? invoices.get(p.invoice_id) : undefined;
    const boloId = p.bolo_id ?? inv?.lines.find((l) => l.bolo_id)?.bolo_id ?? null;
    const bolo = boloId ? (bolos.get(boloId) ?? null) : null;
    out.push({
      id: p.id,
      at: p.created_at,
      amount: Number(p.amount),
      currency: inv?.currency ?? bolo?.fee_currency ?? null,
      bolo,
      payer: inv?.payer?.name ?? null,
    });
  }
  return out;
}

/** The instant «since» means: the stored last visit, or a week back. */
export function sinceInstant(lastVisit: string | null, now: Date): string {
  const at = lastVisit ? Date.parse(lastVisit) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : new Date(now.getTime() - FIRST_VISIT_DAYS * DAY_MS).toISOString();
}

/** How long ago the last visit was, in the unit that reads: minutes, hours, days. */
export function elapsedSince(since: string, now: Date): { unit: 'min' | 'h' | 'd'; n: number } {
  const ms = Math.max(0, now.getTime() - Date.parse(since));
  const min = Math.floor(ms / 60_000);
  if (min < 60) return { unit: 'min', n: Math.max(1, min) };
  const h = Math.floor(min / 60);
  if (h < 24) return { unit: 'h', n: h };
  return { unit: 'd', n: Math.floor(h / 24) };
}

/**
 * What moved since the last visit (ADR-117): team threads with new messages
 * written after it, rooms whose latest word is theirs and came after it (the
 * «caliente» rows of the Conversations overview whose turn is ours, unless
 * «Te espera» already holds them), and the last send while it is recent.
 * Newest first, at most `CHANGED_ROWS`.
 *
 * Payments recorded by someone else after it (`paymentNews`, ADR-133) are
 * news too. Status changes stay out: nothing records when a bolo or a
 * performance changed status, or from what (`updated_at` moves on any
 * edit), and the Desk does not invent a history it cannot read.
 */
export function changesSince(
  input: {
    threads: readonly FeedThread[];
    hot: readonly HotRow[];
    lastMailout: LastMailout | null;
    /** `paymentNews`, already read from `since` on. */
    payments?: readonly PaymentNews[];
  },
  since: string,
  now: Date,
  /** Conversations «Te espera» already asks you to answer: not news twice. */
  waiting: ReadonlySet<string> = new Set(),
): Change[] {
  const after = Date.parse(since);
  const out: Change[] = [];
  for (const th of input.threads) {
    if (th.unread_count > 0 && Date.parse(th.last_message_at) > after) {
      out.push({ kind: 'thread', at: th.last_message_at, thread: th });
    }
  }
  for (const row of input.hot) {
    if (waiting.has(row.id)) continue;
    if (row.turn === 'ours' && row.at && Date.parse(row.at) > after) out.push({ kind: 'reply', at: row.at, row });
  }
  const m = input.lastMailout;
  // A send that reached nobody is not news (a draft queued empty, a test).
  if (m?.queued_at && m.figures.recipients > 0 && now.getTime() - Date.parse(m.queued_at) <= MAILOUT_NEWS_DAYS * DAY_MS) {
    out.push({ kind: 'mailout', at: m.queued_at, mailout: m });
  }
  for (const p of input.payments ?? []) {
    if (Date.parse(p.at) > after) out.push({ kind: 'payment', at: p.at, payment: p });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, CHANGED_ROWS);
}

// ── La temporada: la puerta del Planner ─────────────────────────────────

export interface PlannerDoor {
  confirmed: number;
  holds: number;
  /** Travel days on the calendar in the window. */
  travel: number;
  /** What the Season lists under «Choques» ($lib/season `clashesInSeason`). */
  clashes: number;
}

/**
 * The Planner door says what the Planner's portada says (ADR-120): its
 * window is twelve weeks from today (`seasonWindow`), and confirmed, holds
 * and clashes are the Planner's own figures (`createPlannerEngine` census
 * and `clashesInSeason`), handed in, never recounted here: a proposal is an
 * option on paper there, so it is one here. Travel days, the door's own
 * line, are dates of kind `travel_day`. Cancelled rows count nowhere.
 */
export function plannerDoor(
  census: { confirmed: number; holds: number; clashes: number },
  input: { dates: readonly DateEvent[]; viewerTz: string },
  window: { from: string; to: string },
): PlannerDoor {
  let travel = 0;
  for (const d of input.dates) {
    if (d.status === 'cancelled' || d.kind !== 'travel_day') continue;
    const day = dateDayKey(d, input.viewerTz);
    if (day >= window.from && day <= window.to) travel++;
  }
  return { confirmed: census.confirmed, holds: census.holds, clashes: census.clashes, travel };
}
