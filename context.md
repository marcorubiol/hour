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
- **Reset v2** (ADR-001..007, 2026-04-19): 18 tables. Polymorphic core is `workspace + project + engagement + show + line + date` — no `project.type` column (ADR-007). Engagement (conversation) distinct from show (atomic gig, ADR-001). Money stack: `invoice + invoice_line + payment + expense` (ADR-003). Editable RBAC: `workspace_role` catalog + `project_membership.roles/grants/revokes` with a 10-permission closed vocabulary (ADR-006). `venue` is its own entity.
- Anti-CRM vocabulary: `person` (global, shared), `engagement` (workspace-scoped, status default `contacted`), `show` (atomic performance with hold/hold_1/2/3 lifecycle), `date` (rehearsal / travel_day / press / other), `venue` (recurring physical place). No lead / pipeline / funnel / prospect.
- Difusión 2026-27 is **not** a project — it's a filtered view over `mamemi` engagements with `custom_fields->>season = '2026-27'`.
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
1. ~~Write `_build/schema.sql`~~ — done, rewritten twice on 2026-04-19 (polymorphic reset → **reset v2**, 18 tables: workspace, user_profile, workspace_membership, workspace_role, person, venue, project, project_membership, line, engagement, show, date, person_note, invoice, invoice_line, payment, expense, audit_log).
2. ~~Write `_build/rls-policies.sql`~~ — done, rewritten twice on 2026-04-19. Reset v2 adds `has_permission(project_id, perm)` + explicit owner/admin bypass, `show_redacted` view, `guard_show_fee_columns` trigger. Supersedes the flat `current_workspace_role IN (...)` pattern for most per-project checks.
3. ~~`git init` + push to GitHub~~ — done, repo at `github.com/marcorubiol/hour`.
4. ~~Write `_build/bootstrap.md`~~ — done 2026-04-19, refreshed for reset v2 (18 tables, 19 helpers).
5. ~~Bootstrap §2 — create Supabase project `hour-phase0` (eu-central-1, Free)~~ — done 2026-04-19.
6. ~~Bootstrap §4 — apply initial migrations to Supabase (polymorphic reset)~~ — done 2026-04-19 via MCP.
7. **Apply reset v2 migration** — MCP `apply_migration` with `schema.sql` + `rls-policies.sql` from `_build/`. Produces 18 tables + 19 helpers + 15-row `workspace_role` seeding on workspace INSERT. Pre-existing polymorphic-reset tables wiped via `DROP SCHEMA public CASCADE` header.
8. ~~Bootstrap §5 — smoke test RLS from `authenticated` role~~ — done 2026-04-19 under the polymorphic schema. **Re-verify under reset v2** once migration applies (15 system roles, `has_permission` owner bypass, `show_redacted` view visible).
9. ~~Bootstrap §6-8 — Cloudflare R2 bucket + Astro+Svelte scaffold + first deploy~~ — done 2026-04-19. R2 bucket `hour-media` created via MCP. Monorepo scaffolded with Astro 5.2 + Svelte 5 + @astrojs/cloudflare v12 (Workers mode). Deployed to `hour-web.marco-rubiol.workers.dev`.
10. **Custom domain** — add `hour.zerosense.studio` in CF Worker Settings → Custom Domains.
11. **Supabase dashboard config (manual)**: Auth → Sign In / Providers → Email = password ON + email confirm ON + secure email change ON + min password length 8. Auth → Hooks → enable `public.custom_access_token_hook` (injects `current_workspace_id` from the user's first `workspace_membership` row).
12. ~~Write `_build/import-plan.md` (map 156 Difusión programmers into new schema)~~ — implemented via the 3-stage import pipeline in `_build/import/`. Updated 2026-04-19 for reset v2 (no tag/tagging step, no `type='show'`, engagement status default `contacted`).
13. **Adjust import loader for reset v2** — `03_load_to_hour.py` needs three edits: drop the tag-creation step, drop `type='show'` from project upsert, change engagement status default to `contacted`. Windsurf task.
14. **Sign up via the app with `marcorubiol@gmail.com`** → run `_build/seed.sql` (CLAIM block — check for `membership` rename) → run `python3 _build/import/03_load_to_hour.py` (no flag) to land 156 persons + 156 engagements (status=`contacted`) on the `mamemi` project with `season=2026-27` in `custom_fields`.

## Open for next session
Reset v2 SQL is regenerated and waits in `_build/`. Nothing is applied yet. Next: (a) review the diff of the 8 regenerated files, (b) apply reset v2 via MCP, (c) patch `seed.sql` and the loader in Windsurf, (d) Marco signs up, (e) run CLAIM + loader, (f) verify `GET /api/engagements?project_slug=mamemi&season=2026-27` with a real JWT.
