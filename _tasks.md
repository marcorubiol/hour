# Hour — cola vigente

> **ÚNICA COLA ACTIVA.** Última reconciliación: 2026-07-20.
> Estado general y evidencia: `_context.md`. Historia: `_decisions.md` y
> `_notes/sessions-log.md`. Los documentos de `build/archive/` no crean tareas.

## Cerrado — bloque 2: permisos y entrada a beta

4. [x] **Matriz RBAC completa.** Owner/admin/member/performer/guest/external
   cubiertos por RLS 118/118. Lectura y edición de performance están separadas;
   la revocación invalida el JWT previo y reautoriza/cierra sockets collab.

5. [x] **Onboarding y administración sin SQL.** Invitación hasheada y caduca,
   aceptación por email verificado, rol/proyecto explícitos, ledger de acceso y
   revocación inmediata están disponibles en Settings.

6. [x] **Identidad completamente externa de fixture.** `external@hour.test`
   prueba cero acceso → invitación/aceptación → acceso → revocación con el mismo
   JWT, sin depender del admin ni de `limited@hour.test`.

7. [x] **Rate-limit Cloudflare en `/api/auth/login`.** Binding nativo de Workers
   10/min/IP para ráfagas + ventana KV independiente 10/5 min/IP. La única regla
   WAF Free sigue protegiendo `wp-login.php` (slot 1/1), sin sustituirla.

8. [x] **Verificación manual del flujo de alias y navegación ADR-067.** Hall,
   LensSwitcher, pins, copy-link, solicitud/aprobación y canonicalización del
   alias, y redirects legacy verificados. La revisión descubrió y corrigió el
   scope ausente en Conversations y la copia denegada en browsers embebidos;
   ambos quedan automatizados.

## Cerrado — bloque 3: Conversations v1.5

10. [x] **Conversations v1.5.** Last contact visible, write path “contacted
    today”, vista por conversación/persona y contrato de `conversation_event`.
    Runtime `ad1b580`; migración de timestamps aplicada, baseline staging desde
    cero verde, RLS 118/118 y E2E de producción verificado. El contrato del event
    log queda congelado sin anticipar la tabla/timeline fuera de alcance.

## Decisiones con coste o autoridad externa

9. [ ] **Supabase leaked-password protection (HIBP).** El proyecto está en plan
   Free y la función requiere Pro. Marco debe decidir el upgrade; después activar
   `password_hibp_enabled` y volver a ejecutar el advisor.

## Cerrado — bloque 4: Money v2

11. [x] **Money v2.** `expected_on`, condición de pago, pagos observados,
    aging y estado paid derivado; payer, gastos union-scoped, neto por línea,
    VAT/IRPF y totales separados por moneda. Runtime `3b7c95e`, baseline
    staging desde cero verde, RLS 120/120 y E2E de producción completo.

## Cerrado — bloque 6: planner + identidad

> 29 commits de código rescatados de `feat/comms-threads`, donde estaban
> atrapados detrás de un bloqueo que no era suyo. **Las migraciones NO se
> re-aplicaron**: las cinco de ADR-084 y la de ADR-081 ya estaban vivas en
> producción y absorbidas en el checkpoint de `main`. Esto invirtió el riesgo
> habitual — aquí la base de datos iba **por delante** del código, no al revés.

14. [x] **Planner multi-día + identidad monograma, desplegado.** Monograma +
    paleta 12 (ADR-081), bloques multi-día por serie, ticks de readiness,
    `booking_mode` (ADR-002/084), `/api/dates/series`, `/api/projects/[id]`.
    Runtime `4499848`, `dirty:false`. Gates: check 0/0 · unit 348 · build ·
    RLS 120/120 · **E2E contra producción 27/27 sin skips**.

## Cerrado — bloque 7: money v3 (ADR-086/087/088), DESPLEGADO

