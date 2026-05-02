# Hour — backup runbook

## What runs

`.github/workflows/backup.yml` dumps the Supabase `public` schema (data, schema, roles) every Sunday 03:00 UTC and pushes gzipped SQL files to Cloudflare R2 bucket `hour-backups` under `weekly/<UTC-stamp>/`. Retention: 12 weeks.

Manual trigger: GitHub → Actions → "Supabase backup → R2" → Run workflow.

## Required GitHub secrets

Set in repo Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | `postgresql://postgres:<DB_PASSWORD>@db.lqlyorlccnniybezugme.supabase.co:5432/postgres` |
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

## Restore drill (do this once before Phase 0.9 gate)

1. Spin up an empty Supabase project (or local `supabase start`).
2. Download the latest `schema-*.sql.gz` and `data-*.sql.gz` from R2.
3. `gunzip` and `psql` into the staging project — schema first, then data.
4. Verify `select count(*) from person, engagement` matches the source.
5. Document elapsed time. Target: <30 min end-to-end.

## When backups fail

Workflow run will show the failed step. Common causes:

- `SUPABASE_DB_URL` password rotated → update secret.
- R2 token revoked / wrong bucket → reissue and update secrets.
- Supabase project paused (free tier inactivity) → unpause and re-run.

A failed backup does not retry automatically; re-run via `workflow_dispatch` after fixing.
