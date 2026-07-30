# Hour — estado canónico del proyecto

> **FUENTE DE VERDAD ACTUAL.** Cualquier agente o persona debe empezar aquí.
> Última verificación: **2026-07-20**, contrastada con Git, el código, producción,
> Supabase y las suites; no reconstruida desde documentos antiguos.
> **Reconciliación 2026-07-23:** money v3 (ADR-086/087/088) se desplegó a prod
> ese día — runtime **`a35e8c4`**; ver «Producción» y «Git» abajo y
> `_tasks.md § bloque 7`. El resto del doc no se re-verificó en esa fecha.
> **Reconciliación 2026-07-24:** pase de consolidación sobre `feat/money-v3-build`
> (código muerto fuera, helpers unificados, los 4 ficheros gigantes partidos),
> Hall i18n y picker de identidad; todo mergeado a `main` y **desplegado a prod
> el mismo día** (runtime `a643620`). Sin cambios de schema.
> **Reconciliación 2026-07-25:** pase de endurecimiento (auditoría de seguridad,
> rendimiento y estabilidad) desplegado a prod — runtime **`252729f`**, **con
> cambios de schema** (5 migraciones). Ver «Producción», «Git» y `_tasks.md`.
> **Reconciliación 2026-07-30 (noche) — el estado partido está CERRADO:** el
> **eje de persona** (persona como cuarta dimensión de scope) y el **enlace
> login↔persona** están **desplegados**. Runtime **`0f8e12f`**
> (builtAt 2026-07-30T21:23Z), `main` == `origin/main` == prod, con las
> 2 migraciones del día ya aplicadas. Verificado después del deploy:
> **RLS 137/137** y **E2E 30/30** contra producción.
> **Y una corrección que importa más que el deploy:** el aviso de esa mañana de
> que «las credenciales de fixture están rotas y ni RLS ni E2E se pueden correr»
> era **falso**. Las dos suites corren desde esta máquina y siempre pudieron.
> Lo roto era el destino: `.env.local` apunta a una Supabase local donde los
> usuarios fixture no existen. Ver «Verificación» abajo y `_tasks.md § 21`.
>
> Si otro archivo contradice este documento sobre el estado presente, gana este
> documento. Si contradice una decisión de producto estable, consultar
> `_decisions.md` y comprobar si la decisión fue superseded.

## Lectura mínima al entrar

1. `_context.md` — qué es Hour y dónde está ahora.
2. `_tasks.md` — única cola de trabajo vigente.
3. `build/architecture.md` — arquitectura técnica y límites de seguridad.
4. `build/structure-model.md` — modelo de producto: lente, contenedor, módulo y tarea.
5. `_decisions.md` — ADR cronológicos; **historia**, no estado operativo.
6. `build/runbooks/` — solo para operaciones concretas.

No usar como instrucciones los documentos de `build/archive/` ni los snapshots de
`_notes/`. Se conservan para entender por qué se llegó aquí.

## Qué es Hour

Hour es un SaaS B2B multi-tenant para compañías pequeñas y medianas de artes en
vivo. Une difusión, conversaciones, planificación, producción, road sheets,
equipo, tareas y dinero. Sustituye la combinación dispersa de Excel, Drive,
correo, Notion y WhatsApp sin intentar sustituir la gestoría ni construir
compliance laboral español.

La dirección de producto es una capa de IA **proactiva y consent-first** sobre
el mismo grafo operativo. La IA propone; una persona aprueba; el sistema ejecuta
y deja auditoría. La UI manual y la futura IA deben leer y escribir los mismos
contratos.

## Fase real

**Phase 0 — herramienta interna funcional, endureciéndose para beta privada.**

- Uso real inicial: Marco, MüK Cia / MaMeMi y fixtures sintéticos.
- No está abierta al público ni tiene billing/self-service.
- El modelo ya es multi-workspace y multi-account; no es una app single-tenant.
- La beta externa no debe empezar hasta cerrar los elementos de Phase 0.9 que
  siguen en `_tasks.md`.

