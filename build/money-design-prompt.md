# Hour — Design prompt: Money lens (the honest collector)

> **STATUS: EJECUTADO (2026-07-20).** Diseño implementado y desplegado en
> `3b7c95e`, con estados honestos, tokens light/dark y pase responsive.
>
> For the design tool. Origin: S1 2026-07-17 — ADR-074, spec `§ Money`. Research:
> payment delays are a universal top-3 frustration (99-patterns §1.8: Spanish public
> venues 60–90 days; "when they collect, I collect" cascades).

## What Hour is, visually

Calm editorial (large serif, mono small-caps, warm paper, 8 accents, light+dark equal).
Money here is operational truth, not accounting drama: informative reds, no dashboards
shouting.

## The screen: Money lens

Serves both hats with one model: a company collecting from town halls AND a freelancer
collecting from companies.

To design:

1. **Invoice card/row with TWO dates**: contractual (`due`) quiet and secondary;
   **expected** primary — "47 of ~60 days" reads calm; "92 of ~60" escalates (warm →
   restrained red). When expected comes from observed behavior, show provenance:
   "usually pays in ~60 days" — computed, visible, correctable.
2. **Payment progress**: advance+rest reality — a half-paid invoice shows paid-vs-total
   quietly (thin bar or fraction); fully paid derives, no manual flip.
3. **Cascade condition**: the note "pays when the town hall pays — says October" as a
   first-class element on the row, with a "follow up later" action (becomes a task that
   resurfaces on its date).
4. **Record payment** dialog: amount, date, method, reference — small, fast.
5. **By-line rollup with net**: fees − expenses per line; progress bars stay restrained.
6. **Expenses section** (lens level) with per-currency totals — never sum across
   currencies; one total row per currency.
7. **Header totals**: pipeline / invoiced / collected, per currency.

## States & platforms

read:money masked state (suppress silently — masked ≠ zero) · loading/error/empty honest ·
both themes · desktop primary + mobile pass (rows stack, aging stays scannable).

## Deliverable

High-fidelity mockups desktop + mobile, both themes, realistic data: one invoice at 47/~60
(calm), one at 92/~60 with cascade note (escalated), one half-paid (advance received),
a by-line rollup where one line shows net after expenses, header with EUR + one foreign
currency kept separate.
