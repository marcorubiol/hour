# Hour — cola vigente

> **ÚNICA COLA ACTIVA.** Solo lo abierto (2026-10-14). Lo cerrado, con su número de §, está en
> `_notes/tasks-archive.md` (p. ej. § 34, el gate de schema). **Antes de proponer algo, búscalo en `CHANGELOG.md` y
> en el archivo:** puede estar hecho.
> Estado general y evidencia: `_context.md`. Historia: `_decisions.md` y `_notes/sessions-log.md`. Los documentos de
> `build/archive/` no crean tareas.

## PRIMERO — nada. `main` == prod y las dos suites están vivas (2026-07-30, noche)

> Esta sección existía para dos cosas y ya no queda ninguna. Se deja el
> cierre escrito porque una de las dos era **falsa**, y borrarla sin decirlo
> es cómo se repite.

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

38. [~] **El paso barato, HECHO Y DESPLEGADO el 2026-09-26** (entró en
    `main` con `677f342`; runtime `a67e99c`). E2E después del deploy: 61/62,
    con el rojo en Books por tiempo, que solo pasa. Cero schema. Marco lo aprobó mirando las
    capturas; entró por fast-forward desde `feat/planner-tour-deduced`, ya
    borrada.
    `awayBands()` guarda de qué dos viajes sale cada banda (`out`/`back`), y la
    gira lo dice con palabras en las tres vistas que la dibujan:
    - **Mes:** en la voz del tramo, el hueco donde una ausencia pone sus
      fechas: «DE GIRA *Sevilla* DEDUCIDA · IDA 7 OCT · VUELTA 12 OCT». Una
      banda estrecha suelta entero lo que no cabe, primero los viajes y luego
      la palabra; el lugar nunca. Umbrales medidos, con la suma escrita en el
      CSS (419 todo · 205 sin viajes). El tooltip lo lleva siempre entero.
    - **Agenda y Día:** la línea termina en «· deducida · ida 7 oct · vuelta
      12 oct».
    - **De paso, y en commit aparte para poder revertirlo solo:** el nombre de
      la gira en tooltip y líneas decía «fuera · MaMeMi», la palabra de la
      ausencia. `MonthGrid` ya escribía la ley contraria («una ausencia dice
      fuera, una gira dice de gira; nunca la misma palabra») y el texto era un
      resto de la v2 (07-18), anterior a separarlas (07-31). Ahora «de gira ·
      MaMeMi».
    *Verificado:* `svelte-check` 0/0, unit 563/563, y capturas contra la base
    local con tres giras de 4, 2 y 1 día a 1024, 1280 y 1600 en es/en/ca.
    RLS y E2E no se corrieron: pegan contra producción.
    **Marco, 2026-09-26, sobre lo que quedaba:** aprueba la rama tal cual,
    mantiene «de gira» en vez de «fuera», y acepta que una gira de **un día**
    a 1280 o menos solo lo diga en el tooltip del mes (marca, tipo y lugar ya
    desbordaban antes): eso se resuelve con el paso caro, que redibuja la
    banda de todos modos.
    - **Tablero, hecho el mismo día a petición suya:** la gira dice «DE GIRA»
      y no «fuera», y en el hueco del «hasta» pone la procedencia entera si
      cabe, si no solo «deducida», si no nada (la misma ley de todo o nada que
      el «hasta»). El tooltip la lleva siempre. De paso, la palabra de tipo del
      Tablero no podía partirse porque «away» era una sola palabra; «de gira»
      tiene espacio y se partía en dos líneas recortadas. Ahora no se parte.
    El paso caro (confirmarla, y el fondo) sigue sin decidir.
    Texto original abajo.

