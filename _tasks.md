# Tasks

> Actualizado 2026-07-17 — **verificado contra código + prod en vivo, no contra docs.**
> Prod SANO en `d85ed0d` (dirty:false, build 12:09): rename engagement→conversation, task entity, hall, ADR-066/067/077 **desplegados y comprobados por sonda** (`/api/conversations` 401 · `/api/engagements` 404 · `/api/tasks` 401). Suites: svelte-check 0/0 (1511 files) · unit 178/178 (reconfirmadas hoy) · RLS 66 · e2e 22 (build del rename).
> **EN CURSO** (sesión paralela): rebuild de **Desk v2** — aún NO ha aterrizado en este checkout (árbol limpio en `d85ed0d`).
> Antes de fiarte de lo desplegado: `curl -s https://hour.zerosense.studio/health/live`.
> Contexto: `_context.md` (root + build) + `_decisions.md § ADR-069→077`.

## Queue

### La pasada diseño+datos (columna vertebral)
- [ ] **Pasada diseño+datos, página a página** — por cada pantalla: diseño visual + spec normativa de qué datos lleva (la parte importante), anclada a `build/schema.sql` + `build/structure-model.md`. Diseño en `build/screens-inventory.md`, datos en `build/screen-data-spec.md`. Prototipo de referencia: `app design/line-detail-prototype.html`
  - [x] .zerø: propuesta en frío de `build/screen-data-spec.md` — todas las superficies, campo a campo. HECHO 2026-07-17
  - [x] Revisión conjunta 1 — LAS VISTAS: hall (`/h`), Desk, Calendar, Conversations, Money. HECHA 2026-07-17 → ADR-069/070/072/073/074 + prompts despachados. La portada de space se movió al pack de contenedores (decisión Marco)
  - [ ] Revisión conjunta 2 — LOS CONTENEDORES (pack completo): portada de space + project detail + line detail + los 7 módulos de line. Aquí nacen gap #1 (organizaciones) y gap #3 (identidad fiscal — la facturación llega rápido)
  - [ ] Revisión conjunta 3 — LAS FICHAS: performance + road sheet (interno y público) + conversation (+ gap #2 log de conversación) + person + settings
  - [ ] Revisión conjunta 4 — diálogos (campo a campo) + transversales (estados vacío/carga/error/offline, mobile, light+dark)
  - [ ] Consolidar los gaps aceptados en tareas de build/migración (nuevas entradas en Queue cuando toque)

### Builds de las lentes v2 (despachados en S1 — ESTADO REAL verificado 2026-07-17)
- [ ] **Desk v2 — EN CURSO** (sesión paralela, aún fuera de este checkout). **DISEÑO CONVERGIDO 2026-07-18**: contrato final en `desk-prompt.md § Converged design` (VINCULANTE — gutter-marginalia navegable, orden fijo, filas sin marcas, pulso, modo calma, sin contadores, headline solo-fechado) + mockups finales de Marco como referencia visual canónica. El builder en vuelo debe releer esa sección antes de aterrizar. En el árbol hoy = v1 (2 de 4 fuentes en secciones separadas). Modelo de tareas VIVO (ADR-071). La decisión abierta de `h/desk/+page.svelte` L14-17 queda respondida: la sección v1 de tasks SE DISUELVE en el feed mixto (spec § Desk)
- [ ] **Calendar v2 — despachado, 0 código** (ADR-072 + ADR-076). Sin migración: no existe `availability_block`, `conflictsFor()`, date en cascada ni la "Migration C" del gap #8 (user↔person). Orden: `build/calendar-model-prompt.md` (migración + APIs, PRIMERO) → `build/calendar-prompt.md` (UI: toggle month|list, gramática de holds outline/solid, menú "+" Performance|Date) → `build/calendar-design-prompt.md`. La UI viva sigue siendo la de Phase 0.2 (month grid + pins + diálogo ICS)
- [ ] **Conversations v1.5 — despachado, 0 código** (ADR-073). Ninguna de las 4 tareas aterrizó: no hay columna "Last contact", ni write path `last_contacted_at`/"Contacted today", ni toggle "By conversation | By contact". `last_contacted_at` existe en el schema v2 pero nadie lo lee/escribe. **OJO:** el commit `1eb7a96` "contact capture feature" era EN REALIDAD el rename (solo mueve ficheros, 0 lógica) — no confundir con la feature. Prompts: `build/contacts-prompt.md` (UI) + `build/contacts-design-prompt.md`. Orgs + log (gaps #1/#2) → model-prompt tras S2
- [ ] **Money v2 — despachado, 0 código** (ADR-074). Sin migración: no existe `expected_on`/`payment_condition` en invoice, ni `/api/payments`, ni `observedPayerTermsDays`/`agingState` en `$lib/money.ts`. Preexisten en schema sin UI: tabla `payment` + `invoice.payer_person_id`. Orden: `build/money-model-prompt.md` (migración + APIs, PRIMERO) → `build/money-prompt.md` (UI de pagos, paid derivado, aging, condición→tarea) → `build/money-design-prompt.md`. La UI viva sigue siendo la de Phase 0.3 (facturas draft→issued→paid)
- [ ] **Modo calma (toggle global, toda la app)** — SOLO DISEÑO, sin código (Marco diseñando la UI del toggle). Dos modos, **calma** y **abierto**: calma limpia la superficie (Desk = solo hoy + vencido; cada superficie define qué esconde). Pendiente: alcance por superficie, persistencia (candidata `user_profile`), si calma es default al aterrizar. Cuando la UI esté → ADR + prompt. (No confundir con el estado `calm` de la frase del hall, que ya existe en `hall-status.ts`)
- [ ] **Timezones de bolos extranjeros — BUG VIVO.** Display OK (`datetime.ts` `dualTime`, tz de venue cableada en hall + `ScheduleTable`). Falta el FIX DE ENTRADA: `PerformanceCreateDialog` (y la entrada de schedule) interpretan la hora tecleada en `viewerTz` del navegador → un bolo de Londres tecleado desde Barcelona = 1h mal en silencio. Fixes: entrada en tz del venue con etiqueta, fallback `workspace.timezone` visible. Prompt de build entregado en chat 2026-07-18, sin ejecutar

### Verificación / cierre pendiente
- [ ] **Verificar ADR-067 en navegador** (todo lo demás verificado: migración aplicada, Marco platform_admin, alias en el select, db-types regenerados, suites verdes): logo→`/h`, `/h/desk|calendar|conversations|money`, `/h/muk-cia/desk`→redirect, pins→`?scope=` en la barra, Copy link, alias request en Edit space → aprobar en Settings
- [ ] **e2e del nav de Scope v2** — empezado (`tests/scope-url.spec.ts`, 3 flujos, regresión del bug replaceState/page.url). Falta: view-as, scope-bar (save/update/delete), editar espacio + alias. Diferido hasta que el shell pare de moverse
- [ ] **System-completeness gate (0.3): PARAR de construir y usar Hour con la difusión real ~1 mes.** Abierto desde el 12-07 sin moverse; el veredicto es de Marco, no de código
- [ ] Regla CF edge de rate-limit en `/api/auth/login` — solo bloquea onboarding externo, no el uso interno. Necesita un token `Zone WAF:Edit` (el OAuth de Wrangler solo tiene `zone:read`). Runbook: `build/runbooks/phase09-launch.md`

## Deferred
- [ ] Phase 0.4 polish — mobile completo (pins/Calendar/Money + line detail), notifications in-app, GDPR export, a11y pass, checkpoint visual 2 (incluye ratificar el shell rediseñado), ratificación naming @from:2026-08-01
- [ ] Verificar checkboxes viejos de 0.0: app abre offline con datos cacheados, Lighthouse PWA ≥90, strings por `t()`, Axe @from:2026-08-01

## Shelf
- [ ] Tareas huérfanas cuando su padre (conversation/performance/line) se soft-borra: quedan sin contexto en el Desk (embed null). Aceptado en v1 (ADR-071) — si molesta en uso real, cascada de soft-delete en los delete_* de los padres @shelf
- [ ] Promover a base.css los tratamientos compartidos TaskBoard/DeskBoard (more-pill, empty-state, divisor de fila) — pospuesto para no tocar base.css con la pasada visual del shell en vuelo (ADR-071) @shelf
- [ ] Segundo usuario de fixture con rol limitado — el desbloqueo más barato de la suite RLS: con una sola identidad admin-en-todo no se puede probar "un miembro raso es rechazado" (grants/revokes, redacción de dinero, notas privadas). Ver `build/runbooks/phase09-launch.md` @shelf
- [ ] Chromium-1217: RESUELTO por env pin 2026-07-17 — `apps/web/.env.test.local` (gitignored, sin secretos) fija `PW_CHROMIUM` al headless-shell-1228 y `playwright.config.ts` lo carga tras `.env.test`; e2e corre sin overrides inline. Reinstalar NO funciona en esta máquina. Queda solo: borrar `.env.test.local` cuando un bump de @playwright/test mueva el pin más allá de 1217 @shelf
- [ ] Un owner/admin desde PostgREST directo salta las validaciones de `update_workspace` (nombre vacío, y renombrar `slug` sin `previous_slugs` → redirects rotos). No es escalada; solo alcanzable fuera de la app. Misma familia que el item de `line.notes` @shelf
- [ ] ADR-062 diferidos: `logo_url` sin flujo de subida (R2 + CSP img-src); `domain` se guarda y se pinta en el kicker pero no dirige vocabulario ni tipos de project por defecto @shelf
- [ ] Contacts-con-organizaciones: está en el modelo (ADR-065/073), no en el build — hoy la lente Conversations lleva personas + conversations @shelf
- [ ] Expenses en la lens global de Money (hoy solo en el módulo de line — desviación aceptada del anti-fragmentación de ADR-056; requiere extender /api/expenses a project/workspace union — sub-punto sin confirmar del money-model) @shelf
- [ ] Totales de dinero suman cross-currency sin dimensión (lens y módulo heredan la semántica del lens original) @shelf
- [ ] Alturas de control desiguales en filas de filtros (input 44px vs select 41px vs botón 37px en conversations) — pide un token compartido de padding de control (F33) @shelf
- [ ] Phase 0.9: un rol edit:performance puede escribir line.notes por PATCH directo PostgREST mientras el socket colaborativo exige edit:project_meta (la API no expone notes — inconsistencia solo fuera de la app) @shelf
- [ ] Project detail tabs Work·Assets·Team·About — ADR-063 ya resolvió que NO es composición de módulos; queda definir su contenido editable @shelf
- [ ] Capability-flag read:money en payloads (masked vs empty distinguibles) cuando haya roles de verdad — Phase 0.9 @shelf
- [ ] `date.line_id` si el uso real pide dates de line sin performance (hoy: join por performance_id) @shelf
- [ ] Relink de conversation a otra line desde la UI en el 409 conversation_exists del módulo Conversations (hoy: toast honesto) @shelf
- [ ] Facturas multi-línea (varios gigs de una gira) + PDF house-style + auto-numeración por serie @shelf
- [ ] Expiración temporal de share links del road sheet (hoy solo revocación manual) @shelf
- [ ] Autocompletar timezone por city al promover venue @shelf
- [ ] `delete_line` RPC si algún día hace falta borrar lines (hoy: sin delete path, fixtures estables en tests) @shelf
- [ ] Upstream issue a y-partyserver: workerd entrega frames WS como Blob @shelf
- [ ] Purgar persona huérfana de test `019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8` (soft-delete por SQL, no molesta) @shelf

## Trace
- [x] Rename engagement→conversation (ADR-075) COMPLETO y desplegado (2026-07-17): migración `2026-07-17_rename_engagement_to_conversation.sql` aplicada (enum `conversation_status`, RPCs `create/delete_conversation`, rutas `/api/conversations` + `/h/[workspace]/conversation/[slug]`), 0 residuo de `engagement` en `apps/`. Prod verificado en vivo: `/api/conversations` 401 · `/api/engagements` 404. Suites: check 0/0 · unit 178 · RLS 66 · e2e 22. Cerró de paso `edit:show`→`edit:performance`
- [x] ADR-077 (2026-07-17): saldada la deuda muerta de `show` en DB (dropea `guard_show_fee_columns()`, renombra la constraint `asset_version_inbound_has_show`) + espejo de slugs reservados sincronizado DB↔cliente (`is_reserved_slug()` = `RESERVED_WORKSPACE_SLUGS`, 64=64). Migración `2026-07-17_close_adr036_show_debt.sql`. Lección: un rename de tabla/columna en Postgres arregla los cuerpos (attnum) y abandona los nombres (constraints, funciones, triggers, vistas)
- [x] ADR-066 DESPLEGADO (2026-07-17): guard de árbol limpio + build stamp servido por `/health/live` — prod devuelve su `sha` (`d85ed0d`, dirty:false). Cierra el drift de provenance del 07-14 (supersede la entrada previa "commiteado pero no en prod")
- [x] Rediseño del shell estabilizado (2026-07-17): `ScopeStrip` eliminado (commit `efbc03f`), árbol commiteado y desplegado; el rail de Scopes dejó de "arrancarse". Ratificación visual → checkpoint 2 en Deferred
- [x] Hall — frase de estado (ADR-068/069) construida y viva (2026-07-17): `hall-status.ts` — `computeHallStatus()` pura con 3 estados (show/attention/calm) + `hallSentence()` i18n + `hall-status.test.ts`, consumida en `/h/+page.svelte`. Pendiente solo el 4º estado IA `proposal` (futuro intencional, nunca se emite aún)
- [x] Task entity (D3) + modelo ADR-070 construidos y en vivo (2026-07-17, sesión paralela): 2 migraciones, `/api/tasks`, `taskSurfaceState()`, módulo Tasks + feed en Desk; review adversarial 14 hallazgos aplicados. ADR-071. `task-model-prompt.md` EJECUTADO — no re-lanzar; `desk-prompt.md` sigue en curso
- [x] Scope v2 desplegado a producción (2026-07-16): versión `70775b20`, rollback `34887c61`; smoke HTTP verde; collab NO redesplegado a propósito
- [x] Corregido el informe de estado (2026-07-16): prod llevaba ADR-059/060/061 + ADR-062 + rename Desk vivos desde el 07-14, no desde ese día — descubierto sondeando prod, no leyendo docs
- [x] e2e 19/19 en 13 s contra prod (venía de 15/3 en 2.2 min): la suite se comía su propio rate-limit con 14 logins desde una IP → `tests/auth.setup.ts` + `storageState` compartido = 1 login. Commit `f5f31a9`
- [x] Dos tests que pasaban sin probar nada: `line-detail:135` asertaba `#mod-contacts` (verde por accidente desde ADR-056); el contexto "anónimo" de `roadsheet-share` heredaba sesión del `storageState` del proyecto
- [x] RLS 46/46 (+8): `tests/rls/update-workspace.test.ts` cubre el gate de ADR-062; cazó que el docblock de la migración mentía sobre `workspace.UPDATE`. Commit `d5c5167`
- [x] Pasada de coherencia visual COMPLETA (2026-07-12 noche, ADR-059): 42 hallazgos → 41 aplicados / 1 a Shelf (F33)
- [x] ADR-056 implementado (2026-07-12): line detail = composición de módulos (7) + header stats + anchor chips + Add/Move/Remove
- [x] ADR-040→050 — write paths + 4 lenses + road sheet público + venue enlazable + invoices (2026-07-01/02)