Phase 1 solo empieza si la beta asistida valida demanda. El pricing sigue siendo
orientativo, no una verdad comercial cerrada.

## Estado operativo verificado

### Producción

- Web: `https://hour.zerosense.studio`
- Worker: `hour-web`
- `/health/live`: sano, `dirty:false`, SHA **`0f8e12f`** (builtAt 2026-07-30T21:23Z).
- `/health/ready`: sano, Supabase `ok`.
- **`main` == `origin/main` == prod.** No hay código de aplicación sin desplegar.
  El deploy del 2026-07-30 por la noche subió el eje de persona, el enlace
  login↔persona y la tarea 15 (editar fecha). Verificado inmediatamente después
  contra el runtime desplegado: **RLS 137/137 · E2E 30/30**, cero skips.
- *Cómo se despliega, porque el comando documentado no funciona:* es
  **`pnpm --filter web run deploy`**. `pnpm deploy` desde la raíz choca con el
  subcomando propio de pnpm y muere con `ERR_PNPM_NOTHING_TO_DEPLOY` sin tocar
  nada.
- **DB por delante del Worker, a propósito:** el runtime es `09f512a` pero la
  base lleva además la migración **`20260725100000_unexpose_project_id_helpers`**
  (aplicada el 2026-07-25, run 30160118066). No requiere desplegar: saca las 3
  funciones `project_id_of_*` del esquema expuesto —eran un oráculo de
  existencia cross-tenant vía RPC— y repunta las 14 policies que las usan. El
  GRANT a `authenticated` se mantiene a propósito: las policies se evalúan como
  el invocador. Verificado después: **RLS 137/137, E2E 27/27**, advisors sin
  ERROR y los avisos de DEFINER expuestas bajando de 73 a 70 (las 3 retiradas).
  Con esto **la auditoría 2026-07-24 queda sin diferidos**: los tokens de share
  se decidieron NO hashear (ADR-091) y el HIBP es una compra de plan, no deuda.
- Debajo de `0f8e12f` va **`09f512a`**, que fue el runtime desde el 2026-07-25
  hasta la noche del 30. Durante esas horas hubo código de aplicación sin
  desplegar (`7d03827`, `84758fc`, `25fc1c5`) — el eje de persona y el enlace
  login↔persona. **Ese hueco está cerrado**; se deja escrito porque es el caso
  que la frase antigua de esta sección —«encima solo van tests y
  documentación»— no cubría, y volverá a pasar.
- **Las dos migraciones del 2026-07-30** —
  **`20260730164435_bind_auth_user_trigger`** y
  **`20260730164608_revoke_anon_user_profile_update`**, aplicadas el 2026-07-30
  por MCP (no por el workflow plan+apply; anotado a propósito). La primera es
  **no-op en prod** (el trigger ya estaba) y existe por el camino de
  reconstrucción: el `CREATE TRIGGER` que engancha `handle_new_user` a
  `auth.users` **no estaba en ninguna migración**, solo en `build/schema.sql`,
  que no se ejecuta — así que una base levantada con `pnpm db:reset` aceptaba
  altas **sin crear user_profile, cuenta, workspace ni membresía**. Verificado
  empíricamente en la base local: antes `trigger: AUSENTE`, después un alta de
  prueba deja `user_profile: 1 · workspaces: 1`. La segunda quita a `anon` el
  UPDATE sobre `user_profile` (cubría `person_id`, `user_id` e
  `is_platform_admin`); **no era una puerta abierta** —RLS forced y la única
  policy exige `user_id = auth.uid()`, que para `anon` es NULL— sino un grant a
  una policy de distancia de ser tres escaladas. Después: `anon` 17→**0**,
  `authenticated` **12 intacto**, advisors **0 ERROR** y los 73 WARN de
  siempre, sin categoría nueva.