38b. [ ] **La gira deducida no dice que la dedujimos, y no se puede aceptar.**
    (Marco, 2026-08-30, mirando el mes: «no podemos añadir cosas nosotros sin
    decirlo».) `awayBands()` infiere una banda `ON TOUR` emparejando un
    `travel_day` `outbound` con el `return` siguiente — es **pura**, no existe
    nada en la base. La banda aparece y ya está: no declara que la inventó la
    app, y no hay forma de aceptarla ni rechazarla. La cursiva insinúa «esto es
    nuestro», pero insinuar no es decir.
    **Descartado en la misma conversación:** pintarla como duda. Una tentativa
    dice «alguien lo escribió y no está seguro»; una gira dice «nadie lo
    escribió, lo dedujimos de dos viajes que SÍ están confirmados». Los hechos
    no son dudosos — lo que no es del usuario es la frase. Pintarla como duda
    diría «quizá no pase», que es falso. Es la separación que `certainty.css`
    ya hace: `.grain` duda del hecho, `.guess` duda de la atribución.
    **Dos pasos, y el segundo es una función de verdad:**
    - **Barato:** que la banda DIGA que es deducida y de dónde sale, con
      palabras y no solo con una inclinación. Cero schema.
    - **Caro y por decidir:** poder **confirmarla**. Marco propuso además un
      fondo de color. Dos costes que hay que resolver ANTES de tocar nada:
      (a) un relleno sería **el primer objeto pintado de la hoja** —el mes es
      papel a propósito, «las reglas de la rejilla son las únicas líneas»—, así
      que es una decisión de lenguaje, no un detalle; y (b) confirmar exige
      **guardar** algo que hoy no existe, y con ello la pregunta difícil: si
      mañana borras uno de los dos viajes, ¿qué le pasa a la gira confirmada?
    Encaja con la dirección del producto ya escrita —la IA propone, una persona
    aprueba, el sistema ejecuta y deja auditoría— llegando temprano y desde una
    deducción tonta en vez de desde un modelo.

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

## Decisiones con coste o autoridad externa

- [ ] Marco: hacer — **Recorrer la app él mismo antes de invitar a Anouk** (Marco, 10-10); después, pasar su email para invitarla a `muk-cia`.
9. [ ] **Pasar `hour-phase0` a Supabase Pro (25 $/mes) antes de la beta; después el coordinador activa HIBP y corre el advisor.** Marco, 2026-10-10: Pro antes de la beta, pero **aún no**; sigue en Free con el keepalive diario. El proyecto está en plan
   Free y la función requiere Pro. Marco debe decidir el upgrade; después activar
   `password_hibp_enabled` y volver a ejecutar el advisor. **Ojo: el upgrade que
   pide esta tarea resuelve también la § 33**, así que las dos son la misma
   decisión mirada desde dos sitios. **2026-10-09:** con Anouk entrando, la
   recomendación es pasar a Pro antes de la beta (quita la pausa).

41. [ ] **Hosting: estudio de coste del «camino A» de Scalingo, ahora (Marco, 2026-10-10: opción b). Estudio hecho: `research/infra/2026-10-10-scalingo-camino-a.md` (camino A con HA ~83 €/mes y 10-13 días; Pro 25 $). **DECIDIDO por Marco el 2026-10-10: Supabase Pro ya (§ 9); el camino A se aparca hasta un motivo que Supabase no cubra.** Antes:** pensar en el «camino A» de Scalingo cuando se decida
    (Marco, 2026-10-09, para pensar, no decidido).** A Marco le atrae la alta
    disponibilidad de Scalingo (PostgreSQL Business: dos servidores con cambio
    automático, desde 40 €/mes con 1 GB). Salir de Supabase no es mover la
    base: Hour usa su Auth (y un hook de claims), RLS sobre `auth.uid()` /
    `auth.jwt()` (119 usos, 100 grants a `authenticated`), PostgREST como única
    vía de datos (56 ficheros de API, 48 RPC) y Realtime para la presencia; no
    usa Storage ni Edge Functions.
    - **Camino A (el realista):** en Scalingo, PostgreSQL Business más GoTrue y
      PostgREST (los dos libres) en contenedores; la app solo cambia de URL;
      `auth.uid()`, `auth.jwt()` y el hook se recrean; la presencia pasa a
      Durable Objects. Unos 100 €/mes con todo duplicado (frente a ~25 $ de
      Supabase Pro); a ojo una o dos semanas con verificación.
    - **Camino B:** reescribir a SQL directo (Hyperdrive, auth propio, RLS por
      transacción). Varias semanas; descartado salvo motivo nuevo.
    - **Antes de decidir, comprobar en una cuenta de prueba de Scalingo:** que
      se pueden crear los roles `anon` / `authenticated` / `service_role` y que
      el usuario de la app no tiene BYPASSRLS; las extensiones `citext`,
      `pg_trgm`, `pgcrypto` y `unaccent`; la conexión desde fuera de su red; y
      que la alta disponibilidad exige duplicar también GoTrue y PostgREST.
    - **Mientras tanto:** no añadir dependencias nuevas de Supabase, para que el
      camino A no se encarezca.
    - Contexto: la pila sigue en Cloudflare (empresa de EE. UU.), así que mover
      solo la base no resuelve la soberanía; si un día es argumento de venta, se
      decide para toda la pila.

