# Hour — Roadmap de implementación

> Documento vivo. Se actualiza al cerrar cada fase. Ordenado por dependencias reales, no por deseo.
> Última actualización: 2026-05-02 (MVP transversal integrado definido, Phase 0.9 gate definido, 22 tablas, SvelteKit stack).

## 🎯 Qué toca hoy (punto de entrada)

**Si estás arrancando Phase 0** → ir a "[Próximo sprint concreto](#próximo-sprint-concreto-13-días-en-chunks-estimación-honesta)" y empezar por **Día 1 — Tokens + base**.

**Si estás a mitad de Phase 0.0** → el último checkbox marcado en "Definition of done" de Phase 0.0 indica dónde quedamos. Si no hay checkboxes marcados, mirar el último día listado en el sprint concreto que tenga commits en `03_AGENCY/Hour/apps/web/`.

**Si has terminado Phase 0.0** → abrir `## Phase 0.1 — Plaza + Desk shell` y empezar por trabajo #1 (`<Plaza>` component).

**Si has terminado cualquier otra fase** → siguiente fase en el índice abajo. Cada fase tiene su propia sección con goal, prerequisito, trabajo y DoD.

**Si vuelves después de una pausa >1 semana** → releer `## Estado actual` + `## Deuda reconocida` antes de continuar. Sesenta segundos que evitan medio día de desorientación.

Antes de cualquier trabajo: leer primero el [`_context.md`](../_context.md) del proyecto y [`_methød/`](/_methød/) relevante (CSS, design, wordpress si aplicara).

## Current operating state
 
### Current next action
 
Terminar Phase 0.0 antes de empezar Phase 0.1.
 
Siguiente trabajo real: completar los DoD pendientes de Phase 0.0 — offline/PWA, realtime/presence, PartyServer DO scaffold, testing scaffold, Sentry smoke, backup R2 y rollback runbook.
 
No empezar Plaza/Desk productivos hasta que Phase 0.0 esté cerrada o se marque explícitamente como shortcut/deuda.
 
### Current constraints
 
- No construir un módulo profundo antes de validar el sistema transversal.
- No convertir Hour en "booking-first", "production-first" ni "road-sheet-first".
- No bloquear el producto por naming: `Room` es vocabulario de trabajo, no decisión final irreversible.
- No hacer onboarding de clientes externos antes de Phase 0.9.
- No construir full task entity, asset upload, invoice edit, comms multicanal ni local-first real en Phase 0.
- No resolver con custom fields algo que aparece repetidamente como necesidad core.
- No duplicar Ares/Holded/Asana: Hour conecta operación escénica, no reemplaza todo.
 
### Decision gates
 
- **Naming gate**: antes de bloquear copy final en Phase 0.4, testear `House`, `Room`, `Run`, `Gig`, `Desk` con MaMeMi, Electrico 28 y 2-3 usuarios conocidos. Si `Room` se confunde con venue/sala en más de un caso serio, buscar alternativa.
- **MVP structural gate**: al final de Phase 0.1, comprobar si el mapa House → Room → Run/Gig se entiende sin explicación larga.
- **MVP transversal gate**: al final de Phase 0.2, comprobar si Calendar + Road sheet salen naturalmente del mismo mapa operativo.
- **System completeness gate**: al final de Phase 0.3, comprobar si las 4 lenses — Desk, Calendar, Contacts, Money — funcionan como vistas del mismo sistema.
- **Electrico 28 gate**: antes de beta externa, representar su caso real: colectivo, ~15 personas, 4 espectáculos, booking, producción y espectáculo de calle con validación in situ.
- **External client gate**: ningún workspace externo antes de completar Phase 0.9.
- **Phase 1 gate**: SaaS público/self-serve solo si beta asistida valida demanda real.
 
### What not to decide today
 
- Naming final de `Room`.
- Pricing.
- Self-serve onboarding.
- Integraciones WhatsApp/email/Telegram.
- Facturación legal completa.
- Full AI layer.
- App nativa.
- Local-first real.
- Custom workflow builder.
 
### Where to look
 
- **Build sequencing**: este roadmap.
- **Product/UX rationale**: [research/product/20-product-strategy-review.md](../research/product/20-product-strategy-review.md).
- **Technical architecture**: [build/architecture.md](architecture.md).
- **Historical decisions**: [_decisions.md](../_decisions.md).
- **Visual/UI direction**: [build/design-prompt.md](design-prompt.md).

