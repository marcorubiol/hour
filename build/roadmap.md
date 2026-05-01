# Hour — Roadmap de implementación

> Documento vivo. Se actualiza al cerrar cada fase. Ordenado por dependencias reales, no por deseo.
> Última actualización: 2026-05-01 (ADR-026: migración Astro → SvelteKit; Día 10 reescrito a `y-partyserver` + DO nativo; Phase 0.1 incorpora TanStack Query como server-state cache).

## 🎯 Qué toca hoy (punto de entrada)

**Si estás arrancando Phase 0** → ir a "[Próximo sprint concreto](#próximo-sprint-concreto-13-días-en-chunks-estimación-honesta)" y empezar por **Día 1 — Tokens + base**.

**Si estás a mitad de Phase 0.0** → el último checkbox marcado en "Definition of done" de Phase 0.0 indica dónde quedamos. Si no hay checkboxes marcados, mirar el último día listado en el sprint concreto que tenga commits en `03_AGENCY/Hour/apps/web/`.

**Si has terminado Phase 0.0** → abrir `## Phase 0.1 — Plaza + Desk shell` y empezar por trabajo #1 (`<Plaza>` component).

**Si has terminado cualquier otra fase** → siguiente fase en el índice abajo. Cada fase tiene su propia sección con goal, prerequisito, trabajo y DoD.

**Si vuelves después de una pausa >1 semana** → releer `## Estado actual` + `## Deuda reconocida` antes de continuar. Sesenta segundos que evitan medio día de desorientación.

Antes de cualquier trabajo: leer primero el [`context.md`](../context.md) del proyecto y [`_methød/`](/_methød/) relevante (CSS, design, wordpress si aplicara).

## Estado actual (honesto)

### Construido y funcional
- **Infra**: Cloudflare Worker `hour-web` + Supabase `hour-phase0` + R2 bucket `hour-media`. Auth hook + JWT con `current_workspace_id`.
- **Schema (reset v2)**: 18 tablas, 53 RLS policies, `has_permission()` helper, 15 system roles seedeados.
- **Datos reales**: 154 persons + 154 engagements del circuito de difusión 2026-27, 30 con dossier.
- **UI mínima**: `/login` (email+password) + `/difusion` (lista paginada). Astro 5 + JS vanilla inline.

### Decidido firme (25 ADRs + 14 D-PRE todas cerradas)
Data layer: ADR-001 a 007. UI: ADR-008 a 010, 013-018, 022. Road sheet + collab: ADR-019 a 021, 023, 025. URLs + slugs: ADR-022, 024. 14 D-PRE cerradas 2026-04-24 detalladas abajo.

### Decidido pero NO construido (la masa)
- Toda la capa UI a partir de ADR-008.
- ADR-009 (shell Plaza/Desk/Views) sin scaffold.
- ADR-022 URLs + ADR-024 slug system — router y schema pendientes de Phase 0.0.
- ADR-023 road sheet + ADR-025 CRDT transport — migración y DO scaffold pendientes de Phase 0.0.
- Migración `reset_v2_roadsheet.sql` pendiente — incluye: ADR-023 (timeslots + jsonb + junctions), audit_log + trigger, venue.timezone, slug system (ADR-024), collab_snapshot (ADR-025).
- ADR-014 light primary vs scaffold actual DARK — fix en Phase 0.0.

### Gaps implícitos descubiertos
Design tokens, CSS architecture, component primitives, router, error boundaries, loading/empty/error states, form validation, i18n scaffold (D-PRE-03), toast layer, keyboard shortcuts, accessibility baseline, logging/observability, app-layer RBAC check, offline/PWA infrastructure, real-time sync, audit log, dual-timezone handling, **testing framework**, **backup strategy**.

---

## Principios de fasing

1. **Fundación antes de visual.** No tocar UI real hasta que tokens + primitivos + offline shell existan.
2. **Mobile-first para subset crítico desde la fase que lo introduce**: primitivos responsive en 0.0; Gig detail en 0.1; Road sheet en 0.2; Contacts en 0.3. Resto (Plaza, Desk, Calendar, Money) desktop-first + polish mobile en Phase 0.4.
3. **Local-first como norte.** Phase 0 usa smart-offline; Phase 0.5 evalúa local-first real.
4. **Multiusuario desde Phase 0.2.** Supabase Realtime para campos estructurados + `y-partykit` sobre Cloudflare Durable Objects para texto libre (ADR-025).
5. **Pasos pequeños y sólidos.** Cada fase termina demo-able.
6. **Pause points cada 3-4 días.** Si paro, lo que queda es coherente.
7. **Testing desde el principio.** Vitest + Playwright configurados en 0.0; tests reales desde 0.2.
8. **Deuda técnica explícita.** Si se toma shortcut, va a sección "Deuda".

