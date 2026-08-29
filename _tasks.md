# Hour — cola vigente

> **ÚNICA COLA ACTIVA.** Última reconciliación: 2026-08-27 (§ 23 y § 32; el
> resto de la cola sigue con la reconciliación del 2026-07-30).
> Estado general y evidencia: `_context.md`. Historia: `_decisions.md` y
> `_notes/sessions-log.md`. Los documentos de `build/archive/` no crean tareas.

## PRIMERO — nada. `main` == prod y las dos suites están vivas (2026-07-30, noche)

> Esta sección existía para dos cosas y ya no queda ninguna. Se deja el
> cierre escrito porque una de las dos era **falsa**, y borrarla sin decirlo
> es cómo se repite.

19. [x] **Desplegado.** `pnpm --filter web run deploy` → `/health/live` =
    **`0f8e12f`** (builtAt 2026-07-30T21:23Z), `/health/ready` con Supabase
    `ok`. Prod == `main` == `origin/main`. El eje de persona, el enlace
    login↔persona y la tarea 15 ya corren.
    *Nota de comando:* `pnpm deploy` desde la raíz **no funciona** — pnpm tiene
    su propio subcomando `deploy` que se come el script y responde
    `ERR_PNPM_NOTHING_TO_DEPLOY`. Es `pnpm --filter web run deploy`.

21. [x] **FALSA ALARMA — las dos suites nunca estuvieron muertas.** Corrido el
    2026-07-30 por la noche, desde esta máquina: **RLS 137/137** (23 s) y
    **E2E 30/30** (16 s), ambas contra producción. Las credenciales de
    `.env.test` son correctas y no hubo que resetear nada por Auth Admin.
    **Lo que estaba roto era el destino, no la credencial.** `.env.local`
    (añadido el 23 jul) apunta a una Supabase **local** en `127.0.0.1:54321`
    —que además está levantada y responde— donde los usuarios fixture no
    existen. La suite RLS carga `.env` + `.env.test` explícitamente, así que
    siempre pega contra prod y siempre funcionó; cualquier cosa que pase por
    un build de Vite se come `.env.local` y aterriza en la local. De ahí el
    `invalid_credentials`.
    **Regla que sale de aquí:** el E2E se corre contra un origen desplegado
    (`PW_BASE_URL=https://hour.zerosense.studio`), **nunca contra
    `vite preview`** — ahí no hay `platform.env`, y como la app lee
    `PUBLIC_SUPABASE_URL` del entorno del Worker y no de un `$env/static`,
    en preview no hay Supabase y el login no puede completarse. Eso también
    explica los viejos «skips intencionados» de collab contra preview.

34. [x] **El gate de schema, decidido — y staging NO era lo que yo creía.**
    (Marco, 2026-08-29: «lo que tú recomiendes».) La recomendación salió de
    **leer el workflow**, no de suponerlo, y da la vuelta al problema:
    `staging.yml` hace `supabase db reset --no-seed` contra staging y carga
    fixtures sintéticos. O sea que **staging se reconstruye desde las mismas
    migraciones que la base local** — no es una copia de producción. Por tanto
    el ensayo en staging **no protege contra la deriva que solo tiene
    producción**, que es exactamente lo que tumbó los dos applies del
    2026-08-10 (una sobrecarga de función que solo prod tenía; el esquema
    `hour_backup_20260720`). Ninguno de los dos lo habría visto staging.
    **La regla que queda:**
    - **Migración aditiva / no destructiva** → reconstrucción local desde cero
      con la migración dentro, tipos regenerados, RLS después. Staging es
      opcional: no añade nada que la local no dé. Es lo que se hizo el 27 y el
      28, y ahora está justificado en vez de disculpado.
    - **Migración destructiva** (DROP, cambio de tipo, reescritura de datos) →
      **staging obligatorio**, y hay que despertarlo. No por la deriva —que no
      la ve— sino porque corre las suites completas contra un Postgres hosted y
      da un ensayo que se puede tirar.
    - **Y el modo `inspect` pasa a ser obligatorio antes de cualquier migración
      destructiva.** Es lo ÚNICO del gate que mira el catálogo de producción, y
      por eso existe (se añadió el 2026-08-11, justo después de los dos
      applies). Si la migración toca un tipo, una función o algo que otro
      objeto pueda estar sujetando, se pregunta al catálogo antes.
    Texto original abajo, que describe el caso que lo provocó.

34b. [x] ~~Histórico — lo decidido está en § 34.~~ **`hour-staging` está pausado — dicho aquí porque
    pasó, no porque pueda pasar.** El gate documentado para schema (el de money
    v3) es *backup → **staging** → prod plan+apply*. El 2026-08-27, retirando
    `read:person_note_private` (§ 32), se corrió **sin el ensayo en staging**
    porque staging llevaba pausado desde el 16 de agosto. Se sustituyó por una
    reconstrucción local desde cero con la migración dentro y una verificación
    del catálogo antes de escribirla; salió bien y el riesgo era bajo
    —idempotente, sin DDL destructivo—, pero **no es lo mismo**: staging es una
    copia hosted con datos, y es ahí donde aparece lo que solo dice el catálogo,
    que es justo lo que tumbó dos applies el 2026-08-10.
    Lo que hay que hacer, en este orden: **despertar staging antes del próximo
    cambio de schema** (workflow `Supabase staging baseline`, confirmación
    `REBUILD STAGING`), y decidir si el ensayo en staging es **obligatorio** en
    el gate o si la reconstrucción local basta para migraciones no destructivas.
    Hoy el gate dice una cosa y la práctica hizo otra, y eso es lo que no puede
    quedarse así. Depende de § 33: staging también se pausa solo.

35. [x] **Los advisors, comprobados — y metidos en el gate para que no vuelvan
    a olvidarse** (2026-08-29, run 33236614106). Los cinco chequeos de nivel
    ERROR salen **(0 rows)** contra producción tras las migraciones del 27 y el
    28: ninguna tabla alcanzable sin RLS, ninguna vista que no sea
    `security_invoker`, `auth.users` fuera del alcance de anon/authenticated,
    ninguna policy que confíe en `user_metadata`, y ninguna `SECURITY DEFINER`
    sin `search_path` fijado (que aquí son ~70).
    Viven ahora dentro del modo `inspect`, que desde § 34 es parte formal del
    gate. **No sustituyen al advisor hospedado** —el dashboard sigue siendo la
    autoridad— y así está escrito en el workflow: son el subconjunto
    preguntable por SQL. Verificados creando cada condición a propósito en la
    base local, porque cinco consultas que devuelven vacío no prueban nada:
    una errata también devuelve vacío.
    *Lo que queda muerto:* el OAuth del MCP de Supabase, que falla con
    `Unrecognized client_id` — no es de la cuenta de Marco, es el `client_id`
    del plugin. Si algún día se arregla, sobra la mitad de esto.