---

## Estado actual (honesto)

### Construido y funcional
- **Infra**: Cloudflare Worker `hour-web` + Supabase `hour-phase0` en `eu-central-1` + R2 bucket `hour-media`. Auth hook + JWT con `current_workspace_id`. Smart Placement activo para co-locar Worker cerca de Supabase.
- **Schema (reset v2 + roadsheet)**: 22 tablas en producción, RLS forzada, `has_permission()` helper, 15 system roles seedeados, `audit_log` + triggers verificados live.
- **Datos reales**: 154 persons + 154 engagements del circuito booking/difusión 2026-27, 30 con dossier.
- **UI mínima**: SvelteKit 2 + Svelte 5. `/login`, `/booking`, `/playground`, scaffold `/h/[workspace]/...`, 13 primitivos, TanStack Query y Sentry wiring.

### Decidido firme (ADR-001 a ADR-027 + 14 D-PRE todas cerradas)
Data layer: ADR-001 a 007. UI: ADR-008 a 010, 013-018, 022. Road sheet + collab: ADR-019 a 021, 023, 025. URLs + slugs: ADR-022, 024. 14 D-PRE cerradas 2026-04-24 detalladas abajo.

### Decidido pero NO construido (la masa)
- Plaza + Desk reales (ADR-009) aún no cargan datos productivos.
- Runtime infra Phase 0.0 pendiente: backup automatizado, testing scaffold, PWA/offline, real-time wrapper/presence, PartyServer DO.
- Road sheet colaborativo UI pendiente de Phase 0.2; schema y `collab_snapshot` ya existen.
- Multi-workspace switching real pendiente de Phase 1; hoy el hook usa el primer workspace aceptado.
- Hardening pre-cliente externo pendiente: cookies httpOnly, rate limiting, error redaction, Sentry PII scrub, RLS regression tests, restore drill, admin/support mínimo, query scaling, alertas/runbooks.

### Gaps implícitos descubiertos
Error boundaries, loading/empty/error states completos, form validation en todas las mutaciones, keyboard shortcuts, accessibility baseline, app-layer RBAC check, offline/PWA infrastructure, real-time sync, dual-timezone rendering completo, **testing framework**, **backup automation**, **rollback runbook**, **rate limiting**, **Sentry PII scrub**, **httpOnly session cookies**, **cursor pagination/query indexes**, **RLS regression tests**, **restore drill**, **admin/support mínimo**, **health checks**, **structured logging**, **production alerts**.

---

## Principios de fasing

1. **Fundación antes de visual.** No tocar UI real hasta que tokens + primitivos + offline shell existan.
2. **Mobile-first para subset crítico desde la fase que lo introduce**: primitivos responsive en 0.0; Gig detail en 0.1; Road sheet en 0.2; Contacts en 0.3. Resto (Plaza, Desk, Calendar, Money) desktop-first + polish mobile en Phase 0.4.
3. **Local-first como norte.** Phase 0 usa smart-offline; Phase 0.5 evalúa local-first real.
4. **Multiusuario desde Phase 0.2.** Supabase Realtime para campos estructurados + `y-partyserver` sobre Cloudflare Durable Objects para texto libre (ADR-025).
5. **Pasos pequeños y sólidos.** Cada fase termina demo-able.
6. **Pause points cada 3-4 días.** Si paro, lo que queda es coherente.
7. **Testing desde el principio.** Vitest + Playwright configurados en 0.0; tests reales desde 0.2.
8. **Deuda técnica explícita.** Si se toma shortcut, va a sección "Deuda".

---

## Principio producto Phase 0 — MVP transversal integrado
 
Phase 0 no debe construir un módulo profundo primero. No es "booking-first", "production-first" ni "road-sheet-first".
 
La hipótesis central de Hour es que el valor aparece cuando las piezas operativas viven conectadas:
 
- House / workspace como boundary de compañía, colectivo o marca.
- Room / project como unidad creativa-comercial.
- People + engagements como memoria relacional.
- Gig/show/date como unidad operativa.
- Venue como contexto físico y técnico.
- Assets como material canónico o adaptado.
- Road sheet como proyección compartible de datos vivos.
- Lenses + filtros como forma de ver el mismo mundo desde trabajo, calendario, contactos o dinero.
 
