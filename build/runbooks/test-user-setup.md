# Hour — Playwright smoke test user setup

One-time provisioning so `tests/smoke.spec.ts` can run against `hour-phase0`. Re-run idempotently on password rotation.

## What this gets you

A dedicated auth user `playwright@hour.test` with `workspace_membership` in `marco-rubiol` as `admin`. The smoke test logs in as this user, navigates to `/booking`, asserts the engagements list renders with `<n> contacts`, and signs out.

`admin` (not `member`) is intentional — `has_permission()` gives owner/admin a bypass for any project permission, so the test is decoupled from RBAC details. The smoke is for catching login / auth / RLS regressions, not RBAC drift. RBAC regression goes into a separate suite later.

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

Create `apps/web/.env.test` (gitignored):

```
PW_TEST_EMAIL=playwright@hour.test
PW_TEST_PASSWORD=<the password from step 1>
```

### 4. Install Chromium binary (one-time)

```
pnpm --filter web test:install
```

### 5. Run the smoke

```
cd apps/web && pnpm build && pnpm test:smoke
```

`pnpm build` is required because the Playwright config spins up `vite preview`, which serves the built `dist/`. Skip the build only if you're testing against a prebuilt deploy via `PW_BASE_URL=https://hour.zerosense.studio pnpm test:smoke`.

Pass criteria: 1 test, "smoke › login → /booking shows engagements → sign out", green in <30s.

## When the smoke fails

| Symptom | Likely cause |
|---|---|
| `0 contacts` instead of `<n> contacts` | Workspace membership missing `accepted_at`, or test user attached to wrong workspace. Re-run the SQL in step 2. |
| Redirect loop on `/login` | Wrong password in `.env.test`, or auth user not auto-confirmed (check Authentication → Users → email_confirmed_at). |
| `connect ECONNREFUSED` to localhost | Forgot `pnpm build` before `pnpm test:smoke`. `vite preview` needs `dist/`. |
| 401 on `/api/engagements` | JWT not issuing `current_workspace_id` claim — check the Auth hook is enabled in Supabase Dashboard (Authentication → Hooks). |

## When to re-run

- DB password rotated → no impact on test user (independent password).
- Test user password rotated → update `.env.test`.
- Workspace `marco-rubiol` slug changed → update the SQL snippet's `WHERE slug = ...` and re-run.
- New project added to the workspace → no impact (admin bypass covers any project).

## Why a separate test user (not Marco's account)

- Marco's password rotates (just did, 2026-05-09).
- Tests run against a known stable identity, not a personal account.
- A future "leaked-credential" rotation procedure for the test user is one secret to rotate, not "Marco's prod identity".