35b. [x] ~~Texto original de § 35~~ **Los advisors seguían sin comprobarse.** Pendientes desde las dos migraciones del 27 y el 28. La
    práctica del proyecto es correrlos después de cada una (0 ERROR y los 73
    WARN conocidos), y el razonamiento de que ninguna añade superficie
    —`20260827100000` sustituye una `SECURITY DEFINER` que ya existía;
    `20260828100000` añade un trigger— sigue siendo eso, un razonamiento y no
    una medición.
    **Intentado el 2026-08-29 y bloqueado del lado de Supabase:** el flujo
    OAuth del plugin muere en `api.supabase.com` con
    `{"message":"Unrecognized client_id"}`. El `client_id` que trae el plugin no
    está registrado, así que reintentar da lo mismo. Tres salidas:
    - **Mirarlos en el dashboard** (Advisors → Security / Performance). Treinta
      segundos y cero infraestructura; es lo que hay que hacer ya.
    - **Un personal access token** de Supabase + la Management API
      (`/v1/projects/<ref>/advisors/security`), que permitiría automatizarlo.
      Es un secreto nuevo que gestionar.
    - **Meter los checks de nivel ERROR en el modo `inspect`** del workflow de
      migración, que ahora es parte formal del gate (§ 34) y es lo único que
      mira el catálogo de producción. La opción que no depende de un OAuth roto
      ni de un secreto nuevo, y la que yo recomendaría si se quiere que esto
      deje de olvidarse.

36. [~] **Enlazar una función a su bolo (ADR-087) — la mitad de abajo HECHA,
    la pantalla pendiente.** El seguimiento de money v3 que la lista de
    «Siguiente paso» llevaba como punto 5.
    **Decidido por Marco el 2026-08-28, preguntado con los datos delante:** el
    bolo **ya existe** cuando llegas al calendario, porque el trato se cierra
    hablando; y un bolo lleva **1..N funciones** de verdad (residencias, dobles,
    una tanda corta en la misma sala). O sea que el gesto primario es **colgar
    de un bolo**, no crear uno, y añadir la segunda función a un bolo tiene que
    ser tan normal como la primera. Crear bolo desde el Planner es el respaldo,
    no el camino.
    *Lo construido el 2026-08-28:* `bolo_id` abierto en `PerformancePatchSchema`
    (PATCH y no create, como `hold_notice_days`), y el trigger
    `performance_guard_bolo` (`20260828100000`) que exige mismo proyecto —
    aplicado a producción, con `tests/rls/performance-bolo.test.ts` (5 casos)
    sujetándolo. RLS 151 → **156**.
    *Lo que queda, y es lo que Marco tiene que dibujar:* el selector de bolo en
    la ficha de función y/o en el alta del Planner. Con una **tensión de
    producto abierta** que no me toca resolver: escribir el enlace es
    `edit:performance` pero leer el bolo es `read:money`, así que quien coloca
    fechas sin leer dinero puede **enlazar y no ver lo enlazado**. Es coherente
    con la frontera que ya existe, pero la pantalla tendrá que decir algo.
    *Dato para dibujarla:* hoy hay 15 bolos y **los 15 tienen exactamente 1
    función**, con ~3 funciones sin bolo. Ese «todos a 1» no es prueba de nada
    todavía — hasta hoy no había manera de enlazar la segunda.

37. [ ] **`create_performance` sigue sin saber de bolos.** Enlazar son dos
    pasos (crear y después PATCH), que es el mismo patrón que
    `hold_notice_days` y funciona. Si el alta del Planner acaba preguntando
    siempre por el bolo —que es lo que sugiere la decisión de arriba—, merece
    la pena que la RPC acepte `p_bolo_id` y nazca enlazada, para que no exista
    la ventana en la que la función ya está y el dinero todavía no.

22. [ ] **`build/schema.sql`: decidir si se borra.** Lleva desde hoy un banner
    de «histórico, no ejecutar» porque contiene una versión **vieja y falsa** de
    `handle_new_user` (sin la capa de cuenta). Su último motivo para existir
    —ser el único sitio con el `CREATE TRIGGER`— se cerró con
    `20260730164435`. O se borra, o el banner se queda para siempre; lo que no
    puede es seguir pareciendo un schema.

20. [~] **El reparto YA se puede escribir — la casilla estaba stale**
    (verificado contra el árbol el 2026-08-27). Existe `CastPanel.svelte`,
    montado en la portada de proyecto
    (`h/[workspace]/project/[slug]/+page.svelte:188`), contra
    `/api/projects/[id]/cast` **GET + POST** y `/cast/[memberId]` **DELETE**.
    Su propia cabecera lo dice: «the first surface in Hour that can WRITE a
    roster». Así que el eje de persona ya puede incluir a gente nueva, y ADR-094
    §5 —«sin reparto no hay eje»— deja de ser un bloqueo.
    **Lo que sigue abierto es solo la mitad de diseño**, y el propio componente
    la nombra: «deliberately plain… the Planner v3 redesign will decide where
    casting really lives». O sea, dónde vive el casting de verdad, dentro del
    pase de UI del Planner v3 — que es lo que esta tarea ya decía el 2026-07-30.
    Texto original abajo, sin tocar, porque describe bien el problema que era.

20b. [ ] ~~**El reparto no se puede escribir desde la app — el eslabón que falta.**~~
    Verificado: `/api/lines/[id]/people` exporta **solo `GET`** y **ningún**
    endpoint escribe `cast_member`; las 6 filas que existen se sembraron. Sin
    esto el eje de persona funciona pero **no puede incluirte a ti**: `/api/team`
    es cast ∪ crew, así que quien no está repartido no aparece ni se puede pinar.
    La política de INSERT ya existe y está gateada (`edit:performance`), así que
    el coste es un endpoint pequeño **más una pantalla** — quién actúa en una
    obra y con qué papel. **Es pantalla, no tubería**, y cae justo en la zona
    que Marco está rediseñando (el Board por personas), así que no se construye
    a ciegas: primero el diseño. **Decidido el 2026-07-30:** se construye
    dentro del pase de UI del Planner v3, no antes y no suelto.

