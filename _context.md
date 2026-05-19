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
**Phase 0 — internal tool for MaMeMi** (Marco + Anouk + ≤5 users, workspaces `marco-rubiol` personal + `mamemi` team). Build is multi-tenant-ready from day one so Phase 1 (SaaS with paying customers) can flip on without a rewrite.

**Phase 0.9 — private beta hardening gate**: mandatory before any external known client. Adds httpOnly sessions, rate limiting, RLS regression tests, restore drill, admin/support minimum, observability and health checks.

**Phase 1 — SaaS readiness/public launch**: self-serve onboarding/billing only if assisted beta validates demand.

## Key decisions (see `_decisions.md` for full log)
- Deploys at `hour.zerosense.studio` (subdomain, zero cost). Brand decision deferred to Phase 1.
- Stack: Supabase Cloud + Cloudflare Workers + R2 + pgmq + Resend + Sentry + **SvelteKit 2 + Svelte 5** + pnpm monorepo (ADR-026, 2026-05-01: migrated from Astro 5 + islands; reverts D-PRE-02).
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: 3-layer model **`account` (billing) → `workspace` (RLS scope) → project** (ADR-032, 2026-05-18). Account es la entidad pagadora (Basecamp-like, 1 suscripción Stripe cuando llegue Phase 1); workspace es la unidad multi-tenant aislada (Slack-like, un user atraviesa N workspaces de N accounts vía workspace_memberships). RLS at DB level. JWT `current_workspace_id` claim. Account kind = `personal | team`; workspace kind también `personal | team`.
- **Reset v2 + roadsheet + account + cast layers** (ADR-001..007 + ADR-023 + ADR-032 + ADR-034 + ADR-035, 2026-04-19 → 2026-05-19): **25 tablas**. Polymorphic core: `account + workspace + project + engagement + show + line + date` — no `project.type` column (ADR-007). Engagement (conversation) distinct from show (atomic gig, ADR-001). **Line** es la agrupación operativa dentro del project ("línea de trabajo"), con `kind` enum de 10 valores: `tour | season | phase | circuit | residency | other | creation | campaign | comms | misc` (ADR-031 amplió enum, ADR-035 revertió el rename a section → vuelta a `line`). Money stack: `invoice + invoice_line + payment + expense` (ADR-003). Editable RBAC: `workspace_role` catalog + `project_membership.roles/grants/revokes` con 10-permission closed vocabulary (ADR-006). `venue` es su propia entidad. **Cast** (ADR-034, 2026-05-19): canónico a nivel project (`cast_member`), sustituciones puntuales por show (`cast_override`). Crew sigue exclusivamente show-scoped (`crew_assignment`) — asimetría intencional porque el dominio planifica cast una vez y crew show a show.
- **Shell user-scoped + lens nav top + Plaza lens** (ADR-029 + ADR-030, 2026-05-18): sidebar muestra TODAS las workspaces del usuario simultáneamente (cross-account, Slack-like). Lens nav vive en el TOP del main como horizontal pills: `Plaza · Calendar · Contacts · Money`. El componente `Plaza.svelte` (sidebar upper) y la `Plaza` lens (top pill) comparten nombre a propósito — misma idea conceptual: la Plaza es tu mapa de trabajo, la lens es el modo de trabajarla. `RoomStructure` (sidebar lower) reemplaza el componente Desk original; solo visible cuando hay Room seleccionada en URL. Lens primaria "Desk" descartada (sin task entity = navegación vacía, strategy review §3); reaparecerá en Phase 0.5+ si D3 task entity llega.
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
- **Private beta gate (Phase 0.9)**: no external workspace before cookies httpOnly, rate limiting, RLS regression suite, restore drill, admin/support minimum, structured logging, health checks and Sentry PII scrub.
- Indicative Phase 1 pricing: 25 / 60 / 120 €/mes, no setup fee, 14-day trial.
- Coding happens in Windsurf (switched from Claude Code). Strategy happens in Cowork. Memory lives in `build/*.md`, not in chats.
- Project lives in AGENCY (the vehicle / work for others), not STUDIO — Marco's call.
- **Visual language v0.5** (ADR-033, 2026-05-18): editorial-sobrio. Plum retired — `--primary` reasigned to `var(--text-color)` (cool ink `oklch(18% 0.015 280)`). Surfaces warm-cream (5 layers), ink cool (3 weights), state lifecycle (info/success/warning/danger/faint), 8 abstract accents mapped by `hash(slug) % 8` (helper `$lib/utils/accent.ts`), 6 tag-tone pairs (amber/blue/teal/green/purple/red). Typography: Newsreader display + Inter sans + JetBrains Mono metadata (loaded in `app.html`). Three colour categories preserved (base hues / status / contextual) per philosophy.md. All shades via `color-mix()` in OKLCH. Reference: `/Users/marcorubiol/Downloads/Hour/Hour Design System.html`.