- Debajo de `09f512a` va **`252729f`** — **pase de endurecimiento
  (auditoría 2026-07-25), desplegado con 5 migraciones**. Cierra: la lectura de
  `fiscal_identity` sin `read:money` (filtraba IBAN/SWIFT/NIF a cualquier
  miembro), la escritura directa por Data API sobre `invoice`/`invoice_line`/
  `payment` (permitía falsificar un correlativo fiscal saltándose
  `issue_invoice`), la ausencia de idempotencia en `create_payment` (un doble
  click duplicaba el cobro) y el throttle de login solo por-IP. Rendimiento:
  `has_permission()` ya no se evalúa por fila en las 3 RPC de money
  (`accessible_project_ids` resuelve el set una vez) — **equivalencia de
  autorización verificada en vivo contra la lógica antigua: 27=27 bolos,
  157=157 pagadores**. Estabilidad: poda de `collab_snapshot`, resiliencia del
  worker collab, fugas de promesas y listeners. Debajo va `ff6ec4e` — **fix de la race de
  `/h/money` («Loading…» colgado): `notifyOnChangeProps:'all'` como default del
  QueryClient, desplegado el 2026-07-24** (solo frontend, cero schema; `main`
  == prod; ver `_tasks.md § bloque 7`). Debajo va `a643620` — **la
  consolidación, el Hall i18n y el picker de identidad, desplegado el
  2026-07-24** (solo frontend, cero schema). Debajo va `a35e8c4` — **money v3
  (ADR-086/087/088) desplegado el 2026-07-23**: bolo como unidad de dinero, fiscal_identity,
  invoice/proforma con numeración, payment desacoplado, lente Books e impuesto
  country-agnostic. Gate completo ese día (backup → staging → prod migrate
  plan+apply → worker deploy), evidencia de runs en `_tasks.md § bloque 7`.
- El runtime anterior era `4499848` (planner + identidad, 2026-07-20). Commits
  posteriores que solo cambian documentación o tests no requieren desplegar el
  Worker — ninguno de los dos entra en el bundle; `main` puede ir por delante de
  `/health/live` por esa razón y seguir siendo un estado limpio. **Esa excusa
  ya no cubre el hueco actual** (ver arriba: `7d03827`/`84758fc` sí entran).
- **Dato de producción tocado a mano el 2026-07-30**, dicho aquí porque no lo
  cuenta ninguna migración: el login `marcorubiol@gmail.com` pasó a ser una
  **persona** — `person_id 019fb37d-780e-7e19-927f-ed256dff6771`, dossiers en
  `muk-cia` y `marco-rubiol`, y `user_profile.full_name` corregido de
  `marcorubiol` a `Marco Rubiol`. Hecho **llamando a la RPC de consentimiento**
  (`share_my_profile_with_workspace`) con las claims del propio usuario, no
  escribiendo filas: mismo efecto que pulsar el botón. Perfiles enlazados 1→2
  de 4. Reversible: borrar los dos `workspace_person`, poner `person_id` a NULL
  y borrar la `person`.

### Git

- Repo: `https://github.com/marcorubiol/hour` (privado).
- Checkout: `/Users/marcorubiol/Developer/hour`.
- Rama principal: `main`.
- **2026-07-30 (noche): `main` == `origin/main` == prod == `0f8e12f`.**
  El eje de persona (`$lib/people`, pin `pe:`, `/api/me`,
  `/api/me/profile-share`, `project_ids` en `/api/team`, la puerta en
  Ajustes → Perfil), las personas en el ⌘K y la tarea 15 (editar fecha) ya
  corren. El E2E de la tarea 15 **corrió por primera vez esa noche y quedó en
  verde** — su primer rojo fue del spec, no de la app (elegía un día que el mes
  dibuja y la agenda no; ver `_tasks.md § 15`).
