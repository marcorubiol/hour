# Hour — estado canónico del proyecto

> **Reconciliación 2026-10-10: § 17 P1 (LA ESCALETA) EN PRODUCCIÓN.** Runtime
> **`db6a343`**. Las cinco franjas de `performance` viven ahora en
> `schedule_slot` (ADR-090): migración A `20261009200000` (expand, run
> 38030572363), deploy, y B `20261009210000` (contract: DROP de las columnas,
> run 38031613191), sin ventana rota. Antes, el mismo día: `aria-busy` en cada
> lente y `waitForLoaded` en el E2E (deploy `5fd46f0`), keepalive diario de
> Supabase y `build/schema.sql` borrado. Suites contra `db6a343` con B
> aplicada: **RLS 203/203 · E2E 62/62**.

> **Reconciliación 2026-10-09 (tarde): § 31 Y § 40 EN PRODUCCIÓN.** Runtime
> **`3f6eb44`** (builtAt 2026-10-09T14:48Z), `main` == prod. **Migración
> `20261009100000_conversation_event` aplicada** (backup 37944973422, plan
> 37945388593, apply 37946632931): el historial de cada conversación (ADR-098);
> «Contacted today» se retira y queda «Log contact…». `muk-cia` contiene solo
> los 154 contactos reales; los tests viven en `playwright` y el usuario del
> E2E ya no pertenece a `muk-cia` ni a `marco-rubiol`. Suites: **RLS 190/190 ·
> E2E 62/62** contra `3f6eb44` (una primera pasada justo tras el deploy dio 4
> rojos por tiempo que pasan solos; la segunda, limpia).

> **Reconciliación 2026-10-09: TRAVEL V2 P1 EN PRODUCCIÓN, Y LAS 154 DE
> `muk-cia` SON REALES.** Supabase estaba pausada otra vez (DNS vacío; el backup
> del 2026-10-04 falló); despertada por MCP y backup a mano (run 37935960177,
> sello `2026-10-09T13-19-04Z`). **Migración `20260926100000_travel_stages`
> aplicada** (apply run 37939208092, tras inspect 37938291019 y plan
> 37938415844); catálogo verificado y **RLS 179/179** contra la base migrada.
> Mergeada en `main` (`d540641`). **El Worker sigue en `a67e99c`**: la base va
> por delante a propósito, y el código de P1 son tipos y tests, sin pantalla.
>
> **Corrección:** las 154 conversaciones vivas de `muk-cia` NO son el juego
> sintético que este documento describía desde agosto. Son la lista real de
> difusión de MaMeMi, importada el 2026-04-19 (emails reales, 0 de prueba); lo
> sintético con 154 filas es `supabase/fixtures/staging.sql`, que solo carga
> staging. 28 llevan encima un overlay de muestra del 2026-07-04
> (`custom_fields._sample`). Anouk quiere usar Hour para la difusión: `§ 31`
> está en carril y `§ 40` (`conversation_event`) en cola.

> **Reconciliación 2026-09-26: EL § 38 ESTÁ EN PRODUCCIÓN.** Runtime
> **`a67e99c`** (builtAt 2026-09-26T21:14:55Z, `dirty:false`), desplegado por
> Marco desde el checkout principal; `/health/ready` con Supabase `ok`. Es
> **el paso barato de `_tasks.md § 38`**: la gira deducida dice «deducida ·
> ida 7 oct · vuelta 12 oct» en el mes, la agenda, el día y el Tablero, y se
> nombra «de gira» y no «fuera». Cero schema. Verificado antes del push:
> `svelte-check` 0/0 y unit **563/563**. Después del deploy, **E2E 61/62**
> contra `a67e99c` (9,9 min): el único rojo fue Books, que no pintó sus
> totales en 5 s al principio de la pasada, justo tras el deploy, cuando cada
> test tardaba 10-22 s; solo, pasa en 4,7 s, y el smoke, que abre la misma
> página, pasó en la misma pasada.
>
> **Travel v2 P1 está escrita y NO aplicada en ninguna base hosted.** Rama
> `feat/travel-stages` en `origin`, con la migración `20260926100000`, su
> rollback, los tipos y `tests/rls/travel-stage.test.ts`. Las decisiones de
> implementación son **ADR-097, que vive en esa rama** hasta que se mergee.
> **Ensayo en staging VERDE el 2026-09-27** (run 36297834709): base hosted
> reconstruida desde cero con la migración dentro, fixtures con la forma
> esperada, **RLS 179/179** (los 169 de producción más los 10 de
> `travel-stage.test.ts`), build y smoke 2/2. El primer intento (run
> 36297342639) había destapado que el baseline de staging estaba roto desde
> el 2026-07-30, ajeno a Travel; arreglado en `main` (`355f63d`, § 39). Para
> producción falta el `inspect`, y después backup, plan y apply.
>
> Suites contra `795b6a5` (2026-09-26): **RLS 169/169 · E2E 61/62**, el rojo
> por tiempo y no por la app (ver «Verificación»).