---

## Decisiones previas obligatorias (14 D-PRE)

### D-PRE-01 — Tema light mode ✓ CERRADA
Respetar ADR-014. Migrar scaffold a tokens semánticos light en Phase 0.0.

### D-PRE-02 — Router: Astro file-routing + Svelte islands ✓ CERRADA
No migrar a SvelteKit. Razones (en orden):
1. Ya estás en Astro; migrar es tirar config y reescribir.
2. Astro file-routing cubre `/h/[workspace]/[entity]/[slug]` nativamente.
3. Islands hidratan solo donde hay interacción; páginas ligeras.
4. CF Worker deploy ya funciona con Astro adapter.
5. Multiusuario colaborativo no requiere SvelteKit — se resuelve con stores dentro de islands + Realtime + CRDT.

Caveat: si eventualmente necesitamos canvas colaborativo visual tipo Figma, islands se queda corto; edición de formularios cabe perfecta.

### D-PRE-03 — i18n scaffold en Phase 0.0, content inglés hasta Phase 1 ✓ CERRADA
`@astrojs/i18n` configurado en 0.0 con locales `en` y `es`. Todas las strings envueltas en `t()`. `es.json` vacío hasta 0.5 o Phase 1.

### D-PRE-04 — AI bypass RBAC como workspace-owner-level ✓ CERRADA
AI enrichment opera como asistente del workspace owner, no user-level. `ai_suggested boolean` + `enriched_by_model text` en campos afectados. Revisitar Phase 1 con multi-user real.

### D-PRE-05 — Copy Link global con truncación a 400 chars ✓ CERRADA
`serializeViewState()` captura `{scope, lens, filters, sort}`. Truncar chip bar a 3 primeros + avisar si supera 400. Master View = mismo mecanismo en localStorage.

### D-PRE-06 — Supabase Realtime como canal firme ✓ CERRADA
Activar en 0.0. Canales: `show:{show_id}`, `project:{project_id}`, `workspace:{workspace_id}:presence`. Svelte stores dentro de islands se suscriben al montarse, unsubscribe al desmontarse.

### D-PRE-07 — CRDT path: y-partykit sobre Cloudflare Durable Objects ✓ CERRADA (ver ADR-025)
- **Decisión**: `y-partykit` + Durable Object por road sheet + `y-indexeddb` cliente + auth gate con Supabase JWT.
- **Razón**: `y-supabase` está abandonado (último push 2023, issue sin responder). PartyKit fue adquirido por Cloudflare en 2024 y corre en Durable Objects — mismo runtime que Hour ya usa. Escalable a ≤5 users × 100 docs/año sin friccionar.
- **Scope CRDT**: solo campos texto-libre (`show.notes`, `project.notes`, jsonb text marcados como colaborativos). Resto usa Realtime con last-write-wins.
- **Esfuerzo**: ~5-8h Phase 0.0 (DO scaffold + auth + persistence schema) + ~8-12h Phase 0.2 (primer campo colaborativo live).

### D-PRE-08 — Smart offline (Phase 0), local-first real evaluado en 0.5 ✓ CERRADA
- **Phase 0**: PWA con Service Worker + IndexedDB para datos leídos + write queue + Yjs + `y-indexeddb` para texto.
- **Phase 0.5**: evaluación de ElectricSQL / Zero / Triplit.
- **Descartado**: Bluetooth / WiFi-direct (APIs no existen en PWA; requiere nativo).

### D-PRE-09 — Resumable upload desde Phase 0.5 ✓ CERRADA
`tus-js-client` + R2 multipart. Componentes asset read-only en Phase 0; upload en 0.5.

### D-PRE-10 — Dual-timezone display siempre ✓ CERRADA
Todos los `timestamptz` se muestran en dos zonas: local usuario + local venue. Añadir `venue.timezone text` en `reset_v2_roadsheet.sql`.

### D-PRE-11 — Venue NO edita en Phase 0, RBAC preparada para futuro ✓ CERRADA
RBAC ya soporta guest-write (ADR-006). UI Phase 0: venue solo lee (signed link) + envía archivos vía `asset_version(direction='inbound')`. Edición venue = feature Phase 1+ con formulario tokenizado.

