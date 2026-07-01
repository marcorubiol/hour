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
**Phase 0 — internal tool for MüK Cia** (Marco + Anouk + ≤5 users, workspaces `marco-rubiol` personal + `muk-cia` team). MaMeMi es UN espectáculo (project) dentro de la compañía MüK Cia. Build is multi-tenant-ready from day one so Phase 1 (SaaS with paying customers) can flip on without a rewrite.

**Phase 0.9 — private beta hardening gate**: mandatory before any external known client. Adds httpOnly sessions, rate limiting, RLS regression tests, restore drill, admin/support minimum, observability and health checks.

**Phase 1 — SaaS readiness/public launch**: self-serve onboarding/billing only if assisted beta validates demand.

## Key decisions (see `_decisions.md` for full log)
- Deploys at `hour.zerosense.studio` (subdomain, zero cost). Brand decision deferred to Phase 1.
- Stack: Supabase Cloud + Cloudflare Workers + R2 + pgmq + Resend + Sentry + **SvelteKit 2 + Svelte 5** + pnpm monorepo (ADR-026, 2026-05-01: migrated from Astro 5 + islands; reverts D-PRE-02).
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: 3-layer model **`account` (billing) → `workspace` (RLS scope) → project** (ADR-032, 2026-05-18). Account es la entidad pagadora (Basecamp-like, 1 suscripción Stripe cuando llegue Phase 1); workspace es la unidad multi-tenant aislada (Slack-like, un user atraviesa N workspaces de N accounts vía workspace_memberships). RLS at DB level. JWT `current_workspace_id` claim. Account kind = `personal | team`; workspace kind también `personal | team`.
- **Reset v2 + roadsheet + account + cast layers + performance rename** (ADR-001..007 + ADR-023 + ADR-032 + ADR-034 + ADR-035 + ADR-036, 2026-04-19 → 2026-05-19): **25 tablas**. Polymorphic core: `account + workspace + project + engagement + performance + line + date` — no `project.type` column (ADR-007). Engagement (conversation) distinct from performance (atomic gig, ADR-001). **Line** es la agrupación operativa dentro del project ("línea de trabajo"), con `kind` enum de 10 valores: `tour | season | phase | circuit | residency | other | creation | campaign | comms | misc` (ADR-031 amplió enum, ADR-035 revertió el rename a section → vuelta a `line`). **Performance** (ADR-036, 2026-05-19): renombre de `show` para evitar confusión con "espectáculo/producción" en castellano; "performance" universal cross-arts. Column `show_start_at` → `start_at`. Money stack: `invoice + invoice_line + payment + expense` (ADR-003). Editable RBAC: `workspace_role` catalog + `project_membership.roles/grants/revokes` con 10-permission closed vocabulary (ADR-006). `venue` es su propia entidad. **Cast** (ADR-034, 2026-05-19): canónico a nivel project (`cast_member`), sustituciones puntuales por performance (`cast_override`). Crew sigue exclusivamente performance-scoped (`crew_assignment`) — asimetría intencional porque el dominio planifica cast una vez y crew performance a performance.
- **Shell user-scoped + lens nav top + sidebar como filtro multi-select** (ADR-029 + ADR-030 + ADR-033 + ADR-038 + ADR-039, 2026-05-18 → 2026-05-19): shell vive en `/h/+layout.svelte` (no `/h/[workspace]/+layout`, hoisted 2026-05-19 ADR-039). Sidebar muestra TODAS las workspaces del usuario simultáneamente (cross-account, Slack-like). Lens nav vive en el TOP del main como horizontal pills: `Today · Calendar · Contacts · Money` (Today es la lens primaria desde ADR-033; Plaza como nombre de lens descartado, sobrevive solo como nombre del componente sidebar). **Sidebar = filtro multi-select** (ADR-038): Plaza (workspaces × projects) + `LineList` (lines de la unión) operan como filtro orto, no navegación exclusiva. LineList es siempre visible (no requiere project seleccionado); muestra todas las lines accesibles por RLS ordenadas por `last_navigated_at` cuando no hay filtro, filtradas por la unión cuando hay. Lens primaria "Desk" descartada en strategy review §3 (sin task entity); reaparecerá en Phase 0.5+ si D3 llega.
- **URL architecture** (ADR-022, 2026-04-24): three levels — ephemeral session state in `localStorage`, canonical entity URLs (`/h/:workspace-slug/:entity/:slug-or-id`) stable and shareable, view-state URLs via explicit "Copy link" gesture. Path-prefix multi-tenancy (not subdomain in Phase 0). Signed public links for road sheet only in Phase 0 (partial D6).
- **Road sheet model** (ADR-023, 2026-04-24; vocab updated ADR-036 + ADR-037, 2026-05-19): not an entity — projection of `performance` + junctions, filtered by role. Schema extensions: 5 timeslot columns + 3 jsonb (`logistics`, `hospitality`, `technical`) on `performance`; new tables `crew_assignment`, `cast_override`, `asset_version` (with `direction` enum `outbound|inbound|adapted` — captures venue returns and per-venue variants). No state machine. URL `/h/:workspace/performance/:slug/roadsheet` with optional `?role=`. Closes the "Lens Technical" pendiente (top-nav lens dropped).
- **Slug naming** (ADR-024, 2026-04-24): clean names + hard reject + `previous_slugs text[]` for rename history. GitHub/Slack model. Immutable `id uuid` separate from mutable slug column. Uniqueness scope `(workspace_id, entity_type)`. Industry research of 10 SaaS confirmed nobody uses numeric suffixes as default UX.
- **CRDT transport** (ADR-025, 2026-04-24; *transport refined 2026-05-01*): `y-partyserver` (PartyKit's active successor under Cloudflare) on native Durable Objects declared in `wrangler.jsonc` for collaborative editing of text-free fields (`performance.notes`, `project.notes`). Auth gates WebSocket via Supabase JWT + membership check; RLS never sees Yjs binary. Snapshots persisted to `collab_snapshot` table every 30 updates / 60s. Hibernation supported (cheaper at scale). Scoped to text fields only — structured fields use Supabase Realtime with last-write-wins.
- **Frontend stack migration** (ADR-026, 2026-05-01): SvelteKit 2 + Svelte 5 + `@sveltejs/adapter-cloudflare` replaces Astro 5 + islands. Triggered by audit showing 95% of code already in vanilla JS or Svelte; Astro was a 30-LoC SSR envelope. Gains: client-side routing, form actions with progressive enhancement, `load()` with dependency tracking, `hooks.server.ts`, cross-route stores. New defaults wired in same migration: Valibot at `+server.ts` boundaries, Sentry hooks (DSN env-var), TanStack Query for server-state cache (Plaza/Desk).
- **Full implementation plan**: `build/roadmap.md` (documento vivo, 25 ADRs + 14 D-PRE, fases 0.0 → 1, próximo sprint 13 días). Abrir primero al retomar Hour.
- Anti-CRM vocabulary: `person` (global, shared), `engagement` (workspace-scoped, status default `contacted`), `performance` (atomic gig with hold/hold_1/2/3 lifecycle — ADR-036 renamed from `show`), `date` (rehearsal / travel_day / press / other), `venue` (recurring physical place). No lead / pipeline / funnel / prospect.
- Difusión 2026-27 is a **line** (kind=campaign) within the MaMeMi project (ADR-036 reorg 2026-05-19). Engagements live at project level (MaMeMi); the line is the operational frame for this season's outreach. Engagements de la temporada se filtran por `custom_fields->>season = '2026-27'`.
- PKs are UUID v7.
- Does NOT build Spanish labor compliance (that's Ares's territory).
- **Private beta gate (Phase 0.9)**: no external workspace before cookies httpOnly, rate limiting, RLS regression suite, restore drill, admin/support minimum, structured logging, health checks and Sentry PII scrub.
- Indicative Phase 1 pricing: 25 / 60 / 120 €/mes, no setup fee, 14-day trial.
- Coding happens in Windsurf (switched from Claude Code). Strategy happens in Cowork. Memory lives in `build/*.md`, not in chats.
- Project lives in AGENCY (the vehicle / work for others), not STUDIO — Marco's call.
- **Visual language v0.5** (ADR-033, 2026-05-18): editorial-sobrio. Plum retired — `--primary` reasigned to `var(--text-color)` (cool ink `oklch(18% 0.015 280)`). Surfaces warm-cream (5 layers), ink cool (3 weights), state lifecycle (info/success/warning/danger/faint), 8 abstract accents mapped by `hash(slug) % 8` (helper `$lib/utils/accent.ts`), 6 tag-tone pairs (amber/blue/teal/green/purple/red). Typography: Newsreader display + Inter sans + JetBrains Mono metadata (loaded in `app.html`). Three colour categories preserved (base hues / status / contextual) per philosophy.md. All shades via `color-mix()` in OKLCH. Reference: `/Users/marcorubiol/Downloads/Hour/Hour Design System.html`.

## Code
- Local path: `~/Developer/hour/` (monorepo, `git init` done 2026-04-19, branch `main`). Code moved out of the vault into `~/Developer/` on the 2026-06-04 machine recovery — the vault folder `03_AGENCY/Hour/` now holds project markdown + a `code` symlink → `~/Developer/hour`. (New repo-in-`~/Developer` model, see `.zerø/_system-context.md` § Coordinated git repos.)
- GitHub repo: `https://github.com/marcorubiol/hour` (private, personal user). Transferable to a `zerosense` org if Phase 1 activates.
- Live site (Phase 0): `hour.zerosense.studio` — **wired and serving** (custom domain attached in CF dashboard between 2026-04-20 and 2026-04-25). Worker primary URL: `https://hour-web.marco-rubiol.workers.dev` (CF Worker `hour-web`, wrangler 4.83.0, first deploy 2026-04-19). El custom domain proxies through CF normally — both URLs serve the same content.
- CF bindings: `MEDIA` → R2 bucket `hour-media` · `ASSETS` → static CDN · `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` in `[vars]`. DO binding `ROADSHEET_COLLAB` cross-Worker hacia `hour-collab`.
- Supabase project: `hour-phase0` · ref `lqlyorlccnniybezugme` · region `eu-central-1` · URL `https://lqlyorlccnniybezugme.supabase.co`.
- Specs and planning: `build/` (`roadmap.md`, `architecture.md`, `competition.md`, `runbooks/`) plus `_decisions.md` at project root.
- **Historial sesión-a-sesión:** `_notes/sessions-log.md` (archivo extraído de aquí el 2026-05-18 cuando este archivo cruzó los 40k chars). Para detalle más granular: `git log --oneline`.

## Links
- Parent MaMeMi context (where Difusión originated): `01_STAGE/ZS_MaMeMi/`
- Source of the 156 existing programmers/festivals to import: `01_STAGE/ZS_MaMeMi/Difusión/`

## Status — 2026-07-01

**ADR-040: primer write path en producción.** Tras ~6 semanas de pausa (última sesión de código 2026-05-19; solo recovery chores el 2026-06-04), un check-in estratégico detectó el riesgo "construido pero no usado": la app era read-only mientras la difusión 2026-27 real (su caso piloto, 154 engagements cargados) avanzaba fuera de Hour. Respuesta: adelantar el write path mínimo de engagement de Phase 0.5 a ya — excepción puntual, no reordenación de fases (ADR-040 en `_decisions.md`).

- `/booking` edita inline: **status** (menú sobre el propio badge, 7 estados) y **next action** (dialog con fecha + nota). Optimistic update con rollback + toast de error — el error→recovery loop que el roadmap exigía antes de cualquier PATCH (riesgo #5).
- **`PATCH /api/engagements/:id`** — Valibot whitelist (status/next_action_at/next_action_note; columnas RLS-sensibles no pueden colarse), `deleted_at=is.null`, RLS decide vía `has_permission(project_id, 'edit:engagement')`. Respuesta = row + embeds (misma forma que la lista).
- **Eliminado el TEMP VISUAL MOCK que llevaba en producción desde Phase 0.1** — las primeras 7 filas de la lista real mostraban estados falsos ("Remove before deploy" nunca ejecutado).
- Infra nueva: `pgPatch` en `$lib/supabase.ts`, `$lib/engagement.ts` (vocabulario de status único — antes duplicado en booking + RelationshipStub — + contrato PATCH + tipos compartidos), `<Toast />` montado app-global en el layout raíz, `Input type="date"`.
- Tests: 24 unit verdes (10 nuevos del contrato PATCH), suite RLS `engagement-write.test.ts` y e2e `engagement-write.spec.ts` nuevas (self-reverting sobre datos reales; skip sin `.env.test`).
- Escrituras **online-only** con rollback claro; el write queue offline (primitivos IndexedDB ya en `$lib/offline/db.ts`) sigue siendo Phase 0.2+ — deuda explícita en ADR-040.

Sesión anterior (maratón 2026-05-19, 27 commits, ADRs 034-039: naming gate, sidebar como filtro, shell hoist): detalle completo en `_notes/sessions-log.md` § 2026-05-19.

Próxima fase: **Phase 0.2** — Calendar lens + Road sheet colaborativo. El editor inline de engagement migrará a la Contacts lens en Phase 0.3. Deuda Phase 0.9 hardening en paralelo cuando convenga (cookies httpOnly, rate limiting — antes de cliente externo).

### DB en producción
- `hour-phase0` · Postgres 17 · **25 tablas** + `performance_redacted` view · 24 functions · 78 RLS policies (ENABLE + FORCE)
- Modelo 3-layer: 3 accounts (marco-rubiol-acc, muk-cia-acc, playwright-acc) + 4 workspaces (marco-rubiol, muk-cia, playwright, demo) + 2 projects (MaMeMi dentro de muk-cia con 154 engagements y line `difusion-2026-27`; Última órbita dentro de demo con 1 line tour y 3 performances)
- Auth hook `custom_access_token_hook` enabled (inyecta `current_workspace_id`). `handle_new_user` trigger actualizado (ADR-032) crea account + account_membership antes del workspace personal en cada signup.
- Datos reales en `muk-cia`: **154 persons + 154 engagements** (status=`contacted`, `custom_fields.season='2026-27'`), 30 enriquecidos con dossier 2026, atados al project MaMeMi + line "Difusión 2026-27" (kind=campaign). Workspace `marco-rubiol` personal vacía. Workspace `demo` con "Última órbita" para validar render cross-workspace.
- Migraciones aplicadas 2026-05-19 (orden cronológico): `add_cast_member`, `revert_section_to_line`, `rename_show_to_performance`, `data_rename_muk_cia`, `add_line_last_navigated_at`, `create_workspace_rpc`, `create_project_rpc`, `create_line_rpc`, `workspace_accent_and_description`.

### Phase 0.1 — trabajos pendientes (post 2026-07-01)
Vocab actualizado tras ADR-037. Estado real:
- **#3 PerformanceDetail mobile-first** (era GigDetail) — bloqueado por #6 + primera fecha real productiva.
- **#5 ProductionStub** — bloqueado por #3.
- **#6 Endpoints `/api/lines`, `/api/performances`, `/api/performances/:id`** — `/api/lines` ya construido en ADR-038. Faltan los de performances en mode read (write paths Phase 0.2+).
- **#9 Write queue offline scaffolding** — DESBLOQUEADO por ADR-040 (primer write path real existe: `PATCH /api/engagements/:id`, mutación centralizada en un `createMutation`). El enqueue+replay+conflict UI sigue pendiente, Phase 0.2+.
- **#11 Settings + Master View toggle** — ✅ CERRADO 2026-05-19 (commit `b387fe9`).

### Deuda de test infra (2026-07-01)
- **`.env.test` perdido en el recovery 2026-06-04** → smoke e2e + suites RLS se saltan (skip) en esta máquina. Recrear per `build/runbooks/test-user-setup.md` (resetear password del user `playwright@hour.test` desde el dashboard Supabase).
- **Suites pre-rename desactualizadas**: `tests/smoke.spec.ts` (espera lens "Plaza" y URL `/h/mamemi/room/mamemi`) y `tests/rls/cross-tenant.test.ts` (espera workspace slug `mamemi`, hoy `muk-cia`; falta `demo` en el mundo) quedaron obsoletas con ADR-036/037 y nunca corrieron después. El runbook `test-user-setup.md` también describe el mundo viejo. Actualizarlas al recrear credenciales — no antes (editarlas sin poder ejecutarlas es adivinar). Las suites nuevas de ADR-040 (`engagement-write.*`) ya están escritas contra el mundo actual.

### Gates Phase 0.1 — ambos cerrados
- ✅ **Checkpoint visual 1** — ratificado en sesión 2026-05-19. Visual debt 2026-05-18 (gap Room header, Plaza spacing, eyebrow duplicado) resuelta por evolución del shell. Checkpoint visual 2 (`9f8bcd9`) añadió dark mode + polish editorial-sobrio encima.
- ✅ **Naming gate** — cerrado en vivo durante la sesión. Las confusiones cazadas por Marco al usar la UI productiva (line vs section, show vs performance, room/gig vs project/performance) generaron ADR-035/036/037 que limpiaron schema + UI + URL + código en el mismo pase. Test externo con Anouk + 1-2 más diferido a checkpoint Phase 0.4 como ratificación, no decisión.

## Open debts (priority-ordered)

Lista honesta de lo que falta, ordenada por ratio coste/riesgo. **Atacar de arriba abajo.**

1. **[ALTA Phase 0.9] Cookies httpOnly en lugar de JWT en localStorage** (4-6h). Hoy XSS = sesión exfiltrable. Phase 0 con 5 usuarios conocidos OK; antes de meter primer cliente externo (Phase 0.9 gate), mover a httpOnly+Secure+SameSite=Strict.
2. **[BAJA] Pasada cosmética de primitivos** (30 min, opcional). Avatar usa template literal para clases mientras Button/Chip usan `[...].filter(Boolean).join(' ')`. Menu línea 55 `open ? close() : openMenu()` mejor como `if/else`. Cosmético — no rompe nada.

### Phase 0.9 hardening backlog (antes de cliente externo conocido)
- **Rate-limit `/api/sentry-tunnel`** vía Cloudflare KV (~30 min). CF WAF rate-limit es add-on de pago; KV en Worker free es suficiente.
- **RLS regression suite** — 6 escenarios priorizados por valor (cubren ~80% del riesgo multi-tenant real, validados en revisión externa 2026-05-09):
  1. **Cross-workspace leakage hard deny** — user de workspace A no lee project/performance/engagement/person_note/invoice de workspace B aunque conozca UUIDs/slugs. List sin filtro, select por id, join indirecto vía engagement→project, slug conocido. Expected: 0 rows o 403, sin filtrar existencia.
  2. **Membership revoke con JWT vivo** — user con JWT válido + `current_workspace_id`, membership eliminada, sigue intentando lectura. Expected (decisión a tomar): RLS deniega vía `exists workspace_membership where accepted_at + revoked_at IS NULL` o aceptar ventana hasta expiración (1h). Phase 0.9 endurece.
  3. **Project permission gate** — viewer con `read:engagement` ve / sin `read:money` no ve fee real / con grant explícito gana / con revoke explícito pierde aunque rol lo tenga / owner+admin bypass. Valida `has_permission()` union + grants - revokes.
  4. **Money redaction + write guard** — sin `read:money` lee `performance_redacted` con fee masked, con `read:money` ve fee real, sin `edit:money` update rechazado por trigger, con `edit:money` permitido.
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

## Product vocabulary (ADR-008 → ADR-030 → ADR-033 → ADR-035 → ADR-036 → ADR-037, 2026-05-18 → 2026-05-19)

Naming gate cerrado 2026-05-19 tras dos roundtrips vividos en UI productiva. Vocabulario UI/URL/schema/código alineado.

| UI label | Schema | URL | Definición |
|---|---|---|---|
| (sin label visible Phase 0; "Account" en admin UI Phase 1) | `account` | n/a | Entidad pagadora. Billing boundary. Personal (1 user) o team. Invisible hasta Settings → Account management Phase 1. (ADR-032) |
| **Workspace** | `workspace` | `/h/[workspace]/` | Tenant aislado. RLS scope. Top-level en sidebar Plaza, bajo eyebrow ("Projects" en `+layout.svelte:380`; debate Places/Projects pending en `_notes/_flux.md`). |
| **Project** | `project` | `/h/[ws]/project/[slug]/` | Producción creativa dentro de un workspace. Phase 0 con 1-2 por workspace; Phase 0.5+ más finos. |
| **Line** | `line` | `/h/[ws]/project/[slug]/line/[line]/` | Línea de trabajo dentro de un project. `kind` enum 10 valores: tour / season / phase / circuit / residency / other / creation / campaign / comms / misc (ADR-035 mantuvo `line` después del roundtrip section). Renderiza en sidebar lower (`<LineList>`), siempre visible, filtrada por selección Plaza. |
| **Performance** | `performance` | `/h/[ws]/performance/[slug]/` | Gig atómico. Antes `show` (ADR-036 rename 2026-05-19 para vocab cross-arts). Column principal: `start_at` (era `show_start_at`). |

**Lens primaria**: **Today** (ADR-033). Pills: `Today · Calendar · Contacts · Money`. Componente sidebar upper `Plaza.svelte` mantiene nombre interno (no aparece en copy visible).

URL paths actualizados a vocabulario schema-aligned 2026-05-19 (ADR-037 cleanup): `/h/[workspace]/project/[slug]/` (was `/room/`), `/h/[workspace]/performance/[slug]/` (was `/gig/`). 301 redirects en `hooks.server.ts` para bookmarks/links viejos. API endpoints renombrados: `/api/projects` (was `/api/rooms`), `/api/workspaces` (was `/api/houses`).

Schema retains technical names (`account`, `workspace`, `project`, `line`, `performance`). UI labels pueden cambiar libremente hasta Phase 0.9 sin tocar schema (ADR-008 separation).

**Naming reversibility window** (2026-05-14): renaming UI labels (House/Project/Room/Section/Gig/Plaza/etc.) cuesta ~half day to one day mientras estemos entre Phase 0.0 y Phase 0.9. El trabajo mecánico: rename folders en `src/routes/h/[workspace]/...`, update `$lib/reserved-slugs.ts`, find/replace componentes, update i18n keys, rename endpoints. Schema NO cambia. Después de Phase 0.9 (clientes externos con bookmarks/screenshots/training materials), el coste escala a semanas. Gap a flaggear: `previous_slugs[]` cubre rename de slug dentro de una entity, pero NO entity-type segment renames (`/room/` → `/project/` requiere 301 redirect rule explícita, ~30 min cuando aplique).

## UI architecture (ADR-009 → ADR-029 → ADR-033 → ADR-037 → ADR-038 → ADR-039, 2026-05-18 → 2026-05-19)

Shell vive en `/h/+layout.svelte` (hoisted up desde `/h/[workspace]/+layout.svelte` 2026-05-19, ADR-039). Cualquier URL bajo `/h/` recibe el mismo shell; el path `/h/[ws]/` representa "browsing context", no implica que ese workspace esté seleccionado.

Single-layout app con dos controles:

- **Lens nav** (top del main, horizontal pills): `Today · Calendar · Contacts · Money`. Today es la lens default (lo que está pasando y lo siguiente). Future lenses (Comms, Archive) se añaden como pills adicionales sin cambiar layout.
- **Sidebar (filtro multi-select)** (user-scoped, cross-account):
  - **Plaza** (sidebar upper, `Plaza.svelte`): árbol multi-workspace mostrando TODAS las workspaces del usuario simultáneamente (cross-account, Slack-like). Cada workspace con sus projects indentados. Workspace y project filas son `<a>` con href computado por preview (toggle ON/OFF de la selección). Action clusters por hover (Settings, Add project/line, Focus). In-place creation (workspace, project, line) inline desde el propio sidebar. Focus mode aísla la selección a un único item (snapshot + restore al salir).
  - **LineList** (sidebar lower, `LineList.svelte`): siempre visible. Lee `selection.svelte.ts` y muestra:
    - Vacío → todas las lines accesibles por RLS, sort por `last_navigated_at` desc.
    - 1 workspace → lines de proyectos de ese workspace.
    - 1 project → lines de ese project.
    - N items → union.
    - Subtitle "in <project>" cuando hay >1 project en scope.

**Selección persistente**: URL (canonical `/h/[ws]/project/[slug]/` cuando colapsa a 1 entity; query params `?ws=&project=` cuando es multi) + localStorage fallback al aterrizar en `/h/` vacío. Lens activa y focus state también persistidos en localStorage (commit `4436af8`, cross-session).

**URL routing** (ADR-037 cleanup vocab):
- `/h/[ws]/` — workspace context, sin entity seleccionada.
- `/h/[ws]/project/[slug]/` — project detail (Phase 0.1 muestra RelationshipStub + stubs).
- `/h/[ws]/project/[slug]/line/[line]/` — line detail (Phase 0.1 trabajo nuevo, sesión 2026-05-19).
- `/h/[ws]/performance/[slug]/` — performance detail (Phase 0.2).
- `/h/[ws]/engagement/[slug]/`, `/h/[ws]/person/[slug]/` — preserved desde ADR-022.
- `/h/[ws]/settings/` — settings + Master View toggle (D-PRE-05 wired 2026-05-19).
- 301 redirects en `hooks.server.ts` para vocab viejo (`/room/`, `/gig/`).

**Project detail** (lens Today + project seleccionado) tendrá tabs: Work, Assets, Team, About (Phase 0.3+). Phase 0.1 muestra solo header + RelationshipStub + 3 stubs dashed.

**⌘K** first-class desde día 1 (Phase 0.4). Sidebar puede ocultarse entera para ⌘K-only navigation.

## Next — ver `build/roadmap.md`

El roadmap completo con fases, decisiones previas obligatorias, MVP y próximo sprint concreto vive en **`build/roadmap.md`** (documento vivo). El propio roadmap tiene una nota de divergencia (la sesión 2026-05-19 no siguió el orden del roadmap pero cerró deuda real — ver `## Current operating state` ahí).

Estado a 2026-05-19: Phase 0.0 + 0.1 cerradas (incluyendo D-PRE-05 Master View wired). Phase 0.2 (Calendar lens + Road sheet colaborativo) es la siguiente fase, pero el modelo de shell ya no es el que el roadmap describía — sidebar es filtro multi-select, no navegación (ADR-038). Phase 0.5 son deferred features. Phase 0.9 hardening gate antes de cliente externo. Phase 1 es SaaS readiness.

## Diferido (Phase 0.5 o cuando toque)

- **`share`** — per-engagement curated microsite (ADR-028, 2026-05-09). Lazy-creado al primer click de compartir; signed URL larga + rotable, sin login del programador; show-driven branding con subtítulo customizable; assets canónicos del show + uploads engagement-scope; email archive vía BCC tipo Basecamp (Cloudflare Email Workers); tracking medio. Wedge de diferenciación vs Drive/WeTransfer. Phase 0.5 item 4. Coste 2-3 sem.
- `task` entity — polymorphic (project/line/performance/engagement), origin: manual/protocol/ai. Manual tasks needed for Desk view. Includes task protocols: reusable chains with relative date offsets that auto-generate prep tasks backwards from performance/fair dates (ADR-011). (Deferred D3)
- Communication layer — unified email/WhatsApp/Telegram/calls contextualised by workspace/project (Deferred D4)
- App mode — PWA installable (desktop + mobile), not web-only. Must feel like a native app. (Deferred D5)
- Public guest links — shareable URL (no signup required) where external collaborators (technicians, freelancers) can view their assigned performances/dates/rider. If they choose to sign up, their guest view upgrades to a full `guest` membership with write access. Two tiers: anonymous-read via signed link, authenticated-write via `guest` role. (Deferred D6)
- Fair intelligence — import attendee lists (CSV or screenshot via AI vision), cross-reference against existing contacts, surface matches and new-contact opportunities. Needs fair entity or date.kind='fair' with attendee junction. (Deferred D7, ADR-012)
- AI integration — invisible helper philosophy (ADR-013). Two interaction patterns: (1) continuous/invisible — AI fills fields like decision windows (ADR-019), (2) punctual/explicit — user clicks "generate dossier draft" (ADR-020). AI-touched fields get visual marker; high-stakes generation requires accept/dismiss (ADR-021). (Deferred D8)
- Kanban view — available in Desk and Contacts lenses as work-mode complement to calendar. Groups by status. (Deferred D9, ADR-010)
- Timeline view — horizontal/vertical timeline showing cascading task chains from protocol tasks. Depends on D3. (Deferred D10, ADR-010)
- `task` tag vocabulary (Deferred D1)
- UI de overrides granulares por persona (Deferred D2)
- `performance` / `line` / `invoice` flows (cuando Marco confirme la primera fecha)

## Dev setup

- **Package manager:** pnpm 10.33.0 (pinned via `packageManager` field in root `package.json`). Monorepo with `pnpm-workspace.yaml` listing `apps/*` + `packages/*`.
- **Wrangler:** local devDependency in `apps/web/package.json` (currently `^4.83.0`). NEVER instalado global. Invocar como `pnpm wrangler <cmd>` desde `apps/web` o vía scripts (`pnpm run deploy`).
- **Reglas portables:** `_methød/code/dev-environment.md` — léelas antes de añadir un nuevo dev tool al monorepo.
- **DDEV no aplica a Hour** (2026-06-04). DDEV containeriza nginx+PHP+MySQL — el stack de agencia WordPress, donde sustituye a Local by Flywheel. Hour es Node/Vite + Supabase Cloud + Cloudflare Workers: cero PHP, cero servidor local. Para entorno local reproducible/offline el camino canónico es el Supabase CLI (`supabase start`), no DDEV. Hoy ni se necesita: Supabase Cloud está vivo.

### Recovery (fresh machine / post-wipe)
El repo se clona limpio pero dos cosas son gitignored y se pierden — recrearlas en orden:

1. **Dependencias:** `pnpm install` desde la raíz (`~/Developer/hour`). Levanta los 3 workspace projects.
2. **`apps/web/.env`** (gitignored, perdido en cada recover). Recrear con las `PUBLIC_SUPABASE_*` desde `apps/web/wrangler.jsonc [vars]` — son public-safe (la anon key es la publishable `sb_publishable_...`). El único secreto real del `.env` es `SENTRY_AUTH_TOKEN` (opcional, solo para subir source-maps en `vite build`; el dev server no lo necesita — regenerable desde el dashboard de Sentry si hace falta deploy con source-maps).
3. **Arrancar:** `pnpm dev` → `http://localhost:5173`. Rutas con datos reales: `/h/muk-cia` (MaMeMi, 154 engagements) y `/h/demo` (Última órbita). La DB es Supabase Cloud, no hay que levantar nada local.

`pnpm install` con pnpm 10 ignora los build scripts de `workerd`/`esbuild`/`sharp`/`@sentry/cli` por defecto — fijados en `package.json` § `pnpm.onlyBuiltDependencies` para que `wrangler dev`/`deploy` funcionen sin intervención. `vite dev` funciona aunque no se construyan.

**Nunca `pnpm install` con `pnpm dev` vivo.** El install reconstruye los binarios de `esbuild`/`workerd` que vite tiene cargados en memoria → el dev server muere al siguiente request (síntoma: `ELIFECYCLE Command failed`, a veces tras un 404 cualquiera que parece la causa pero no lo es). Para instalar: para el dev, `pnpm install`, reinicia.
