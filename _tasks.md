# Tasks

> Actualizado 2026-07-12 (noche) tras la pasada de coherencia visual (ADR-059, 41 fixes aplicados).
> Contexto completo: `_context.md § Status — 2026-07-12` + `_notes/sessions-log.md § 2026-07-12`.

## Queue
- [ ] System-completeness gate (0.3): TODO el bloque construido está (ADR-051→058). PARAR de construir y usar Hour con la difusión real ~1 mes. El veredicto es de Marco, no de código.
- [ ] Deploy de la pasada de coherencia visual (ADR-059): verificada en local (svelte-check 0/0 · unit 100/100 · e2e 15/15 local + collab 2/2 prod), pendiente revisión de Marco en dev + `pnpm run deploy`

## Deferred
- [ ] Phase 0.4 polish — mobile completo (Plaza→pins/Calendar/Money + line detail), ⌘K, notifications in-app, GDPR export, a11y pass, checkpoint visual 2, ratificación naming @from:2026-08-01
- [ ] Verificar checkboxes viejos de 0.0: app abre offline con datos cacheados, Lighthouse PWA ≥90, strings por `t()`, Axe @from:2026-08-01

## Shelf
- [ ] Expenses en la lens global de Money (hoy solo en el módulo de line — desviación aceptada del anti-fragmentación de ADR-056; requiere extender /api/expenses a project/workspace union) @shelf
- [ ] Totales de dinero suman cross-currency sin dimensión (lens y módulo heredan la semántica del lens original) @shelf
- [ ] Alturas de control desiguales en filas de filtros (input 44px vs select 41px vs botón 37px en contacts) — pide un token compartido de padding de control; único hallazgo del audit visual NO aplicado (F33) @shelf
- [ ] Phase 0.9: un rol edit:show puede escribir line.notes por PATCH directo PostgREST mientras el socket colaborativo exige edit:project_meta (la API no expone notes — inconsistencia solo fuera de la app) @shelf
- [ ] Project detail tabs Work·Assets·Team·About — probablemente el MISMO sistema de módulos a nivel project (ADR-056 re-evaluate a) @shelf
- [ ] `delete_line` RPC si algún día hace falta borrar lines (hoy: sin delete path, fixtures estables en tests) @shelf
- [ ] Capability-flag read:money en payloads (masked vs empty distinguibles) cuando haya roles de verdad — Phase 0.9 @shelf
- [ ] `date.line_id` si el uso real pide dates de line sin performance (hoy: join por performance_id) @shelf
- [ ] Relink de engagement a otra line desde la UI en el 409 engagement_exists del módulo Contacts (hoy: toast honesto) @shelf
- [ ] Facturas multi-línea (varios gigs de una gira) + PDF house-style + auto-numeración por serie @shelf
- [ ] Expiración temporal de share links del road sheet (hoy solo revocación manual) @shelf
- [ ] Autocompletar timezone por city al promover venue @shelf
- [ ] Phase 0.9 hardening gate (~25h) — SOLO si entra un cliente externo @shelf
- [ ] Upstream issue a y-partyserver: workerd entrega frames WS como Blob @shelf
- [ ] Purgar persona huérfana de test `019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8` (soft-delete por SQL, no molesta) @shelf

