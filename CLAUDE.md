> Inherits: `.Zerø/CLAUDE.md` · Method: `_METHØD/`
> Status: **kept** (valid: live, kept, parked)

# Hour

## What
Multi-tenant B2B SaaS for live performing arts management. Covers the full funnel from *difusión* (booking outreach) to production and execution, for medium cross-genre European companies. Not a labor-compliance tool — that stays with Ares, Holded, or the gestoría.

Working name: **Hour**. Brand decision deferred to Phase 1.

## Phase
**Phase 0 — internal tool for MaMeMi** (Marco + Anouk + ≤5 users, 1 organization). Build is multi-tenant-ready from day one so Phase 1 (SaaS with paying customers) can flip on without a rewrite. Phase 1 decision point: month 6, based on real daily usage and unprompted external demand.

## Key decisions (see `_build/DECISIONS.md` for full log)
- Deploys at `hour.zerosense.studio` (subdomain, zero cost). Brand decision deferred to Phase 1.
- Stack: Supabase Cloud + Cloudflare Pages + R2 + pgmq + Resend + Sentry + Astro/Svelte + pnpm monorepo.
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: `organization_id UUID NOT NULL`, RLS at DB level, JWT `current_org_id` claim.
- PKs are UUID v7.
- Does NOT build Spanish labor compliance (that's Ares's territory).
- Indicative Phase 1 pricing: 25 / 60 / 120 €/mes, no setup fee, 14-day trial.
- Coding happens in Claude Code (CLI). Strategy happens in one long Cowork chat ("Hour — Strategy"). Memory lives in `_build/*.md`, not in chats.
- Project lives in AGENCY (the vehicle / work for others), not STUDIO — Marco's call.

## Code
- Local path: *TBD — first code session will `git init` the monorepo here at `03_AGENCY/Hour/` or a sibling folder*.
- GitHub repo: *TBD — decide between personal user and a future `zerosense` org at kickoff*.
- Live site (Phase 0): `hour.zerosense.studio` (not yet deployed).
- Specs and planning: `_build/` (CLAUDE.md, ARCHITECTURE.md, DECISIONS.md, COMPETITION.md).

## Links
- Parent MaMeMi context (where Difusión originated): `01_STAGE/ZS_MaMeMi/`
- Source of the 168 existing leads to import: `01_STAGE/ZS_MaMeMi/Difusión/`

## Upcoming milestones
1. Write `_build/schema.sql` (organization, user/membership, project, 3-tier contact, event, task, file, note, rider).
2. Write `_build/rls-policies.sql` (tenant isolation + role-based refinements).
3. Write `_build/bootstrap.md` (Supabase project + CF DNS + Pages + first deploy).
4. Write `_build/import-plan.md` (map 168 Difusión leads into new schema).
5. `git init` the monorepo, first deploy to `hour.zerosense.studio`.

## Open for next session
Review `_build/ARCHITECTURE.md`, `_build/DECISIONS.md`, `_build/COMPETITION.md` briefly, then jump into `schema.sql` in Claude Code (CLI).