## Code
- Local path: `03_AGENCY/Hour/` (monorepo, `git init` done 2026-04-19, branch `main`).
- GitHub repo: `https://github.com/marcorubiol/hour` (private, personal user). Transferable to a `zerosense` org if Phase 1 activates.
- Live site (Phase 0): `hour.zerosense.studio` — **wired and serving** (custom domain attached in CF dashboard between 2026-04-20 and 2026-04-25). Worker primary URL: `https://hour-web.marco-rubiol.workers.dev` (CF Worker `hour-web`, wrangler 4.83.0, first deploy 2026-04-19). El custom domain proxies through CF normally — both URLs serve the same content.
- CF bindings: `MEDIA` → R2 bucket `hour-media` · `ASSETS` → static CDN · `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` in `[vars]`. DO binding `ROADSHEET_COLLAB` cross-Worker hacia `hour-collab`.
- Supabase project: `hour-phase0` · ref `lqlyorlccnniybezugme` · region `eu-central-1` · URL `https://lqlyorlccnniybezugme.supabase.co`.
- Specs and planning: `build/` (`roadmap.md`, `architecture.md`, `competition.md`, `runbooks/`) plus `_decisions.md` at project root.
- **Historial sesión-a-sesión:** `_notes/sessions-log.md` (archivo extraído de aquí el 2026-05-18 cuando este archivo cruzó los 40k chars). Para detalle más granular: `git log --oneline`.

## Links
- Parent MaMeMi context (where Difusión originated): `01_STAGE/ZS_MaMeMi/`
- Source of the 156 existing programmers/festivals to import: `01_STAGE/ZS_MaMeMi/Difusión/`

## Status — 2026-05-18

