# Setup — Hour (SvelteKit era)

> Current setup guide for SvelteKit + Cloudflare Workers + Supabase.
> For historical Astro-based setup, see `archive/bootstrap-2026-04-19.md`.

---

## Prerequisites

- pnpm 10.33.0+ (pinned in `packageManager`)
- Node 22 LTS
- Cloudflare account with `zerosense.studio` zone
- Supabase account (free tier sufficient for Phase 0)

## 1. Clone and install

```bash
git clone https://github.com/marcorubiol/hour.git
cd hour
pnpm install
```

## 2. Environment variables

Copy `apps/web/.env.example` to `apps/web/.env`:

```bash
cd apps/web
cp .env.example .env
```

Fill in:
- `PUBLIC_SUPABASE_URL` — from Supabase dashboard
- `PUBLIC_SUPABASE_ANON_KEY` — from Supabase dashboard
- `SENTRY_*` — optional, for error tracking

Secrets (never commit):
- `SUPABASE_SERVICE_ROLE_KEY` — `wrangler secret put` (see §5)

## 3. Local development

```bash
cd apps/web
pnpm dev
```

Runs at `localhost:5173` (Vite default).

## 4. Build

```bash
cd apps/web
pnpm build
```

Outputs to `.svelte-kit/cloudflare/` (adapter-cloudflare).

## 5. Deploy

```bash
cd apps/web
# First time: login to Cloudflare
pnpm wrangler login

# Set secrets
pnpm wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Deploy
pnpm run deploy
```

Custom domain `hour.zerosense.studio` attaches automatically if zone is in same CF account.

## 6. Supabase setup (if fresh project)

1. Create project `hour-phase0` in `eu-central-1`
2. Enable Auth → Email provider
3. Run migrations: `supabase db push` or apply via MCP
4. Enable Auth Hook: `public.custom_access_token_hook`

See `migrations/2026-05-01_reset_v2_roadsheet.sql` for current schema.

## 7. Type generation

After wrangler.toml changes:

```bash
cd apps/web
pnpm cf-typegen  # generates worker-configuration.d.ts
```

## 8. Smoke checks

```bash
# Build passes
pnpm build

# No type errors
pnpm check

# Dev server starts
pnpm dev &
curl http://localhost:5173
```

## Troubleshooting

- **Port 5173 in use**: `pnpm dev -- --port 3000`
- **Wrangler auth fails**: `pnpm wrangler login` again
- **DB connection errors**: Check `PUBLIC_SUPABASE_URL` in `.env`

## Next

See `roadmap.md` for current sprint and Phase 0.9 gate items.