Por tanto, el MVP debe ser **poco profundo pero transversal**. Cada módulo puede empezar limitado, pero la interrelación debe funcionar antes de ampliar booking, producción, técnica, facturación o comunicación.
 
Criterio: si una beta real no puede representar un caso tipo Electrico 28 —colectivo, varias personas, varios espectáculos, booking, producción y un espectáculo de calle con validación in situ— el MVP no está validado.

---

## Decisiones previas obligatorias (14 D-PRE)

### D-PRE-01 — Tema light mode ✓ CERRADA
Respetar ADR-014. Migrar scaffold a tokens semánticos light en Phase 0.0.

### D-PRE-02 — Router: SvelteKit file-routing ✓ CERRADA / REABIERTA Y SUSTITUIDA 2026-05-01 por ADR-026
La decisión original Astro + Svelte islands quedó supercedida por ADR-026. Estado actual: SvelteKit 2 + Svelte 5 + `@sveltejs/adapter-cloudflare`.

Razón del cambio: el audit de `apps/web/` mostró que Astro ya era un wrapper mínimo y Phase 0.2 necesitaba shared state, `load()`, hooks server, form actions y rutas dinámicas colaborativas. El router canónico queda en `src/routes/h/[workspace]/[entity]/[slug]/+page.svelte`.

### D-PRE-03 — i18n scaffold en Phase 0.0, content inglés hasta Phase 1 ✓ CERRADA
`$lib/i18n` simple configurado con locales `en` y `es`. Todas las strings nuevas deben pasar por `t()`. Migrar a `@inlang/paraglide-js@^2` cuando i18n importe de verdad (0.5/Phase 1).

### D-PRE-04 — AI bypass RBAC como workspace-owner-level ✓ CERRADA
AI enrichment opera como asistente del workspace owner, no user-level. `ai_suggested boolean` + `enriched_by_model text` en campos afectados. Revisitar Phase 1 con multi-user real.

### D-PRE-05 — Copy Link global con truncación a 400 chars ✓ CERRADA
`serializeViewState()` captura `{scope, lens, filters, sort}`. Truncar chip bar a 3 primeros + avisar si supera 400. Master View = mismo mecanismo en localStorage.

### D-PRE-06 — Supabase Realtime como canal firme ✓ CERRADA
Activar en 0.0. Canales: `show:{show_id}`, `project:{project_id}`, `workspace:{workspace_id}:presence`. Stores Svelte 5 se suscriben al montarse y hacen unsubscribe al desmontarse.

### D-PRE-07 — CRDT path: y-partyserver sobre Cloudflare Durable Objects ✓ CERRADA (ver ADR-025)
- **Decisión**: `y-partyserver` + Durable Object por road sheet + `y-indexeddb` cliente + auth gate con Supabase JWT.
- **Razón**: `y-supabase` está abandonado (último push 2023, issue sin responder). PartyKit fue adquirido por Cloudflare en 2024; el camino actual es `partyserver` sobre Durable Objects — mismo runtime que Hour ya usa. Escalable a ≤5 users × 100 docs/año sin friccionar.
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

Estimación honesta. Subió de 30-35h inicial a 45-55h tras pasada crítica + ahora a 55-70h al incluir PartyServer DO scaffold (5-8h) y slug system en el schema (1-2h).

### Goal
Sistema de diseño + primitivos responsive + router + scaffold limpio + offline shell + real-time infra + PartyServer collab infra + i18n wiring + testing scaffold + backup. Cuando esto termina, trabajar con coherencia, multiusuario, offline-capable, colaborativo-capable y con tests desde el primer PR.

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
9. PWA vía Vite/SvelteKit + `manifest.webmanifest` + Service Worker con Workbox.
10. Update strategy D-PRE-13: background download, install on next restart, sin banners.
11. `src/lib/local-db.ts` — IndexedDB wrapper con tablas espejo de Postgres.
12. `src/lib/write-queue.ts` — mutations offline → IndexedDB → replay al reconectar + conflict UI con diff.
13. Caching strategy: road sheets próximos 10 días + shell + assets estáticos.

**Real-time (4-5h)**
14. Supabase Realtime activado + wrapper `src/lib/realtime.ts`.
15. Presence channel global `workspace:{id}:presence`.

