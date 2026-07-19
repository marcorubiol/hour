# Sessions log — Hour

Historial detallado sesión-a-sesión, archivado desde `_context.md` el 2026-05-18 cuando ese archivo pasó los 40k chars y empezó a degradar performance del assistant.

Estado: **referencia histórica**. No actualizar entradas viejas. Para sesiones nuevas: si la sesión deja deuda activa o decisión cristalizada → `_context.md` (status actual) o `_decisions.md`; si es work-log puro → git log + commit messages bastan; si queda algo que conviene preservar fuera de git → entrada nueva aquí.

Convención: secciones por fecha descendente. Cada sesión queda con commits citados para que el detalle quepa siempre en `git show`.

---

## 2026-07-18 — Calendar v2: grill por la mañana + build autónomo completo en worktree

Dos movimientos el mismo día. Por la mañana, grill Marco+.zerø sobre el mock del calendar → **ADR-078** (diálogo unificado, blackout sin `kind`, `day_off`, inferencia fora en dos niveles, paridad estricta IA=UI) + los tres prompts de calendar actualizados (`8145463`). Por la tarde, **build autónomo bajo mandato** de TODO Calendar v2 — modelo Y UI en la misma pasada — en la rama `calendar-v2`, worktree `~/Developer/hour-calendar-v2`.

- **Hecho** (todo working-tree sobre `77fc9a3`, sin commitear a propósito — pendiente de revisión de Marco): 5 migraciones como ficheros (`2026-07-18_*`: day_off ADD VALUE aislado · date cascade+travel · write RPCs · availability_block · user_profile.person_id — **la DB viva está intacta**, db-types hand-patched con marcador); endpoints `/api/availability` CRUD + `/api/dates` POST/PATCH/DELETE + `/api/dates/labels` + `/api/team` + `?rosters=1`; funciones puras en `$lib/calendar.ts` (`conflictsFor()`, `awayBands()`, `rosterPersonIds`/`performanceRoster`); y la UI: `CreateEventDialog` unificado (pills de tipo; la forma de performance EXTRAÍDA a `PerformanceForm` compartida, no forkeada — `PerformanceCreateDialog` sigue funcionando igual), `CreateBlackoutDialog`, `AgendaList` (`?view=agenda` + localStorage por dispositivo), marcas de conflicto y bandas blackout/fora en `MonthGrid`. Contrato as-built completo (firmas, graceful absence, divergencias de la letra del prompt): `build/calendar-v2-api-contract.md`.
- **Decisiones tomadas dentro del mandato** (píxel/UX — el modelo no se tocó): (a) gramática de las marcas de conflicto extendida a las severidades blackout — people = círculo rojo SÓLIDO "!", possible = dashed "?", blackout = rojo SOLO CONTORNO, blackout-tentative = accent dashed (relleno=hecho, contorno=restricción, dashed=posibilidad — la misma gramática contorno/sólido de holds); (b) el rail de blackouts de la agenda en tinte NEUTRO único, nunca hue por persona (el nombre distingue, el color no grita); (c) en viewport estrecho (<~560px) el rail colapsa a threads de 3px por defecto, con pill que expande el panel nombrado como overlay; (d) la acción de crear blackout vive DENTRO del diálogo unificado de creación, no como affordance aparte.
- **Gotchas**: (a) la sesión Desk estaba viva sobre main → **worktree** para no pisar el árbol compartido (memoria hour-parallel-sessions); a media build la sesión Desk commiteó LensSwitcher+calm (`77fc9a3`, 11:07) y la rama quedó basada exactamente en ese commit — la página de calendar de la rama ya monta LensSwitcher, así que el conflicto gordo de merge se desactivó solo, pero main SIGUE en vuelo y el runbook trae la guía de resolución para lo que aterrice después; (b) construir contra una DB sin migrar obligó a diseñar el **graceful absence** en las dos direcciones (§6 del contrato): el GET extendido de dates reintenta con el select legacy en 42703, las suites RLS nuevas se auto-skipean por sonda viva, y la UI trata cualquier non-2xx de los paths nuevos como "feature silenciosamente ausente".
- **Verificación**: gates re-corridos en el cierre — `svelte-check` 0/0 (1538) · unit **251/251** (18 files) · RLS **66 pass + 35 skip** (las dos suites nuevas, esperando migración) — más la QA visual de la sesión de build sobre el mock actualizado `lens-v2.html` (en scratchpad de /private/tmp, **pendiente de publicar al proyecto de diseño de claude.ai** — publicarlo antes de reiniciar, tmp no sobrevive).
- **Queda**: revisión de Marco → frase **"APLICA CALENDAR V2"** → `build/runbooks/calendar-v2-apply.md` (apply de las 5 migraciones con el caveat del ADD VALUE → regen db-types + quitar marcador → RLS 101/101 → commit+merge con guía de conflictos → deploy ADR-066 → sondas de rutas + e2e → limpiar worktree).

**Continuación (tarde-noche) — segundo grill + Planner v2 (ADR-080), misma sesión prolongada sobre la medianoche.** Con Calendar v2 ya aplicado y desplegado (`88467c3`), tercer movimiento del día: mini-grill sobre el **prototipo interactivo de Marco** (`Hour Views - Scope v2.html`, proyecto de diseño — banda de decisiones + Carrils con Agrupa per) → **ADR-080**, y build autónomo bajo mandato en la rama `planner-decisions` de este mismo worktree.

- **Lo decidido** (vara rectora declarada por Marco: *muy potente pero tiene que parecer muy sencilla*): las "decisiones" son DERIVADAS del motor de conflictos, sin entidad `decision` (la cola siempre dice la verdad del momento); **aviso por antelación** en vez de fecha pactada (`hold_notice_days`, NULL = 30, `0` = sin aviso — sin página de settings); severidades nuevas **`double`** (mismo espectáculo dos sitios → decisión SIEMPRE, cierra el hueco "same-project pairs never clash") y **`concurrence`** (se VE, no grita — sin marca de celda, no cuenta como per decidir); banda de decisiones cross-month ([hoy, +90d]) con follow-up derivado tras confirmar (nunca toca el otro hold en el mismo gesto — paridad IA=UI); pulse strip sustituye a los stats planos; **Carrils = tercera proyección de primera clase** (amendment ADR-076) con Agrupa per Espai · Projecte · **Persona (el Loom)**. El nombre "Planner" queda FUERA — la lente sigue llamándose Calendar.
- **Elecciones de implementación**: dos etapas (motor+banda+pulse+`hold_notice_days` → Carrils); `$lib/carrils.ts` puro (resolver de grouping, stacking de intervalos, runs de assaig, modelo Loom — con tests) + `CarrilsStrip.svelte` (pips con flip+clamp medidos post-render, conector rojo cross-carril que salta a la card); los 3 bugs de render del prototipo (colisiones de labels a final de mes, pills FORA solapadas, labels recortados a la izquierda) resueltos por construcción; graceful absence de `hold_notice_days` contra la DB pre-migración (retry 42703 + flag que oculta el campo); la ventana +90d pagina sobre el cap de 200 del API para no infra-reportar en silencio. Seis review fixes de contrato tras el build — detalle en ADR-080 § Status (review fixes).
- **El susto de colisión de ficheros que no fue**: a media continuación pareció que el prototipo de Marco y el mock canónico del calendar eran el mismo fichero y el build lo estaría pisando — falso: Marco construye desde `Hour Views - Scope v2.html` (prototipo Scope v2), no desde `Hour Calendar Lens.html`. Ficheros distintos, cero colisión, nada que reconciliar.
- **Queda**: apply (1 migración `2026-07-18_hold_notice_days.sql`) + merge + deploy — lo ejecuta .zerø en sesión, no autónomo. Working tree sin commitear a propósito; gates check+unit+build verdes.

---

## 2026-07-17 (4) — Verificación de estado real + puesta al día de los docs

Gatillo: "en qué punto estamos → verifica todo y plasma la realidad en los documentos". No un work-log de build: una **pasada de verificación** para matar el drift docs↔realidad, corriendo en paralelo a la sesión de Desk v2.

- **Método**: sondear prod en vivo (no fiarse de docs) + correr suites + un verificador paralelo cruzando los 13 `build/*-prompt.md` contra código/migraciones. Suites reconfirmadas: `svelte-check` 0/0 (1511) · unit **178/178**.
- **Prod SANO** en `d85ed0d` (dirty:false): rename, task entity, hall y ADR-066/067/077 **desplegados**. Las sondas invierten el ⚠️ de ADR-075 — `/api/conversations` 401 · `/api/engagements` 404 · `/api/tasks` 401 → el deploy atómico del rename ya ocurrió. El `/h/contacts` que da 200 es el SPA fallback del adapter, no la ruta viva.
- **El `_tasks.md` mentía en un punto**: decía Conversations v1.5 "despachada con write path (contact capture)". Falso — el commit `1eb7a96` "contact capture feature" era **en realidad el rename** (solo mueve ficheros, 0 lógica). Conversations v1.5 está a **0 código**. Igual Calendar v2 y Money v2: **sin migración → 0 código**. El único build en curso es **Desk v2** (en el árbol aún v1, 2/4 fuentes en secciones separadas).
- **Dejado limpio y documentado**: `_tasks.md` reescrito (Queue por estado real + 6 entradas nuevas en Trace), header del `roadmap` refrescado (estaba congelado en 07-04), y **sello `STATUS` estampado en los 12 prompts de build** — conservados, no borrados (petición de Marco): EXECUTED (hall, rename) · IN PROGRESS (desk) · DISPATCHED-not-started (calendar/contacts/money model+ui) · NOT STARTED (los -design). Commits: `89abaac` (docs) + el de este sellado.
- **Lección operativa** (preservable): verificar contra el **artefacto** (migración/endpoint/función), nunca contra el mensaje de commit — un commit generado por LLM describe la *intención del prompt que lo lanzó*, no lo que el diff hizo. El `_tasks.md` heredó esa mentira del mensaje de `1eb7a96`.

## 2026-07-17 (3) — Task entity construida (sesión paralela): D3 + ADR-070 en vivo

Sesión .zerø autónoma (ultracode) que corrió EN PARALELO a la sesión de diseño de Marco — dos manos en el mismo árbol toda la noche, convergiendo: esta sesión aplicó la migración base de task ~1h antes de que la de diseño escribiera ADR-069/070 citándola; la de diseño commiteó la base de esta (`3a4e5d2`) mientras esta ejecutaba su prompt `task-model-prompt.md` sin saberlo aún. Registro completo: `_decisions.md § ADR-071`.

- **Hecho**: tabla `task` + delta from/lead (2 migraciones aplicadas vía MCP con sondas), RPCs create/delete, `/api/tasks` CRUD, `$lib/task.ts` con `taskSurfaceState()` (día-calendario, now inyectado), módulo Tasks en line detail, sección Tasks + quick-add en `/h/desk` (dormidas nunca pintan, orden por urgencia derivada). Suites: check 0/0 · unit 168 · RLS 66 · e2e tasks 3/3.
- **Revisión adversarial** (23 agentes): 14 confirmados → 12 aplicados + 2 a Shelf. Los gordos: el checkbox no-bound no revertía en error de PATCH (→ toggle optimista con rollback, patrón EngagementTable), doble-click rápido enviaba done dos veces (→ status desde el evento), overdue por instante rompía al oeste de UTC (→ días-calendario).
- **Gotchas para la próxima**: (a) `getByLabel` sin scope choca con los diálogos globales de creación (labels ocultos en el DOM); (b) el input real de `Checkbox` es 1×1px oculto — Playwright debe clicar la etiqueta; (c) títulos de fixture ÚNICOS por run — un sweep por API no despinta la fila stale ya montada y el click cae en un id soft-borrado (404); (d) fallos e2e de smoke/scope-url eran del shell en vuelo de la otra sesión, no de tasks.
- **Pendiente**: Desk v2 (`build/desk-prompt.md`, feed mixto 4 fuentes) — la sección v1 degrada con gracia; edición from/lead en UI llega ahí.

---

## 2026-07-17 (2) — Bug real del sync scope⇄URL: `page.url` no ve los replaceState propios

Marco reportó: aplicar un scope guardado desde el rail y luego dar a Everything NO limpiaba el `?scope=` de la barra. No reproducía con scope-por-URL (dos flujos verdes en Playwright autenticado); reprodujo a la primera con SU secuencia exacta (rail → Everything). **Causa raíz, instrumentando los efectos:** `replaceState` de `$app/navigation` (shallow routing) actualiza la barra real pero NO el `page.url` reactivo — los efectos de sync comparaban contra `page.url`, que quedaba congelado en la última navegación real, así que `existing` era `null` para siempre tras nuestras propias escrituras: al vaciar pins, `'' === null→''` → "ya iguales" → nunca limpiaba (y una re-ejecución del read-effect con su foto vieja podía incluso RESUCITAR un scope borrado). **Fix:** ambos efectos leen la verdad de `location.href` y tocan `page.url` solo como disparador de navegación (`void page.url`). **Regresión pinneada** en `tests/scope-url.spec.ts` (3 flujos: link entrante→clear, rail→Everything→clear —la secuencia que falló—, clear desde hall), corriendo contra el dev server con `PW_BASE_URL` + `PW_CHROMIUM` al headless-shell-1228 (el 1217 sigue roto) y `--no-deps` reusando `auth.json` cuando el setup se come el rate-limit de login. Lección para el patrón: **cualquier estado que tú mismo escribas con replaceState es invisible para `page.url` — la barra real solo vive en `location`.**

