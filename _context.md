# Hour — estado canónico del proyecto

> **Reconciliación 2026-08-27 — SUPABASE SE PAUSÓ SOLA, Y AL VOLVER EL E2E
> ENCONTRÓ TRES ROJOS QUE NADIE HABÍA ESCRITO.** Runtime **`ad3cf67`**
> (builtAt 2026-08-27T07:21Z), `main` == `origin/main` == `bd333f0`. Suites
> contra ese runtime: **RLS 150/150 · E2E 56/56 · unit 555/555 ·
> svelte-check 0/0**. Cero cambios de schema.
>
> **EL PLAN FREE PAUSA EL PROYECTO A LOS ~7 DÍAS SIN ACTIVIDAD**, y pasó entre
> el 16 y el 23 de agosto. El Worker siguió sano todo el tiempo, así que la
> app cargaba y el login no podía completarse. La firma son tres cosas a la
> vez: `dig lqlyorlccnniybezugme.supabase.co` **vacío** —se retira el registro
> DNS—, `/health/ready` con `{"supabase":"status_530"}`, y el backup semanal a
> R2 muriendo en 28 s con `FATAL: (ENOTFOUND) tenant/user postgres.<ref> not
> found`. **Cuando algo de Supabase falle tras días sin tocar el proyecto, lo
> primero es `dig`** — no las credenciales, no `.env`, no RLS.
>
> **No se perdió nada:** un proyecto pausado conserva los datos, y el dump del
> 16 de agosto está en R2 (run 31925297252). Se despierta con un botón del
> dashboard; no hay comando de CLI. **`hour-staging` sigue pausado**, y solo
> hace falta el día que se toque schema. Y el detalle que importa para que no
> se repita: **el backup semanal era el único latido automático**, y una
> semana entre ejecuciones es exactamente el ancho de la ventana de pausa.
>
> **LOS TRES ROJOS DEL E2E, CON EL CÓDIGO SIN TOCAR DESDE EL 11.** Lo que
> cambió no fue la app: fue lo que había en la agenda. Los tres eran **una
> medida de un día concreto escrita como si fuera norma**.
>
> 1. **El pulse del rail era un fallo real** y su spec lo cazó. La reserva
>    (`min-block-size`) se dimensionó contra un slip cuyo nombre va a 11px,
>    pero un `show` lo dibuja a 13px (`Slip § the gig keeps its step`), así que
>    su línea son 15,86 y no 13,41: **la reserva cubría un show de una línea
>    por 0,01px**, por suerte, porque el rail solo dibuja el tipo que toca
>    estar próximo. El 27 tocaba un show —FiraTàrrega— y el nombre **envolvió**
>    (`.slip__n` clampa a tres líneas y 13,25rem no sostienen el nombre de una
>    feria): el rail saltó 72,19 → 88,03. Arreglado abriendo el número, no
>    copiando el tratamiento: el clamp se queda en el `Slip`, que es su casa, y
>    el rail estrecha `--slip-name-lines`/`--slip-city-lines` a 1. Reserva
>    2,95rem → **3rem**, porque con el clamp la respuesta más alta mide
>    47,03 / 47,17 / **47,23** a 1024 / 1280 / 1600 y 2,95rem son 47,2 —
>    seguía corta a 1600, por el mismo pelo de siempre.
> 2. **`planner-laws` pedía `< fold/2`**, que no era la ley sino el 277 que se
>    midió el día que ese spec corrió verde por primera vez. Lo lejos que cae
>    hoy depende del cromo que tenga encima, y ser el primer día de su banda
>    semanal lo puso en 413. Ahora afirma lo que su propio comentario ya decía
>    —en pantalla y libre del cromo pegado— con el cromo por **hit-test**. El
>    primer intento de arreglarlo volvió a poner un número: midió todas las
>    cajas sticky, se comió el rail (720 de alto) y exigía que hoy cayera
>    *bajo* el fold que debía mantenerlo *sobre*.
> 3. **`date-edit` murió de strict mode, y solo después del deploy.** Desde
>    ADR-096 **el pulse del rail dibuja un `Slip`**, y la fecha del fixture ES
>    lo próximo mientras exista, así que un `.slip` sin ámbito resuelve a dos.
>    El locator hermano del mes se libraba por accidente —busca `button.slip` y
>    el del rail es un `<a>`—, y había un tercero con `.first()` que **no
>    habría fallado: habría clicado el del rail**, que navega al día en vez de
>    abrir el diálogo. Los dos van ahora contra `main`; la furniture vive en el
>    `complementary` y el diario en `main`.
>
> **Y UNA TAREA LLEVABA DIECISÉIS DÍAS DADA POR PENDIENTE ESTANDO HECHA.**
> `_tasks.md § 23` (`note`, el post-it privado de ADR-093) seguía en `[ ]`, y
> «Siguiente paso» aquí arriba lo llamaba «la única maquinaria que el Planner v3
> necesita y no existe». La migración entró el 2026-08-11 **en este mismo
> documento, dos párrafos más abajo**: tabla, RLS (13 casos dentro del 150/150),
> `/api/notes`, el margen del Planner que lo escribe, y `person_note` muerta
> dentro. Nadie mintió — se desplegó y no se volvió a la cola a tacharlo. De ahí
> salen los dos restos reales, ahora en `§ 32`: `read:person_note_private` es un
> permiso muerto todavía sembrado en seis roles, y **el margen del Planner no
> tiene E2E** (la RLS cubre la base y `person.spec.ts` cubre el dossier; la pieza
> titular de ADR-093 solo la prueba el navegador de Marco).
>
> **Y ESE MISMO DÍA ENTRÓ UNA MIGRACIÓN A PRODUCCIÓN**, la única desde el 11 de
> agosto: **`20260827100000_retire_person_note_private_permission`** retira el
> permiso que ADR-093 §5 dejó muerto pero sembrado en seis roles. La función de
> seed deja de darlo, `array_remove` lo saca de las filas que ya lo llevaban y
> el COMMENT de vocabulario cerrado vuelve a decir la verdad. No toca tipos
> (regenerados byte a byte idénticos) ni código de aplicación, así que **la base
> va por delante del Worker a propósito y no hay nada que desplegar**. Después:
> **RLS 151/151 · E2E 60/60 · unit 555/555**.
>
> **El gate se corrió SIN staging, y eso queda dicho porque es una desviación.**
> El gate documentado es *backup → staging → prod plan+apply*; se hizo *backup
> (run 33058807600, el primero desde el 16 de agosto) → CI → plan → apply (run
> 33059043384)*, sin el ensayo en staging, **porque `hour-staging` también está
> pausado**. Se sustituyó por una reconstrucción local desde cero con la
> migración dentro y una comprobación del catálogo antes de escribirla, y salió
> bien; pero staging es una copia hosted con datos, que es donde aparece lo que
> solo dice el catálogo — lo que tumbó dos applies el 2026-08-10. Ver
> `_tasks.md § 34`. **Y los advisors no se corrieron** (§ 35).
>
> **Regla que sale de aquí, y es la de siempre con una vuelta más:** un spec
> que no ha corrido es una hipótesis, **y uno que corrió verde es una hipótesis
> sobre los datos de aquel día**. Nunca escribir un píxel medido como umbral:
> enunciar la ley y medir sus términos en tiempo de ejecución.