## Cerrado — el pulse del rail (2026-08-10, ADR-096) · DESPLEGADO

27. [x] **`NOW` / `NEXT` bajo el reloj del rail.** `$lib/pulse.ts` (puro, con
    `now` inyectado) + `shell/RailPulse.svelte`, montado en `ScopeRail` encima
    de Scopes. El día son tramos entre hitos, todos leídos por `runSheetSteps`;
    el último tramo corre blando y `until` se queda a null antes que inventar
    una hora. Por persona, con el cuarto estado `unattributed` que ADR-096 §4
    tuvo que abrir para que «libre» no se dijera sobre una ignorancia.
    Lo que viene **es un `Slip`** con el ground quitado (`ground="bare"`), el
    mismo objeto que dibujan el mes, el board, la agenda y el día: el pulse no
    tiene una segunda opinión sobre cómo se llama una fila. Addendum de
    ADR-096 §10-12.
    Verificado: **check 0/0 (1870 ficheros) · unit 555/555 (era 527) · build
    verde**, y contra la base local: `NOW free UNTIL 11h · NEXT [NO]
    RESIDENCY 11h–20h · Residència La Fàbrica · Girona ES`, con la altura
    medida **abortando las dos peticiones a propósito** — 66.42px con las
    rayas y 66.42px con la respuesta.
28. [x] **El rename**, porque la palabra estaba ocupada: la tira del Planner es
    `stat_*` (cierra el nombre partido que ya usaba `cal__stat` y
    `planner.stat_free`), el Desk es `desk.digest_*`. ADR-080 §6 no se
    reescribe. Y sale un guardián nuevo, `i18n/keys.test.ts`, porque el rename
    dejó un call site apuntando a una clave movida y **no lo cazó ningún gate**
    — lo cazó una captura de pantalla.
29. [x] **Desplegado con el Planner v3 entero** (93 commits + la migración de
    `note`). Gate completo: backup → CI → plan → apply → deploy →
    **RLS 150/150 · E2E 52/52** contra el runtime `7d8b1c3`. Detalle del
    apply fallido dos veces y del esquema `hour_backup_20260720` que se
    queda: cabecera de `_context.md`.
30. [x] **Cerrado el 2026-08-11 — no queda nada abierto de este bloque.**
    - **E2E del pulse**: `tests/pulse.spec.ts`, tres leyes (viaja en las cuatro
      lentes · no se mueve cuando aterriza la respuesta, medido **abortando los
      dos feeds** · habla el reloj del Planner sin colar una clave cruda). Cazó
      un salto real de 4,64px que solo aparecía a 1280 de ancho.
    - **El flaky no era `date-edit`**: con `--workers=1` la suite da **55/55**
      dos veces seguidas, y en paralelo cae **un test distinto cada vez**
      (`date-edit`, luego `collab`). El suite firma contra el workspace VIVO de
      producción y un solo Durable Object, así que `fullyParallel` era una
      promesa de aislamiento falsa. `workers: 1` en la config, con la evidencia
      escrita al lado.
    - **El setup de auth** sube a 120s: había fallado dos veces seguidas
      segundos después de un `wrangler deploy`, y un Worker frío en la puerta
      de las 55 pruebas se lee como una suite rota.
    - **`hardening/audit-fixes` borrada** (contenida en `main`, cero commits
      propios). Queda solo `feat/comms-threads`.
    - **`hour_backup_20260720`**: decidido que se queda, con la condición para
      revisarlo — addendum 2 de ADR-096. Deja de ser una pregunta.
    - **El `href` del NEXT, cerrado el 2026-08-11**: una fecha no tiene página,
      pero tiene un DÍA, y el rail la manda a `?view=day&d=` — una dirección
      real que el Planner ya contesta, y un enlace que se puede copiar, en vez
      de un botón que solo funciona desde aquí. El diálogo de edición se queda
      donde vive (mes y agenda): el rail es mobiliario en las cuatro lentes y
      no puede crecer uno. Cuarta ley del spec: lo que viene es siempre un
      sitio al que se puede ir — se afirma el href y se pulsa.
    **No queda nada abierto de este bloque.**

31. [ ] **Mudar el juego sintético de difusión a `playwright`, y solo entonces
    quitarle al usuario del E2E el acceso a los espacios reales.**
    El usuario es **admin** de `muk-cia` y `marco-rubiol`. El spec que escribía
    ahí ya está arreglado, y **no hubo daño**: el `audit_log` demuestra que las
    200 entradas de la fila tocada las escribió ese mismo usuario, desde el
    primer valor. Nada humano se perdió y no se restauró nada.
    Quitar el acceso hoy rompe 2 tests E2E (`person.spec.ts:27`,
    `smoke.spec.ts:70,80`) y 4 ficheros RLS — entre ellos
    `cross-tenant.test.ts:48`, que afirma la lista exacta de tres espacios, y las
    pruebas que necesitan las 154 conversaciones, **que solo existen en
    `muk-cia`**. O sea que el acceso no es un descuido: es el cimiento del
    fixture. El orden correcto es: sembrar el juego sintético en `playwright`,
    re-apuntar los 6 ficheros, y entonces revocar con
    `DELETE /api/workspaces/[id]/access` (el propio usuario puede hacerlo: es
    admin y la RPC no se excluye a sí misma). Urgente el día que MüK Cia se use
    para difusión real en ese espacio.

## AHORA — preparar el Planner v3 (revisión de viabilidad, 2026-07-30)

> Del contraste entre `Hour Views - Scope v3 - Agenda.html` (proyecto
> claude.ai/design `f1741f1f`, leído con `DesignSync`) y el modelo real.
> **Veredicto: es implementable.** Casi todo el prototipo se dibuja sobre
> maquinaria que ya existe, y en varios sitios el prototipo y el repo ya dicen
> la misma ley con las mismas palabras (`agRowKeys()` del prototipo ≡
> `peopleOf()` de `$lib/people`, incluida la parada de la inferencia en la
> puerta de la ausencia). Lo que sigue es lo que NO está.

