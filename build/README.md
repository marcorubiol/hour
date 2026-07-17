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
- `migrations/` — Current schema source of truth. The **whole folder**, applied in
  date order, is the canonical record — no single file is.
  - `2026-05-01_reset_v2_roadsheet.sql` — the reset v2 baseline (22 tables **as of
    that date**; the live schema is **29** — account, cast, task, share and alias
    layers all landed in later files here)
  - `2026-05-01_post_roadsheet_cleanup.sql` — Fixes post-apply
- `schema.sql` — **frozen snapshot, 2026-05-01. Not current, by its own header**
  ("This file has NOT been rewritten in-place"). Predates `show` → `performance`
  (ADR-036) and `engagement` → `conversation` (ADR-075) — it describes a schema
  that no longer exists. Read `migrations/` or dump the live schema instead.
- `rls-policies.sql` — same: frozen at 2026-05-01, same two renames missing.
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

Last updated: 2026-07-17 — counts re-read from the live catalog: **29 tables**, 1 view
(`performance_redacted`), 59 functions, 82 RLS policies, 21 enums. Previous stamp
2026-05-02 said 22 tables; seven layers landed since without this file noticing.
