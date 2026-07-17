# Hour — Build prompt: Calendar lens v2 (conflicts · availability · dates · grammar)

> Handoff prompt for an external coding agent. Depends on `calendar-model-prompt.md`
> (availability_block + date cascade + `$lib/calendar.ts`). If not merged yet: build behind
> a thin adapter, render new sections only when endpoints respond — graceful absence.
> Origin: S1 2026-07-17, ADR-072. Spec: `build/screen-data-spec.md § Calendar`.

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
2. **Availability rendering + editing**: blackout bands on day cells — company-wide
   (null person) full-width, person-level named. "New blackout" via the per-day "+" menu
   and a small dialog: person (optional select — empty = whole company), date range,
   certainty (unavailable | tentative), kind, note. The dialog is the entity's editor
   hosted by the lens (option 2, ADR-063) — the lens owns no edit logic.
3. **New date creation**: per-day "+" becomes a two-option menu — **Performance | Date**.
   Date dialog: project* + line? (only lines of that project) + performance? + kind +
   title + start/end + all-day + venue/city + travel direction (visible only for kind
   `travel_day`: outbound | return | leg). Presets from pins/context like
   PerformanceCreateDialog does.
4. **Status filter**: All | Holds only | Confirmed only — client-side over fetched rows.
5. **Hold grammar**: `hold*` statuses render outline, `confirmed`+ render solid — via
   existing tokens/CSS variables (modifiers redeclare variables, not properties).
6. **Time on chips** when known: `load_in_at` ?? `start_at` on performances; `starts_at`
   on non-all-day dates. Viewer timezone.
7. **Agenda/list view**: a month | list toggle; list = same rows grouped by day, single
   column — this is the mobile-first rendering of the lens.
8. **Away-days**: do NOT compute in v1 (needs geography + the AI layer). Leave a clearly
   marked extension point where the overlay band would render.
9. ICS feed dialog: untouched.

## Constraints

Svelte 5 runes (`$derived` first) · semantic HTML · existing tokens, both themes (ADR-059)
· no new stores/deps · unit-test any new pure helpers (dates injected) · no commits, no
deploys · `svelte-check` 0/0 · short summary + manual verification steps.
