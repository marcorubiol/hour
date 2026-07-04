# Tasks

> Creado 2026-07-02 al cierre de la maratón ADR-040→050. Contexto completo:
> `build/roadmap.md § Current next action` + `_notes/sessions-log.md § 2026-07-01/02`.

## Queue
- [ ] Rediseño — line detail como composición de módulos (**ADR-056**; ⚠️ era ADR-055, renumerado: 051-055 los tomó el bloque de cierre nivel 1 el 2026-07-04 — confirmar con Marco): migración `engagement.line_id` + `line.modules` + target `'line'` en collab, shell de composición, plantillas Gira + Difusión primero (nuevos pequeños: Road sheets index, Materials registry, People). Resto de plantillas = presets const al activarse. El picker de plantillas sustituye el dropdown de 10 kinds.
- [ ] System-completeness gate (0.3): el bloque 1a-1e YA está (ADR-051→055, producción 2026-07-04); tras los módulos (ADR-056), PARAR de construir y usar Hour con la difusión real ~1 mes. El veredicto es de Marco, no de código.

## Deferred
- [ ] Phase 0.4 polish — mobile completo (Plaza/Calendar/Money), ⌘K, notifications in-app, GDPR export, a11y pass, checkpoint visual 2, ratificación naming @from:2026-08-01
- [ ] Verificar checkboxes viejos de 0.0: app abre offline con datos cacheados, Lighthouse PWA ≥90, strings por `t()`, Axe @from:2026-08-01

## Shelf
- [ ] Project detail tabs Work·Assets·Team·About (único item de 0.3 sin construir) @shelf
- [ ] Facturas multi-línea (varios gigs de una gira) + PDF house-style + auto-numeración por serie @shelf
- [ ] Expiración temporal de share links del road sheet (hoy solo revocación manual) @shelf
- [ ] Autocompletar timezone por city al promover venue @shelf
- [ ] Phase 0.9 hardening gate (~25h) — SOLO si entra un cliente externo @shelf
- [ ] Upstream issue a y-partyserver: workerd entrega frames WS como Blob @shelf

## Trace
- [x] Cierre nivel 1a — alta persona + engagement desde la UI (ADR-051): create_engagement/delete_engagement RPC, POST/DELETE /api/engagements, dialogs Add contact + Add to project
- [x] Cierre nivel 1b — delete de performance (ADR-052): delete_performance RPC (facturas vivas bloquean), confirm en el detalle, e2e self-cleaning
- [x] Cierre nivel 1c — venue editable (ADR-053): PATCH /api/venues/:id, dialog timezone+contacts, display en Production
- [x] Cierre nivel 1d — ICS feed suscribible (ADR-054): calendar_share + RPCs, $lib/ics.ts, /api/public/calendar/:token, dialog Feed
- [x] Cierre nivel 1e — Today "¿qué hago ahora?" (ADR-055): next actions vencidas cross-workspace, stats reales, muere 1-project-per-workspace
- [x] Review adversarial (5 lentes) + verificación ICS/SQL: 9 findings corregidos (incl. HIGH e2e que podía borrar datos reales) · migraciones aplicadas + grants verificados · RLS 30/30 + unit 79/79 + e2e 14/14 contra prod
- [x] ADR-040→046 — write paths + 4 lenses (engagement inline, calendar+detail+roadsheet, collab, create/edit performance, Contacts, person detail, Money)
- [x] ADR-047 — road sheet público con links firmados revocables (D6 parcial)
- [x] ADR-048 — misterio RLS soft-delete resuelto → regla: siempre RPC; botón borrar nota
- [x] ADR-049 — venue enlazable (promote + picker + guard)
- [x] ADR-050 — invoice creation desde el fee (IVA/IRPF, lifecycle, discard)
- [x] Incidente seguridad: performance_redacted filtraba a anon — cerrado + test canario
- [x] Purga fixtures e2e (20 gigs) + runbook test-user actualizado
