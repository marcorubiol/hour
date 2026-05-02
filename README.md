# Hour

Multi-tenant B2B SaaS for live performing arts management. Replaces Excel + Drive + Gmail + Notion + WhatsApp for booking outreach, touring, and production.

## Current Phase

**Phase 0.0** — Internal tool for MaMeMi (Marco + Anouk, ≤5 users)

→ **Phase 0.9** — Private beta hardening gate (before external clients)

→ **Phase 1** — Public SaaS if beta validates demand

## Stack

- **Frontend**: SvelteKit 2 + Svelte 5 + `@sveltejs/adapter-cloudflare`
- **Backend**: Supabase Cloud (Postgres 17, Auth, RLS, Realtime)
- **Edge**: Cloudflare Workers + R2 + Durable Objects (y-partyserver)
- **Monorepo**: pnpm workspaces

## Quickstart for developers

```bash
# Install
cd apps/web
pnpm install

# Dev server
pnpm dev        # localhost:5173

# Type generation (after DB changes)
pnpm cf-typegen # generates worker-configuration.d.ts
```

## Where docs live

Read in this order:
1. [`_context.md`](_context.md) — Project context, phases, key decisions
2. [`build/roadmap.md`](build/roadmap.md) — Living implementation plan
3. [`build/architecture.md`](build/architecture.md) — Technical stack, security
4. [`_decisions.md`](_decisions.md) — ADR log (chronological)
5. [`build/runbooks/rollback.md`](build/runbooks/rollback.md) — If doing ops

## Do not touch before reading

See `_context.md` §"REGLA DEL PROYECTO" — read `03_AGENCY/_area-methød/code/philosophy.md` before writing code.

## Deploy

- Production: `hour.zerosense.studio`
- Worker: `hour-web.marco-rubiol.workers.dev`
- Supabase: `hour-phase0` (eu-central-1)

---

Working name **Hour**. Brand decision deferred to Phase 1.