### D-PRE-12 — Audit log desde Phase 0.0 ✓ CERRADA
Tabla `audit_log(id, workspace_id, actor_id, action enum, target_table, target_id, before jsonb, after jsonb, created_at)`. Trigger aplicado a **13 tablas**:
`show`, `project`, `engagement`, `person`, `venue`, `invoice`, `payment`, `expense`, `asset_version`, `crew_assignment`, `cast_override`, `workspace_role`, `project_membership`.

Excluye: `audit_log` (evitar recursión), `workspace`/`workspace_membership` (se auditan cambios vía triggers específicos), `date` (calendario puro), seeds.

Lista ajustable si emerge necesidad. UI de lectura: Phase 0.5.

### D-PRE-13 — Service Worker update style Windsurf/Chrome ✓ CERRADA
Nuevas versiones se descargan en background (silencioso), se instalan en el próximo restart de la app (cuando el usuario cierra todas las pestañas y vuelve). Sin banners intrusivos. Sin modales. Mecanismo: Workbox con `registerSW({ immediate: false })` + `skipWaiting` solo al cerrar tab.

### D-PRE-14 — Slug naming: clean names + hard reject + redirect table ✓ CERRADA (ver ADR-024)
- **Decisión**: hard reject al crear con modal sugerente; `previous_slugs text[]` para redirects al renombrar (12 meses mínimo); `id uuid` inmutable separado del slug; uniqueness scope `(workspace_id, entity_type)`.
- **Razón**: investigación agentil de 10 SaaS grandes (GitHub, Linear, Notion, Vercel, Supabase, Figma, Cal.com, Slack, Discord, Airtable) — **nadie usa sufijos numéricos automáticos como default UX**. Marco quería URLs limpias; la industria lo valida.
- **Migration**: añadir `slug text NOT NULL` + `previous_slugs text[] DEFAULT '{}'` + partial unique index por `(workspace_id, entity_type, slug)` a: `workspace`, `project`, `line`, `show`, `engagement`, `person`, `venue`, `asset_version`.
- **Rechazado**: sufijo numérico (fea URL compartida), opaque-ID-only (sacrifica readability), hybrid slug+ID-tail (fallback si alguna vez hace falta).

---

## Phase 0.0 — Fundación (~55-70h focused, ~13 días calendario en chunks)

Estimación honesta. Subió de 30-35h inicial a 45-55h tras pasada crítica + ahora a 55-70h al incluir PartyKit DO scaffold (5-8h) y slug system en el schema (1-2h).

### Goal
Sistema de diseño + primitivos responsive + router + scaffold limpio + offline shell + real-time infra + PartyKit collab infra + i18n wiring + testing scaffold + backup. Cuando esto termina, trabajar con coherencia, multiusuario, offline-capable, colaborativo-capable y con tests desde el primer PR.

### Prerequisito
Las 14 D-PRE cerradas ✓ (07 y 14 cerradas 2026-04-24 con research — ver ADR-025 y ADR-024).

### Trabajo

**Capa visual (8-10h)**
1. `src/styles/tokens.css` — two-tier (primitives + semantics), OKLCH, spacing M×1.5, typography con `clamp()`.
2. `src/styles/base.css` — cascade layers `reset, defaults, tokens, layouts, components, utilities, overrides`.
3. Corregir scaffold: `/login` y `/booking` a tokens light primary.

**Primitivos Svelte con estados completos (12-18h)**
4. 13 primitivos en `src/components/` con variantes (default/hover/focus/disabled/error) y responsive inline:
   Button, Input, Chip, Checkbox, Radio, Avatar, Badge, Select, Dialog, Toast, Sidebar (colapsable mobile), Tooltip, Menu.
5. Página `/playground` (dev only) con los 13 en viewports 320px / 768px / 1440px.

**Router + estado (4-5h)** — *actualizado 2026-05-01: post-ADR-026 ya estamos en SvelteKit, así que rutas viven en `src/routes/h/[workspace]/[entity]/[slug]/+page.svelte` (no `src/pages/...astro`); estado compartido en módulos `.svelte.ts` con runes module-level (`let lens = $state(...)` exportado), no nanostores — patrón nativo de Svelte 5 sin dependencia extra.*
6. Estructura `src/routes/h/[workspace]/[entity]/[slug]/+page.svelte` (+ `+layout.svelte` con shell común). **Pendiente**: validar con un dossier dedicado si el shape `/h/[workspace]/[entity]/[slug]` es el óptimo o procede revisar ADR-022 antes de escribir el scaffold.
7. `serializeViewState()` + `hydrateViewState()` en `$lib/url-state.ts` (D-PRE-05, truncación 400 chars).
8. Stores compartidas como `.svelte.ts` con runes module-level: `lens.svelte.ts`, `selection.svelte.ts`, `chipBar.svelte.ts`, `presence.svelte.ts`. Cada uno exporta su `$state`/`$derived` y los helpers para mutarlo.

