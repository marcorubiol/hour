# Hour — tareas cerradas (archivo de la cola)

> Sacado de `_tasks.md` el 2026-10-14: lo cerrado, con su número de §, para que la cola sea solo lo abierto. No es
> una cola: aquí no se añade nada nuevo. Lo entregado, contado para quien usa Hour, está en `CHANGELOG.md`; el
> porqué, en `_decisions.md`. Recortado el mismo día: aquí solo queda el contexto que no está en ninguno de los dos
> (diagnósticos, causas, medidas, lo que ya se probó), y las § que cita un documento vivo. El texto completo de cada
> tarea está en git (`58c1755`).

## PRIMERO (lo cerrado)

34. [x] **El gate de schema** (Marco, 2026-08-29: «lo que tú recomiendes»). La recomendación salió de leer el
    workflow: `staging.yml` hace `supabase db reset --no-seed` contra staging y carga fixtures sintéticos, así que
    **staging se reconstruye desde las mismas migraciones que la base local**, no es una copia de producción. El ensayo
    en staging no protege contra la deriva que solo tiene producción, que es lo que tumbó los dos applies del
    2026-08-10 (una sobrecarga de función que solo prod tenía; el esquema `hour_backup_20260720`).
    **La regla que queda:**
    - **Migración aditiva / no destructiva** → reconstrucción local desde cero con la migración dentro, tipos
      regenerados, RLS después. Staging es opcional.
    - **Migración destructiva** (DROP, cambio de tipo, reescritura de datos) → **staging obligatorio**, y hay que
      despertarlo: corre las suites completas contra un Postgres hosted y da un ensayo que se puede tirar.
    - **El modo `inspect` es obligatorio antes de cualquier migración destructiva.** Es lo único del gate que mira el
      catálogo de producción (se añadió el 2026-08-11, justo después de los dos applies). Si la migración toca un
      tipo, una función o algo que otro objeto pueda sujetar, se pregunta al catálogo antes.

35. [x] **Los advisors, dentro del gate** (2026-08-29, run 33236614106). Los cinco chequeos de nivel ERROR (tabla sin
    RLS, vista sin `security_invoker`, `auth.users` al alcance de anon/authenticated, policy sobre `user_metadata`,
    `SECURITY DEFINER` sin `search_path`) viven en el modo `inspect` (§ 34). No sustituyen al advisor hospedado: son
    el subconjunto preguntable por SQL. Se verificaron creando cada condición a propósito en la base local, porque
    cinco consultas que devuelven vacío no prueban nada (una errata también devuelve vacío).
    *Probado y no funciona:* el OAuth del MCP de Supabase muere en `api.supabase.com` con
    `{"message":"Unrecognized client_id"}`: es el `client_id` del plugin, no la cuenta. Reintentar da lo mismo.

37. [x] `create_performance` y `create_performance_series` aceptan `p_bolo_id` (migración `20261010100000`, `d835b86`,
    2026-10-10), para que no exista la ventana en la que la función ya está y el dinero todavía no. De paso, EXECUTE
    retirado a anon/authenticated en las 8 funciones de trigger expuestas.

39. [x] **El baseline de staging, roto del 2026-07-30 al 2026-09-27 sin que nadie lo viera** (cerrado en `355f63d`).
    Causa: `staging.sql` construye su mundo (cuatro workspaces con ids fijos) dando por hecho que un alta no crea
    nada; `20260730164435_bind_auth_user_trigger` metió el trigger que da a cada login su cuenta y su workspace
    personal, y staging salía con 7 workspaces, no 4 (`cross-tenant.test.ts` exige la lista exacta). Arreglo: el
    fixture retira lo que el trigger crea para sus tres usuarios antes de montar su mundo, y la comprobación imprime
    la forma que encuentra (antes solo decía «exit 1»). Run 36297834709, forma 3/4/154.