**Phase 0.1 cerrada al 100% del roadmap salvo trabajos bloqueados por datos reales (#3 GigDetail, #5 ProductionStub, #6 endpoints runs/gigs, #9 write queue offline) o estandalone restantes (#11 Settings — también cerrado).** Cuatro ADRs aplicados en sesión 2026-05-18:

- **ADR-029** — shell user-scoped: sidebar multi-house simultáneo + lens nav top + RoomStructure reemplaza Desk component.
- **ADR-030** — naming gate close: lens primaria `Plaza` (no `Rooms`) + project `mamemi.name` renamed a "Difusión 2026-27".
- **ADR-031** — schema rename `line` → `section` + expand kind enum a 10 valores (incluye creation/campaign/comms/misc).
- **ADR-032** — `account` layer above workspace (billing entity Basecamp-like + user atraviesa N accounts Slack-like).

Resultado: 24 tablas en producción, datos productivos visibles, smoke verde, multi-tenant 3-layer listo para clientes externos.

**Phase 0.1 cerrada definitivamente 2026-05-18.** Los dos gates decididos 2026-05-14 (checkpoint visual 1 + naming gate con Anouk) Marco los está ejecutando asíncronamente fuera de esta sesión — el rework visual lo lleva por su cuenta y el naming queda asumido cerrado (las confusiones se cazaron y cerraron en la propia sesión: Plaza lens + project rename + line→section). Próxima fase: **Phase 0.2 — Views + Road sheet colaborativo + Calendar**, con la deuda Phase 0.9 hardening en paralelo cuando convenga (cookies httpOnly, rate limiting, RLS regression suite — antes de cliente externo).

Detalle de las sesiones de cierre en `_notes/sessions-log.md` § 2026-05-18 (4 entradas: ADR-032, ADR-031, ADR-030, Phase 0.1 sprint principal continuación).

### DB en producción
- `hour-phase0` · Postgres 17 · **25 tablas** + `show_redacted` view · 24 functions · 78 RLS policies (ENABLE + FORCE)
- Modelo 3-layer en producción tras `add_account_layer`: 3 accounts (marco-rubiol-acc, mamemi-acc, playwright-acc) + 3 workspaces + 1 project (Difusión 2026-27 dentro de workspace mamemi)
- Auth hook `custom_access_token_hook` enabled (inyecta `current_workspace_id` desde `workspace_membership`). `handle_new_user` trigger actualizado (ADR-032) para crear account + account_membership ANTES del workspace personal en cada signup
- Datos reales en workspace `mamemi`: **154 persons + 154 engagements** (status=`contacted`, `custom_fields.season='2026-27'`), 30 enriquecidos con dossier 2026. Workspace `marco-rubiol` personal queda vacía tras `phase_0_1_multi_workspace_split` (2026-05-18)

### Phase 0.1 — trabajos restantes
- **#3 GigDetail mobile-first** — bloqueado por #6 + datos reales de gig.
- **#5 ProductionStub** — bloqueado por #3.
- **#6 Endpoints `/api/runs` + `/api/gigs` + `/api/gigs/:id`** — trabajo en seco (sin data); cuando confirmes primera fecha real.
- **#9 Write queue offline scaffolding** — bloqueado por write paths (PATCH inline status, etc.).
- **#11 Settings + Master View toggle** — independiente, ~45 min. Estandalone si quieres cerrar #11 antes del checkpoint visual 1.

### Gates al cerrar Phase 0.1 (decisión 2026-05-14)
- **Checkpoint visual 1** — pasada de ~1 día con datos productivos (154 engagements visibles). Evaluar: plum trial, densidad, jerarquía, tipografía. Visual debt anotada 2026-05-18:
  - Gap exagerado entre Room header (`Status: active`) y RelationshipStub.
  - Plaza spacing entre Houses engaña — Marco Rubiol vacía parece tener contenido en blanco.
  - Eyebrow "ROOM" aparece duplicado (sidebar lower header + main header).
- **Naming gate** — testear `House`, `Room`, `Run`, `Gig`, `Plaza`, `Rooms` lens con Anouk (5 min) + 1-2 externos del circuito. Riesgo #14 directo. Si emerge confusión seria, refactor mecánico (~medio día) antes de Phase 0.2.

## Open debts (priority-ordered)

Lista honesta de lo que falta, ordenada por ratio coste/riesgo. **Atacar de arriba abajo.**

1. **[ALTA Phase 0.9] Cookies httpOnly en lugar de JWT en localStorage** (4-6h). Hoy XSS = sesión exfiltrable. Phase 0 con 5 usuarios conocidos OK; antes de meter primer cliente externo (Phase 0.9 gate), mover a httpOnly+Secure+SameSite=Strict.
2. **[BAJA] Pasada cosmética de primitivos** (30 min, opcional). Avatar usa template literal para clases mientras Button/Chip usan `[...].filter(Boolean).join(' ')`. Menu línea 55 `open ? close() : openMenu()` mejor como `if/else`. Cosmético — no rompe nada.

### Phase 0.9 hardening backlog (antes de cliente externo conocido)
- **Rate-limit `/api/sentry-tunnel`** vía Cloudflare KV (~30 min). CF WAF rate-limit es add-on de pago; KV en Worker free es suficiente.
- **RLS regression suite** — 6 escenarios priorizados por valor (cubren ~80% del riesgo multi-tenant real, validados en revisión externa 2026-05-09):
  1. **Cross-workspace leakage hard deny** — user de workspace A no lee project/show/engagement/person_note/invoice de workspace B aunque conozca UUIDs/slugs. List sin filtro, select por id, join indirecto vía engagement→project, slug conocido. Expected: 0 rows o 403, sin filtrar existencia.
  2. **Membership revoke con JWT vivo** — user con JWT válido + `current_workspace_id`, membership eliminada, sigue intentando lectura. Expected (decisión a tomar): RLS deniega vía `exists workspace_membership where accepted_at + revoked_at IS NULL` o aceptar ventana hasta expiración (1h). Phase 0.9 endurece.
  3. **Project permission gate** — viewer con `read:engagement` ve / sin `read:money` no ve fee real / con grant explícito gana / con revoke explícito pierde aunque rol lo tenga / owner+admin bypass. Valida `has_permission()` union + grants - revokes.
  4. **Money redaction + write guard** — sin `read:money` lee `show_redacted` con fee masked, con `read:money` ve fee real, sin `edit:money` update rechazado por trigger, con `edit:money` permitido.
  5. **Private person_note** — author lee su nota `visibility='private'`, otro member del mismo workspace no la lee, cross-workspace nunca, workspace-note sí leen miembros autorizados.
  6. **Soft-delete invisibility** — `deleted_at IS NOT NULL` no aparece en list endpoints ni select por id (salvo rol admin con test separado explícito).
  - Bonus 7º: **access-token hook claim correctness** — sign-in/refresh inyecta `current_workspace_id` correcto con/sin membership aceptada/múltiples workspaces.
- **Smoke e2e collab DO** — 7 checks para Phase 0.2, archivados en `_notes/sessions-log.md` § 2026-05-09 (PartyServer DO scaffold).
- **Restore drill** — proced documentado y probado para restaurar desde backup R2 a Supabase staging en <30 min.
- **Admin/support minimum** — UI básica para listar workspaces, diagnosticar memberships, resetear slugs.
- **Structured logging** — formato JSON para logs Worker, correlación por request_id. Verificar que JWT en query string del WS collab no se loguea (Cloudflare logs / Sentry breadcrumbs / console / errors).
- **Health checks** — endpoints `/health/live` (dependencias OK) y `/health/ready` (servicio usable).
- **Sentry PII scrub** — actualmente `sendDefaultPii: true` en `apps/web/src/hooks.client.ts:18` y `apps/web/src/hooks.server.ts:26` (descubierto en revisión externa 2026-05-09). Acciones concretas: (a) `sendDefaultPii: false` en client + server; (b) Replay con masking por defecto; (c) `beforeSend` que scrubea email, JWT, Authorization, cookies, query params sensibles (especialmente `?token=` del WS collab); (d) verificar que el rate-limit del tunnel cae también aquí.

### Diferido a Phase 1 con coste asociado (no acción hasta entonces)
- **Leaked Password Protection** (Supabase Pro feature). Toggle de 1 click cuando active el plan Pro al onboardar primer cliente pagante.
- **paraglide-js v2** para i18n (~2-3h). El `$lib/i18n.ts` simple actual cubre los ~15 strings de Phase 0. Migrar cuando llegue contenido en español o pase de 50 strings.
- **Sentry source-map auth token rotation policy** — el token actual (`sntryu_...`) en `apps/web/.env` no caduca. Revisar a Phase 1 si se quiere rotar.

## Product vocabulary (ADR-008 → updated por ADR-030 + ADR-031 + ADR-032 → reverted por ADR-033, 2026-05-18)

Naming gate resuelto 2026-05-18: UI usa vocabulario industria-standard. Schema mantiene technical names.

| Producto (UI label) | Schema | Definición |
|---|---|---|
| (sin user-facing label aún; "Account" en admin UI Phase 1) | `account` | Entidad pagadora. Billing boundary. Personal (1 user) o team. Invisible en UI Phase 0; emerge en Settings → Account management. (ADR-032) |
| **Project** | `workspace` | Tenant aislado. RLS scope. Lo que ves como top-level en el sidebar bajo el eyebrow "PROJECTS". |
| (sin UI label en Phase 0; "Project" interno) | `project` | Proyecto creativo dentro de un workspace. En Phase 0 sólo hay 1 por workspace (convención), por lo que la UI lo trata como child implícito del workspace. Cuando aparezca el primer schema `project` distinto del workspace homónimo, decidir representación visual separada (ADR-033 open item). |
| **Line** (UI label) | `section` | Agrupación operativa: tour, season, phase, circuit, residency, other, creation, campaign, comms, misc (kind enum, ADR-031). Renderiza en sidebar lower (`<RoomStructure>`). |
| **Show** | `show` | Single performance event. |

**Lens primaria**: **Today** (ADR-033). Pills: `Today · Calendar · Contacts · Money`. Componentes internos mantienen los nombres `Plaza.svelte` (sidebar upper) y "Desk" como concepto del sistema de pills — no aparecen en copy visible.

URL paths siguen con segmentos legacy `/h/[workspace]/room/[slug]/` (rename a `/project/` requiere 301 redirect, ~30 min, se hace cuando un user externo bookmarquee — coste no justificado en Phase 0).

Schema retains technical names (`account`, `workspace`, `project`, `line`, `show`). UI labels pueden cambiar libremente hasta Phase 0.9 sin tocar schema (ADR-008 separation).

**Naming reversibility window** (2026-05-14): renaming UI labels (House/Project/Room/Section/Gig/Plaza/etc.) cuesta ~half day to one day mientras estemos entre Phase 0.0 y Phase 0.9. El trabajo mecánico: rename folders en `src/routes/h/[workspace]/...`, update `$lib/reserved-slugs.ts`, find/replace componentes, update i18n keys, rename endpoints. Schema NO cambia. Después de Phase 0.9 (clientes externos con bookmarks/screenshots/training materials), el coste escala a semanas. Gap a flaggear: `previous_slugs[]` cubre rename de slug dentro de una entity, pero NO entity-type segment renames (`/room/` → `/project/` requiere 301 redirect rule explícita, ~30 min cuando aplique).

## UI architecture (ADR-009 → updated por ADR-029 + ADR-030, 2026-05-18)

Single-layout app con dos controles:

- **Lens nav** (top del main, **horizontal pills**): `Plaza · Calendar · Contacts · Money`. Determina qué tipo de contenido se muestra. Plaza es el modo default (lo que estás viendo + lo que harías a continuación). Future lenses (Comms, Archive) se añaden como pills adicionales sin cambiar layout.
- **Sidebar** (user-scoped, **cross-account**):
  - **Plaza component** (sidebar upper): multi-house tree mostrando TODAS las workspaces del usuario simultáneamente (cross-account, Slack-like). Cada House con sus Rooms indentadas.
  - **RoomStructure** (sidebar lower, solo visible cuando hay Room seleccionada): muestra Section + Show tree de la Room actual. Empty state "Select a Room to see its structure" cuando no hay selección.

**Lens × Room scope** determines main content:
- **Plaza + Room** = Room detail (RelationshipStub + future stubs Runs/Assets/Team).
- **Calendar + Room** = filtered calendar (Phase 0.2).
- **Contacts + Room** = filtered contacts (Phase 0.3).
- **Money + Room** = filtered invoices (Phase 0.3).

**Cross-highlight UP** (ADR-029 trabajo #8): si una Room está seleccionada, su House padre también lleva primary color en sidebar. Tres estados: `active` (URL = House home), `on-path` (URL = Room de esa House), inactive.

**Room detail** (Plaza + Room) tendrá tabs: Work, Assets, Team, About (Phase 0.3+). Assets son Room-level (canonical) o Gig-level (per-venue adaptations). Phase 0.1 muestra solo header + RelationshipStub + 3 stubs dashed.

**⌘K** first-class desde día 1 (Phase 0.4). Sidebar puede ocultarse entera para ⌘K-only navigation.

## Next — ver `build/roadmap.md`

El roadmap completo con fases, decisiones previas obligatorias, MVP y próximo sprint concreto vive en **`build/roadmap.md`** (documento vivo, escrito 2026-04-24).

Resumen en una línea: antes de tocar UI, cerrar las 5 decisiones D-PRE-01 a D-PRE-05 y completar Phase 0.0 (fundación: tokens + primitivos + router + migración road sheet). Luego Phase 0.1 (Plaza + Desk shell) hasta Phase 0.4 (polish + ⌘K + mobile). Phase 0.5 son deferred features. Phase 1 es SaaS readiness.

## Diferido (Phase 0.5 o cuando toque)

- **`share`** — per-engagement curated microsite (ADR-028, 2026-05-09). Lazy-creado al primer click de compartir; signed URL larga + rotable, sin login del programador; show-driven branding con subtítulo customizable; assets canónicos del show + uploads engagement-scope; email archive vía BCC tipo Basecamp (Cloudflare Email Workers); tracking medio. Wedge de diferenciación vs Drive/WeTransfer. Phase 0.5 item 4. Coste 2-3 sem.
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
