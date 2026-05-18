# Sessions log — Hour

Historial detallado sesión-a-sesión, archivado desde `_context.md` el 2026-05-18 cuando ese archivo pasó los 40k chars y empezó a degradar performance del assistant.

Estado: **referencia histórica**. No actualizar entradas viejas. Para sesiones nuevas: si la sesión deja deuda activa o decisión cristalizada → `_context.md` (status actual) o `_decisions.md`; si es work-log puro → git log + commit messages bastan; si queda algo que conviene preservar fuera de git → entrada nueva aquí.

Convención: secciones por fecha descendente. Cada sesión queda con commits citados para que el detalle quepa siempre en `git show`.

---

## 2026-05-18 — ADR-032 account layer above workspace

Multi-tenant model pasa de 2 niveles (workspace + project) a 3 (account + workspace + project), preparado para abrir Hour a clientes externos próximos.

- **Decisión de modelo** (en conversación con Marco): híbrido Basecamp + Slack. Basecamp-like en facturación (account = entidad pagadora con suscripción única, contiene N workspaces dentro). Slack-like en identidad (un user atraviesa N accounts via workspace_memberships, sidebar muestra todos los workspaces simultáneamente — exactamente lo que el boceto pide). El Basecamp-strict "un user pertenece a UN account a la vez" rechazado: contradice el sidebar multi-house.
- **Casos cubiertos** sin forks: solo artist (1 account personal + 1 workspace), theatre collective (1 account team + 1+ workspaces), freelance distributor (1 personal + invitada a N workspaces de N clientes), manager (1 "Manager Inc" + N workspaces per artist), agency con N clientes (1 account + N workspaces, bulk billing).
- **DB migration `add_account_layer`** aplicada via Supabase MCP:
  - 2 enums nuevos: `account_kind` (personal | team), `account_role` (owner | admin).
  - Tabla `account` (slug + previous_slugs + name + kind + billing_email + country + timezone + settings + custom_fields + created/updated/deleted_at). set_updated_at + validate_slug triggers. Unique index global sobre slug WHERE deleted_at IS NULL. RLS FORCE.
  - Tabla `account_membership` (account_id, user_id, role, invited_at, accepted_at, revoked_at). Composite PK. Index por user_id. RLS FORCE.
  - `workspace.account_id uuid NOT NULL FK references account` añadida + backfill: 3 accounts iniciales (marco-rubiol-acc, mamemi-acc, playwright-acc). Marco owner de los dos primeros; playwright owner del tercero.
  - 4 RLS policies en `account` (select por membership aceptada; insert any authenticated; update solo owners; with check espejo).
  - 4 RLS policies en `account_membership` (select para propio user o admins; insert con bootstrap por self cuando account vacío; update para admins; delete solo owners).
  - **`handle_new_user` trigger actualizado**: nuevos signups crean account + account_membership ANTES del workspace personal y su workspace_membership. Slug del account es `{user-slug}-acc`. Tree completo desde día 1 para futuros usuarios.
  - Sin audit trigger en account/account_membership (write_audit espera workspace_id que account no tiene). Account-level audit espera admin UI (Phase 1).
- **Verificación**: 24 tablas + 74 RLS policies + 24 functions en producción. 3 accounts + 3 account_memberships. `pnpm check` 0/0/0, `pnpm build` verde, smoke pasa 1.8s. 154 engagements + project mamemi intactos.
- **Frontend tocado cero**: sidebar sigue mostrando workspaces como antes; account es invisible al user hasta Phase 1 admin UI. Solo `db-types.ts` regenerado (25 account refs + 2 account_membership refs).
- **Preparado para Phase 1 sin más cambios de schema**: añadir `account.stripe_customer_id` (1 columna) cuando llegue billing. Admin UI Settings → Account management (members, billing, list workspaces) viene encima del modelo.
- Migration SQL: `build/migrations/2026-05-18_add_account_layer.sql`. ADR-032 en `_decisions.md` con full rationale + alternatives considered (A: solo Stripe sin schema; B híbrido = elegido; C anémico solo billing).
- Commit `8721773`.

---

## 2026-05-18 — ADR-031 rename `line` → `section` + expand kind enum

El nivel intermedio entre Project y Show cambia de nombre y amplía el rango de kinds. Schema rename only; data untouched; código solo via auto-generated types.