- Antes de eso, **`main` == `origin/main` == prod** desde el 2026-07-24 (runtime
  `ff6ec4e`, merge fast-forward + deploy el mismo día). Encima de `a643620`, sin schema:
  `ff6ec4e` — **fix de la race de `/h/money`** (default global
  `notifyOnChangeProps:'all'` en el QueryClient; TanStack tracked-props
  suprimía la notificación de éxito de una query hermana → store congelado en
  `isLoading:true`). Antes, encima de money v3, sin cambios de schema:
  candidate polling (`f9eb324`), los 2 de Travel v2 (`c4f2e3a` estilo MonthGrid
  + `21da2be` i18n), el ciclo de debug del agenda feed (`1e8a600`+`f4170fc`),
  docs (`0d45b22`) y el **pase de consolidación 2026-07-24** — `0ad0553` borra
  ~3.4k líneas de harnesses de diseño de money v3 ya obsoletos y exports
  muertos; `e0a47a0` unifica helpers duplicados de fecha/dinero/tasks (incluye
  fix del seed UTC de received_on/incurred_on); `bdc30fd` settings 1766→276
  (7 secciones); `c88a8e4` planner 2107→1530 (feeds/toolbar/feed-dialog);
  `496e527` layout 1705→682 (shell/); `ace9341` MonthGrid 1566→1053 (chips/
  legend/clash + `month-events.ts`, estilos de cards intactos byte a byte).
  Después del pase, el mismo día: Hall unificado al canon i18n (`9e958c2`
  dayBucket + `f765cfe` verbos + `10520c0` portada/board, 25 claves ca/en/es)
  y **el picker de identidad mergeado** (`05c84d3` — slider de 10 tonos con
  magnet, aviso de color similar, helpers de hue; unit sube a 368).
- `wrangler deploy` exige árbol limpio y publica el SHA en `/health/live`.
- **Ramas de trabajo: ninguna — `main` es la única verdad.** El 2026-07-24
  `feat/money-v3-build` se mergeó a `main` por fast-forward y se borró (local
  y origin), con `feat/identity-colour-picker` ya dentro (merge `05c84d3`);
  `feat/money-v3-design` se borró contenida. Queda solo `feat/comms-threads`:
  - `feat/comms-threads` — comms + acceso. **Su canon ya está en `main`**
    (ADR-082/083/085, las dos escaleras y la faceta en `structure-model.md`, el
    digest del grill y el review de 32 hallazgos). Lo que queda en la rama es
    solo material de construcción: 604 líneas de SQL **sin aplicar** y los 7
    prototipos de `app design/`. Cero código de aplicación. Dos bloqueantes de
    arquitectura abiertos — ver `_tasks.md § Bloqueado`. **La rama no se mergea
    entera**: el pensamiento sí sube, el SQL re-aplicable no.

### Supabase

- Proyecto: `hour-phase0` · ref `lqlyorlccnniybezugme` · `eu-central-1`.
- Plan: **Free**.
- Auth: email+password, cookies httpOnly en la app, hook de access token activo.
- RLS: FORCE en las superficies tenant-scoped; suite live **120/120**.
- Identidad 2026-07-20: `workspace_person` y `workspace_organization` aplicadas,
  perfil portable y dossier local por workspace, share/revoke explícitos.
- Fixture limitado: `limited@hour.test`, member solo de `playwright`, performer
  en `zzz-e2e-collab`; sin workspace/account personal.
- Fixture externo: `external@hour.test`; ciclo completo cero acceso → invitación
  → aceptación → revocación con el mismo JWT, independiente de los otros users.
- Advisors: rendimiento sin ERROR/WARN (102 INFO de índices/FK/PK a observar).
  Seguridad sin ERROR: 68 RPC authenticated SECURITY DEFINER y las 2 proyecciones
  públicas por token son fronteras intencionadas; HIBP es el warning pendiente
  que requiere Supabase Pro. `workspace_invitation` sin policy es INFO y
  deliberado: solo se accede mediante RPC.
- Staging: `hour-staging` · ref `slccyknqpgmzhyiyclsq` · `eu-west-1`, aislado
  mediante el environment GitHub `staging`; hook de claims activo.
- **Los fixtures están SANOS.** `PW_TEST_*` y `PW_LIMITED_*` de `.env.test`
  autentican contra producción sin tocar nada: RLS 137/137 y E2E 30/30 la noche
  del 2026-07-30. La mañana de ese mismo día este documento afirmó lo contrario
  («fixtures rotos, `invalid_credentials`, las suites no se pueden correr»); era
  falso, y la causa está en «Verificación» — `.env.test` no lleva URL de
  Supabase, así que quien la resuelva desde `.env.local` acaba pegando contra la
  base local, donde esos usuarios no existen.
