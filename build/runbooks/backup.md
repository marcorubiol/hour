# Hour — backup runbook

## What runs

`.github/workflows/backup.yml` dumps the Supabase `public` schema (data, schema, roles) every Sunday 03:00 UTC and pushes gzipped SQL files to Cloudflare R2 bucket `hour-backups` under `weekly/<UTC-stamp>/`. Retention: 12 weeks.

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

Pick the newest stamp; expect three files:
- `data-<stamp>.sql.gz`
- `schema-<stamp>.sql.gz`
- `roles-<stamp>.sql.gz`

For a schema-only inspection without downloading production rows, trigger the
workflow manually with optional input `source_stamp`. It retrieves the named R2
backup and publishes only `schema-*.sql.gz` as a one-day Actions artifact. With
no input, the workflow creates the normal fresh backup and the same short-lived
schema-only artifact. See `build/runbooks/database-baseline.md`.

## Restore drill (do this once before Phase 0.9 gate)

1. Spin up an empty Supabase project (or local `supabase start`).
2. Download the latest `schema-*.sql.gz` and `data-*.sql.gz` from R2.
3. `gunzip` and `psql` into the staging project — schema first, then data.
4. Verify `select count(*) from person, conversation` matches the source.
5. Document elapsed time. Target: <30 min end-to-end.

## When backups fail

Workflow run will show the failed step. Common causes:

- `SUPABASE_DB_URL` password rotated → update secret.
- R2 token revoked / wrong bucket → reissue and update secrets.
- Supabase project paused (free tier inactivity) → unpause and re-run.

A failed backup does not retry automatically; re-run via `workflow_dispatch` after fixing.