**Schema (3-4h) — CERRADO 2026-05-01**
16. Migración `reset_v2_roadsheet.sql`:
    - `show` + 5 timeslots + 3 jsonb (logistics, hospitality, technical).
    - `crew_assignment`, `cast_override`, `asset_version` (con `direction`).
    - `audit_log` + `audit_trigger` aplicado a 13 tablas.
    - `venue.timezone text` (D-PRE-10).
    - **Slug system (ADR-024)**: `slug text NOT NULL` + `previous_slugs text[] DEFAULT '{}'` en 8 tablas (`workspace`, `project`, `line`, `show`, `engagement`, `person`, `venue`, `asset_version`). Partial unique index por `(workspace_id, entity_type, slug)`. Función `slug_generator(name)` + trigger de validación.
    - **PartyServer persistence (ADR-025)**: tabla `collab_snapshot(id, target_table, target_id, snapshot bytea, version int, created_at)` para persistir snapshots Yjs desde el Durable Object.

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
28. Sentry SvelteKit integrado vía `src/hooks.client.ts` + `src/hooks.server.ts` (ya en sitio post-ADR-026). Phase 1 debe desactivar PII por defecto y enmascarar replay antes de clientes externos.

**Backup + rollback (2-3h)**
29. GitHub Action semanal — corre `supabase db dump` + sube a R2 bucket `hour-backups`. Retención: 12 semanas. No Worker cron: Cloudflare Workers no puede ejecutar binarios nativos.
30. Runbook `build/runbooks/rollback.md` — procedimiento corto para rollback de Cloudflare Worker + cautela explícita con migraciones DB.

### Definition of done
- [x] Ningún valor visual hardcoded en `.svelte`. *(2026-05-01: tokens.css + base.css; primitivos solo redeclaran CSS variables.)*
- [x] 13 primitivos pasan tests visuales en 3 viewports. *(2026-05-01: showcase manual en `/playground`. Tests automáticos pendientes hasta scaffold de testing.)*
- [x] `/h/marco-rubiol/` renderiza shell. *(2026-05-01: layout con Sidebar + lens nav + topbar; placeholders entity en sitio.)*
- [ ] App abre offline con datos cacheados.
- [ ] Lighthouse PWA score ≥90.
- [x] `reset_v2_roadsheet` aplicada en producción. *(2026-05-01: schema delta source of truth en `build/migrations/2026-05-01_reset_v2_roadsheet.sql`; consolidación in-place diferida.)*
- [x] `audit_log` recibe filas en UPDATEs. *(2026-05-01: 394 bootstrap + 1 smoke UPDATE verificados.)*
- [ ] Realtime channel detecta 2 pestañas.
- [ ] Strings pasan por `t()`.
- [ ] Axe: 0 errores críticos en `/login` + `/booking`.
- [ ] Sentry recibe evento test.
- [ ] Vitest + Playwright corren; smoke tests pasan.
- [ ] Backup R2 tiene al menos 1 dump.

### Pause point
Demo-able: "sistema coherente + colaborativo + offline-capable + test infra, sin funcionalidad nueva visible".

---

## Phase 0.1 — Plaza + Desk shell (~28h focused, 4-5 días)

### Goal
Entrar a la app y comprobar que el mapa base funciona: House → Room → Run/Gig, con scope persistente, filtros y detalle operativo. **Primera vez que Hour parece Hour**. Gig detail **mobile-first desde día 1**; Plaza y Desk desktop-first.
 
Esta fase no intenta profundizar ningún módulo. Valida que la estructura transversal existe y que el usuario entiende dónde vive cada cosa.

### Prerequisito
Phase 0.0 completa.