22. [x] **`build/schema.sql` borrado el 2026-10-09** (Marco: «sí»). Llevaba una versión vieja y falsa de
    `handle_new_user` (sin la capa de cuenta); su último motivo para existir, ser el único sitio con el
    `CREATE TRIGGER`, se cerró con `20260730164435`. Su historia está en git.

31. [x] **Juego de prueba mudado a `playwright` (2026-10-09).** Proyecto `zzz-difusion`, 24 contactos
    `@example.test`; el usuario del E2E ya solo pertenece a `playwright`. En `muk-cia` las 154 conversaciones son la
    lista REAL de difusión; lo de muestra se borró (soft-delete). Antes era admin de `muk-cia` y el `audit_log` probó
    que no hubo daño: las 200 entradas de la fila tocada las escribió ese mismo usuario.
    *Ojo para quien toque estados a mano:* el trigger `conversation_contact_timestamps` pone
    `last_contacted_at = now()` en cada cambio de estado y no deja vaciar `first_contacted_at`.

40. [x] **`conversation_event`** (ADR-098; migración `20261009100000`, `3f6eb44`, 2026-10-09). Schema aditivo: gate de
    § 34 sin staging obligatorio. Iba detrás de § 31.

## Cerrado — el pulse del rail (2026-08-10, ADR-096)

30. [x] *Medido:* el E2E del pulse (`tests/pulse.spec.ts`) cazó un salto real de 4,64px que solo aparecía a 1280 de
    ancho; la altura se mide abortando los dos feeds a propósito. El setup de auth del E2E sube a 120s: falló dos
    veces seguidas segundos después de un `wrangler deploy` (Worker frío). Lo de `workers: 1` está explicado en
    `playwright.config.ts`; el guardián `i18n/keys.test.ts`, en ADR-096 §9.

## AHORA — preparar el Planner v3 (lo cerrado)

23. [x] **`note`, el post-it privado, absorbe `person_note`** (ADR-093; migración `20260731120000`, en prod desde el
    2026-08-11). La regla del ancla, que el código cita: cero padres es válido y significa «de la compañía» (el día
    vacío con el scope en «Everything»); en un día con una sola entrada de calendario el ancla viene rellena, con
    varias se elige, en un día vacío cae al scope pineado y si no hay, a la compañía. Lo que quedó fuera a propósito
    está en la cabecera de la migración. Al absorber `person_note` murió un bug latente: `person_note_select` exigía
    `read:person_note_private` sobre algún proyecto para leer tu propia nota privada.

25. [x] **Fontanería del Planner v3** (2026-07-31; la casilla estuvo stale hasta el 2026-08-10). Los cinco hitos del
    run sheet en `month-events.ts` con el adaptador `runSheetSteps()`; `PlannerView` con `'day'`; el modo de holds por
    espacio en `settings->>booking_mode`. El adaptador devuelve `{key, at}` y no `{label, at}`: la clave es
    vocabulario, la etiqueta la pone quien dibuja.

26. [x] **Vocabulario del diseño vs el enum: gana lo implementado** (Marco, 2026-07-30). `budget` no existe en
    `line_kind` → `misc`. `estudi` y `reunió` no existen en `date_kind` → `other`. `residence` del prototipo es
    `residency`. Cero migraciones de enum; el diseño se ajusta al vocabulario que ya corre.

## Cerrado — bloque 8: el eje de persona (2026-07-30, ADR-092)

Defectos que salieron construyéndolo, arreglados con test:
- `awayBands()` emparejaba la ida más antigua: un viaje sin vuelta se apropiaba de la vuelta del siguiente y pintaba
  17 días de gira (había un test fijando el comportamiento equivocado).
- El Loom atribuía ensayos a personas sin mirar si estaban fuera («fuera todo el día» y «quizá ensayando» el mismo día).
- **Habría destruido datos:** el filtro de tokens de la URL era `/^[spl]:.+/` (una clase de caracteres), así que `pe:`
  no pasaba, y como el efecto de entrada reescribe los pins con lo que sobrevive, pinar una persona la borraba en la
  siguiente navegación.
