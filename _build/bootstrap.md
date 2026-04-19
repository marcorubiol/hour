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

- **Authentication → Providers → Email**: enable Magic Link. Disable Email+Password (Phase 0 is magic-link-only per DECISIONS.md deferred item `Auth flow`).
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
Dashboard → `zerosense.studio` zone → DNS → Add record. Defer the actual CNAME target until after step 7 (Pages gives you `hour.pages.dev` or similar). Placeholder for now.

---

## 7. Frontend scaffold (Astro + Svelte)

This is the minimum to have something to deploy. Not the real frontend.

```
# from repo root
pnpm create astro@latest apps/web -- --template minimal --typescript strict --install --no-git
cd apps/web
pnpm add -D @astrojs/svelte @astrojs/cloudflare
pnpm dlx astro add svelte cloudflare
```

Edit `apps/web/astro.config.mjs` to target Cloudflare Pages:
```js
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [svelte()],
});
```

Replace `src/pages/index.astro` with a one-liner that proves the pipeline works:
```astro
---
const now = new Date().toISOString();
---
<html lang="en">
  <head><title>Hour</title></head>
  <body>
    <main>
      <h1>Hour — Phase 0</h1>
      <p>Deploy OK at {now}</p>
    </main>
  </body>
</html>
```

Test locally:
```
cd apps/web
pnpm dev
# open http://localhost:4321
```

Wire pnpm workspace at repo root — add `pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Commit:
```
git add .
git commit -m "feat(web): astro+svelte scaffold for first deploy"
git push
```

---

## 8. Cloudflare Pages + first deploy

Dashboard → Pages → Create → Connect to Git:
1. Select `marcorubiol/hour`.
2. Production branch: `main`.
3. Framework preset: **Astro**.
4. Build command: `pnpm --filter web build`
5. Build output directory: `apps/web/dist`
6. Root directory: leave empty (repo root).
7. Environment variables (Build + Preview):
   - `NODE_VERSION` = `22`
   - `PNPM_VERSION` = `9`
   - `PUBLIC_SUPABASE_URL` = `<from step 2>`
   - `PUBLIC_SUPABASE_ANON_KEY` = `<from step 2>`
8. Save and deploy. First build runs ~2–3 min.

After build succeeds, Pages gives the project a URL like `hour-xyz.pages.dev`.

### 8.1 Connect the subdomain
- Pages → Custom domains → Add `hour.zerosense.studio`.
- CF auto-creates the CNAME in the `zerosense.studio` zone (that's why the zone must be on the same CF account).
- Wait for SSL cert (30–90 s).
- Open `https://hour.zerosense.studio` — should show the "Deploy OK" page.

---

## 9. Environment variables reference

| Key | Where used | Source | In repo? |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | browser + server | Supabase dashboard | No — env var |
| `PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase dashboard | No — env var |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (Pages Functions / Edge) | Supabase dashboard | No — `.zerø/config/` + CF env |
| `R2_ACCESS_KEY_ID` | server only | CF R2 token | No |
| `R2_SECRET_ACCESS_KEY` | server only | CF R2 token | No |
| `R2_BUCKET` | server only | `hour-phase0-media` | No |
| `R2_ENDPOINT` | server only | CF R2 | No |
| `RESEND_API_KEY` | server only | Resend | No — add when email flow wired |
| `SENTRY_DSN` | browser + server | Sentry | No — add when observability wired |

Never commit anything from the second column onward. `.gitignore` already covers `.env*`.

---

## 10. Post-deploy verification checklist

- [ ] `https://hour.zerosense.studio` loads and shows the placeholder page.
- [ ] Supabase dashboard shows 15 tables + `audit_log`.
- [ ] `SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'` returns ≥ 40.
- [ ] R2 bucket `hour-phase0-media` exists but is empty.
- [ ] Auth UI in Supabase sends a magic link to a real inbox (use a personal address).
- [ ] Repo on `main` deploys automatically when pushed.

When all six checks pass: Phase 0 infra is live. Next up — `import-plan.md` (168 Difusión leads into `contact` + `contact_project`).

---

## Gotchas / things that will bite

- **Migration order matters** — the filename timestamp prefix (`20260419_0001_...`) is how the CLI sorts. Never rename a migration after it's been pushed.
- **`FORCE ROW LEVEL SECURITY` also applies to the table owner (postgres role).** The smoke-test step uses `SET LOCAL ROLE` to test isolation; don't panic when the postgres role sees an empty table through the authenticated role.
- **JWT `current_org_id` claim is not automatic.** Until a JWT hook or Edge Function injects it, every RLS-protected query from a client returns empty. First wiring milestone post-bootstrap.
- **Cloudflare Pages needs a Node version pin.** Default is old; set `NODE_VERSION=22` (Active LTS through Oct 2027) or builds will fail on modern deps.
- **Astro + Svelte with Cloudflare adapter** requires `output: 'server'` for Pages Functions. Static-only won't match what we'll need for auth callbacks.
- **R2 bucket region**: R2 doesn't expose regions directly — the "auto" location places objects near first access. EU compliance: verify the bucket's actual locations in the dashboard after first uploads.
- **pg_uuidv7 arrival**: when Supabase ships it, the `uuid_generate_v7()` function can be replaced in a new migration — PKs and existing rows stay valid because values are identical in shape.