- **El eje de persona depende de datos que casi no existen** (2026-07-30):
  `cast_member` son **6 filas en 3 proyectos** y `crew_assignment` 7, todas en
  el workspace `demo` y con gente de test; **MüK Cia no tiene reparto**. Y
  `user_profile.person_id` estaba puesto en **1 de 4** perfiles (ahora 2). No
  es un fallo del eje: es que el reparto no se ha rellenado nunca, en parte
  porque **no hay forma de escribirlo desde la app** (ver `_tasks.md`).

`supabase/migrations/` es ahora la historia SQL ejecutable: checkpoint
reconstructivo + marcadores aplicados + migraciones posteriores. Una base
vacía se reconstruye con `pnpm db:reset`, recibe fixtures sintéticos y pasa
120/120 RLS. El SQL histórico anterior vive solo en
`build/migrations/squashed-20260720/` para auditoría. **Corregido el
2026-07-30:** esa reconstrucción estaba incompleta y la suite no lo veía —
faltaba el `CREATE TRIGGER on_auth_user_created`, así que en una base
reconstruida el alta de un usuario no provisionaba nada. Lo tapaba el hecho de
que los fixtures siembran `user_profile` directamente, así que ninguna prueba
pasa nunca por esa puerta. Cerrado por `20260730164435`.

### Verificación local y contra producción

**CÓMO SE CORREN LAS SUITES** (aprendido a golpes el 2026-07-30; si algún
documento dice que no se pueden correr, está desactualizado):

- `pnpm --filter web test:rls` → **contra producción siempre**. Carga `.env` +
  `.env.test` explícitamente y **no** mira `.env.local`.
- E2E → **contra un origen desplegado**:
  `PW_BASE_URL=https://hour.zerosense.studio npx playwright test`.
  **Nunca contra `vite preview`**: ahí no hay `platform.env`, y como la app lee
  `PUBLIC_SUPABASE_URL` del entorno del Worker (`wrangler.jsonc § vars`) y no de
  un `$env/static`, en preview simplemente no hay Supabase y el login no puede
  completarse. Eso, y no un fallo de credenciales, explica también los viejos
  «skips intencionados» de collab.
- **`.env.local` es la trampa.** Apunta `vite dev` a una Supabase local en
  `127.0.0.1:54321` (que suele estar levantada), donde los usuarios fixture no
  existen. Cualquier «invalid_credentials» empieza por preguntar **contra qué
  base** se está mirando. Al build de producción no le afecta: `PUBLIC_SUPABASE_*`
  no se hornea en el bundle.

**Pase 2026-07-30 (noche)** — deploy y verificación completa contra el runtime
desplegado `0f8e12f`: **RLS 137/137** (19 ficheros, 23 s) y **E2E 30/30**
(16 s), cero skips. Los 3 tests nuevos son los de la tarea 15. Antes del deploy,
el mismo E2E daba 27/30: los 3 rojos eran la función sin desplegar, o sea el
spec funcionando.

**Pase 2026-07-30 (día)** (eje de persona + enlace login↔persona): `svelte-check`
**0/0 (1.844 ficheros)**, unit **408/408** (subió de 375: `people.test.ts`
nuevo, más casos en `nav`, `planner` y `carrils`), build de producción verde.
Contra la base viva: las 2 migraciones aplicadas y comprobadas una por una
(trigger activo; `anon` 17→0; `authenticated` 12 intacto), **advisors 0 ERROR**
y los 73 WARN conocidos sin categoría nueva, y la migración del trigger probada
**antes** en la base local con un alta real. Ese pase creyó que RLS y E2E no
podían correrse; **se equivocaba** — ver el bloque de arriba.

