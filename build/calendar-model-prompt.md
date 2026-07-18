# Hour — Build prompt: calendar model v1 (availability + date cascade + APIs)

> **STATUS: READY TO DISPATCH — NOT STARTED (updated 2026-07-18 post-grill, ADR-078).**
> 0 código: sin migración (`availability_block` / date-cascade / la "Migration C" del gap #8
> no existen), sin `conflictsFor()` en `$lib/calendar.ts`. Corre PRIMERO.
>
> Handoff prompt for an external coding agent. Runs FIRST — `calendar-prompt.md` depends on it.
> Origin: design+data review S1 (2026-07-17). Decisions: `_decisions.md` § ADR-072 (person-based
> conflicts, availability, date cascade, travel) **+ § ADR-078 (grill 2026-07-18: blackout
> WITHOUT `kind` · `day_off` date kind · `awayBands()` travel-bracket inference · "Opció"
> tentative · custom label — this prompt already reflects all of it)**.
> Spec: `build/screen-data-spec.md § Calendar` + `§ Schema gaps #5/#6`.
> **Update 2026-07-17 (later same day)**: gap #8 is now CONFIRMED — Migration C below is IN scope.

## Context

- Repo: SvelteKit 2 + Svelte 5 + Cloudflare Workers + Supabase. App in `apps/web`.
- Read first: `build/migrations/2026-07-17_task_entity.sql` + `_task_from_lead.sql` (the house
  migration style, RLS family, RPC pattern, immutability triggers) and ADR-071 in
  `_decisions.md` (access decision: workspace-member RLS for cross-domain entities, day-level
  date semantics — days, never instants).

## Task

1. **Migration A — `availability_block`** (new file under `build/migrations/`, house style):
   - Columns: `id` uuid v7 PK · `workspace_id` NOT NULL FK → workspace · `person_id` uuid
     NULL FK → person (**null = whole company**) · `starts_on date NOT NULL` ·
     `ends_on date NOT NULL CHECK (ends_on >= starts_on)` · `certainty text NOT NULL
     DEFAULT 'unavailable' CHECK IN ('unavailable','tentative')` · `note text` ·
     `created_by` + timestamps + `deleted_at` (soft-delete).
   - **NO `kind` column** (ADR-078 §4): "no estoy" is complete information — the why, if
     any, is free prose in `note`. Do not add a reason enum.
   - Indexes: `(workspace_id)` active-rows partial; `(workspace_id, starts_on, ends_on)`.
   - House triggers: `updated_at`, audit, immutable `workspace_id`/`created_by`.
   - RLS: workspace-member scoped (the venue/person_note/task family — ADR-071's access
     decision, NOT `has_permission`).
2. **Migration B — `date` cascade + travel + day off**:
   - `ALTER TABLE date ADD COLUMN line_id uuid REFERENCES line(id) ON DELETE SET NULL;`
     + partial index. Integrity: line must belong to the date's project — replicate however
     `performance` enforces its own `line_id`/`project_id` coherence (read it first).
   - `ADD COLUMN travel_direction text CHECK (travel_direction IS NULL OR
     (kind = 'travel_day' AND travel_direction IN ('outbound','return','leg')))`.
   - `ALTER TYPE date_kind ADD VALUE 'day_off';` (ADR-078 §3 — the PLANNED day off while
     on tour, UI label "Dia off"; distinct from the derived away band below). Remember
     `ADD VALUE` cannot run in the same transaction that uses the new value.
2c. **Migration C — user ↔ person bridge** (gap #8, confirmed S1):
   `ALTER TABLE user_profile ADD COLUMN person_id uuid REFERENCES person(id) ON DELETE SET NULL;`
   + partial UNIQUE index (a person claimed by at most one user). Column + regenerated
   types ONLY in this pass — no claim flow yet (claim-by-email lands with the persona
   features).
3. Do **NOT** apply migrations to any live DB — deliver the files + a two-line apply note
   (house channel: Supabase MCP, additive-only, verify with probes; see ADR-071 note).
4. **db-types**: regenerate per house procedure, or hand the command + minimal hand-patch so
   `svelte-check` passes.
5. **API** (existing endpoint patterns + Valibot):
   - `/api/availability` — GET (workspace_ids + from/to window), POST, PATCH, DELETE
     (expense-pattern). No `kind` anywhere.
   - Extend `/api/dates` with POST/PATCH/DELETE: `{ project_id*, line_id?, performance_id?,
     kind, title?, starts_at*, ends_at?, all_day?, venue_name?, city?, country?,
     travel_direction?, status?, label? }` — validate line ∈ project and performance ∈
     project. `status` accepts only `tentative | confirmed` on create (the dialog's
     "Opció" pill, ADR-078 §9; cancelled/done are lifecycle, not creation states).
     `label` (free text, meaningful for kind `other`) is stored as `custom_fields.label` —
     whitelist it explicitly; nothing else writes into custom_fields.
   - `GET /api/dates/labels?workspace_ids=` → distinct non-null `custom_fields->>'label'`
     values, for the Altres autocomplete (ADR-078 §8). Cheap query, no new table.
6. **Pure functions** in `$lib/calendar.ts` (day-precision, `now`/dates injected, unit-tested):
   - `performanceRoster(bundle)` → person ids: project `cast_member` − replaced +
     `cast_override` + `crew_assignment`.
   - `conflictsFor(events, rosters, blackouts)` → conflict pairs with severity:
     `'people'` (shared person, both rosters known) · `'possible'` (same-day, ≥1 roster
     empty — honest "no team data" degradation) · `'blackout'` (event overlaps a blackout
     of an involved person or a company-wide one; tentative blackout → `'blackout-tentative'`).
   - `awayBands(dates)` (ADR-078 §6) → derived "away" day-ranges: an `outbound` travel_day
     on day X paired with the NEXT `return` travel_day on day Y **of the same line
     (fallback: same project)** ⇒ the days strictly between that carry no own event for
     that project form one band `{ from, to, project_id, line_id? }`. Deterministic, no
     geography. Unpaired outbound/return produce NO band (the AI layer proposes missing
     legs later — ADR-069 amended / ADR-078 §7: AI fills missing data, it never computes a
     parallel overlay). Bands are **display-only** in v1: NOT an input to `conflictsFor()`.
7. **Tests**: RLS suite for `availability_block` (+ the new date columns) following
   `tests/rls/` patterns; unit tests for all three functions with fixed dates (away bands:
   paired, unpaired, multi-line interleaving, event-inside-band cases).

## Constraints

No new dependencies · no commits · no deploys (ADR-066 guard) · `svelte-check` 0/0 ·
existing tests green · short written summary (files, apply commands, verification).