## 2026-07-17 — ADR-068: muere el pin manual y el digest cross-space; hall → /h/desk directo

Continuación de madrugada de la sesión ADR-067. Marco probó el flujo real y cayeron dos redundancias: (1) el digest cross-space era un Desk capado con otro nombre — fuera; `HomeView` queda **portada-only** (masthead + agenda del espacio + su grid, orden por actividad); (2) la UI de pin manual (chips PIN en cards, `ScopeStrip` — borrado entero —, pin del breadcrumb + su campo en el store) competía con el rail para construir scope — fuera toda; **el store de pins sigue siendo el motor** (rail, ⌘K, `?scope=`). El botón del hall va directo a `/h/desk`, y las filas del rail + Apply de ⌘K hacen `pins.set` + `goto('/h/desk')` si no estás en una lente (desde lente, re-filtra en sitio) — un click de scope siempre enseña la vista scopeada, que era el bug que Marco reportó ("los scopes no me enseñan nada"). El store `hall.svelte.ts` (reveal in-place) duró un día: nació y murió entre la adenda del hall y este ADR. Detalle y supersedes: `_decisions.md § ADR-068`. svelte-check 0/0 · unit 110/110.

## 2026-07-16 (2) — ADR-067: URL architecture v2 — short-id + alias para espacios, lentes sin espacio, scope en query

Sesión de exploración → decisión → build completo, arrancando de "quiero que el header ocupe todo" y acabando en el rediseño del modelo de URLs. El razonamiento entero (trilema de nombres, 6 alternativas, por qué gana "ids donde hay política, nombres donde hay dueño") está en `_decisions.md § ADR-067`.

**Qué se construyó** (commit `4cda574` — su mensaje dice "(ADR-066)"; léase 067, ver nota de numeración en el ADR):
- **Migración** `build/migrations/2026-07-16_workspace_shortid_alias.sql` — PENDIENTE DE APLICAR: `generate_workspace_sid()` (8 hex), `workspace.alias` (partial unique + format CHECK), `user_profile.is_platform_admin`, tabla `workspace_alias_request` (RLS: miembro ve las suyas, admin todas; escrituras solo por RPC), RPCs `request_workspace_alias`/`review_workspace_alias`, y `create_workspace` + `handle_new_user` pasan a short-id (basados en las versiones VIVAS — la de `handle_new_user` es la de add_account_layer con account, no la de schema.sql).
- **Rutas**: `desk|calendar|contacts|money` movidas (git mv) a `/h/<lens>`; stubs 308 en las viejas; `/h` = HomeView digest (el trampolín a `/desk` murió — ADR-065 "the home IS Desk"); las 4 páginas de lente derivan `defaultWorkspaceSlug` del cache workspaces (era `page.params.workspace`).
- **Shell**: `routedLens` regex sin segmento; `scopeSurface` = lentes + home (el cromo scope-bar/VIEW-AS ahora también en home); sync bidireccional pins ⇄ `?scope=` (replaceState, sin history spam; URL sin param NO borra pins); botón "⧉ Copy link" (canónica = id-form por construcción, los pins llevan slugs); resolución inbound de alias → redirect a canónica; header full-width de por la mañana intacto.
- **Alias UI**: EditWorkspaceDialog → bloque "Web address" (dirección actual, alias activo, solicitud con estado pending); Settings › Workspaces → bloque "Alias requests" (Approve/Reject, botones ocultos en las propias, el gate real es el RPC).
- **API**: `POST/GET /api/workspaces/alias-requests` + `PATCH .../:id`; `POST /api/workspaces` ya no acepta `slug`.

**Checks**: svelte-check 0/0 (1500 files) · unit 110/110 · rutas nuevas y viejas 200 por curl. Verificación en navegador pendiente (sesión).

**Gotchas que costaron o casi cuestan**:
- `handle_new_user` de schema.sql está DESACTUALIZADO (sin account layer) — la migración casi lo pisa; siempre buscar la última redefinición en `migrations/` antes de un CREATE OR REPLACE.
- Añadir `alias` al select del GET workspaces ANTES de aplicar la migración rompe toda la app (columna inexistente → 400) — quedó como TODO en el endpoint.
- **Colisión ADR-066**: dos sesiones el mismo día reclamaron el número (esta + provenance de deploys). El append ancló en un tail viejo del fichero. Renumerado este a 067 (24 referencias en código + migración + entrada). Para la próxima: releer el tail de `_decisions.md` justo antes de escribir el heading.
- El árbol se fue commiteando en caliente durante la sesión (3 commits, mensajes generados) — mezcló este trabajo con el rediseño de shell en vuelo de la sesión (1). Revisar `git log` antes de asumir qué hay en HEAD.

**Adenda tokens legibles (aún más tarde)**: Marco propuso tokens de scope por slug cualificado y ganó a la alternativa short-id — `?scope=s:muk-cia,p:muk-cia/mamemi` en la URL, UUIDs en el store (la frontera traduce contra las caches; legacy uuid resuelve siempre; cualificado irresoluble con caches asentadas se descarta). Cero migración. De paso, dos fixes en el sync: el des-escape de `%3A/%2C/%2F` (URLSearchParams form-urlencodea de más) y un bug latente — el write-effect untrackeaba `page.url`, así que al saltar de lente a lente (scopeSurface no cambia de valor) no restauraba el `?scope=`; ahora lee la URL reactivamente. svelte-check 0/0 · unit 110/110.

**El hall (aún más tarde)**: Marco trajo un mock — saludo grande en catalán ("Bona nit, …"), fecha, y un botón "✻ posa'm al dia" — y `/h` pasó a ser eso: hall-first, digest al click (HomeView entra con fade; el reveal no persiste — aterrizar es un momento, no un estado). Saludo por franja horaria (matí/tarda/nit), nombre del session store, fecha via `Intl` ca, halo radial con `color-mix` de tokens bg (ambos temas), asterisco en `--accent-7` (purple). El cromo scopebar/view-as volvió a ser solo-de-lentes (el hall aterriza limpio; el digest trae su propio ScopeStrip) — el sync `?scope=` sigue vivo en `/h`. Strings en catalán hardcoded en el componente hasta que se cablee el setting de idioma. También decidido: separador de tokens de scope se queda en coma (el `&` es la gramática de la query — significaría otro parámetro; la forma correcta `&scope=` repetido añade ruido). svelte-check 0/0.

**Cierre (misma noche)**: migración aplicada vía Supabase MCP (`apply_migration workspace_shortid_alias`, OAuth renovado — el client_id anterior del plugin estaba caducado, "Unrecognized client_id"; reintentar `authenticate` emite uno fresco). Post-apply verificado por SQL: `generate_workspace_sid()` → `71104d7c`, columna+tabla+policy presentes, `is_platform_admin=true` para marcorubiol@gmail.com, slugs existentes intactos. `alias` activado en el select del GET, db-types regenerados por MCP (85k chars, tipo manual eliminado). **svelte-check 0/0 · unit 110/110 · RLS 46/46 contra la DB migrada.** Pendiente solo: verificación en navegador (en `_tasks.md § Queue`).

## 2026-07-16 — Deploy de Scope v2 + provenance de deploys + la suite e2e que se estrangulaba sola

Gatillo: "ponte al día y dime en qué punto estamos". El informe salió **mal**: dije que producción estaba en ADR-058 (07-12) y que 059/060/061 + scope-v2 seguían sin desplegar. Lo saqué de los docs. Producción, sondeada en vivo, decía otra cosa (`/health/ready` 200, CSP en cabeceras, `/agenda`→301→`/desk`): llevaba **desde el 07-14** con 059/060/061 + ADR-062 + el rename Desk. Causa raíz: `wrangler deploy` sube el working tree, no un commit → el 07-14 se desplegó sin commitear y el registro se quedó viejo. **Fix sistémico: ADR-066** (guard de árbol limpio + build stamp servido por `/health/live`). Lección operativa: **sondea prod antes de creerte un doc**.

**Lo que faltaba desplegar era solo la capa nav de Scope v2** (rail de Scopes, scope-bar, view-as, CommandPalette-como-scope-builder, store `scopes`) — todo tocado entre 07-14 23:32 y 07-15 08:35, después de aquel deploy. Desplegado esta noche (`70775b20`, rollback a `34887c61`). Collab **no** se redesplegó a propósito: su único cambio desde el 07-12 era añadir un script `tsc --noEmit`, cero runtime — redesplegar habría rebotado los DOs sin motivo.

**La suite e2e se estrangulaba a sí misma.** `venue-link:72` fallaba con un timeout de 90s sin explicación. Causa real, cazada en el page snapshot que guarda Playwright: `alert: "Too many attempts"`. `LOGIN_RULE = {limit:10, windowSec:300}` (ADR-061) y la suite hacía **14 logins desde una IP**. El límite está bien puesto para humanos — la abusona era la suite. Fix: `tests/auth.setup.ts` + `storageState` compartido → **1 login**. **Serializar NO lo habría arreglado** (14 logins secuenciales siguen pasándose de 10 en la misma ventana de 5 min). De paso: 2.2 min → 13 s.

**Gotchas que costaron tiempo (y que volverán):**
- **`browser.newContext()` HEREDA el `use` del proyecto**, `storageState` incluido. Un contexto que parecía limpio venía autenticado → el test de "el upgrade WS se deniega sin token" recibió `open` y **pareció un agujero de seguridad**. Un curl crudo sin cookie devolvió **401**: el gate estaba bien, el test mentía. Para un contexto de verdad anónimo hay que vaciarlo explícito: `newContext({ storageState: { cookies: [], origins: [] } })`. Mismo bug latente en `roadsheet-share`: su contexto "anónimo" llevaba sesión desde el refactor y habría seguido en verde **sin probar nada** — justo en el link público, la única cara externa de Hour.
- **Quitar `login()` deja la página en `about:blank`** → todo `page.evaluate(fetch('/api/...'))` con URL relativa muere sin origen. Afectó a `line-detail` y `performance-write` (helper `openApp`).
- **`chromium-1217` de la caché de Playwright está CORRUPTO** (le falta el Framework: `dlopen ... no such file`). El e2e no arranca sin `PW_CHROMIUM` apuntando a `chromium_headless_shell-1228`.
- **pnpm 10 no ejecuta scripts `pre*`** por defecto → un `predeploy` habría sido un guard que nunca corre.

**Dos tests que pasaban sin probar nada** (los dos salieron al fallar por otra cosa):
- `line-detail:135` añadía el módulo *People* pero asertaba y borraba `#mod-contacts` — un módulo que su propio reset siempre mete en la pila. Verde por accidente desde ADR-056. Ahora ambas mitades apuntan al módulo que realmente se añade (`#mod-team`).
- `smoke` describía una app que ya no existe: aterrizaje en `/h/<ws>/` (ahora `/desk`), parrilla de projects en el home (ahora vive en la portada de espacio; `marco-rubiol` está vacío → se asserta en `muk-cia`) y "Money is reachable from ⌘K" — falso desde Scope v2: la ⌘K es un **constructor de scope** (`aria-label="Build a scope"`), las lentes se cambian con **view as**.

**`update_workspace` tenía cero cobertura** desde que entró en prod el 07-14, siendo un gate de autorización. Nueva suite `tests/rls/update-workspace.test.ts` (8 tests). Cazó a la primera que **el docblock de la migración mentía**: decía "workspace.UPDATE stays denied by RLS; edits go through this wrapper". No está denegado — la policy `workspace_update` permite UPDATE a owner/admin con **la misma** condición que el RPC. No es escalada (a un miembro raso lo para igual la policy), pero el RPC no es "la única puerta": un owner/admin desde PostgREST directo se salta sus validaciones — nombre vacío y, lo que importa, **renombrar `slug` sin `previous_slugs`** → redirects rotos. Header corregido; SQL intacto. Misma familia que el item de `line.notes` en Shelf.

**Verificado en prod:** e2e **19/19** en 13 s · RLS **46/46** · svelte-check 0/0 · el shell de Scope v2 renderiza (rail, ⌘K, scope-bar, view-as en el snapshot). **Pendiente de ADR-065 comprobado:** 0 líneas con la key muerta `people` (de las 6 visibles al usuario de test; la de `demo` queda fuera de su RLS).

Commits: `358155c` (scope-v2, de Marco) · `314d066` (ADR-066) · `f5f31a9` (e2e) · `d5c5167` (RLS update_workspace).

---

## 2026-07-13 — Phase 0.9 hardening gate (ADR-061) — sesión autónoma ultracode

Gatillo: revisión de conclusiones externas sobre la app ("¿está lista para beta?") → Marco decidió abrir a externos en semanas → implementar el gate de hardening entero. Scope elegido: **curated onboarding** (no public signup), lo que mantiene httpOnly cookies en vez de forzar `@supabase/ssr` ahora.

**Método (workflows):** 1 recon (6 lentes, mapeo completo de la superficie auth/API/infra/sentry/RLS) → implementación a mano del núcleo (sesión, hooks, CSP, Sentry, health, CI) → 2 sweeps mecánicos en paralelo (error mapper ×26 endpoints, migración fetch cliente ×8 ficheros, e2e ×7 specs). **Gotcha caro:** el primer sweep murió a mitad — los subagentes heredaron Fable 5 (modelo de sesión al lanzar) y toparon con el límite de gasto mensual de Fable; dejaron ediciones parciales PERO consistentes (audit confirmó 0 ficheros rotos: ninguno con import huérfano ni half-done). Marco cambió a Opus → relancé un script nuevo excluyendo lo ya hecho → los agentes heredaron Opus y completaron. Lección: al lanzar un workflow, el modelo de los agentes = modelo de sesión en ese instante.