> **Reconciliación 2026-08-11 — EL PLANNER V3 ESTÁ EN PRODUCCIÓN.** Runtime
> **`ea2db77`** (builtAt 2026-08-11T14:01Z), `main` == prod. Suites contra ese
> runtime: **RLS 150/150 · E2E 56/56 · unit 555/555**. Se desplegaron **93 commits** (`feat/planner-v3` mergeada por
> fast-forward y borrada) **con una migración destructiva**: `note` nace y
> `person_note` muere dentro (ADR-093), más `cast_member_writers`. Gate
> completo: backup a R2 (run 31367463611) → CI verde → plan → apply →
> deploy → verificación contra el runtime. Encima va el pulse del rail
> (ADR-096), con tres correcciones posteriores que solo se vieron con datos
> reales delante: la card del mes entera en vez de un nombre inventado, y dos
> pasadas sobre la altura —la reserva estaba en `lh`, que sigue a la
> tipografía del hueco y no a la de lo que sostiene—.
>
> **El E2E pasa a `workers: 1`** (2026-08-11): la suite firma contra el
> workspace VIVO y un solo Durable Object, así que `fullyParallel` prometía un
> aislamiento que no existe — en paralelo caía **un test distinto cada vez**,
> en serie da 55/55. Y dos rojos más que no eran de la app: un Worker recién
> desplegado tarda más que los 30s del setup de auth, y un test comparaba el
> reloj del servidor con el de esta máquina a tolerancia cero (11ms de deriva
> lo mataba).
>
> **El apply falló dos veces antes de entrar, y las dos veces revirtió limpio**
> (verificado en caliente: `note` ausente, `person_note` intacta, el plan
> seguía dándola pendiente). Causa 1: `DROP FUNCTION IF EXISTS f(firma)` borra
> UNA sobrecarga y calla si no encuentra nada — producción llevaba otra que la
> base local no, así que el tipo se quedó sujeto por una función invisible.
> Causa 2, la que solo dijo el catálogo: **existe un esquema `hour_backup_20260720`
> en producción** con una copia de `person_note` que aún usa el enum. Es un
> archivo del squash de julio y **sigue ahí a propósito**: una migración que
> retira una función no entra en un archivo a borrarlo. `person_note_visibility`
> se queda vivo por eso, y está escrito en la migración.
>
> **Y cuatro specs del Planner v3 se corrieron por primera vez** — el E2E exige
> origen desplegado y el setup de auth llevaba roto desde el 31 de julio, así
> que **ninguna de las leyes de ADR-095 había corrido nunca**. Salió **un fallo
> real** (un tablero sin `lanes` en la barra reparte los carriles del lector,
> contra ADR-094) y tres locators caducados (`Hour — home` → el reloj del rail;
> `Add to planner` → `＋ date`; `ag__row--date` → el Slip). Regla que se repite:
> un spec que no ha corrido es una hipótesis.

