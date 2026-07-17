# Hour — Playwright test user setup

One-time provisioning so the e2e suite (`tests/*.spec.ts`) and the RLS
integration suite (`tests/rls/*.test.ts`) can run against `hour-phase0`.
Re-run idempotently on password rotation.

## What this gets you (state as of 2026-07-02)

A dedicated auth user `playwright@hour.test` with `workspace_membership`
in THREE workspaces (all as `admin`, all with `accepted_at`):

- **`marco-rubiol`** — the original smoke target (real data, read-mostly).
- **`muk-cia`** — person/contacts specs write notes here (self-cleaning).
- **`playwright`** — the FIXTURE workspace: project `zzz-e2e-collab` with
  gigs `zzz-e2e-1` / `zzz-e2e-2`. Write-path specs (conversation,
  performance, money/invoice, roadsheet share, venue link, collab) do
  their mutations here. It is invisible cross-tenant — that invisibility
  is itself asserted by `tests/rls/cross-tenant.test.ts`.

The user's JWT claim `current_workspace_id` resolves to its FIRST
membership — which is why write paths that hit claim-bound INSERT
policies go through SECURITY DEFINER RPCs (see ADR-043/045/047/049/050).

`admin` (not `member`) is intentional — `has_permission()` gives
owner/admin a bypass for any project permission, so tests are decoupled
from RBAC details. RBAC regression goes into a separate suite later.

**Fixture hygiene**: every spec is self-cleaning now. Since ADR-052 the
performance-write spec deletes its own gigs (one through the UI confirm
dialog, the rest via `DELETE /api/performances/:id`) — the old
`e2e-venue-*` accumulation and its manual SQL purge are gone (last
manual purge 2026-07-02, 20 rows; none needed since). The
conversation-create spec soft-deletes its conversation via
`DELETE /api/conversations/:id` and reruns resurrect it (ADR-051), so the
stable fixture person (`zzz-e2e-contact@hour.test`) never duplicates.
Leftovers only appear if a run dies mid-test; the next run's create is
either idempotent (venue), a resurrect (conversation), or swept by the
delete test's API sweep (performances on the run's fixture day).

## Steps

### 1. Create the auth user (Supabase Dashboard)

Authentication → Users → **Add user** → "Create new user":
- Email: `playwright@hour.test`
- Password: generate a strong one — save it, you'll need it in step 3
- Auto Confirm User: **YES** (otherwise the test would need to click an email link)

### 2. Attach to workspace `marco-rubiol` as `admin` (SQL Editor)

Paste in Supabase SQL Editor and run. Idempotent (`ON CONFLICT`), safe to re-run.

```sql
DO $$
DECLARE
  v_user_id      uuid;
  v_workspace_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'playwright@hour.test';
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user playwright@hour.test not found — create it first via Authentication → Users → Add user with Auto-confirm.';
  END IF;

  SELECT id INTO v_workspace_id FROM workspace WHERE slug = 'marco-rubiol';
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace marco-rubiol not found.';
  END IF;

  INSERT INTO workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace_id, v_user_id, 'admin', now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role        = EXCLUDED.role,
        accepted_at = COALESCE(workspace_membership.accepted_at, now()),
        updated_at  = now();

  RAISE NOTICE 'Wired % into workspace marco-rubiol as admin', v_user_id;
END $$;
```

Expected: `NOTICE: Wired <uuid> into workspace marco-rubiol as admin`. No error rows.

`accepted_at` is required for the auth hook to inject `current_workspace_id` into the JWT and for `has_permission()`'s admin bypass to apply.

### 3. Local env file

Create `apps/web/.env.test` (gitignored). The RLS suite also needs the
Supabase coordinates:

```
PW_TEST_EMAIL=playwright@hour.test
PW_TEST_PASSWORD=<the password from step 1>
PUBLIC_SUPABASE_URL=https://lqlyorlccnniybezugme.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<the sb_publishable_ key>
```

### 4. Install Chromium binary (one-time)

```
pnpm --filter web test:install
```

### 5. Run the suites

```
cd apps/web
set -a; source .env.test; set +a
pnpm test:unit                      # pure unit, no env needed
pnpm test:rls                       # RLS integration against prod Supabase
pnpm exec playwright test           # e2e against local preview (builds first)
PW_BASE_URL=https://hour.zerosense.studio pnpm exec playwright test   # e2e against prod (enables collab specs)
```

Local runs spin up `vite preview` (built `dist/`); the collab specs skip
without `PW_BASE_URL` because they need the real Worker + Durable
Object. If the pinned Playwright browser is missing, point
`PW_CHROMIUM` at any installed Chromium/Chrome-for-Testing binary
(escape hatch in `playwright.config.ts`).

## When the smoke fails

| Symptom | Likely cause |
|---|---|
| `0 contacts` instead of `<n> contacts` | Workspace membership missing `accepted_at`, or test user attached to wrong workspace. Re-run the SQL in step 2. |
| Redirect loop on `/login` | Wrong password in `.env.test`, or auth user not auto-confirmed (check Authentication → Users → email_confirmed_at). |
| `connect ECONNREFUSED` to localhost | Forgot `pnpm build` before `pnpm test:smoke`. `vite preview` needs `dist/`. |
| 401 on `/api/conversations` | JWT not issuing `current_workspace_id` claim — check the Auth hook is enabled in Supabase Dashboard (Authentication → Hooks). |

## When to re-run

- DB password rotated → no impact on test user (independent password).
- Test user password rotated → update `.env.test`.
- Workspace `marco-rubiol` slug changed → update the SQL snippet's `WHERE slug = ...` and re-run.
- New project added to the workspace → no impact (admin bypass covers any project).

## Why a separate test user (not Marco's account)

- Marco's password rotates (just did, 2026-05-09).
- Tests run against a known stable identity, not a personal account.
- A future "leaked-credential" rotation procedure for the test user is one secret to rotate, not "Marco's prod identity".