> **Reconciliación 2026-09-25: NADA NUEVO DESDE EL 31 DE AGOSTO, Y ESTE
> DOCUMENTO SE HABÍA QUEDADO EN EL 27.** Runtime **`795b6a5`** (builtAt
> 2026-08-31T05:45Z), `main` == `origin/main` == prod, sin commits desde
> entonces. Comprobado hoy contra `/health/live`, `/health/ready` (Supabase
> `ok`), git y los runs de GitHub Actions. **Suites, corridas por Marco el
> 2026-09-26 contra el runtime `795b6a5`: RLS 169/169 y E2E 61/62.** Las 169
> son las 163 de agosto más los 6 casos de `bolo-status.test.ts`, que no
> habían entrado en ningún pase completo. El único rojo del E2E fue el smoke,
> por tiempo y no por la app: su test entero tiene 30 s para siete
> navegaciones, y se cortó con Conversations todavía cargando mientras los
> cinco specs que cargan esa lente pasaban. Solo, pasa en 15 s. Producción va
> hoy más lenta que en agosto (RLS 216 s frente a 74 s; E2E 4,9 min frente a
> 2,4), y el smoke queda marcado `test.slow()`.
>
> **Entre el 27 y el 31 de agosto entraron 45 commits (`bd333f0..795b6a5`),
> todos desplegados:**
> - **Funciones de varios días** (`_tasks.md § 16`, cerrada): `series_id`,
>   `create_performance_series`, `POST /api/performances/series`, el alta con
>   «varios días» y la banda del mes que dibuja una tanda como un elemento.
> - **Función↔bolo, la mitad de abajo** (§ 36): `bolo_id` en el PATCH y un
>   trigger que exige mismo proyecto. Falta la pantalla, que dibuja Marco.
> - **Un trato tiene vida**: `update_bolo_status` y el PATCH de
>   `/api/money/bolos/[id]` mueven el estado de un bolo. Hasta entonces todo
>   bolo creado desde Hour nacía `confirmed` y no podía cambiar.
> - **Cuatro migraciones a producción**, cada una con su plan y su apply por el
>   workflow: `20260828100000_guard_performance_bolo_same_project` (run
>   33163749816), `20260829100000_performance_series` (run 33237067289),
>   `20260829120000_grant_select_performance_series_id` (run 33237741473, el
>   arreglo de la rotura de esa misma mañana, contada en «Supabase») y
>   `20260829140000_bolo_status_lifecycle` (run 33260401928).
> - Una tanda de ajustes del mes del Planner v3 (banda, pie de semana,
>   ausencias, pauta) y **§ 38 anotada**: la gira deducida no dice que la
>   dedujimos.
>
> **Supabase se volvió a pausar en septiembre.** El backup programado del
> 2026-09-13 murió con la firma de siempre (`ENOTFOUND tenant/user
> postgres.<ref> not found`); el del 2026-09-16, lanzado a mano, ya pasó, y el
> programado del 20 también. Quién la despertó y a qué hora, no lo tengo. Es la
> pausa que § 33 decidió aceptar mientras no haya usuarios que no sean Marco.
>
> **Y «Siguiente paso» afirmaba algo falso:** que nada del rediseño del Planner
> (Scope v3 Agenda) estaba implementado. Está en producción desde el
> 2026-08-10 (ADR-095/096); el proyecto de diseño queda como referencia de
> dibujo, no como spec. Corregido abajo.

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
> Última verificación: **2026-09-25/26**, contrastada con Git, producción
> (`/health/live` y `/health/ready`), los runs de GitHub Actions y las suites
> RLS y E2E contra el runtime `795b6a5` (2026-09-26). Las reconciliaciones
> anteriores se conservan abajo, en orden inverso.
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
- `/health/live`: sano, `dirty:false`, SHA **`795b6a5`** (builtAt 2026-08-31T05:45Z).
  Comprobado el 2026-09-25.