> **AVISO 2026-08-11 — EL USUARIO DEL E2E ES ADMIN DE `muk-cia` Y `marco-rubiol`.**
> No es un miembro: es **admin** de los dos espacios reales
> (`build/runbooks/test-user-setup.md:11-13`, y la suite RLS lo da por hecho).
> `conversation-write.spec.ts` pedía `project_slug=mamemi&season=2026-27` sin
> filtro de espacio y mutaba `[0]`, así que escribía en filas de `muk-cia`.
> **Ya no**: crea su propia fila en el espacio de fixtures y la borra.
>
> **Y la alarma que dio esta sesión estaba sobredimensionada, dicho aquí para
> que nadie la repita.** El `audit_log` (trigger `conversation_audit` sobre
> `conversation`) guarda before/after: las 200 entradas de esa fila —desde el
> primer `null →` del 2026-07-20 hasta hoy— **las escribió el mismo actor**,
> `65419d0a…`, que es el propio usuario del E2E. Esa fila **nunca tuvo un valor
> puesto por una persona**. No había nada que restaurar, y no se restauró nada.
> `muk-cia` tiene 1 proyecto (`mamemi`) y las **154 conversaciones sintéticas**
> que este documento ya describía; `marco-rubiol` tiene 5 proyectos y **0**
> conversaciones. Ningún proyecto tiene `owner_id`, así que la FK
> `project_owner_id_fkey ON DELETE SET NULL` no es un riesgo hoy.
>
> **Por eso NO se han quitado las membresías.** Quitarlas rompe 2 tests E2E y 4
> ficheros RLS que están construidos sobre ese acceso (`cross-tenant.test.ts:48`
> afirma la lista exacta de tres espacios; las pruebas de conversación necesitan
> las 154 filas, que solo existen en `muk-cia`). El trabajo real es **mudar el
> juego sintético de difusión al espacio `playwright`** y después quitar el
> acceso — ver `_tasks.md § 31`. La urgencia aparece el día que MüK Cia empiece
> a usarse para difusión de verdad en ese mismo espacio.

