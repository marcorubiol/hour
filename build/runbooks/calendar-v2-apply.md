# Calendar v2 — activation runbook (apply → merge → deploy)

> **GATE: nothing below runs until Marco says the named phrase "APLICA CALENDAR V2".**
> Until then the only valid actions are reading the branch and reviewing. Built
> 2026-07-18 (autonomous session, ADR-078); this runbook is the single path from
> "built on a branch" to "live".

## Current state (as of close-out, 2026-07-18)

- **Built + verified on branch `calendar-v2`**, worktree
  `/Users/marcorubiol/Developer/hour-calendar-v2`. The entire build is
  **uncommitted working-tree changes** on top of `77fc9a3` (main's HEAD at
  close-out) — deliberately, pending Marco's review.
- **Live DB untouched.** The 5 migrations exist as files only
  (`build/migrations/2026-07-18_*.sql`). `db-types.ts` carries a hand-patch
  (marker comment, lines 1–4) standing in for the regen.
- **NOT deployed.** Prod still serves the Phase 0.2 calendar. Because the whole
  design is graceful-absence in both directions (migrations are additive-only;
  the new client tolerates an unmigrated DB), there is **no atomicity
  requirement** — unlike the rename, no step below opens a broken window.
- **Gates at close-out** (re-run at documentation time): `svelte-check` 0/0
  (1538 files) · unit **251/251** (18 files) · RLS **66 passed + 35 skipped**
  — the 35 are the new `availability-block` + `date-cascade` suites, which
  self-skip via live probes while the migrations are unapplied.
- **main is a moving target**: the Desk v2 session is in flight. At close-out
  main was *clean* at `77fc9a3` (its LensSwitcher + calm-store work got
  committed at 11:07) and the calendar branch already builds on that commit —
  the calendar page on the branch already mounts `LensSwitcher`. But expect
  more Desk commits (or uncommitted work) on main before merge; see step 4.
- **Design mock**: the updated Calendar mock lives at
  `/private/tmp/claude-501/-Users-marcorubiol-Zer--System-03-AGENCY-Hour/33ca3ad4-29a0-4fe1-908e-f5efdf15a182/scratchpad/calrev/lens-v2.html`
  — **pending publish to the claude.ai design project**. `/private/tmp` does
  not survive a reboot: publish (or copy it somewhere durable) before
  restarting the Mac.
- As-built contract (endpoints, pure-function signatures, graceful-absence
  table): `build/calendar-v2-api-contract.md`. Decisions: `_decisions.md
  § ADR-078` (+ ADR-071/072 for access + day semantics).

## Steps — in this order, after the phrase

### 1. Apply the 3+2 migrations (Supabase MCP `apply_migration`, additive-only)

All files under `build/migrations/`. The first three are an ordered chain; the
last two are independent but apply them in the same pass:

| # | File | Note |
|---|------|------|
| 1 | `2026-07-18_date_kind_day_off.sql` | **MUST run first and ALONE.** `ALTER TYPE … ADD VALUE` cannot share a transaction with statements that use the new value, and `apply_migration` wraps each migration in one transaction — that's why the ADD VALUE is its own file. |
| 2 | `2026-07-18_date_cascade_travel.sql` | `date.line_id` + `travel_direction` + `day_off`-aware CHECKs. |
| 3 | `2026-07-18_date_write_rpcs.sql` | `create_date` / `delete_date` (references the columns from #2). |
| 4 | `2026-07-18_availability_block.sql` | Table + RLS + `create/delete_availability_block` RPCs. |
| 5 | `2026-07-18_user_profile_person_id.sql` | Column + partial UNIQUE only — no claim flow yet. |

Post-apply probes (SQL via MCP, expect all true):

```sql
select exists (select from pg_tables where tablename = 'availability_block');
select 'day_off'::date_kind;  -- errors if the enum value is missing
select column_name from information_schema.columns
  where table_name = 'date' and column_name in ('line_id','travel_direction');
select proname from pg_proc where proname in
  ('create_date','delete_date','create_availability_block','delete_availability_block');
select column_name from information_schema.columns
  where table_name = 'user_profile' and column_name = 'person_id';
```

### 2. Regenerate db-types + remove the hand-patch

- Supabase MCP `generate_typescript_types` → replace
  `apps/web/src/lib/db-types.ts` wholesale (house procedure, same as the
  shortid-alias session).
- **Delete the marker**: the 4-line comment at the very top starting
  `// hand-patched pending regen (calendar-v2): …`. If the regenerated file
  doesn't include the ADR-078 objects, you regenerated against the wrong
  project — stop.
- `cd apps/web && pnpm check` must stay **0 errors / 0 warnings**.

### 3. RLS suite

```
cd apps/web && pnpm test:rls
```

The `availability-block` + `date-cascade` suites **un-skip themselves** (their
live probes now find the table/columns). Expect **101 passed, 0 skipped**. Any
skip remaining means step 1 or 2 is incomplete.

### 4. Merge `calendar-v2` → main

1. **Commit the branch first.** Everything is working-tree; ADR-066's
   clean-tree guard will refuse the deploy otherwise. Commit only the calendar
   files (the `git status` roster is in the sessions-log entry) — one commit,
   house one-liner style.
2. **Measure main's drift**: `git log 77fc9a3..main --oneline` in
   `~/Developer/hour`. If the Desk session left uncommitted work on main, let
   it land (or stash by its owner) before merging — never merge over someone
   else's dirty tree.
3. Conflicts, if any, concentrate in the files both sessions touch:
   `src/routes/h/calendar/+page.svelte` · `src/routes/h/+layout.svelte` ·
   `src/routes/api/performances/+server.ts` · `MonthGrid.svelte` · the three
   i18n JSONs. **Resolution rule: calendar-v2 owns the calendar internals**
   (MonthGrid contract, AgendaList, `create/` dialogs, `PerformanceForm`,
   `$lib/calendar.ts`/`availability.ts`/`date.ts`, `/api/dates` +
   `/api/availability` + `/api/team`); **main/Desk owns the shell**
   (LensSwitcher component, calm store, desk feed). Where both edited the same
   hunk in a lens page: keep the Desk-side shell wiring and re-apply the
   calendar-side data/props change on top — the branch already integrates
   LensSwitcher, so most of this resolves to "take both". i18n JSONs: union of
   keys, no real conflicts.
4. Post-merge, re-run the three suites: `pnpm check` 0/0 · `pnpm test:unit`
   251+ · `pnpm test:rls` 101.

### 5. Deploy (ADR-066 — commits, not working trees)

```
git push                      # guard warns on unpushed HEAD (unresolvable SHA)
cd apps/web && pnpm run deploy   # assert-clean-tree runs inside the script
```

Collab unchanged by this build → web only, no DO migration concerns.

### 6. Post-deploy probes + e2e

Route-existence probes (unauthenticated; **401 = route deployed, 404 = old
build still live**, same technique as the rename verification):

```
curl -s https://hour.zerosense.studio/health/live
# sha == the merge commit, dirty:false

curl -s -o /dev/null -w '%{http_code}\n' https://hour.zerosense.studio/api/availability   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://hour.zerosense.studio/api/team           # 401
curl -s -o /dev/null -w '%{http_code}\n' https://hour.zerosense.studio/api/dates/labels   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://hour.zerosense.studio/api/dates          # 401 (pre-existing route)
```

e2e: `pnpm build && pnpm test:smoke` (needs `apps/web/.env.test`; remember the
Playwright cache gotcha — `chromium-1217` is corrupt, point `PW_CHROMIUM` at
`chromium_headless_shell-1228`).

Browser sanity pass (authenticated): open the calendar → "+" opens the unified
dialog (type pills; Actuació mounts the shared performance form) → create a
blackout from inside the dialog (person select = the space's team) → create a
Dia off → pair an anada/tornada and check the away band between them →
`?view=agenda` renders + persists per device → conflict marks follow the
grammar (people solid, blackout outline, tentative dashed).

### 7. Worktree cleanup

After the merge is pushed and verified:

```
cd ~/Developer/hour
git worktree remove /Users/marcorubiol/Developer/hour-calendar-v2
git branch -d calendar-v2
```

## Rollback

- **Code**: migrations are additive-only, so the previous Worker build keeps
  working against the migrated schema — `wrangler rollback` (or redeploy the
  pre-merge SHA) is always safe here.
- **DB**: nothing to roll back in normal operation; `day_off` enum value and
  the new columns/table are inert for the old client. Only destructive path
  would be dropping `availability_block` — don't, unless it never shipped rows.