## Después de money v3 — planner, lo que quedó pendiente

16b. [ ] ~~histórico~~ **Multi-día para PERFORMANCES.** Hoy `performance.performed_at` es un
    solo día. Es simétrico a lo que ya existe para `date`: `performance.series_id`
    + índice, RPC `create_performance_series` atómica calcada de
    `create_date_series` (mismo gate `edit:performance`, conversión día a día
    porque el DST muerde), conmutador «varios días» reusando `BlockDays.svelte`,
    y agrupación en `MonthGrid`. **Dos funciones DISTINTAS el mismo día no se
    colapsan nunca** — los dos nombres tienen que verse.

## EN CURSO: Travel v2, el viaje como trayecto multi-etapa (ADR-089)

> **2026-10-09: P1 APLICADA EN PRODUCCIÓN** (apply run 37939208092, RLS
> 179/179, mergeada en `main` como `d540641`). Lo siguiente de Travel es la
> pantalla (P2), que pide diseño.

> **2026-10-10: PRIMERA VERSIÓN DE LA PANTALLA, para que Marco la corrija.**
> Rama `claude/travel-screen` (sale de `claude/schedule-screen`, la escaleta,
> y la necesita). Cero schema. Sin ADR todavía: se escribe cuando Marco valide.
> Lo decidido en esta versión:
> - **Los extremos van en los diálogos de alta y edición.** En un viaje, el
>   campo «Ciudad» se parte en «Origen» y «Destino». `city` sigue siendo el
>   destino (lo escribe el endpoint, un solo dueño), porque `awayBands()` y
>   los lectores viejos lo leen. Salir de viaje en el PATCH limpia los
>   extremos, como ya hacía con la dirección.
> - **La card dice `TO Sevilla / FROM Barcelona` con datos escritos**: el
>   destino escrito manda, el origen escrito gana al deducido (`dateSlip`).
>   Mes, agenda, día y tablero lo heredan sin tocar cada vista.
> - **Los tramos viven en la vista día, en el sitio de la escaleta**, con su
>   misma tapa, columna de hora y reloj (`20h30`). Un viaje no tiene escaleta:
>   su día son sus tramos. No van al diálogo (que edita los hechos gruesos) ni
>   a la agenda ni al mes (sería pedir los tramos de cada fila).
> - **Escribir un tramo pide hora, modo y destino.** El origen se encadena
>   solo: donde llegó el tramo anterior según la hora tecleada, o el origen del
>   viaje. Estación, referencia y nota esperan en el formulario de edición.
> - **Un tramo cae donde dice su hora**, como en la escaleta: el endpoint lo
>   coloca y llama a `reorder_travel_stages` solo si el orden cambia. Sin
>   hora, se queda donde está. No hay reordenar a mano.
> - **El estilo de la lista sale de `RunningOrder` a `styles/hours.css`** y lo
>   comparten los dos; el tramo solo añade su rejilla de ruta.
> **v2, tras la revisión de Marco (2026-10-10):**
> - **Zona por extremo del tramo**: migración aditiva
>   `20261010160000_travel_stage_zones` (`depart_tz`/`arrive_tz`, IANA,
>   nullable = la del espacio; las RPC create/update las aceptan y rechazan
>   una zona desconocida con 22023). Rollback en
>   `build/runbooks/rollback-20261010-travel-stage-zones.sql`, probado en la
>   Supabase local (ida, vuelta con funciones idénticas byte a byte, ida).
>   RLS: `tests/rls/travel-stage-zones.test.ts` (5 casos, en `playwright`).
>   **No aplicada en ninguna base hosted**: sigue el gate de § 34.
> - Cada hora se escribe y se lee en la zona de su extremo; la zona se dice
>   bajo la hora solo si no es la del espacio (`→ London`). El tramo nuevo
>   sale en la zona en que llegó el anterior y llega en la que nombra su
>   ciudad (tabla corta + nombres IANA, sin servicio externo); el formulario
>   muestra la sugerencia y acepta cualquier zona IANA.
> - La tira del día dibuja cada tramo como su propia barra, en el reloj del
>   lector. «TO»/«FROM» de la card van al pase de idioma; países, no por ahora.
>
> **v3 (2026-10-10): la zona se SABE, no se adivina.** Fuera la tabla corta
> de ciudades. Cada ciudad de un tramo ofrece candidatos con país y zona
> desde un índice offline que sirve el Worker (`/api/places`, sobre
> `static/data/places.json`, 6,2 MB / 2 MB gzip): GeoNames `cities5000`
> (CC BY 4.0, con su crédito en la lista y en `static/data/ATTRIBUTION.txt`)
> y los aeropuertos con IATA de `airportsdata` (MIT). Se regenera con
> `scripts/build-places.mjs`. Lo ambiguo se pregunta («Valencia»: España,
> Venezuela…); los que comparten país y zona se funden en uno. Sin elegir,
> el extremo va en la hora del espacio y se dice bajo el campo. El país
> elegido se guarda en `from_country`/`to_country`, que ya existían: sin
> schema nuevo. Un lugar fuera del índice puede llevar su zona a mano en el
> formulario de edición. Ninguna ciudad sale hacia un tercero.
>
> **v4 (2026-10-10): pueblos pequeños.** El índice es GeoNames `cities500`
> para el mundo más TODOS los lugares poblados (clase P, sin históricos ni
> barrios) de ES FR PT IT AD BE NL LU CH DE GB IE: 518.779 lugares. Partido
> por prefijo del nombre (2 letras, 3 o más si el trozo pasa de 200 KB) en
> `static/data/places/`: 2.856 ficheros, 37 MB crudo / 10,5 MB gzip, ningún
> fichero de más de 200 KB. Una búsqueda lee un trozo: en frío, mediana
> 0,3 ms (máx. 6,5 ms con los aeropuertos); en caliente, 0,06 ms. Medido en
> Node; en un Worker desplegado, no. Lo ambiguo deja sitio a cada zona antes
> de rellenar con más lugares de la misma.
>
> **v5 (2026-10-10): salas y hoteles.** Un extremo puede ser una sala del
> espacio (primera en la lista, por nombre; zona = `venue.timezone`, si no
> la de su ciudad si el índice da una sola, si no la del espacio, dicho), un
> lugar del índice, o un hotel (pueblo elegido para la zona + nombre en
> `*_place`). La sala de la función del día se ofrece como destino del tramo
> nuevo hasta que un tramo llega a ella. Schema: `from_venue_id`/`to_venue_id`
> en la MISMA migración, renombrada `20261010160000_travel_stage_ends`
> (rollback `rollback-20261010-travel-stage-ends.sql`, probado en local;
> RLS `tests/rls/travel-stage-ends.test.ts`, 8 casos).
>
> **v6 (2026-10-10): el índice va a R2, no al repo.** `scripts/build-places.mjs`
> lo genera en `.cache/places/` (ignorada) y `scripts/upload-places.sh` lo
> sube al bucket MEDIA (`hour-media`) bajo `places/v1/`, con la atribución;
> `/api/places` lee de ahí con caché en memoria del isolate, y en `vite dev`
> (R2 vacío del proxy) lee de disco, solo en dev. **Pendiente en la
> integración:** subir el índice a R2 con OK de Marco, y antes reconstruirlo
> (las fuentes de GeoNames y airportsdata, citadas en el script). Las salas
> de un pueblo salen justo debajo de él; las que coinciden por nombre, arriba.

