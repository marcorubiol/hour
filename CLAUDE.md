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
- Stack: Supabase Cloud + Cloudflare Workers + R2 + pgmq + Resend + Sentry + Astro/Svelte + pnpm monorepo.
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: `organization_id UUID NOT NULL`, RLS at DB level, JWT `current_org_id` claim.
- PKs are UUID v7.
- Does NOT build Spanish labor compliance (that's Ares's territory).
- Indicative Phase 1 pricing: 25 / 60 / 120 €/mes, no setup fee, 14-day trial.
- Coding happens in Claude Code (CLI). Strategy happens in one long Cowork chat ("Hour — Strategy"). Memory lives in `_build/*.md`, not in chats.
- Project lives in AGENCY (the vehicle / work for others), not STUDIO — Marco's call.

## Code
- Local path: `03_AGENCY/Hour/` (monorepo, `git init` done 2026-04-19, branch `main`).
- GitHub repo: `https://github.com/marcorubiol/hour` (private, personal user). Transferable to a `zerosense` org if Phase 1 activates.
- Live site (Phase 0): `hour.zerosense.studio` — **not yet wired**. Worker is live at `https://hour-web.marco-rubiol.workers.dev` (CF Worker `hour-web`, wrangler 4.83.0, first deploy 2026-04-19).
- CF bindings: `MEDIA` → R2 bucket `hour-media` · `ASSETS` → static CDN · `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` in `[vars]`.
- Supabase project: `hour-phase0` · ref `lqlyorlccnniybezugme` · region `eu-central-1` · URL `https://lqlyorlccnniybezugme.supabase.co`.
- Specs and planning: `_build/` (CLAUDE.md, ARCHITECTURE.md, DECISIONS.md, COMPETITION.md).

## Links
- Parent MaMeMi context (where Difusión originated): `01_STAGE/ZS_MaMeMi/`
- Source of the 168 existing leads to import: `01_STAGE/ZS_MaMeMi/Difusión/`

## Upcoming milestones
1. ~~Write `_build/schema.sql`~~ — done (commit `dbd6eed`, 15 tables).
2. ~~Write `_build/rls-policies.sql`~~ — done (commit `dbd6eed`, 18 sections, helpers + ENABLE/FORCE + per-table policies + guard triggers + audit log).
3. ~~`git init` + push to GitHub~~ — done, repo at `github.com/marcorubiol/hour`.
4. ~~Write `_build/bootstrap.md`~~ — done 2026-04-19. Pre-flight patch replaces `pg_uuidv7` with PL/pgSQL `uuid_generate_v7()` (extension not on Supabase Cloud whitelist).
5. ~~Bootstrap §2 — create Supabase project `hour-phase0` (eu-central-1, Free)~~ — done 2026-04-19.
6. ~~Bootstrap §4 — apply migrations to Supabase~~ — done 2026-04-19 via MCP. 4 migrations landed: `initial_schema` (15 tables + uuid_generate_v7 + handle_new_user), `rls_and_audit` (helpers + ENABLE/FORCE + ~40 policies + 3 guard triggers + 8 audit triggers), `hardening_search_paths` (pin search_path on 6 functions, drop unused moddatetime extension), `policy_consolidation_and_fk_indexes` (fold multi-permissive policies, +9 FK indexes). Security advisors: 0 lints. Performance advisors: only the expected `unused_index` INFO on empty tables.
7. ~~Bootstrap §5 — smoke test RLS from `authenticated` role~~ — done 2026-04-19. Cross-tenant isolation verified (alice→alpha, bob→bravo), audit log fires on insert, test data rolled back.
8. ~~Bootstrap §6-8 — Cloudflare R2 bucket + Astro+Svelte scaffold + first deploy~~ — done 2026-04-19. R2 bucket `hour-media` created via MCP. Monorepo scaffolded with Astro 5.2 + Svelte 5 + @astrojs/cloudflare v12 (Workers mode). Deployed to `hour-web.marco-rubiol.workers.dev`. Two post-deploy fixes: `public/.assetsignore` excludes `_worker.js` from CDN upload; wrangler bumped 3→4.
9. **Custom domain** — add `hour.zerosense.studio` in CF Worker Settings → Custom Domains (CF creates DNS automatically since `zerosense.studio` is on CF DNS).
10. **Supabase dashboard config (manual, not MCP-exposed)**: Auth → Providers → Email = magic link only (password OFF), URL Configuration (Site URL = `https://hour.zerosense.studio`, Redirect = `http://localhost:4321/*`), JWT expiry = 2592000.
11. ~~Reconcile `_build/schema.sql` and `_build/rls-policies.sql` with applied DB~~ — done 2026-04-19 (commit `114b47c`). Source files now match DB: `SET search_path` pinned on all functions, consolidated policies with `TO authenticated`, moddatetime line removed, 9 FK indexes added in new section 16 of schema.sql.
12. Update `_build/bootstrap.md` to reflect Workers flow (was written for Pages — actual build used Workers via @astrojs/cloudflare v12).
13. Write `_build/import-plan.md` (map 168 Difusión leads into new schema).
14. Decide: land the 3 `custom_fields jsonb` columns now (Phase 0 prep) or defer — see ADR 2026-04-19 in `_build/DECISIONS.md`.

## Open for next session
Phase 0 infra is **live**. Next: (a) wire `hour.zerosense.studio` custom domain on CF Worker, (b) the 3 Supabase dashboard settings (magic link, URL config, JWT expiry), (c) start on `_build/import-plan.md` for the 168 Difusión leads.