**Offline + PWA (10-14h)**
9. `@vite-pwa/astro` + `manifest.webmanifest` + Service Worker con Workbox.
10. Update strategy D-PRE-13: background download, install on next restart, sin banners.
11. `src/lib/local-db.ts` — IndexedDB wrapper con tablas espejo de Postgres.
12. `src/lib/write-queue.ts` — mutations offline → IndexedDB → replay al reconectar + conflict UI con diff.
13. Caching strategy: road sheets próximos 10 días + shell + assets estáticos.

**Real-time (4-5h)**
14. Supabase Realtime activado + wrapper `src/lib/realtime.ts`.
15. Presence channel global `workspace:{id}:presence`.

**Schema (3-4h)**
16. Migración `reset_v2_roadsheet.sql`:
    - `show` + 5 timeslots + 3 jsonb (logistics, hospitality, technical).
    - `crew_assignment`, `cast_override`, `asset_version` (con `direction`).
    - `audit_log` + `audit_trigger` aplicado a 13 tablas.
    - `venue.timezone text` (D-PRE-10).
    - **Slug system (ADR-024)**: `slug text NOT NULL` + `previous_slugs text[] DEFAULT '{}'` en 8 tablas (`workspace`, `project`, `line`, `show`, `engagement`, `person`, `venue`, `asset_version`). Partial unique index por `(workspace_id, entity_type, slug)`. Función `slug_generator(name)` + trigger de validación.
    - **PartyKit persistence (ADR-025)**: tabla `collab_snapshot(id, target_table, target_id, snapshot bytea, version int, created_at)` para persistir snapshots Yjs desde el Durable Object.

**PartyServer / Durable Object scaffold (5-8h)** — *actualizado 2026-05-01: PartyKit clásico (con `partykit.json` + CLI propio) deprecado bajo Cloudflare; usamos su sucesor `partyserver` + `y-partyserver`, todo en `wrangler.jsonc` y un solo deploy pipeline.*
17. Declarar DO `RoadsheetCollab` en `wrangler.jsonc` con migrations (`new_sqlite_classes`).
18. DO handler `src/lib/do/roadsheet.ts`: `import { Server } from 'partyserver'` + `withYjs(Server)` (mixin de `y-partyserver`). Reemplaza el patrón `partykit/server` + `YServer`.
19. Auth gate `onBeforeConnect`: validar JWT Supabase + comprobar membership vía service-role REST. RLS gates la conexión, no el doc Yjs.
20. Persistence: `onLoad` lee último snapshot de `collab_snapshot`; `onSave` con `debounceWait: 60_000` + `debounceMaxWait: 30 updates` escribe el doc Yjs serializado.
21. Hibernation: el DO se hiberna cuando no hay actividad (changelog 2026-03-04 de `y-partyserver` mantiene tracking de conexiones a través de hibernation). Importante a escala — cientos de road sheets, la mayoría inactivos.
22. Smoke test: dos WebSockets al mismo DO reciben updates del otro, snapshot persistido en DB tras hibernation.

**Testing scaffold (3-4h)**
23. Vitest para unit/integration tests.
24. Playwright para e2e + visual regression.
25. Al menos un smoke test por capa: component (Button), API (GET /api/engagements), e2e (login flow).
26. CI placeholder — GitHub Action que corre tests en PR (no bloquea todavía).

**i18n + observabilidad (2h)** — *actualizado 2026-05-01: `@inlang/paraglide-sveltekit` está deprecada; cuando i18n importe (Phase 1), migrar a `@inlang/paraglide-js@^2`. Phase 0 sigue con `$lib/i18n.ts` simple ya en producción.*
27. `$lib/i18n.ts` con `t(key, locale)` + `en.json`/`es.json` (ya en sitio post-ADR-026). Mantener hasta Phase 1.
28. Sentry SvelteKit integrado vía `src/hooks.client.ts` + `src/hooks.server.ts` (ya en sitio post-ADR-026). Activar con `PUBLIC_SENTRY_DSN` env var en wrangler/CF dashboard.

