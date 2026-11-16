/**
 * Expense domain helpers (ADR-056) — the Money module is where the
 * missing expense UI lands. Single home for the category vocabulary and
 * the POST/PATCH contracts shared by the API endpoints and the module.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { t, type Locale } from './i18n';
import { DASH } from './glyphs';
import type { MoneyBolo } from './money';
import type { NavLine } from './nav';

/** All categories in schema enum order (runtime mirror of the DB enum). */
export const EXPENSE_CATEGORIES = Constants.public.Enums.expense_category;

/** A category in the session's language; an unknown value shows as itself. */
export function categoryLabel(category: string, locale: Locale): string {
  const key = `books.cat_${category}`;
  const out = t(key, locale);
  return out === key ? category : out;
}

/** "YYYY-MM-DD that is a real calendar day" — same contract as conversation. */
const realIsoDate = v.pipe(
  v.string(),
  v.isoDate(),
  v.check((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date'),
);

/**
 * POST /api/expenses body. Exactly one of line_id / bolo_id (the endpoint
 * enforces the rule; both stay optional so the error can be specific — same
 * shape as ConversationCreateSchema's person rule). ADR-087: the gig-level cost
 * anchors to the deal (bolo).
 */
export const ExpenseCreateSchema = v.object({
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  bolo_id: v.optional(v.pipe(v.string(), v.uuid())),
  category: v.optional(v.picklist(EXPENSE_CATEGORIES), 'other'),
  description: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  amount: v.pipe(v.number(), v.minValue(0.01), v.maxValue(9_999_999_999.99)),
  currency: v.optional(
    v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(/^[A-Z]{3}$/)),
    'EUR',
  ),
  incurred_on: v.optional(v.nullable(realIsoDate)),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
  // Money v3 (ADR-086 D4) — who was paid.
  counterparty: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  // 79 (ADR-170): who advanced it, a person with a dossier in the space; none
  // = the company paid.
  paid_by_person_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

/**
 * PATCH /api/expenses/:id body — field edits ride a direct PostgREST
 * PATCH (expense_update is not claim-bound and the row stays visible);
 * whitelist keeps scope FKs and money-sensitive columns out. «Devuelto» is
 * not a field edit: it carries its day, so it goes through
 * `POST /api/expenses/:id/reimbursed` (ADR-170).
 */
export const ExpensePatchSchema = v.object({
  category: v.optional(v.picklist(EXPENSE_CATEGORIES)),
  description: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300))),
  amount: v.optional(v.pipe(v.number(), v.minValue(0.01), v.maxValue(9_999_999_999.99))),
  currency: v.optional(v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(/^[A-Z]{3}$/))),
  incurred_on: v.optional(realIsoDate),
  paid_by_person_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type ExpenseItem = Pick<
  Tables<'expense'>,
  | 'id'
  | 'workspace_id'
  | 'bolo_id'
  | 'line_id'
  | 'category'
  | 'description'
  | 'amount'
  | 'currency'
  | 'incurred_on'
  | 'reimbursed'
  | 'notes'
  | 'counterparty'
  | 'created_at'
  | 'paid_by_person_id'
  | 'reimbursed_on'
> & {
  /** The name of who advanced it, from their dossier in the expense's space
      (`GET /api/expenses` adds it); null when nobody did or it is hidden. */
  paid_by_name?: string | null;
};

/** `POST /api/expenses/:id/reimbursed` body: mark or unmark, with its day. */
export const ExpenseReimbursedSchema = v.object({
  reimbursed: v.boolean(),
  on: v.optional(v.nullable(realIsoDate)),
});

/** What is owed to one person of the team: their unreturned advances. */
export interface OwedToPerson {
  personId: string;
  name: string | null;
  items: ExpenseItem[];
  /** Per currency, largest first: amounts never add across currencies. */
  totals: Array<[string, number]>;
}

/**
 * «Se debe al equipo» (ADR-170): the expenses somebody advanced and nobody has
 * returned yet, per person. The person owed most comes first (by the sum of
 * their largest currency), then by name; each person's items oldest first,
 * the order in which they will be paid back.
 */
export function owedToTeam(expenses: readonly ExpenseItem[]): OwedToPerson[] {
  const byPerson = new Map<string, OwedToPerson>();
  for (const e of expenses) {
    if (!e.paid_by_person_id || e.reimbursed) continue;
    let row = byPerson.get(e.paid_by_person_id);
    if (!row) {
      row = { personId: e.paid_by_person_id, name: e.paid_by_name ?? null, items: [], totals: [] };
      byPerson.set(e.paid_by_person_id, row);
    }
    if (!row.name && e.paid_by_name) row.name = e.paid_by_name;
    row.items.push(e);
  }
  const out = [...byPerson.values()];
  for (const row of out) {
    row.items.sort((a, b) => (a.incurred_on ?? '').localeCompare(b.incurred_on ?? ''));
    const sums = new Map<string, number>();
    for (const e of row.items) sums.set(e.currency, (sums.get(e.currency) ?? 0) + Number(e.amount));
    row.totals = [...sums.entries()]
      .map(([c, n]): [string, number] => [c, Math.round(n * 100) / 100])
      .sort((a, b) => b[1] - a[1]);
  }
  const top = (r: OwedToPerson) => r.totals[0]?.[1] ?? 0;
  return out.sort((a, b) => top(b) - top(a) || (a.name ?? '').localeCompare(b.name ?? ''));
}

/** Where an expense hangs: a bolo or a line (ADR-087), and its space. */
export interface ExpenseAnchor {
  /** `bolo:<id>` or `line:<id>`. */
  value: string;
  label: string;
  workspaceId: string;
}

/**
 * What an expense can hang from, among the bolos on screen: the lines they
 * belong to, then the bolos themselves. Cuentas and the shell (163) offer these.
 */
export function expenseAnchors(bolos: MoneyBolo[], lineById: Map<string, NavLine>, locale: Locale): ExpenseAnchor[] {
  const lines = new Map<string, NavLine>();
  for (const b of bolos) {
    const line = b.line_id ? lineById.get(b.line_id) : undefined;
    if (line && !lines.has(line.id)) lines.set(line.id, line);
  }
  return [
    ...[...lines.values()].map((l) => ({
      value: `line:${l.id}`,
      label: t('books.anchor_line', locale, { name: l.name, project: l.projectName }),
      workspaceId: l.workspaceId,
    })),
    ...bolos.map((b) => ({
      value: `bolo:${b.id}`,
      label: t('books.anchor_deal', locale, { where: [b.venue_name, b.city].filter(Boolean).join(', ') || b.project?.name || DASH }),
      workspaceId: b.project?.workspace_id ?? '',
    })),
  ];
}