- `/health/ready`: sano, Supabase `ok` (2026-09-25). **Estuvo en rojo del ~23 al
  27 de agosto** con `status_530`, y no era la app: Supabase se pausó sola. Ver
  la cabecera del 2026-08-27. Volvió a pausarse hacia el 13 de septiembre (ver
  la cabecera del 2026-09-25).
- **2026-09-26: prod == `a67e99c`** (builtAt 2026-09-26T21:14:55Z), con el
  § 38 dentro: entró en `main` con `677f342` y lo demás son documentos.
  Desplegado por Marco con `pnpm --filter web run deploy`. Sin schema.
  Después: E2E 61/62 contra `a67e99c` (9,9 min); el rojo fue Books por tiempo, y solo pasa en 4,7 s.
- Debajo va **`795b6a5`** (2026-08-31), que fue el runtime hasta el
  2026-09-26.
- **2026-09-25: `main` == `origin/main` == prod == `795b6a5`**. No había nada
  sin desplegar ni commits desde el 31 de agosto. Lo que subió entre el 27 y
  el 31 está en la cabecera del 2026-09-25.
- Debajo va **`ad3cf67`** (2026-08-27), que fue el runtime hasta el 31 de
  agosto. El deploy del 2026-08-27 sube **el arreglo del pulse**
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

- Repo: `https://github.com/marcorubiol/hour` (público).
- Checkout: `/Users/marcorubiol/Developer/hour`.
- Rama principal: `main`.
- **2026-09-26: prod == `a67e99c`, y `main` solo lleva encima documentos.**
  Lo que entró sobre `795b6a5`: los documentos del 25 y el 26, el
  `test.slow()` del smoke y el § 38 (cinco commits de aplicación).
- **2026-09-25: `main` == `origin/main` == prod == `795b6a5`**, sin commits
  desde el 2026-08-31. Los 45 del 27 al 31 están en la cabecera.
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
  v3 y el pulse ya están desplegados. `hardening/audit-fixes`, que estaba
  contenida en `main` sin commits propios, **ya no existe** (ni local ni en
  origin, 2026-09-25). `feat/planner-tour-deduced` entró en `main` por
  fast-forward y se borró (2026-09-26). **2026-10-09: solo queda `feat/comms-threads`**; `feat/travel-stages` entró en `main` vía `claude/travel-v2-prod` y se borró. Lo de abajo es el estado del 2026-09-26: **quedaban dos ramas además de `main`:**
  - `feat/travel-stages`: Travel v2 P1 (ADR-089, ADR-097), en `origin` desde
    el 2026-09-26. Migración escrita y probada solo en local; espera el ensayo
    en staging.
  - `feat/comms-threads`: comms + acceso. **Tiene un solo commit propio**
    (`0f1ff5c`, 2026-07-21, «reduce comms-threads to its build material») sobre
    `2176eec`, que ya está en `main`. **Su canon ya está en `main`**
    (ADR-082/083/085, las dos escaleras y la faceta en `structure-model.md`, el
    digest del grill y el review de 32 hallazgos). Lo que ese commit añade es
    solo material de construcción: 604 líneas de SQL **sin aplicar**
    (`2026-07-20_comms_threads_and_membership.sql`), seis prototipos HTML de
    `app design/` con su índice y su `_kit.css`, `_comms-wip.md`, un review de
    prototipos y un prompt de diseño. Cero código de aplicación. Dos
    bloqueantes de arquitectura abiertos: ver `_tasks.md § Bloqueado`.
    **Por decisión, la rama no se mergea entera**: el pensamiento ya subió, el
    SQL re-aplicable no.

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
  **Volvió a pasar en septiembre**: el backup del 2026-09-13 falló con la misma
  firma y el del 16 ya pasó. Aceptado a propósito mientras no haya usuarios
  externos (`_tasks.md § 33`).
