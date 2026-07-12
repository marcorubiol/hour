# Tasks

> Actualizado 2026-07-12 al cierre de la sesión ADR-056/058 (line detail = módulos).
> Contexto completo: `_context.md § Status — 2026-07-12` + `_notes/sessions-log.md § 2026-07-12`.

## Dispatch
- [ ] **Desbloquear producción** (el clasificador de auto-mode exige nombrarlo explícito): decirle a .zerø *"aplica las 6 migraciones 2026-07-12 al Supabase hour-phase0 y despliega hour-collab y hour-web"* — o aprobar los prompts fuera de auto mode. Orden: 6 × apply_migration → regen db-types → deploy hour-collab → deploy hour-web @dispatch
- [ ] Re-pasar las 4 lentes de review que cayeron por límite de gasto (sql / api / svelte / tests) cuando se renueve la cuota — solo completó collab @dispatch
- [ ] Tras el deploy: suite completa contra producción (`pnpm test:rls` incl. line-modules nueva, `PW_BASE_URL=… pnpm test:smoke` incl. line-detail.spec) + smoke collab de dos clientes sobre una line @dispatch

## Queue
- [ ] System-completeness gate (0.3): TODO el bloque construido está (ADR-051→058). PARAR de construir y usar Hour con la difusión real ~1 mes. El veredicto es de Marco, no de código.
- [ ] Checkpoint visual del line detail en producción (chips sticky: offsets 3.4rem/6.5rem son estimación — ajustar si bailan; densidad de la pila con la Gira demo y la Difusión real)

## Deferred
- [ ] Phase 0.4 polish — mobile completo (Plaza→pins/Calendar/Money + line detail), ⌘K, notifications in-app, GDPR export, a11y pass, checkpoint visual 2, ratificación naming @from:2026-08-01
- [ ] Verificar checkboxes viejos de 0.0: app abre offline con datos cacheados, Lighthouse PWA ≥90, strings por `t()`, Axe @from:2026-08-01

## Shelf
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
- [x] ADR-056 implementado (2026-07-12, sesión autónoma ultracode): line detail = pila de módulos (7: Calendar, Contacts, Road sheets, Notes, Materials, Money, People) + header stats por kind + anchor chips + Add/Move/Remove module
- [x] Template picker (6 tarjetas fijan kind+modules) + creación restaurada en 3 niveles (line/project/space): dialogs en el layout, entradas en home cards + ⌘K grupo "New" — la creación llevaba huérfana desde ADR-057 (vivía en el Plaza desmontado)
- [x] line_id en los write paths: create_engagement p_line_id (+ resurrect), Line select opcional en Add contact (por-project) y New performance, PATCH whitelists con guard cross-project ADR-043, contexto de line auto-asigna
- [x] Money module con la UI de expenses que no existía (create/delete_expense RPCs) + Materials registry (create/delete_asset_version RPCs) + People contact sheet read-only (/api/lines/:id/people)
- [x] Collab target 'line' (5 uniones + ternario de auth re-keyed + CHECK collab_snapshot) — YNotes en el módulo Notes
- [x] Fix seguridad: GET /api/performances dejaba de filtrar fee por read:money (leak desde ADR-041) — fee columns fuera del select del listado
- [x] Fix: create_line no generaba slug → lines RPC-creadas innavegables (nav slug-addressed); slug + backfill en la migración, página resuelve slug-o-id
- [x] Borrado del mundo sidebar: Plaza (1.883 líneas), PlazaRail, LineList, Sidebar, selection stores, /booking (specs repuntados a Contacts)
- [x] MonthGrid + PerformanceCreateDialog extraídos del calendario (una implementación, reusada por el módulo)
- [x] Tests: unit 100/100 (+21) · RLS viejas 30/30 contra prod · suites nuevas line-modules (RLS) + line-detail (e2e) listas para post-migración · review adversarial 5 lentes
- [x] Reconciliar numeración ADR (2026-07-04 tarde) — 055 Today · 056 line-modules · 057 nav
- [x] Rediseño nav "Adaptive Digest" (ADR-057, 2026-07-04 tarde) + contacto multi-espacio + fix orden @layer CSS
- [x] Cierre nivel 1a-1e (ADR-051→055, 2026-07-04) + review adversarial 9 findings
- [x] ADR-040→050 — write paths + 4 lenses + road sheet público + venue enlazable + invoices (2026-07-01/02)