23. [x] **`note` — el post-it privado, y absorber `person_note`. CONSTRUIDO Y
    DESPLEGADO (ADR-093; migración `20260731120000_note_absorbs_person_note`,
    en prod desde el 2026-08-11).**
    *Corregido el 2026-08-27:* esta tarea llevaba dieciséis días en `[ ]` con
    todo hecho, y `_context.md § Siguiente paso` la seguía llamando «la única
    maquinaria que el Planner v3 necesita y no existe». Verificado contra el
    código y la base, no contra documentos:
    - La tabla y su forma exacta —`note_at_most_one_anchor`, `on_day`, el enum
      `note_visibility`— en la migración desplegada.
    - **RLS**: `tests/rls/note.test.ts`, 13 casos, dentro del 150/150.
    - **`person_note` muerta**: la tabla no resuelve (lo afirma el propio test),
      `person.spec.ts` y `limited-role.test.ts` re-apuntados a `note`.
    - **API**: `/api/notes` GET+POST (vía `create_note`), `/api/notes/[id]`
      DELETE, y `/api/persons/[key]/notes` para el dossier.
    - **El margen, en la UI**: `planner-feeds.svelte.ts` lo lee y
      `h/planner/+page.svelte` escribe y borra.
    Lo que quedó fuera a propósito está escrito en la cabecera de la migración
    (`conversation_id`, `bolo_id`, `parent_id`, la política de
    `visibility='workspace'`). Lo que quedó fuera **sin querer** sale a la
    tarea 32.
    Se conserva abajo el grill que la cerró, porque explica por qué la nota es
    privada y por qué comms es lo siguiente.
    La pregunta («¿las notas cuelgan de Conversations?») se cerró girándola: **la
    nota es siempre privada, y lo que ve el equipo es comunicación.** El margen
    del Planner v3 sale como una caja de texto mía, sin firmas ni pila. Las notas
    de equipo esperan a comms — que pasa a ser **lo siguiente grande**.
    Lo que se construyó, por orden (todo hecho — ver arriba):
    - **Migración aditiva `note`**: `workspace_id, author_id, body`,
      `on_day date NOT NULL`, `visibility DEFAULT 'private'`, y anclajes
      anulables `project_id · line_id · performance_id · date_id · person_id`
      con `CHECK (…) <= 1` **copiando `task_at_most_one_parent`** — cero padres
      es válido y significa «de la compañía», que es el día vacío con el scope en
      «Everything». Sin `conversation_id` ni `bolo_id`. Sin `parent_id`.
    - **RLS**: SELECT/UPDATE/DELETE `author_id = auth.uid()`, INSERT con
      `current_workspace_id()` + miembro + autor. **La rama
      `visibility='workspace'` no se escribe todavía.**
    - **Absorber `person_note`** (cero filas en prod, verificado): la ficha de
      persona lee `note` por `person_id`, se van la tabla y sus RPC
      `create_person_note`/`delete_person_note`, y `person.spec.ts` se
      **re-apunta**, no se borra. De paso muere un bug latente: hoy
      `person_note_select` te exige `read:person_note_private` sobre algún
      proyecto **para leer tu propia nota privada**.
    - **El margen, en la UI**: una caja por día y por contenedor. En un día con
      una sola entrada de calendario el ancla viene rellena; con varias, se
      elige; en un día vacío cae al scope pineado y, si no hay, a la compañía.
    - **No** crea tareas (lo impide ADR-084 §2: las tareas no salen en el
      calendario). **No** añade bloque de notas a la página de función ni de
      línea.
    Regla 8: la parte destructiva es pequeña pero es destructiva — backup/
    preflight proporcional, tipos regenerados y RLS verde antes de prod.
    **Se cumplió:** backup a R2 (run 31367463611) → CI → plan → apply → deploy,
    y el apply revirtió limpio dos veces antes de entrar (ver `_context.md`).

32. [x] **Los restos de `note` (ADR-093) — CERRADOS los dos el 2026-08-27.**
    - [x] ~~**`read:person_note_private` es un permiso muerto que sigue
      sembrado.**~~ **Retirado y aplicado a producción**
      (`20260827100000_retire_person_note_private_permission`). Tres
      movimientos: la función de seed deja de darlo, `array_remove` lo saca de
      las filas que ya lo llevaban, y el COMMENT de vocabulario cerrado vuelve
      a decir la verdad. Probado antes en la base local —un espacio sembrado
      ANTES pasa de 6 de 16 roles a 0 conservando sus 16, uno creado DESPUÉS
      nace con 0, y repetir el UPDATE da `UPDATE 0`—, tipos regenerados byte a
      byte idénticos. Gate: backup a R2 (run 33058807600, **el primero desde el
      16 de agosto**) → CI verde → plan (una sola migración pendiente) → apply
      (run 33059043384). Después: **RLS 151/151 · E2E 60/60 · unit 555/555 ·
      check 0/0**. Lo sujeta `note.test.ts`, que ya contaba el bug del que
      salió.
    - [x] ~~**El margen del Planner no tiene E2E.**~~ **Hecho el 2026-08-27**:
      `tests/note-margin.spec.ts`, 4 tests, fija las tres ramas de la regla
      (ancla puesta · selector · fallback) y lee de la API la mitad que la
      pantalla no enseña —que la anclada vuelve con su `date_id` y la caída
      vuelve sin ancla pero con casa—. Suite **60/60**, verde tres pasadas
      seguidas y sin residuo. Dos cosas aprendidas escribiéndolo, ambas en el
      fichero: **el día no se elige, se pregunta** (hoy ya tiene entradas, así
      que suponerlo vacío probaba la rama del selector informando en verde la
      del ancla puesta), y **un spec que solo limpia cuando pasa no se limpia
      solo** — murió cuatro veces a medias y dejó filas que hubo que barrer a
      mano, así que la barrida va ahora a los dos extremos.