> **Estado 2026-09-26.** Marco respondió las tres preguntas: aprueba el
> modelo, rama `feat/travel-stages`, ensayo en `hour-staging`. P1 (schema) está
> escrita en esa rama, que ya está en `origin`, y no aplicada en ninguna base
> hosted. Verificada solo en la base local. Sus decisiones de implementación
> son ADR-097, en la misma rama. **Ensayo en staging VERDE, 2026-09-27**
> (run 36297834709): base reconstruida desde cero con la migración, RLS
> **179/179** con los 10 casos de `travel-stage.test.ts`, build y smoke. El
> primer intento (run 36297342639) destapó § 39, ya cerrada. Lo que la separa
> de producción: el `inspect` que § 34 exige porque la migración hace DROP de
> `create_date` (y comparar con el rollback, que se capturó de la base local),
> y después backup, plan y apply.
>
> **Antes (2026-09-25):** parado desde el 2026-07-23, a la espera de las tres
> respuestas de Marco (abajo).
>
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
    - **P3:** editor de tramos en el diálogo/detalle de fecha. Se apoya en la
      tarea 15 (editar fecha desde la UI), que **ya existe**:
      `EditDateDialog.svelte`, desplegada con E2E verde el 2026-07-30 (§ 15).
      Esta línea decía «que NO EXISTE aún»; corregido el 2026-09-25.
    - **Diferido (P3+):** **documentos por tramo** → requieren el **primer
      pipeline de archivos R2** de Hour (`MEDIA` está declarado pero SIN uso;
      materials y `expense.receipt_url` solo guardan una URL ya formada). Es
      fundacional y reutilizable (riders, recibos). Tabla `travel_stage_document`.
      También diferidos: road sheet e ICS de los tramos.

    **Deuda anotada:** `travel_direction` (outbound/return/leg) **se queda** porque
    alimenta `awayBands()` (ADR-078 §6); reconciliar dirección↔extremos = después.

    **CONTESTADO por Marco el 2026-09-26: sí al modelo, rama, staging.** Las
    preguntas, tal como se hicieron:
    1. ¿Aprueba el modelo del ADR-089? (mantener `travel_direction`; gate
       `edit:performance`; extender `create_date`/`update_date`).
    2. ¿La migración va en una rama nueva `feat/travel-stages`, o solo se dejan
       los ficheros sin crear rama? (El motivo original de la pregunta, cambios
       sin commitear en `AgendaList`, `planner/+page` e i18n, ya no existe: el
       árbol está limpio.)
    3. ¿Aplicar a `hour-staging` tras escribirla, o solo dejar el fichero para
       revisarlo antes de tocar ninguna base? *Dato para contestar, no
       respuesta:* desde § 34, una migración con DROP cuenta como destructiva
       y pide staging e `inspect`, y P1 hace DROP+CREATE de `create_date`/
       `update_date`/`create_date_series` por firma. Y staging sigue pausado.

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