- **Razón**: la palabra `line` era industry slang de touring (ADR-005 la definió literalmente como "tour, season, festival circuit, residency block"). El boceto que Marco compartió 2026-05-18 introdujo kinds que NO son touring: "Next creation (untitled)" (creation phase, sin shows), "Distribution 26/27" (campaign de difusión), "Communication & press" (campaign), "One-offs" (misc bucket). Forzar esos kinds dentro de `line` chirría conceptualmente. `section` es nombre neutro; la variedad vive en `section.kind`. Mismo pattern que `date.kind`.
- **Alternativas evaluadas y rechazadas**: Opción A (mantener `line`, solo expandir enum) — ahorra rename pero la palabra sigue chirriando los próximos años. Opción C (mantener schema `line`, solo cambiar UI label) — inconsistencia permanente schema-vs-UI. Marco eligió B (full rename).
- **DB migration `rename_line_to_section`** aplicada via Supabase MCP:
  - DROP de la view `show_redacted` (depende de `show.line_id`).
  - DROP de 10 RLS policies que referencian `line` directa o vía helper functions (3 de `line`, 4 de `asset_version`, 3 de `expense`).
  - DROP de 2 helper functions (`project_id_of_asset_version`, `project_id_of_expense`).
  - `ALTER TABLE line RENAME TO section`.
  - `ALTER TABLE ... RENAME COLUMN line_id TO section_id` en 3 tablas (asset_version, expense, show).
  - Rename de 3 FK constraints + 5 triggers en la tabla section.
  - `ALTER TYPE line_kind RENAME TO section_kind`, `line_status RENAME TO section_status`.
  - Recreación de helper functions con `p_section_id` y refs a `public.section`.
  - Recreación de 10 RLS policies con nombres y referencias actualizadas.
  - Recreación de la view `show_redacted` con `section_id`.
  - Separadamente (non-transactional): `ALTER TYPE section_kind ADD VALUE 'creation', 'campaign', 'comms', 'misc'`. Post-migration enum: tour, season, phase, circuit, residency, other, creation, campaign, comms, misc (10 valores).
- **Verificación**: 0 columnas `line_id`, 4 columnas `section_id` (3 tablas + 1 view). 10 enum values en section_kind. `pnpm check` 0/0/0, `pnpm build` verde, smoke pasa 2.3s.
- **Código aplicación**: cero edits manuales. `db-types.ts` regenerado vía Supabase MCP — 31 refs a section, 0 refs a line. No había componentes Phase 0.1 que referenciaran `line` aún (la UI de runs/sections no se había construido).
- Migration SQL: `build/migrations/2026-05-18_rename_line_to_section.sql`. ADR-031 en `_decisions.md`.
- Commit `acb8eb0`.

---

## 2026-05-18 — ADR-030 close naming gate (Plaza lens + project rename a Difusión 2026-27)

Cierre del naming gate adelantado a final de Phase 0.1 (decisión 2026-05-14). Dos cambios atómicos tras Marco previsualizar la UI viva con datos reales y cazar las confusiones en sí mismo (el naming gate funcionando como estaba diseñado).

- **Cambio 1 — Lens primaria renamed `Rooms` → `Plaza`**. Supersede parcialmente ADR-029. ADR-029 había renombrado "Desk" → "Rooms" (para evitar "Desk sin task entity = navegación vacía"), pero el sidebar ya lista las Rooms — "Rooms" lens + sidebar listing rooms = tautología visible. Plaza es el nombre canónico desde ADR-009 + ADR-022 ("composable UI model: Plaza + Desk + Views"); ADR-029 lo perdió por accidente. Restaurando "Plaza" como nombre de la lens primaria, el componente sidebar (Plaza.svelte) y la lens (Plaza) comparten nombre a propósito — misma idea conceptual desde dos ángulos.
- **Cambio 2 — Project mamemi display name "MaMeMi" → "Difusión 2026-27"** (slug intacto). Antes el sidebar mostraba "MaMeMi" tres veces (House MaMeMi + Room MaMeMi + display name del sidebar lower) — confusión real cazada por Marco. El project siempre fue catch-all de difusión, no un show concreto. "Difusión 2026-27" describe literalmente qué es ese bucket. Future Phase 0.5+ Marco puede crear projects más finos ("Ombra", "Nocturnes") al lado.
- **Mecánica aplicada**:
  - DB: `UPDATE project SET name='Difusión 2026-27' WHERE slug='mamemi'` via MCP. Slug + FKs intactas; audit trigger captura el cambio.
  - Código: `lens.svelte.ts` (type + default `'rooms'` → `'plaza'`), `+layout.svelte` (lensOptions[0] id + label, provideLens('plaza')), `smoke.spec.ts` (selector + variable rename).
- **Resultado UI**: pill activa dice "Plaza", sidebar muestra Room "Difusión 2026-27" en lugar de "MaMeMi", display name consistente entre sidebar Plaza + sidebar lower + Room detail title.
- **Re-evaluate when**: testing externo con Anouk / Electrico 28. Phase 0.4 ratification gate. Phase 0.5 si llega task entity (D3) — Desk podría reaparecer como lens secundaria con sentido propio.
- ADR-030 en `_decisions.md` con full rationale + alternatives considered.
- Commit `38f95cb`.

---

## 2026-05-18 — Phase 0.1 sprint principal (continuación post-shell)

**Cierre del bloque:** Room detail con datos productivos + presence híbrido B + cross-highlight + smoke verde. Próximo gate: checkpoint visual 1 + naming gate con Anouk antes de Phase 0.2.

