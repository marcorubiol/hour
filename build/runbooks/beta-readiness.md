# Phase 0.9 — launch runbook (external-onboarding hardening)

> The hardening gate that must pass before the first external (non-MüK)
> workspace. Implemented 2026-07-13 (ADR-061). This runbook covers the
> deploy order and the drills, plus the evidence for controls constrained by
> the current Cloudflare plan.

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
  Login composes Cloudflare's native Workers Rate Limiting binding with an
  independent five-minute KV window.
- **Onboarding without SQL.** Signup, expiring/hashed invite links, verified-email
  acceptance, optional project role, role changes and revocation from Settings.
- **Live collab revocation.** The private Durable Object rechecks connected users
  every 30 seconds and closes expired/revoked editors fail-closed.
- **Health checks** `/health/live` + `/health/ready`.
- **CI** `.github/workflows/ci.yml` (svelte-check + unit + build + collab tsc).

## Manual steps BEFORE the external-onboarding deploy

### 1. Login protection — native burst gate + long-window KV gate

The intended dedicated WAF rule cannot coexist on the current Free zone:
Cloudflare's authenticated dashboard was checked on 2026-07-20 and reports
`1/1` rate-limiting rules. The existing active rule
`RL wp-login.php — 5/10s/IP, 10s ban (fleet)` occupies that slot. It protects a
separate fleet surface and must not be removed or silently broadened.

Hour therefore uses two independent controls at the login endpoint:

- **Cloudflare Workers Rate Limiting binding** `LOGIN_RATE_LIMIT` — 10 calls
  per 60 seconds per source IP (`namespace_id=2026072001`). It uses
  Cloudflare's native rate-limit infrastructure and rejects concurrent bursts
  before any Supabase password grant is attempted. Cloudflare only supports
  10- or 60-second periods for this binding.
- **KV long-window gate** `RATE_LIMIT` — 10 calls per 300 seconds per source
  IP. KV is not atomic, but it enforces the slower sequential-attempt budget
  that the one-minute native window cannot express.

Both must admit the request. A native-service error fails open for login
availability, after which the independent KV gate still runs. The custom
domain was also verified through the Cloudflare API on 2026-07-20:
`hour.zerosense.studio` is proxied (`proxied=true`).

If the zone is upgraded or its WAF slot is freed later, add the dedicated
`POST /api/auth/login` 10/5-minute WAF rule as an additional outer layer; it
is no longer a blocker for external onboarding because the login does not
depend on KV alone.

### 2. Deploy order (unchanged from always)
Collab first (owns the DO migration tag), then web:
```
cd apps/collab && pnpm run deploy
cd ../web && pnpm run deploy
```

Database migrations use `.github/workflows/production-migrate.yml` before
either Worker deploy. Run it once with `apply=false` and confirmation
`PLAN PRODUCTION`; inspect that only the expected versioned files are pending.
Then run it with `apply=true` and confirmation
`MIGRATE PRODUCTION lqlyorlccnniybezugme`. The workflow proves the secret DB
URL contains the canonical production project ref, preserves migration history
through `supabase db push`, and prints the remote history after applying.

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
  # {"ok":true,"version":{"sha":"<git-sha>","dirty":false,"builtAt":"…"}}
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

- **Restore drill:** completed on hosted staging in 203 seconds; executable
  procedure and evidence are in `build/runbooks/database-restore-drill.md`.
- **RLS regression suite against staging:** hosted baseline exists. The current
  118-test contract adds a fully external third identity and covers zero access
  → invite → accept → revoke with the same JWT, read-only performance access,
  fee isolation, guest directories and collab reauthorization.

## External dependencies and later work
- Full E2E remains a production/manual gate; the staging workflow runs RLS,
  build and critical-route smoke with isolated secrets.
- Leaked-password protection requires Supabase Pro. Its priority is decided in
  `_tasks.md`; this runbook does not silently defer it.
- Transactional invite email delivery and Sentry source-map token rotation.