**Backup (2-3h)**
29. Script `scripts/backup-to-r2.ts` — corre `supabase db dump` + sube a R2 bucket `hour-backups`.
30. Cron del Worker semanal (domingo madrugada). Retención: 12 semanas.

### Definition of done
- [x] Ningún valor visual hardcoded en `.svelte`. *(2026-05-01: tokens.css + base.css; primitivos solo redeclaran CSS variables.)*
- [x] 13 primitivos pasan tests visuales en 3 viewports. *(2026-05-01: showcase manual en `/playground`. Tests automáticos pendientes hasta scaffold de testing.)*
- [x] `/h/marco-rubiol/` renderiza shell. *(2026-05-01: layout con Sidebar + lens nav + topbar; placeholders entity en sitio.)*
- [ ] App abre offline con datos cacheados.
- [ ] Lighthouse PWA score ≥90.
- [ ] `reset_v2_roadsheet` aplicada + `schema.sql` sincronizado.
- [ ] `audit_log` recibe filas en UPDATEs.
- [ ] Realtime channel detecta 2 pestañas.
- [ ] Strings pasan por `t()`.
- [ ] Axe: 0 errores críticos en `/login` + `/difusion`.
- [ ] Sentry recibe evento test.
- [ ] Vitest + Playwright corren; smoke tests pasan.
- [ ] Backup R2 tiene al menos 1 dump.

### Pause point
Demo-able: "sistema coherente + colaborativo + offline-capable + test infra, sin funcionalidad nueva visible".

---

## Phase 0.1 — Plaza + Desk shell (~28h focused, 4-5 días)

### Goal
Entrar a la app, ver Houses/Rooms en Plaza, seleccionar Room, ver Runs+Gigs en Desk, click en Gig → detalle. **Primera vez que Hour parece Hour**. Gig detail **mobile-first desde día 1**; Plaza y Desk desktop-first.

### Prerequisito
Phase 0.0 completa.

### Trabajo
1. `<Plaza>` — sidebar upper, tree House→Rooms, single-select. Desktop-first; mobile polish en 0.4.
2. `<Desk>` — sidebar lower. Empty state + tree Runs→Gigs. Desktop-first; mobile polish en 0.4.
3. `<GigDetail>` — **mobile-first desde día 1**. Panel desktop / fullscreen mobile.
4. Endpoints: `GET /api/houses`, `GET /api/rooms?house_id=`, `GET /api/runs?project_id=`, `GET /api/gigs?run_id=`, `GET /api/gigs/:id`.
5. Router activo: `/h/:workspace/`, `/h/:workspace/room/:slug`, `/h/:workspace/gig/:slug` (slug según D-PRE-14). SvelteKit file-routing nativo `src/routes/h/[workspace]/[entity]/[slug]/+page.svelte`.
6. Cross-highlight UP.
7. Writes encolan cuando offline.
8. Presence badge "N online" en header.
9. Settings con Master View toggle.
10. **TanStack Query** (`@tanstack/svelte-query`, ya instalado en Phase 0.0 vía ADR-026) cubre el server-state cache: stale-while-revalidate, dedupe, invalidación por mutación. Cada lista (Houses, Rooms, Runs, Gigs) detrás de un `useQuery`. `+page.server.ts` `load()` precarga + hidrata el caché.

### Definition of done
- [ ] Marco abre app desktop + mobile → estado "silencio".
- [ ] Navegación Plaza → Room → Desk → Gig funciona en ambos.
- [ ] URL refleja selección canónica.
- [ ] Sin red: Plaza y Desk usan IndexedDB.
- [ ] Presence badge aparece con 2+ pestañas abiertas.
- [ ] Tests e2e cubren "login → navegar a un Gig".

### Pause point
**MVP real de Phase 0.1 = 4 pantallas**: Plaza + Desk tree + Gig detail + Settings/Master View. **Sin Calendar ni Road sheet**. Demo-able como "herramienta para navegar mi trabajo, offline-capable".

---

## Phase 0.2 — Views + Road sheet colaborativo + Calendar (~45h focused, ~8 días)

### Goal
Segunda lens encendida. Road sheet colaborativo en tiempo real. Multi-select + chip bar. **Este es el verdadero "MVP de uso diario con Calendar"**.

### Prerequisito
Phase 0.1 completa. PartyKit DO ya scaffoldeado en 0.0.

