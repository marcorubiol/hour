/**
 * Expense domain helpers (ADR-056) — the Money module is where the
 * missing expense UI lands. Single home for the category vocabulary and
 * the POST/PATCH contracts shared by the API endpoints and the module.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';

export type ExpenseCategory = Enums<'expense_category'>;

/** All categories in schema enum order (runtime mirror of the DB enum). */
export const EXPENSE_CATEGORIES = Constants.public.Enums.expense_category;

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  travel: 'Travel',
  lodging: 'Lodging',
  per_diem: 'Per diem',
  freight: 'Freight',
  production: 'Production',
  fees: 'Fees',
  other: 'Other',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as ExpenseCategory] ?? category;
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
});

export type ExpenseCreate = v.InferOutput<typeof ExpenseCreateSchema>;

/**
 * PATCH /api/expenses/:id body — field edits ride a direct PostgREST
 * PATCH (expense_update is not claim-bound and the row stays visible);
 * whitelist keeps scope FKs and money-sensitive columns out.
 */
export const ExpensePatchSchema = v.object({
  category: v.optional(v.picklist(EXPENSE_CATEGORIES)),
  description: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300))),
  amount: v.optional(v.pipe(v.number(), v.minValue(0.01), v.maxValue(9_999_999_999.99))),
  currency: v.optional(v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(/^[A-Z]{3}$/))),
  incurred_on: v.optional(realIsoDate),
  reimbursed: v.optional(v.boolean()),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type ExpensePatch = v.InferOutput<typeof ExpensePatchSchema>;

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
>;