24. [x] **Persona: ¿dial o vista? — DECIDIDO Y CONSTRUIDO. La casilla llevaba
    27 días stale** (verificado contra los ADR y el árbol el 2026-08-27).
    Esta tarea citaba ADR-092 como si fuera vigente, **sin su nota de
    superseded**, y pedía «decisión de Marco antes de construir». Las dos
    mitades eran falsas:
    - **`ADR-094` (2026-07-31) lo decidió**, y se titula literalmente «El eje de
      carriles es un dial, y su valor vive en la URL. Y ya estaba construido».
      Supera a ADR-092 §1 **solo en la conclusión de mobiliario**: el
      razonamiento partir-vs-cubrir sigue entero, y con él `inScope()`
      container-only e `isEmpty`. Rechazó explícitamente las dos alternativas —
      persona como quinta proyección, y el dial efímero del prototipo.
    - **Lo único que ADR-094 dejó abierto —qué DIBUJA `persona`— lo cerró
      ADR-095 §2**: el Loom se borró (260 líneas dibujando «las filas son
      personas» por segunda vez) y ganaron los carriles del Board. El propio
      ADR-094 dio la señal para saberlo: «si gana el Board se estrenan
      `personRowKeys`/`noCastKey`, si gana el Loom se borran». **Se estrenaron**
      — `board-lanes.ts:324` las usa.
    Y los tres avisos que ADR-094 §3 exigía al girar a persona **están los tres**:
    (a) el tally dice «N personas» y cuenta `notCast`; (b) `CarrilsStrip:671`
    pasa `axis === 'scope' ? lane.id : null`, o sea que en persona el `+` no
    sabe el proyecto y el diálogo tiene que preguntar; (c) el board suelta el
    censo del mes y cuenta compromisos. Todo desplegado el 2026-08-10, y la
    mitad de la URL la guarda un E2E desde `7d8b1c3`.

25. [x] **Fontanería del Planner v3 — HECHA ENTERA, la casilla estaba stale**
    (verificado contra el árbol el 2026-08-10, no contra este documento). Los
    tres puntos cayeron el 31 de julio: los cinco hitos se declaran en
    `month-events.ts:32-36` y el adaptador es `runSheetSteps()` (`:461`, con
    5 tests que fijan la costura); `PlannerView` es
    `'day'|'month'|'agenda'|'board'` (`planner.ts:667`); y el modo de holds por
    espacio vive en `settings->>booking_mode`, proyectado por `/api/workspaces`
    y consumido por 5 dibujos. El adaptador devuelve `{key, at}` y no
    `{label, at}`: la clave es vocabulario, la etiqueta la pone quien dibuja.
    Texto original abajo, sin tocar.
    - El **run sheet ya viaja y se tira**: `/api/performances` hace SELECT de
      los cinco (`load_in_at, soundcheck_at, start_at, loadout_at, wrap_at`,
      `+server.ts:187`) y el VM de `month-events.ts` solo declara `load_in_at` y
      `start_at`. Declarar los tres que faltan + el adaptador de pasos
      (`[{label, at}]`) decidido el 29 — cuando llegue `schedule_slot` de
      ADR-090 solo cambia el adaptador.
    - **`'day'` en `PlannerView`** (`'month'|'agenda'|'carrils'`): el Today del
      diseño es la cuarta proyección. Flow≈agenda, Board≈carrils, Month=month
      ya existen.
    - **Convención de holds por espacio** (`queue` con 1r/2n/3r vs `single`):
      `workspace.settings jsonb` existe y **no lo usa nadie**. Casa gratis, sin
      migración. El enum `performance_status` ya lleva `hold` **y** `hold_1..3`,
      o sea que los dos modos son representables hoy sin tocar un dato.

26. [x] **Vocabulario del diseño vs el enum — CERRADO: gana lo implementado.**
    (Marco, 2026-07-30.) `budget` no existe en `line_kind` → cae en `misc`.
    `estudi` y `reunió` no existen en `date_kind`
    (`rehearsal, residency, travel_day, press, other, day_off`) → caen en
    `other`. `residence` del prototipo es `residency`. **Cero migraciones de
    enum**; el diseño se ajusta al vocabulario que ya corre.

> **Lo que NO hay que construir** (verificado contra la base viva, no contra el
> checkpoint): la banda de decisiones (`decisionsFor()` ya emite
> `level: people|double|possible` + `kind: choose|release` y devuelve las
> concurrencias aparte), la caducidad del hold (`decideBy()` devuelve una fecha
> ISO real: día del bolo − `hold_notice_days`), los chips de producción
> (`READINESS_KEYS = ['hotel','technical']` + `performance.readiness`), el
> monograma editable (`project.initials` + `accent`), el gloss de zona horaria
> (`venue.timezone`, ya en el VM), el viaje (`date.kind='travel_day'` +
> `travel_direction`), el bloque de ensayos multi-día (`series_id`) y todos los
> verbos del board (`PATCH /api/performances/[key]` para el *Confirm*,
> `POST/PATCH/DELETE /api/dates` para el `+` y la ficha inline).
> **Y una deuda que se cierra sola:** `personRowKeys()` y `noCastKey()` están
> exportadas sin usar en `$lib/people` — son exactamente el resolutor de
> carriles del Board, así que el diseño las estrena.

## Cerrado — bloque 8: el eje de persona (2026-07-30), CONSTRUIDO Y DESPLEGADO

- **Persona como cuarta dimensión de scope** (ADR-092): pin `pe:<personId>`,
  `ResolvedScope.personIds`, búsqueda de personas en el ⌘K (insensible a
  diacríticos), y el Planner estrechando por persona en las tres proyecciones.
  La atribución vive en `$lib/people.ts`, pura y con 20 tests: un reparto
  explícito **nunca** se filtra por ausencias (eso es el choque, y esconderlo lo
  borraría de la única vista que existe para cazarlo) y la **inferencia se para
  en la puerta de la ausencia**. El filtro **dice cuándo supone**
  (`N por proyecto, sin reparto` en el pulse).
- **El enlace login↔persona tenía puerta pero no picaporte.**
  `share_my_profile_with_workspace` estaba viva en prod, tipada en `db-types.ts`
  y **sin un solo llamador de aplicación** (solo un test de RLS). Ahora:
  `GET/PATCH /api/me`, `POST/DELETE /api/me/profile-share` y un grupo real en
  Ajustes → Perfil. Compartir sigue siendo **explícito y solo el nombre por
  defecto** — no se engancha a aceptar una invitación a propósito.
- **Dos defectos del motor, arreglados con test:** `awayBands()` emparejaba la
  ida más antigua, así que un viaje sin vuelta se apropiaba de la vuelta del
  siguiente y pintaba 17 días de gira (había un test **fijando** el
  comportamiento equivocado); y el Loom atribuía ensayos a personas **sin mirar
  si estaban fuera**, con lo que un hilo decía «fuera todo el día» y «quizá
  ensayando» del mismo día.
- **Un defecto que habría destruido datos:** el filtro de tokens de la URL era
  `/^[spl]:.+/` — una clase de caracteres, así que `pe:` no pasaba, y como el
  efecto de entrada reescribe los pins con lo que sobrevive al filtro, pinar
  una persona la **borraba** en la siguiente navegación.
