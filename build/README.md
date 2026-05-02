# build/ — Documentation Map

This folder contains specs, ADRs, and planning artifacts for Hour.

## Read first (onboarding)

For any AI or person joining the project:

1. [Root `_context.md`](../_context.md) — Project overview, phases, key decisions
2. [`roadmap.md`](roadmap.md) — Living implementation plan
3. [`architecture.md`](architecture.md) — Technical stack, security, environments
4. [Root `_decisions.md`](../_decisions.md) — Decision log (chronological)
5. [`runbooks/rollback.md`](runbooks/rollback.md) — If doing ops

## By category

### Architecture & Planning
- `architecture.md` — Stack, multi-tenancy, security, Phase 0.9 gate
- `roadmap.md` — Phases 0.0 → 1, sprints, ADRs
- `competition.md` — 20 competitors analyzed

### Setup & Operations
- `setup.md` — Current setup guide (SvelteKit + Workers + Supabase)
- `runbooks/rollback.md` — Emergency rollback procedures
- `bootstrap.md` — **HISTORICAL** (Astro-based setup, pre-ADR-026)

### Schema & Data
- `migrations/` — Current schema source of truth
  - `2026-05-01_reset_v2_roadsheet.sql` — Canonical (22 tables)
  - `2026-05-01_post_roadsheet_cleanup.sql` — Fixes post-apply
- `schema.sql` — Base reset v2 (partial, 18 tables)
- `rls-policies.sql` — RLS helpers (partial)
- `seed.sql` — Pre-seed for marco-rubiol/mamemi
- `import/` — 3-stage pipeline (154 contacts loaded)

### Prompts & Workflows
- `director-prompt.md` — Prompt for strategic AI conversations
- `design-prompt.md` — Prompt for design sessions
- `_context.md` — This folder's workflow guide

### Archive
- `archive/` — Historical prompts and obsolete docs
  - `reset-v2-prompt.md` — Task prompt for schema reset v2
  - `README.md` — Archive index

### Research
- `../research/` — Competitor/pricing/UX research (see `INDEX.md`)

## Rule

**Memory lives in files, not chats.** Every decision worth keeping → `_decisions.md`. Every architectural choice → `architecture.md`.

## Status

Last updated: 2026-05-02 (Phase 0.9 gate defined, 22 tables, SvelteKit stack)
