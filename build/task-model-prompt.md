# Hour — Build prompt: task model v1 (`from_at` / `due_at` + `lead_days` / API)

> **STATUS: EXECUTED 2026-07-17 (the parallel .zerø build session — see ADR-071).** Everything
> below is live: both migrations applied via MCP (task_entity + task_from_lead), `/api/tasks`
> CRUD, `taskSurfaceState()` in `$lib/task.ts` (day-precise, `now` injected, unit-tested),
> RLS suite (66 green) and e2e. Do NOT re-run this prompt. `desk-prompt.md` (Desk v2) remains
> pending and can build directly on the shipped model.

> Handoff prompt for an external coding agent. Runs FIRST — `desk-prompt.md` depends on it.
> Origin: design+data review S1 (2026-07-17). Decision: `_decisions.md` § ADR-070
> (task types + surfacing rule) and § ADR-069 (consent-first AI). Spec: `build/screen-data-spec.md § Desk`.

## Context

- Repo: SvelteKit 2 + Svelte 5 + Cloudflare Workers + Supabase (Postgres). App in `apps/web`.
- The `task` table landed in `build/migrations/2026-07-17_task_entity.sql` — READ IT FIRST
  (columns, RLS, polymorphic parent CHECK: at most one of project/line/performance/engagement).
  There is no `/api/tasks` endpoint and no UI yet.
- Task model (ADR-070): **anytime** (no dates) · **from** (`from_at` — dormant until then) ·
  **before** (`due_at` + `lead_days` = how many days before due it becomes urgent).
  Urgency is always DERIVED, never stored.

## Task

1. **Migration** — new file `build/migrations/2026-07-17_task_from_lead.sql`, following the
   house style of existing migrations (header docblock: what/why/ADR ref; COMMENT ON COLUMN):
   - `ALTER TABLE public.task ADD COLUMN from_at timestamptz, ADD COLUMN lead_days smallint;`
   - `CHECK (lead_days IS NULL OR lead_days >= 0)`
   - `CHECK (from_at IS NULL OR due_at IS NULL OR from_at <= due_at)`
   - Do **NOT** apply it to any live database. Deliverable = the file + a two-line apply note
     (it gets applied via Supabase MCP/dashboard by the human, as previous migrations were).
2. **RLS**: verify the policies from the task_entity migration cover the new columns (they
   should — row-level, not column-level). State the verification in your summary.
3. **db-types**: regenerate `lib/db-types.ts` per the repo's existing procedure (find how it
   was generated — Supabase typegen). If you cannot run it against a live DB, hand the exact
   command instead and hand-patch the types minimally so `svelte-check` passes.
4. **API** — follow the existing `/api/*` endpoint patterns (Valibot schemas at `+server.ts`
   boundaries, session auth, union-filter contract used by other list endpoints):
   - `GET /api/tasks` — filters: `project_ids` / `workspace_ids` / `line_id` /
     `performance_id` / `engagement_id`, `status` (default `open`). Server order:
     `due_at.asc.nullslast`. Dormant filtering is CLIENT-side (the pure function), don't
     hide rows server-side.
   - `POST /api/tasks` — `{ title (1–200, required), note?, due_at?, from_at?, lead_days?,
     parent: at most one of project_id|line_id|performance_id|engagement_id }`.
     `origin` = `'manual'`. Respect the table CHECKs.
   - `PATCH /api/tasks/:id` — `{ title?, note?, status? (open|done), due_at?, from_at?,
     lead_days? }`.
   - `DELETE /api/tasks/:id` — soft-delete (`deleted_at`), matching the app's convention.
5. **Pure function** in `$lib` (shared with the Desk build):
   `taskSurfaceState(task, now: Date)` → `{ surfacesAt: Date|null, state: 'dormant'|'anytime'|'open'|'urgent'|'overdue'|'done' }`
   - `surfacesAt = max(from_at, due_at − lead_days·days)` (missing parts degrade gracefully;
     no dates at all → `anytime`).
   - `from_at` in the future → `dormant`. Past `due_at` → `overdue`. Between `surfacesAt`
     and `due_at` → `urgent`. Surfaced with no due pressure → `open`.
   - `now` is a PARAMETER — never call `Date.now()` inside. Unit tests with fixed dates
     covering every state + boundary conditions.
6. **RLS test**: add a basic task CRUD test under `tests/rls/` following the pattern of
   `tests/rls/update-workspace.test.ts`.
7. **No data backfill**: engagement next-actions stay engagements this phase (ADR-070).

## Constraints

- No new dependencies. No commits, no deploys (clean-tree guard, ADR-066).
- `svelte-check` 0 errors / 0 warnings; all existing tests still green.
- Short written summary: files touched, RLS verification result, the typegen/apply commands
  for the human.