### Trabajo
1. `<Plaza>` — sidebar upper, tree House→Rooms, single-select. Desktop-first; mobile polish en 0.4.
2. `<Desk>` — sidebar lower. Empty state + tree Runs→Gigs. Desktop-first; mobile polish en 0.4.
3. `<GigDetail>` — **mobile-first desde día 1**. Panel desktop / fullscreen mobile.
4. `<RelationshipStub>` — bloque mínimo en Room/Gig detail que muestre people/engagements vinculados si existen, aunque Contacts lens llegue en 0.3.
5. `<ProductionStub>` — bloque mínimo en Gig detail para venue, timeslots, logistics/technical/hospitality summary.
6. Endpoints: `GET /api/houses`, `GET /api/rooms?house_id=`, `GET /api/runs?project_id=`, `GET /api/gigs?run_id=`, `GET /api/gigs/:id`.
7. Router activo: `/h/:workspace/`, `/h/:workspace/room/:slug`, `/h/:workspace/gig/:slug` (slug según D-PRE-14). SvelteKit file-routing nativo `src/routes/h/[workspace]/[entity]/[slug]/+page.svelte`.
8. Cross-highlight UP.
9. Writes encolan cuando offline.
10. Presence badge "N online" en header.
11. Settings con Master View toggle.
12. **TanStack Query** (`@tanstack/svelte-query`, ya instalado en Phase 0.0 vía ADR-026) cubre el server-state cache: stale-while-revalidate, dedupe, invalidación por mutación. Cada lista (Houses, Rooms, Runs, Gigs) detrás de un `useQuery`. `+page.server.ts` `load()` precarga + hidrata el caché.

### Definition of done
- [ ] Marco abre app desktop + mobile → estado "silencio".
- [ ] Navegación Plaza → Room → Desk → Gig funciona en ambos.
- [ ] URL refleja selección canónica.
- [ ] Sin red: Plaza y Desk usan IndexedDB.
- [ ] Presence badge aparece con 2+ pestañas abiertas.
- [ ] Tests e2e cubren "login → navegar a un Gig".

### Pause point
**MVP estructural inicial de Phase 0.1**: Plaza + Desk tree + Gig detail + Settings/Master View + stubs de relación/producción. **Sin Calendar ni Road sheet completos**. Demo-able como "Hour ya tiene mapa operativo: sé dónde vive cada cosa".

---

## Phase 0.2 — Views + Road sheet colaborativo + Calendar (~45h focused, ~8 días)

### Goal
Encender Calendar y Road sheet para probar que fechas, producción y sharing salen del mismo mapa operativo. Multi-select + chip bar. **Este es el primer MVP transversal usable**.

### Prerequisito
Phase 0.1 completa. PartyServer DO ya scaffoldeado en 0.0.

### Trabajo
1. `<ViewsNav>` — pastillas Calendar · Contacts · Money + All.
2. `<ChipBar>` — persistente con multi-select.
3. Multi-select: Cmd/Ctrl + Shift + checkbox-on-hover.
4. Lens Calendar (empty + data) — grid mensual read-only.
5. **Road sheet colaborativo**:
   - Ruta `/h/:workspace/gig/:slug/roadsheet?role=`.
   - Proyección SQL show + junctions + venue.
   - Vista filtrada por rol vía RLS + views.
   - CRDT en campos texto-libre vía `y-partyserver` (ADR-025): `<YInput>` y `<YTextarea>` envuelven inputs, se conectan al Durable Object del road sheet, mirror local con `y-indexeddb`.
   - Realtime para campos estructurados.
   - Presence simplificada (D-PRE-10 → P10):
     - Badge "N personas en este road sheet" en header.
     - Colored border en el campo que alguien más tiene en focus + nombre encima.
     - **No cursor posicional** (diferido a 0.5).
   - Dual-timezone en timestamps.
   - Snapshot/share history mínimo: cuándo se generó o compartió, rol, destinatario opcional, y si hubo cambios posteriores.
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
**MVP transversal usable** = Phase 0.1 + Calendar lens + Road sheet colaborativo + chip bar. ~12-14 días desde arranque de Phase 0.1. Demo-able como "Hour conecta estructura, fechas, producción y sharing".

---

## Phase 0.3 — Contacts + Money + Room detail tabs (~30h focused, ~5 días)

### Goal
Completar las lenses base para validar que el mapa transversal aguanta contactos, seguimiento y dinero básico. Room detail con 4 tabs. Contacts **mobile-first desde día 1** (ADR-015).

### Prerequisito
Phase 0.2 completa.

