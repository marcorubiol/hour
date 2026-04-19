# Bootstrap — Hour Phase 0

One-shot guide from empty cloud accounts to `hour.zerosense.studio` serving a live deploy.
Run top-to-bottom. Estimate: 2 hours for an operator who's done it before, 4 hours first time.

---

## 0. Prerequisites

Accounts required:
- **Cloudflare** with `zerosense.studio` already in the zone (assumed — subdomain-cost = 0).
- **GitHub** — done: `github.com/marcorubiol/hour` (private).
- **Supabase** — free tier, one project for Phase 0.
- **Resend** — defer until email flow is wired. Not required for first deploy.
- **Sentry** — defer until first production error. Not required for first deploy.

Local tooling:
- `pnpm` ≥ 9
- `supabase` CLI ≥ 1.200 (`brew install supabase/tap/supabase`)
- `wrangler` CLI (`pnpm add -g wrangler`) — needed for R2 and Pages from CLI; optional if doing it all in the CF dashboard

Credentials vault:
- Marco's `.zerø/config/` already holds Cloudflare and other API keys. Add Supabase service-role key there after step 2 (never to repo).

---

## 1. Pre-flight patches to `_build/schema.sql`

### 1.1 Replace `pg_uuidv7` extension with PL/pgSQL function

Why: `pg_uuidv7` is not whitelisted on Supabase Cloud as of 2026-04-19. See DECISIONS.md `[2026-04-19] — UUID v7 generation: PL/pgSQL function, not pg_uuidv7 extension`.

Patch at the top of `schema.sql` — replace the `pg_uuidv7` CREATE EXTENSION line with:

```sql
-- UUID v7 generation (RFC 9562) via pgcrypto; no external extension needed.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  -- 48-bit Unix timestamp in milliseconds, big-endian
  unix_ts_ms := substring(
    int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    FROM 3
  );
  -- Concatenate timestamp (6 bytes) + 10 random bytes
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  -- Set version (byte 6, high nibble = 0111)
  uuid_bytes := set_byte(
    uuid_bytes, 6,
    (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::integer
  );
  -- Set variant (byte 8, high nibble = 10xx)
  uuid_bytes := set_byte(
    uuid_bytes, 8,
    (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::integer
  );
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'RFC 9562 UUID v7 — time-ordered. Replace with pg_uuidv7 extension or native uuidv7() when Supabase supports them.';

CREATE EXTENSION IF NOT EXISTS "moddatetime";      -- auto-update updated_at
```

Rest of `schema.sql` stays as-is — PKs keep `DEFAULT uuid_generate_v7()`.

### 1.2 Commit the patch

```
git add _build/schema.sql _build/DECISIONS.md _build/bootstrap.md
git commit -m "fix(schema): replace pg_uuidv7 extension with PL/pgSQL function

pg_uuidv7 is not whitelisted on Supabase Cloud. Inline implementation
via pgcrypto works on PG13+, can be swapped for the extension or PG18's
native uuidv7() later without touching the schema."
git push
```

---

## 2. Create the Supabase project

In the Supabase dashboard:

1. **New project**
   - Name: `hour-phase0`
   - Database password: generate 32+ chars, store in `.zerø/config/` as `supabase-db-password`. This is the **postgres** role password, needed for direct SQL connections and migrations.
   - **Region: `eu-central-1` (Frankfurt)** — closest to Madrid, EU data residency for GDPR.
   - Plan: Free.
2. Wait ~2 min for provisioning.
3. Record the project reference ID (top of Settings → General, looks like `abcdefghijklmno`) — needed for `supabase link`. Store in `.zerø/config/` as `supabase-project-ref`.

### 2.1 Project-level settings (dashboard)

- **Authentication → Sign In / Providers → Email** (see DECISIONS.md ADR `Auth flow: email+password with optional TOTP 2FA` 2026-04-19):
  - Enable email provider: ON
  - Confirm email: ON (verification email required before first login)
  - Secure email change: ON
  - Minimum password length: 8 (raised from default 6)
  - Password complexity requirements: enabled
  - Magic Link: optional — may be left ON as a fallback, but the primary flow is email+password + optional TOTP 2FA enrolled via `auth.mfa.enroll()`.
- **Authentication → URL Configuration**:
  - Site URL: `https://hour.zerosense.studio`
  - Redirect URLs: add `http://localhost:4321/*` for local dev (Astro default port).
- **Database → Extensions**: verify `pgcrypto` and `moddatetime` are listed as *available*. Do NOT enable from UI — migrations will do it.
- **Settings → API**: copy `Project URL`, `anon public` key, and `service_role` key. Store the service key in `.zerø/config/supabase-service-key` (never committed).

### 2.2 JWT custom claim for `current_org_id`

RLS policies in `rls-policies.sql` read `auth.jwt() -> 'current_org_id'`. This claim doesn't exist out of the box — a trigger or Edge Function needs to inject it.