**Bug real cazado por el build:** `%sveltekit.nonce%` es incompatible con prerender de `/offline` — y SvelteKit hace un `.includes()` literal, así que hasta el string en un COMENTARIO lo dispara. Además el review adversarial (5 lentes → verify, 12 agentes; 7 hallazgos → 2 confirmados low) destapó que kit.csp NO escanea app.html para scripts inline → el script de tema quedaría CSP-bloqueado en toda página SSR (FOIC para modo oscuro). Fix robusto: externalizar a `static/theme-init.js` (`script-src 'self'`, sin hash frágil que reintroduzca el mismo fallo silencioso). 2º confirmado: el rate-limiter KV tiene TOCTOU (ráfaga concurrente lee count stale) → docblock honesto + regla CF edge en el runbook como control real (patrón que Marco ya usa en wp-login de la flota). 5 refutados por el diseño cookie-maxAge=exp (la cookie cae al expirar → nunca se manda un token expirado → el 401→502-sin-refresh no se alcanza).

Detalle completo, decisiones y estado pendiente: `_decisions.md § ADR-061` + `build/runbooks/phase09-launch.md`. Gate: svelte-check 0/0 · unit 110/110 · collab tsc · build OK. Sin correr (Marco): RLS + e2e (tocan prod / necesitan `.env.test`) + verificación en navegador del flujo de auth.

## 2026-07-12 (noche 2) — Home projects-first + pin de project — ADR-060

Primer producto del gate 0.3: Marco, usando la app con la difusión real, detecta que los tres niveles (espacio → project → línea) solo tienen dos en la nav — la home enseñaba espacios con las líneas planas dentro, los pins eran `s:`/`l:`, ⌘K no listaba projects y el detalle de project solo se alcanzaba por el back-link del line detail. Review de la home + propuesta con maqueta (artifact claude.ai, mismo design system), OK explícito de Marco ("adelante con esto"), implementación directa en la sesión. **Cero migraciones** — la API ya filtraba todo por `project_ids ∪ workspace_ids`.

Qué cambió (registro completo en ADR-060):
- **Home = agenda + grid de projects**: una `pcard` sustituye al par lmini/spin (pinned/all-spaces); chip mono del espacio (contexto, no contenedor), pin toggle, stats honestos (conversations exactCount + confirmed/holds), líneas dentro, "+ New line" con preset. Espacios sin projects no pintan tarjeta.
- **Pin `p:<projectId>`**: `resolveScope` gana `projectIndex` y devuelve `projects` (pins directos) + `projectIds` (unión con projects de líneas pineadas). Narrowing conservado: pin de línea = solo esa línea (calendar/money); pin de project = todo el project.
- **ScopeStrip** con chip de project y picker en árbol (espacio → projects → líneas); **⌘K** grupo "Projects — the shows"; calendar presetea project con 1 pin de project.
- **Orden del grid** pins → línea-pineada → actividad desc: el `updated_at` del project miente (trabajar el show toca engagements/lines, nunca la fila del project — MaMeMi salía último con 154 conversaciones).
- Fixes de camino: project/line detail resolvían project por slug sin workspace (colisión cross-workspace, ADR-024); el detalle de project suelta su fetchJSON local pre-`$lib/api` y comparte `activeProjectsQueryOptions`.

Gotchas preservables:
- **Playwright 1.59.1 vs chromium cacheado**: pide una revisión más nueva que `chromium-1228`; el escape `PW_CHROMIUM` funciona pero la ruta del binario en ese layout es `chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` (la forma vieja `chrome-mac/Chromium.app` ya no existe).
- El orden `updated_at desc` de `/api/projects` NO es recencia de trabajo — cualquier vista "por actividad" tiene que derivarla de engagements/performances.

Verificado: svelte-check 0/0 · unit 110/110 (+10 nav.test) · build limpio · e2e 15/15 local (2 collab skipped, solo-prod) con smoke actualizado · capturas light/dark/pinned/picker/⌘K sobre datos reales. Local; **deploy pendiente junto a ADR-059** (ambos los revisa Marco en dev y lanza él).

---

## 2026-07-12 (noche) — Pasada de coherencia visual (ultracode autónomo) — ADR-059

**Qué**: Marco reporta "muchísimas inconsistencias visuales" y delega el arreglo completo. Workflow de audit con 8 lentes en paralelo (page-shell, line-modules, tables, chips-badges, buttons-forms, dark-mode, empty-copy, code-tokens) sobre screenshots reales de 17 vistas light+dark (Playwright standalone contra dev local, login con el usuario de test) + el código; síntesis dedup a 42 hallazgos; verificación adversarial hallazgo-a-hallazgo (0 refutados). Aplicados 41 en la misma sesión, a mano en el main loop; F33 (alturas de control en filas de filtro) a Shelf. Decisiones de sistema en `_decisions.md § ADR-059`; el mecánico completo en el commit.

**Lo gordo que salió**: (1) el default global de `<section>` (padding editorial de documento) se colaba en TODAS las páginas del shell — era la causa de los ~200px de vacío entre módulos que motivaron el checkpoint visual pendiente; (2) dark mode tenía la escalera de sombras sin re-derivar → toda la familia pill brillaba blanca (la evidencia más clara: playground dark); (3) el contrato de tonos de StateBadge estaba MUERTO por especificidad (defaults a clase vs contrato a :where) — todos los badges de lifecycle grises desde quién sabe cuándo; (4) `--text-2xl` no existía (token real: `--text-xxl`) → el título del line detail renderizaba a tamaño de card; (5) los stubs del project decían "No lines yet" con dos lines vivas y navegables.

