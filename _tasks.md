# Tasks

> Creado 2026-07-02 al cierre de la maratón ADR-040→050. Contexto completo:
> `build/roadmap.md § Current next action` + `_notes/sessions-log.md § 2026-07-01/02`.

## Queue
- [ ] Cierre nivel 1a — alta de personas + engagements desde la UI (Contacts). No existe `POST /api/persons` ni `POST /api/engagements` — la difusión no puede capturar un contacto/conversación nueva sin SQL. El hueco #1. INSERT claim-bound esperado → RPCs patrón ADR-043/045/047/049/050.
- [ ] Cierre nivel 1b — delete/cancel de performance. Gigs creados por error no se pueden borrar (lo arrastra ADR-043); soft-delete solo vía RPC (ADR-048). Desbloquea también el self-cleaning del e2e performance-write (hoy acumula `e2e-venue-*`, purga manual documentada en `build/runbooks/test-user-setup.md`).
- [ ] Cierre nivel 1c — edición de venue: address / timezone / contacts. Hoy solo picker + promote (ADR-049); sin timezone la dual-time del road sheet sigue coja.
- [ ] System-completeness gate (0.3): tras el bloque 1a-1c, PARAR de construir y usar Hour con la difusión real ~1 mes. El veredicto es de Marco, no de código.

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
- [x] ADR-040→046 — write paths + 4 lenses (engagement inline, calendar+detail+roadsheet, collab, create/edit performance, Contacts, person detail, Money)
- [x] ADR-047 — road sheet público con links firmados revocables (D6 parcial)
- [x] ADR-048 — misterio RLS soft-delete resuelto → regla: siempre RPC; botón borrar nota
- [x] ADR-049 — venue enlazable (promote + picker + guard)
- [x] ADR-050 — invoice creation desde el fee (IVA/IRPF, lifecycle, discard)
- [x] Incidente seguridad: performance_redacted filtraba a anon — cerrado + test canario
- [x] Purga fixtures e2e (20 gigs) + runbook test-user actualizado