### Trabajo
1. `<ViewsNav>` — pastillas Calendar · Contacts · Money + All.
2. `<ChipBar>` — persistente con multi-select.
3. Multi-select: Cmd/Ctrl + Shift + checkbox-on-hover.
4. Lens Calendar (empty + data) — grid mensual read-only.
5. **Road sheet colaborativo**:
   - Ruta `/h/:workspace/gig/:slug/roadsheet?role=`.
   - Proyección SQL show + junctions + venue.
   - Vista filtrada por rol vía RLS + views.
   - CRDT en campos texto-libre vía `y-partykit` (ADR-025): `<YInput>` y `<YTextarea>` envuelven inputs, se conectan al Durable Object del road sheet, mirror local con `y-indexeddb`.
   - Realtime para campos estructurados.
   - Presence simplificada (D-PRE-10 → P10):
     - Badge "N personas en este road sheet" en header.
     - Colored border en el campo que alguien más tiene en focus + nombre encima.
     - **No cursor posicional** (diferido a 0.5).
   - Dual-timezone en timestamps.
6. Endpoint `GET /api/gigs/:id/roadsheet?role=`.
7. Link público firmado (D6 parcial): `/public/roadsheet/:signed-token`.
8. Road sheet **mobile-first desde día 1** (crítico — se consume en gira).
9. Tests e2e de colaboración (dos pestañas editando, verificar propagación).

### Definition of done
- [ ] Dos pestañas ven cambios del otro en <500ms.
- [ ] `show.notes` editado simultáneamente no destruye nada.
- [ ] Cambios offline en road sheet se replayan.
- [ ] Toggle Desk ↔ Calendar mantiene scope.
- [ ] `?role=venue` filtra correctamente.
- [ ] Link público firmado funciona sin auth.
- [ ] Chip bar aparece/desaparece con multi-select.
- [ ] Zonas horarias dobles visibles.
- [ ] Road sheet usable en iPhone.

### Pause point
**MVP "de uso diario con Calendar y colaboración"** = Phase 0.1 + Calendar lens + Road sheet colaborativo. ~12-14 días desde arranque de Phase 0.1. Demo-able como "Hour es herramienta real".

---

## Phase 0.3 — Contacts + Money + Room detail tabs (~30h focused, ~5 días)

### Goal
Las otras dos lenses. Room detail con 4 tabs. Contacts **mobile-first desde día 1** (ADR-015).

### Prerequisito
Phase 0.2 completa.

### Trabajo
1. Lens Contacts — lista searchable + filterable. Detail panel. **Mobile-first**.
   - **Filtros obligatorios** (no negociable): House, Room, status. Sidebar entity selected = filter (Contacts + House → personas con engagement en esa House; Contacts + Room → personas con engagement en ese Room). ADR-009. Mecanismo schema: junction `engagement(person_id, project_id, workspace_id)`. Filtro por Gig vía `show.engagement_id` cuando aplique.
2. Lens Money — invoices read-only + detail. Desktop-first.
3. Room detail tabs: Work · Assets · Team · About.
4. Endpoints varios.
5. Listas con SWR pattern: IndexedDB offline, API online.
6. Tests e2e de cada lens.

### Definition of done
- [ ] 4 lenses vivas.
- [ ] Room detail tabs navegables.
- [ ] Todas las listas tienen empty/loading/error/offline state.
- [ ] Contacts usable en iPhone.

### Pause point
Demo-able: "Hour arquitectónicamente completo, queda polish".

---

## Phase 0.4 — Polish + ⌘K + Mobile completo + GDPR + Notifications in-app (~40h focused, ~7 días)

### Goal
Command palette maximalista. Mobile polish para Plaza/Desk/Calendar/Money. GDPR export. Canal de notifications in-app.

### Prerequisito
Phase 0.3 completa.

### Trabajo
1. ⌘K — búsqueda global + navegación + **acciones** (crear, editar). ILIKE Phase 0.
2. Master View persistence en `workspace_membership.metadata.master_view`.
3. **Mobile polish**: Plaza + Desk + Calendar + Money responsive (completa el mobile-first que en 0.0-0.3 era solo subset crítico).
4. App-layer RBAC check: si GET devuelve 0 esperado → toast "lacks permission X".
5. GDPR export: "download my data" en Settings → ZIP (CSV por tabla + JSON workspace).
6. Notifications channel abstracto `src/lib/notify.ts` + in-app adapter (toast + badge + panel).
7. Accessibility pass: Axe + WCAG AA en todas las pantallas.

### Definition of done
- [ ] ⌘K encuentra/ejecuta en <3 keystrokes.
- [ ] Todas las lenses usables en mobile.
- [ ] Export genera ZIP válido.
- [ ] Notifications in-app funcionan.
- [ ] 0 errores críticos de a11y.