- `share_my_profile_with_workspace` estaba viva en prod y tipada sin un solo llamador de aplicación.

## Cerrado — pase de endurecimiento (auditoría 2026-07-24), DESPLEGADO 2026-07-25

Auditoría de 5 frentes (API/auth, SQL/RLS/RPC, XSS/frontend, rendimiento, estabilidad): sin agujeros críticos ni
cross-tenant. La equivalencia de autorización de las 3 RPC reescritas se comprobó en vivo suplantando a un usuario real
(27 = 27 bolos, 157 = 157 pagadores) y queda como test permanente en `tests/rls/hardening.test.ts`.

Escribir los tests destapó dos regresiones que el deploy no había visto:
1. `payment.test.ts` y el `afterAll` de `money-v3.test.ts` emitían facturas con un PATCH directo; tras el revoke eso da
   403 **sin romper el test** (no había aserción) y dejaba facturas emitidas imposibles de limpiar.
2. `POST /api/invoices` aceptaba un `number` del cliente; con el PATCH cerrado ese borrador quedaba imposible de
   emitir (el trigger de inmutabilidad rechaza el correlativo). El campo salió del schema.

Y en `money.spec.ts` **la equivocada era la aserción, no la app**: esperaba la tarifa de un trato `proposed` en
«contracted». Nunca había pasado; su fallo se atribuyó a la race de carga de `/h/money`. Ahora pinza la regla: el
pipeline no puede contarse como vendido.

## Cero diferidos (2026-07-25)

1. **`project_id_of_*` al esquema `private`** (`20260725100000`). El GRANT a `authenticated` se mantiene a propósito:
   las policies se evalúan como el invocador y sin él falla la consulta entera; lo que se quita es la exposición como
   endpoint. `hardening.test.ts` lo fija por las dos mitades.
   > **Trampa:** el primer apply salió **success** con «Remote database is up to date»: el workflow hace checkout de
   > `main` desde GitHub y la migración estaba solo en local. Un apply verde no prueba nada: **leer el log y ver el
   > nombre del fichero**.
2. `sharp`/`cookie`: CVE transitivos de `wrangler>miniflare` y de `kit`. Dependencias de build, no entran al bundle del
   Worker, y no hay versión que los resuelva sin que sus padres actualicen (2026-07-25).

## Decisiones con coste o autoridad externa (lo cerrado)

33. [x] **La pausa del plan Free: keepalive diario desde el 2026-10-10** (`.github/workflows/keepalive.yml`, 06:37 UTC;
    un run rojo avisa). Se borra al pasar a Pro. Decisión de Marco (2026-08-29): «mientras la app no esté activa al
    público, acepto la pausa»; deja de valer el día que haya un usuario que no sea Marco (Phase 0.9), y entonces vuelve
    la elección entre Pro (que arrastra la § 9) y un latido que falle ruidosamente.
    *Causa:* Hour se usa a ráfagas y el backup semanal a R2 era el único tráfico automático; una semana entre
    ejecuciones es justo el ancho de la ventana de pausa, así que no servía de latido. Pasó entre el 16 y el 23 de
    agosto de 2026 y costó al menos cuatro días: el Worker sigue verde, la pantalla carga y solo falla el login.

## Cerrado — bloque 7: money v3 (ADR-086/087/088)

Abierto al cerrar el bloque (2026-07-24), sin verificar si sigue igual: el ciclo profundo de money v3 (crear
factura/proforma con tax lines, numeración, pagos desacoplados, aging/paid derivado) no tenía E2E; `money.spec.ts`
quedó en el roundtrip del caché.

## Después de money v3 — planner (lo cerrado)

