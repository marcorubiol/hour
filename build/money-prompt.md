# Hour — Build prompt: Money lens v2 (payments · expected aging · expenses · net)

> **STATUS: DISPATCHED — NOT STARTED (verificado 2026-07-17).** 0 código; depende del model (no construido). La UI viva sigue siendo la de Phase 0.3 (facturas draft→issued→paid + edición de fee).
>
> Handoff prompt for an external coding agent. Depends on `money-model-prompt.md` (columns,
> payments API, union expenses, `$lib/money.ts`). If not merged: thin adapter, graceful
> absence. Origin: S1 2026-07-17, ADR-074. Spec: `build/screen-data-spec.md § Money`.

## Context

Read first: `apps/web/src/routes/h/money/+page.svelte` (totals, by-line rollup, fees table,
invoices list, fee editor + New invoice dialogs). Keep semantics; by-line grouping STAYS.
`read:money` gating unchanged: fee fields arrive NULLed when masked — suppress, never zero.

## Task

1. **Payments**: invoice row expands → payments list (`received_on · method · amount ·
   reference`) + "Record payment" (amount, date, method, reference — the entity's editor
   hosted by the lens). Paid-vs-total shown quietly (text or thin bar); status derives
   server-side — reflect, don't flip locally.
2. **Expected aging**: per issued invoice show `agingState()` — "{n} of {expected} days".
   Calm within expectation, escalating tone past it (tokens, not hardcoded colors).
   `expected_on` inline-editable; when defaulted from observed payer terms, show the
   provenance transparently ("suele pagar a ~60 días" pattern — the trust contract:
   computed values are visible and correctable, ADR-070/072 style).
3. **Cascade condition**: `payment_condition` note visible on the row; action "follow up
   later" → creates a task via `/api/tasks` (live) with `from_at` = expected_on and title
   "Ask {payer} if they've collected" — surfaces in the Desk per ADR-070.
4. **Payer** select (persons for now) in the New invoice dialog; shown on invoice rows.
5. **Expenses section** at lens level (union API, pins-scoped) with per-currency totals;
   **net per line** in the by-line rollup (fees − expenses, only when expenses exist).
6. **Per-currency totals** in the header (one row per currency — never sum across).
7. **VAT/IRPF breakdown** on invoice expand (columns exist).

## Constraints

Svelte 5 runes (`$derived` first) · semantic HTML · tokens, both themes (ADR-059) · no new
stores/deps · reuse query caches, invalidate `['invoices']`/`['money-performances']`/
`['tasks','open']` correctly · unit-test any new pure helpers · no commits/deploys ·
`svelte-check` 0/0 · summary + manual verification.
