# Hour — rollback runbook

## Scope

Use this when a production deploy of `hour-web` breaks login, routing, API responses, or core UI.

## Cloudflare Worker rollback

1. Open Cloudflare Dashboard → Workers & Pages → `hour-web` → Deployments.
2. Identify the last known-good deployment by timestamp and version metadata.
3. Click **Rollback** on that deployment.
4. Verify:
   - `https://hour.zerosense.studio/login` loads.
   - Login succeeds for Marco.
   - `/booking` loads engagements.
   - `/api/engagements` returns 401 without JWT and 200 with valid JWT.
5. Create a follow-up issue/todo with the failed deployment timestamp, Sentry event links, and suspected commit.

## Database migrations

Do not auto-rollback database migrations unless a written down migration-specific rollback exists.

If a deploy includes DB changes:

1. Stop new application deploys.
2. Check whether the Worker rollback is compatible with the current schema.
3. If not compatible, choose the smallest safe forward fix instead of destructive rollback.
4. Restore from backup only for data-loss incidents, not normal application bugs.

## Backup freshness check

Before risky schema work, confirm the latest Supabase dump exists in R2 `hour-backups` and is recent enough for the operation.

## Owner

Marco is the release owner for Phase 0. No external customer SLA exists yet, but the goal is recovery in minutes, not debugging live in production.