### Trabajo
1. Lens Contacts — lista searchable + filterable. Detail panel. **Mobile-first**.
   - **Filtros obligatorios** (no negociable): House, Room, status. Sidebar entity selected = filter (Contacts + House → personas con engagement en esa House; Contacts + Room → personas con engagement en ese Room). ADR-009. Mecanismo schema: junction `engagement(person_id, project_id, workspace_id)`. Filtro por Gig vía `show.engagement_id` cuando aplique.
   - Vista mínima de seguimiento: status, last note/date, next action y owner si existe. Esto no sustituye D3 task entity, pero evita que Contacts sea solo una libreta.
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
**Phase 0 internal production-ready.** Hour como herramienta diaria de verdad para uso interno; clientes externos siguen bloqueados hasta Phase 0.9.

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

## Phase 0.9 — Private beta hardening gate

### Goal
**Mandatory gate before any external known client.** Adds security hardening, observability, and operational readiness. No external workspace before Phase 0.9 complete.

### Prerequisito
Phase 0.4 complete and validated daily usage internally. Billing self-serve and public signup NOT required.

### Trabajo (9 items, ~25h total)
| Item | What | How | Est |
|------|------|-----|-----|
| Session hardening | JWT localStorage → httpOnly Secure SameSite=Strict cookies | `+server.ts` refresh endpoint, cookie parser in hooks | 4-6h |
| Rate limiting | `/api/sentry-tunnel` and auth endpoints throttled | Cloudflare KV counters in Worker | 30m |
| RLS regression suite | Automated tests for isolation guarantees | Vitest + Supabase test DB + seeded fixtures | 3-4h |
| Restore drill | Documented & tested restore from R2 backup | GitHub Action + `psql` restore to staging | 2-3h |
| Onboarding/support minimum | Create workspace, invite users, assign roles, diagnose issues | Protected admin routes + workspace management UI | 4-6h |
| Structured logging | JSON logs with request_id correlation | Pino or similar in Worker hooks | 2h |
| Health checks | `/health/live` (deps OK) and `/health/ready` (usable) | `+server.ts` endpoints | 30m |
| Sentry PII scrub | Ensure email/user_id hashed before Sentry ingest | `beforeSend` hook in Sentry init | 1h |
| Resilience mínimo | Timeouts, retry budget, circuit breaker for Supabase/PostgREST | `$lib/supabase.ts` wrapper with exponential backoff | 3h |

### Definition of done
- [ ] No tokens in `localStorage` (httpOnly cookies enforced)
- [ ] Rate limiting active on `/api/sentry-tunnel` and auth endpoints
- [ ] RLS regression suite passes (workspace isolation, limited roles, guest links)
- [ ] Restore drill tested in staging (<30min RPO/RTO)
- [ ] Onboarding UI can create workspace, invite users, assign roles
- [ ] Support UI can diagnose memberships, view workspace errors
- [ ] Structured logs with `request_id` in production
- [ ] `/health/live` and `/health/ready` endpoints functional
- [ ] Sentry PII scrub active (email/user_id hashed)
- [ ] Resilience wrapper handles timeouts and retries gracefully

### Pause point
Hour can onboard first external known client (assisted, not self-serve). Public signup still deferred to Phase 1.

---

## Phase 1 — Public SaaS launch

**Trigger**: Phase 0.9 validates demand through assisted beta. Only if external clients prove real need for self-serve.

### Core changes from Phase 0.9
- Public signup/self-serve onboarding (Stripe/Paddle billing)
- Full D6 guest links + write-limited for venues
- D4 comms (WhatsApp/Telegram/email adapters)
- Multi-workspace switching UI
- OAuth providers (Google, Apple)
- Public marketing site

### Technical checklist (build on 0.9 foundation)
- Auth/session: extend 0.9 hardening for public signup flows
- API hardening: automate limits from 0.9 patterns
- Privacy: formalize GDPR, terms, DPA
- Operability: CI/CD, deploy preview, incident response
- Scaling: cursor pagination, query optimization
- Search: Meilisearch when ~50k entities
- Region: Frankfurt primary, evaluate non-EU demand

### Decision gate
Phase 1 activates **only if** Phase 0.9 assisted beta validates demand. Otherwise Hour continues as private tool.

### Sueños Phase 1+ / nativo
- Bluetooth / WiFi-direct sync (requiere app nativa).
- Full local-first con CRDT-DB nativo.
- App iOS/Android nativa.

---

## MVPs (transversales, no modulares)
 
### MVP estructural inicial (fin de Phase 0.1)
 
**Pantallas**: Plaza + Desk tree + Gig detail + Settings/Master View + stubs de relación/producción.
 