- **CSP de desarrollo:** `svelte.config.js` derivaba `connect-src` de
  `process.env`, que no ve los `.env*` — así que con una Supabase local la CSP
  se horneaba con el host de producción y **todo websocket de realtime quedaba
  bloqueado en silencio**. Ahora lee los ficheros con `loadEnv`, **nunca en un
  `build`** (un `.env.local` no puede alcanzar un bundle desplegado).
- Consolidación de paso: `TeamItem` estaba declarado 3 veces y la consulta
  copiada 2 (con un comentario confesándolo) → un `teamQueryOptions()` en
  `nav-queries`, y `project_ids` llegó a los cuatro consumidores de una vez.
- Gates: `svelte-check` 0/0 (1.844), unit **408/408**, build verde. RLS y E2E
  **no** (credenciales de fixture rotas — ver `_context.md § Supabase`).

## Cerrado — pase de endurecimiento (auditoría 2026-07-24), DESPLEGADO 2026-07-25

Runtime en prod **`252729f`**, `dirty:false`, builtAt 2026-07-25T07:10Z;
`main == origin/main == prod`. Las 5 migraciones `20260724*` constan aplicadas
en `supabase_migrations.schema_migrations` de **prod y de staging**.

**Verificado contra producción real, no contra el prompt:**

- Vector de falsificación fiscal **cerrado**: `has_table_privilege('authenticated', …)`
  da `false` en INSERT/UPDATE sobre `invoice`, `invoice_line` y `payment`;
  las RPC sancionadas (`update_invoice`, `issue_invoice`, `create_payment`)
  siguen ejecutables, y `expense` conserva su UPDATE a propósito.
- `create_payment` con 12 argumentos + `payment.idempotency_key` y su índice
  único parcial; los 3 índices nuevos presentes.
- Las 3 RPC calientes reescritas usan `accessible_project_ids`, y la
  **equivalencia de autorización se comprobó en vivo** suplantando a un usuario
  real: 27 = 27 bolos, 157 = 157 pagadores (0 gastos porque prod no tiene ni uno).
- `fiscal_identity_select` gateada por `can_read_workspace_money`;
  `workspace_alias_request` con FORCE RLS.
- Advisors de seguridad: **0 ERROR** (76 WARN = fronteras DEFINER intencionadas
  + las 2 proyecciones públicas por token + HIBP, que pide Supabase Pro).
- Datos intactos: 53 facturas, 16 pagos, 118 bolos.

**Lo único no verificado desde aquí:** que el paso «RLS contract» del run de
staging saliera en verde. El CLI de `gh` está bloqueado en el entorno del
agente, y un fallo de ese paso dejaría la BD de staging con el mismo aspecto
(migraciones + fixtures ya aplicadas antes). Marco lo lanzó y el run habría
salido rojo; **si alguien quiere el dato duro, está en el summary del run**.

**Tests RLS escritos y en verde (2026-07-25):** `tests/rls/hardening.test.ts`,
9 casos. Suite completa **136/136**. Cubren lo que fallaría en silencio: el
candado de escritura fiscal (una migración futura con un GRANT en bloque lo
deshace y nadie se entera), la equivalencia de autorización de las RPC
reescritas (contrastada contra el camino RLS fila-a-fila, intacto), la
idempotencia de pagos y el gate de `read:money` sobre `fiscal_identity`.

**Escribirlos destapó dos regresiones que el deploy no había visto** — motivo
suficiente por sí solo para haberlos escrito:

1. `payment.test.ts` y el `afterAll` de `money-v3.test.ts` emitían y reseteaban
   facturas con un PATCH directo. Tras el revoke eso da 403 **sin romper el
   test** (no había aserción), dejando facturas emitidas que `delete_invoice`
   —solo borradores— no puede limpiar: fuga de fixtures acumulativa. Ambos
   pasan ahora por `issue_invoice` / `update_invoice`.
2. `POST /api/invoices` aceptaba un `number` del cliente. Con el PATCH directo
   cerrado, ese borrador quedaba **imposible de emitir** para siempre
   (`issue_invoice` escribe el correlativo y el trigger de inmutabilidad lo
   rechaza). La UI nunca lo enviaba, así que no hubo impacto vivo; el campo
   sale del schema — los números vienen de la serie, punto.

## Deuda de este pase

Auditoría completa de seguridad, rendimiento y estabilidad sobre `main`
(5 frentes: API/auth, SQL/RLS/RPC, XSS/frontend, rendimiento, estabilidad).
Veredicto de fondo: **sin agujeros críticos ni cross-tenant**; las defensas
estructurales aguantan el trazado (RLS uniforme, `search_path` fijado en las
~100 funciones DEFINER, CSP estricta, cero `{@html}`, numeración atómica).

Verificado local antes del deploy: `svelte-check` 0/0 (1.834 ficheros), unit
**368/368**, collab 11/11 + tsc limpio, build verde, y las 5 migraciones
aplicadas contra un Postgres 17 desechable (cuerpos plpgsql validados +
pruebas funcionales de idempotencia y de los tres guards fiscales).

1. [x] `fiscal_identity`: un member sin `read:money` NO ve iban/swift/tax_id.
2. [x] `invoice`/`payment`/`invoice_line`: INSERT/UPDATE/DELETE directos por
   PostgREST fallan; las RPC siguen funcionando.
3. [x] `update_invoice`: rechaza `number`, `status:'issued'` y `status:'paid'`.
4. [x] Equivalencia de las 3 RPC reescritas, como test permanente: contrasta la
   RPC contra el camino RLS por fila (dos implementaciones independientes de la
   misma pregunta de autorización, que deben seguir coincidiendo).
5. [x] **E2E post-deploy contra `252729f`: 27/27, sin skips** (2026-07-25).
   Destapó un tercer fallo, y en `money.spec.ts` **la equivocada era la
   aserción, no la app**: esperaba que la tarifa de un trato `proposed`
   apareciera en el roll «contracted», cuando `CONTRACTED` son solo
   confirmed/done/invoiced/paid (ADR-087). Nunca había pasado — el spec se
   escribió contra el UI v3 el 07-24, la única pasada posterior atribuyó su
   fallo a la race de carga de `/h/money`, y tras arreglar esa race
   (`ff6ec4e`) no se volvió a correr. Ahora la aserción está invertida y pinza
   la regla de verdad: **el pipeline no puede contarse como vendido**.