- **`hour-staging` está pausado** desde la misma fecha (su DNS seguía vacío el
  2026-09-25). Se dejó así, y el
  2026-08-27 eso **ya cambió un gate real**: la migración de ese día se aplicó
  sin el ensayo en staging. No es una nota preventiva, es algo que pasó — ver
  `_tasks.md § 34`.
- **Última migración aplicada: `20261009210000_schedule_slot_contract`**
  (2026-10-10, run 38031613191; § 17 P1, con `20261009200000_schedule_slot`
  justo antes). Debajo va **`20261009100000_conversation_event`** (2026-10-09,
  run 37946632931; ADR-098). Debajo va **`20260926100000_travel_stages`** (2026-10-09,
  run 37939208092; Travel v2 P1, ADR-097). Debajo va
  **`20260829140000_bolo_status_lifecycle`**
  (2026-08-29, run 33260401928). Un bolo nace en el estado que toca
  (`proposed`, `hold`, `hold_1..3` o `confirmed`) y se mueve después por
  `update_bolo_status`, con la puerta de `update_bolo_fee` (`edit:money`).
  `invoiced` y `paid` quedan fuera de los dos caminos: money v3 deriva lo
  cobrado de los pagos, y escribirlos a mano sería un segundo sitio para la
  verdad del dinero. Guardián: `tests/rls/bolo-status.test.ts` (6 casos).
  Debajo, las dos del mismo día: `20260829100000_performance_series` (run
  33237067289, funciones de varios días) y
  `20260829120000_grant_select_performance_series_id` (run 33237741473, el
  arreglo de la rotura que se cuenta más abajo).
- Debajo va **`20260828100000_guard_performance_bolo_same_project`**
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
- RLS: FORCE en las superficies tenant-scoped; suite live **169/169** el
  2026-09-26 (23 ficheros, 216 s).
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

- **Desde el checkout principal** (`~/Developer/hour`), nunca desde un
  worktree de `.claude/worktrees/`: los worktrees no llevan `.env` ni
  `.env.test`, así que RLS sale todo saltado y el login del E2E falla. Pasó
  el 2026-09-26.
- **Si el E2E dice «Looks like Playwright was just installed»**, falta la
  revisión exacta de Chromium que pide esa versión de Playwright (el
  2026-09-26 pedía la 1217 y la caché solo tenía 1223 y 1228). El config ya
  trae la salida: `PW_CHROMIUM` apuntando a otra revisión instalada, p. ej.
  `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome
  for Testing.app/Contents/MacOS/Google Chrome for Testing`. Sin descargar
  nada.
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

**2026-10-10, contra `5fd46f0`: el rojo de tiempo, resuelto (de momento).**
Cada lente y detalle lleva `aria-busy` mientras le faltan datos, y cada spec
espera a `waitForLoaded` (`tests/loaded.ts`) tras cada `goto`/`reload` en vez
de a 5 s fijos. Dos pasadas seguidas, la primera justo tras el deploy: **62/62
y 62/62**. Dos pasadas son evidencia, no ley: si vuelve un rojo de tiempo,
mirar primero si un `aria-busy` se quedó en `true`.

**2026-10-09, contra `3f6eb44`: el rojo de tiempo sigue, y subir el
presupuesto global no lo arregló.** Tres pasadas completas: 4 rojos justo
tras el deploy, luego 62/62, y una tercera con `expect.timeout` a 15 s solo
contra origen desplegado (probado y **revertido**, sin commit): 2 rojos y
1 sin correr, en specs distintos, y los dos pasan solos. Un número más
grande no es la ley; si se ataca, será esperando a que la página diga que
ha cargado, spec por spec, no con otro umbral.