15. [x] **Editar una fecha desde la UI** (`EditDateDialog.svelte`, validado en prod el 2026-07-30). El primer rojo del
    E2E fue del spec: elegía el 15 del mes, que el mes dibuja y la agenda no; la agenda es un diario y **abre en hoy**
    (`agendaFromIso = todayIso`). Hoy es el único día que las dos proyecciones enseñan sin navegar.

16. [x] **Multi-día para funciones** (2026-08-29). Costó una rotura en producción: el GRANT de SELECT sobre
    `performance` es por columnas, `series_id` no entró sola, y meterla en el `select` del feed tumbó
    `/api/performances` con 403 (mes, agenda y tablero). Arreglado por `20260829120000`; de ahí la regla 8 de
    `_context.md`.

17. [x] **Escaleta (ADR-090).** P1 en producción el 2026-10-10 (`20261009200000` expand con espejo,
    `20261009210000` contract), P2 el 2026-10-11 (`20261010220000_schedule_slot_live`, `fffa2cd`). Decidido por Marco
    el 2026-10-10: P2 va con P3, y sobre la escaleta **manda siempre el doc en directo**, como las notas; el PATCH
    rechaza franjas (`schedule_is_live`). P2 pedía schema porque el DO entra como `service_role` sin el JWT del usuario.
    Riesgo que había que cerrar: un doc con snapshot pero sin `schedule` cargaría el array vacío y borraría las franjas.
    **Queda abierto:** las reglas de orden de las franjas solo se validan en el cliente.

## Producto — después (lo cerrado)

- **Directorio de salas, fase 2** (2026-10-11, run 38113880531). Quedan ~130 posibles duplicados Wikidata FR/Basilic
  y ~35 EIEL/Wikidata **sin fundir a propósito**. Criterios: centros cívicos solo con aforo declarado, ningún contacto
  de ayuntamiento, y al adoptar se copia el contacto genérico con el nombre de la sala.
- **Conversación borrada que vuelve con su privacidad vieja** (`762192f`). Causa: `create_conversation` la recuperaba
  con UPDATE y el ajuste «nacen privadas» solo se aplicaba al INSERT. Lo destapó `mail-google.test.ts`.
- **El 404 de `sw.js`** (`071208a`). Causa: SvelteKit construye con base relativa (`./`) y `virtual:pwa-register`
  registraba `./sw.js` con scope `./`; `base: '/'` en `VitePWA` lo deja en `/sw.js` con scope `/`.

## Deuda aceptada / observar en uso (lo cerrado)

- **El rojo suelto de `planner-laws`** (2026-10-10). Causa del diario: una espera fija más corta que la red y un tirón
  tragado por el cerrojo `probing`, que `loadAllEarlier` y `probePlanAhead` compartían (la primera hacía `return` sin
  avisar; `2f48370`). El spec espera a sus respuestas (`8e464b4`) y la config guarda traza si falla. El del choque
  (ley 421) no se reprodujo en 4 suites: si vuelve, habrá traza.

## Cerrado antes de julio

- **Bloque 1, gate operativo:** restore drill desde R2 en 203 s, con login, conteos, RLS y ruta crítica verificados
  ([run 29761775037](https://github.com/marcorubiol/hour/actions/runs/29761775037)).

## Cerrado el 2026-10-23 (limpieza de la cola)

- **Rediseño de la lista de Conversations** (ADR-141): las tres fases en producción el 22-10. «Quién la lleva» quedó fuera
  por recomendación: no hay dato en `conversation`; si se quiere, el plan (`build/plans/2026-10-22-conversations-list.md`,
  pregunta 5) propone `conversation.lead_user_id`, aditiva.
- **Fusión de persona** (ADR-143): RPC, pantalla y aviso al aceptar una invitación en producción el 22-10.
- **Etiquetas 1 a 4** y **facetas configurables en Ajustes**: en producción del 19 al 22-10.
- **Borrado lógico de organización y persona por API** para los specs: migración `20261021200000` aplicada el 22-10.
- **«Subir imagen» en Ajustes**: quitado (`def880c6`), no hay dónde guardar un avatar.