> **FUENTE DE VERDAD ACTUAL.** Cualquier agente o persona debe empezar aquí.
> Última verificación: **2026-08-27**, contrastada con Git, el código, producción,
> Supabase y las cuatro suites; no reconstruida desde documentos antiguos. Las
> reconciliaciones anteriores se conservan abajo, en orden inverso.
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
- `/health/live`: sano, `dirty:false`, SHA **`ad3cf67`** (builtAt 2026-08-27T07:21Z).
- `/health/ready`: sano, Supabase `ok`. **Estuvo en rojo del ~23 al 27 de agosto**
  con `status_530`, y no era la app: Supabase se pausó sola. Ver la cabecera.
- **`main` == `origin/main` == `bd333f0`.** No hay código de aplicación sin
  desplegar: encima del runtime solo va `bd333f0`, que toca un único spec y no
  entra en el bundle. El deploy del 2026-08-27 sube **el arreglo del pulse**
  (el `Slip` abre su presupuesto de líneas, el rail lo estrecha a 1, reserva
  2,95rem → 3rem), sin schema. Verificado contra el runtime desplegado:
  **RLS 150/150 · E2E 56/56 · unit 555/555 · svelte-check 0/0**.
- Debajo va **`ea2db77`** (2026-08-11), que fue el runtime hasta el 2026-08-27:
  el **Planner v3 entero y el pulse del rail**, con la migración de `note`.
  Verificado entonces: RLS 150/150 · E2E 56/56 · unit 555/555 · collab 11/11.
  Detalle del gate y de los dos applies que revirtieron: cabecera de este
  documento.
- Debajo va **`0f8e12f`** (2026-07-30), que fue el runtime hasta el 2026-08-10:
  el eje de persona, el enlace login↔persona y la tarea 15. Verificado entonces:
  RLS 137/137 · E2E 30/30.
- *Cómo se despliega, porque el comando documentado no funciona:* es
  **`pnpm --filter web run deploy`**. `pnpm deploy` desde la raíz choca con el
  subcomando propio de pnpm y muere con `ERR_PNPM_NOTHING_TO_DEPLOY` sin tocar
  nada.
- **DB por delante del Worker, a propósito (julio 2026, ya historia):** el
  runtime de entonces era `09f512a` pero la
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
- **2026-08-27: `main` == `origin/main` == `bd333f0`; prod == `ad3cf67`.**
  Los tres commits del día: `fix(pulse)` —el presupuesto de líneas del rail,
  que es el único que entra en el bundle—, `test(planner)` y
  `test(date-edit)`. Que `main` vaya un commit por delante de `/health/live`
  es estado limpio aquí: ese commit es solo un spec.
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
  `feat/money-v3-design` se borró contenida. **2026-08-10:** `feat/planner-v3`
  se mergeó a `main` por fast-forward y se borró (local y origin) — el Planner
  v3 y el pulse ya están desplegados. Quedan dos ramas, y una es basura:
  `hardening/audit-fixes` está **contenida en `main` con cero commits propios**
  (verificado 2026-08-11), o sea borrable sin pérdida; y `feat/comms-threads`:
  - `feat/comms-threads` — comms + acceso. **Su canon ya está en `main`**
    (ADR-082/083/085, las dos escaleras y la faceta en `structure-model.md`, el
    digest del grill y el review de 32 hallazgos). Lo que queda en la rama es
    solo material de construcción: 604 líneas de SQL **sin aplicar** y los 7
    prototipos de `app design/`. Cero código de aplicación. Dos bloqueantes de
    arquitectura abiertos — ver `_tasks.md § Bloqueado`. **La rama no se mergea
    entera**: el pensamiento sí sube, el SQL re-aplicable no.