Gaps: sin Calendar completo, sin Road sheet completa, sin Contacts lens completa, sin Money, sin multi-select avanzado.
 
Utilidad: comprobar que el mapa base se entiende: House, Room, Run/Gig, scope, URL, filtros y detalle operativo.
 
No valida todavía uso diario. Valida estructura.
 
### MVP transversal usable (fin de Phase 0.2)
 
**Pantallas**: lo anterior + Calendar lens + Road sheet colaborativo + chip bar.
 
Gaps: Contacts y Money aún no son lenses completas, pero la relación persona/conversación debe aparecer como contexto mínimo en Room/Gig.
 
Utilidad: comprobar que Hour conecta estructura, fechas, producción y sharing.
 
### MVP arquitectónicamente completo (fin de Phase 0.3)
 
**Pantallas**: 4 lenses vivas — Desk, Calendar, Contacts, Money — + Room detail tabs.
 
Gaps: sin profundidad modular completa, sin task entity completa, sin asset upload, sin invoice creation/edit, sin comms multicanal.
 
Utilidad: validar que el sistema entero existe con poca profundidad antes de ampliar módulos verticales: booking, producción, técnica, facturación y comunicación.

---

## Próximo sprint concreto (~13 días en chunks, estimación honesta)

Las 14 D-PRE están todas cerradas. Si arrancas ya: **Día 1 abajo**.