### Pause point
**Phase 0 production-ready.** Hour como herramienta diaria de verdad.

---

## Phase 0.5 — Deferred features

Orden por valor/coste:

1. **D3 task entity** + manual tasks atacheadas a Gig/Room.
2. **Asset upload resumable** (D-PRE-09) con `tus-js-client` + R2. Adaptación per-venue + inbound.
3. **Inline status change** + PATCH con error recovery loop completo.
4. **AI integration D8**: decision windows + dossier draft + visual markers.
5. **Audit log UI** — historial en Gig/Room detail, diff viewer.
6. **Notifications email + WhatsApp + Telegram** — adapters adicionales.
7. **Postgres FT search** reemplaza ILIKE cuando ~1000 entidades.
8. **Local-first real evaluation** — probar ElectricSQL / Zero / Triplit.
9. **Cursor posicional en presence** (upgrade de P10 simplificada).
10. **D1 task tags**.
11. **D9 kanban + D10 timeline**.
12. **Invoice creation + edit**.

---

## Phase 1 — SaaS readiness

- Custom domain wired.
- Onboarding + signup público.
- Pricing (Stripe/Paddle).
- Full D6 guest links + write-limited para venue (D-PRE-11 activado).
- D4 comms completo.
- Multi-workspace switching.
- Meilisearch cuando ~50000 entidades.
- Phase 1 decision gate: **2026-10-19**.

### Sueños Phase 1+ / nativo
- Bluetooth / WiFi-direct sync (requiere app nativa).
- Full local-first con CRDT-DB nativo.
- App iOS/Android nativa.

---

## MVPs (dos niveles, honestos)

### MVP "navegación" (fin de Phase 0.1, ~4-5 días después del arranque de 0.1)
**4 pantallas**: Plaza + Desk tree + Gig detail + Settings/Master View.
Gaps: sin Calendar, sin Road sheet, sin colaboración, sin multi-select.
Utilidad: navegar tu trabajo, consultar un gig, abrir en tu estado preferido.

### MVP "uso diario real" (fin de Phase 0.2, ~12-14 días después del arranque de 0.1)
**6+ pantallas**: lo anterior + Calendar lens + Road sheet colaborativo + chip bar.
Gaps: sin Contacts lens, sin Money, sin Room detail tabs, sin ⌘K, sin asset upload.
Utilidad: herramienta diaria genuina. Puedes ver tu calendario entero, editar road sheets colaborativamente, estar offline sin perder nada.

---

## Próximo sprint concreto (~13 días en chunks, estimación honesta)

Las 14 D-PRE están todas cerradas. Si arrancas ya: **Día 1 abajo**.