Phase 0 defers the automatic injection. For the first manual smoke test we'll set it via `SET LOCAL request.jwt.claim.current_org_id = '...'` in psql. Production wiring is a later migration.

---

## 3. Local repo setup for Supabase

From repo root (`03_AGENCY/Hour/`):

```
supabase init
```

This creates `supabase/` with `config.toml` and `migrations/`.

Link to the cloud project:
```
supabase link --project-ref <supabase-project-ref>
# will prompt for the db password from step 2
```

Convert the two `_build/*.sql` files into timestamped migrations:

```
cp _build/schema.sql       supabase/migrations/20260419_0001_initial_schema.sql
cp _build/rls-policies.sql supabase/migrations/20260419_0002_rls_policies.sql
```

(Keep the originals in `_build/` as the canonical readable copies. Migrations are append-only snapshots; `_build/` is the design doc.)

Commit:
```
git add supabase/
git commit -m "chore(supabase): init CLI config + seed first two migrations"
git push
```

---

## 4. Deploy the first migration

```
supabase db push
```

Expected output: two migrations applied. If anything errors, do NOT edit the migration file — create a 0003 that fixes forward.

Verify in the Supabase SQL editor:

```sql
-- 1. tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- expect 15 rows: audit_log, contact, contact_project, crew_assignment, event,
-- file, membership, note, organization, project, rider, tag, tagging, task, user_profile

-- 2. RLS is enabled + forced on every tenant table
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables WHERE schemaname='public'
ORDER BY tablename;
-- every row except audit_log should show rowsecurity=t, forcerowsecurity=t

-- 3. helpers exist
SELECT proname FROM pg_proc
WHERE proname IN ('current_org_id','current_user_id','current_user_role','uuid_generate_v7');
-- expect 4 rows

-- 4. UUID v7 works
SELECT uuid_generate_v7();
-- expect a uuid with '7' as the first char of the 3rd group (timestamp + version nibble)
```

---

## 5. Smoke test RLS

In SQL editor:

```sql
-- Insert a test org (bypasses RLS because we're running as postgres role)
INSERT INTO organization (name, slug, type)
VALUES ('MaMeMi', 'mamemi', 'collective')
RETURNING id;
-- copy the id

-- Pretend we're an authenticated user for that org
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.current_org_id = '<paste-org-id>';

-- Should return 0 rows because no membership exists yet
SELECT * FROM organization;

-- Cleanup
RESET ROLE;
```

If the authenticated role sees the org without a membership row, RLS is broken — stop and debug before continuing.

---

## 6. Cloudflare DNS + R2

### 6.1 R2 bucket
Dashboard → R2 → Create bucket:
- Name: `hour-phase0-media`
- Location: Automatic (or EU if dashboard offers it)
- No public access — files are served through signed URLs.

Create an API token (R2 → Manage R2 API tokens) with **Object Read & Write** scoped to `hour-phase0-media`. Store `access_key_id`, `secret_access_key`, and the `endpoint` URL in `.zerø/config/hour-r2-token`.

### 6.2 DNS for the subdomain
Dashboard → `zerosense.studio` zone → DNS → Add record. With Workers (step 8) CF creates the DNS record automatically the moment you attach the custom domain — no manual CNAME required. Leave this step as a sanity check that the `zerosense.studio` zone is indeed on the same CF account as the Worker.

---

## 7. Frontend scaffold (Astro + Svelte + Workers)

> We ship on **Cloudflare Workers**, not Pages. `@astrojs/cloudflare` v12 targets Workers by default when `main` + `assets` are defined in `wrangler.toml`. Pages also works, but Workers gives us one deploy model for both static assets and SSR.

Minimum to have something to deploy. Not the real frontend.

```bash
# from repo root
pnpm create astro@latest apps/web -- --template minimal --typescript strict --install --no-git
cd apps/web
pnpm add -D @astrojs/svelte @astrojs/cloudflare wrangler@^4
pnpm dlx astro add svelte cloudflare
```

Edit `apps/web/astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  integrations: [svelte()],
  site: 'https://hour.zerosense.studio',
});
```

Create `apps/web/wrangler.toml`:
```toml
name = "hour-web"
compatibility_date = "2025-02-14"
compatibility_flags = ["nodejs_compat"]

# @astrojs/cloudflare v12 emits the SSR worker at dist/_worker.js and static
# assets alongside it. Wrangler serves the assets via the CDN binding.
main = "./dist/_worker.js/index.js"
assets = { directory = "./dist", binding = "ASSETS" }

[observability]
enabled = true

# R2 bucket (step 6).
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "hour-media"

# Non-secret public env vars. Secrets go via `wrangler secret put` or the
# dashboard — NEVER in this file.
[vars]
PUBLIC_SUPABASE_URL = "https://<project-ref>.supabase.co"
PUBLIC_SUPABASE_ANON_KEY = "<publishable key from step 2>"
```