- [x] Marco: hecho (2026-10-11, tras arreglar «Illegal invocation» en `aec8da6`) — **Conectar tu Gmail en Ajustes → Buzones y comprobar que entran los correos con un contacto** (primer uso real; en producción desde el 2026-10-11, `6c4cd0a`, modo prueba de Google). **Comms, carril 1: difusión con el buzón sincronizado (ADR-099, 2026-10-11): construido y desplegado (`6c4cd0a`); falta el estreno con un buzón real.** Primero una maqueta para Marco
  (conversación con correos, llamadas y notas juntos; el registro de ADR-098 es provisional hasta que lo vea). Después,
  conversación con dos vistas conmutables (registro con el hilo del equipo al lado, o todo en un hilo; Marco, 2026-10-11),
  conexión de buzón personal y común (Google, Microsoft, IMAP/SMTP), solo correos con contactos de Hour, envío por el
  buzón conectado y conversaciones privadas.
  - [ ] **Comms: repaso a fondo del primer panel de la maqueta, «Conversación»** (drop 11-10). Está en `claude/comms-mock` (`/h/prototype/comms`), no en producción. Un agente audita qué datos debería mostrar (contrastado con ADR-098/099) y propone un diseño más cuidado con capturas antes de tocar código; Marco elige y después se construye. **Hecho (2026-10-11):** dirección A montada en `claude/comms-conversation-review` (`c1c347f`), informe en `research/product/2026-10-11-comms-conversacion-repaso.md` de esa rama.
    - [x] Decidido (Marco, 2026-10-11, ADR-102): dirección A, y la conversación es con la sala.
  - [x] **Comms: la conversación pasa a ser con la sala (ADR-102).** **Fase 4 (contract) en producción (2026-10-13): Worker `70660bb`, migración `20261013100000_conversation_with_organization_contract` (run 38354412402) tras staging reconstruido (run 38353192779), backup (run 38353302614) y plan; RLS 304/312 y E2E 64/66 contra producción; los dos rojos, specs que esperaban la persona en el primer enlace de la fila, corregidos y en verde.** Desviaciones en el plan, § Fase 4. **Fase 2 desplegada (2026-10-11, `be17af8`; migraciones 800000, 820000 y 810000): alta, lecturas, contactos en pantalla, correo con la regla del hilo. Arreglo del revive desplegado (`ed7d34d`, migración 900000; RLS 291/299). El historial que no mostraba lo recién apuntado, arreglado (`c5fdaac`); E2E 66/66.** **Fase 2b desplegada (2026-10-13, `816707f`; migración `20261012200000_invoice_payer_organization`, run 38345652787; RLS 303/311, E2E 66/66): el pagador es la organización, con sus datos fiscales.** **Fase 1 (expand) aplicada en producción (2026-10-11, run 38158709680; RLS 278/279 y E2E 65/65):** `20261011600000_conversation_organization_expand`, rollback en `build/runbooks/`. Puerta en local (RLS 275, check 0/0, unit 805) y revisión con ojos frescos con `inspect` del catálogo de producción: sin deriva, nada bloquea. Para la fase 2: cerrar la escritura directa de `conversation.organization_id` por PostgREST (grant por columnas), pasar siempre `p_since` a `set_conversation_contact`, y el `role` de más de 200 caracteres. **Adelantado de la 2b (Marco, 2026-10-11):** `list_money_payers` y `create_invoice_from_bolo` ya no enseñan ni copian el pagador de una conversación privada ajena (`20261011700000_money_payers_private`, run 38159654243, RLS 280/281). Para la fase 2: revisar `mail_contact_addresses` con conversaciones privadas. **Plan escrito (2026-10-11):** `build/plans/2026-10-11-conversation-with-venue.md` en `claude/conversation-venue-plan` (`82266d8`), cuatro fases (expand con relleno y trigger, lecturas y correo, contactos en pantalla, contract). En `muk-cia` las 154 tienen organización, una por persona: no hay fusiones.
    - [x] **Fusionados (Marco, 2026-10-13), en producción por SQL en una transacción con comprobaciones: Luisa Cuttini es contacto de Circuito Claps y Manuel J. González de la Feria de Ciudad Rodrigo; las dos conversaciones y organizaciones sobrantes, borradas en blando.** Antes: Marco: decidir — **Duplicados de organización en `muk-cia` antes del contract** (producción, SELECT del 2026-10-13). Fusionar dos parejas, ninguna con historial ni bolos: las dos «Feria de Teatro de Castilla y León (Ciudad Rodrigo)» (Manuel J. González pasa de contacto a la otra) y «Luisa Cuttini», que es una persona de Circuito Claps (pasa de contacto a «Circuito Claps»). Separadas, por ser programas distintos de la misma institución: `bcn.cat` (Centre Cívic Sant Andreu, Grec, ICUB, MAC Mercè), `diba.cat` (Anem al Teatre, Oficina de Difusió), `l-h.cat` (Arts Escèniques, Biblioteques), `viqual.cat` (Festival de Viladecans, Plataforma d'Arts de Carrer).
    - [x] Decidido (Marco, 2026-10-11, ADR-102 añadido): las recomendadas, salvo el pagador, que es la organización, y los correos de un contacto que se fue, que entran también si siguen un hilo de la conversación.
- [ ] **Rediseño de la lista de Conversations:** primero decidir qué información sirve para la difusión (estado real del trato, último contacto, próxima acción, contacto de verdad en vez del nombre de la sala repetido) y qué se hace desde ahí, con acciones en bloque (cambiar estado, escribir a varias, etiquetar, filtrar por tanda). Diseño antes que código. (drop 13-10, sin estimar)
- [ ] **Microsoft (Outlook) aparcado hasta que una compañía lo pida (Marco, 2026-10-11).** Una cuenta personal ya no puede registrar apps sin directorio: hará falta darse de alta en Azure (crea el directorio) y después registrar la app por Chrome. La capa de proveedor se construye para que sea solo otro adaptador.
- [ ] **Google: verificación de la app y auditoría CASA antes de pasar de 100 usuarios** (permisos restringidos de Gmail; coste de cientos a miles de dólares al año según las fuentes, por confirmar). Mientras, modo prueba (Marco, 2026-10-11).
- [ ] **Comms, carril 2: hilos con facetas (ADR-099).** Los permisos ya están en el modelo de facetas en producción (ADR-104/105, CHANGELOG 11-10 a 14-10); faltan los hilos: sin invitados, tablón del día colgado del bolo (la maqueta de `claude/comms-mock` enseña también la variante por faceta). **Primero un plan escrito en una rama, antes de tocar código (Marco, 2026-10-14, opción a):** esquema, permisos, pantalla y fases, partiendo de la maqueta y del material de `feat/comms-threads`; se le enseña a Marco antes de construir.
  - [ ] **Hilos: fases 3 y 4 (hilo del equipo en la conversación, «de qué se habla» en Conversations).** El tablón (fase 2) está en producción (`ef53fcc`); `ThreadBlock` admite `anchorKind="conversation"` para la fase 3. Esquema y RPC en producción (2026-10-14, migración `20261014100000_comms_threads`, ADR-106; plan en `build/plans/2026-10-14-comms-threads.md`). Para la fase 4: la política de `message` evalúa todos los hilos de la base (unos 0,3 ms por hilo, medido en local); leer los mensajes con una RPC por hilo o un prefiltro por espacio.
  - [ ] Facetas configurables por espacio (Marco, 2026-10-11): estándar sembradas (con Comidas) y traducidas por clave; renombrar, desactivar y crear propias, con nombre por idioma opcional. La tabla `workspace_facet_setting` existe desde la expand; sin comprobar si hay pantalla.
  - [ ] Deuda: un override de faceta no queda en `audit_log` (`membership_facet` no tiene `id`).
- [ ] **Correo con el dominio propio de cada compañía (Marco, 2026-10-11), en tres conectores:**
  1. Google Workspace / Microsoft 365 por OAuth (el carril 1; con dominio propio funciona igual).
  2. **IMAP/SMTP** para el resto (hosting propio, IONOS, cPanel…): lee por IMAP y envía por su SMTP, con contraseña
     de aplicación cifrada en Hour. Siguiente conector tras Google. Riesgo a probar: IMAP desde Cloudflare Workers.
  3. **Envío propio de Hour en bloque** (Postmark, SES o Resend) con el dominio de la compañía verificado por SPF/DKIM,
     para campañas. **Llega pronto, Marco lo quiere en breve.** Antes: entregabilidad, cómo vuelven las respuestas a
     Hour y al buzón de la compañía, bajas, y la LSSI (consentimiento previo también entre empresas; pregunta abierta al
     abogado).
     - [ ] **Editor de mailing visual para las campañas, del nivel de Brevo** (drop 11-10): bloques arrastrables (texto, imagen, botón, dossier o vídeo de la obra), plantillas por compañía con su marca, vista previa en móvil y escritorio, y personalización con los datos del contacto y de la sala. Espera al proveedor del envío en bloque.
  - Marco: decidir — **Proveedor y cuenta del envío en bloque** (informe `research/infra/2026-10-11-envio-en-bloque.md`).
    Proveedor: a) Amazon SES con un tenant por compañía (recomendada: UE, aislamiento y coste); b) Emailit (cuenta de
    Marco); c) Mailgun. Cuenta: a) las dos vías, por defecto la de Hour con cada compañía aislada y, si quiere, la suya
    propia con su clave (recomendada); b) solo la de Hour; c) solo la de cada compañía. Ante la LSSI responde la
    compañía, en cuyo nombre se envía (art. 20); ante el proveedor, el titular de la cuenta.
