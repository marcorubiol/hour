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
**Phase 0 — internal tool for MaMeMi** (Marco + Anouk + ≤5 users, 1 workspace `marco-rubiol`, 1 project `mamemi`). Build is multi-tenant-ready from day one so Phase 1 (SaaS with paying customers) can flip on without a rewrite.

**Phase 0.9 — private beta hardening gate**: mandatory before any external known client. Adds httpOnly sessions, rate limiting, RLS regression tests, restore drill, admin/support minimum, observability and health checks.

**Phase 1 — SaaS readiness/public launch**: self-serve onboarding/billing only if assisted beta validates demand.

## Key decisions (see `_decisions.md` for full log)
- Deploys at `hour.zerosense.studio` (subdomain, zero cost). Brand decision deferred to Phase 1.
- Stack: Supabase Cloud + Cloudflare Workers + R2 + pgmq + Resend + Sentry + **SvelteKit 2 + Svelte 5** + pnpm monorepo (ADR-026, 2026-05-01: migrated from Astro 5 + islands; reverts D-PRE-02).
- Phase 0 runs entirely within free tiers.
- Multi-tenant from day one: `workspace_id UUID NOT NULL`, RLS at DB level, JWT `current_workspace_id` claim. Workspace kind = `personal | team`.
- **Reset v2 + roadsheet delta** (ADR-001..007 + ADR-023, 2026-04-19/2026-05-01): 22 tables. Polymorphic core is `workspace + project + engagement + show + line + date` — no `project.type` column (ADR-007). Engagement (conversation) distinct from show (atomic gig, ADR-001). Money stack: `invoice + invoice_line + payment + expense` (ADR-003). Editable RBAC: `workspace_role` catalog + `project_membership.roles/grants/revokes` with a 10-permission closed vocabulary (ADR-006). `venue` is its own entity.
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
- **Palette (semi-firm, evolutionary)**: primary `oklch(0.50 0.14 335)` ≈ `#9D3F70` (plum, swapped 2026-05-01 — terracotta `#AB4235` was 5° from danger and read as error-adjacent on focus outline / btn--primary / selected chips). Light theme (D-PRE-01). Three colour categories: base hues (`primary`, `base`, `neutral`) + status (`info`, `success`, `warning`, `danger`) + contextual (`text-color`, `bg-*`). All shades via `color-mix()` in OKLCH. Provisional — re-evaluate when visual design phase begins.

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

## Status — 2026-05-09

Phase 0.0 con fundación visual + routing + **schema roadsheet** + **backup automatizado activado** cerrados. Quedan los bloques de infra runtime (real-time, PartyServer DO, PWA/offline, testing scaffold con test user) antes de Phase 0.1.

DB: **22 tablas** en producción tras `reset_v2_roadsheet` (commit `dbaf308`).