### Supabase

- Proyecto: `hour-phase0` · ref `lqlyorlccnniybezugme` · `eu-central-1`.
- Plan: **Free** — y eso **pausa el proyecto a los ~7 días sin actividad**.
  Ocurrió entre el 16 y el 23 de agosto de 2026 —el backup del 23 ya la
  encontró caída— y costó **al menos cuatro días** de app inutilizable sin que
  nada lo avisara: el Worker sigue sano y `/health/live`
  verde, así que la pantalla carga y solo el login falla. **La firma es que el
  DNS desaparece** (`dig <ref>.supabase.co` vacío); comprobar eso ANTES que
  credenciales, `.env` o RLS. Se despierta con un botón del dashboard, sin CLI,
  y los datos sobreviven. El backup semanal a R2 es el único tráfico automático
  y **no basta como latido** — una semana es justo el ancho de la ventana.
- **`hour-staging` está pausado** desde la misma fecha. Se dejó así, y el
  2026-08-27 eso **ya cambió un gate real**: la migración de ese día se aplicó
  sin el ensayo en staging. No es una nota preventiva, es algo que pasó — ver
  `_tasks.md § 34`.
- **Última migración aplicada: `20260828100000_guard_performance_bolo_same_project`**
  (2026-08-28, run 33163749816). Una función solo cuelga de un bolo de SU
  proyecto: hasta ese día lo único que sujetaba `performance.bolo_id` era la FK,
  y **se verificó en producción que enlazar a un bolo de otro proyecto devolvía
  204**. Con el UUID en la mano se le movía a un tercero el `function_count`.
  RLS 151 → **156**. Debajo, `20260827100000_retire_person_note_private_permission`
  (2026-08-27, run 33059043384), que cierra ADR-093 §5. Las dos dejan la base
  por delante del Worker sin nada que desplegar: no tocan tipos ni bundle.
- **ROTURA EN PRODUCCIÓN EL 2026-08-29, y duró unos minutos.** Al añadir
  `series_id` al `select` de `/api/performances`, el endpoint pasó a **403
  «permission denied for table performance»** — y con él el mes, la agenda y el
  tablero, que leen todos de ahí. Causa: `20260720172431` devolvió el SELECT
  sobre `performance` **por columnas**, con una lista de julio, y una columna
  nueva **no entra sola en un grant por columnas**. Arreglado por
  `20260829120000` concediendo `series_id` —que es una etiqueta de agrupación,
  no dinero, a diferencia de `bolo_id`, que sigue fuera a propósito—.
  **La regla:** una columna nueva de `performance` no existe para PostgREST
  hasta que se la nombra en el grant, y meterla en un `select` sin el grant
  rompe el endpoint ENTERO, no solo ese campo. Y la lección de proceso: el E2E
  exige origen desplegado, así que desplegar un cambio de feed y probar
  DESPUÉS deja una ventana rota — cuando se toca el `select` de un feed, hay
  que pegarle al endpoint justo después del deploy, sin esperar a la suite.
- **La trampa que casi esconde ese agujero, escrita porque volverá:** el mismo
  PATCH da 403 con `Prefer: return=representation` y 204 con `return=minimal`.
  El 403 no era la regla, era el revoke de SELECT sobre las columnas de dinero
  (`20260720172431`) al devolver la fila entera. **Un test escrito con el helper
  de siempre salía verde rechazando por el motivo equivocado.** La API real ya
  lo esquiva nombrando sus columnas en el `select`.
- Auth: email+password, cookies httpOnly en la app, hook de access token activo.
- RLS: FORCE en las superficies tenant-scoped; suite live **163/163**
  (2026-08-28; el 120/120 que decía esta línea era de julio).
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

