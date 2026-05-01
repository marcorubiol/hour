> Inherits: `.zerø/_system-context.md` · Method: `_methød/`
> Status: **kept** (valid: live, kept, parked)
> Dev env: pnpm + per-project wrangler. See `_methød/code/dev-environment.md` and `## Dev setup` below.

> **REGLA DEL PROYECTO — leer ANTES de escribir código**
>
> Antes de tocar una sola línea de código en Hour (CSS, JavaScript, Svelte, HTML, schema, API), leer **`03_AGENCY/_area-methød/code/philosophy.md`**.
>
> No es lectura recomendada — es la regla de oro del sistema. Cualquier decisión técnica se evalúa contra los 5 principios universales descritos ahí. Si un patrón típico de la industria contradice la filosofía y el contexto del proyecto no lo justifica explícitamente como "isla de pragma", **gana la filosofía**.
>
> Casos comunes que afecta:
> - CSS: defaults a nivel de selector con `:where()`, no en clases. Modificadores redeclaran CSS variables, no propiedades.
> - JS / Svelte 5: `$derived` antes que `$state` con `$effect`. Una técnica para todo el dominio.
> - HTML: elementos semánticos directos, no `<div>` con role.
> - Tokens: tres categorías (base hues / status / contextual). Naming semántico, no numérico.

# Hour

## What
Multi-tenant B2B SaaS for live performing arts management. Covers the full funnel from *difusión* (booking outreach) to production and execution, for medium cross-genre European companies. Not a labor-compliance tool — that stays with Ares, Holded, or the gestoría.

Working name: **Hour**. Brand decision deferred to Phase 1.

## Phase
**Phase 0 — internal tool for MaMeMi** (Marco + Anouk + ≤5 users, 1 workspace `marco-rubiol`, 1 project `mamemi`). Build is multi-tenant-ready from day one so Phase 1 (SaaS with paying customers) can flip on without a rewrite. Phase 1 decision point: month 6, based on real daily usage and unprompted external demand.

