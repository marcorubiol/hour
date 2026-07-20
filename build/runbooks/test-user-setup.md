# Hour — Playwright test user setup

One-time provisioning so the e2e suite (`tests/*.spec.ts`) and the RLS
integration suite (`tests/rls/*.test.ts`) can run against `hour-phase0`.
Re-run idempotently on password rotation.

## What this gets you (state as of 2026-07-20)

Three confirmed synthetic Auth users with deliberately different access:

- `playwright@hour.test` is the broad test operator. It has
  `workspace_membership` in three workspaces (all `admin`, all accepted):
  `marco-rubiol`, `muk-cia` and `playwright`.
- `limited@hour.test` is a plain accepted `member` of `playwright` only. In
  project `zzz-e2e-collab` it has role `performer`, with no explicit grants or
  revokes. It has no personal account/workspace and no access to real data.
- `external@hour.test` starts with zero workspace/project access. The invitation
  lifecycle test grants guest/performer access, accepts it with this user's
  verified email, proves the narrow surface, then revokes it using the same JWT.

The `playwright` fixture workspace contains:

- project `zzz-e2e-collab` with gigs `zzz-e2e-1` / `zzz-e2e-2`. Write-path specs (conversation,
  performance, money/invoice, roadsheet share, venue link, collab) do
  their mutations here;
- project `zzz-rls-foreign-project` with line `ZZZ RLS Foreign Line`, which
  gives the date suite a stable cross-project line guard.

The limited identity drives the negative authorization matrix: workspace
identity edits are denied, performer permissions are exact, grant/revoke
changes take effect against an already-issued JWT, fees stay redacted without
`read:money`, and another author's private note stays invisible. The live RLS
baseline is **118/118** with no skipped fixture cases.

The user's JWT claim `current_workspace_id` resolves to its FIRST
membership — which is why write paths that hit claim-bound INSERT
policies go through SECURITY DEFINER RPCs (see ADR-043/045/047/049/050).

`admin` for the broad fixture is intentional — `has_permission()` gives
owner/admin a bypass for any project permission, so tests are decoupled
from RBAC details. The limited fixture is the complementary RBAC regression.

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

### 1. Create the auth users (Supabase Auth Admin or Dashboard)

Authentication → Users → **Add user** → "Create new user":
- Emails: `playwright@hour.test`, `limited@hour.test` and `external@hour.test`
- Passwords: generate independent strong values — save them for step 3
- Auto Confirm User: **YES** (otherwise the test would need to click an email link)

Never insert directly into `auth.users`. The current limited fixture was created
through the official Auth Admin API. Its password is also stored in macOS
Keychain under service `Hour Test Fixtures`, account `limited@hour.test`.
The signup trigger created an empty personal account/workspace; that exact pair
was removed only after verifying it contained this sole user and zero projects.
If the fixture is rebuilt, repeat that safety check rather than deleting by a
name pattern.

### 2. Attach the two access-bearing identities (SQL Editor)

Paste in Supabase SQL Editor and run. Idempotent (`ON CONFLICT`), safe to re-run.

```sql
DO $$
DECLARE
  v_admin_id      uuid;
  v_limited_id    uuid;
  v_workspace_id  uuid;
  v_project_id    uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'playwright@hour.test';
  SELECT id INTO v_limited_id FROM auth.users WHERE email = 'limited@hour.test';
  IF v_admin_id IS NULL OR v_limited_id IS NULL THEN
    RAISE EXCEPTION 'Both confirmed fixture Auth users must exist first.';
  END IF;

  INSERT INTO workspace_membership (workspace_id, user_id, role, accepted_at)
  SELECT w.id, v_admin_id, 'admin', now()
  FROM workspace w
  WHERE w.slug IN ('marco-rubiol', 'muk-cia', 'playwright')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        accepted_at = COALESCE(workspace_membership.accepted_at, now()),
        updated_at = now();

  SELECT id INTO v_workspace_id FROM workspace WHERE slug = 'playwright';
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'playwright workspace fixture is missing.';
  END IF;

  INSERT INTO workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace_id, v_limited_id, 'member', now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        accepted_at = COALESCE(workspace_membership.accepted_at, now()),
        updated_at = now();

  SELECT id INTO v_project_id
  FROM project
  WHERE workspace_id = v_workspace_id AND slug = 'zzz-e2e-collab';
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'zzz-e2e-collab project fixture is missing.';
  END IF;

  INSERT INTO project_membership (
    project_id, user_id, roles, permission_grants, permission_revokes
  ) VALUES (
    v_project_id, v_limited_id, ARRAY['performer'], '{}', '{}'
  )
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET roles = EXCLUDED.roles,
        permission_grants = EXCLUDED.permission_grants,
        permission_revokes = EXCLUDED.permission_revokes,
        updated_at = now();

  RAISE NOTICE 'Admin and limited fixtures wired';
END $$;
```

Expected: `NOTICE: Admin and limited fixtures wired`. No error rows.

`accepted_at` is required for the auth hook to inject `current_workspace_id` into the JWT and for `has_permission()`'s admin bypass to apply.

### 3. Local env file

Create `apps/web/.env.test` (gitignored). The RLS suite also needs the
Supabase coordinates:

```
PW_TEST_EMAIL=playwright@hour.test
PW_TEST_PASSWORD=<the password from step 1>
PW_LIMITED_EMAIL=limited@hour.test
PW_LIMITED_PASSWORD=<the independent limited-user password>
PW_EXTERNAL_EMAIL=external@hour.test
PW_EXTERNAL_PASSWORD=<the independent external-user password>
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
| Limited/external tests skip | The corresponding `PW_LIMITED_*` / `PW_EXTERNAL_*` values are missing from `.env.test`. |
| Date cascade has one skip | The stable `zzz-rls-foreign-project` project or its line is missing. |
| `connect ECONNREFUSED` to localhost | Forgot `pnpm build` before `pnpm test:smoke`. `vite preview` needs `dist/`. |
| 401 on `/api/conversations` | JWT not issuing `current_workspace_id` claim — check the Auth hook is enabled in Supabase Dashboard (Authentication → Hooks). |

## When to re-run

- DB password rotated → no impact on test user (independent password).
- Either fixture password rotated → update `.env.test` (and the limited-user Keychain item).
- Workspace `marco-rubiol` slug changed → update the SQL snippet's `WHERE slug = ...` and re-run.
- New project added to the workspace → no impact (admin bypass covers any project).

## Why synthetic test users (not Marco's account)

- Marco's password rotates (just did, 2026-05-09).
- Tests run against a known stable identity, not a personal account.
- A future leaked-credential rotation affects synthetic secrets, not Marco's production identity.
- Three access envelopes test successful operations, narrow guest/performer reads
  and real authorization denials before and after revocation.
