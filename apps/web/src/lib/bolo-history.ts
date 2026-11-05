/**
 * El bolo como historia (tarea 120, ADR-177, mesa § 8): «¿cuándo nos pagan?».
 *
 * The bolo's life in the order it happened: the deal opened and agreed, the
 * contract out and back, its functions, the invoice, when it falls due, what
 * came in. A line of TODAY splits what happened from what is coming, and says
 * where the money stands in words («vencida hace 3 días»), never as a pill.
 *
 * Pure, without network or clock: `today` (YYYY-MM-DD, the reader's wall
 * clock) and `timeZone` (the reader's, to put a moment on a day) are passed
 * in. Late and due come from `boloMoney` (the same look Cuentas takes), so the
 * record and the ledger can never disagree about whether a bolo is overdue.
 * The words live in the page (i18n); this module only says what, when and in
 * which order.
 */

import { dayInTz } from './datetime';
import { contractState, type BoloMoney, type MoneyBolo, type MoneyInvoiceItem, type PaymentMethod } from './money';

export type BoloEvent =
  /** The deal was opened (the bolo was created), when it was not agreed that same day. */
  | { kind: 'opened'; day: string }
  /** The deal became contracted. */
  | { kind: 'agreed'; day: string }
  | { kind: 'contract_sent'; day: string; signed: boolean }
  | { kind: 'contract_signed'; day: string }
  /** No date: the contract has not gone out. Always among what is coming. */
  | { kind: 'contract_unsent'; day: null }
  | { kind: 'function'; day: string; id: string; slug: string | null; status: string; place: string | null }
  | {
      kind: 'invoice';
      day: string;
      id: string;
      docType: 'factura' | 'proforma';
      number: string | null;
      total: number;
      currency: string;
      payer: string | null;
    }
  /** When the money is expected: the invoice's due date, or its estimate (`source`). */
  | { kind: 'due'; day: string; source: 'explicit' | 'observed' | 'due' | 'default' }
  | { kind: 'payment'; day: string; id: string; amount: number; currency: string; method: PaymentMethod; number: string | null };

/** What the line of today says. */
export type BoloNow =
  | { kind: 'overdue'; days: number }
  | { kind: 'due_today' }
  | { kind: 'due_in'; days: number }
  /** Contracted, and everything it was owed came in. */
  | { kind: 'paid' }
  | { kind: 'cancelled' }
  /** Nothing to say about money today: the line is just «hoy». */
  | { kind: 'plain' };

export interface BoloHistory {
  past: BoloEvent[];
  now: BoloNow;
  future: BoloEvent[];
}

export interface BoloHistoryFunction {
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  venue_name: string | null;
  city: string | null;
}

export interface BoloHistoryPayment {
  id: string;
  amount: number;
  received_on: string;
  method: PaymentMethod;
  deleted_at?: string | null;
}

export interface BoloHistoryInput {
  bolo: Pick<
    MoneyBolo,
    'status' | 'created_at' | 'confirmed_at' | 'contract_sent_at' | 'contract_signed_at' | 'fee_currency'
  >;
  /** The bolo's functions (any status). */
  functions: readonly BoloHistoryFunction[];
  /** The bolo's documents, as `invoicesByBolo` gives them. Drafts and cancelled ones did not happen. */
  docs: readonly MoneyInvoiceItem[];
  /** Payments anchored to the bolo itself (no invoice); the documents bring their own. */
  boloPayments?: readonly BoloHistoryPayment[];
  /** `boloMoney` of this bolo, with the same `today`. */
  money: Pick<BoloMoney, 'owed' | 'overdue' | 'daysLate' | 'aging' | 'doc' | 'contracted' | 'collect'>;
  /** The reader's day, YYYY-MM-DD. */
  today: string;
  /** The reader's IANA zone: a moment (a timestamptz) falls on its day there. */
  timeZone: string;
}

/** Same-day order: the order things happen in a deal. */
const RANK: Record<BoloEvent['kind'], number> = {
  opened: 0,
  agreed: 1,
  contract_sent: 2,
  contract_signed: 3,
  contract_unsent: 4,
  function: 5,
  invoice: 6,
  payment: 7,
  due: 8,
};