### Cerrado en sesión 2026-05-01
- **13/13 primitivos** en `apps/web/src/lib/components/`: Button, LinkButton, Input, Checkbox, Radio, Avatar, Badge, Chip, Select, Dialog, Toast, Tooltip, Menu, Sidebar (desktop static / mobile drawer). Showcase completo en `/playground`.
- **Plum trial** en `--primary` (`oklch(0.50 0.14 335)` ≈ #9D3F70) — terracotta `#AB4235` chocaba con `--danger` a 5°. Provisional, re-evaluar en visual design phase. Ver `_decisions.md` 2026-05-01.
- **URL architecture re-evaluada** (dossier `build/url-architecture-dossier-2026-05-01.md`). Cinco alternativas evaluadas; ADR-022 sigue (path-prefix `/h/[workspace]/[entity]/[slug]`) con tres ajustes operativos cerrados en addendum.
- **Routing scaffold Phase 0.0 día 5**:
  - `apps/web/src/lib/reserved-slugs.ts` — ~70 slugs reservados + helpers.
  - `apps/web/src/lib/url-state.ts` — `serializeViewState()` / `hydrateViewState()` base64url + 400 chars (D-PRE-05).
  - `apps/web/src/lib/stores/lens.svelte.ts` y `selection.svelte.ts` — class + factory + `setContext`/`getContext` (SSR-safe).
  - `apps/web/src/routes/h/+layout.svelte` — auth guard (JWT en localStorage, redirect login).
  - `apps/web/src/routes/h/[workspace]/+layout.svelte` — shell con Sidebar + lens nav + reserved-slug guard.
  - Placeholders `+page.svelte` en `/h/[workspace]/`, `/room/[slug]`, `/gig/[slug]`, `/engagement/[slug]`, `/person/[slug]`. `run/venue/asset/invoice` diferidos a su Phase.

### Pendiente Phase 0.0 (~15-22h restantes)
- ~~Schema `reset_v2_roadsheet`~~ **CERRADO 2026-05-01** (commit `dbaf308`)
- ~~Backup automatizado vía GitHub Actions~~ **CERRADO 2026-05-09** — workflow corriendo, primera corrida verde, ~150 KB en R2. Ver "Cerrado en sesión 2026-05-09" abajo.
- ~~Real-time wrapper + presence channel~~ **CERRADO 2026-05-09** (commit `58408eb`) — `$lib/realtime/{channels,client,presence.svelte,index}.ts` con `@supabase/realtime-js` standalone, cableado en `/h/[workspace]/+layout.svelte`. Presence reactive disponible vía `usePresence()`. Postgres changes diferido a Phase 0.2.
- PartyServer DO scaffold + `withYjs` + `collab_snapshot` persistence (5-8h) — `collab_snapshot` table ya en sitio
- PWA + Service Worker + IndexedDB + write-queue (10-14h)
- ~~Testing scaffold Vitest unit/component~~ **CERRADO 2026-05-09** (commit `8e312fe`) — dos proyectos (server/client), `@testing-library/svelte` + jsdom, 9 tests scaffold (reserved-slugs + Badge). Playwright e2e smoke también operativo.

**Orden sugerido próxima sesión:** GitHub Actions backup primero (perpendicular, cierra deuda, 1-2h). Después testing scaffold o real-time wrapper (cualquiera, son independientes).

### Cerrado en sesión 2026-05-01 (schema roadsheet)
- **`reset_v2_roadsheet`** aplicada (migración 20260501190000, commit `dbaf308`). Pasó por DB review independiente (10 SERIOUS items, todos arreglados pre-aplicación).
- Schema delta: `show` + 5 timeslots + 3 jsonb (logistics/hospitality/technical) + GIN + CHECK orden temporal NULL-safe; `venue.timezone` (D-PRE-10); slug system completo en 7 tablas (slug + `previous_slugs[]` + `slugify()` + `is_reserved_slug()` + `validate_slug()` trigger); 4 tablas nuevas: `crew_assignment`, `cast_override`, `asset_version`, `collab_snapshot` con RLS (`has_permission(project_id, 'edit:show')`), audit triggers, ws-immutability guards.
- Backfill de 154 personas + 154 engagements con id-suffix anti-colisión. Todos slugs únicos y bien formados. `person.slug` es **GLOBAL UNIQUE** (person no tiene workspace_id — anti-CRM "global, shared"). Ver `_decisions.md` 2026-05-01.
- Bug `slugify()` cazado en smoke (trim antes de truncar dejaba trailing dash en nombre catalán de 65+ chars). Fix: trim post-substring. Slug afectado reparado.
- `db-types.ts` regenerado (1903 líneas, las 4 tablas + 2 enums presentes).
- **Decisión técnica**: `build/schema.sql` y `build/rls-policies.sql` NO reescritos in-place — header con delta apuntando al archivo de migración como source of truth. Consolidación in-place queda como tarea diferida.
- **Post-apply DB review** (segundo agente independiente) confirmó los 10 SERIOUS pre-apply resueltos. Encontró 2 drifts LOW arreglados en `post_roadsheet_cleanup` (otra migración aplicada el mismo día): (1) DROP de los UNIQUE constraints `workspace_slug_key` + `project_workspace_id_slug_key` que del reset_v2_schema shadow-eaban los partial uniques nuevos (rompía rehidratación de slug post soft-delete); (2) hardening pattern aplicado a `slugify()` / `is_reserved_slug()` / `validate_slug()` (REVOKE PUBLIC/anon/service_role + GRANT authenticated; validate_slug sin grants — trigger-only). Ver `build/migrations/2026-05-01_post_roadsheet_cleanup.sql`.

### Cerrado en sesión 2026-05-01 (observability + security tightening)
- **Sentry full wiring** (`@sentry/sveltekit` 10.51, runtime Workers): `initCloudflareSentryHandle` + `sentryHandle()` en `hooks.server.ts`, `Sentry.init` + `replayIntegration` en `hooks.client.ts`, `experimental.instrumentation.server` + `experimental.tracing.server` en `svelte.config.js`. DSN baked at build time vía `$env/static/public`.
- **Same-origin tunnel** `/api/sentry-tunnel` que reenvía envelopes al ingest host (Firefox ETP/Brave Shields/uBlock bloquearían `*.ingest.sentry.io` directo). Auth vía query string desde el DSN. Verificado en prod.
- **Source maps upload** (`sentrySvelteKit` plugin Vite + `loadEnv`) — stack traces resuelven a `.ts`/`.svelte` original, no a `app.JS:1:NNNN`.
- **Smoke routes** `/dev/sentry-test` + `/api/sentry-test` (gated `?force=1` en prod). Verificación cliente + servidor end-to-end OK.
- **Smart Placement** (`placement.mode=smart` en `wrangler.jsonc`) — Worker co-loca con Supabase Frankfurt, ~3-4× menos round-trip Worker→PostgREST. Hyperdrive descartado: aplica a Postgres TCP, no a PostgREST HTTPS.
- **SECURITY DEFINER hardening** (Supabase): de las 12 funciones `SECURITY DEFINER` en `public`, helpers de RLS (8) mantienen `authenticated` y revocan `PUBLIC`+`anon`+`service_role`; trigger-only (4 — `handle_new_user`, `seed_system_roles_on_workspace`, `validate_project_membership_roles`, `write_audit`) revocan todo excepto `postgres`. Cierra el vector real (un cliente `authenticated` invocando `write_audit()` directamente para falsificar audit rows). Ver `architecture.md §14`.
- **Audit log triggers verificados live** en producción: 394 rows del bootstrap + 1 smoke UPDATE = pipeline funcional.
- **`worker-configuration.d.ts`** generado por `wrangler types` ahora gitignored (regenerable con `pnpm cf-typegen`).

### Cerrado en sesión 2026-05-02 (review pass — items 1-3 del backlog)
- **`+layout.ts` con `ssr = false`** en la rama `/h/`. La rama es app interna autenticada — SSR no aporta nada (no hay SEO, no hay anonymous render path) y desperdiciaba un round-trip server por request. Una línea. El guard funcional client-side de `+layout.svelte` ya estaba bien (no había flash de chrome porque el `{#if authChecked}` cerraba el render hasta hydrate). Ver `_decisions.md` 2026-05-02.
- **GitHub Actions backup workflow** `.github/workflows/backup.yml` — schedule semanal Sunday 03:00 UTC + `workflow_dispatch`. Dump triple (data, schema, roles) vía Supabase CLI → gzip → push a R2 `hour-backups/weekly/<UTC-stamp>/` vía AWS CLI S3-compatible. Retención 12 semanas con prune automático. Runbook completo en `build/runbooks/backup.md` con secretos requeridos (`SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`) + verificación + restore drill stub. **Pendiente para activar**: crear bucket R2 `hour-backups` + emitir token + setear los 4 secretos en GitHub.
- **Playwright smoke scaffold** instalado (`@playwright/test 1.59.1` devDep) + `playwright.config.ts` + `tests/smoke.spec.ts` (`login → /booking muestra "<n> contacts" + tbody con filas → sign out`). Scripts `pnpm test:install` (Chromium binary) + `pnpm test:smoke`. Test se auto-skipea si faltan `PW_TEST_EMAIL` + `PW_TEST_PASSWORD`. **Pendiente para activar**: crear user de test con `workspace_membership` en `hour-phase0` + setearlo en `.env.test` local.
- **Bug fix `+server.ts`** — los imports `Enum` / `Row` del módulo `$lib/db-types` estaban rotos (regresión post-regen de tipos: el archivo exporta `Enums` / `Tables`). `pnpm check` estaba en rojo ANTES de esta sesión (contradice lo que decía el contexto). Fix trivial, ahora `pnpm check` 0 errors / 0 warnings y `pnpm build` ✓.

### Cerrado en sesión 2026-05-09 (Realtime wrapper + presence)
- **`@supabase/realtime-js` standalone** (no traer todo `@supabase/supabase-js`) — mismo enfoque que `$lib/supabase.ts` con fetch raw, mantiene el bundle pequeño.
- **`$lib/realtime/`**: 4 archivos + 1 test:
  - `channels.ts` — naming helpers puros (`channelName.workspacePresence(id)` etc.), única fuente de verdad. Tipos template-literal.
  - `client.ts` — `createRealtimeClient(env, jwt)` factory + `provideRealtime`/`useRealtime` context. Decoder JWT base64url hand-rolled (~10 LoC) para extraer `sub` claim como presence key — sin pulling de jwt-decode (~1KB) por una operación trivial. Throws si JWT no tiene `sub`.
  - `presence.svelte.ts` — `PresenceStore` clase con `$state<PresenceState>` + `count` getter + `isOnline(uid)`. Subscribe a `workspace:{slug}:presence`, listens sync/join/leave, tracks self con `online_at` ISO timestamp en `SUBSCRIBED`. `dispose()` releases channel.
  - `index.ts` — public API.
  - `channels.test.ts` — 5 tests pinning el formato (server project).
- **Cableado** en `/h/[workspace]/+layout.svelte`: provides realtime + presence en `onMount` cuando JWT y `PUBLIC_SUPABASE_*` presentes; dispose en `onDestroy`. Failures degradan silenciosos (console.warn) — pages que necesiten realtime llaman `useRealtime()` y reciben error claro ahí.
- **Convención naming**: `useRealtime`/`usePresence` (mirroring `useLens` existente, no `getRealtime`/`getPresence`).
- **Lifecycle**: una conexión WebSocket por tab. Mismo socket multiplexa todos los channels (workspace presence ahora; project/show channels en Phase 0.2 cuando lleguen postgres_changes / collab triggers).
- **Verificado runtime 2026-05-09** (post-deploy, version `612495ae`): devtools → Network → WS muestra `phx_join` outbound a `realtime:workspace:marco-rubiol:presence`, `phx_reply ok`, `presence track` con `user_id` extraído del JWT (`fcdc82df-58df-...`), `presence_state` con la key correcta, heartbeats `phoenix` cada ~30s. URL construction (`http→ws`), auth con JWT, decoder `sub`, y lifecycle (mount → join → track → eventos) — los cuatro confirmados end-to-end.
- **Diferido**: `postgres_changes` (Phase 0.2 cuando haya un campo real al que suscribir), UI que renderiza presence (Phase 0.1+).

### Cerrado en sesión 2026-05-09 (Vitest scaffold)
- **Vitest 4.1.5** con dos `projects` (Vitest 4 renombró `workspace` → `projects`):
  - `server`: `*.test.ts` en `node` env para módulos puros.
  - `client`: `*.svelte.test.ts` en `jsdom` + `resolve.conditions: ['browser']` para forzar el entrypoint cliente de Svelte 5 (sin esto, `mount()` se importa del index-server.js y rompe con `lifecycle_function_unavailable`).
- **`@testing-library/svelte` 5.3.1** + `@testing-library/jest-dom` 6.9.1 + `jsdom` 29.1.1.
- **`vite.config.ts` migrado** de `defineConfig` (vite) a `defineConfig` (vitest/config). `loadEnv` se mantiene importado de `vite` (vitest no lo re-exporta). Plugin Sentry gateado con `!process.env.VITEST` para que el test runner no arrastre el upload de source maps.
- **2 tests de muestra** (no cobertura — pattern only): `src/lib/reserved-slugs.test.ts` (6 cases) + `src/lib/components/Badge.svelte.test.ts` (3 cases).
- **Setup file** `vitest-setup-client.ts` con `import '@testing-library/jest-dom/vitest'`. tsconfig `types` extendido con `@testing-library/jest-dom` para que `toBeInTheDocument` etc. type-checken.
- Scripts: `pnpm test:unit` (one-shot) + `pnpm test:unit:watch` (TDD).
- Verificado end-to-end: Vitest 9/9 verde en 920ms; `pnpm check` 0/0/0; `pnpm build` verde con Sentry source maps subiendo; Playwright smoke 1 passed.

### Cerrado en sesión 2026-05-09 (Playwright smoke activado)
- **Test user `playwright@hour.test`** creado en `hour-phase0` (auth.users + Auto-confirm) y atado a workspace `marco-rubiol` como `admin` con `accepted_at = now()` vía bloque `DO $$` idempotente. Procedimiento documentado en `build/runbooks/test-user-setup.md` (incluye SQL snippet, troubleshooting table, justificación de admin vs member).
- **`apps/web/.env.test`** local con `PW_TEST_EMAIL` + `PW_TEST_PASSWORD` (gitignored vía nueva entrada en `.gitignore` — el patrón existente `.env.*.local` no cubría `.env.test`).
- **Smoke verde end-to-end**: `pnpm build && pnpm test:smoke` → 1 passed en 7.9s. Cubre login → `/booking` muestra "<n> contacts" + tbody con filas → sign out. Detecta regresiones en login flow, JWT auth hook (inyección de `current_workspace_id`), RLS de `engagement` y client-side guard de `/h/`.
- Nota RBAC: el test user usa rol `admin` (no `member`) intencionalmente. `has_permission()` da bypass a workspace owner/admin para cualquier permiso, así que el smoke valida login + RLS sin acoplarse a detalles RBAC. RBAC regression suite es trabajo aparte (Phase 0.9 gate).

### Cerrado en sesión 2026-05-09 (backup activado)
- **Backup workflow restaurado y verde**. El commit `a65a982` del 2026-05-02 había eliminado `.github/workflows/backup.yml` por OAuth scope issue. Re-aplicado en commit nuevo tras `gh auth refresh -h github.com -s workflow`.
- **R2 prep**: bucket `hour-backups` creado en EU + R2 API token (Object Read & Write) emitido + 4 secretos GitHub provisionados (`SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`).
- **Primera corrida verde** (run `25594739063`, 1m11s): subió `data-2026-05-09T06-58-19Z.sql.gz` (137 KB), `schema-*.sql.gz` (14 KB), `roles-*.sql.gz` (208 B) a `s3://hour-backups/weekly/2026-05-09T06-58-19Z/`.
- **Tres gotchas resueltos en el camino** (anotados en `build/runbooks/backup.md` para futuros operadores):
  1. **OAuth scope** — el token gh CLI no tenía scope `workflow`. Push de archivos en `.github/workflows/` requería refresh con scope añadido. Sin esto: `403 refusing to allow an OAuth App to create or update workflow`.
  2. **Password URL-encoding** — la DB password original contenía un char especial (`@`/`/`/`#`/`?`/`:`) que rompió el parser de `net/url` con `invalid userinfo`. Fix: rotar a password alfanumérica (Opción A elegida) o percent-encodear.
  3. **IPv6 vs IPv4 + tenant routing** — la URL "Direct connection" (`db.<ref>.supabase.co`) resuelve solo IPv6 y los runners de GH Actions son IPv4-only (`Network is unreachable`). Fix: usar la URL del **Session Pooler** (`postgresql://postgres.<ref>:PASS@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`). User incluye `.<project_ref>` (sin él: `Tenant or user not found`); port 5432 (Session, no Transaction — Transaction rompe `pg_dump` por prepared statements). NO necesario el IPv4 add-on de pago.
- **Restore drill** sigue pendiente (gate Phase 0.9, no urgente). Runbook tiene el stub.

### Open debts (priority-ordered) — backlog para próximas sesiones
Lista honesta de lo que sé que falta, ordenada por ratio coste/riesgo. **Atacar de arriba abajo.**

1. **[ALTA Phase 0.9] Cookies httpOnly en lugar de JWT en localStorage** (4-6h). Hoy XSS = sesión exfiltrable. Phase 0 con 5 usuarios conocidos OK; antes de meter primer cliente externo (Phase 0.9 gate), mover a httpOnly+Secure+SameSite=Strict.
2. **[BAJA] Pasada cosmética de primitivos** (30 min, opcional). Avatar usa template literal para clases mientras Button/Chip usan `[...].filter(Boolean).join(' ')`. Menu línea 55 `open ? close() : openMenu()` mejor como `if/else`. Cosmético — no rompe nada.

**Phase 0.9 hardening backlog** (antes de cliente externo conocido):
- **Rate-limit `/api/sentry-tunnel`** vía Cloudflare KV (~30 min). CF WAF rate-limit es add-on de pago; KV en Worker free es suficiente.
- **RLS regression suite** — tests automatizados que validan políticas RLS contra escenarios de escape (usuarios sin workspace, cross-workspace leakage, permisos revocados).
- **Restore drill** — proced documentado y probado para restaurar desde backup R2 a Supabase staging en <30 min.
- **Admin/support minimum** — UI básica para listar workspaces, diagnosticar memberships, resetear slugs.
- **Structured logging** — formato JSON para logs Worker, correlación por request_id.
- **Health checks** — endpoints `/health/live` (dependencias OK) y `/health/ready` (servicio usable).
- **Sentry PII scrub** — revisar que no se envíe email/user_id a Sentry sin hash.

**Diferido a Phase 1 con coste asociado** (no acción hasta entonces):
- **Leaked Password Protection** (Supabase Pro feature). Toggle de 1 click cuando active el plan Pro al onboardar primer cliente pagante.
- **paraglide-js v2** para i18n (~2-3h). El `$lib/i18n.ts` simple actual cubre los ~15 strings de Phase 0. Migrar cuando llegue contenido en español o pase de 50 strings.
- **Sentry source-map auth token rotation policy** — el token actual (`sntryu_...`) en `apps/web/.env` no caduca. Revisar a Phase 1 si se quiere rotar.

## Status anterior — 2026-04-20

Infra, datos y **primera pantalla funcional**. Login + lista de engagements desplegados y operativos. Todo el trabajo está en `apps/web/`.

### DB (aplicada vía MCP)
- `hour-phase0` en eu-central-1 · Postgres 17 · **22 tablas** + `show_redacted` view · 19 helpers · 53 RLS policies (ENABLE + FORCE)
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
