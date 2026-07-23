# Hour — estado canónico del proyecto

> **FUENTE DE VERDAD ACTUAL.** Cualquier agente o persona debe empezar aquí.
> Última verificación: **2026-07-20**, contrastada con Git, el código, producción,
> Supabase y las suites; no reconstruida desde documentos antiguos.
> **Reconciliación 2026-07-23:** money v3 (ADR-086/087/088) se desplegó a prod
> ese día — runtime **`a35e8c4`**; ver «Producción» y «Git» abajo y
> `_tasks.md § bloque 7`. El resto del doc no se re-verificó en esa fecha.
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
- `/health/live`: sano, `dirty:false`, SHA **`a35e8c4`** (builtAt 2026-07-23T14:27Z).
- `/health/ready`: sano, Supabase `ok`.
- El runtime verificado en producción es `a35e8c4` — **money v3 (ADR-086/087/088)
  desplegado el 2026-07-23**: bolo como unidad de dinero, fiscal_identity,
  invoice/proforma con numeración, payment desacoplado, lente Books e impuesto
  country-agnostic. Gate completo ese día (backup → staging → prod migrate
  plan+apply → worker deploy), evidencia de runs en `_tasks.md § bloque 7`.
- El runtime anterior era `4499848` (planner + identidad, 2026-07-20). Commits
  posteriores que solo cambian documentación o tests no requieren desplegar el
  Worker — ninguno de los dos entra en el bundle; `main` puede ir por delante de
  `/health/live` por esa razón y seguir siendo un estado limpio.

### Git

- Repo: `https://github.com/marcorubiol/hour` (privado).
- Checkout: `/Users/marcorubiol/Developer/hour`.
- Rama principal: `main`.
- Base funcional del runtime: **`a35e8c4`** (money v3), publicada en `origin/main`.
  `origin/main` (tip `f9eb324`, candidate polling) va 1 commit por delante de
  prod. La rama viva `feat/money-v3-build` va 2 commits por delante de
  `origin/main` (`c4f2e3a` estilo MonthGrid + `21da2be` i18n, de Travel v2, sin
  desplegar). **Atención:** el `main` **local** quedó stale — 3 commits de
  identidad sin pushear y 15 por detrás de `origin/main`; `origin/main` es la
  verdad, no el `main` local (reconciliar en frío es higiene, no bloquea nada).
- `wrangler deploy` exige árbol limpio y publica el SHA en `/health/live`.
- **Ramas vivas: una sola.** Las otras ocho se cerraron el 2026-07-20 —
  siete borradas por estar contenidas en `main` o en la punta del stack, y
  `feat/planner-identity` mergeada aquí por fast-forward.
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

`supabase/migrations/` es ahora la historia SQL ejecutable: checkpoint
reconstructivo + marcadores aplicados + migraciones posteriores. Una base
vacía se reconstruye con `pnpm db:reset`, recibe fixtures sintéticos y pasa
120/120 RLS. El SQL histórico anterior vive solo en
`build/migrations/squashed-20260720/` para auditoría.

### Verificación local y contra producción

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

Abrir `_tasks.md`. **Money v3 (ADR-086/087/088) está construido y desplegado en
prod** (2026-07-23, runtime `a35e8c4`, ver `_tasks.md § bloque 7`). Lo que sigue,
por orden:

1. **Follow-up de money v3 (no bloquea):** UX de **enlazar una función nueva a un
   bolo** — las performances creadas en Planner nacen sin bolo hasta que exista.
2. **Travel v2 (ADR-089), EN CURSO:** modelo decidido, nada de schema construido;
   la migración P1 está por escribir. Depende en parte de la tarea 15 (editar una
   fecha desde la UI, que aún no existe).
3. **Contenedores (bloque 5)** y los flecos de planner (editar fecha, multi-día de
   performances, tipos de horario) van después.

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
