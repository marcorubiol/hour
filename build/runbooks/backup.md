# Hour — backup runbook

## What runs

`.github/workflows/backup.yml` creates a recoverable Supabase backup every Sunday
at 03:00 UTC and pushes it to the private Cloudflare R2 bucket `hour-backups`
under `weekly/<UTC-stamp>/`. Retention: 12 weeks.

The three dumps have distinct scopes:

- `roles`: database roles required by grants and ownership.
- `schema`: application schema and database objects. Supabase-managed schemas
  such as `auth` and `storage` are recreated by the target Supabase project, so
  the CLI deliberately excludes their DDL.
- `data`: rows from the application and managed schemas, including `auth.users`,
  so restored users can still log in. Vector-storage implementation tables are
  excluded as recommended by Supabase.

Each backup also contains `SHA256SUMS` for integrity verification. Backups made
before 2026-07-20 used `--schema public` for the data dump and therefore cannot
prove authentication recovery; use a newer stamp for a restore drill.

Manual trigger: GitHub → Actions → "Supabase backup → R2" → Run workflow.

## Required GitHub secrets

Set in repo Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | **Use the Session pooler URL** — `postgresql://postgres.<project_ref>:<DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`. Direct `db.<ref>.supabase.co` resolves to IPv6 only and GitHub Actions runners are IPv4-only (`Network is unreachable`). Use **Session mode (port 5432)**, not Transaction mode (6543) — `pg_dump` uses prepared statements that Transaction mode breaks. Password must be alphanumeric or percent-encoded; raw `@` `/` `#` `:` `?` break URL parsing (Go's `net/url` → `invalid userinfo`). |
| `R2_ACCESS_KEY_ID` | R2 token's access key (Cloudflare → R2 → Manage R2 API tokens) |
| `R2_SECRET_ACCESS_KEY` | R2 token's secret key |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |

## One-time R2 prep

1. Create bucket `hour-backups` in EU jurisdiction (Cloudflare → R2 → Create bucket).
2. Issue an R2 API token scoped to `hour-backups` with **Object Read & Write**.
3. Copy access key, secret, and endpoint into the GitHub secrets above.

## Verifying a backup

```bash
aws s3 ls s3://hour-backups/weekly/ \
  --endpoint-url "$R2_ENDPOINT"
```

Pick the newest stamp; expect four files:
- `data-<stamp>.sql.gz`
- `schema-<stamp>.sql.gz`
- `roles-<stamp>.sql.gz`
- `SHA256SUMS`

Verify integrity before reading or restoring anything:

```bash
(cd "weekly/<stamp>" && sha256sum --check SHA256SUMS)
```

For a schema-only inspection without downloading production rows, trigger the
workflow manually with optional input `source_stamp`. It retrieves the named R2
backup and publishes only `schema-*.sql.gz` as a one-day Actions artifact. With
no input, the workflow creates the normal fresh backup and the same short-lived
schema-only artifact. See `build/runbooks/database-baseline.md`.

## Restore order

Use only an empty, disposable staging project whose Supabase services have
already initialized the managed schemas. Never point the restore command at
production.

1. Download all four files for the same stamp and verify `SHA256SUMS`.
2. Restore `roles`, then `schema`.
3. Restore `data` in one transaction with
   `SET session_replication_role = replica` so dependency ordering does not
   invalidate foreign keys while loading.
4. Re-enable normal replication mode before committing.
5. Verify login, source/target row counts, RLS 114/114 and one critical route.
6. Record the stamp and elapsed time. Target: under 30 minutes end-to-end.

The executable staging restore procedure and evidence live in
`build/runbooks/database-restore-drill.md` once the staging project is created.

## When backups fail

Workflow run will show the failed step. Common causes:

- `SUPABASE_DB_URL` password rotated → update secret.
- R2 token revoked / wrong bucket → reissue and update secrets.
- Supabase project paused (free tier inactivity) → unpause and re-run.

A failed backup does not retry automatically; re-run via `workflow_dispatch` after fixing.