> **DESPLEGADO EN PRODUCCIÓN 2026-07-23.** Reconciliado con Git/Actions/`/health`
> el 2026-07-23 (regla #3: no fiarse de una frase fechada). Gate completo, en
> orden, todo verde:
> - Backup a R2: run [30010780853](https://github.com/marcorubiol/hour/actions/runs/30010780853), 13:20Z.
> - Staging baseline (migraciones + RLS + smoke): run [30012286297](https://github.com/marcorubiol/hour/actions/runs/30012286297), 13:41Z.
> - Prod migrate **plan**: run [30013059054](https://github.com/marcorubiol/hour/actions/runs/30013059054), 13:51Z (Apply skipped).
> - Prod migrate **apply** + verify remote history: run [30013141085](https://github.com/marcorubiol/hour/actions/runs/30013141085), 13:52Z.
> - Worker deploy: `/health/live` = **`a35e8c4`**, `dirty:false`, builtAt 14:27Z;
>   `/health/ready` → `supabase: ok`.
>
> Runtime de prod = `a35e8c4`, encima de toda la pila money v3 (bolo, ADR-087,
> ADR-088/Books, fiscal, invoice, payment). `origin/main` contiene el stack
> entero. La rama `feat/money-v3-build` va 2 commits por delante de `origin/main`
> (`c4f2e3a` estilo MonthGrid + `21da2be` i18n — de Travel v2, no de money v3);
> `origin/main` (tip `f9eb324`, candidate polling) va 1 commit por delante de prod.
>
> Cerrado en grill 2026-07-21. Estructura completa + delta de schema:
> `_notes/spec-money-v3-decisions.md`. Decisión: `_decisions.md § ADR-086`.
> En una frase: el dinero deja de girar alrededor de la factura — el fee del bolo
> es el ancla, cobrar y facturar son hechos independientes; tamaño A (libro de
> entrada/salida) ahora, B-ready.
>
> **Follow-up abierto (no bloquea nada):** la UX de **enlazar una función nueva a
> un bolo** — las performances creadas en Planner nacen sin bolo hasta que exista
> esa UI. La lente Money vive de los bolos del backfill + los creados a mano.
>
> **Follow-up abierto (2026-07-24, no bloquea):** portar la cobertura E2E de
> **invoice/payments a los diálogos v3**. El spec v2 (`money.spec.ts`, tbody +
> "VAT %" + pagos anclados a factura) quedó obsoleto con la reescritura ADR-087
> y se sustituyó por el roundtrip de fee (set → roll de la obra → reload →
> clear, autolimpiante). El ciclo profundo — crear invoice/proforma v3 con tax
> lines, numeración, pagos desacoplados, aging/paid derivado — no tiene E2E.
>
> **BUG DIAGNOSTICADO Y ARREGLADO (2026-07-24, sin desplegar aún): `/h/money`
> se quedaba en «Loading…» para siempre.** No era una race del `enabled`/
> queryKey ni de la construcción reactiva — era la **optimización de
> tracked-props de TanStack Query**. `QueryObserver.shouldNotifyListeners`
> solo notifica cuando cambia una prop que el consumidor **leyó** (rastreada).
> En `/h/money`, `invoices`/`expenses`.data se leen **solo dentro de
> `for (const b of bolos)`** (totales, `invoicesByBolo`), así que mientras
> `bolos` carga nadie lee su `.data`/`.isLoading`; lo único que los toca es
> `errorMsg` (`.error`) — y `loading = bolos.isLoading || invoices.isLoading
> || …` **cortocircuita** con `||`, sin llegar a leer `.isLoading` de los
> hermanos. Resultado: su único tracked-prop es `error`. Si invoices/expenses
> resolvían **antes o a la vez** que bolos, cambiaban status/isLoading/data
> pero **no error** → notificación suprimida → el store de Svelte se
> **congelaba en `{isLoading:true, data:undefined}`** para siempre, y nada lo
> recalculaba (las opciones ya no re-emitían). Los totales pintaban porque
> derivan de `bolos` (sí resuelto). No determinista = **orden de resolución de
> los 3 fetches**, no el flap del scope.
>
> **Reproducido de forma determinista** a nivel query-core (scratchpad
> `repro.mjs`/`repro2.mjs`): con solo `.error` rastreada, la resolución NO
> notifica y el store queda en `isLoading:true`; con `notifyOnChangeProps:
> 'all'` notifica y llega a `isLoading:false`. Verificado por la ruta exacta
> del fix (default del `QueryClient`).
>
> **Fix (un dueño):** `notifyOnChangeProps: 'all'` como default global en el
> `QueryClient` de `apps/web/src/routes/+layout.svelte`. Mata la clase entera
> —  no solo money: `planner` (`planner-feeds.svelte.ts`, mismo patrón,
> flagueado), `desk` (`isPending ||` sobre 4 queries) y project/line eran
> gemelos latentes cuya seguridad era **incidental** (dependía del gating del
> template — justo lo que rompió el split del layout). Coste despreciable:
> queries a nivel lente/página, no per-row; el equality-check de Svelte
> absorbe notificaciones redundantes. Comentario largo en el sitio.
>
> **Verificación:** `svelte-check` 0/0 (1832), unit **368/368**, build de
> prod verde. Repro determinista PASS. **E2E guardián no corrido en local**:
> el login compartido (`playwright@hour.test`) devuelve «Invalid credentials»
> contra la Supabase del dev server — problema de fixture/harness, ajeno al
> fix; correr `money.spec.ts` (el guardián, que espera `section.obra`, solo
> visible con `loading===false`) contra un entorno desplegado tras el deploy.
> **Falta desplegar** (solo frontend, cero schema).

**DISEÑO — hecho e implementado en código** (Marco lo diseñó en frío en Claude
Design; realizado como componentes *presentational*, sin schema, en rutas dev):
- [x] **House-style del PDF de factura/proforma** → `InvoiceDocument.svelte` +
  `invoice.ts`; preview en `/dev/invoice` (factura/proforma · draft/issued/paid ·
  una función/gira; light/dark/print).
- [x] **Formularios de `fiscal_identity`** — emisor (cuenta) y receptor
  (workspace); dirección estructurada (`address_line_1/2` + postal/city/region/
  country) → `FiscalIdentityDialog.svelte` + `fiscal.ts`; ajustes en
  `/dev/facturacio` (modo off/interno/legal, wiring cuenta↔override, toggle
  "solo nombre" del receptor). El autocompletado de dirección sigue siendo API
  externa, después.
- [x] **UI de Money** — pago desacoplado, fee como ancla, "cobrado" derivado
  contra el fee → `RecordPaymentDialog` + `AddExpenseDialog` + `moneybook.ts`;
  lente en `/dev/money` (documentos opcionales por modo; libro limpio en `off`).

> Verificado 2026-07-22: `svelte-check` 0/0; renderizado en los tres estados +
> diálogos, light/dark. **Presentational: cero schema, cero fetch, cero RLS** —
> alimentado por datos de ejemplo vía contrato tipado, listo para que el BUILD lo
> conecte sin reescritura. Parts A+B viven en `main` (commit `c7a9bfd`); Part C
> en `feat/money-v3-design`.

**BUILD — hecho, verificado y DESPLEGADO** (rama `feat/money-v3-build`, **5
migraciones aditivas**; aplicado a prod 2026-07-23, ver stamp arriba). Todo espina aditiva y
**no-breaking**: la Money v2 viva (UI, RPCs, triggers de cobro-vs-factura) sigue
funcionando; los RPCs crecen solo con params opcionales al final (PostgREST
named-arg). La "inversión" a cobrado-vs-fee se **añade** (nueva derivación en
`list_money_performances`) junto a la de v2; la lente v2 se reescribe en el
apartado siguiente (wire de la UI).
- [x] Tabla `fiscal_identity` (dueño blando `account_id`|`workspace_id`, `kind`,
  dirección, banca/defaults solo emisor) + `account.default_fiscal_identity_id` +
  `workspace.fiscal_identity_id`. FORCE RLS, triggers updated_at/audit.
- [x] `invoice`: `doc_type` factura|proforma, snapshot emisor+receptor congelado,
  serie de numeración auto-correlativa atómica al emitir (`issue_invoice` +
  `next_invoice_number`, número inmutable); `create_invoice` v3.
- [x] `payment`: `invoice_id` nullable + ancla gig/línia/projecte + contraparte +
  categoría; `create_payment`/`delete_payment` v3; **cobrado derivado
  pagos-vs-fee** en `list_money_performances`; políticas RLS reescritas
  (autorización por-adjunto, AND no OR).
- [x] `expense`: + contraparte nullable; `create_expense` v3.
- [x] `workspace.settings.invoicing_mode` ∈ {off, interno, legal} + write-path
  (`update_workspace`, con override `fiscal_identity_id`).

> Verificado 2026-07-23 en Supabase **local** (Docker + fixtures de staging):
> 5 migraciones aplican limpias, `db diff` sin drift, `svelte-check` 0/0, unit
> **348/348**, RLS **126/126** (120 de v2 intactas + 6 nuevas de v3). Review
> adversarial de las migraciones (4 lentes + verify): 11 hallazgos confirmados,
> **todos corregidos** (incl. una escalada RLS en las políticas de payment).
> **Pendiente y gateado (fuera de este apartado):** aplicar a staging/prod con
> backup/preflight + OK de deploy (reglas #8/#9), y el **wire de la UI** de
> `/h/money` al modelo v3 (que completa la inversión de la derivación).
>
> **REABIERTO 2026-07-23 — ADR-087.** El grill al wire-ar la lente destapó que el
> ancla del dinero está un nivel demasiado bajo: la unidad de dinero es el
> **bolo** (trato con una sala, 1..N funciones), no el `performance`. Antes de
> desplegar money v3 hay que **re-anclarlo al bolo** (plan P2). Menos mal que
> está en rama sin desplegar. Prompt de build:
> `_notes/build-prompt-bolo-money-v3.md`. **No desplegar el ancla-por-función.**

**RE-ANCLA AL BOLO — hecho, verificado y DESPLEGADO** (ADR-087, plan P2; rama
`feat/money-v3-build`; aplicado a prod 2026-07-23, ver stamp arriba). El dinero sube del `performance` al
nuevo `bolo` (trato = una sala · caché · documento · cobrado · pendiente; agrupa
1..N funciones). Se **revisaron** las 5 migraciones de money v3, no se apiló una
capa encima.
- [x] Entidad `bolo` (FORCE RLS por `read:money`; escritura solo por RPC
  SECURITY DEFINER: `create_bolo`/`update_bolo_fee`/`delete_bolo`) +
  `performance.bolo_id` + backfill 1 bolo N=1 por performance (CTE MATERIALIZED,
  validado contra datos multi-fila con nulls y soft-delete).
- [x] Caché fuera del `performance` (drop columnas + retiro de la vista
  `performance_redacted`, el trigger `guard_performance_fee_columns`,
  `update_performance_fee` y `list_money_performances`).
- [x] `invoice_line`, `payment` (ancla) y el gasto de gig → `bolo_id` (rename +
  remap + FK + RLS + helpers); `create_invoice_from_bolo`, `create_payment`(bolo),
  `create_expense`(bolo|línia), `list_money_bolos` (cobrado = pagos-vs-caché-del
  -bolo, `function_count`, próxima fecha).
- [x] **Decisión:** el gasto de gig sube al **bolo** (E3), no se queda en la
  función — ninguna superficie de scheduling lee gastos por-función; income y
  coste cuelgan del bolo/línia (asimetría deliberada: el caché es del trato).
- [x] UI `/h/money` reescrita al layout ADR-087 (posición general con
  **pendiente** → bolos **por obra** con contratado/cobrado/pendiente → documento
  en el bolo (chip) → funciones como sub-detalle; venue-first) + botón **New
  deal** (crea bolo a mano). `MoneyModule` y el resumen de la línia re-apuntados.
- [x] Tests RLS al modelo bolo (las de caché/masking de v2 adaptadas) + 1
  regresión de escalada (`create_payment` invoice+ancla rechazado).

> Verificado 2026-07-23 en Supabase **local**: 6 migraciones aplican limpias,
> `db diff` sin drift, `svelte-check` 0/0, unit **357/357**, RLS **127/127**,
> `pnpm build` verde. Review adversarial del re-ancla (4 lentes + verify): **9
> hallazgos confirmados, todos corregidos** — incl. una **escalada RLS real** en
> `create_payment` (la rama invoice escribía anclas caller-supplied sin gate
> `edit:money`; el RPC SECURITY DEFINER saltaba la RLS por-adjunto). **Deploy a
> staging/prod: HECHO** el 2026-07-23 con backup/preflight (reglas #8/#9), ver
> stamp arriba. **Sigue abierta** solo la UX de **enlazar una función nueva a un
> bolo** — las performances creadas en Planner quedan sin bolo hasta que exista
> esa UI (follow-up; no bloquea nada, la lente Money vive de los bolos del
> backfill + los creados a mano).

**NO construir** (forward-compat, ver spec § Futuro): tabla `payable` (dinero a
artistas), P&L, `fiscal_identity` compartible entre empresas, entidad
`organization`. El dueño-blando + el snapshot ya dejan abierto el enlace fiscal
entre empresas sin construirlo.

## Después de money v3 — planner, lo que quedó pendiente

15. [ ] **Editar una fecha desde la UI — NO EXISTE.** `PATCH /api/dates/[id]` y
    `DatePatchSchema` están construidos, pero **ningún componente los usa** y el
    chip de fecha del mes es un `<span>`, no un enlace: ensayos, prensa,
    residencias, días off y viajes nunca se han podido abrir, editar ni borrar.
    No es deuda del multi-día — este solo lo hizo evidente, porque crear 25
    fechas de golpe hace que la falta duela.

16. [ ] **Multi-día para PERFORMANCES.** Hoy `performance.performed_at` es un
    solo día. Es simétrico a lo que ya existe para `date`: `performance.series_id`
    + índice, RPC `create_performance_series` atómica calcada de
    `create_date_series` (mismo gate `edit:performance`, conversión día a día
    porque el DST muerde), conmutador «varios días» reusando `BlockDays.svelte`,
    y agrupación en `MonthGrid`. **Dos funciones DISTINTAS el mismo día no se
    colapsan nunca** — los dos nombres tienen que verse.

17. [ ] **Tipos de horario añadibles por el usuario.** Las cinco franjas de
    ADR-023 son **columnas fijas** en `performance` con un CHECK de orden: nadie
    puede añadir «photo call» sin migración. Diagnóstico: son una lista
    disfrazada de columnas — tienen orden, tipo y se recorren en secuencia.
    Propuesta sin decidir: tabla `performance_slot (performance_id, kind, label,
    at, sort)`. Es la pieza más grande pendiente (migración + backfill +
    reescribir road sheet, `ProductionStub`, `ScheduleTable`, whitelist del
    PATCH). Merece ADR propio.

## EN CURSO — Travel v2: el viaje como trayecto multi-etapa (ADR-089)

> **Sesión 2026-07-23. Modelo DECIDIDO (ADR-089), NADA de schema construido.**
> Empezó como retoque visual de las cards del mes y creció hasta un modelo de
> viaje nuevo. "Modelo primero" (Marco): primero el schema, los documentos
> después.

18. [ ] **Travel v2 — origen → destino + tramos multimodales (ADR-089).**
    El viaje hoy es *una ciudad + `travel_direction`*; `travelText` solo puede
    decir `→ Sevilla`. Marco quiere **origen y destino** explícitos y **etapas**
    (avión → taxi → metro), y **cada tramo con documentos** (billete PDF subible/
    descargable). Eligió en frío la **tabla completa** + 9 modos. Todo el diseño
    está en **ADR-089** (`_decisions.md`).

    **Secuencia:**
    - **P1 (siguiente, por escribir):** migración — enum `transport_mode`
      (`plane·train·bus·car·taxi·metro·walk·ferry·other`); columnas
      `origin_city/country` + `destination_city/country` en `date`; tabla
      `travel_stage` (1:N, opcional): `position, mode, from_*/to_* (city/country/
      place), depart_at, arrive_at, reference, notes`. Seguridad = **clon de
      `bolo`/`date`**: RLS FORCE, escritura solo por RPCs SECURITY DEFINER
      (`create/update/delete_travel_stage`, gate `edit:performance`), FK
      `date_id→date ON DELETE CASCADE`, triggers `set_updated_at`+`write_audit`.
      Extremos de `date` → **extender** `create_date`/`update_date`/
      `create_date_series` (DROP+CREATE por firma). Luego regen `db-types.ts` +
      tests RLS. Molde exacto a copiar: `supabase/migrations/20260722102000_money_v3_bolo.sql`.
    - **P2:** card muestra `Barcelona → Sevilla` en `MonthGrid` (`travelText`,
      fallback a `city`/dirección). Actualizar la data demo (abajo) con extremos.
    - **P3:** editor de tramos en el diálogo/detalle de fecha (depende de la
      tarea 15 — editar fecha desde la UI, que NO EXISTE aún).
    - **Diferido (P3+):** **documentos por tramo** → requieren el **primer
      pipeline de archivos R2** de Hour (`MEDIA` está declarado pero SIN uso;
      materials y `expense.receipt_url` solo guardan una URL ya formada). Es
      fundacional y reutilizable (riders, recibos). Tabla `travel_stage_document`.
      También diferidos: road sheet e ICS de los tramos.

    **Deuda anotada:** `travel_direction` (outbound/return/leg) **se queda** porque
    alimenta `awayBands()` (ADR-078 §6); reconciliar dirección↔extremos = después.

    **PENDIENTE de Marco antes de escribir la migración** (le pregunté, no
    respondió — cerró sesión):
    1. ¿Aprueba el modelo del ADR-089? (mantener `travel_direction`; gate
       `edit:performance`; extender `create_date`/`update_date`).
    2. **Rama**: tenía cambios sin commitear (`AgendaList`, `planner/+page`, i18n,
       un brief borrado). NO tocar. ¿Migración a rama nueva `feat/travel-stages`
       o dejar archivos sin crear rama?
    3. ¿Aplicar a `hour-staging` tras escribir, o solo dejar el archivo para
       revisar antes de tocar DB?

    **Ya hecho esta sesión (CSS de las cards, cerrado):** unificación en
    `MonthGrid.svelte` — todas las opciones (hold/proposed, bolo y date)
    comparten una sola regla por `data-family` (fondo + borde dasheado +
    textura); el **bolo confirmado** conserva su forma propia (tinte+lift+
    redondeo); `proposed` unificado a `text-faint`; el **viaje** foldeado al
    contenedor compartido (data-family + sin `border:none`/`transparent`).
    `svelte-check` 0/0. **Ya commiteado por Marco como `c4f2e3a`** en
    `feat/money-v3-build`.

    **Data demo en `hour-phase0` (prod, la misma DB que usa el dev local):**
    8 cards de muestra en el proyecto **MaMeMi** (workspace MüK Cia,
    `019da78d-a016-741b-a263-6987b00969c4`), julio 2026, tag
    `custom_fields.demo_batch='cards-20260723'`. Sirven para VER las cards; **NO
    tienen origen/destino** (el modelo aún no existe). **Limpieza:**
    `delete from date where custom_fields->>'demo_batch'='cards-20260723';`
    `delete from performance where custom_fields->>'demo_batch'='cards-20260723';`

## Bloqueado — comms + acceso (ADR-082/083/085)

> **El modelo está cerrado; la implementación no puede empezar.** El canon está
> **aquí, en `main`** desde el 2026-07-20: ADR-082/083/085 en `_decisions.md`,
> las dos escaleras y la faceta como primitivo en `build/structure-model.md`, el
> digest del grill en `_notes/spec-access-comms-decisions.md` y el review de 32
> hallazgos en `_notes/review-comms-migration-2026-07-20.md`. **No hay que
> rehacer el pensamiento.**
>
> Fuera de `main`, en la rama `feat/comms-threads`, queda solo el material de
> construcción: la migración de 604 líneas **sin aplicar** y los 7 prototipos de
> `app design/`. De código de aplicación no hay nada en ningún sitio — ni una
> ruta, ni un componente, ni un endpoint.
>
> Verificado contra producción el 2026-07-20, no reconstruido de documentos.

- [ ] **BLOQUEANTE 1 — el `invitat` no tiene forma de autenticarse, y es más
  grave de lo que se escribió.** El schema **puede guardar** un invitado
  (`membership.user_id IS NULL` + `ends_at`) y **nada puede dejarle leer**.
  `workspace_invitation`, que `main` construyó después, **no lo resuelve**: exige
  login por tres cerrojos independientes — el `GRANT` excluye `anon`, las RPC
  hacen `JOIN auth.users ON au.id = auth.uid()`, y además exigen
  `email_confirmed_at IS NOT NULL` con el email coincidiendo. **Lo que no se
  había dicho**: el invitat **escribe**, y hoy en Hour no existe ni un solo
  camino de escritura alcanzable por `anon`. Los dos precedentes de la casa
  (`roadsheet_share`, `calendar_share`) son lectura de una vía que devuelve jsonb
  curado — la proyección *es* la redacción. Esto no es un detalle de etapa 2: es
  abrir la primera escritura anónima en un sistema cuyo modelo de autorización
  entero descansa sobre `auth.uid()`. Si se hace, el patrón a copiar es el de
  `workspace_invitation` (token **hasheado** sha256 + `expires_at` + revocación),
  no el de los shares, que guardan el token **en claro y sin caducidad**.

- [ ] **BLOQUEANTE 2 — RPC de expansión de presets, y la etapa 2 se ha
  encarecido.** Sin ella no se escribe **ninguna** fila en `membership_facet`, así
  que ningún hilo de faceta lo lee nadie salvo un owner/admin: la etapa 1 nace
  muerta. Tiene que expandir preset→filas con `source='preset'`, aplicar
  overrides con `source='override'` (la vista «de dónde sale cada permiso» de
  ADR-082 §4 depende de esa columna) y hacer cumplir la delegación acotada
  (faceta · verbo · nivel) en el servidor. **Además** el plan escrito en la
  migración («apuntar `has_permission()` a `membership` y tirar las dos tablas
  viejas») envejeció mal: `has_permission` se partió en
  `has_permission_for_user` + wrapper, llegó `read:performance`, y hoy dependen
  de ello 8 políticas SELECT reescritas más `list_money_performances` y
  `update_performance_fee`.

- [ ] **Migración `2026-07-20_comms_threads_and_membership.sql` — escrita,
  SIN APLICAR, y ya no bloqueada por lo que decía.** 604 líneas: 2 enums, 7
  tablas, 4 funciones, 9 políticas, triggers y rollback. Aditiva pura. **La
  dependencia declarada ha muerto**: decía depender de
  `2026-07-18_user_profile_person_id.sql`, pero `user_profile.person_id` **ya
  existe y está vivo en producción** — `main` lo resolvió por su cuenta con la
  tanda de identidad. Ninguna de sus 7 tablas existe todavía.

- [ ] **Defecto NUEVO, no listado en el review de 32 hallazgos: todo backfill de
  proyecto nace inerte.** El backfill de `project_membership` no escribe
  `accepted_at`, pero el guard `accepted_at IS NOT NULL` que se añadió al cerrar
  los hallazgos #10/#14/#18 rechaza exactamente esas filas. Resultado: tras
  aplicar, **ninguna membresía de proyecto concede pertenencia ni acceso a
  faceta a nadie**. La otra mitad del remedio del #18 no se aplicó.

- [ ] **Hallazgos del review que siguen abiertos** —
  `_notes/review-comms-migration-2026-07-20.md`. Los 4 conocidos:
  `membership_select` publica la matriz de permisos entera del espacio · el
  backfill aplana roles a `equip`/`direccio` con presets sin grants · nada obliga
  la tabla faceta×nivel en escritura · `message.workspace_id` no está atado al
  del hilo. **Y `main` ya resolvió el patrón del primero**: estrechó
  `workspace_membership_select` a `user_id = auth.uid() OR is_workspace_admin()`,
  así que la política de la rama nace incoherente con la casa. Abiertos además:
  los índices `coalesce(user_id, person_id)` permiten fila de invitado y de
  operador para el mismo humano; falta `guard_immutable_workspace_id` en
  `membership`/`thread`/`message`, contra el patrón de las 13 tablas que lo
  llevan; y comentarios obsoletos que citan un objeto `thread_general` que no
  existe en el fichero.

- [ ] **ADR pendiente: comms sube a la lente Conversations.** Decidido en
  conversación 2026-07-20, sin escribir. Una puerta, **dos proyecciones** (patrón
  ADR-076): *amb qui parles* (difusión, por contraparte, con estado) y *de què es
  parla* (interno, por contenedor, por facetas). Ninguna secundaria. **No
  fusionar las entidades** — 1:1 con estado vs N:N sin estado; lo que unifica es
  la lente, no la tabla.

- [ ] **La puerta de producto, que es de Marco y no técnica.** ADR-085 lleva
  escrita su propia condición: *usar la app en una temporada de difusión real
  antes de construir nada de esto*. Mientras no se cumpla, resolver los dos
  bloqueantes es trabajo especulativo por bueno que sea el modelo.

## Después de money v3 — contenedores (bloque 5)

12. [ ] **Revisión diseño+datos — contenedores.** Portada de workspace, project
    detail, line detail y siete módulos; cerrar identidad fiscal y qué datos son
    obligatorios antes de ampliar UI.

13. [ ] **Revisión diseño+datos — fichas y transversales.** Performance, road
    sheet, conversation, person, settings, diálogos; loading/error/empty/offline,
    mobile, light/dark y accesibilidad.

## Producto — después

- [ ] **Poll de fechas candidatas (à la Doodle/When2meet, integrado).** Al buscar
  fecha para una residencia, un ensayo o una reunión, proponer **varias `date`
  candidatas de golpe**; cada participante confirma las que puede; cuando todos
  han respondido, el sistema revela **qué opciones funcionan** (y cuáles son
  parciales). Encaja con la disponibilidad/conflictos que Planner ya modela y con
  el patrón consent-first (el sistema propone, la gente confirma, el sistema
  concluye). Existen servicios externos que lo hacen; tenerlo dentro evita el
  salto de herramienta. **Dependencia a vigilar:** si los participantes son
  externos, responder es una **escritura desde `anon`** — misma frontera que el
  BLOQUEANTE 1 de comms/acceso; para gente ya dentro del workspace no aplica.
- [ ] **WhatsApp por escalones.** Share-to-Hour/manual asistido → número/bot →
  Business API para cuentas elegibles; nunca scraping de WhatsApp Web.
- [ ] **Road mode mobile/offline.** Paquete de próximos bolos, road sheets y
  contactos con frescura visible y cola de escritura limitada.
- [ ] **AI data-readiness y guardarraíles.** Source, ownership, consent,
  confidence, freshness y visibilidad; aprobación, idempotencia, audit log y
  compensación para cada acción.
- [ ] **Polish de beta.** Mobile completo, GDPR export, accesibilidad WCAG,
  notificaciones y ratificación visual/naming con usuarios externos.

## Deuda aceptada / observar en uso

- Tareas cuyo padre se soft-borra pueden quedar sin contexto en Desk.
- `update_workspace` directo por PostgREST permite a owner/admin saltar las
  validaciones de la API; no es una escalada de privilegios.
- `line.notes` y collab no exigen exactamente el mismo permiso fuera de la API.
- Invoices multilínea/PDF/serie, expiración de shares y
  timezone por ciudad siguen fuera de la profundidad actual.
- `logo_url` existe, pero no hay flujo de subida R2.
- Persona de test huérfana `019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8`: invisible;
  purga opcional y exacta, nunca por patrón amplio.
- **44 facturas draft soft-borradas en `zzz-e2e-collab`**, desde el 2026-07-04.
  **No es un fallo**: todas tienen `deleted_at` puesto, o sea que el camino de
  *Discard* del test funciona y las descartó bien. Son residuo invisible, del
  mismo tipo que las ~90 `performance` soft-borradas de la misma fixture. Purga
  opcional (hard-delete de filas ya soft-borradas en un proyecto de test), nunca
  por patrón amplio.
  > Corrección 2026-07-20: una versión anterior de esta nota afirmaba que la
  > limpieza de `money.spec.ts` resolvía la fila equivocada y dejaba las drafts
  > **vivas**, y que eso causaba la acumulación. Era falso y no se comprobó
  > contra `deleted_at`. Lo único observado de verdad fue un `fee_amount`
  > quedado a 1234.56, que lo explica la ejecución que falló. El commit
  > `7edaedf` arrastra esa misma exageración en su mensaje.
- **`money.spec.ts` filtraba por un año desnudo — arreglado.** La fixture tiene
  **dos** bolos de 2031 (15 y 16 de enero, sembrados con 200 ms de diferencia),
  y el test los filtraba por `'2031'` con `.first()`, cuyo orden no es estable:
  tras el reload podía resolver a la fila sin fee y fallar. Corregido fijando el
  día exacto (`15 Jan 2031`) y resolviendo la fila UNA vez. Fragilidad real de
  localizador; no había bug de producto — el fee se persistió correctamente.

## Cerrado recientemente

- [x] **Bloque 1 — gate operativo completo.** E2E producción 24/24 en
  `7f3de05`; baseline alojado desde cero 114/114 en staging
  ([run 29761298044](https://github.com/marcorubiol/hour/actions/runs/29761298044));
  restore drill desde R2 en 203 s, login + conteos + RLS + ruta crítica
  verificados
  ([run 29761775037](https://github.com/marcorubiol/hour/actions/runs/29761775037)).
- [x] Planner v2 + rename Calendar→Planner, aplicado y desplegado.
- [x] Desk v2: feed mixto, TaskComposer, modo calma y consentimiento IA.
- [x] Identidad workspace-scoped + organizaciones + hardening RLS.
- [x] Fixture limitado y matriz negativa inicial; RLS 114/114.
- [x] Advisors: 0 warnings de rendimiento.