## Después de money v3 — contenedores (bloque 5)

12. [ ] **Revisión diseño+datos — contenedores.** Portada de workspace, project
    detail, line detail y siete módulos; cerrar identidad fiscal y qué datos son
    obligatorios antes de ampliar UI.

13. [ ] **Revisión diseño+datos — fichas y transversales.** Performance, road
    sheet, conversation, person, settings, diálogos; loading/error/empty/offline,
    mobile, light/dark y accesibilidad.

## Producto — después

- [ ] **Dar de alta a alguien del equipo sin conversación** (chat 14-10, al cargar la residencia de MaMeMi en el Espace des Arts). Hoy una persona solo nace de una conversación de difusión (`create_conversation`, `add_conversation_contact`) o al aceptar una invitación (`share_my_profile_with_workspace`); `person` no tiene grant de INSERT y el selector del reparto (`CastPanel`) solo ofrece dossiers que ya existen. Anouk, Anna, Manou, Adelie y Loïs se crearon por SQL con el patrón de `add_conversation_contact` (persona global anónima + dossier local) y no están en el reparto. 
  - [ ] **Decidido (Marco, 2026-10-14), las tres recomendadas; va a un ADR en el carril `claude/team-person`:** se crea desde cada selector de personas (reparto, equipo técnico, quién va a una fecha) con «Añadir "nombre"»; solo pide el nombre (email, teléfono y cargo opcionales, después en su ficha); y la invitación a Hour sale de su ficha y al aceptarse enlaza ese dossier con la cuenta. RPC `create_workspace_person` con el patrón de `add_conversation_contact` (deduplica por email en el espacio).