**Pase 2026-07-24** (consolidación + deploy): `svelte-check` 0/0 (1.832
ficheros), unit **368/368** (subió de 348: identidad + picker), collab 11/11,
build verde, verificación mecánica de los splits (CSS y markup byte a byte).
RLS no se re-corrió (cero cambios de DB). **E2E post-deploy contra `a643620`:
26/27** — collab arreglado (el spec ahora reintenta la reescritura hasta dejar
el doc Yjs limpio), `money.spec.ts` reescrito contra el UI v3 (el spec viejo
era de money v2 y llevaba roto desde el 23 sin que nadie lo corriera), y el
fallo restante es un **bug real no determinista de `/h/money`** («Loading…»
colgado con datos ya llegados) anotado en `_tasks.md` — el spec es su guardián.

Último pase completo relevante:

- `svelte-check`: 0 errores / 0 warnings.
- Unit: **348/348** (subió de 328 con los tests de identidad y bloques).
- RLS contra Supabase live: **120/120**, sin skips.
- Collab: **11/11** + TypeScript limpio.
- Build de producción: verde.
- E2E contra producción: suite completa **27 passed, 0 skips** sobre el runtime
  `4499848`; recorrido específico de Money **2/2**. Los 2 skips que antes se
  daban por «remotos intencionados» eran los de collab corriendo contra
  `vite preview`, donde el Durable Object no existe: contra producción corren y
  pasan. Incluye anticipo+resto, paid derivado y reversible, expected aging,
  Conversations scoped, sesiones y limpieza de los datos de prueba.
- Baseline hosted actual: run `29774763911` sobre `3b7c95e`, reconstrucción
  desde cero, 3 identidades Auth, 154 conversaciones sintéticas, RLS 120/120,
  build y smoke 2/2 verdes.
- Migración de producción: plan `29774560595` y apply `29774607258`; solo
  `20260720214500_money_v2.sql`, con grants, triggers y estado derivado
  comprobados después del DDL.
- Backup de producción actual: run `29770347695` sobre `5cc2f6b`, sello
  `2026-07-20T19-02-54Z`; esquema, datos y roles subidos a R2 y retención
  aplicada correctamente.
- Baseline hosted: run `29761298044`, desde cero, Auth + fixtures, RLS 114/114,
  build y smoke 2/2.
- Restore drill hosted: run `29761775037`, stamp
  `2026-07-20T16-01-18Z`, **203 s**, conteos exactos, login, RLS 114/114,
  build/smoke y retorno automático al baseline sintético.

## Producto construido hoy

- **Hall** `/h`: puerta de entrada y frase de estado.
- **Desk** `/h/desk`: feed mixto real de tareas, agenda, conversaciones y
  dinero; modo calma y propuestas IA representadas como tareas reales.
- **Planner** `/h/planner`: mes, agenda y carriles; performances, dates,
  disponibilidad, viajes, conflictos y decisiones derivadas. `Calendar` queda
  solo para iCalendar/ICS e URLs legacy con redirect.
- **Conversations** `/h/conversations`: libro operativo con last contact,
  “Contacted today” con reloj de servidor, agrupación conversación/contacto,
  project chips, escritura de estado/próxima acción y estado vacío de importación.
  El contrato de `conversation_event` existe; la tabla/timeline aún no.
- **Books** (lente `Books` / ES `Cuentas`; ruta física `/h/money`, rename a
  `accounts` diferido) — money v3 (ADR-086/087/088), desplegado 2026-07-23. El
  **bolo** es la unidad de dinero (1 sala · 1 contrato · 1 fee/pagador/factura ·
  1..N funciones); spine de bolos agrupados por obra, venue-first. Cabecera por
  moneda: Vendido → Cobrado → Pendiente/Vencido (derivado de facturas emitidas sin
  cobrar vía aging), con neto-tras-tasas. `fiscal_identity` emisor/receptor;
  invoice/proforma con numeración correlativa atómica; pago desacoplado del
  facturar (cobrado = pagos-vs-caché-del-bolo); impuesto genérico country-agnostic
  (`invoice_tax_line`, preset ES relleno) que **se para antes de la emisión legal
  certificada**. Vencido → tarea a Desk.
- Contenedores: workspace → project → line; los módulos editan a nivel line.
- Performance detail, road sheet interno/público, venues, cast/crew, assets,
  expenses, tasks, calendar shares y colaboración Yjs están operativos.
