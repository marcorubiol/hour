# Tasks

> Actualizado 2026-07-16 tras desplegar Scope v2 y arreglar el registro de deploys (ADR-066).
> Contexto completo: `_context.md § Status — 2026-07-16` + `_notes/sessions-log.md § 2026-07-16`.
> **Antes de fiarte de lo que está desplegado: `curl -s https://hour.zerosense.studio/health/live`.**

## Queue
- [ ] **Verificar ADR-067 en navegador** (todo lo demás hecho y verificado 2026-07-16 noche: migración aplicada vía MCP, Marco es platform_admin, alias en el select, db-types regenerados — svelte-check 0/0, unit 110/110, **RLS 46/46 post-migración**): logo→`/h` digest, `/h/desk|calendar|contacts|money`, `/h/muk-cia/desk`→redirect, pins→`?scope=` en la barra, Copy link, alias request en Edit space → aprobar en Settings.
- [ ] **Desplegar ADR-066 + los tests.** El guard de árbol limpio y el build stamp están commiteados (`314d066`) pero NO en producción — el propio guard lo impide mientras el árbol tenga el rediseño del shell sin commitear. Commitear esos ficheros y `cd apps/web && pnpm run deploy` (collab solo si cambia; hoy no). Al terminar, `/health/live` empieza a devolver su `sha`.
- [ ] **Terminar el rediseño del shell en vuelo** (2026-07-16 noche): 12 ficheros tocados sin commitear — `HomeView`, `breadcrumb`, `h/+layout`, `tokens.css`, `login` y las portadas de engagement/performance/person/project/line/settings. Compila (svelte-check 0/0), pero está a medio: el rail de Scopes se está arrancando.
- [ ] **e2e del nav de Scope v2**: ningún spec cubre el scope-bar, el view-as ni editar espacio. Diferido a propósito hasta que el shell pare de moverse — escribirlo antes es tirar el trabajo.
- [ ] System-completeness gate (0.3): **PARAR de construir y usar Hour con la difusión real ~1 mes.** Abierto desde el 12-07 sin moverse; el veredicto es de Marco, no de código.
- [ ] Regla CF edge de rate-limit en `/api/auth/login` — solo bloquea onboarding externo, no el uso interno. Necesita un token `Zone WAF:Edit` (el OAuth de Wrangler solo tiene `zone:read`). Runbook: `build/runbooks/phase09-launch.md`.

## Deferred
- [ ] Pasada de diseño completa — `build/screens-inventory.md`, todas las pantallas sin marcar; prototipo de referencia en `app design/line-detail-prototype.html`
- [ ] Phase 0.4 polish — mobile completo (pins/Calendar/Money + line detail), notifications in-app, GDPR export, a11y pass, checkpoint visual 2, ratificación naming @from:2026-08-01
- [ ] Verificar checkboxes viejos de 0.0: app abre offline con datos cacheados, Lighthouse PWA ≥90, strings por `t()`, Axe @from:2026-08-01

## Shelf
- [ ] Segundo usuario de fixture con rol limitado — el desbloqueo más barato de la suite RLS: con una sola identidad admin-en-todo no se puede probar "un miembro raso es rechazado" (grants/revokes, redacción de dinero, notas privadas). Ver `build/runbooks/phase09-launch.md` @shelf
- [ ] `chromium-1217` está corrupto en la caché de Playwright (le falta el Framework) — el e2e necesita `PW_CHROMIUM=…/chromium_headless_shell-1228/…`. Reinstalar o fijar el env en un script @shelf
- [ ] Un owner/admin desde PostgREST directo salta las validaciones de `update_workspace` (nombre vacío, y renombrar `slug` sin `previous_slugs` → redirects rotos). No es escalada; solo alcanzable fuera de la app. Misma familia que el item de `line.notes` @shelf
- [ ] ADR-062 diferidos: `logo_url` sin flujo de subida (R2 + CSP img-src); `domain` se guarda y se pinta en el kicker pero no dirige vocabulario ni tipos de project por defecto @shelf
- [ ] Contacts-con-organizaciones: está en el modelo (ADR-065), no en el build — hoy Contacts son personas + engagements @shelf
- [ ] Expenses en la lens global de Money (hoy solo en el módulo de line — desviación aceptada del anti-fragmentación de ADR-056; requiere extender /api/expenses a project/workspace union) @shelf
- [ ] Totales de dinero suman cross-currency sin dimensión (lens y módulo heredan la semántica del lens original) @shelf
- [ ] Alturas de control desiguales en filas de filtros (input 44px vs select 41px vs botón 37px en contacts) — pide un token compartido de padding de control (F33) @shelf
- [ ] Phase 0.9: un rol edit:show puede escribir line.notes por PATCH directo PostgREST mientras el socket colaborativo exige edit:project_meta (la API no expone notes — inconsistencia solo fuera de la app) @shelf
- [ ] Project detail tabs Work·Assets·Team·About — ADR-063 ya resolvió que NO es composición de módulos; queda definir su contenido editable @shelf
- [ ] Capability-flag read:money en payloads (masked vs empty distinguibles) cuando haya roles de verdad — Phase 0.9 @shelf
- [ ] `date.line_id` si el uso real pide dates de line sin performance (hoy: join por performance_id) @shelf
- [ ] Relink de engagement a otra line desde la UI en el 409 engagement_exists del módulo Contacts (hoy: toast honesto) @shelf
- [ ] Facturas multi-línea (varios gigs de una gira) + PDF house-style + auto-numeración por serie @shelf
- [ ] Expiración temporal de share links del road sheet (hoy solo revocación manual) @shelf
- [ ] Autocompletar timezone por city al promover venue @shelf
- [ ] `delete_line` RPC si algún día hace falta borrar lines (hoy: sin delete path, fixtures estables en tests) @shelf
- [ ] Upstream issue a y-partyserver: workerd entrega frames WS como Blob @shelf
- [ ] Purgar persona huérfana de test `019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8` (soft-delete por SQL, no molesta) @shelf