### Trabajos cerrados
- **Pills del lens nav visualmente correctas** + manifest PWA servido en dev. Quité el wrapping `@layer components` del shell scoped CSS (interaction badly con HMR layer ordering) + radius literal `999px` en vez de `--radius-circle: 50vw` (más robusto cross-zoom). `VitePWA.devOptions.enabled` para que dev sirva el manifest. Commit `3d49d18`.
- **Status badges alineados con `/booking`** (variable-contract pattern, philosophy.md §3). Las siete variantes `badge--{status}` (contacted/in-conversation/hold/confirmed/declined/dormant/recurring) movidas a `base.css` como single source of truth — booking + RoomDetail (futuro Contacts lens) consumen las mismas. Drop del duplicado en booking. Commit `5c8ae24`.
- **Room detail real** (trabajo #4 — RelationshipStub). `/h/[workspace]/room/[slug]/+page.svelte` ahora renderiza header (eyebrow Room + display name + meta status/dates) + RelationshipStub + tres stubs dashed (Runs/Assets/Team) que nombran la phase de cada uno. RelationshipStub consume `/api/engagements?project_slug=...&status=any&limit=10`, renderiza count + lista resumida (person · org · location · status badge) + footer "View all N engagements →" hacia `/booking` (fallback hasta Phase 0.3 Contacts lens). Reactividad: `slugStore` writable + `derived` queryOptions para que `createQuery` re-fetche al navegar entre Rooms en la misma instancia de página. Commit `8ed85c7`.
- **Presence badge en topbar — modelo híbrido B** (decisión 2026-05-18 de Marco). `NetworkPresenceStore` nuevo en `$lib/realtime/network-presence.svelte.ts` que se suscribe a UN canal presence por cada workspace del que eres miembro y unifica los counts. Distinct users across all (no per-URL-workspace). PresenceBadge en topbar consume `networkPresence?.count`. El `PresenceStore` per-workspace existente se mantiene para futuras badges contextuales por Room / RoadSheet (Phase 0.2). `rt` y `presence` pasados a `$state` para que el badge re-renderice al asignarse post-onMount. Commits `ed065bf` (badge per-workspace inicial) + `fcb131a` (refactor a network).
- **Cross-highlight UP en Plaza** (trabajo #8). Cuando hay una Room seleccionada, su House padre también lleva `color: var(--primary)` vía nuevo modificador `.plaza__house-link--on-path`. Tres estados visibles: `active` (URL = House home), `on-path` (URL = Room de esa House), inactive (otra House). Plus **bug fix**: RoomStructure lee display name del TanStack cache `['rooms']` (mismo key que Plaza + Room detail) en vez de echo del slug — eliminada la inconsistencia "MaMeMi vs mamemi" entre sidebar lower y main header. Commit `edbdda2`.
- **Smoke test Playwright actualizado al flow post-ADR-029**. Cubre login → wait `/h/marco-rubiol/` (con o sin trailing slash, regex) → assert lens "Rooms" activa por class → click link `a[href="/h/mamemi/room/mamemi"]` → wait nueva URL → assert `.rel-stub__count` matches `/\d+\s+engagements?/` → assert items > 0 → sign out → `/login`. Verde en 2.8s (5.5s wall). Commit `0a2ae2e`.

### Visual debt detectada (input para checkpoint visual 1)
- Gap exagerado entre Room header (`Status: active`) y RelationshipStub.
- Plaza spacing entre Houses engaña — Marco Rubiol vacía parece tener contenido en blanco.
- Eyebrow "ROOM" aparece duplicado (sidebar lower header + main header).

---

## 2026-05-18 — ADR-029 shell user-scoped

- **DB migration `phase_0_1_multi_workspace_split` aplicada en producción**. Nueva workspace `mamemi` (kind=team), Marco owner + playwright admin. Project `mamemi` + 154 engagements movidos de `marco-rubiol` (kind=personal, ahora vacío) a `mamemi`. Triggers `guard_immutable_workspace_id` deshabilitados temporalmente para la migración y re-habilitados al cierre. Las RLS ya eran membership-based (`is_workspace_member`, `has_permission`) — multi-workspace queries funcionan sin refactor RLS adicional.
- **`apps/web/src/lib/stores/lens.svelte.ts`** — type `Lens` cambia `'desk'` → `'rooms'`. Default también.
- **`apps/web/src/lib/components/Plaza.svelte`** — refactor a multi-house tree. Cada House es header con checkbox placeholder + link al House home + lista indentada de Rooms. Active state per Room derivado de URL. Loading / error / empty / data states. CSS scoped, variable contracts para hover/active.
- **`apps/web/src/lib/components/RoomStructure.svelte`** — componente nuevo (sidebar lower). Visible solo cuando hay Room seleccionada en URL. Header con eyebrow "Room" + nombre + empty state "No runs yet". Sin Room seleccionada → prompt italic centrado "Select a Room to see its structure".
- **`apps/web/src/routes/h/[workspace]/+layout.svelte`** — refactor del shell:
  - Lens nav SE MUEVE del sidebar al top del main (pills horizontales, centradas, con "All" chip a la derecha como placeholder).
  - Sidebar children pasa de "lens buttons + Plaza" a "Plaza + RoomStructure".
  - Brand "Hour" en sidebar header con checkbox placeholder (multi-select primitiva).
  - Active state lens visualmente intenso (dark filled pill vs outlined neutral).
- **`apps/web/src/routes/h/[workspace]/+page.svelte`** — empty home Spotlight-style: "Hello, Marco." + "What would you like to work on?" centrado vertical en main. Reemplaza el placeholder ad-hoc con sus 4 links manuales.
- **No tocado deliberadamente**: endpoints `/api/houses` y `/api/rooms` siguen igual — la RLS membership-based ya devuelve multi-workspace sin cambios. `selection.svelte.ts` se mantiene (la URL es la SoT, el store es mirror). i18n (~7 strings) sin cambios — lens labels hardcoded por ahora.
- **DoD trade-offs explícitos** (heredados de Plaza inicial y aún válidos):
  - Multi-select real (chip bar D-PRE-05) → Phase 0.2.
  - IDB write-through con TanStack persister → Phase 0.2.
  - Endpoint `/api/runs` y `/api/gigs` → trabajo #6 Phase 0.1 (RoomStructure los consumirá cuando existan).
- **Verificación**: `pnpm check` 0/0/0, `pnpm build` verde, Vite hot reload activo. Pendiente browser test por Marco.

---

## 2026-05-18 — Phase 0.1 trabajo #1 (Plaza inicial, después extendido a multi-house en ADR-029)

- **`/api/houses`** y **`/api/rooms`** — SvelteKit `+server.ts` mirroring del pattern `/api/engagements` (Bearer JWT + Valibot + pgGet + JSON estructurado). RLS scopes visibility vía `is_workspace_member()` / `has_permission()` (membership-based, no claim-based). Tras ADR-029: `houses` retorna 2 rows para Marco (`marco-rubiol` + `mamemi`); `rooms` devuelve projects de TODAS las workspaces del user sin filtro `workspace_id` en query. Multi-house funciona out-of-the-box gracias a las RLS ya escritas membership-based.
- **`Plaza.svelte`** — sidebar upper. TanStack `createQuery` × 2 (memory cache; IDB write-through diferido a Phase 0.2 por trade-off con TanStack Query persister). Active room `$derived` del pathname (single source = URL). Native `<a>` navigation, no click handlers. Loading / empty / error states. Semantic HTML (`<nav><ul><li><a>`) per `_area-methød/code/philosophy.md`. Scoped CSS, variable contracts (`--plaza-room-color`, `--plaza-room-bg`) que el modificador `.plaza__room--active` redeclara.
- **`/h/[workspace]/+layout.svelte`** — `<Plaza />` inyectada en sidebar body bajo lens nav (ADR-009: lenses top, entities bottom). Nuevo `$effect` sincroniza `SelectionStore.entity` desde el pathname para que consumers no-routing (chip bar, ⌘K) no re-parseen la URL.
- **Validación**: `pnpm check` 0/0/0, `pnpm build` verde con Sentry source maps subiendo. Commits `a4cb015` (docs) + `6cd4413` (código). No pusheado a origin.
- **DoD trade-off explícito**: Phase 0.1 DoD línea 309 dice "Sin red: Plaza y Desk usan IndexedDB". Phase 0.0 closure parkeó IDB-backed TanStack persister a Phase 0.2+. Resolución 2026-05-14: declarar DoD parcial + deuda explícita en vez de escribir IDB write-through manual que el persister reemplazará. Memory cache only ahora.

---

## 2026-05-09 — Phase 0.0 CERRADA

Todos los items del backlog Phase 0.0 cerrados. Próximo: **Phase 0.1 — Plaza + Desk shell con datos productivos**. Ver `build/roadmap.md`.

- ~~Schema `reset_v2_roadsheet`~~ **CERRADO 2026-05-01** (commit `dbaf308`)
- ~~Backup automatizado vía GitHub Actions~~ **CERRADO 2026-05-09** — workflow corriendo, primera corrida verde, ~150 KB en R2.
- ~~Real-time wrapper + presence channel~~ **CERRADO 2026-05-09** (commit `58408eb`) — `$lib/realtime/{channels,client,presence.svelte,index}.ts`, cableado en `/h/[workspace]/+layout.svelte`.
- ~~PartyServer DO scaffold + `withYjs` + `collab_snapshot` persistence~~ **CERRADO 2026-05-09** (commit `8085949`) — Worker separado `apps/collab/` con `RoadsheetCollab` DO, hour-web bindea via `script_name`, ruta `/api/collab/[t]/[id]` autoriza + forwarda. End-to-end verificado en runtime con WebSocket real (5 capas).
- ~~PWA + Service Worker + IndexedDB + write-queue~~ **CERRADO 2026-05-09** (commits `99b9e0c`/`91afc76`/`fae60aa`/`53160e2`/`7f35580`) — vite-plugin-pwa generateSW, manifest + icon plum, IDB v1 con 2 stores (`read_cache` + `write_queue`), `/offline` prerenderizada como navigateFallback. End-to-end verificado: SW activated, manifest detectado, install button presente, IDB schema visible, offline reload sirve la página propia.
- ~~Testing scaffold Vitest unit/component~~ **CERRADO 2026-05-09** (commit `8e312fe`).

### Smoke e2e priorizado para Phase 0.2 (validado en revisión externa 2026-05-09)
7 checks que cierran el riesgo del DO sin polish:

1. **Auth OK** — user con membership conecta a `show:<id>` válido, recibe primer frame Yjs sync.
2. **Auth deny** — sin token / token inválido / sin membership: 401/403 antes de tocar el DO.
3. **Two-client sync** — A y B en `show:1`, A inserta texto, B converge al mismo state. CRDT real, no solo "WebSocket abierto".
4. **Target isolation** — A,B en `show:1`, C en `show:2`. Edits de A no llegan a C. Valida routing por `idFromName`.
5. **Snapshot version** — tras updates + threshold, fila en `collab_snapshot` con `target_table`/`target_id`/`workspace_id` correctos, `version = previous + 1`, snapshot no vacío.
6. **Reload restore** — cerrar sockets, esperar, reconectar fresh: contenido reaparece desde DB. Valida que no dependes solo de memoria del DO.
7. **No JWT logging** — review manual de Cloudflare logs / Sentry breadcrumbs / console / errors: nunca aparece JWT completo. Crítico porque va en query string del WS.

### Revisión técnica externa 2026-05-09
Otro agente IA hizo audit completo del repo (estructura, stack, RLS, offline, collab, security, tests). La review confirmó solidez general (7.5/10 para Phase 0 interna) y aportó dos shortlists valiosos: 6 escenarios RLS priorizados (en Open debts de `_context.md` Phase 0.9 backlog) + 7 checks smoke e2e collab (arriba). También cazó deuda real: `sendDefaultPii: true` en `hooks.client.ts:18` y `hooks.server.ts:26`.

**Retirado de la review:** afirmó que "person global contradice una memoria estratégica" como "biggest risk". La fuente era una memoria automática del agente (ID `7077df82-...`), no del repo canónico. La decisión `person` GLOBAL está reafirmada en ADR-001 + `_context.md` "Anti-CRM vocabulary" + `_decisions.md` 2026-05-01 ("person no tiene workspace_id"). El reviewer retiró el claim al pedirle fuente. **No requiere acción** — la decisión sigue firme.

---

## 2026-05-09 — PWA + offline scaffold (cierre Phase 0.0)

- **`vite-plugin-pwa` generateSW** mode + `idb` typed wrapper + `workbox-window` para registración cliente. `injectRegister: false` para tener guard manual contra `navigator.webdriver` (Playwright skip).
- **Manifest + icono**: `static/icon.svg` (plum H placeholder, swap en visual-design phase). `app.html` con links manuales: `<meta theme-color>`, `<link rel="icon">`, `<link rel="apple-touch-icon">`, `<link rel="manifest">` — vite-plugin-pwa NO auto-injecta con SvelteKit (su HTML pipeline está fuera del adapter).
- **`/offline` prerenderizada** (`src/routes/offline/+page.ts` con `export const prerender = true`) — sirve como `navigateFallback` cuando el SW no encuentra una ruta cacheada. Inyectada en el precache via `additionalManifestEntries` porque vite-plugin-pwa escanea `.svelte-kit/output/client/` antes de que adapter-cloudflare prerenderice los HTMLs en `.svelte-kit/cloudflare/` (gotcha sutil — pasa lo mismo con cualquier adapter que prerenderice post-Vite).
- **D-PRE-13 (silent updates)**: `registerType: 'prompt'` + workbox `skipWaiting: false` (default) + callbacks `onNeedRefresh`/`onOfflineReady` vacíos. Nuevo SW espera a que cierres todas las pestañas, activa en next open. Sin banners.
- **`navigateFallbackDenylist`** para `/api/*`, `/login`, `/dev/*`, `/sw.js` — esos siempre tienen que pegar a network. SW solo cachea estáticos + `/offline`.
- **`$lib/offline/`** módulo con surface API (no wiring):
  - `db.ts` — `idb` schema v1, dos stores (`read_cache` keyed by URL, `write_queue` autoIncrement). Helpers `cacheRead`/`getCachedRead`/`enqueueWrite`/`listQueuedWrites`/`dequeueWrite`/`bumpWriteRetries`. `prewarmDB()` para crear el schema en mount aunque no haya data (sino IDB nunca aparecía en DevTools). Versioning rule documentada en el upgrade callback.
  - `register.ts` — `registerServiceWorker()` idempotente, skip bajo SSR/no-SW/Playwright.
- **Cableado** en `src/routes/+layout.svelte` `onMount`: `registerServiceWorker()` + `prewarmDB()`.
- **Verificación end-to-end** runtime (post-deploy `91be0ad8`): SW activated ✓, Manifest detectado ✓, IDB con dos stores ✓, Install button ✓, Offline reload sirve `/offline` ✓.
- **Diferido Phase 0.2+**: write-queue replay logic, IDB-backed TanStack Query persisted cache, postgres_changes subscriptions sobre el cache.
- **Diferido Phase 0.5**: local-first real evaluation (ElectricSQL/Zero/Triplit), resumable upload `tus-js-client`, push notifications.

---

## 2026-05-09 — PartyServer DO scaffold

- **Worker separado `apps/collab/`** — adapter-cloudflare sobreescribe `_worker.js` cada build, así que no se puede co-hostear una clase DO en hour-web. Patrón canónico: declarar el DO en un Worker independiente (`hour-collab`) y bindear desde hour-web vía `script_name`.
- **`apps/collab/src/`**:
  - `roadsheet.ts` — `RoadsheetCollab extends withYjs(Server)` (y-partyserver mixin sobre partyserver). Override `onLoad` (seed Yjs document desde último snapshot) y `onSave` (encode + write nueva fila `collab_snapshot` cada 30 updates / 60s default). Cachea `workspace_id` y `version` en `this.ctx.storage` (SQLite-backed DO con `new_sqlite_classes`), survive hibernación.
  - `persistence.ts` — `fetchWorkspaceId` + `loadLatestSnapshot` + `saveSnapshot` vía new-model `SUPABASE_SECRET_KEY` (`sb_secret_...`, NO el legacy `service_role` JWT). bytea encodeado como hex `\x...` en JSON PostgREST.
  - `index.ts` — re-export `RoadsheetCollab` + stub fetch handler (404). `workers_dev: false` para que el único path sea via DO bindings desde hour-web.
- **`apps/collab/wrangler.jsonc`** — DO binding owner + migración `new_sqlite_classes: ["RoadsheetCollab"]`.
- **`apps/web/`**:
  - `wrangler.jsonc` — binding `ROADSHEET_COLLAB` con `script_name: "hour-collab"` (cross-Worker).
  - `src/lib/do/auth.ts` — `authorizeCollab(env, jwt, table, id)` resuelve workspace_id via JWT del usuario contra PostgREST. Empty result == not found OR not member; no leak.
  - `src/routes/api/collab/[target_table]/[target_id]/+server.ts` — GET-only, requiere upgrade WebSocket. Lee JWT de `?token=` (browsers no pueden setear Authorization en WS upgrade). Forward al DO via `env.ROADSHEET_COLLAB.idFromName(`${table}:${id}`).fetch(request)`.
- **Migración a new-model API keys** (Marco request "nada legacy"): `SUPABASE_SECRET_KEY` (formato `sb_secret_...`, no `eyJ...`), `PUBLIC_SUPABASE_ANON_KEY` ya estaba en formato `sb_publishable_...`. Audit confirmó cero referencias legacy en código.
- **Verificación runtime end-to-end** (deploy `0cde2248` hour-web + primer deploy hour-collab): WebSocket abre limpio (`✓ open`), Frame binario inbound (`<binary>`) — Yjs sync protocol activo, Cinco capas funcionando: SvelteKit upgrade → JWT validation → DO binding cross-Worker → partyserver upgrade → y-partyserver Yjs sync.
- **No verificado todavía** (fuera del scope scaffold; requiere Yjs updates reales): snapshot save trigger + snapshot reload roundtrip. La infra está toda en sitio; se prueba la primera vez que UI Phase 0.2 haga `Y.Text.insert()` y dispare `onSave`.

---

## 2026-05-09 — Realtime wrapper + presence

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
- **Verificado runtime 2026-05-09** (post-deploy, version `612495ae`): devtools → Network → WS muestra `phx_join` outbound, `phx_reply ok`, `presence track` con `user_id` extraído del JWT, `presence_state` con la key correcta, heartbeats `phoenix` cada ~30s. URL construction (`http→ws`), auth con JWT, decoder `sub`, y lifecycle (mount → join → track → eventos) — los cuatro confirmados end-to-end.
- **Diferido**: `postgres_changes` (Phase 0.2 cuando haya un campo real al que suscribir), UI que renderiza presence (Phase 0.1+).

---

## 2026-05-09 — Vitest scaffold

- **Vitest 4.1.5** con dos `projects` (Vitest 4 renombró `workspace` → `projects`):
  - `server`: `*.test.ts` en `node` env para módulos puros.
  - `client`: `*.svelte.test.ts` en `jsdom` + `resolve.conditions: ['browser']` para forzar el entrypoint cliente de Svelte 5 (sin esto, `mount()` se importa del index-server.js y rompe con `lifecycle_function_unavailable`).
- **`@testing-library/svelte` 5.3.1** + `@testing-library/jest-dom` 6.9.1 + `jsdom` 29.1.1.
- **`vite.config.ts` migrado** de `defineConfig` (vite) a `defineConfig` (vitest/config). `loadEnv` se mantiene importado de `vite` (vitest no lo re-exporta). Plugin Sentry gateado con `!process.env.VITEST` para que el test runner no arrastre el upload de source maps.
- **2 tests de muestra** (no cobertura — pattern only): `src/lib/reserved-slugs.test.ts` (6 cases) + `src/lib/components/Badge.svelte.test.ts` (3 cases).
- **Setup file** `vitest-setup-client.ts` con `import '@testing-library/jest-dom/vitest'`. tsconfig `types` extendido con `@testing-library/jest-dom`.
- Scripts: `pnpm test:unit` (one-shot) + `pnpm test:unit:watch` (TDD).
- Verificado end-to-end: Vitest 9/9 verde en 920ms; `pnpm check` 0/0/0; `pnpm build` verde con Sentry source maps subiendo; Playwright smoke 1 passed.

---

## 2026-05-09 — Playwright smoke activado

- **Test user `playwright@hour.test`** creado en `hour-phase0` (auth.users + Auto-confirm) y atado a workspace `marco-rubiol` como `admin` con `accepted_at = now()` vía bloque `DO $$` idempotente. Procedimiento documentado en `build/runbooks/test-user-setup.md` (incluye SQL snippet, troubleshooting table, justificación de admin vs member).
- **`apps/web/.env.test`** local con `PW_TEST_EMAIL` + `PW_TEST_PASSWORD` (gitignored vía nueva entrada en `.gitignore` — el patrón existente `.env.*.local` no cubría `.env.test`).
- **Smoke verde end-to-end**: `pnpm build && pnpm test:smoke` → 1 passed en 7.9s. Cubre login → `/booking` muestra "<n> contacts" + tbody con filas → sign out. Detecta regresiones en login flow, JWT auth hook (inyección de `current_workspace_id`), RLS de `engagement` y client-side guard de `/h/`.
- Nota RBAC: el test user usa rol `admin` (no `member`) intencionalmente. `has_permission()` da bypass a workspace owner/admin para cualquier permiso, así que el smoke valida login + RLS sin acoplarse a detalles RBAC. RBAC regression suite es trabajo aparte (Phase 0.9 gate).

---

## 2026-05-09 — Backup activado

- **Backup workflow restaurado y verde**. El commit `a65a982` del 2026-05-02 había eliminado `.github/workflows/backup.yml` por OAuth scope issue. Re-aplicado en commit nuevo tras `gh auth refresh -h github.com -s workflow`.
- **R2 prep**: bucket `hour-backups` creado en EU + R2 API token (Object Read & Write) emitido + 4 secretos GitHub provisionados (`SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`).
- **Primera corrida verde** (run `25594739063`, 1m11s): subió `data-2026-05-09T06-58-19Z.sql.gz` (137 KB), `schema-*.sql.gz` (14 KB), `roles-*.sql.gz` (208 B) a `s3://hour-backups/weekly/2026-05-09T06-58-19Z/`.
- **Tres gotchas resueltos en el camino** (anotados en `build/runbooks/backup.md` para futuros operadores):
  1. **OAuth scope** — el token gh CLI no tenía scope `workflow`. Push de archivos en `.github/workflows/` requería refresh con scope añadido. Sin esto: `403 refusing to allow an OAuth App to create or update workflow`.
  2. **Password URL-encoding** — la DB password original contenía un char especial (`@`/`/`/`#`/`?`/`:`) que rompió el parser de `net/url` con `invalid userinfo`. Fix: rotar a password alfanumérica (Opción A elegida) o percent-encodear.
  3. **IPv6 vs IPv4 + tenant routing** — la URL "Direct connection" (`db.<ref>.supabase.co`) resuelve solo IPv6 y los runners de GH Actions son IPv4-only (`Network is unreachable`). Fix: usar la URL del **Session Pooler** (`postgresql://postgres.<ref>:PASS@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`). User incluye `.<project_ref>` (sin él: `Tenant or user not found`); port 5432 (Session, no Transaction — Transaction rompe `pg_dump` por prepared statements). NO necesario el IPv4 add-on de pago.
- **Restore drill** sigue pendiente (gate Phase 0.9, no urgente). Runbook tiene el stub.

---

## 2026-05-02 — Review pass (items 1-3 del backlog)

- **`+layout.ts` con `ssr = false`** en la rama `/h/`. La rama es app interna autenticada — SSR no aporta nada (no hay SEO, no hay anonymous render path) y desperdiciaba un round-trip server por request. Una línea. El guard funcional client-side de `+layout.svelte` ya estaba bien (no había flash de chrome porque el `{#if authChecked}` cerraba el render hasta hydrate). Ver `_decisions.md` 2026-05-02.
- **GitHub Actions backup workflow** `.github/workflows/backup.yml` — schedule semanal Sunday 03:00 UTC + `workflow_dispatch`. Dump triple (data, schema, roles) vía Supabase CLI → gzip → push a R2 `hour-backups/weekly/<UTC-stamp>/` vía AWS CLI S3-compatible. Retención 12 semanas con prune automático. Runbook completo en `build/runbooks/backup.md`.
- **Playwright smoke scaffold** instalado (`@playwright/test 1.59.1` devDep) + `playwright.config.ts` + `tests/smoke.spec.ts`. Scripts `pnpm test:install` (Chromium binary) + `pnpm test:smoke`. Test se auto-skipea si faltan `PW_TEST_EMAIL` + `PW_TEST_PASSWORD`.
- **Bug fix `+server.ts`** — los imports `Enum` / `Row` del módulo `$lib/db-types` estaban rotos (regresión post-regen de tipos: el archivo exporta `Enums` / `Tables`). Fix trivial, ahora `pnpm check` 0 errors / 0 warnings y `pnpm build` ✓.

---

## 2026-05-01 — Schema roadsheet (`reset_v2_roadsheet`)

- **`reset_v2_roadsheet`** aplicada (migración 20260501190000, commit `dbaf308`). Pasó por DB review independiente (10 SERIOUS items, todos arreglados pre-aplicación).
- Schema delta: `show` + 5 timeslots + 3 jsonb (logistics/hospitality/technical) + GIN + CHECK orden temporal NULL-safe; `venue.timezone` (D-PRE-10); slug system completo en 7 tablas (slug + `previous_slugs[]` + `slugify()` + `is_reserved_slug()` + `validate_slug()` trigger); 4 tablas nuevas: `crew_assignment`, `cast_override`, `asset_version`, `collab_snapshot` con RLS (`has_permission(project_id, 'edit:show')`), audit triggers, ws-immutability guards.
- Backfill de 154 personas + 154 engagements con id-suffix anti-colisión. Todos slugs únicos y bien formados. `person.slug` es **GLOBAL UNIQUE** (person no tiene workspace_id — anti-CRM "global, shared"). Ver `_decisions.md` 2026-05-01.
- Bug `slugify()` cazado en smoke (trim antes de truncar dejaba trailing dash en nombre catalán de 65+ chars). Fix: trim post-substring. Slug afectado reparado.
- `db-types.ts` regenerado (1903 líneas, las 4 tablas + 2 enums presentes).
- **Decisión técnica**: `build/schema.sql` y `build/rls-policies.sql` NO reescritos in-place — header con delta apuntando al archivo de migración como source of truth. Consolidación in-place queda como tarea diferida.
- **Post-apply DB review** (segundo agente independiente) confirmó los 10 SERIOUS pre-apply resueltos. Encontró 2 drifts LOW arreglados en `post_roadsheet_cleanup` (otra migración aplicada el mismo día): (1) DROP de los UNIQUE constraints `workspace_slug_key` + `project_workspace_id_slug_key` que del reset_v2_schema shadow-eaban los partial uniques nuevos (rompía rehidratación de slug post soft-delete); (2) hardening pattern aplicado a `slugify()` / `is_reserved_slug()` / `validate_slug()` (REVOKE PUBLIC/anon/service_role + GRANT authenticated; validate_slug sin grants — trigger-only). Ver `build/migrations/2026-05-01_post_roadsheet_cleanup.sql`.

---

## 2026-05-01 — Observability + security tightening

- **Sentry full wiring** (`@sentry/sveltekit` 10.51, runtime Workers): `initCloudflareSentryHandle` + `sentryHandle()` en `hooks.server.ts`, `Sentry.init` + `replayIntegration` en `hooks.client.ts`, `experimental.instrumentation.server` + `experimental.tracing.server` en `svelte.config.js`. DSN baked at build time vía `$env/static/public`.
- **Same-origin tunnel** `/api/sentry-tunnel` que reenvía envelopes al ingest host (Firefox ETP/Brave Shields/uBlock bloquearían `*.ingest.sentry.io` directo). Auth vía query string desde el DSN. Verificado en prod.
- **Source maps upload** (`sentrySvelteKit` plugin Vite + `loadEnv`) — stack traces resuelven a `.ts`/`.svelte` original, no a `app.JS:1:NNNN`.
- **Smoke routes** `/dev/sentry-test` + `/api/sentry-test` (gated `?force=1` en prod). Verificación cliente + servidor end-to-end OK.
- **Smart Placement** (`placement.mode=smart` en `wrangler.jsonc`) — Worker co-loca con Supabase Frankfurt, ~3-4× menos round-trip Worker→PostgREST. Hyperdrive descartado: aplica a Postgres TCP, no a PostgREST HTTPS.
- **SECURITY DEFINER hardening** (Supabase): de las 12 funciones `SECURITY DEFINER` en `public`, helpers de RLS (8) mantienen `authenticated` y revocan `PUBLIC`+`anon`+`service_role`; trigger-only (4 — `handle_new_user`, `seed_system_roles_on_workspace`, `validate_project_membership_roles`, `write_audit`) revocan todo excepto `postgres`. Cierra el vector real (un cliente `authenticated` invocando `write_audit()` directamente para falsificar audit rows). Ver `architecture.md §14`.
- **Audit log triggers verificados live** en producción: 394 rows del bootstrap + 1 smoke UPDATE = pipeline funcional.
- **`worker-configuration.d.ts`** generado por `wrangler types` ahora gitignored (regenerable con `pnpm cf-typegen`).

---

## 2026-05-01 — Primitivos + plum trial + routing scaffold (cierre Phase 0.0 día 5)

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

---

## 2026-04-20 — Infra + datos + primera pantalla funcional

Login + lista de engagements desplegados y operativos. Todo el trabajo está en `apps/web/`.

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

### Smoke tests cerrados
- Hook inyecta `current_workspace_id` correctamente (probado con MCP `execute_sql` simulando claims)
- Marco como `authenticated` ve 154 engagements; sin membership: 0 leaks
- `has_permission` owner bypass verificado
- Endpoint en prod devuelve 401 correcto sin JWT
- **End-to-end con JWT real**: login funcional, datos cargando en `/difusion` — verificado en producción