- [ ] **Directorio global de salas: lo que sigue a la fase 1** (la fase 1 está en producción desde el 2026-10-10, ver CHANGELOG; aquí quedan las decisiones para las fases siguientes). **Directorio global de salas desde bases públicas (Marco, 10-10).** Que una
  compañía no tenga que crear cada sala a mano: un directorio global de solo
  lectura del que «adopta» una sala a su `venue`. Investigación y recomendación en
  `research/product/21-venue-directory-sources.md` (fase 1: Basilic + Equipaments
  de Catalunya + Wikidata; OSM fuera salvo capa ODbL publicable).
  (espera: seis decisiones de Marco del informe, tareas)
  **Decidido por Marco (10-10):** (1) entran las salas polivalentes, casas de
  cultura y ateneos, no solo teatros; (2) se puede publicar una capa ODbL de OSM
  si no cuesta dinero; (4) la ficha global lleva los contactos de la sala:
  email, teléfono y nombres de contacto, siempre dentro de la ley; (5) ahora
  toda España y Francia, y Europa entera en cuanto se abra la app.
  **Lo mismo quiere Marco para programadores:** una base común global de
  programadores, dentro de la ley.
  **Corregir la ficha global, DECIDIDO por Marco (10-10):** una corrección entra
  como propuesta con su fuente y se aplica cuando la validan al menos otras dos
  compañías. Para que pase de verdad, Hour pregunta a quien va a actuar en esa
  sala (una función suya enlazada a la sala) si los datos de la corrección son
  ciertos. Todo con historial y vuelta atrás; el dato oficial nunca se pisa en
  silencio.
  **Salas nuevas desde las compañías (chat 10-10):** una compañía puede proponer una sala que no está en el
  directorio (la que crea en su espacio) y entra en el directorio común cuando la validan 3 compañías, con el mismo
  mecanismo de propuesta, fuente e historial que las correcciones.