6. [x] Desplegado 2026-07-25 — runtime `09f512a`, E2E 27/27 contra él.

## Cero diferidos — los tres, cerrados (2026-07-25)

Marco: «no quiero ningún diferido». Cerrados los tres, cada uno como tocaba.

1. **`project_id_of_*` expuestas como RPC → ARREGLADO.**
   `20260725100000_unexpose_project_id_helpers.sql`. Las 3 funciones se mueven
   al esquema **`private`**, que PostgREST no expone, y las **14 policies** de
   `asset_version`/`cast_override`/`crew_assignment`/`expense` se repuntan.
   El GRANT a `authenticated` **se mantiene a propósito**: las policies se
   evalúan como el invocador y sin él fallaría la consulta entera — lo que se
   quita es la exposición como endpoint, no el permiso.
   **Verificado localmente reconstruyendo el esquema entero desde cero** (las
   25 migraciones, 0 fallos) y con prueba funcional de RLS sobre fixture: el
   dueño ve sus filas (1/1), un extraño no ve nada (0/0). Test permanente en
   `hardening.test.ts` que exige que el RPC no resuelva **y** que las tablas
   dependientes sigan leyéndose (la mitad que se rompe si alguien «arregla»
   esto revocando el EXECUTE).
   **Aplicado y verificado en STAGING** (2026-07-25): 0 helpers públicos, 3 en
   `private`, 14 policies repuntadas, versión registrada. Los ceros que devuelve
   un miembro en `asset_version`/`expense` se persiguieron hasta el fondo: esas
   dos filas están **soft-deleted** y las policies llevan `deleted_at IS NULL`,
   o sea RLS correcto — no un 0 vacío que no prueba nada.

   **APLICADO A PRODUCCIÓN 2026-07-25** — run
   [30160118066](https://github.com/marcorubiol/hour/actions/runs/30160118066)
   (`• 20260725100000_unexpose_project_id_helpers.sql`), sobre el backup de ese
   día 07:09Z (run 30148794137) y con plan previo limpio (30157255537).
   **RLS 137/137** y **E2E 27/27** contra prod después de aplicar.

   > Trampa que costó dos intentos y merece recordarse: el apply de las 11:41
   > salió **success** pero registró *«Remote database is up to date»* — el
   > workflow hace checkout de `main` **desde GitHub**, y la migración estaba
   > solo en local. Un apply verde no prueba que se haya aplicado nada:
   > **hay que leer el log y ver el nombre del fichero**.

   Rollback quirúrgico, capturado de prod viva antes de tocar nada, en
   `build/runbooks/rollback-20260725-unexpose-helpers.sql`.

2. **Tokens de share en claro → DECIDIDO NO HACERLO (ADR-091).**
   No es deuda, es un trade-off, y al analizarlo la conclusión se dio la
   vuelta: el beneficio es ~cero y el coste es real. La amenaza escrita era «un
   dump entrega enlaces usables», pero **ese mismo dump ya contiene los datos
   que el enlace expone** (32 performances y 26 dates junto a los 46+105
   shares): hashear protege el enlace a unos datos que el atacante ya tiene
   abiertos. Y la UI **lista los shares y deja recopiar la URL**
   (`FeedDialog.svelte:116-120`), así que hashear impone «cópialo ahora o
   piérdelo» — peor producto a cambio de nada. Los controles siguen siendo la
   entropía (~244 bits) y la revocación. Premisas que obligarían a revisarlo,
   en el ADR.

3. **HIBP → no es deuda técnica, es una compra.** Confirmado por API: la org
   `marcorubiol's Org` está en plan **`free`** y la protección de contraseñas
   filtradas exige **Pro**. No hay nada que yo pueda arreglar en el código;
   es una decisión de dinero tuya. Sigue en «Decisiones con coste».

   `sharp`/`cookie`: CVE transitivos de `wrangler>miniflare` y de `kit`. Son
   dependencias de **build**, no entran al bundle del Worker, y no hay versión
   que los resuelva sin que sus padres actualicen. Nada que hacer hoy.

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
   `password_hibp_enabled` y volver a ejecutar el advisor. **Ojo: el upgrade que
   pide esta tarea resuelve también la § 33**, así que las dos son la misma
   decisión mirada desde dos sitios.

33. [x] **La pausa del plan Free volverá — DECIDIDO: se acepta, con fecha de
    caducidad.** (Marco, 2026-08-29: «mientras la app no esté activa al
    público, acepto la pausa».) O sea la tercera salida de las tres que había,
    y es una decisión, no un olvido: la firma está documentada, se reconoce en
    un minuto y despertar cuesta un botón. **Deja de valer el día que haya un
    usuario que no sea Marco** — es decir, al abrir la beta externa (Phase 0.9),
    y ese día vuelve la elección entre Pro (que arrastra también la § 9 del
    HIBP) y un latido que falle ruidosamente. Hasta entonces, lo único que hay
    que hacer es reconocerla: `dig <ref>.supabase.co` vacío. Texto original
    abajo con las tres opciones y su coste, por si hay que reabrirlo.
    Pasó entre el 16 y el 23 de agosto de 2026 y costó **al menos cuatro días**
    de app inutilizable: el Worker sigue verde, la pantalla carga y solo el
    login falla, así que nada avisa. La firma está en `_context.md` (el DNS
    desaparece; `dig` antes que credenciales). Lo que no hay es decisión.
    La causa es que **Hour se usa a ráfagas** y el backup semanal a R2 es el
    único tráfico automático — una semana entre ejecuciones es exactamente el
    ancho de la ventana de pausa, así que no sirve de latido. Tres salidas, y
    hay que elegir una a sabiendas:
    - **Pro.** Se acaba la pausa, y de paso cae la § 9 (HIBP). Cuesta dinero
      todos los meses para un producto que aún no cobra.
    - **Un latido.** Un cron barato a mitad de semana que toque la base. Es la
      opción de coste cero, y es la que hay que escribir con cuidado: tiene que
      **fallar ruidosamente**, porque un latido que se rompe en silencio deja
      exactamente el mismo agujero y encima da sensación de cubierto.
    - **Asumirla.** Ya está documentada y ahora se reconoce en un minuto. Es
      una respuesta legítima mientras el único usuario sea Marco; **deja de
      serlo el día que haya una beta externa**, que es Phase 0.9.
    Afecta también a `hour-staging`, que sigue pausado — ver § 34.

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
> **BUG ARREGLADO Y DESPLEGADO (2026-07-24, runtime `ff6ec4e`): `/h/money`
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
> fix (PENDIENTE aparte: arreglar/rotar esa credencial, la suite E2E local no
> puede loguear). Correr `money.spec.ts` (el guardián, que espera
> `section.obra`, solo visible con `loading===false`) contra prod `ff6ec4e`
> queda como confirmación end-to-end. **Desplegado** el 2026-07-24: commit
> `ff6ec4e` (rama efímera `fix/money-loading-race` → ff a `main` → push →
> `pnpm --filter web run deploy`); `/health/live` sha `ff6ec4e` dirty:false,
> `/health/ready` Supabase ok. Solo frontend, cero schema.

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

15. [x] **Editar una fecha desde la UI — HECHO Y VALIDADO EN PROD (2026-07-30).**
    `EditDateDialog.svelte` sobre `PATCH`/`DELETE /api/dates/[id]`, abierto desde
    el chip del mes y desde la fila de la agenda. Su E2E
    (`tests/date-edit.spec.ts`, 3 tests) **corrió por primera vez esa noche
    contra el runtime `0f8e12f` y quedó en verde**, incluida la aserción que
    lleva el peso: guardar sin tocar la hora deja `starts_at` idéntico.
    El primer rojo fue **del spec, no de la app**: `runDay()` elegía el 15 del
    mes en curso, que el mes dibuja y la agenda no —la agenda es un diario y
    **abre en hoy** (`agendaFromIso = todayIso`), lo anterior queda tras un
    «cargar antes»—. Corregido a hoy, el único día que las dos proyecciones
    enseñan sin navegar. Antes decía: *«PATCH y DatePatchSchema están
    construidos pero ningún componente los usa, y el chip del mes es un `span`
    y no un enlace»*.

16. [~] **Multi-día para PERFORMANCES — BASE Y API HECHAS Y DESPLEGADAS, falta
    la pantalla** (2026-08-29).
    *Construido:* `performance.series_id` + índice parcial calcado del de
    `date`, y `create_performance_series` — atómica, SECURITY DEFINER, con las
    validaciones de `create_performance` dentro y una que el molde no
    necesitaba: **una serie no puede repetir día**. Migración
    `20260829100000`, aplicada a producción (run 33237067289) tras backup y CI.
    Encima, `POST /api/performances/series`, calcado de `/api/dates/series`; la
    atomicidad es la razón de que la ruta exista en vez de un bucle de POST
    desde el cliente. Verificado en vivo: 1 día → 400, día repetido → 400,
    proyecto ajeno → 403, y 3 días → 201 con **una sola serie** y tres slugs.
    Guardián: `tests/rls/performance-series.test.ts`, 7 casos. RLS 156 → **163**.
    *Lo que falta, y es pantalla:*
    - El conmutador «varios días» en el alta de función, **reusando
      `BlockDays.svelte`** tal cual — ya devuelve la lista de días resuelta, que
      es justo lo que el endpoint espera (por eso el cuerpo lleva días y no un
      `from`/`to`: el servidor no debe re-derivar lo que ya se negoció en
      pantalla).
    - **La agrupación en `MonthGrid`**, que hoy solo agrupa `date`. Y con ella
      LA LEY, que ya está escrita para las fechas y hay que respetar igual: dos
      funciones **distintas** el mismo día no se colapsan nunca — los dos
      nombres tienen que poder leerse. Colapsar es solo para la misma serie.
    *Dato:* hay una tanda real de tres noches en `marco-rubiol · Project`
    (5–7 oct, «Sala Demo») creada al verificar el endpoint. Hoy el mes la
    dibuja como tres cards sueltas — que es exactamente el «antes» de lo que
    falta.
    Texto original abajo.

16b. [ ] ~~histórico~~ **Multi-día para PERFORMANCES.** Hoy `performance.performed_at` es un
    solo día. Es simétrico a lo que ya existe para `date`: `performance.series_id`
    + índice, RPC `create_performance_series` atómica calcada de
    `create_date_series` (mismo gate `edit:performance`, conversión día a día
    porque el DST muerde), conmutador «varios días» reusando `BlockDays.svelte`,
    y agrupación en `MonthGrid`. **Dos funciones DISTINTAS el mismo día no se
    colapsan nunca** — los dos nombres tienen que verse.

17. [ ] **Escaleta de momentos — el orden del día, en vivo (ADR-090).**
    **Modelo DECIDIDO el 2026-07-25, nada de schema construido.** Absorbe la vieja
    tarea «tipos de horario añadibles por el usuario»: las cinco franjas de
    ADR-023 son **columnas fijas** en `performance` con un CHECK de orden — una
    lista disfrazada de columnas, y nadie puede añadir «photo call» sin migración.

    Marco (2026-07-25) la amplió: no es solo poder añadir tramos a una función, es
    **hacer el orden del día y rellenarlo al momento**, y que valga igual para un
    **día de ensayo**. Por eso la tabla **no es `performance_slot`**.

    **Lo decidido (ADR-090):** tabla `schedule_slot` con `performance_id` **XOR**
    `date_id` (`CHECK num_nonnulls = 1`), molde de `travel_stage`; `label` libre en
    vez de enum; escritura solo por RPC con gate `edit:performance`. La escaleta
    **nace colaborativa**: `Y.Array` `schedule` en el **mismo doc** que ya tiene
    `notes`, con `date` añadido a `ALLOWED_TABLES`, y materialización por
    `replace_schedule_slots` que diffea por id — las filas siguen siendo la
    proyección que leen road sheet, Desk, ICS y la vista pública. Las 5 columnas se
    **backfillean y se eliminan** en la misma migración.

    **Secuencia:** P1 migración (tabla + RLS + 4 RPCs + backfill + drop + tipos +
    tests RLS) · P2 `Y.Array` y materialización en el worker de collab · P3 UI: la
    **vista de momento** dentro del día.

    **Dependencia dura:** el día de un ensayo desde la UI pasa por la **tarea 15**
    (editar una `date`, que no existe) — la misma que bloquea Travel v2 P3.
    **Ojo al backfill:** `start_at` lo leen Desk, MonthGrid y tasks; es la
    superficie que decide si la migración va de una tacada.

    > **No empieza hasta cerrar Travel v2**, que está EN CURSO y también sin
    > schema escrito. Dos modelos nuevos a la vez es como se pierde el hilo.

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