Exclude the worker bundle from the static asset upload to avoid Wrangler errors:
```bash
echo "_worker.js" > apps/web/public/.assetsignore
```

Placeholder page at `src/pages/index.astro`:
```astro
---
const now = new Date().toISOString();
---
<html lang="en">
  <head><title>Hour</title></head>
  <body><main><h1>Hour — Phase 0</h1><p>Deploy OK at {now}</p></main></body>
</html>
```

Wire pnpm workspace at repo root — add `pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Local smoke:
```bash
cd apps/web
pnpm dev           # astro dev at http://localhost:4321
pnpm run preview   # wrangler dev — runs the built Worker locally
```

Commit:
```
git add .
git commit -m "feat(web): astro+svelte+workers scaffold for first deploy"
git push
```

---

## 8. Cloudflare Workers + first deploy

With the wrangler config above, one command deploys everything:

```bash
cd apps/web
pnpm run deploy   # equivalent to: astro build && wrangler deploy
```

Wrangler prompts for CF login on first run and then uploads both the SSR
worker and the static assets. It prints a URL like
`https://hour-web.marco-rubiol.workers.dev` — this is the production origin
until the custom domain is attached.

### 8.1 Connect the subdomain
Dashboard → Workers & Pages → `hour-web` → Settings → Domains & Routes → Add
Custom Domain → `hour.zerosense.studio`. Because `zerosense.studio` is on the
same CF account, the CNAME + SSL cert provision automatically in ~60 seconds.
No DNS work needed.

### 8.2 Env vars / secrets
Set secrets via CLI (never commit them):
```bash
cd apps/web
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # service role, server only
wrangler secret put RESEND_API_KEY              # when email is wired
```

`PUBLIC_*` values live in `[vars]` of `wrangler.toml` (not secret, visible to
the browser). Rotate them with `wrangler deploy` after editing the file.

---

## 9. Environment variables reference

| Key | Where used | Source | In repo? |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | browser + server | Supabase dashboard | `wrangler.toml [vars]` |
| `PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase dashboard | `wrangler.toml [vars]` |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (Worker) | Supabase dashboard | No — `wrangler secret put` + `.zerø/config/` |
| `MEDIA` (R2 binding) | server only | `wrangler.toml [[r2_buckets]]` | Yes — it's a binding name, not a secret |
| `RESEND_API_KEY` | server only | Resend | No — `wrangler secret put` when wired |
| `SENTRY_DSN` | browser + server | Sentry | No — add when observability wired |

Rule: anything that a third party could misuse if leaked → `wrangler secret put`. Public-read values → `[vars]`.

---

## 10. Post-deploy verification checklist

- [ ] `https://<worker>.workers.dev` (or `https://hour.zerosense.studio` once attached) loads and shows the placeholder page.
- [ ] Supabase dashboard shows 15 tables + `audit_log`.
- [ ] `SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'` returns ≥ 40.
- [ ] R2 bucket `hour-media` exists but is empty.
- [ ] Auth sign-up creates a user via email+password and sends a confirmation email to a real inbox (use a personal address). Optional TOTP 2FA enrollment available via `auth.mfa.enroll()`.
- [ ] `git push` on `main` triggers CI → deploy (set up `wrangler deploy` in CI if/when Marco wants auto-deploy; for now it's manual).

When all six checks pass: Phase 0 infra is live. Next up — `import-plan.md` (168 Difusión leads into `contact` + `contact_project`).

---

## Gotchas / things that will bite

- **Migration order matters** — the filename timestamp prefix (`20260419_0001_...`) is how the CLI sorts. Never rename a migration after it's been pushed.
- **`FORCE ROW LEVEL SECURITY` also applies to the table owner (postgres role).** The smoke-test step uses `SET LOCAL ROLE` to test isolation; don't panic when the postgres role sees an empty table through the authenticated role.
- **JWT `current_org_id` claim is not automatic.** Until a custom access-token hook injects it from the user's `membership` row, every RLS-protected query from a client returns empty. First wiring milestone post-bootstrap.
- **`public/.assetsignore`** is mandatory on `@astrojs/cloudflare` v12 + Workers. Without it, wrangler tries to upload `_worker.js` as a static asset and fails with "reserved name".
- **Wrangler v3 → v4**: the Workers Sites → Static Assets migration completed in wrangler 4.x. Pin `wrangler@^4` in `devDependencies`; sticking on v3 causes `main`/`assets` in `wrangler.toml` to misbehave.
- **Astro + Svelte with Cloudflare adapter** requires `output: 'server'` for any SSR route (endpoints, auth callbacks, `/api/*`). Static-only won't match what we need.
- **R2 bucket region**: R2 doesn't expose regions directly — the "auto" location places objects near first access. EU compliance: verify the bucket's actual locations in the dashboard after first uploads.
- **pg_uuidv7 arrival**: when Supabase ships it, the `uuid_generate_v7()` function can be replaced in a new migration — PKs and existing rows stay valid because values are identical in shape.
