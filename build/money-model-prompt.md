# Hour — Build prompt: money model v1 (expected_on + payments API + expenses union)

> Handoff prompt for an external coding agent. Runs FIRST — `money-prompt.md` depends on it.
> Origin: S1 2026-07-17, ADR-074. Spec: `build/screen-data-spec.md § Money` + `§ gaps #9`.

## Context

- Read first: house migration style (`build/migrations/2026-07-17_task_*.sql`), ADR-071
  access decisions, `rls-policies.sql` (payment/invoice policies — `read:money`/`edit:money`
  family), existing `/api/invoices` + `/api/expenses` handlers.
- `payment` table exists since v2 (advance+rest, N per invoice) with ZERO API/UI.

## Task

1. **Migration — invoice expectation columns** (house style, additive):
   - `ALTER TABLE invoice ADD COLUMN expected_on date, ADD COLUMN payment_condition text;`
   - COMMENTs: expected_on = realistic collection date (vs contractual due_on; aging
     measures against this); payment_condition = what the user knows about a cascade
     condition ("pays when the town hall pays them — says October").
   - Do NOT apply to live DB; deliver file + apply note (house channel: Supabase MCP).
2. **Payments API** — `/api/payments` following the expense pattern + Valibot:
   - GET (by `invoice_id` or workspace/window), POST `{invoice_id, amount>0, received_on,
     method (transfer|card|cash|other), reference?, notes?}`, DELETE (soft).
   - **Derived paid rule (server-side, ADR-074)**: after POST, if Σ active payments ≥
     invoice.total and status='issued' → set status='paid'. After DELETE, if Σ < total and
     status='paid' → back to 'issued'. Audit-logged like any status change.
   - Verify RLS covers payment CRUD (`edit:money` to write, `read:money` to read); extend
     policies if v2 left holes — state the verification.
3. **Invoices API**: extend PATCH/POST with `expected_on`, `payment_condition`,
   `payer_person_id`; GET embeds payments sum (or include payments in the select).
4. **Expenses union**: extend `/api/expenses` GET to accept `project_ids`/`workspace_ids`
   (resolving line/performance parents server-side) — the lens-level union (known Shelf
   item, now decided).
5. **Pure functions** in `$lib/money.ts` (unit-tested, dates injected):
   - `observedPayerTermsDays(invoices, payments)` → per payer: median issued_on → final
     payment received_on delta (null under 2 samples — no fake confidence).
   - `agingState(invoice, payments, today)` → `{expectedOn (explicit ?? issued+observed ??
     due_on), daysRunning, state: 'within' | 'approaching' | 'past-expected' | 'paid'}`.
6. Tests: RLS for payments; unit for both functions with fixed dates.

## Constraints

No new deps · no commits · no deploys (ADR-066) · `svelte-check` 0/0 · existing tests
green · summary with apply commands + RLS verification result.