- Navegación actual: shell user-scoped, scopes/pins, LensSwitcher y rutas
  globales; Conversations conserva scope/copy-link y los aliases entrantes se
  canonicalizan al slug estable. No Plaza, no sidebar House→Room y no
  `ScopeStrip` antiguo.

## Modelo y vocabulario vigentes

- `account` = pagador; `workspace` = límite RLS; `project` = obra/producción;
  `line` = agrupación operativa componible.
- `person` = identidad portable; `workspace_person` = dossier local privado.
- `workspace_organization` = organización/contacto de un workspace.
- `conversation` = diálogo de difusión; nunca `engagement` en código vivo.
- `performance` = **función** (día·hora·road sheet, sin dinero; ADR-087); nunca
  `show` en código vivo. Ya no se llama «bolo/función atómica».
- `bolo` = **unidad de dinero** (ADR-087): el trato con una sala, agrupa 1..N
  funciones; caché/fee, cobrado y factura cuelgan del bolo, no de la función.
- `date` = ensayo, viaje, prensa, day off u otro evento no-performance.
- Lentes (ADR-088): **Desk** es el digest cross-concern (pill propio, fuera del
  segmented "view as"); las 3 lentes son **Planner · Conversations · Books**
  (ES `Cuentas`). «Money» muere como etiqueta; la ruta `/h/money` se conserva.
- Road sheet es una proyección de performance, no una entidad independiente.
- No usar CRM vocabulary (`lead`, `pipeline`, `prospect`) salvo en investigación
  o interoperabilidad externa.

## Arquitectura resumida

- SvelteKit 2 + Svelte 5 + TypeScript + Vite.
- Cloudflare Workers + R2 + Durable Objects (`y-partyserver`).
- Supabase Cloud: Postgres 17, Auth, RLS, Realtime, pgmq.
- Valibot en fronteras API, TanStack Query para server state, Vitest y
  Playwright para verificación, Sentry para observabilidad.
- Monorepo pnpm: `apps/web` y `apps/collab` son los runtimes principales.

El stack sigue siendo adecuado; no hay motivo para reiniciar el producto con
otro framework. La deuda está en disciplina operativa, permisos, entornos y
profundidad de producto, no en SvelteKit/Supabase/Cloudflare.

## Reglas para cualquier agente

1. Antes de escribir código, leer
   `/Users/marcorubiol/Zerø System/03_AGENCY/_area-methød/code/philosophy.md`.
2. Para nav, lentes, módulos o detalle, leer `build/structure-model.md`.
3. Confirmar estado inestable con evidencia: health stamp, Git, catálogo DB o
   tests. Nunca promover a verdad una frase de un prompt/sesión.
4. `_tasks.md` es la cola; no crear otra cola paralela en un prompt o runbook.
5. `_decisions.md` es append-only. Añadir `Superseded by ADR-…` cuando cambie una
   decisión; no reescribir la historia para que parezca que siempre acertó.
6. No ejecutar nada de `build/archive/`.
7. No editar ni insertar directamente `auth.users`; usar Supabase Auth Admin.
8. No hacer cambios de schema sin migración, backup/preflight proporcional,
   regeneración de tipos y RLS tests.
9. No desplegar un árbol sucio. Producción es lo que dice `/health/live`, no el
   último commit local ni un documento.
10. Los secretos viven en Wrangler, Keychain o `.env*` gitignored; nunca en Git.

## Dónde vive cada verdad

| Pregunta | Fuente |
|---|---|
| ¿Dónde estamos? | `_context.md` |
| ¿Qué hacemos ahora? | `_tasks.md` |
| ¿Cómo está diseñado técnicamente? | `build/architecture.md` |
| ¿Cómo se estructura el producto? | `build/structure-model.md` |
| ¿Qué datos lleva cada pantalla? | `build/screen-data-spec.md` |
| ¿Qué pantallas faltan revisar? | `build/screens-inventory.md` |
| ¿Por qué se decidió algo? | `_decisions.md` |
| ¿Qué ocurrió en una sesión? | `_notes/sessions-log.md` |
| ¿Cómo opero producción/backup/beta? | `build/runbooks/` |
| ¿Dónde están planes y prompts terminados? | `build/archive/` |
| ¿Qué se investigó? | `research/INDEX.md` |

