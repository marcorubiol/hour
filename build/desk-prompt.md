# Hour — Build prompt: Desk v2 (four sources + task surfacing)

> Handoff prompt for an external coding agent. Depends on `task-model-prompt.md` —
> **which is EXECUTED and LIVE (ADR-071)**: both migrations applied, `/api/tasks` CRUD,
> `taskSurfaceState()` unit-tested. No adapter needed — build directly on the shipped model.
> Origin: S1 2026-07-17. Decisions: ADR-065 (Desk = the home digest), ADR-068 (every scope
> path lands on `/h/desk`), ADR-069 (consent-first AI inbox), ADR-070 (task model),
> ADR-075 (the entity is `conversation`, not `conversation` — vocabulary below is post-rename).
> Spec: `build/screen-data-spec.md § /h/desk`.

> **v1 already on the page — ABSORB OR REPLACE, never duplicate.** The build session
> (ADR-071) left `/h/desk` with a v1 Tasks section: quick-add composer for free workspace
> tasks (space select, derived default from pins) + a `TaskBoard` list (dormant hidden,
> ranked overdue → urgent → open → anytime, out-of-scope toast on add). This build supersedes
> that section with the mixed feed. Pieces built to be REUSED here:
> - `taskSurfaceState()` + `taskProjectId()` + `taskContextLabel()` in `$lib/task.ts`
>   (day-precise calendar-date math, `now` injected — do not reintroduce instant compares);
> - `TaskBoard.svelte` (optimistic done-toggle with cache rollback, remove, state chips) —
>   extend or replace it, but keep its mutation semantics;
> - the shared query key `['tasks','open']` (one cache entry with the v1 section — rename in
>   all consumers or none) and the `['line-tasks', id]` prefix its mutations invalidate
>   (the Tasks line module reads it).

## Context

- `/h/desk` renders `DeskBoard.svelte` — READ IT FIRST and keep its semantics: conversation
  working set (`next_action_at != null`, status ∉ {declined, dormant}), verb per status,
  day buckets OVERDUE / TODAY / TOMORROW / weekday / NEXT WEEK / LATER, pins scope via
  `usePins` + `engInScope`.
- Desk is the ONLY catch-up surface (ADR-068) and was judged "least useful screen" in real
  use with one source. This build makes it the ranked "what needs me" feed.

## Task

One ranked feed, four sources, grouped in day buckets. **Within each bucket the type order
is FIXED (Marco, 2026-07-18; spec § /h/desk): tasks → calendar → conversations → money** —
mirroring the lens nav. The left gutter labels each row's type in mono small-caps, SINGULAR
(locale-resolved; AGENDA = timed `date` rows, pointing at the Calendar lens's agenda
projection per ADR-076). Within each type-block, natural secondary sort (calendar by time,
conversations by due, money by severity). Buckets: existing six + an **Anytime** quiet tail.

1. **Conversation next-actions** — as today.
2. **Tasks** — `GET /api/tasks` (pins-scoped like other sources):
   - Bucket by `taskSurfaceState().surfacesAt` (the shared `$lib` function). `dormant` rows
     are NEVER rendered. `anytime` → the quiet tail. `overdue` → OVERDUE bucket.
   - Row: done-toggle (PATCH status) + title + parent entity link (project/line/performance/
     conversation, resolved via the shared caches) + meta "due {day} · surfaces {day}" when
     dated — the computed surfacing is VISIBLE and the row links to editing `lead_days`
     (inline editor or micro-dialog; keep it one tap).
   - `origin` badge only for `protocol` / `ai`. **`ai` rows are proposals (consent inbox,
     ADR-069)**: visually marked; actions = accept (stays as normal open task) / dismiss
     (PATCH status done, no celebration).
3. **Performances as day-anchors** — from `['today-performances']`-style query: a
   non-cancelled gig today/tomorrow renders as the HEADLINE of its bucket (bigger than rows):
   venue/city + `load_in_at` in the VENUE's zone with viewer courtesy only when they differ
   (timezone rule — use `dualTime()`; fallback zone = workspace home tz, never the browser's
   silently), linking to the performance page.
4. **Money alerts** — computable client-side from existing endpoints, shown only when the
   viewer has fee visibility (fee fields arrive non-null; if masked, suppress the section
   silently — masked and unset are indistinguishable by design):
   - invoices `status=issued` with `due_on < today` → "Invoice {number} overdue {n} days"
     → link `/h/money`.
   - performances `status=done` with no `invoice_line.performance_id` referencing them →
     "Gig done, no invoice yet" → link `/h/money`.
5. **`date` events** today/tomorrow (rehearsal, travel_day, press…): small chip rows —
   title ?? kind, project dot.
6. **Quick capture** — one unobtrusive input line at the top: Enter → `POST /api/tasks`
   `{title}` (anytime, no parent), optimistic append to the Anytime tail; Esc clears.

Scope: apply the pins resolution to ALL sources exactly as `engInScope` does today.
States: honest loading / error / empty per the app's pattern; the empty feed message should
read as an achievement, not an error (tie to the hall's "Tot tranquil" voice).

## Constraints

- Svelte 5 runes (`$derived` over `$state`+`$effect`), semantic HTML, existing tokens only,
  both themes verified (ADR-059). No new global stores, no new dependencies.
- Reuse shared query caches (`['conversations','today']` etc.) — never duplicate a cache key
  with different params.
- Unit-test the merge/bucketing function (pure, `now` injected).
- No commits, no deploys. `svelte-check` 0/0; existing tests green. Short written summary
  + how to verify manually.
