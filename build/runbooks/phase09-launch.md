# Phase 0.9 — launch runbook (external-onboarding hardening)

> The hardening gate that must pass before the first external (non-MüK)
> workspace. Implemented 2026-07-13 (ADR-061). This runbook covers the
> manual steps the code can't do for itself: KV namespace, deploy order,
> and the drills.

## What shipped in code (ADR-061)

- **httpOnly cookie sessions.** Login/refresh/logout/session/token run
  server-side (`/api/auth/*`); the JWT lives in `hour_at` (httpOnly,
  Secure, SameSite=Strict, TTL = token expiry) + `hour_rt` (refresh,
  Path=/api/auth, 60d, rotated each use). `$lib/api.ts` does 401 → refresh
  → retry → bounce. The only JWT that reaches JS is the ≤1 h access token,
  via `/api/auth/token`, for the two cross-origin consumers (Supabase
  Realtime + the `has_permission` RPC).
- **CSP + security headers** (`svelte.config.js` kit.csp + `hooks.server.ts`).
- **Central PostgREST error mapper** (`$lib/server/errors.ts`) — no more
  `err.body` to the browser; details go to the structured server log.
- **Sentry PII scrub** — `sendDefaultPii:false`, capability-token URL
  scrub, Replay masking, `/api/sentry-test` dev-only (no more `?force=1`),
  tunnel rate-limited + size-capped + DSN-checked.
- **Rate limiting** (`$lib/server/rate-limit.ts`) on login/refresh/tunnel.
- **Health checks** `/health/live` + `/health/ready`.
- **CI** `.github/workflows/ci.yml` (svelte-check + unit + build + collab tsc).

## Manual steps BEFORE the external-onboarding deploy

### 1. Login protection — edge rate-limit rule (the real control) + KV backstop

**The primary control is a Cloudflare edge rate-limit rule**, not the KV
limiter. The KV limiter (`$lib/server/rate-limit.ts`) is a non-atomic
in-Worker backstop: it bounds slow sequential abuse but a concurrent burst
largely slips through (KV has no atomic increment — see its docblock). So:

- **Add a CF rate-limit rule on `hour.zerosense.studio/api/auth/login`**
  (dashboard → Security → WAF → Rate limiting rules), same mechanism you
  already run on the fleet's `wp-login.php`. Suggested: ~10 req / 1 min per
  IP → block 1 min. This is atomic at the edge and stops the burst before
  the Worker. Confirm the custom domain is proxied (orange cloud) first.
- **KV backstop (~2 min, optional but cheap):**
  ```
  cd apps/web
  pnpm wrangler kv namespace create RATE_LIMIT
  ```
  Paste the returned `id` into `apps/web/wrangler.jsonc` and uncomment the
  `kv_namespaces` block (there, commented, with the exact shape). Without
  it the limiter no-ops (login still works, just unthrottled in-Worker —
  fine once the edge rule is up).

### 2. Deploy order (unchanged from always)
Collab first (owns the DO migration tag), then web:
```
cd apps/collab && pnpm run deploy
cd ../web && pnpm run deploy
```

### 2b. Deploy provenance — deploy commits, not working trees

`wrangler deploy` uploads **what is on disk**, not a git ref. Left alone that
means prod can run code that exists in no commit, and the only record of what
is live is whatever someone remembered to write down. That failed on
2026-07-14: scope-v2 was deployed uncommitted, git and prod disagreed for two
days, and `_context.md` confidently listed ADR-059/060/061 as "pending deploy"
while they had been live the whole time.

Two guards, both in the repo:

- **`scripts/assert-clean-tree.mjs`** runs first in both `deploy` scripts and
  refuses a dirty tree (it also warns when HEAD isn't pushed, which would make
  the deployed SHA unresolvable by anyone else). Deliberate exception:
  `ALLOW_DIRTY_DEPLOY=1 pnpm run deploy`.
  Note: it's chained inside `"deploy"` on purpose — pnpm 10 does **not** run
  `pre*` scripts by default, so a `predeploy` hook would silently never fire.
- **The build stamp** (`buildStamp()` in `apps/web/vite.config.ts`) bakes the
  SHA into the bundle. Ask production what it runs:
  ```
  curl -s https://hour.zerosense.studio/health/live
  # {"ok":true,"version":{"sha":"358155c","dirty":false,"builtAt":"…"}}
  ```
  `dirty: true` means that build came from an uncommitted tree — the SHA alone
  will not reproduce it.

**Before believing any doc about what is deployed, curl `/health/live`.** The
docs are a claim; the stamp is the fact.

### 3. Post-deploy smoke (do every time)
- `curl -s https://hour.zerosense.studio/health/ready` → `{"ok":true,...}`.
- Sign in through the UI. Confirm in DevTools → Application → Cookies:
  `hour_at` + `hour_rt` present, both **HttpOnly** ✓ **Secure** ✓
  **SameSite=Strict** ✓. Confirm `localStorage` has NO `hour_jwt`.
- Confirm response headers carry `content-security-policy` +
  `x-content-type-options: nosniff` + `x-request-id`.
- Open a collaborative note (line/performance/project) → it connects
  (proves the cookie rides the WS upgrade + `/api/auth/token` works).
- Let a tab sit >1 h (or shorten the Supabase access-token TTL to test),
  then act → it should refresh silently, NOT bounce to login.

## Drills the gate still requires (not code — do once, record here)

- **Restore drill.** Restore the latest R2 weekly dump into a Supabase
  staging project and confirm it opens. Target <30 min. Record the date +
  result here. Procedure: `build/runbooks/backup.md` (dump side) — restore
  side to be written on first run.
- **RLS regression suite against staging.** `pnpm --filter web test:rls`
  currently hits PRODUCTION as the fixture user. Before onboarding, point
  `.env.test` at a Supabase branch/staging project and confirm green there.
  The 6 priority scenarios: `_context.md § Phase 0.9 hardening backlog`.
  Known gap: the suite has ONE admin-everywhere identity, so the grant/
  revoke permission mechanics (scenario 3) + member-level money redaction
  (4) + private person_note (5) are untested until a second, limited-role
  fixture user exists. That second user is the single cheapest unlock.

## Deferred to Phase 1 (do NOT block launch on these)
- Full CI RLS/e2e jobs (need a staging Supabase branch + secrets).
- Leaked-password protection (Supabase Pro toggle).
- Admin/support UI, Sentry source-map token rotation.