const DAY_MS = 86_400_000;
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function boloHistory(input: BoloHistoryInput): BoloHistory {
  const { bolo, money, today, timeZone } = input;
  const momentDay = (at: string) => dayInTz(at, timeZone);
  const events: BoloEvent[] = [];

  const agreed = bolo.confirmed_at ? momentDay(bolo.confirmed_at) : null;
  const opened = bolo.created_at ? momentDay(bolo.created_at) : null;
  if (opened && opened !== agreed) events.push({ kind: 'opened', day: opened });
  if (agreed) events.push({ kind: 'agreed', day: agreed });

  const contract = contractState(bolo);
  if (bolo.contract_sent_at) {
    events.push({ kind: 'contract_sent', day: momentDay(bolo.contract_sent_at), signed: contract === 'signed' });
  }
  if (bolo.contract_signed_at) events.push({ kind: 'contract_signed', day: momentDay(bolo.contract_signed_at) });
  if (contract === 'unsent' && bolo.status !== 'cancelled') events.push({ kind: 'contract_unsent', day: null });

  for (const f of input.functions) {
    events.push({
      kind: 'function',
      day: f.performed_at.slice(0, 10),
      id: f.id,
      slug: f.slug,
      status: f.status,
      place: f.venue_name || f.city || null,
    });
  }

  const seen = new Set<string>();
  for (const d of input.docs) {
    if (d.status === 'draft' || d.status === 'cancelled') continue;
    events.push({
      kind: 'invoice',
      day: d.issued_on.slice(0, 10),
      id: d.id,
      docType: d.doc_type,
      number: d.number,
      total: Number(d.total),
      currency: d.currency,
      payer: d.payer?.name ?? null,
    });
    for (const p of d.payments) {
      if (p.deleted_at || seen.has(p.id)) continue;
      seen.add(p.id);
      events.push({
        kind: 'payment',
        day: p.received_on.slice(0, 10),
        id: p.id,
        amount: Number(p.amount),
        currency: d.currency,
        method: p.method,
        number: d.number,
      });
    }
  }
  const boloCurrency = bolo.fee_currency ?? 'EUR';
  for (const p of input.boloPayments ?? []) {
    if (p.deleted_at || seen.has(p.id)) continue;
    seen.add(p.id);
    events.push({
      kind: 'payment',
      day: p.received_on.slice(0, 10),
      id: p.id,
      amount: Number(p.amount),
      currency: boloCurrency,
      method: p.method,
      number: null,
    });
  }

  // When the money is due: only while something is owed on an issued document.
  const dueOn = money.owed > 0 ? (money.aging?.expectedOn ?? null) : null;
  if (dueOn && money.aging) events.push({ kind: 'due', day: dueOn, source: money.aging.source });

  const order = (a: BoloEvent, b: BoloEvent) =>
    (a.day ?? '').localeCompare(b.day ?? '') || RANK[a.kind] - RANK[b.kind];
  // What happened today is history already: the line goes under it.
  const past = events.filter((e) => e.day !== null && e.day <= today).sort(order);
  const dated = events.filter((e) => e.day !== null && e.day > today).sort(order);
  // An undated step (the contract not yet out) is the next thing to do.
  const future = [...events.filter((e) => e.day === null), ...dated];

  return { past, now: boloNow(bolo.status, money, dueOn, today), future };
}

function boloNow(
  status: string,
  money: BoloHistoryInput['money'],
  dueOn: string | null,
  today: string,
): BoloNow {
  if (money.overdue && money.daysLate > 0) return { kind: 'overdue', days: money.daysLate };
  if (dueOn) {
    if (dueOn === today) return { kind: 'due_today' };
    if (dueOn > today) return { kind: 'due_in', days: daysBetween(today, dueOn) };
  }
  if (status === 'cancelled') return { kind: 'cancelled' };
  if (money.contracted && money.collect === 'full') return { kind: 'paid' };
  return { kind: 'plain' };
}