## Trace
- [x] ADR-066 (2026-07-16): provenance de deploys — `wrangler deploy` sube el working tree, no un commit; el 07-14 se desplegó sin commitear y los docs mintieron dos días. Guard de árbol limpio (encadenado con `&&`: pnpm 10 no corre hooks `pre*`, un `predeploy` no se habría disparado nunca) + build stamp servido por `/health/live`. Commit `314d066`
- [x] Scope v2 desplegado a producción (2026-07-16): versión `70775b20`, rollback `34887c61`; smoke HTTP verde; collab NO redesplegado a propósito (su único cambio desde el 07-12 era añadir un script `tsc --noEmit`, cero runtime)
- [x] Corregido el informe de estado: prod llevaba ADR-059/060/061 + ADR-062 + rename Desk vivos **desde el 07-14**, no desde hoy — descubierto sondeando prod (`/health/ready`, cabeceras CSP, 301 `/agenda`→`/desk`), no leyendo docs
- [x] e2e 19/19 en 13 s contra prod (venía de 15/3 en 2.2 min): la suite se comía su propio rate-limit con 14 logins desde una IP (`LOGIN_RULE` 10/5min) → `tests/auth.setup.ts` + `storageState` compartido = 1 login. Serializar NO lo habría arreglado (14 secuenciales siguen pasándose de 10 en 5 min). Commit `f5f31a9`
- [x] Dos tests que pasaban sin probar nada: `line-detail:135` añadía *People* pero asertaba/borraba `#mod-contacts` (verde por accidente desde ADR-056); el contexto "anónimo" de `roadsheet-share` llevaba sesión desde el refactor — `browser.newContext()` **hereda** el `storageState` del proyecto
- [x] Falsa alarma de seguridad descartada con curl crudo: el upgrade WS sin sesión devuelve **401**; el `open` venía de un contexto de test que yo creía limpio y venía autenticado
- [x] RLS 46/46 (+8): `tests/rls/update-workspace.test.ts` cubre el gate de ADR-062, sin cobertura desde que entró en prod el 07-14. Cazó que el docblock de la migración mentía ("workspace.UPDATE stays denied by RLS" — no lo está: la policy `workspace_update` lo permite a owner/admin con la misma condición). Header corregido, SQL intacto. Commit `d5c5167`
- [x] `/scope-v2` fuera de producción (servía mock data en vivo desde el deploy de esta noche); recuperable de `358155c`
- [x] Docblocks Agenda→Desk en `DeskBoard` + ruta `/desk` (el copy visible ya estaba bien). El `queryKey ['engagements','today']` se deja: está compartido con `HomeView`, renombrarlo en un solo sitio rompería el caché compartido en silencio
- [x] Pendiente de ADR-065 comprobado: 0 líneas con la key muerta `people` (de las 6 visibles al usuario de test; la de `demo` queda fuera de su RLS)
- [x] Home projects-first (2026-07-12 noche 2, ADR-060) — **nota**: la parrilla ya no vive en el home; con Scope v2 el home ES el Desk y la parrilla está en la portada de espacio
- [x] Pasada de coherencia visual COMPLETA (2026-07-12 noche, ADR-059): 42 hallazgos → 41 aplicados / 1 a Shelf (F33)
- [x] ADR-056 implementado (2026-07-12): line detail = composición de módulos (7) + header stats + anchor chips + Add/Move/Remove
- [x] ADR-040→050 — write paths + 4 lenses + road sheet público + venue enlazable + invoices (2026-07-01/02)