**Día 1** — Tokens + base ✓ CERRADO 2026-04-25:
- `tokens.css` (419 líneas) con three-tier color (base hues / status / contextual), ACSS 4.0 naming exacto, color-mix para shades + transparencias.
- `base.css` (749 líneas) con cascade layers + defaults semánticos (`:where(body)`, `:where(section:not(section section))`, `:where(body > header)`, inputs, table) + button skeleton `[class*="btn--"]` + badge skeleton + utility classes (`.bg--*`, `.text--*`, `.h1`-`.h6`).
- Layout SvelteKit base. `/login` y `/booking` migrados a tokens. Fix de badges dinámicos resuelto en componentes Svelte/CSS scoped.
- Primary terracota `oklch(0.52 0.141 29.7)` (#AB4235). Light theme (D-PRE-01). Color-scheme `light`.
- Regla del proyecto formalizada: UI en inglés (D-PRE-03 default locale). Filosofía ACSS extrapolada a `_methød/philosophy.md` con sección Svelte 5 explícita.

**Día 2-3** — Primitivos base (6):
- Button, Input, Chip, Checkbox, Radio, Avatar con estados completos.
- `$lib/i18n` configurado + `t()` wrapper.
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
- PWA vía Vite/SvelteKit + manifest + SW con Workbox.
- Update strategy background + restart (D-PRE-13).
- `local-db.ts` (IndexedDB wrapper).
- `write-queue.ts` con conflict UI.

**Día 9** — Real-time + presence:
- Supabase Realtime activado + wrapper.
- Presence channel workspace.
- Integración Sentry.

**Día 10** — PartyServer DO scaffold (ADR-025):
- Durable Object declarado en `wrangler.jsonc` con migrations nativas.
- DO handler `src/lib/do/roadsheet.ts` con `partyserver` + `y-partyserver`.
- Auth gate con Supabase JWT + membership check.
- Persistence a `collab_snapshot` cada 30 updates / 60s.
- Smoke test: dos WebSockets reciben updates + snapshot en DB.

**Día 11** — Testing + backup + rollback:
- Vitest + Playwright configurados.
- Smoke tests de 3 capas (component, API, e2e login).
- CI placeholder GitHub Action.
- GitHub Action semanal `supabase db dump` → R2 `hour-backups`.
- `build/runbooks/rollback.md` creado y enlazado.

**Día 12-13** — Plaza primera pantalla real:
- `<Plaza>` renderizando House→Rooms desde API + IndexedDB fallback.
- Slug routing: `/h/marco-rubiol/` + navegación a `/h/marco-rubiol/room/:slug`.
- Presence badge en header.
- Tests e2e de navegación básica.

**Checkpoint día 13**: Phase 0.0 completa + Plaza primera iteración. Pause point natural.

---

## Riesgos top (15)

| # | Riesgo | Mitigación |
|---|--------|------------|
| 1 | Tokens diferidos → refactor 3 semanas | Phase 0.0 forza tokens antes |
| 2 | Sidebar state acoplado a URL | D-PRE-02 + serializeViewState |
| 3 | RBAC solo en RLS → empty states mudos | App-layer check en 0.4 |
| 4 | asset_version ↔ R2 sync roto | Diseñar lifecycle antes de 0.5 upload |
| 5 | PATCH engagement sin rollback | Error→recovery loop antes de PATCH |
| 6 | Offline/sync destruye datos | CRDT texto + write queue con conflict UI |
| 7 | ElectricSQL abandonado | Smart offline ahora, eval en 0.5 |
| 8 | RLS bug cruza tenants | Phase 0.9 exige RLS regression suite con dos workspaces |
| 9 | Cliente externo llega antes de cookies/rate limiting | Phase 0.9 bloqueante antes de cualquier workspace externo |
| 10 | Backup existe pero restore no probado | Restore drill obligatorio en Phase 0.9 |
| 11 | Soporte requiere SQL manual | Admin/support mínimo antes de clientes conocidos |
| 12 | PostgREST/Supabase degrada y causa cascada | Timeouts + retry budget + circuit breaker en Phase 0.9 |
| 13 | Construir módulo profundo antes de validar el sistema | Phase 0 se redefine como MVP transversal integrado |
| 14 | `Room` no se entiende o se confunde con venue/sala | Test de naming antes de lock de copy UI |
| 15 | Desk sin acciones reales se queda en navegación | Introducir next-action/task mínima antes de depender de Desk |

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
- GDPR delete → definir soft delete + hard delete programado para datos personales antes de SaaS externo.
- Notifications multicanal → 0.4 abstracto, 0.5 canales.
- Search scale → ILIKE 0, FT 0.5, Meilisearch 1.
- Venue edita campos específicos (D-PRE-11 futuro) → Phase 1.
- Testing coverage expansion (smoke en 0.0, cobertura real desde 0.2).
- Cookies httpOnly + Secure + SameSite=Strict antes de primer cliente externo.
- Rate limiting por IP/user/workspace en `/api/*`, auth-sensitive endpoints y `/api/sentry-tunnel` antes de tráfico público.
- Sentry PII scrub: desactivar `sendDefaultPii`, enmascarar replay y filtrar eventos antes de clientes externos.
- Query scaling: cursor pagination, evitar `count=exact` por defecto, DTOs explícitos y índices por query real.
- Alerting/runbooks: error rate, p95/p99, 5xx, Supabase latency/connections, backup freshness y rollback procedure.
- Audit scaling: mantener triggers síncronos mientras el volumen sea bajo; si write throughput crece, mover audit a pgmq/async batching.
- Private beta gate: ninguna cuenta externa antes de completar Phase 0.9.
- Restore drill: backup automático no cuenta como resuelto hasta probar restauración.
- Admin/support mínimo antes de clientes conocidos: desactivar workspace/user, reenviar invite/reset y ver errores por workspace sin SQL manual.

---

## Estimación total actualizada (honesta)

| Fase | Horas focused | Calendario chunks |
|------|---------------|-------------------|
| 0.0 Fundación (+ PartyServer DO + slug system) | 55-70h | ~13 días |
| 0.1 Plaza + Desk | 28h | ~4-5 días |
| 0.2 Views + Road sheet colab + Calendar | 45h | ~8 días |
| 0.3 Contacts + Money + Room detail | 30h | ~5 días |
| 0.4 Polish + ⌘K + Mobile + GDPR + Notif in-app | 40h | ~7 días |
| 0.9 Private beta hardening / pre-cliente externo gate | 35-55h | ~7-10 días |
| **Total Phase 0 producto** | **~200-215h** | **~38 días en chunks** (3-4 meses) |

Phase 0.5 y Phase 1: abiertos. Phase 0.9 es bloqueante antes de cualquier cliente externo conocido. Phase 0.9 añade ~35-55h antes de clientes externos.

---

## Cómo usar este documento

- Leer al empezar cada sesión de trabajo en Hour.
- Al completar una fase, marcar DoD y añadir fecha de cierre.
- Si aparece una fase nueva, insertar en orden correcto.
- Si un ADR nuevo cambia una fase, actualizar aquí al mismo tiempo.
- Al final de cada fase, reflexión de 10 min: ¿qué tardó más? ¿qué riesgo se materializó?