**Pase 2026-09-26, después del deploy** (Marco, contra `a67e99c`): E2E
**61/62** en 9,9 min. El rojo fue `money.spec.ts`, que no vio los totales de
`/h/money` en 5 s; los primeros 25 tests de la pasada tardaron 10-22 s cada
uno y los últimos 2-9 s. Solo, pasa en 4,7 s. **Dos pasadas, dos rojos de
tiempo en specs distintos**: el patrón es la latencia de producción, no un
spec concreto. Si vuelve, el sitio es el presupuesto del primer `expect` de
cada spec, no otro `slow()` suelto.

**Pase 2026-09-26** (Marco, contra el runtime `795b6a5`, sin deploy ni schema):
RLS **169/169** (23 ficheros, 216 s) y E2E **61/62** (4,9 min). El rojo fue
el smoke por su presupuesto de 30 s, con Conversations aún cargando; solo,
pasa en 15 s, y queda marcado `test.slow()`. La misma suite tardó 74 s y
2,4 min el 27 de agosto: producción va hoy más lenta, y un umbral de tiempo
medido aquel día es la misma hipótesis sobre los datos de un día que ya
tumbó tres specs en agosto.

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
- **Planner** `/h/planner` (v3, ADR-095/096): día, agenda, mes y tablero;
  performances (también de varios días, en tanda), dates, disponibilidad,
  viajes, gira deducida, conflictos, decisiones derivadas y el margen privado
  de `note`. `Calendar` queda solo para iCalendar/ICS e URLs legacy con
  redirect.
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
  certificada**. Vencido → tarea a Desk. Desde el 2026-08-29 el estado de un
  bolo se mueve (`update_bolo_status`) y ya no nace siempre `confirmed`.
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

Abrir `_tasks.md`. Prod == `a67e99c`, con el § 38 desplegado el 2026-09-26 y
verificado: RLS 169/169 (antes del deploy) y E2E 61/62 contra `a67e99c` (9,9 min); el rojo fue Books por tiempo, y solo pasa en 4,7 s (ver
«Verificación»). Lo siguiente es despertar `hour-staging` para ensayar Travel
v2 P1.
Todo lo que sigue sirve al
**Planner v3**, que es la pieza en curso. Pero léelo con el aviso de abajo
delante, porque la mitad de esta lista ya no era cierta:

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
   bolo**. La mitad de abajo está hecha y en producción desde el 2026-08-28
   (`bolo_id` en el PATCH + trigger de mismo proyecto); falta el selector, que
   dibuja Marco, y `create_performance` con `p_bolo_id` (`_tasks.md § 36`, `§ 37`).
6. **Travel v2 (ADR-089):** modelo decidido, **nada de schema construido**, y
   **esperando a Marco** desde el 2026-07-23: tres preguntas sin responder en
   `_tasks.md § 18`. Su dependencia dura, la tarea 15 (editar una fecha desde
   la UI), ya está construida, desplegada y con E2E verde.
7. **La gira deducida tiene que decir que la dedujimos** (`_tasks.md § 38`).
   Un paso barato sin schema y uno caro por decidir.
8. **Contenedores (bloque 5)** y la escaleta (ADR-090, `§ 17`) van después.
   El multi-día de performances **ya está hecho** (`§ 16`, 2026-08-29).

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

> **Rediseño del Planner (Scope v3 Agenda): IMPLEMENTADO Y EN PRODUCCIÓN desde
> el 2026-08-10** (ADR-095/096; corregido el 2026-09-25, este párrafo decía que
> nada de él estaba implementado). Las cuatro vistas (día, agenda, mes y
> tablero), el `Slip` como la única card, el dial de carriles, el margen de
> `note` y el pulse del rail. El diseño sigue en un proyecto de
> claude.ai/design (`Hour Views - Scope v3 - Agenda.html` + `AGENDA-SYSTEM.md`),
> que se lee con `DesignSync`, pero **ya no es lo que se implementa**: el repo
> va por delante en varios sitios y el propio documento se declaró
> no-especificación tras descubrir que ocho de sus leyes eran falsas en
> pantalla. Sirve para resolver una duda de dibujo; lo que manda son los ADRs
> y las aserciones de `tests/planner-laws.spec.ts`.

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
