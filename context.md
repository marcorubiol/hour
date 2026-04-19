> Inherits: `.zerø/context.md` · Method: `_methød/`
> Status: **kept** (valid: live, kept, parked)

# Hour

## What
Multi-tenant B2B SaaS for live performing arts management. Covers the full funnel from *difusión* (booking outreach) to production and execution, for medium cross-genre European companies. Not a labor-compliance tool — that stays with Ares, Holded, or the gestoría.

Working name: **Hour**. Brand decision deferred to Phase 1.

## Phase
**Phase 0 — internal tool for MaMeMi** (Marco + Anouk + ≤5 users, 1 workspace `marco-rubiol`, 1 project `mamemi`). Build is multi-tenant-ready from day one so Phase 1 (SaaS with paying customers) can flip on without a rewrite. Phase 1 decision point: month 6, based on real daily usage and unprompted external demand.

## Key decisions (see `_build/DECISIONS.md` for full log)
- Deploys at `hour.zerosense.studio` (subdomain, zero cost). Brand decision deferred to Phase 1.
- Stack: Supabase Cloud + Cloudflare Workers + R2 + pgmq + Resend + Sentry + Astro/Svelte + pnpm monorepo.
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: `workspace_id UUID NOT NULL`, RLS at DB level, JWT `current_workspace_id` claim. Workspace kind = `personal | team`.
- Polymorphic core (ADR 2026-04-19): `workspace + project (type ∈ show|release|creation_cycle|festival_edition) + engagement`. Replaces the prior organization/contact/event model.
- Anti-CRM vocabulary: `person` (global, shared), `engagement` (workspace-scoped, status `proposed` not `prospect`), `date` (universal child of `project`). No lead/pipeline/funnel.
- Difusión 2026-27 is **not** a project — it's a filtered view over `mamemi` engagements with `custom_fields->>season = '2026-27'` (+ pending date).
- PKs are UUID v7.
- Does NOT build Spanish labor compliance (that's Ares's territory).
- Indicative Phase 1 pricing: 25 / 60 / 120 €/mes, no setup fee, 14-day trial.
- Coding happens in Windsurf (switched from Claude Code). Strategy happens in Cowork. Memory lives in `_build/*.md`, not in chats.
- Project lives in AGENCY (the vehicle / work for others), not STUDIO — Marco's call.

## Code
- Local path: `03_AGENCY/Hour/` (monorepo, `git init` done 2026-04-19, branch `main`).
- GitHub repo: `https://github.com/marcorubiol/hour` (private, personal user). Transferable to a `zerosense` org if Phase 1 activates.
- Live site (Phase 0): `hour.zerosense.studio` — **not yet wired**. Worker is live at `https://hour-web.marco-rubiol.workers.dev` (CF Worker `hour-web`, wrangler 4.83.0, first deploy 2026-04-19).
- CF bindings: `MEDIA` → R2 bucket `hour-media` · `ASSETS` → static CDN · `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` in `[vars]`.
- Supabase project: `hour-phase0` · ref `lqlyorlccnniybezugme` · region `eu-central-1` · URL `https://lqlyorlccnniybezugme.supabase.co`.
- Specs and planning: `_build/` (context.md, ARCHITECTURE.md, DECISIONS.md, COMPETITION.md).

## Links
- Parent MaMeMi context (where Difusión originated): `01_STAGE/ZS_MaMeMi/`
- Source of the 156 existing programmers/festivals to import: `01_STAGE/ZS_MaMeMi/Difusión/`

## Upcoming milestones
1. ~~Write `_build/schema.sql`~~ — done, then rewritten 2026-04-19 (polymorphic reset, 12 tables: workspace, user_profile, membership, project, project_membership, date, person, engagement, person_note, tag, tagging, audit_log).
2. ~~Write `_build/rls-policies.sql`~~ — done, then rewritten 2026-04-19 (7 helpers + ENABLE/FORCE + per-table policies with default DENY + guard triggers + audit log + `custom_access_token_hook` injecting `current_workspace_id`).
3. ~~`git init` + push to GitHub~~ — done, repo at `github.com/marcorubiol/hour`.
4. ~~Write `_build/bootstrap.md`~~ — done 2026-04-19.
5. ~~Bootstrap §2 — create Supabase project `hour-phase0` (eu-central-1, Free)~~ — done 2026-04-19.
6. ~~Bootstrap §4 — apply migrations to Supabase~~ — done 2026-04-19 via MCP. After the polymorphic reset, the applied set is: `polymorphic_reset_drop` (wipe all old tables/enums/functions + trigger on auth.users) → `polymorphic_schema` (12 tables + enums + handle_new_user + on_auth_user_created) → `polymorphic_rls_and_audit` (helpers + RLS + policies + guard/audit triggers + `custom_access_token_hook`) → `move_extensions_out_of_public` (citext + pg_trgm → extensions schema). Security advisors: 0 lints.
7. ~~Bootstrap §5 — smoke test RLS from `authenticated` role~~ — done 2026-04-19 (verified under the prior schema; re-verification pending after Marco signs up and the claim script runs).
8. ~~Bootstrap §6-8 — Cloudflare R2 bucket + Astro+Svelte scaffold + first deploy~~ — done 2026-04-19. R2 bucket `hour-media` created via MCP. Monorepo scaffolded with Astro 5.2 + Svelte 5 + @astrojs/cloudflare v12 (Workers mode). Deployed to `hour-web.marco-rubiol.workers.dev`. Two post-deploy fixes: `public/.assetsignore` excludes `_worker.js` from CDN upload; wrangler bumped 3→4.
9. **Custom domain** — add `hour.zerosense.studio` in CF Worker Settings → Custom Domains (CF creates DNS automatically since `zerosense.studio` is on CF DNS).
10. **Supabase dashboard config (manual, not MCP-exposed)**: Auth → Sign In / Providers → Email = password ON + email confirm ON + secure email change ON + min password length 8 (see ADR `Auth flow: email+password with optional TOTP 2FA` in DECISIONS.md). Auth → Hooks → enable `public.custom_access_token_hook` (injects `current_workspace_id` from the user's first `membership` row). URL Configuration done. JWT expiry stays at Free-plan default (1h) — time-box and inactivity timeout are Pro features.
11. ~~Reconcile `_build/schema.sql` and `_build/rls-policies.sql` with applied DB~~ — done 2026-04-19 (rewrite replaces the previous reconcile pass). Source files are the canonical readable copy of the post-reset DB.
12. ~~Write `_build/import-plan.md` (map 156 Difusión programmers into new schema)~~ — implemented via the 3-stage import pipeline in `_build/import/` (normalize → enrich → load).
13. ~~Adapt the import pipeline to the polymorphic schema~~ — done 2026-04-19. `03_load_to_hour.py` now targets workspace/person/engagement. Supports `--skip-engagements` for when the owner hasn't signed up yet (engagements need `created_by`).
14. **Sign up via the app with `marcorubiol@gmail.com`** → run `_build/seed.sql` (CLAIM block) → run `python3 _build/import/03_load_to_hour.py` (no flag) to land 156 persons + taggings + engagements on the `mamemi` project with `season=2026-27` in `custom_fields`.

## Open for next session
Schema + RLS + auth hook + scaffold + import pipeline are all ready. Next: (a) Marco signs up through the app, (b) apply the CLAIM block in `_build/seed.sql`, (c) enable the access-token hook in the Supabase dashboard, (d) run the loader to populate 156 engagements, (e) verify `GET /api/engagements?project_slug=mamemi&season=2026-27` returns them with a real JWT.
