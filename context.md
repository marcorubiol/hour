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

## Status — 2026-04-20

Infra y datos **operativos**. Pendiente: primera pantalla (engagements de Difusión 2026-27). A partir de aquí, todo el trabajo está en `apps/web/`.

### DB (aplicada vía MCP)
- `hour-phase0` en eu-central-1 · Postgres 17 · 18 tablas + `show_redacted` view · 19 helpers · 53 RLS policies (ENABLE + FORCE)
- Marco es owner de workspace `marco-rubiol` (slug) · 15 system roles seedeados por trigger · proyecto `mamemi` (status=active, sin `type`)
- Datos reales: **154 persons + 154 engagements** (status=`contacted`, `custom_fields.season='2026-27'`), 30 enriquecidos con dossier 2026
- Auth hook `custom_access_token_hook` enabled en dashboard (inyecta `current_workspace_id` desde `workspace_membership`)
- Email+password + Auto-Confirm enabled para el Phase 0 team
- Migraciones aplicadas (en orden): `reset_v2_schema`, `reset_v2_rls_and_audit`, `reset_v2_fix_audit_on_workspace_delete`, `reset_v2_fix_audit_workspace_existence`, `reset_v2_preseed_marco_rubiol_mamemi`, CLAIM block, `reset_v2_import_batch_01..04`, `reset_v2_restore_default_grants`

### Worker (`hour-web` en Cloudflare)
- Desplegado en `https://hour-web.marco-rubiol.workers.dev`
- `GET /api/engagements` actualizado a reset v2 (default `status=contacted`, sin `project.type`)
- Custom domain `hour.zerosense.studio` **no atado todavía** (10 min de dashboard)

### Smoke tests cerrados
- Hook inyecta `current_workspace_id` correctamente (probado con MCP `execute_sql` simulando claims)
- Marco como `authenticated` ve 154 engagements; sin membership: 0 leaks
- `has_permission` owner bypass verificado
- Endpoint en prod devuelve 401 correcto sin JWT. End-to-end con JWT real saltado — se probará naturalmente al construir UI

### Source tree
- Working tree limpio. Últimos commits (12): reset v2 schema/rls, fixes de audit y grants, db-types.ts regenerado, endpoint actualizado, loader (`03_load_to_hour.py`) adaptado a reset v2
- `_build/schema.sql`, `rls-policies.sql`, `seed.sql`, `bootstrap.md`, `import-plan.md`, `ARCHITECTURE.md`, `DECISIONS.md` todos alineados con el estado aplicado

## Next — primera pantalla de Difusión

Pantalla que liste los 154 engagements del workspace `marco-rubiol` / proyecto `mamemi` / season `2026-27`. Debe:
- Pedir login (email+password) → Supabase Auth → JWT con `current_workspace_id` (ya lo inyecta el hook)
- Llamar a `/api/engagements?project_slug=mamemi&season=2026-27&limit=50` con el JWT en `Authorization: Bearer`
- Listar: person.full_name, person.organization_name, person.city, person.country, engagement.status, engagement.next_action_at
- Permitir cambiar `status` inline (enum: contacted, in_conversation, hold, confirmed, declined, dormant, recurring)
- Filtros por: status, procedencia (`person.custom_fields.sources.mostra_igualada_2026.procedencia`), tipologia

Stack ya montado: Astro 5 + Svelte 5 islands + `@astrojs/cloudflare` v12. El login se resuelve con `@supabase/supabase-js` (ya en deps) o fetch directo contra `/auth/v1/token`. RLS ya hace el trabajo de scoping — el cliente no necesita filtrar por workspace.

## Diferido (Phase 0.5 o cuando toque)

- `task` entity + tag vocabulary (ADR-006 Deferred D1)
- UI de overrides granulares por persona (Deferred D2)
- `show` / `line` / `invoice` flows (cuando Marco confirme la primera fecha)
- Custom domain `hour.zerosense.studio`