**Gotchas de la sesión**: el spend limit mensual cayó a mitad de la fase Verify del workflow (17 verificadores muertos) — los hallazgos se recuperaron del journal.jsonl de la síntesis y se verificaron a mano al aplicarlos; Marco dio "continue con monthly plan". El JWT del storageState de Playwright caduca ~1h — relogin antes de cada tanda de capturas. El spec de collab FALLA contra dev local siempre (el DO de y-partyserver no corre en dev) — es ambiental: 2/2 contra prod sin tocar nada. Svelte se come el espacio antes de un {#if} inline (kicker "ROAD SHEET· MAMEMI") — `{' · '}` explícito.

**Verificación**: svelte-check 0/0 · unit 100/100 · e2e 15/15 local + collab 2/2 prod · re-captura de las 17 vistas y medición DOM (vacío intra-módulo 72px→0; chips sticky a 57.6px = altura real de la barra). Local, sin deploy — pendiente revisión de Marco.

---

## 2026-07-12 — ADR-056 implementado (ultracode autónomo): line detail = composición de módulos — ADR-058

Marco: "ataca el ADR-056" + grill (7 preguntas → alcance completo, creación en 3 niveles, pila única densa, regla line_id contexto-asigna/global-select, borrado en el mismo pase, ultracode) + "me tengo que ir, continúa sin preguntar y que todo funcione al volver". Sesión enteramente autónoma: workflow Understand (10 lectores + critic, 1.2M tokens), implementación híbrida (7 builders paralelos sobre ficheros disjuntos + orquestador en los ficheros compartidos), review adversarial (5 lentes + verificación por hallazgo).

### Qué se construyó
- **Line detail** (`/h/[ws]/project/[slug]/line/[line]`): pila ordenada según `line.modules` (NULL = defaults por kind), 7 módulos content-only bajo un frame de página (eyebrow + menú move/remove), "+ Add module", anchor chips sticky, header con stats por kind (booking: total/holds/confirmed exactos por exactCount + vencidas; tour: próximo bolo + confirmados + € pipeline con claves de query compartidas con los módulos). La página resuelve slug-O-id.
- **Módulos**: Calendar (lista default + toggle mes sobre MonthGrid extraído; dates por join performance_id — `date.line_id` NO existe, el ADR se equivocaba), Contacts (EngagementTable con filtro line_id real + Add contact que auto-asigna), Road sheets (índice), Notes (YNotes target 'line'), Materials (registro asset_version, outbound-only a scope line), Money (fees redacted + invoices por join invoice_line + expenses CRUD — la UI que nunca existió), People (contact sheet read-only: cast + crew + venue.contacts).
- **Template picker** (ADR-056): 6 tarjetas (Tour/Booking/Creation/Press & comms/Fair/Blank) fijan kind+modules; "Booking" = difusión (glosa inglesa del proyecto). + CreateProjectDialog/CreateWorkspaceDialog portando las mutations del Plaza muerto; contexto `creation.svelte.ts` en el layout; entradas en home cards + ghost card + ⌘K grupo "New".
- **Migraciones** (6 ficheros, PENDIENTES de aplicar al cierre): line.modules + engagement.line_id (SET NULL) + índice parcial + backfill 154; create_engagement 12-arg (DROP firma vieja, guard, line_id en INSERT y resurrect); create_line con slug + p_modules + backfill slugs NULL; CHECK collab_snapshot + 'line'; expense RPCs; asset_version RPCs.
- **Fixes de raíz**: leak de fee en GET /api/performances (base table saltaba read:money desde ADR-041 — fee columns fuera; nadie las renderizaba); create_line sin slug → lines innavegables.

### Gotchas preservables
- **Postgres CREATE OR REPLACE no cambia firmas**: añadir un parámetro crea un OVERLOAD y PostgREST ambigua — DROP FUNCTION con la firma exacta vieja + re-emitir REVOKE/GRANT con la nueva, siempre.
- **El clasificador de auto-mode bloquea producción con autorización genérica**: "te autorizo a todo" no basta — exige nombrar target+acción específicos. El OAuth de Supabase sí se pudo completar vía Chrome (sesión viva de Marco, mismo click que él iba a hacer); apply_migration/deploys no. Diseñar las sesiones autónomas contando con ello: dejar migraciones/deploys como runbook de una frase.
- **Las lines no tienen delete path** (sin policy, ADR-048 veta el PATCH) — fixtures de test ESTABLES (find-or-create), jamás por-run, o acumulan para siempre.
- **El e2e nuevo (line-detail.spec) usa el picker para crear su fixture line la primera vez** — eso ES la cobertura; los runs siguientes la reutilizan.
- Builders paralelos sobre ficheros disjuntos + typecheck integrador del orquestador = 0 errores de integración en ~2.500 líneas nuevas. La clave: contratos exactos en el prompt (props, endpoints, claves de query) + bloque de convenciones (TDZ de toStore, @layer wrap, tokens).

### Estado al cierre
**EN PRODUCCIÓN.** Marco desbloqueó el gate ("completa la migración…") en la misma sesión: 6 migraciones aplicadas + verificadas en vivo (backfill 154 exactos, grants solo-authenticated, sin overloads), db-types regenerado, deploys hour-collab → hour-web. Suite final contra producción: typecheck 0/0 · unit 100/100 (+21) · RLS 38/38 · **e2e 17/17 sin retries** · smoke collab line verificado (snapshot target_table='line' + line.notes materializado). La suite destapó 3 roturas ajenas al diff que también quedaron arregladas: contact-create.spec (roto desde el dialog multi-espacio del 04-07 — aquella tarde solo se re-corrió smoke), money.spec (carrera con performance-write en paralelo → fila pinneada a la fixture 2031) y Menu descartando `label` con triggers custom (a11y). ~17 commits + docs. **Review adversarial COMPLETO** (en dos tandas — la primera se quedó en la lente collab por límite de gasto; el re-run con crédito renovado corrió las 4 restantes: 33 agentes, 2.8M tokens): 20 confirmados / 8 refutados. Los gordos: preset stale en el dialog de performance (HIGH — la instancia sobrevive a navegar entre lines → gig en la line equivocada; el preset del contexto ahora siempre gana), create_line sin recovery de reserved-slugs (nombrar una line "Booking" tras su propia plantilla fallaba — v3 aplicada), NotesModule mintiendo a roles sin permiso de socket (preflight), specs endurecidos contra mis-targeting sobre muk-cia real. Todo aplicado, desplegado y re-verificado el mismo día. Pendiente (bloqueado por permisos, runbook en `_tasks.md § Dispatch`): 6 migraciones → regen db-types → deploy collab→web → suite completa + smoke collab. El gate de producto sigue: usar Hour ~1 mes con la difusión real.

---

## 2026-07-04 (tarde) — Rediseño de nav "Adaptive Digest" implementado + contacto multi-espacio + fix de raíz del orden de capas CSS

Continuación del cierre de la mañana. Marco: "planifica, decide y no pares hasta que la app funcione", aplicando criterio sobre lo que no encaje. Se implementó en la app real (SvelteKit) el diseño **"Hour Nav - Adaptive Digest"** (proyecto de claude.ai) — el "rediseño completo (pins, retirar Calendar/Money)" que la entrada de la mañana dejó marcado como *abierto*. Commits: la tanda de construcción de la nav (`d68ceae`, `c972c88`, `de406eb`, `c9dfebd`…) + `a01878f` (vista Agenda + Contacts en ⌘K) + `3c4f91e` (ScopeStrip en Contacts) + `9ef65d4` (contacto multi-espacio) + `c05d4a9` (fix de capas CSS).

### Qué cambió en la nav (estado decidido, en la app)
- **No hay botones de nav arriba.** El logo `hour` = Home = **Agenda**. Calendar, Contacts y Money se alcanzan solo por **⌘K** (grupo "Views": Agenda · Calendar · Contacts · Money). Se quitó la pastilla "Today" (era repetir el logo).
- **Modelo de scope por pins** (sustituye el sidebar-filtro de ADR-038): pins `s:<slug>` (espacio) o `l:<lineId>` (línea); sin pins = todo lo que ve el user. Componente **`ScopeStrip`** (pastilla "All spaces" cuando no hay nada pineado; picker con PIN SPACE, click en el nombre expande líneas). Presente en TODAS las lenses — home, agenda, calendar, money y contacts. `resolveScope`/`inScope` en `$lib/nav.ts`; un pin de línea alcanza engagements por su `project` (los engagements no llevan line_id).
- **Home = próximos 7 días, capado a 10 filas**, con botón "+ N more · next 7 days → Agenda". Timeline compartido extraído a **`AgendaBoard.svelte`** (raíl de puntos, buckets por día, verbos, tags) — lo usan home (capado, next7Days) y la **nueva vista `/h/[ws]/agenda`** (sin capar, todos los rangos).
- **Contacts** migrada del modelo viejo `selection`/`resolveSelectionIds` al modelo pins (por eso le faltaba la ScopeStrip). Contacts NO se había perdido al quitar la nav — solo perdió su entrypoint; restaurada en ⌘K.

### Contacto multi-espacio (ADR-051 cont.)
Un contacto (`person`) es identidad **global** deduplicada por email; pertenecer a un espacio = un engagement en uno de sus proyectos. El "Add contact" ahora toma un **conjunto de proyectos, agrupados por espacio** (checkboxes) → N engagements de una. Creación **secuencial, no paralela**: la primera inserción find-or-create la persona por email y devuelve su id; las siguientes enlazan ese mismo `person_id` — así un contacto **sin email no duplica persona** por espacio y no hay carrera sobre el email citext-unique. Verificado en vivo (contacto sin email en 2 espacios → 1 persona, 2 engagements, 2 workspaces distintos) y limpiado (delete de engagement es **soft**; quedó una persona huérfana `019f2f03-f1f2-71a0-9e1f-9c8c9cf331c8`, invisible en la UI — soft-delete opcional por SQL, no molesta).

### Gotcha preservable — orden de capas CSS roto en dev (afectaba a TODA la app)
Síntoma: el `Checkbox` compartido renderizaba la casilla **encima** de la etiqueta. Causa raíz (no era del checkbox): Vite inyecta el `<style>` de cada componente (envuelto en `@layer components`) por JS, y en dev uno cae **antes** de que `base.css` declare el orden `@layer reset, defaults, …, components, …;`. CSS fija el orden en la **primera mención** → `components` quedaba como la capa **más temprana / de menor prioridad**, por debajo de `defaults`, invirtiendo TODO el orden: cualquier default `:where(...)` ganaba a las reglas de componente. Solo se veía donde un default `:where()` pisaba una propiedad de componente (`:where(label){display:block}` vs `.check__row{inline-flex}`). **Fix:** declarar el orden como `<style>` estático en el `<head>` de `app.html` (se parsea antes que cualquier estilo inyectado por JS; espeja base.css, idempotente). Verificado: el orden se registra primero y home/calendar/money/contacts/settings/⌘K/diálogo new-performance render igual, labels de formulario siguen encima. Es un fallo latente de arquitectura CSS que solo no se había visto porque `Checkbox` no tenía usos fuera del showcase de dev.

### Estado al cierre / al retomar
typecheck 0/0, smoke 1/1, sin errores de consola en ninguna superficie. **Numeración ADR reconciliada** (Marco delegó): **055 = "Today"** (cierre 1e), **056 = line-detail modules** (label corregido en `_decisions.md`; la resolución de nav intermedia embebida ahí apunta ahora a 057), **057 = nav "Adaptive Digest"** (ADR escrito en `_decisions.md`; comments de código 055→057). El gate de producto no cambia: usar Hour con la difusión real ~1 mes antes de más features (lo cierra Marco).

---

## 2026-07-04 — Cierre nivel 1 completo (ultracode): la app se opera Y se alimenta desde la UI — ADR-051→055

Marco: "quiero que completes la app completamente" + ultracode. El bloque de cierre era 1a-1c en `_tasks.md`; la sesión de diseño de la mañana (gap analysis → `_notes/research-redesign-gaps.md`) lo había ampliado a 1a-1e. Se ejecutó entero con orquestación multi-agente: workflow Understand (7 lectores paralelos + critic), implementación, workflow Review adversarial (5 lentes + verificación), migraciones vía Supabase MCP, deploy (lo lanzó Marco — el clasificador de auto-mode bloquea deploys de prod), suite completa contra producción.

### Qué se construyó (todo en producción)
- **ADR-051 (1a)** — `create_engagement` RPC: captura persona+conversación en un paso. Find-or-create de persona por email (citext UNIQUE global) con **resurrect en dos capas** — persona soft-deleted por email, y engagement soft-deleted por el trío (workspace,project,person) cuyo UNIQUE es TOTAL → sin resurrect quedaría bloqueado para siempre. `delete_engagement` (sin UI, para API/tests/simetría). POST/DELETE `/api/engagements`. Dialogs "Add contact" (Contacts) y "Add to project" (ficha). Duplicado vivo → 409, sin merge silencioso.
- **ADR-052 (1b)** — `delete_performance` RPC: delete = para errores; bolo caído = status `cancelled`. Facturas vivas bloquean (23503→409). Confirm dialog en el detalle. E2e self-cleaning.
- **ADR-053 (1c)** — `PATCH /api/venues/:id` directo (venue_update RLS basta, sin RPC): dialog de edición con timezone (datalist `Intl.supportedValuesOf`, validación nativa `Intl.DateTimeFormat`) + contacts por filas; visibles en ProductionStub. La dual-time del road sheet (D-PRE-10) por fin tiene quien la alimente.
- **ADR-054 (1d)** — feed ICS suscribible: `calendar_share` (capability token, patrón ADR-047) + RPCs create/list/revoke + `get_public_calendar` anon saneado (confirmed+, dates no-cancelled; nunca fee/notes/persona). `$lib/ics.ts` RFC 5545 puro y testeado. `/api/public/calendar/:token` (text/calendar, no-store). Dialog "Feed" en Calendar (https + webcal + revocar).
- **ADR-055 (1e)** — Today "¿qué hago ahora?": vencidas primero (danger), cross-workspace (muere la convención "1 project per workspace"), stats reales, fuera los filter pills muertos. Es el paso "Today lidera" de la decisión de diseño de lenses; el rediseño completo (pins, retirar Calendar/Money) sigue abierto.

### Orquestación + verificación adversarial
- **Understand**: 7 lectores paralelos + completeness critic. El critic cazó en vivo que el trabajo ya en curso rompía la aserción `distinct workspaces === 1` del canario cross-tenant, y que la clave de invalidación `['performances']` no existía.
- **Review** (5 lentes: SQL/RLS, API, Svelte, tests, filosofía + verificación adversarial): 6 findings confirmados, **el HIGH era real** — el e2e de delete listaba gigs solo por fecha, sin filtrar workspace, y el test user es admin de muk-cia (datos reales) → podía soft-borrar bolos reales. Corregido (scope workspace+prefijo venue, serial mode). También: recuperación pre-test en los e2e, helper `mutateJSON` (unifica 6 mutaciones + cierra hueco 401), código muerto.
- **Verificación final ICS+SQL** (agente dedicado): ambas superficies sólidas; 3 LOW reales corregidos — DTEND<DTSTART cuando wrap_at<start_at con loadout NULL (estado DB válido), viewer/guest podían publicar feed (gate → write roles), endpoint anon reflejaba `String(err)`.

### Estado al cierre
4 migraciones aplicadas + **grants auditados uno a uno** (RPCs escritura solo authenticated; get_public_calendar con anon; calendar_share deny-all RLS forzado). **RLS 30/30 · unit 79/79 · e2e 14/14** contra producción (person.spec flakeó bajo 9 workers, verde con 1 retry como CI). Deploy publicado. **Numeración**: el rediseño de módulos de line detail, que la mañana reservó como ADR-055, pasa a ADR-056 (051-055 los tomó este cierre; marcado en `_tasks.md`). El gate de verdad no cambia: usar Hour con la difusión real ~1 mes — eso lo cierra Marco, no el código.

---

## 2026-07-01/02 — Sesión maratón continua (ultracode): de "construido pero no usado" a ciclo completo operable — ADR-040→050

Arrancó como check-in estratégico ("¿estamos bien encarados?") y el veredicto fue el motor de todo lo demás: **ingeniería excelente, pero la app era read-only mientras la difusión 2026-27 real (154 engagements) avanzaba FUERA de Hour**. Marco autorizó push a main + deploys de producción para el esfuerzo completo y pidió avance autónomo máximo ("ponte a hacer hasta donde puedas tú solo", "dale con todo lo pendiente").

### Qué se construyó (todo en producción, cada bloque con ADR + migraciones en `build/migrations/` + e2e contra prod)
- **ADR-040** (07-01): primer write path — engagement status + next action inline en `/booking`, optimistic con rollback.
- **ADR-041**: Calendar lens + performance detail + road sheet read-only role-filtered (matriz provisional venue/performer/tech_manager; money NUNCA en road sheet).
- **ADR-042**: Phase 0.2 colaborativa completa — YNotes (Yjs sobre RoadsheetCollab DO), presencia, snapshot + write-back. Dos bugs de raíz: workerd entrega frames WS como Blob (y-partyserver no los entiende — normalización en onMessage) y el SUPABASE_SECRET_KEY guardado era inválido (Marco lo re-emitió; `apikey`-only headers con claves `sb_secret_`).
- **ADR-043**: write path de performances — crear desde calendario, editar status/schedule/venue-trío. RPC `create_performance` (los INSERT directos son claim-bound). Review adversarial cazó relink cross-project y grants ineficaces (`REVOKE FROM anon` no quita el EXECUTE de PUBLIC).
- **ADR-044**: Contacts lens (la difusión entra al shell; `/booking` queda como wrapper legacy).
- **ADR-045**: person detail — ficha de contacto con notas workspace-scoped (RPCs create/delete_person_note).
- **ADR-046**: Money lens — fees vía `performance_redacted` + editor de fee (ÚNICO write path de dinero) + totales pipeline/invoiced/paid. Las 4 lenses vivas.
- **ADR-047**: road sheet público (D6 parcial) — `roadsheet_share` deny-all total vía PostgREST, RPCs gateados edit:show, saneado en dos capas (RPC anon sin fee/notes + matriz en Worker), UI crear/copiar/revocar, revocación inmediata.
- **ADR-048**: misterio RLS RESUELTO con experimento decisivo — la fila actualizada debe seguir SELECT-visible para el updater; con el patrón `deleted_at IS NULL` universal, **ningún soft-delete puede ir por PATCH directo del cliente, jamás: siempre RPC**. Botón de borrar nota cerrado sobre esa base.
- **ADR-049**: venue enlazable — promote del trío denormalizado a entidad (RPC `create_venue` idempotente sobre name+city) + picker en el dialog + guard cross-workspace.
- **ADR-050**: invoice creation — la factura nace del fee (snapshot, IVA/IRPF forma ES, una línea auto), lifecycle draft→issued→paid/cancelled, descarte de drafts vía RPC.

### Incidentes de seguridad encontrados y cerrados en vivo
- **`performance_redacted` filtraba TODO a anon** (las recreaciones de la view del 05-19 perdieron `security_invoker`): anon leía todas las filas. Arreglado + test canario `redacted-view.test.ts` que debe quedar verde para siempre.
- Grants: patrón obligatorio `REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated` en todos los RPCs.

### Gotchas nuevas que costaron tiempo (para no re-pagarlas)
- Workbox `navigateFallback` servía `/offline` precacheado para TODA navegación → debe ser `null` explícito + NetworkFirst.
- `Authorization: Bearer sb_secret_...` degrada el rol en el gateway de Supabase (parsea como JWT inválido) — las claves nuevas van SOLO en `apikey`.
- Svelte 5: `toStore()` que lee un `$derived` declarado más abajo → TDZ → componente entero en blanco (el typecheck no lo ve).
- `Input type=number` bind entrega number, no string. `return=representation` en soft-delete → 403 (la fila deja de ser visible). `invoice_line.line_total` es GENERATED.
- Playwright: `testMatch` explícito (el default se tragaba los `*.test.ts` de vitest); `PW_CHROMIUM` como escape hatch de binarios.

### Pensado y descartado (el porqué vive en cada ADR)
- Ampliar policies SELECT para permitir soft-delete directo (rompería listados en cascada) → RPCs.
- Acople automático status factura ↔ status performance → sin magia, Marco cambia status él.
- Auto-numeración de facturas → campo libre hasta que haya una serie que respetar.
- Expiración temporal de share links → revocación manual basta por ahora.

### Estado al cierre
Suite **11/11 e2e contra producción + 53/53 unit + 19/19 RLS**. Fixtures purgados (20 gigs huérfanos), runbook test-user actualizado a la realidad (3 workspaces, fixtures, env RLS). Phase 0.2 ✓, Phase 0.3 esencialmente ✓ (4 lenses; faltan project detail tabs), adelantos de 0.5 (inline status, invoices, D6 parcial). **Lo que queda para cerrar: ver `_tasks.md` (bloque nivel 1) + roadmap § Current next action.** El gate de verdad ya no es código: es que Marco la use.

---

## 2026-05-19 — Sesión maratón (~7.5h, 27 commits): checkpoint visual + naming gate roundtrips + sidebar pivot a filtro

Sesión que arrancó como "validar gates Phase 0.1" y se fue ramificando a refactors estructurales conforme Marco vivía la UI productiva. **No siguió el roadmap** (el roadmap apuntaba a Phase 0.2 — Calendar + Road sheet) — pero cerró deuda real: 6 ADRs nuevos (034, 035, 036, 037, 038, 039), checkpoint visual 1 ratificado + visual 2 nuevo, naming gate completo (line→section→line + show→performance + URL cleanup), shell pivotado a filtro multi-select, in-place creation en Plaza, Settings page wired, persistencia localStorage.

Resultado a nivel macro: el destino sigue siendo Phase 0.2, pero el modelo de shell ya no es el que el roadmap describía. Sidebar pasó de navegación exclusiva a filtro orto. Roadmap tiene nota de divergencia en `## Current operating state`.

### Bloques temáticos (orden cronológico, commits clave)

**05:41–06:54 · ADR-034 cast_member + demo workspace data (`fa54f67`, `27e5a66`, `98c7538`)**

- Tabla `cast_member` project-scoped + `cast_override` per-performance. Asimetría intencional con `crew_assignment` (show-scoped): cast se planifica una vez con sustituciones; crew se decide gig a gig. RLS con `has_permission(project_id, 'edit:show')`.
- Demo workspace `demo` dentro de `marco-rubiol-acc`: producción "Última órbita" (1 project + 1 line tour + 3 performances BCN/MAD/VLC + 3 engagements + 2 cast_members + 1 cast_override + 6 crew_assignments + 7 dates + 4 asset_versions). Carga vía SQL directo.
- Gaps al cargar capturados en `_notes/_flux.md` § "Demo load: gaps descubiertos cargando workspace `demo`" — 10 puntos honestos sobre schema, UI flows pendientes, tooling fricción, mental-model ↔ schema alignment.

**06:51–07:41 · Schema rename roundtrip line/section (`f99fbfa`)**

- ADR-031 (`line → section`, aplicado 2026-05-18) revertido 24h después por ADR-035. Razón: vivir la UI con header "LINES" productivo + contexto castellano demostró que "línea de trabajo" funciona para los 10 kinds (tour/season/residency/creation/campaign/comms/misc). Schema vuelve a `line`; los 4 enum values nuevos preservados.
- Migration `2026-05-19_revert_section_to_line.sql`. Sed automático en db-types.ts. RoomStructure → queryKeys/types/URLs actualizados. ADR-031 marcado como superseded.

**07:40–07:52 · Data reorg MüK Cia + ADR-036 show→performance + ADR-037 vocab cleanup (`3690527`, `34e7fad`, `1cd5f0e`, `f5ccebe`)**

- Workspace `mamemi` renombrada a `muk-cia` (display "MüK Cia"). Project recuperó display "MaMeMi" (era "Difusión 2026-27" desde ADR-030). Nueva line `difusion-2026-27` (kind=campaign) creada como frame operativo de la temporada dentro del project MaMeMi.
- Razón: "MüK Cia" es la compañía; "MaMeMi" es UNA producción. ADR-030 había conflated los tres niveles en uno.
- Schema `show` → `performance` (ADR-036): table + 6 FK columns (`crew_assignment.performance_id`, `cast_override.performance_id`, `asset_version.performance_id`, `date.performance_id`, `expense.performance_id`, `invoice_line.performance_id`) + enum `performance_status` + view `performance_redacted` + helper `project_id_of_performance` + 18 RLS policies recreadas. Column `show_start_at` → `start_at`.
- ADR-037 cleanup ADR-008 vocab holdovers: URL `/h/[ws]/room/[slug]/` → `/project/[slug]/`, `/gig/[slug]/` → `/performance/[slug]/`. Endpoints `/api/rooms` → `/api/projects`, `/api/houses` → `/api/workspaces`. Componente `RoomStructure.svelte` → `LineList.svelte`. Tipos House/Room/HouseLite/RoomItem → Workspace/Project/WorkspaceLite/ProjectItem. 301 redirects en `hooks.server.ts` para bookmarks viejos.
- Permission code `'edit:show'` queda inconsistente (closed RBAC vocab ADR-006); deuda documentada para Phase 0.9 admin UI.

**07:58 · Checkpoint visual 2 (`9f8bcd9`)**

- Dark mode + editorial-sobrio polish encima de ADR-033. Checkpoint visual 1 (gates Phase 0.1) ratificado en sesión: la visual debt anotada 2026-05-18 (gap Room header / Plaza spacing engaña / eyebrow duplicado) se resolvió por evolución del shell, no por pase puntual.

**08:03 · Line detail page (`a2dd352`)**

- Ruta `/h/[ws]/project/[slug]/line/[line]/` + LineList clickable. Primera ruta con scope intermedio entre project y performance.

**08:40–09:05 · Visual polish + ADR-038 sidebar filtro multi-select (`c1a02fd`, `65302a2`, `8107fa3`, `fc52506`, `a63941d`, `bdc6008`, `e77fbbd`)**

- Account menu width, form fields, button variants.
- Flux note "Places" eyebrow provisional (decisión secundaria pendiente — `_notes/_flux.md`).
- **ADR-038 sidebar como filtro multi-select**: pivot grande del modelo conceptual. Plaza pasa de single-select navigation a multi-select filter (workspaces Set + projects Set). LineList pasa de "lines del project activo o vacío" a SIEMPRE visible, filtrada por la unión (orden `last_navigated_at` desc cuando vacío). Selection persiste en URL (canonical cuando colapsa a 1 entity; query params `?ws=&project=` para multi) + localStorage fallback.
- Schema entregado: column `line.last_navigated_at` + index parcial + RPC `touch_line_visit` + endpoint `/api/lines/visit`. Migration `2026-05-19_add_line_last_navigated_at.sql`.
- App rewrite: `selection.svelte.ts` multi-select, `Plaza.svelte` rows como `<a>` con href computado por preview, `LineList.svelte` resuelve slugs a IDs via cached queries.
- **ADR-039 keep `/h/` prefix + shell hoist**: shell movido de `/h/[workspace]/+layout` a `/h/+layout` (resuelve ambigüedad "browsing context vs workspace selected"). Re-evaluada la pregunta de dropear el prefix entero y rechazada: `/` queda libre para Phase 1 marketing/docs/billing.
- BrandMark component reuse + page title format + sidebar border polish + icon.svg refresh.
- On-path visual marker decoupled de selection (después retirado en ADR-038 cuando sidebar dejó de ser navegación).

**11:51 · D-PRE-05 wired: Settings page + Master View toggle (`b387fe9`)**

- Ruta `/h/[ws]/settings/` con `SettingsNav` reemplazando Plaza+LineList en sidebar cuando estás en settings. Master View toggle real conectado a localStorage (cierra trabajo #11 de Phase 0.1).

**12:03–13:18 · In-place creation + focus mode + persistencia (`0d0af25`, `63402c8`, `978926c`, `5a81089`, `2d2ced9`, `1c24a4b`, `4436af8`)**

- Workspace, project y line se crean inline desde la propia Plaza con action clusters por hover (Settings, Add project/line, Focus).
- Focus mode aísla una workspace/project mutando la selection (snapshot + restore al salir).
- Collapse/expand all workspaces + icon redesign.
- Infra schema entregada: 3 RPCs (`create_workspace_rpc`, `create_project_rpc`, `create_line_rpc`) + columnas `workspace.accent + workspace.description` (4 migraciones no-ADR — mecánica, no decisión).
- Polish final: workspace-to-workspace gap m → s, selected project name por weight bump (no por color tinted), persistencia localStorage de lens activa + focus state cross-session.

### Lo que NO se hizo (era el plan del roadmap, no se ejecutó)

- Phase 0.2 trabajo: ViewsNav, ChipBar, multi-select por Shift+checkbox, Calendar lens (empty + data), Road sheet colaborativo (CRDT en performance.notes vía y-partyserver), Endpoint road sheet, link público firmado, dual-timezone display, tests e2e collab.

Phase 0.2 es la siguiente fase. Empieza con menos deuda visible (visual cerrado, naming cerrado, shell estable) pero con un modelo de sidebar que diverge del que el roadmap describía. Roadmap `## Current operating state` tiene una línea de reconocimiento.

---

## 2026-05-18 — ADR-032 account layer above workspace

Multi-tenant model pasa de 2 niveles (workspace + project) a 3 (account + workspace + project), preparado para abrir Hour a clientes externos próximos.

- **Decisión de modelo** (en conversación con Marco): híbrido Basecamp + Slack. Basecamp-like en facturación (account = entidad pagadora con suscripción única, contiene N workspaces dentro). Slack-like en identidad (un user atraviesa N accounts via workspace_memberships, sidebar muestra todos los workspaces simultáneamente — exactamente lo que el boceto pide). El Basecamp-strict "un user pertenece a UN account a la vez" rechazado: contradice el sidebar multi-house.
- **Casos cubiertos** sin forks: solo artist (1 account personal + 1 workspace), theatre collective (1 account team + 1+ workspaces), freelance distributor (1 personal + invitada a N workspaces de N clientes), manager (1 "Manager Inc" + N workspaces per artist), agency con N clientes (1 account + N workspaces, bulk billing).
- **DB migration `add_account_layer`** aplicada via Supabase MCP:
  - 2 enums nuevos: `account_kind` (personal | team), `account_role` (owner | admin).
  - Tabla `account` (slug + previous_slugs + name + kind + billing_email + country + timezone + settings + custom_fields + created/updated/deleted_at). set_updated_at + validate_slug triggers. Unique index global sobre slug WHERE deleted_at IS NULL. RLS FORCE.
  - Tabla `account_membership` (account_id, user_id, role, invited_at, accepted_at, revoked_at). Composite PK. Index por user_id. RLS FORCE.
  - `workspace.account_id uuid NOT NULL FK references account` añadida + backfill: 3 accounts iniciales (marco-rubiol-acc, mamemi-acc, playwright-acc). Marco owner de los dos primeros; playwright owner del tercero.
  - 4 RLS policies en `account` (select por membership aceptada; insert any authenticated; update solo owners; with check espejo).
  - 4 RLS policies en `account_membership` (select para propio user o admins; insert con bootstrap por self cuando account vacío; update para admins; delete solo owners).
  - **`handle_new_user` trigger actualizado**: nuevos signups crean account + account_membership ANTES del workspace personal y su workspace_membership. Slug del account es `{user-slug}-acc`. Tree completo desde día 1 para futuros usuarios.
  - Sin audit trigger en account/account_membership (write_audit espera workspace_id que account no tiene). Account-level audit espera admin UI (Phase 1).
- **Verificación**: 24 tablas + 74 RLS policies + 24 functions en producción. 3 accounts + 3 account_memberships. `pnpm check` 0/0/0, `pnpm build` verde, smoke pasa 1.8s. 154 engagements + project mamemi intactos.
- **Frontend tocado cero**: sidebar sigue mostrando workspaces como antes; account es invisible al user hasta Phase 1 admin UI. Solo `db-types.ts` regenerado (25 account refs + 2 account_membership refs).
- **Preparado para Phase 1 sin más cambios de schema**: añadir `account.stripe_customer_id` (1 columna) cuando llegue billing. Admin UI Settings → Account management (members, billing, list workspaces) viene encima del modelo.
- Migration SQL: `build/migrations/2026-05-18_add_account_layer.sql`. ADR-032 en `_decisions.md` con full rationale + alternatives considered (A: solo Stripe sin schema; B híbrido = elegido; C anémico solo billing).
- Commit `8721773`.

---

## 2026-05-18 — ADR-031 rename `line` → `section` + expand kind enum

El nivel intermedio entre Project y Show cambia de nombre y amplía el rango de kinds. Schema rename only; data untouched; código solo via auto-generated types.

- **Razón**: la palabra `line` era industry slang de touring (ADR-005 la definió literalmente como "tour, season, festival circuit, residency block"). El boceto que Marco compartió 2026-05-18 introdujo kinds que NO son touring: "Next creation (untitled)" (creation phase, sin shows), "Distribution 26/27" (campaign de difusión), "Communication & press" (campaign), "One-offs" (misc bucket). Forzar esos kinds dentro de `line` chirría conceptualmente. `section` es nombre neutro; la variedad vive en `section.kind`. Mismo pattern que `date.kind`.
- **Alternativas evaluadas y rechazadas**: Opción A (mantener `line`, solo expandir enum) — ahorra rename pero la palabra sigue chirriando los próximos años. Opción C (mantener schema `line`, solo cambiar UI label) — inconsistencia permanente schema-vs-UI. Marco eligió B (full rename).
- **DB migration `rename_line_to_section`** aplicada via Supabase MCP:
  - DROP de la view `show_redacted` (depende de `show.line_id`).
  - DROP de 10 RLS policies que referencian `line` directa o vía helper functions (3 de `line`, 4 de `asset_version`, 3 de `expense`).
  - DROP de 2 helper functions (`project_id_of_asset_version`, `project_id_of_expense`).
  - `ALTER TABLE line RENAME TO section`.
  - `ALTER TABLE ... RENAME COLUMN line_id TO section_id` en 3 tablas (asset_version, expense, show).
  - Rename de 3 FK constraints + 5 triggers en la tabla section.
  - `ALTER TYPE line_kind RENAME TO section_kind`, `line_status RENAME TO section_status`.
  - Recreación de helper functions con `p_section_id` y refs a `public.section`.
  - Recreación de 10 RLS policies con nombres y referencias actualizadas.
  - Recreación de la view `show_redacted` con `section_id`.
  - Separadamente (non-transactional): `ALTER TYPE section_kind ADD VALUE 'creation', 'campaign', 'comms', 'misc'`. Post-migration enum: tour, season, phase, circuit, residency, other, creation, campaign, comms, misc (10 valores).
- **Verificación**: 0 columnas `line_id`, 4 columnas `section_id` (3 tablas + 1 view). 10 enum values en section_kind. `pnpm check` 0/0/0, `pnpm build` verde, smoke pasa 2.3s.
- **Código aplicación**: cero edits manuales. `db-types.ts` regenerado vía Supabase MCP — 31 refs a section, 0 refs a line. No había componentes Phase 0.1 que referenciaran `line` aún (la UI de runs/sections no se había construido).
- Migration SQL: `build/migrations/2026-05-18_rename_line_to_section.sql`. ADR-031 en `_decisions.md`.
- Commit `acb8eb0`.

---

## 2026-05-18 — ADR-030 close naming gate (Plaza lens + project rename a Difusión 2026-27)

Cierre del naming gate adelantado a final de Phase 0.1 (decisión 2026-05-14). Dos cambios atómicos tras Marco previsualizar la UI viva con datos reales y cazar las confusiones en sí mismo (el naming gate funcionando como estaba diseñado).

- **Cambio 1 — Lens primaria renamed `Rooms` → `Plaza`**. Supersede parcialmente ADR-029. ADR-029 había renombrado "Desk" → "Rooms" (para evitar "Desk sin task entity = navegación vacía"), pero el sidebar ya lista las Rooms — "Rooms" lens + sidebar listing rooms = tautología visible. Plaza es el nombre canónico desde ADR-009 + ADR-022 ("composable UI model: Plaza + Desk + Views"); ADR-029 lo perdió por accidente. Restaurando "Plaza" como nombre de la lens primaria, el componente sidebar (Plaza.svelte) y la lens (Plaza) comparten nombre a propósito — misma idea conceptual desde dos ángulos.
- **Cambio 2 — Project mamemi display name "MaMeMi" → "Difusión 2026-27"** (slug intacto). Antes el sidebar mostraba "MaMeMi" tres veces (House MaMeMi + Room MaMeMi + display name del sidebar lower) — confusión real cazada por Marco. El project siempre fue catch-all de difusión, no un show concreto. "Difusión 2026-27" describe literalmente qué es ese bucket. Future Phase 0.5+ Marco puede crear projects más finos ("Ombra", "Nocturnes") al lado.
- **Mecánica aplicada**:
  - DB: `UPDATE project SET name='Difusión 2026-27' WHERE slug='mamemi'` via MCP. Slug + FKs intactas; audit trigger captura el cambio.
  - Código: `lens.svelte.ts` (type + default `'rooms'` → `'plaza'`), `+layout.svelte` (lensOptions[0] id + label, provideLens('plaza')), `smoke.spec.ts` (selector + variable rename).
- **Resultado UI**: pill activa dice "Plaza", sidebar muestra Room "Difusión 2026-27" en lugar de "MaMeMi", display name consistente entre sidebar Plaza + sidebar lower + Room detail title.
- **Re-evaluate when**: testing externo con Anouk / Electrico 28. Phase 0.4 ratification gate. Phase 0.5 si llega task entity (D3) — Desk podría reaparecer como lens secundaria con sentido propio.
- ADR-030 en `_decisions.md` con full rationale + alternatives considered.
- Commit `38f95cb`.

---

## 2026-05-18 — Phase 0.1 sprint principal (continuación post-shell)

**Cierre del bloque:** Room detail con datos productivos + presence híbrido B + cross-highlight + smoke verde. Próximo gate: checkpoint visual 1 + naming gate con Anouk antes de Phase 0.2.

### Trabajos cerrados
- **Pills del lens nav visualmente correctas** + manifest PWA servido en dev. Quité el wrapping `@layer components` del shell scoped CSS (interaction badly con HMR layer ordering) + radius literal `999px` en vez de `--radius-circle: 50vw` (más robusto cross-zoom). `VitePWA.devOptions.enabled` para que dev sirva el manifest. Commit `3d49d18`.
- **Status badges alineados con `/booking`** (variable-contract pattern, philosophy.md §3). Las siete variantes `badge--{status}` (contacted/in-conversation/hold/confirmed/declined/dormant/recurring) movidas a `base.css` como single source of truth — booking + RoomDetail (futuro Contacts lens) consumen las mismas. Drop del duplicado en booking. Commit `5c8ae24`.
- **Room detail real** (trabajo #4 — RelationshipStub). `/h/[workspace]/room/[slug]/+page.svelte` ahora renderiza header (eyebrow Room + display name + meta status/dates) + RelationshipStub + tres stubs dashed (Runs/Assets/Team) que nombran la phase de cada uno. RelationshipStub consume `/api/engagements?project_slug=...&status=any&limit=10`, renderiza count + lista resumida (person · org · location · status badge) + footer "View all N engagements →" hacia `/booking` (fallback hasta Phase 0.3 Contacts lens). Reactividad: `slugStore` writable + `derived` queryOptions para que `createQuery` re-fetche al navegar entre Rooms en la misma instancia de página. Commit `8ed85c7`.
- **Presence badge en topbar — modelo híbrido B** (decisión 2026-05-18 de Marco). `NetworkPresenceStore` nuevo en `$lib/realtime/network-presence.svelte.ts` que se suscribe a UN canal presence por cada workspace del que eres miembro y unifica los counts. Distinct users across all (no per-URL-workspace). PresenceBadge en topbar consume `networkPresence?.count`. El `PresenceStore` per-workspace existente se mantiene para futuras badges contextuales por Room / RoadSheet (Phase 0.2). `rt` y `presence` pasados a `$state` para que el badge re-renderice al asignarse post-onMount. Commits `ed065bf` (badge per-workspace inicial) + `fcb131a` (refactor a network).
- **Cross-highlight UP en Plaza** (trabajo #8). Cuando hay una Room seleccionada, su House padre también lleva `color: var(--primary)` vía nuevo modificador `.plaza__house-link--on-path`. Tres estados visibles: `active` (URL = House home), `on-path` (URL = Room de esa House), inactive (otra House). Plus **bug fix**: RoomStructure lee display name del TanStack cache `['rooms']` (mismo key que Plaza + Room detail) en vez de echo del slug — eliminada la inconsistencia "MaMeMi vs mamemi" entre sidebar lower y main header. Commit `edbdda2`.
- **Smoke test Playwright actualizado al flow post-ADR-029**. Cubre login → wait `/h/marco-rubiol/` (con o sin trailing slash, regex) → assert lens "Rooms" activa por class → click link `a[href="/h/mamemi/room/mamemi"]` → wait nueva URL → assert `.rel-stub__count` matches `/\d+\s+engagements?/` → assert items > 0 → sign out → `/login`. Verde en 2.8s (5.5s wall). Commit `0a2ae2e`.

### Visual debt detectada (input para checkpoint visual 1)
- Gap exagerado entre Room header (`Status: active`) y RelationshipStub.
- Plaza spacing entre Houses engaña — Marco Rubiol vacía parece tener contenido en blanco.
- Eyebrow "ROOM" aparece duplicado (sidebar lower header + main header).

---

## 2026-05-18 — ADR-029 shell user-scoped

- **DB migration `phase_0_1_multi_workspace_split` aplicada en producción**. Nueva workspace `mamemi` (kind=team), Marco owner + playwright admin. Project `mamemi` + 154 engagements movidos de `marco-rubiol` (kind=personal, ahora vacío) a `mamemi`. Triggers `guard_immutable_workspace_id` deshabilitados temporalmente para la migración y re-habilitados al cierre. Las RLS ya eran membership-based (`is_workspace_member`, `has_permission`) — multi-workspace queries funcionan sin refactor RLS adicional.
- **`apps/web/src/lib/stores/lens.svelte.ts`** — type `Lens` cambia `'desk'` → `'rooms'`. Default también.
- **`apps/web/src/lib/components/Plaza.svelte`** — refactor a multi-house tree. Cada House es header con checkbox placeholder + link al House home + lista indentada de Rooms. Active state per Room derivado de URL. Loading / error / empty / data states. CSS scoped, variable contracts para hover/active.
- **`apps/web/src/lib/components/RoomStructure.svelte`** — componente nuevo (sidebar lower). Visible solo cuando hay Room seleccionada en URL. Header con eyebrow "Room" + nombre + empty state "No runs yet". Sin Room seleccionada → prompt italic centrado "Select a Room to see its structure".
- **`apps/web/src/routes/h/[workspace]/+layout.svelte`** — refactor del shell:
  - Lens nav SE MUEVE del sidebar al top del main (pills horizontales, centradas, con "All" chip a la derecha como placeholder).
  - Sidebar children pasa de "lens buttons + Plaza" a "Plaza + RoomStructure".
  - Brand "Hour" en sidebar header con checkbox placeholder (multi-select primitiva).
  - Active state lens visualmente intenso (dark filled pill vs outlined neutral).
- **`apps/web/src/routes/h/[workspace]/+page.svelte`** — empty home Spotlight-style: "Hello, Marco." + "What would you like to work on?" centrado vertical en main. Reemplaza el placeholder ad-hoc con sus 4 links manuales.
- **No tocado deliberadamente**: endpoints `/api/houses` y `/api/rooms` siguen igual — la RLS membership-based ya devuelve multi-workspace sin cambios. `selection.svelte.ts` se mantiene (la URL es la SoT, el store es mirror). i18n (~7 strings) sin cambios — lens labels hardcoded por ahora.
- **DoD trade-offs explícitos** (heredados de Plaza inicial y aún válidos):
  - Multi-select real (chip bar D-PRE-05) → Phase 0.2.
  - IDB write-through con TanStack persister → Phase 0.2.
  - Endpoint `/api/runs` y `/api/gigs` → trabajo #6 Phase 0.1 (RoomStructure los consumirá cuando existan).
- **Verificación**: `pnpm check` 0/0/0, `pnpm build` verde, Vite hot reload activo. Pendiente browser test por Marco.

---

## 2026-05-18 — Phase 0.1 trabajo #1 (Plaza inicial, después extendido a multi-house en ADR-029)

- **`/api/houses`** y **`/api/rooms`** — SvelteKit `+server.ts` mirroring del pattern `/api/engagements` (Bearer JWT + Valibot + pgGet + JSON estructurado). RLS scopes visibility vía `is_workspace_member()` / `has_permission()` (membership-based, no claim-based). Tras ADR-029: `houses` retorna 2 rows para Marco (`marco-rubiol` + `mamemi`); `rooms` devuelve projects de TODAS las workspaces del user sin filtro `workspace_id` en query. Multi-house funciona out-of-the-box gracias a las RLS ya escritas membership-based.
- **`Plaza.svelte`** — sidebar upper. TanStack `createQuery` × 2 (memory cache; IDB write-through diferido a Phase 0.2 por trade-off con TanStack Query persister). Active room `$derived` del pathname (single source = URL). Native `<a>` navigation, no click handlers. Loading / empty / error states. Semantic HTML (`<nav><ul><li><a>`) per `_area-methød/code/philosophy.md`. Scoped CSS, variable contracts (`--plaza-room-color`, `--plaza-room-bg`) que el modificador `.plaza__room--active` redeclara.
- **`/h/[workspace]/+layout.svelte`** — `<Plaza />` inyectada en sidebar body bajo lens nav (ADR-009: lenses top, entities bottom). Nuevo `$effect` sincroniza `SelectionStore.entity` desde el pathname para que consumers no-routing (chip bar, ⌘K) no re-parseen la URL.
- **Validación**: `pnpm check` 0/0/0, `pnpm build` verde con Sentry source maps subiendo. Commits `a4cb015` (docs) + `6cd4413` (código). No pusheado a origin.
- **DoD trade-off explícito**: Phase 0.1 DoD línea 309 dice "Sin red: Plaza y Desk usan IndexedDB". Phase 0.0 closure parkeó IDB-backed TanStack persister a Phase 0.2+. Resolución 2026-05-14: declarar DoD parcial + deuda explícita en vez de escribir IDB write-through manual que el persister reemplazará. Memory cache only ahora.

---

## 2026-05-09 — Phase 0.0 CERRADA

Todos los items del backlog Phase 0.0 cerrados. Próximo: **Phase 0.1 — Plaza + Desk shell con datos productivos**. Ver `build/roadmap.md`.

- ~~Schema `reset_v2_roadsheet`~~ **CERRADO 2026-05-01** (commit `dbaf308`)
- ~~Backup automatizado vía GitHub Actions~~ **CERRADO 2026-05-09** — workflow corriendo, primera corrida verde, ~150 KB en R2.
- ~~Real-time wrapper + presence channel~~ **CERRADO 2026-05-09** (commit `58408eb`) — `$lib/realtime/{channels,client,presence.svelte,index}.ts`, cableado en `/h/[workspace]/+layout.svelte`.
- ~~PartyServer DO scaffold + `withYjs` + `collab_snapshot` persistence~~ **CERRADO 2026-05-09** (commit `8085949`) — Worker separado `apps/collab/` con `RoadsheetCollab` DO, hour-web bindea via `script_name`, ruta `/api/collab/[t]/[id]` autoriza + forwarda. End-to-end verificado en runtime con WebSocket real (5 capas).
- ~~PWA + Service Worker + IndexedDB + write-queue~~ **CERRADO 2026-05-09** (commits `99b9e0c`/`91afc76`/`fae60aa`/`53160e2`/`7f35580`) — vite-plugin-pwa generateSW, manifest + icon plum, IDB v1 con 2 stores (`read_cache` + `write_queue`), `/offline` prerenderizada como navigateFallback. End-to-end verificado: SW activated, manifest detectado, install button presente, IDB schema visible, offline reload sirve la página propia.
- ~~Testing scaffold Vitest unit/component~~ **CERRADO 2026-05-09** (commit `8e312fe`).

### Smoke e2e priorizado para Phase 0.2 (validado en revisión externa 2026-05-09)
7 checks que cierran el riesgo del DO sin polish:

1. **Auth OK** — user con membership conecta a `show:<id>` válido, recibe primer frame Yjs sync.
2. **Auth deny** — sin token / token inválido / sin membership: 401/403 antes de tocar el DO.
3. **Two-client sync** — A y B en `show:1`, A inserta texto, B converge al mismo state. CRDT real, no solo "WebSocket abierto".
4. **Target isolation** — A,B en `show:1`, C en `show:2`. Edits de A no llegan a C. Valida routing por `idFromName`.
5. **Snapshot version** — tras updates + threshold, fila en `collab_snapshot` con `target_table`/`target_id`/`workspace_id` correctos, `version = previous + 1`, snapshot no vacío.
6. **Reload restore** — cerrar sockets, esperar, reconectar fresh: contenido reaparece desde DB. Valida que no dependes solo de memoria del DO.
7. **No JWT logging** — review manual de Cloudflare logs / Sentry breadcrumbs / console / errors: nunca aparece JWT completo. Crítico porque va en query string del WS.

### Revisión técnica externa 2026-05-09
Otro agente IA hizo audit completo del repo (estructura, stack, RLS, offline, collab, security, tests). La review confirmó solidez general (7.5/10 para Phase 0 interna) y aportó dos shortlists valiosos: 6 escenarios RLS priorizados (en Open debts de `_context.md` Phase 0.9 backlog) + 7 checks smoke e2e collab (arriba). También cazó deuda real: `sendDefaultPii: true` en `hooks.client.ts:18` y `hooks.server.ts:26`.

**Retirado de la review:** afirmó que "person global contradice una memoria estratégica" como "biggest risk". La fuente era una memoria automática del agente (ID `7077df82-...`), no del repo canónico. La decisión `person` GLOBAL está reafirmada en ADR-001 + `_context.md` "Anti-CRM vocabulary" + `_decisions.md` 2026-05-01 ("person no tiene workspace_id"). El reviewer retiró el claim al pedirle fuente. **No requiere acción** — la decisión sigue firme.

---

## 2026-05-09 — PWA + offline scaffold (cierre Phase 0.0)

- **`vite-plugin-pwa` generateSW** mode + `idb` typed wrapper + `workbox-window` para registración cliente. `injectRegister: false` para tener guard manual contra `navigator.webdriver` (Playwright skip).
- **Manifest + icono**: `static/icon.svg` (plum H placeholder, swap en visual-design phase). `app.html` con links manuales: `<meta theme-color>`, `<link rel="icon">`, `<link rel="apple-touch-icon">`, `<link rel="manifest">` — vite-plugin-pwa NO auto-injecta con SvelteKit (su HTML pipeline está fuera del adapter).
- **`/offline` prerenderizada** (`src/routes/offline/+page.ts` con `export const prerender = true`) — sirve como `navigateFallback` cuando el SW no encuentra una ruta cacheada. Inyectada en el precache via `additionalManifestEntries` porque vite-plugin-pwa escanea `.svelte-kit/output/client/` antes de que adapter-cloudflare prerenderice los HTMLs en `.svelte-kit/cloudflare/` (gotcha sutil — pasa lo mismo con cualquier adapter que prerenderice post-Vite).
- **D-PRE-13 (silent updates)**: `registerType: 'prompt'` + workbox `skipWaiting: false` (default) + callbacks `onNeedRefresh`/`onOfflineReady` vacíos. Nuevo SW espera a que cierres todas las pestañas, activa en next open. Sin banners.
- **`navigateFallbackDenylist`** para `/api/*`, `/login`, `/dev/*`, `/sw.js` — esos siempre tienen que pegar a network. SW solo cachea estáticos + `/offline`.
- **`$lib/offline/`** módulo con surface API (no wiring):
  - `db.ts` — `idb` schema v1, dos stores (`read_cache` keyed by URL, `write_queue` autoIncrement). Helpers `cacheRead`/`getCachedRead`/`enqueueWrite`/`listQueuedWrites`/`dequeueWrite`/`bumpWriteRetries`. `prewarmDB()` para crear el schema en mount aunque no haya data (sino IDB nunca aparecía en DevTools). Versioning rule documentada en el upgrade callback.
  - `register.ts` — `registerServiceWorker()` idempotente, skip bajo SSR/no-SW/Playwright.
- **Cableado** en `src/routes/+layout.svelte` `onMount`: `registerServiceWorker()` + `prewarmDB()`.
- **Verificación end-to-end** runtime (post-deploy `91be0ad8`): SW activated ✓, Manifest detectado ✓, IDB con dos stores ✓, Install button ✓, Offline reload sirve `/offline` ✓.
- **Diferido Phase 0.2+**: write-queue replay logic, IDB-backed TanStack Query persisted cache, postgres_changes subscriptions sobre el cache.
- **Diferido Phase 0.5**: local-first real evaluation (ElectricSQL/Zero/Triplit), resumable upload `tus-js-client`, push notifications.

---

## 2026-05-09 — PartyServer DO scaffold

- **Worker separado `apps/collab/`** — adapter-cloudflare sobreescribe `_worker.js` cada build, así que no se puede co-hostear una clase DO en hour-web. Patrón canónico: declarar el DO en un Worker independiente (`hour-collab`) y bindear desde hour-web vía `script_name`.
- **`apps/collab/src/`**:
  - `roadsheet.ts` — `RoadsheetCollab extends withYjs(Server)` (y-partyserver mixin sobre partyserver). Override `onLoad` (seed Yjs document desde último snapshot) y `onSave` (encode + write nueva fila `collab_snapshot` cada 30 updates / 60s default). Cachea `workspace_id` y `version` en `this.ctx.storage` (SQLite-backed DO con `new_sqlite_classes`), survive hibernación.
  - `persistence.ts` — `fetchWorkspaceId` + `loadLatestSnapshot` + `saveSnapshot` vía new-model `SUPABASE_SECRET_KEY` (`sb_secret_...`, NO el legacy `service_role` JWT). bytea encodeado como hex `\x...` en JSON PostgREST.
  - `index.ts` — re-export `RoadsheetCollab` + stub fetch handler (404). `workers_dev: false` para que el único path sea via DO bindings desde hour-web.
- **`apps/collab/wrangler.jsonc`** — DO binding owner + migración `new_sqlite_classes: ["RoadsheetCollab"]`.
- **`apps/web/`**:
  - `wrangler.jsonc` — binding `ROADSHEET_COLLAB` con `script_name: "hour-collab"` (cross-Worker).
  - `src/lib/do/auth.ts` — `authorizeCollab(env, jwt, table, id)` resuelve workspace_id via JWT del usuario contra PostgREST. Empty result == not found OR not member; no leak.
  - `src/routes/api/collab/[target_table]/[target_id]/+server.ts` — GET-only, requiere upgrade WebSocket. Lee JWT de `?token=` (browsers no pueden setear Authorization en WS upgrade). Forward al DO via `env.ROADSHEET_COLLAB.idFromName(`${table}:${id}`).fetch(request)`.
- **Migración a new-model API keys** (Marco request "nada legacy"): `SUPABASE_SECRET_KEY` (formato `sb_secret_...`, no `eyJ...`), `PUBLIC_SUPABASE_ANON_KEY` ya estaba en formato `sb_publishable_...`. Audit confirmó cero referencias legacy en código.
- **Verificación runtime end-to-end** (deploy `0cde2248` hour-web + primer deploy hour-collab): WebSocket abre limpio (`✓ open`), Frame binario inbound (`<binary>`) — Yjs sync protocol activo, Cinco capas funcionando: SvelteKit upgrade → JWT validation → DO binding cross-Worker → partyserver upgrade → y-partyserver Yjs sync.
- **No verificado todavía** (fuera del scope scaffold; requiere Yjs updates reales): snapshot save trigger + snapshot reload roundtrip. La infra está toda en sitio; se prueba la primera vez que UI Phase 0.2 haga `Y.Text.insert()` y dispare `onSave`.

---

## 2026-05-09 — Realtime wrapper + presence

- **`@supabase/realtime-js` standalone** (no traer todo `@supabase/supabase-js`) — mismo enfoque que `$lib/supabase.ts` con fetch raw, mantiene el bundle pequeño.
- **`$lib/realtime/`**: 4 archivos + 1 test:
  - `channels.ts` — naming helpers puros (`channelName.workspacePresence(id)` etc.), única fuente de verdad. Tipos template-literal.
  - `client.ts` — `createRealtimeClient(env, jwt)` factory + `provideRealtime`/`useRealtime` context. Decoder JWT base64url hand-rolled (~10 LoC) para extraer `sub` claim como presence key — sin pulling de jwt-decode (~1KB) por una operación trivial. Throws si JWT no tiene `sub`.
  - `presence.svelte.ts` — `PresenceStore` clase con `$state<PresenceState>` + `count` getter + `isOnline(uid)`. Subscribe a `workspace:{slug}:presence`, listens sync/join/leave, tracks self con `online_at` ISO timestamp en `SUBSCRIBED`. `dispose()` releases channel.
  - `index.ts` — public API.
  - `channels.test.ts` — 5 tests pinning el formato (server project).
- **Cableado** en `/h/[workspace]/+layout.svelte`: provides realtime + presence en `onMount` cuando JWT y `PUBLIC_SUPABASE_*` presentes; dispose en `onDestroy`. Failures degradan silenciosos (console.warn) — pages que necesiten realtime llaman `useRealtime()` y reciben error claro ahí.
- **Convención naming**: `useRealtime`/`usePresence` (mirroring `useLens` existente, no `getRealtime`/`getPresence`).
- **Lifecycle**: una conexión WebSocket por tab. Mismo socket multiplexa todos los channels (workspace presence ahora; project/show channels en Phase 0.2 cuando lleguen postgres_changes / collab triggers).
- **Verificado runtime 2026-05-09** (post-deploy, version `612495ae`): devtools → Network → WS muestra `phx_join` outbound, `phx_reply ok`, `presence track` con `user_id` extraído del JWT, `presence_state` con la key correcta, heartbeats `phoenix` cada ~30s. URL construction (`http→ws`), auth con JWT, decoder `sub`, y lifecycle (mount → join → track → eventos) — los cuatro confirmados end-to-end.
- **Diferido**: `postgres_changes` (Phase 0.2 cuando haya un campo real al que suscribir), UI que renderiza presence (Phase 0.1+).

---

## 2026-05-09 — Vitest scaffold

- **Vitest 4.1.5** con dos `projects` (Vitest 4 renombró `workspace` → `projects`):
  - `server`: `*.test.ts` en `node` env para módulos puros.
  - `client`: `*.svelte.test.ts` en `jsdom` + `resolve.conditions: ['browser']` para forzar el entrypoint cliente de Svelte 5 (sin esto, `mount()` se importa del index-server.js y rompe con `lifecycle_function_unavailable`).
- **`@testing-library/svelte` 5.3.1** + `@testing-library/jest-dom` 6.9.1 + `jsdom` 29.1.1.
- **`vite.config.ts` migrado** de `defineConfig` (vite) a `defineConfig` (vitest/config). `loadEnv` se mantiene importado de `vite` (vitest no lo re-exporta). Plugin Sentry gateado con `!process.env.VITEST` para que el test runner no arrastre el upload de source maps.
- **2 tests de muestra** (no cobertura — pattern only): `src/lib/reserved-slugs.test.ts` (6 cases) + `src/lib/components/Badge.svelte.test.ts` (3 cases).
- **Setup file** `vitest-setup-client.ts` con `import '@testing-library/jest-dom/vitest'`. tsconfig `types` extendido con `@testing-library/jest-dom`.
- Scripts: `pnpm test:unit` (one-shot) + `pnpm test:unit:watch` (TDD).
- Verificado end-to-end: Vitest 9/9 verde en 920ms; `pnpm check` 0/0/0; `pnpm build` verde con Sentry source maps subiendo; Playwright smoke 1 passed.

---

## 2026-05-09 — Playwright smoke activado

- **Test user `playwright@hour.test`** creado en `hour-phase0` (auth.users + Auto-confirm) y atado a workspace `marco-rubiol` como `admin` con `accepted_at = now()` vía bloque `DO $$` idempotente. Procedimiento documentado en `build/runbooks/test-user-setup.md` (incluye SQL snippet, troubleshooting table, justificación de admin vs member).
- **`apps/web/.env.test`** local con `PW_TEST_EMAIL` + `PW_TEST_PASSWORD` (gitignored vía nueva entrada en `.gitignore` — el patrón existente `.env.*.local` no cubría `.env.test`).
- **Smoke verde end-to-end**: `pnpm build && pnpm test:smoke` → 1 passed en 7.9s. Cubre login → `/booking` muestra "<n> contacts" + tbody con filas → sign out. Detecta regresiones en login flow, JWT auth hook (inyección de `current_workspace_id`), RLS de `engagement` y client-side guard de `/h/`.
- Nota RBAC: el test user usa rol `admin` (no `member`) intencionalmente. `has_permission()` da bypass a workspace owner/admin para cualquier permiso, así que el smoke valida login + RLS sin acoplarse a detalles RBAC. RBAC regression suite es trabajo aparte (Phase 0.9 gate).

---

## 2026-05-09 — Backup activado

- **Backup workflow restaurado y verde**. El commit `a65a982` del 2026-05-02 había eliminado `.github/workflows/backup.yml` por OAuth scope issue. Re-aplicado en commit nuevo tras `gh auth refresh -h github.com -s workflow`.
- **R2 prep**: bucket `hour-backups` creado en EU + R2 API token (Object Read & Write) emitido + 4 secretos GitHub provisionados (`SUPABASE_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`).
- **Primera corrida verde** (run `25594739063`, 1m11s): subió `data-2026-05-09T06-58-19Z.sql.gz` (137 KB), `schema-*.sql.gz` (14 KB), `roles-*.sql.gz` (208 B) a `s3://hour-backups/weekly/2026-05-09T06-58-19Z/`.
- **Tres gotchas resueltos en el camino** (anotados en `build/runbooks/backup.md` para futuros operadores):
  1. **OAuth scope** — el token gh CLI no tenía scope `workflow`. Push de archivos en `.github/workflows/` requería refresh con scope añadido. Sin esto: `403 refusing to allow an OAuth App to create or update workflow`.
  2. **Password URL-encoding** — la DB password original contenía un char especial (`@`/`/`/`#`/`?`/`:`) que rompió el parser de `net/url` con `invalid userinfo`. Fix: rotar a password alfanumérica (Opción A elegida) o percent-encodear.
  3. **IPv6 vs IPv4 + tenant routing** — la URL "Direct connection" (`db.<ref>.supabase.co`) resuelve solo IPv6 y los runners de GH Actions son IPv4-only (`Network is unreachable`). Fix: usar la URL del **Session Pooler** (`postgresql://postgres.<ref>:PASS@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`). User incluye `.<project_ref>` (sin él: `Tenant or user not found`); port 5432 (Session, no Transaction — Transaction rompe `pg_dump` por prepared statements). NO necesario el IPv4 add-on de pago.
- **Restore drill** sigue pendiente (gate Phase 0.9, no urgente). Runbook tiene el stub.

---

## 2026-05-02 — Review pass (items 1-3 del backlog)

- **`+layout.ts` con `ssr = false`** en la rama `/h/`. La rama es app interna autenticada — SSR no aporta nada (no hay SEO, no hay anonymous render path) y desperdiciaba un round-trip server por request. Una línea. El guard funcional client-side de `+layout.svelte` ya estaba bien (no había flash de chrome porque el `{#if authChecked}` cerraba el render hasta hydrate). Ver `_decisions.md` 2026-05-02.
- **GitHub Actions backup workflow** `.github/workflows/backup.yml` — schedule semanal Sunday 03:00 UTC + `workflow_dispatch`. Dump triple (data, schema, roles) vía Supabase CLI → gzip → push a R2 `hour-backups/weekly/<UTC-stamp>/` vía AWS CLI S3-compatible. Retención 12 semanas con prune automático. Runbook completo en `build/runbooks/backup.md`.
- **Playwright smoke scaffold** instalado (`@playwright/test 1.59.1` devDep) + `playwright.config.ts` + `tests/smoke.spec.ts`. Scripts `pnpm test:install` (Chromium binary) + `pnpm test:smoke`. Test se auto-skipea si faltan `PW_TEST_EMAIL` + `PW_TEST_PASSWORD`.
- **Bug fix `+server.ts`** — los imports `Enum` / `Row` del módulo `$lib/db-types` estaban rotos (regresión post-regen de tipos: el archivo exporta `Enums` / `Tables`). Fix trivial, ahora `pnpm check` 0 errors / 0 warnings y `pnpm build` ✓.

---

## 2026-05-01 — Schema roadsheet (`reset_v2_roadsheet`)

- **`reset_v2_roadsheet`** aplicada (migración 20260501190000, commit `dbaf308`). Pasó por DB review independiente (10 SERIOUS items, todos arreglados pre-aplicación).
- Schema delta: `show` + 5 timeslots + 3 jsonb (logistics/hospitality/technical) + GIN + CHECK orden temporal NULL-safe; `venue.timezone` (D-PRE-10); slug system completo en 7 tablas (slug + `previous_slugs[]` + `slugify()` + `is_reserved_slug()` + `validate_slug()` trigger); 4 tablas nuevas: `crew_assignment`, `cast_override`, `asset_version`, `collab_snapshot` con RLS (`has_permission(project_id, 'edit:show')`), audit triggers, ws-immutability guards.
- Backfill de 154 personas + 154 engagements con id-suffix anti-colisión. Todos slugs únicos y bien formados. `person.slug` es **GLOBAL UNIQUE** (person no tiene workspace_id — anti-CRM "global, shared"). Ver `_decisions.md` 2026-05-01.
- Bug `slugify()` cazado en smoke (trim antes de truncar dejaba trailing dash en nombre catalán de 65+ chars). Fix: trim post-substring. Slug afectado reparado.
- `db-types.ts` regenerado (1903 líneas, las 4 tablas + 2 enums presentes).
- **Decisión técnica**: `build/schema.sql` y `build/rls-policies.sql` NO reescritos in-place — header con delta apuntando al archivo de migración como source of truth. Consolidación in-place queda como tarea diferida.
- **Post-apply DB review** (segundo agente independiente) confirmó los 10 SERIOUS pre-apply resueltos. Encontró 2 drifts LOW arreglados en `post_roadsheet_cleanup` (otra migración aplicada el mismo día): (1) DROP de los UNIQUE constraints `workspace_slug_key` + `project_workspace_id_slug_key` que del reset_v2_schema shadow-eaban los partial uniques nuevos (rompía rehidratación de slug post soft-delete); (2) hardening pattern aplicado a `slugify()` / `is_reserved_slug()` / `validate_slug()` (REVOKE PUBLIC/anon/service_role + GRANT authenticated; validate_slug sin grants — trigger-only). Ver `build/migrations/2026-05-01_post_roadsheet_cleanup.sql`.

---

## 2026-05-01 — Observability + security tightening

- **Sentry full wiring** (`@sentry/sveltekit` 10.51, runtime Workers): `initCloudflareSentryHandle` + `sentryHandle()` en `hooks.server.ts`, `Sentry.init` + `replayIntegration` en `hooks.client.ts`, `experimental.instrumentation.server` + `experimental.tracing.server` en `svelte.config.js`. DSN baked at build time vía `$env/static/public`.
- **Same-origin tunnel** `/api/sentry-tunnel` que reenvía envelopes al ingest host (Firefox ETP/Brave Shields/uBlock bloquearían `*.ingest.sentry.io` directo). Auth vía query string desde el DSN. Verificado en prod.
- **Source maps upload** (`sentrySvelteKit` plugin Vite + `loadEnv`) — stack traces resuelven a `.ts`/`.svelte` original, no a `app.JS:1:NNNN`.
- **Smoke routes** `/dev/sentry-test` + `/api/sentry-test` (gated `?force=1` en prod). Verificación cliente + servidor end-to-end OK.
- **Smart Placement** (`placement.mode=smart` en `wrangler.jsonc`) — Worker co-loca con Supabase Frankfurt, ~3-4× menos round-trip Worker→PostgREST. Hyperdrive descartado: aplica a Postgres TCP, no a PostgREST HTTPS.
- **SECURITY DEFINER hardening** (Supabase): de las 12 funciones `SECURITY DEFINER` en `public`, helpers de RLS (8) mantienen `authenticated` y revocan `PUBLIC`+`anon`+`service_role`; trigger-only (4 — `handle_new_user`, `seed_system_roles_on_workspace`, `validate_project_membership_roles`, `write_audit`) revocan todo excepto `postgres`. Cierra el vector real (un cliente `authenticated` invocando `write_audit()` directamente para falsificar audit rows). Ver `architecture.md §14`.
- **Audit log triggers verificados live** en producción: 394 rows del bootstrap + 1 smoke UPDATE = pipeline funcional.
- **`worker-configuration.d.ts`** generado por `wrangler types` ahora gitignored (regenerable con `pnpm cf-typegen`).

---

## 2026-05-01 — Primitivos + plum trial + routing scaffold (cierre Phase 0.0 día 5)

- **13/13 primitivos** en `apps/web/src/lib/components/`: Button, LinkButton, Input, Checkbox, Radio, Avatar, Badge, Chip, Select, Dialog, Toast, Tooltip, Menu, Sidebar (desktop static / mobile drawer). Showcase completo en `/playground`.
- **Plum trial** en `--primary` (`oklch(0.50 0.14 335)` ≈ #9D3F70) — terracotta `#AB4235` chocaba con `--danger` a 5°. Provisional, re-evaluar en visual design phase. Ver `_decisions.md` 2026-05-01.
- **URL architecture re-evaluada** (dossier `build/url-architecture-dossier-2026-05-01.md`). Cinco alternativas evaluadas; ADR-022 sigue (path-prefix `/h/[workspace]/[entity]/[slug]`) con tres ajustes operativos cerrados en addendum.
- **Routing scaffold Phase 0.0 día 5**:
  - `apps/web/src/lib/reserved-slugs.ts` — ~70 slugs reservados + helpers.
  - `apps/web/src/lib/url-state.ts` — `serializeViewState()` / `hydrateViewState()` base64url + 400 chars (D-PRE-05).
  - `apps/web/src/lib/stores/lens.svelte.ts` y `selection.svelte.ts` — class + factory + `setContext`/`getContext` (SSR-safe).
  - `apps/web/src/routes/h/+layout.svelte` — auth guard (JWT en localStorage, redirect login).
  - `apps/web/src/routes/h/[workspace]/+layout.svelte` — shell con Sidebar + lens nav + reserved-slug guard.
  - Placeholders `+page.svelte` en `/h/[workspace]/`, `/room/[slug]`, `/gig/[slug]`, `/engagement/[slug]`, `/person/[slug]`. `run/venue/asset/invoice` diferidos a su Phase.

---

## 2026-04-20 — Infra + datos + primera pantalla funcional

Login + lista de engagements desplegados y operativos. Todo el trabajo está en `apps/web/`.

### DB (aplicada vía MCP)
- `hour-phase0` en eu-central-1 · Postgres 17 · **22 tablas** + `show_redacted` view · 19 helpers · 53 RLS policies (ENABLE + FORCE)
- Marco es owner de workspace `marco-rubiol` (slug) · 15 system roles seedeados por trigger · proyecto `mamemi` (status=active, sin `type`)
- Datos reales: **154 persons + 154 engagements** (status=`contacted`, `custom_fields.season='2026-27'`), 30 enriquecidos con dossier 2026
- Auth hook `custom_access_token_hook` enabled en dashboard (inyecta `current_workspace_id` desde `workspace_membership`)
- Email+password + Auto-Confirm enabled para el Phase 0 team
- Migraciones aplicadas (en orden): `reset_v2_schema`, `reset_v2_rls_and_audit`, `reset_v2_fix_audit_on_workspace_delete`, `reset_v2_fix_audit_workspace_existence`, `reset_v2_preseed_marco_rubiol_mamemi`, CLAIM block, `reset_v2_import_batch_01..04`, `reset_v2_restore_default_grants`

### Worker (`hour-web` en Cloudflare)
- Desplegado en `https://hour-web.marco-rubiol.workers.dev`
- `GET /api/engagements` actualizado a reset v2 (default `status=contacted`, sin `project.type`)
- Custom domain `hour.zerosense.studio` atado y sirviendo vía CF (entre 2026-04-20 y 2026-04-25)

### Frontend (`apps/web/`) — post-ADR-026 (2026-05-01)
- **Stack**: SvelteKit 2 + Svelte 5 (runes) + `@sveltejs/adapter-cloudflare`. Routes en `src/routes/`. `$lib/` para componentes/helpers. TanStack Query + Sentry hooks instalados.
- **Login** (`/login`): email+password contra Supabase Auth REST API, JWT en localStorage, redirect a `/booking`. Form Svelte con `$state` + bind + handleSubmit.
- **Booking** (`/booking`): lista de 154 engagements con nombre, organización, ubicación, status (badges con color), próxima acción. Paginación funcional (50/page). Logout. Redirect a login si JWT ausente o 401. Render Svelte real con `{#each}` + `$derived` (no innerHTML).
- **API** (`/api/engagements`): SvelteKit `+server.ts`. Filtros validados con Valibot (status/project_slug/season + limit/offset). PostgREST con RLS, exact count. Tipado con `$lib/db-types`.

### Smoke tests cerrados
- Hook inyecta `current_workspace_id` correctamente (probado con MCP `execute_sql` simulando claims)
- Marco como `authenticated` ve 154 engagements; sin membership: 0 leaks
- `has_permission` owner bypass verificado
- Endpoint en prod devuelve 401 correcto sin JWT
- **End-to-end con JWT real**: login funcional, datos cargando en `/difusion` — verificado en producción