## Trace
- [x] Pasada de coherencia visual COMPLETA (2026-07-12 noche, ADR-059): audit 8 lentes → 42 hallazgos → 41 aplicados / 1 a Shelf (F33). Sistémicos: neutralizado el padding de `<section>` global dentro del shell (~200px de vacíos por página fuera), escala de sombras re-derivada para dark (chips/badges/avatars/toasts ya no brillan blancos), contrato de tonos de StateBadge reactivado (estaba muerto — todos los badges grises), un solo skin de campo (--field-*), --h1 real + mastheads unificados, 2 registros de ancho de página, chips sticky del line detail con --header-height verdadero (3.6rem, ya no estimación), grammar único de empty states, F14 tabla contacts cabe en el módulo (caps cqi). Dedup Shelf graduado: AccentSwatchPicker componente, $lib/money (fmtFee/fmtMoney/invoiceTone), .eyebrow--sub, .link-arrow, .creator, .pill--mono, .table-wrap en base.css. Copy: placeholder engagement honesto, stubs de project con lines reales (F05), jerga de fases/ADR fuera de la UI. Checkpoint visual del line detail: cerrado (offsets true-by-construction + densidad arreglada).
- [x] Review adversarial COMPLETO en re-run (5 lentes, 33 agentes): 20 confirmados / 8 refutados. Aplicados: preset del dialog gana en contextos bloqueados (HIGH — gig en line equivocada al navegar entre lines), invalidaciones line-stats/fees, create_line v3 (reserved-slug "Booking" + cap 57 chars, migración aplicada), 23505→409 en POST /api/lines, materials GET/DELETE alineados, preflight de notes con retry, guards anti-mistarget en engagement-write.spec, finally en la suite RLS. Aceptados y documentados: expenses módulo-only, cross-currency, duplicaciones filosofía (Shelf)
- [x] Producción desbloqueada y completada (2026-07-12, tarde): 6 migraciones aplicadas + verificadas (backfill 154, grants limpios), db-types regenerado, deploys hour-collab → hour-web, suite contra prod unit 100/100 · RLS 38/38 · **e2e 17/17 sin retries**, smoke collab line (snapshot + notes materializadas)
- [x] Roturas destapadas por la suite y arregladas: contact-create.spec (roto desde el dialog multi-espacio del 04-07), money.spec (carrera de paralelismo → fila estable 2031), Menu descartaba label con trigger custom (a11y: botones sin nombre)
- [x] ADR-056 implementado (2026-07-12, sesión autónoma ultracode): line detail = pila de módulos (7: Calendar, Contacts, Road sheets, Notes, Materials, Money, People) + header stats por kind + anchor chips + Add/Move/Remove module
- [x] Template picker (6 tarjetas fijan kind+modules) + creación restaurada en 3 niveles (line/project/space): dialogs en el layout, entradas en home cards + ⌘K grupo "New" — la creación llevaba huérfana desde ADR-057 (vivía en el Plaza desmontado)
- [x] line_id en los write paths: create_engagement p_line_id (+ resurrect), Line select opcional en Add contact (por-project) y New performance, PATCH whitelists con guard cross-project ADR-043, contexto de line auto-asigna
- [x] Money module con la UI de expenses que no existía (create/delete_expense RPCs) + Materials registry (create/delete_asset_version RPCs) + People contact sheet read-only (/api/lines/:id/people)
- [x] Collab target 'line' (5 uniones + ternario de auth re-keyed + CHECK collab_snapshot) — YNotes en el módulo Notes
- [x] Fix seguridad: GET /api/performances dejaba de filtrar fee por read:money (leak desde ADR-041) — fee columns fuera del select del listado
- [x] Fix: create_line no generaba slug → lines RPC-creadas innavegables (nav slug-addressed); slug + backfill en la migración, página resuelve slug-o-id
- [x] Borrado del mundo sidebar: Plaza (1.883 líneas), PlazaRail, LineList, Sidebar, selection stores, /booking (specs repuntados a Contacts)
- [x] MonthGrid + PerformanceCreateDialog extraídos del calendario (una implementación, reusada por el módulo)
- [x] Tests: unit 100/100 (+21) · RLS viejas 30/30 contra prod · suites nuevas line-modules (RLS) + line-detail (e2e) listas para post-migración · review adversarial parcial (lente collab: 2 hallazgos corregidos; las otras 4 pendientes por cuota)
- [x] Reconciliar numeración ADR (2026-07-04 tarde) — 055 Today · 056 line-modules · 057 nav
- [x] Rediseño nav "Adaptive Digest" (ADR-057, 2026-07-04 tarde) + contacto multi-espacio + fix orden @layer CSS
- [x] Cierre nivel 1a-1e (ADR-051→055, 2026-07-04) + review adversarial 9 findings
- [x] ADR-040→050 — write paths + 4 lenses + road sheet público + venue enlazable + invoices (2026-07-01/02)
