# Hour — Build prompt: Calendar lens v2 (conflicts · availability · dates · grammar)

> **ARCHIVED — EXECUTED. DO NOT RE-RUN.** Calendar was renamed to Planner.

> **STATUS: EXECUTED 2026-07-18 (autonomous session, branch `calendar-v2`).** Kept as the
> spec of record. Built in the same autonomous pass as the model, under the ADR-078 mandate
> and against the updated `lens-v2.html` mock (pending publish — see the runbook); the old
> gates were consumed rather than skipped: Desk v2's shell (LensSwitcher + calm) had landed
> on main as `77fc9a3` and the branch builds on top of it. UI decisions taken inside the
> mandate + as-built API divergences: sessions-log 2026-07-18 +
> `build/calendar-v2-api-contract.md`. Not merged, not deployed — activation:
> `build/runbooks/calendar-v2-apply.md` (gated on Marco's phrase).
>
> Depends on `calendar-model-prompt.md` (availability_block + date cascade +
> `$lib/calendar.ts`). If not merged yet: build behind a thin adapter, render new sections
> only when endpoints respond — graceful absence.
> Origin: S1 2026-07-17 (ADR-072) + ADR-076 (two projections) + **ADR-078 (grill
> 2026-07-18 — supersedes the old §2/§3/§7/§9 of this file: unified dialog, blackout
> without kind, `?view=` projection, ICS overflow)**. Spec: `build/screen-data-spec.md
> § Calendar`.

## Context

Read first: `apps/web/src/routes/h/calendar/+page.svelte` + `MonthGrid.svelte` (chip
building, pins scope via `perfInScope`/`dateInScope`, feed dialog). Keep their semantics.

## Task

1. **Conflict marks** — `conflictsFor()` from `$lib/calendar.ts` over the fetched month:
   - `people` severity: clash mark on both chips, tooltip naming the shared people.
   - `possible`: softer mark, copy "possible conflict — no team data" (honest degradation,
     never a confirmed clash without roster data).
   - `blackout` / `blackout-tentative`: mark on the event chip; tentative reads as a
     question, not an alarm.
2. **Availability rendering + editing** (ADR-078 §4/§5): blackout bands on day cells —
   company-wide (null person) full-width quiet band, person-level named, tentative dashed.
   "New blackout" dialog fields: **space** (a blackout belongs to ONE workspace — preset
   when the pinned scope collapses to one, explicit select otherwise; no multi-space
   fan-out) · **person** (optional select over **the space's team** = persons in
   `cast_member` ∪ `crew_assignment` deduped, NOT the contacts book; empty = whole
   company) · date range · certainty (unavailable | tentative) · free note (placeholder
   "opcional — no cal dir per què"). **No kind/type pills.** The dialog is the entity's
   editor hosted by the lens (ADR-063 option 2).
3. **Unified create dialog** (ADR-078 §1 — REPLACES the old Performance | Date menu): ONE
   dialog from every "+" (day cell and toolbar), type pills on top. Candidate pills:
   Actuació · Assaig · Viatge · Dia off · Residència · (Premsa?) · Altres — final list
   comes from the converged design; the CRITERION is fixed (a kind earns a pill only if
   something branches on it; otherwise it's Altres + label).
   - **Actuació** mounts the performance form **reused** from `PerformanceCreateDialog`:
     extract its form into a shared component, do NOT fork it. `PerformanceCreateDialog`
     keeps working unchanged everywhere else.
   - Every other pill creates a `date` row; only these show the third cascade level
     (attach to a performance). Cascade: project* → line? (lines of that project) →
     performance?. Presets from pins/context like PerformanceCreateDialog does.
   - **Viatge** shows direction (outbound | return | leg). **Altres** shows the free label
     field with autocomplete over `GET /api/dates/labels`. **"Opció" pill** (date kinds
     only): on → `status='tentative'`, off → `'confirmed'` — never expose the 4-state enum.
   - **Time entry rule (fixes the live timezone bug for every door)**: the typed hour is
     VENUE-LOCAL, labeled ("hora local de Tàrrega"; fallback `workspace.timezone`,
     visible); viewer timezone is display courtesy only. The fix lives in the shared form.
4. **Status filter**: All | Holds only | Confirmed only — client-side over fetched rows.
5. **Hold grammar**: `hold*` statuses render outline, `confirmed`+ render solid — via
   existing tokens/CSS variables (modifiers redeclare variables, not properties). The
   grammar EXTENDS to date chips (ADR-078 §9): `tentative` dates render as possibility
   (dashed/outline), `confirmed` as the quiet solid form.
6. **Time on chips** when known: `load_in_at` ?? `start_at` on performances; `starts_at`
   on non-all-day dates. Venue-local; viewer courtesy shown only when the two differ.
7. **Projections** (ADR-076 + ADR-078 §10): month grid ⇄ agenda list, named toggle
   (never an icon), same data both ways. Canonical URL `/h/calendar?view=agenda` (and the
   workspace variant) — **no `/h/agenda` alias route** (slug stays reserved, ADR-077).
   Persistence: `?view=` → localStorage (per device) → form-factor default (wide → month,
   narrow → agenda). Agenda = same rows grouped by day, pure chronology, mobile-first.
8. **Away bands** (ADR-078 §6): render `awayBands()` output as quiet derived "fora" bands
   between a travel pair. Display-only: not a conflict input, no edit affordance (the
   editable facts are the underlying travel days). Visually distinct from a declared
   blackout — inferred vs stated.
9. **Masthead stats**: counts over the visible month (confirmats · holds · conflictes ·
   blackouts), every figure mapping to real rows. No `read:money` gate — nothing monetary.
10. **ICS feed dialog**: keep it; its entry point moves to a "⋯" overflow menu at the end
    of the toolbar (one-time setup action, not a daily one).

## Constraints

Svelte 5 runes (`$derived` first) · semantic HTML · existing tokens, both themes (ADR-059)
· no new stores/deps · unit-test any new pure helpers (dates injected) · no commits, no
deploys · `svelte-check` 0/0 · short summary + manual verification steps.