**Día 1** — Tokens + base ✓ CERRADO 2026-04-25:
- `tokens.css` (419 líneas) con three-tier color (base hues / status / contextual), ACSS 4.0 naming exacto, color-mix para shades + transparencias.
- `base.css` (749 líneas) con cascade layers + defaults semánticos (`:where(body)`, `:where(section:not(section section))`, `:where(body > header)`, inputs, table) + button skeleton `[class*="btn--"]` + badge skeleton + utility classes (`.bg--*`, `.text--*`, `.h1`-`.h6`).
- `Base.astro` layout. `/login` y `/booking` (renombrado desde `/difusion`) migrados a tokens. Fix scoped CSS para badges dinámicos via JS (`<style is:global>`).
- Primary terracota `oklch(0.52 0.141 29.7)` (#AB4235). Light theme (D-PRE-01). Color-scheme `light`.
- Regla del proyecto formalizada: UI en inglés (D-PRE-03 default locale). Filosofía ACSS extrapolada a `_methød/philosophy.md` con sección Svelte 5 explícita.

**Día 2-3** — Primitivos base (6):
- Button, Input, Chip, Checkbox, Radio, Avatar con estados completos.
- `@astrojs/i18n` configurado + `t()` wrapper.
- `/playground` dev-only.

**Día 4** — Primitivos composición (3):
- Badge, Select, Dialog.
- `serializeViewState` + `hydrateViewState`.
- Stores compartidas `.svelte.ts` con runes module-level (post-ADR-026, no nanostores).

**Día 5** — Primitivos avanzados (3):
- Toast, Tooltip, Menu.
- Scaffold rutas `src/routes/h/[workspace]/[entity]/[slug]/` (post-ADR-026, no Astro pages).

**Día 6** — Sidebar + schema completo:
- Sidebar (colapsable mobile).
- Migración `reset_v2_roadsheet.sql` aplicada: ADR-023 + audit_log (13 tablas) + venue.timezone + **slug system (ADR-024)** + **collab_snapshot (ADR-025)**.

**Día 7-8** — Offline + PWA:
- `@vite-pwa/astro` + manifest + SW con Workbox.
- Update strategy background + restart (D-PRE-13).
- `local-db.ts` (IndexedDB wrapper).
- `write-queue.ts` con conflict UI.

**Día 9** — Real-time + presence:
- Supabase Realtime activado + wrapper.
- Presence channel workspace.
- Integración Sentry.

**Día 10** — PartyKit DO scaffold (ADR-025):
- `partykit.json` + namespace `hour-collab`.
- DO handler `src/party/roadsheet.ts` con `YServer` + `withYjs`.
- Auth gate con Supabase JWT + membership check.
- Persistence a `collab_snapshot` cada 30 updates / 60s.
- Smoke test: dos WebSockets reciben updates + snapshot en DB.

**Día 11** — Testing + backup:
- Vitest + Playwright configurados.
- Smoke tests de 3 capas (component, API, e2e login).
- CI placeholder GitHub Action.
- Script `backup-to-r2.ts` + cron Worker semanal.

**Día 12-13** — Plaza primera pantalla real:
- `<Plaza>` renderizando House→Rooms desde API + IndexedDB fallback.
- Slug routing: `/h/marco-rubiol/` + navegación a `/h/marco-rubiol/room/:slug`.
- Presence badge en header.
- Tests e2e de navegación básica.

**Checkpoint día 13**: Phase 0.0 completa + Plaza primera iteración. Pause point natural.

---

## Riesgos top (8)

| # | Riesgo | Mitigación |
|---|--------|------------|
| 1 | Tokens diferidos → refactor 3 semanas | Phase 0.0 forza tokens antes |
| 2 | Sidebar state acoplado a URL | D-PRE-02 + serializeViewState |
| 3 | RBAC solo en RLS → empty states mudos | App-layer check en 0.4 |
| 4 | asset_version ↔ R2 sync roto | Diseñar lifecycle antes de 0.5 upload |
| 5 | PATCH engagement sin rollback | Error→recovery loop antes de PATCH |
| 6 | Offline/sync destruye datos | CRDT texto + write queue con conflict UI |
| 7 | ElectricSQL abandonado | Smart offline ahora, eval en 0.5 |
| 8 | Audit log no implementado hasta incidente | Tabla + trigger en 0.0 aunque UI en 0.5 |

---

## Deuda reconocida

### Técnica
- Tensión C road sheet snapshot — resuelta en 0.2 como "push + snapshot con nota al enviar".
- Tensión E AI+RBAC — resuelta con D-PRE-04, revisitar Phase 1.
- Full local-first real — eval 0.5.
- Full D6 public guest links — solo road sheet en Phase 0.
- Cursor posicional presence — diferido 0.5.
- Bluetooth/WiFi-direct — imposible en PWA, Phase 1+ nativo.

### Operacional
- GDPR export → 0.4.
- Notifications multicanal → 0.4 abstracto, 0.5 canales.
- Search scale → ILIKE 0, FT 0.5, Meilisearch 1.
- Venue edita campos específicos (D-PRE-11 futuro) → Phase 1.
- Testing coverage expansion (smoke en 0.0, cobertura real desde 0.2).

---

## Estimación total actualizada (honesta)

| Fase | Horas focused | Calendario chunks |
|------|---------------|-------------------|
| 0.0 Fundación (+ PartyKit DO + slug system) | 55-70h | ~13 días |
| 0.1 Plaza + Desk | 28h | ~4-5 días |
| 0.2 Views + Road sheet colab + Calendar | 45h | ~8 días |
| 0.3 Contacts + Money + Room detail | 30h | ~5 días |
| 0.4 Polish + ⌘K + Mobile + GDPR + Notif in-app | 40h | ~7 días |
| **Total Phase 0** | **~200-215h** | **~38 días en chunks** (3-4 meses) |

Phase 0.5 y Phase 1: abiertos.

---

## Cómo usar este documento

- Leer al empezar cada sesión de trabajo en Hour.
- Al completar una fase, marcar DoD y añadir fecha de cierre.
- Si aparece una fase nueva, insertar en orden correcto.
- Si un ADR nuevo cambia una fase, actualizar aquí al mismo tiempo.
- Al final de cada fase, reflexión de 10 min: ¿qué tardó más? ¿qué riesgo se materializó?