## Siguiente paso

Abrir `_tasks.md`. Nada bloquea: `main` == prod y las dos suites están en verde.
Todo lo que sigue sirve al **Planner v3**, que es la pieza en curso. Por orden:

1. **`note`, el post-it privado** (`_tasks.md § 23`, ADR-093). Es la única
   maquinaria que el Planner v3 necesita y no existe. **Ya está decidida:** la
   nota es siempre privada, lo que ve el equipo es comunicación, y la tabla nace
   con la forma que `message` va a necesitar. Incluye absorber `person_note`
   (cero filas — solo hoy es gratis).
2. **Persona: ¿dial o vista?** (`§ 24`) — ADR-092 y el prototipo no dicen lo
   mismo, y de eso depende si vive en la URL.
3. **La fontanería barata** (`§ 25`): los 3 campos del run sheet que ya viajan y
   se tiran, `'day'` como cuarta proyección, y la convención de holds en
   `workspace.settings`.
4. **El escritor de reparto** (`§ 20`), que no existe en ninguna forma: sin él
   el eje de persona no puede incluir a nadie que no esté ya sembrado. Es
   **pantalla**, y se construye dentro del pase de UI del Planner v3.
5. **Follow-up de money v3 (no bloquea):** UX de **enlazar una función nueva a un
   bolo** — las performances creadas en Planner nacen sin bolo hasta que exista.
6. **Travel v2 (ADR-089):** modelo decidido, nada de schema construido. Su
   dependencia dura —la tarea 15, editar una fecha desde la UI— **ya está
   construida, desplegada y con E2E verde**.
7. **Contenedores (bloque 5)** y los flecos de planner (multi-día de
   performances, escaleta ADR-090) van después.

> **Y DESPUÉS DEL PLANNER, COMMS — esto es nuevo y no estaba escrito en ningún
> sitio.** La capa de comunicación (ADR-082 + ADR-083: un hilo polimórfico sobre
> cualquier contenedor, hub por contenedor, sub-hilos = facetas) está **diseñada
> desde el 2026-07-19 y sin construir**, detrás de un portón que Marco puso:
> *usar la app una temporada real de difusión antes*. Lo que salió del grill de
> ADR-093 es **por qué** llevaba aparcada: es la parte más importante del
> producto y la razón por la que Hour existe —comunicación con profesionales—, y
> Marco la dejó deliberadamente para el final **para construirla con todo lo
> aprendido en el resto**. El portón sigue en pie pero deja de ser indefinido:
> **el Planner v3 es esa temporada**, y el post-it privado de ADR-093 es el
> instrumento que la va a especificar. Quien lea esto y planifique más allá del
> Planner: lo siguiente grande es comms, no una lente nueva.

> **Rediseño del Planner (Scope v3 Agenda), en curso y fuera del repo:** el
> diseño vive en un proyecto de claude.ai/design (`Hour Views - Scope v3 -
> Agenda.html` + `AGENDA-SYSTEM.md`), se lee con la herramienta `DesignSync`, y
> **nada de él está implementado**. Ese documento se declaró a sí mismo
> no-especificación tras descubrir que ocho de sus leyes eran falsas en
> pantalla: cuando se implemente, se destila a ADRs de aquí más aserciones
> ejecutables — no se trata como spec.

`_tasks.md` es la cola detallada con el estado exacto de cada uno.

## Desarrollo local

```bash
pnpm install
pnpm dev
pnpm --filter web check
pnpm --filter web test:unit
pnpm --filter web test:rls
pnpm build
```

Los valores públicos Supabase viven en `apps/web/.env`; los secretos y fixtures
en `.env.test`, Keychain o Wrangler. Ver `build/setup.md` y
`build/runbooks/test-user-setup.md`.
