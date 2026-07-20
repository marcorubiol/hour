# Hour — Supabase staging and restore drill

## Purpose

This is the executable gate for `_tasks.md` items 2 and 3. It proves two
different properties without leaving production data in a long-lived test
environment:

1. `Supabase staging baseline` rebuilds a hosted staging database from the
   committed migrations, creates Auth users through the Admin API, loads only
   deterministic synthetic fixtures, and requires RLS 118/118 plus the critical
   route smoke.
2. `Supabase staging restore drill` temporarily replaces that data with one
   private R2 backup, verifies login, source counts, RLS 118/118 and the same
   route, records evidence, then always rebuilds the synthetic baseline.

Both workflows serialize on the `supabase-staging` concurrency group and refuse
to proceed unless the database URL, public URL and staging project ref agree.
The destructive confirmation is also exact and production's DB URL must differ.

## One-time staging project configuration

Create an empty Supabase project in the same EU data-residency jurisdiction and
Postgres major version as production. It is a disposable test target: never configure production
webhooks, SMTP, OAuth callbacks or external cron destinations on it.

Create the GitHub environment `staging` and configure:

| Kind | Name | Value |
|---|---|---|
| variable | `STAGING_PROJECT_REF` | hosted staging project ref |
| variable | `STAGING_SUPABASE_URL` | `https://<ref>.supabase.co` |
| secret | `STAGING_DB_URL` | staging Session pooler URL on port 5432 |
| secret | `STAGING_SUPABASE_ANON_KEY` | staging publishable/anon key |
| secret | `STAGING_SUPABASE_SERVICE_ROLE_KEY` | staging service-role/secret key |
| secret | `STAGING_PW_TEST_PASSWORD` | strong synthetic admin password |
| secret | `STAGING_PW_LIMITED_PASSWORD` | strong synthetic limited password |
| secret | `RESTORE_PW_TEST_PASSWORD` | password of restored `playwright@hour.test` |
| secret | `RESTORE_PW_LIMITED_PASSWORD` | password of restored `limited@hour.test` |

The existing repository secrets `SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` and `R2_ENDPOINT` remain the production source and
private backup transport.

In staging Auth Hooks, enable the Postgres custom access-token hook at:

```text
pg-functions://postgres/public/custom_access_token_hook
```

This setting lives in the Supabase service configuration rather than the SQL
schema. The committed `supabase/config.toml` applies it automatically to local
development; hosted staging needs the one-time dashboard setting.

## Run the baseline gate

GitHub → Actions → `Supabase staging baseline` → Run workflow. Enter exactly:

```text
REBUILD STAGING
```

The successful summary must show the same commit being assessed. The RLS step
must report `118 passed`; no skips or expected failures count as completion.

## Run the restore drill

Use a backup made after the Auth-recoverable format change. GitHub → Actions →
`Supabase staging restore drill`; enter its R2 stamp and exactly:

```text
RESTORE STAGING FROM R2
```

The workflow downloads production rows directly from private R2 into the
runner, validates checksums, restores in one transaction and never publishes
the dump as an artifact. The only artifact is `evidence.json`, containing the
stamp, commit, elapsed time and aggregate row counts. Its final cleanup returns
staging to the synthetic fixture even when a verification step fails.

Target: under 30 minutes from destructive reset through route verification.
Record the successful workflow URL, exact stamp and elapsed seconds below.

## Evidence

### Local structural preflight — 2026-07-20

The counts below are historical evidence from the block-1 commit, whose RLS
contract contained 114 tests. The executable gate now contains 118 tests and
must report 118/118 on every new baseline or restore run.

Before touching a hosted project, the complete restore sequence was exercised
against a fresh local Supabase Postgres 17 instance using a CLI-generated
roles/schema/data backup of the synthetic baseline:

- checksum verification: all files passed;
- destructive reset: `auth.users = 0` before restore;
- atomic roles → schema → replica-mode data restore: passed;
- source/target counts: exact match (`2` Auth users, `4` live workspaces,
  `3` live projects, `157` live people, `154` live conversations and `1`
  live performance);
- restored password login and access-token hook: passed;
- RLS: `114/114` passed;
- application build and critical-route smoke: `2/2` passed.

This proved the dump and restore machinery before the hosted acceptance gate
below was run.

### Hosted staging acceptance — 2026-07-20

These two run records are historical block-1 evidence (114/114 at their exact
commits). New runs use the expanded 118/118 contract.

Target: `hour-staging`, ref `slccyknqpgmzhyiyclsq`, region `eu-west-1`.

The baseline workflow passed first in
[run 29761298044](https://github.com/marcorubiol/hour/actions/runs/29761298044):
commit `84056f8`, destructive rebuild from committed migrations, Auth Admin
provisioning, deterministic fixtures, exact fixture shape, RLS 114/114, app
build and critical-route smoke 2/2. Total duration: 1 minute 56 seconds.

The production-backup restore passed in
[run 29761775037](https://github.com/marcorubiol/hour/actions/runs/29761775037):

- source stamp: `2026-07-20T16-01-18Z`;
- commit: `3d5e2418c2dbe1abe16cc22db8ff2c5f61bc56de`;
- measured restore-and-verify time: **203 seconds** (workflow total 4 minutes
  9 seconds), below the 30-minute target;
- restored counts: `auth.users=3`, `person=171`, `project=17`, `workspace=5`,
  `performance=29`, `conversation=157`;
- password login and custom access-token claims: passed;
- RLS: 114/114; application build and critical-route smoke: 2/2;
- final cleanup: passed and returned staging to the synthetic baseline.

The role dump is sanitized before restore to omit Supabase-reserved role
creation/alteration statements while preserving custom roles and grants. This
is required because hosted project connections are not superusers.