## Key decisions (see `_decisions.md` for full log)
- Deploys at `hour.zerosense.studio` (subdomain, zero cost). Brand decision deferred to Phase 1.
- Stack: Supabase Cloud + Cloudflare Workers + R2 + pgmq + Resend + Sentry + **SvelteKit 2 + Svelte 5** + pnpm monorepo (ADR-026, 2026-05-01: migrated from Astro 5 + islands; reverts D-PRE-02).
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: `workspace_id UUID NOT NULL`, RLS at DB level, JWT `current_workspace_id` claim. Workspace kind = `personal | team`.
- **Reset v2** (ADR-001..007, 2026-04-19): 18 tables. Polymorphic core is `workspace + project + engagement + show + line + date` — no `project.type` column (ADR-007). Engagement (conversation) distinct from show (atomic gig, ADR-001). Money stack: `invoice + invoice_line + payment + expense` (ADR-003). Editable RBAC: `workspace_role` catalog + `project_membership.roles/grants/revokes` with a 10-permission closed vocabulary (ADR-006). `venue` is its own entity.
- **URL architecture** (ADR-022, 2026-04-24): three levels — ephemeral session state in `localStorage`, canonical entity URLs (`/h/:workspace-slug/:entity/:slug-or-id`) stable and shareable, view-state URLs via explicit "Copy link" gesture. Path-prefix multi-tenancy (not subdomain in Phase 0). Signed public links for road sheet only in Phase 0 (partial D6).
- **Road sheet model** (ADR-023, 2026-04-24): not an entity — projection of `show` + junctions, filtered by role. Schema extensions: 5 timeslot columns + 3 jsonb (`logistics`, `hospitality`, `technical`) on `show`; new tables `crew_assignment`, `cast_override`, `asset_version` (with `direction` enum `outbound|inbound|adapted` — captures venue returns and per-venue variants). No state machine. URL `/h/:workspace/gig/:slug/roadsheet` with optional `?role=`. Closes the "Lens Technical" pendiente (top-nav lens dropped).
- **Slug naming** (ADR-024, 2026-04-24): clean names + hard reject + `previous_slugs text[]` for rename history. GitHub/Slack model. Immutable `id uuid` separate from mutable slug column. Uniqueness scope `(workspace_id, entity_type)`. Industry research of 10 SaaS confirmed nobody uses numeric suffixes as default UX.
- **CRDT transport** (ADR-025, 2026-04-24; *transport refined 2026-05-01*): `y-partyserver` (PartyKit's active successor under Cloudflare) on native Durable Objects declared in `wrangler.jsonc` for collaborative editing of text-free fields (`show.notes`, `project.notes`). Auth gates WebSocket via Supabase JWT + membership check; RLS never sees Yjs binary. Snapshots persisted to `collab_snapshot` table every 30 updates / 60s. Hibernation supported (cheaper at scale). Scoped to text fields only — structured fields use Supabase Realtime with last-write-wins.
- **Frontend stack migration** (ADR-026, 2026-05-01): SvelteKit 2 + Svelte 5 + `@sveltejs/adapter-cloudflare` replaces Astro 5 + islands. Triggered by audit showing 95% of code already in vanilla JS or Svelte; Astro was a 30-LoC SSR envelope. Gains: client-side routing, form actions with progressive enhancement, `load()` with dependency tracking, `hooks.server.ts`, cross-route stores. New defaults wired in same migration: Valibot at `+server.ts` boundaries, Sentry hooks (DSN env-var), TanStack Query for server-state cache (Plaza/Desk).
- **Full implementation plan**: `build/roadmap.md` (documento vivo, 25 ADRs + 14 D-PRE, fases 0.0 → 1, próximo sprint 13 días). Abrir primero al retomar Hour.
- Anti-CRM vocabulary: `person` (global, shared), `engagement` (workspace-scoped, status default `contacted`), `show` (atomic performance with hold/hold_1/2/3 lifecycle), `date` (rehearsal / travel_day / press / other), `venue` (recurring physical place). No lead / pipeline / funnel / prospect.
- Difusión 2026-27 is **not** a project — it's a filtered view over `mamemi` engagements with `custom_fields->>season = '2026-27'`.
- PKs are UUID v7.
- Does NOT build Spanish labor compliance (that's Ares's territory).
- Indicative Phase 1 pricing: 25 / 60 / 120 €/mes, no setup fee, 14-day trial.
- Coding happens in Windsurf (switched from Claude Code). Strategy happens in Cowork. Memory lives in `build/*.md`, not in chats.
- Project lives in AGENCY (the vehicle / work for others), not STUDIO — Marco's call.
- **Palette (semi-firm, evolutionary)**: primary `oklch(0.52 0.141 29.7)` = `#AB4235` (terracotta / brick red, decided 2026-04-25). Light theme (D-PRE-01). Three colour categories: base hues (`primary`, `base`, `neutral`) + status (`info`, `success`, `warning`, `danger`) + contextual (`text-color`, `bg-*`). All shades via `color-mix()` in OKLCH. Will keep evolving as the panel takes shape.

## Code
- Local path: `03_AGENCY/Hour/` (monorepo, `git init` done 2026-04-19, branch `main`).
- GitHub repo: `https://github.com/marcorubiol/hour` (private, personal user). Transferable to a `zerosense` org if Phase 1 activates.
- Live site (Phase 0): `hour.zerosense.studio` — **wired and serving** (custom domain attached in CF dashboard between 2026-04-20 and 2026-04-25). Worker primary URL: `https://hour-web.marco-rubiol.workers.dev` (CF Worker `hour-web`, wrangler 4.83.0, first deploy 2026-04-19, last deploy 2026-04-20). The custom domain proxies through CF normally — both URLs serve the same content.
- CF bindings: `MEDIA` → R2 bucket `hour-media` · `ASSETS` → static CDN · `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` in `[vars]`.
- Supabase project: `hour-phase0` · ref `lqlyorlccnniybezugme` · region `eu-central-1` · URL `https://lqlyorlccnniybezugme.supabase.co`.
- Specs and planning: `build/` (`_context.md`, `architecture.md`, `competition.md`) plus `_decisions.md` at project root.

## Links
- Parent MaMeMi context (where Difusión originated): `01_STAGE/ZS_MaMeMi/`
- Source of the 156 existing programmers/festivals to import: `01_STAGE/ZS_MaMeMi/Difusión/`

## Status — 2026-04-20

Infra, datos y **primera pantalla funcional**. Login + lista de engagements desplegados y operativos. Todo el trabajo está en `apps/web/`.

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
- Custom domain `hour.zerosense.studio` atado y sirviendo vía CF (entre 2026-04-20 y 2026-04-25)

### Frontend (`apps/web/`) — post-ADR-026 (2026-05-01)
- **Stack**: SvelteKit 2 + Svelte 5 (runes) + `@sveltejs/adapter-cloudflare`. Routes en `src/routes/`. `$lib/` para componentes/helpers. TanStack Query + Sentry hooks instalados.
- **Login** (`/login`): email+password contra Supabase Auth REST API, JWT en localStorage, redirect a `/booking`. Form Svelte con `$state` + bind + handleSubmit.
- **Booking** (`/booking`): lista de 154 engagements con nombre, organización, ubicación, status (badges con color), próxima acción. Paginación funcional (50/page). Logout. Redirect a login si JWT ausente o 401. Render Svelte real con `{#each}` + `$derived` (no innerHTML).
- **API** (`/api/engagements`): SvelteKit `+server.ts`. Filtros validados con Valibot (status/project_slug/season + limit/offset). PostgREST con RLS, exact count. Tipado con `$lib/db-types`.
- **Pendiente en UI**: cambio de status inline, filtros (status/procedencia/tipología), Plaza + Desk shell (Phase 0.1, ADR-009).

### Smoke tests cerrados
- Hook inyecta `current_workspace_id` correctamente (probado con MCP `execute_sql` simulando claims)
- Marco como `authenticated` ve 154 engagements; sin membership: 0 leaks
- `has_permission` owner bypass verificado
- Endpoint en prod devuelve 401 correcto sin JWT
- **End-to-end con JWT real**: login funcional, datos cargando en `/difusion` — verificado en producción

### Source tree
- Working tree limpio
- `build/schema.sql`, `rls-policies.sql`, `seed.sql`, `bootstrap.md`, `import-plan.md`, `architecture.md`, `_decisions.md` (en root) todos alineados con el estado aplicado

## Product vocabulary (ADR-008, 2026-04-20)

Four-level naming mapping to schema entities:
- **House** = `workspace` = company, collective, personal brand
- **Room** = `project` = show, piece, album, production
- **Run** = `line` = tour, season, festival circuit, residency block
- **Gig** = `show` = single performance event

Plus **Desk** = the primary UI lens (the "what's on your plate" view).

Schema retains technical names (`workspace`, `project`, `line`, `show`). Product vocabulary appears in UI, docs, and user-facing copy.

## UI architecture (ADR-009, 2026-04-20)

Single-layout app with two controls:
- **Lenses** (sidebar top): Desk, Calendar, Contacts, Money. Determines what type of content. Future lenses (Comms, Archive) add a line — no layout change.
- **Sidebar entities** (sidebar bottom): flat list of Houses → Rooms. No MY/COLLABORATING split.

**Dual-mode sidebar**:
- **Desk + entity selected** = destination (detail view: House overview, Room profile with assets/team/runs)
- **Other lenses + entity selected** = filter (Calendar shows only that scope's gigs, etc.)

**Room detail** (Desk + Room) has tabs: Work, Assets, Team, About. Assets include riders (versioned), dossiers, QLab sessions, Ableton sessions, stage plots, photos, videos. Assets are Room-level (canonical) or Gig-level (per-venue adaptations).

**⌘K** is first-class from day 1. Sidebar can be hidden entirely for ⌘K-only navigation.

## Next — ver `build/roadmap.md`

El roadmap completo con fases, decisiones previas obligatorias, MVP y próximo sprint concreto vive en **`build/roadmap.md`** (documento vivo, escrito 2026-04-24).

Resumen en una línea: antes de tocar UI, cerrar las 5 decisiones D-PRE-01 a D-PRE-05 y completar Phase 0.0 (fundación: tokens + primitivos + router + migración road sheet). Luego Phase 0.1 (Plaza + Desk shell) hasta Phase 0.4 (polish + ⌘K + mobile). Phase 0.5 son deferred features. Phase 1 es SaaS readiness.

## Diferido (Phase 0.5 o cuando toque)

- `task` entity — polymorphic (project/line/show/engagement), origin: manual/protocol/ai. Manual tasks needed for Desk view. Includes task protocols: reusable chains with relative date offsets that auto-generate prep tasks backwards from gig/fair dates (ADR-011). (Deferred D3)
- Communication layer — unified email/WhatsApp/Telegram/calls contextualised by House/Room (Deferred D4)
- App mode — PWA installable (desktop + mobile), not web-only. Must feel like a native app. (Deferred D5)
- Public guest links — shareable URL (no signup required) where external collaborators (technicians, freelancers) can view their assigned gigs/dates/rider. If they choose to sign up, their guest view upgrades to a full `guest` membership with write access. Two tiers: anonymous-read via signed link, authenticated-write via `guest` role. (Deferred D6)
- Fair intelligence — import attendee lists (CSV or screenshot via AI vision), cross-reference against existing contacts, surface matches and new-contact opportunities. Needs fair entity or date.kind='fair' with attendee junction. (Deferred D7, ADR-012)
- AI integration — invisible helper philosophy (ADR-013). Two interaction patterns: (1) continuous/invisible — AI fills fields like decision windows (ADR-019), (2) punctual/explicit — user clicks "generate dossier draft" (ADR-020). AI-touched fields get visual marker; high-stakes generation requires accept/dismiss (ADR-021). (Deferred D8)
- Kanban view — available in Desk and Contacts lenses as work-mode complement to calendar. Groups by status. (Deferred D9, ADR-010)
- Timeline view — horizontal/vertical timeline showing cascading task chains from protocol tasks. Depends on D3. (Deferred D10, ADR-010)
- `task` tag vocabulary (Deferred D1)
- UI de overrides granulares por persona (Deferred D2)
- `show` / `line` / `invoice` flows (cuando Marco confirme la primera fecha)

## Dev setup

- **Package manager:** pnpm 10.33.0 (pinned via `packageManager` field in root `package.json`). Monorepo with `pnpm-workspace.yaml` listing `apps/*` + `packages/*`.
- **Wrangler:** local devDependency in `apps/web/package.json` (currently `^4.83.0`). NEVER instalado global. Invocar como `pnpm wrangler <cmd>` desde `apps/web` o vía scripts (`pnpm run deploy`).
- **Reglas portables:** `_methød/code/dev-environment.md` — léelas antes de añadir un nuevo dev tool al monorepo.