- [ ] Marco: decidir — **Datos personales en el directorio: investigación hecha (2026-10-10, `research/product/22-venue-directory-personal-data-legal.md`, no es asesoramiento jurídico).** Recomienda: contactos genéricos para todas las salas y una persona solo si ella misma se da de alta o reclama su ficha aceptando propuestas (la LSSI pide consentimiento previo también entre empresas). Falta decidir el diseño y si se lleva a un abogado con las 9 preguntas del informe. Antes: **Consulta legal sobre datos personales en el directorio global (salas y
  programadores)** (Marco, 10-10: de acuerdo, antes de construir esa parte). Nombres, emails y teléfonos de personas de otras entidades
  en una base compartida necesitan base jurídica (interés legítimo para contacto
  profesional, art. 19 LOPDGDD), informar a esas personas (art. 14 RGPD) y
  atender su oposición. Antes de construir esa parte, una consulta legal.
  Desbloquea: «Directorio global de salas».
- [ ] Marco: hacer — **Revisar y enviar los dos borradores de Mail (cuenta Google)** a la Red Española de Teatros (`redteatros@redescena.net`) y a DGArtes (`geral@dgartes.pt`, en portugués, pidiendo la Rede de Teatros e Cineteatros Portugueses). Creados el 2026-10-10. Antes: escribir a la Red Española de Teatros y a DGArtes
  para pedir sus listados como dato (Marco, 10-10: lo quiere pensar).

- [ ] **Marketing: que la gente se dé de alta en Hour (Marco, 2026-10-11, ADR-101).** Cómo se consiguen las altas
  está por pensar (Marco, 2026-10-11: pedir a las instituciones que inviten a sus programadores no es el momento ni la
  manera; los borradores a la Red y a DGArtes piden solo los listados de salas).
- [ ] **Suites inestables (2026-10-11; causa probable vista el 2026-10-13: `hookTimeout` de 10 s en la RLS, que corta hooks lentos y deja estado; a 60 s en `f5900a9`, se cierra al integrar el contract):** `permissions-facets.test.ts` («el admin configura las facetas…») falla a
  veces en la RLS completa y pasa solo. La hipótesis de ficheros en paralelo no vale: la suite RLS ya corre con
  `fileParallelism: false`. Suelto pasa 3/3 (2026-10-13) y no quedó el mensaje del fallo: si vuelve, guardar la salida; y 4 leyes de
  `planner-laws.spec.ts` fallaron en una pasada E2E de 6,8 min con la red a tirones y pasaron 23/23 solas.
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

- [ ] **Los datos fiscales de una organización no se pueden retirar (visto el 2026-10-13, tests de la fase 4 de ADR-102).** Un borrado blando por PostgREST da 42501 (la fila borrada ya no pasa la policy de SELECT), `service_role` no tiene grant sobre `fiscal_identity` y no hay RPC para retirarla. La limpieza de `money-v3.test.ts` y de `money-payer-organization.test.ts` no borraba nada sin decirlo. Cuando haga falta: una RPC `retire_fiscal_identity` con `can_edit_workspace_money`. (chat 13-10, sin estimar)
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