**Pase 2026-08-27** — Supabase despertada, deploy y verificación completa contra
el runtime desplegado `ad3cf67`: `svelte-check` **0/0** (1.871 ficheros), unit
**555/555**, RLS **150/150** (20 ficheros, 74 s) y E2E **56/56** (2,4 min), cero
skips. Antes del deploy el E2E daba 55/56, y el único rojo era el pulse contra
el CSS viejo — o sea el spec funcionando. **El arreglo del pulse se verificó
midiendo, no razonando**: con el clamp inyectado sobre el runtime desplegado la
respuesta mide 47,03 / 47,17 / 47,23 a 1024 / 1280 / 1600, y el mecanismo
(`var()` dentro de `-webkit-line-clamp`) se comprobó en chromium dando
31,72 → 15,86, los mismos números que producción. Cero cambios de schema, así
que no hubo backup ni staging en el gate.

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

Abrir `_tasks.md`. Nada bloquea: prod == `ad3cf67` y **las cuatro suites en
verde** contra ese runtime (2026-08-27); encima solo van tests y documentación,
más la migración `20260827100000`, que no toca el bundle. Todo lo que sigue
sirve al **Planner v3**, que es la pieza en curso — pero léelo con el aviso de
abajo delante, porque la mitad de esta lista ya no era cierta:

> **PARA CUANDO SE LEA ESTA LISTA: EL 2026-08-27 TRES DE SUS SIETE PUNTOS
> ESTABAN HECHOS Y SEGUÍAN ESCRITOS COMO PENDIENTES**, y un cuarto a medias. No
> es descuido de nadie en concreto: se construye, se despliega, se escribe el
> ADR — y nadie vuelve a la lista a tacharlo. Es la misma forma que los tres
> rojos del E2E de ese día. **Antes de tratar un punto de aquí como abierto,
> compruébalo contra el árbol y contra `_decisions.md`, no contra esta lista.**

1. ~~**`note`, el post-it privado**~~ — **construido y desplegado** desde el
   2026-08-11 (`_tasks.md § 23`, ADR-093, migración `20260731120000`). La lista
   lo llamó dieciséis días «la única maquinaria que el Planner v3 necesita y no
   existe». Sus dos restos se cerraron el 2026-08-27: el margen ya tiene E2E
   (`tests/note-margin.spec.ts`) y `read:person_note_private` está retirado en
   producción (`20260827100000`).
2. ~~**Persona: ¿dial o vista?**~~ — **decidido y construido** (`§ 24`).
   **ADR-094** (2026-07-31) lo cerró —dial, con su valor en la URL, y ya estaba
   construido— superando a ADR-092 §1 solo en la conclusión de mobiliario; y
   **ADR-095 §2** cerró lo único que ADR-094 dejó abierto, borrando el Loom en
   favor de los carriles del Board. Los tres avisos de ADR-094 §3 están los
   tres. Desplegado el 2026-08-10.
3. ~~**La fontanería barata**~~ — **hecha entera** el 31 de julio (`§ 25`, que
   ya lo decía en su propio texto): los cinco hitos del run sheet, `'day'` como
   cuarta proyección y `booking_mode` en `workspace.settings`.
4. **El escritor de reparto** (`§ 20`) — **la tubería y una pantalla mínima
   existen**: `CastPanel.svelte`, montado en la portada de proyecto, escribe
   `cast_member` por `/api/projects/[id]/cast`. Así que ADR-094 §5 —«sin reparto
   no hay eje»— ya no bloquea. **Lo abierto es dónde vive el casting de
   verdad**, y eso es el pase de UI del Planner v3.
5. **Follow-up de money v3 (no bloquea):** UX de **enlazar una función nueva a un
   bolo** — las performances creadas en Planner nacen sin bolo hasta que exista.
6. **Travel v2 (ADR-089):** modelo decidido, **nada de schema construido**. Su
   dependencia dura —la tarea 15, editar una fecha desde la UI— ya está
   construida, desplegada y con E2E verde. **Es el primer punto de esta lista
   que es trabajo de verdad y no una casilla mal puesta.**
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
