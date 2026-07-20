# Hour

Multi-tenant operating system for small and medium live-performing-arts teams:
conversations, planning, production, road sheets, people, tasks and money in one
shared model.

## Status

**Phase 0 — internal tool, preparing the private-beta gate.** The app is live at
`hour.zerosense.studio`, but it is not a public SaaS and does not have self-serve
onboarding or billing.

The canonical current state is [`_context.md`](_context.md). The only active work
queue is [`_tasks.md`](_tasks.md). Do not infer current status from archived
prompts, session notes or old ADR status paragraphs.

## Stack

- SvelteKit 2 + Svelte 5 + TypeScript + Vite
- Supabase Cloud: Postgres 17, Auth, RLS, Realtime and pgmq
- Cloudflare Workers, R2 and Durable Objects (`y-partyserver`)
- pnpm monorepo, Vitest, Playwright and Sentry

## Start here

For any person or AI agent:

1. [`_context.md`](_context.md) — verified current state and vocabulary
2. [`_tasks.md`](_tasks.md) — current priorities
3. [`build/architecture.md`](build/architecture.md) — technical model
4. [`build/structure-model.md`](build/structure-model.md) — product structure
5. [`_decisions.md`](_decisions.md) — append-only decision history

Historical plans and executed prompts live in [`build/archive/`](build/archive/README.md)
and are not executable instructions.

## Development

```bash
pnpm install
pnpm dev
pnpm --filter web check
pnpm --filter web test:unit
pnpm --filter web test:rls
pnpm build
```

Local public configuration comes from `apps/web/.env`. Test credentials are in
gitignored `.env.test`; runtime secrets belong in Wrangler or the operating-system
keychain. See [`build/setup.md`](build/setup.md).

## Production

- App: `https://hour.zerosense.studio`
- Worker: `hour-web`
- Supabase: `hour-phase0` (`eu-central-1`)
- Health truth: `GET /health/live` and `GET /health/ready`

Deploys require a clean tree and publish their Git SHA through `/health/live`.

## Project rule

Before changing code, read the Zerø code philosophy linked from `_context.md`.
For navigation, lenses, modules or entity detail, also read
`build/structure-model.md`.
