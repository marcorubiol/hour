# Plan: Conversaciones con etiquetas

> 2026-10-19. Solo plan: sin código, sin migraciones, nada aplicado. Rama `claude/conv-tags-plan`. El coordinador lo
> lleva a Marco antes de construir.
> Fuentes: `_context.md`; `build/structure-model.md`; `build/architecture.md`; `_decisions.md` ADR-082, 083, 085, 098,
> 099, 100, 102, 104 a 106, 115 a 118, 121, 124, 126 a 128, 133 a 135; `build/plans/2026-10-14-comms-threads.md`;
> `build/plans/2026-10-14-bulk-send.md`; `supabase/migrations/` y `apps/web/src` en `main` (`d00efedf`); producción
> consultada en solo lectura (`BEGIN READ ONLY`) el 2026-10-19. Lo que no se pudo comprobar va marcado como
> **suposición**.

## La idea, en una línea

Todas las conversaciones funcionan igual (con salas, con el equipo, con prensa, con coproductoras, con
distribuidoras), y lo que hoy son vistas distintas (Difusión, Equipo) pasan a ser **etiquetas que filtran** dentro de la
lente Conversaciones. Con tres condiciones ya acordadas:

1. Igual por fuera no es igual por dentro. Lo común (con quién, mensajes e historial, no leídos, etiqueta, filtro,
   búsqueda) es igual para todas; lo específico es un **añadido** que solo tienen algunas: el trato con estados y el
   turno de difusión, el envío en bloque, el enlace a bolo y dinero, los hilos de un bolo con sus facetas.
2. **La etiqueta nunca decide permisos.** La privacidad sigue en las facetas (ADR-104, 105, 106), las conversaciones
   privadas (ADR-099, 100, 124) y el directorio (ADR-124).
3. Vocabulario de oficio (ADR-128, 134): la etiqueta de venta se llama Difusión en escena y Contratación en música;
   Equipo, Prensa, etc. La lente sigue llamándose Conversaciones.

## 1. Estado de hoy, verificado en el árbol y en producción

### 1.1 Las dos cosas que hoy se llaman conversación

| | `conversation` (Difusión) | `thread` + `message` (Equipo) |
|---|---|---|
| Con quién | **Una organización de fuera** (`organization_id NOT NULL`, ADR-102) y sus contactos (`conversation_contact`: persona, rol, `since`, `until`, uno principal) | **Gente de dentro**: quien tiene acceso al contenedor o a la faceta. Sin lista de participantes (ADR-106, sin invitados) |
| Cuelga de | Un proyecto (`project_id NOT NULL`) y, opcional, una línea (`line_id`) | Exactamente un ancla: proyecto, línea, bolo o conversación (`thread_one_anchor`), y una faceta opcional (NULL = General) |
| Cuántas | Una por organización y proyecto (`conversation_project_organization_shared_uidx`; otra por cada `private_to`) | Un General y uno por faceta en cada ancla (`thread_anchor_key`). Nace con el primer mensaje |
| Historial | `conversation_event`: correo, llamada, reunión, mensaje, nota; `source` manual, email, whatsapp, import, integration; con dirección (entra, sale). Append-only, escrito por `record_conversation_event`, la sincronización del buzón (`mail_*`) y el envío (`mailout_record_sent`) | `message`: texto del equipo, autor siempre un login, de qué función habla (hilos de bolo), borrado blando. Escrito por `post_message`, `edit_message`, `delete_message` |
| Estado | `status` (`conversation_status`: contacted, in_conversation, hold, confirmed, declined, dormant, recurring), **NOT NULL DEFAULT 'contacted'**; `next_action_at`/`_note`; `first_contacted_at`, `last_contacted_at`; `reply_settled_at` (ADR-126) | Ninguno. N a N, sin estado |
| No leídos | **No existen.** Hay turno («te toca», ADR-118 § 3, ADR-126 § 1), que es otra cosa | `thread_read` por hilo y persona; «nuevo» = ajeno y posterior a la lectura |
| Quién lee | `conversation_select`: viva, `has_permission(project_id, 'read:conversation')` (faceta Converses, solo en membresías de espacio y de proyecto) y `private_to IS NULL OR private_to = auth.uid()`. Las hijas (`conversation_event`, `conversation_contact`, `thread` de conversación) heredan por `EXISTS` sobre la conversación | `private.thread_readable`: el de conversación, quien lee la conversación (`private.can_read_conversation`); el General de un contenedor, quien tiene acceso al contenedor por la cadena (`model_container_verb_at`); el de faceta, quien ve esa faceta por la cadena y la faceta activa (`model_has_facet_at`, `facet_active_at`). `message` hereda del hilo |
| Quién escribe | `edit:conversation` (Converses ver+editar). Volver privada: quien la creó o el admin (ADR-124 § 6) | Quien lee el hilo (ADR-106 § 3) |
| Añadidos que cuelgan | `bolo.conversation_id`, `performance.conversation_id`, `task.conversation_id`, `mailout_recipient.conversation_id`, el pagador por la organización (ADR-102 § 5) | `bolo_board` (tablón desde una función, sin dinero), `thread_audience` (la línea «Lo ven N, por…») |
| Cómo la lee la lente | `GET /api/conversations` (PostgREST con embebidos; búsqueda por la RPC `conversation_search`) y `GET /api/conversations/overview` (`$lib/conversation-overview.ts` en el Worker: turno, se enfría en dos grupos, temporada por línea, último envío). ADR-118: con embebidos de evento **no escala** más allá de ~1.000 conversaciones | RPC `thread_feed(p_workspace_ids, p_project_ids, p_limit)` (ADR-116), que hoy solo abre anclas de bolo y de conversación |
| Dónde se ve | Vista Difusión de `/h/conversations`; ficha `/h/[workspace]/conversation/[slug]` (estado, siguiente paso, turno en el lateral, registro, hilo del equipo al lado) | Vista Equipo (`?view=team`, ADR-134); tablón en la ficha de la función; hilo del equipo en la ficha de la conversación |

La vista sale de un solo `$derived` en `routes/h/conversations/+page.svelte` (línea 100): `view === 'team'` si la URL lo
pide o si quien mira no tiene Converses (ADR-134 § 4). Doce ficheros de `apps/web/src` leen `ConversationStatus` o
`conversation_status`: el panel, la tabla, el menú de estado, la ficha, Desk (`DeskBoard`, `HomeView`) y los dos
módulos del overview.

### 1.2 Lo que ya es igual y lo que no

- **Ya igual en el fondo:** las dos tienen historial con autor y fecha, las dos se leen por una regla en la base que la
  pantalla no puede saltarse, y el hilo del equipo de una sala ya vive dentro de la conversación (`thread.conversation_id`).
- **No igual, y con razón:**
  - *Con quién.* Una conversación tiene una parte de fuera (una organización y sus contactos); un hilo no tiene a nadie
    de fuera. Eso decide cómo entra el correo (por la dirección de un contacto) y quién lee (Converses frente a la
    cadena del contenedor). **Es la línea de fractura real, no la etiqueta.**
  - *Estado.* Solo la venta tiene trato. Hoy `status` es NOT NULL: una conversación con un periódico nacería
    «contactada» y entraría en «se enfría» y en la temporada. Es lo primero que la idea obliga a cambiar.
  - *No leídos.* Los hilos los tienen; las conversaciones no.
- **Mezclado sin querer:** el turno (`last_turn`) es común por naturaleza (cualquiera con correo de ida y vuelta lo
  tiene), pero hoy vive dentro del overview de venta.

### 1.3 Producción (solo lectura, 2026-10-19)

| Espacio | Conversaciones vivas | Contactos | Eventos | Hilos | Mensajes | Envíos |
|---|---|---|---|---|---|---|
| `muk-cia` (real) | **152**, todas `contacted`, todas con línea (la `campaign`), ninguna privada; 3 borradas | 157 | 1 (correo sincronizado) | **0** | **0** | 0 |
| `testing` | 8, privadas | 12 | 19 | 4 (de conversación) | 11 | 0 |
| `playwright` | 24 vivas, 346 borradas | 357 | 604 | 350 (287 de bolo, 63 de conversación) | 823 (649 borrados) | 257 |
| `marco-rubiol` | 0 vivas, 1 borrada | 1 | 0 | 0 | 0 | 0 |

`muk-cia` tiene además una línea `residency` y una `tour` sin conversaciones. Nadie ha escrito todavía un hilo real:
la migración de hilos no arriesga datos de nadie. Lo que sí hay que no perder son las 152 conversaciones de venta.

## 2. El modelo

Tres alternativas. La recomendada primero.

### (b) Recomendada · Dos entidades, una lectura común, etiquetas en la conversación

La línea de fractura es **con quién** (fuera o dentro), no **de qué**. Se mantienen las dos entidades, que ya están
bien cortadas por esa línea, y lo que Marco ve como «etiquetas» se reparte así:

- **Las conversaciones con fuera llevan etiquetas de verdad**: Difusión (Contratación en música), Prensa, Coproducción,
  Distribución y las que cree cada espacio. Una sala, un periódico y una coproductora son la misma entidad con la misma
  ficha, el mismo registro, el mismo buzón sincronizado, el mismo turno y los mismos no leídos.
- **Equipo es la etiqueta de lo que se habla dentro.** No se guarda: la tienen por definición todos los hilos. En la
  fila de filtros es un chip más, al lado de los otros, y se comporta igual (filtra la misma lista).
- **Una sola lectura** presenta las dos como filas iguales: con quién, lo último, cuándo, no leídos, etiquetas. Cada
  fila se lee con **su** regla de hoy, sin tocarla.

**Por qué esta.** Cumple la idea donde se ve (una lista, un filtro, una ficha, las mismas columnas) sin fundir dos
reglas de permisos que hoy son correctas y están probadas (RLS 401/401). La alternativa (a) obliga a meter en una tabla
dos fronteras de lectura distintas elegidas por una columna, que es justo el sitio donde una etiqueta acaba decidiendo
permisos. Y ADR-106 ya decidió «hilo y conversación no se fusionan: los une la lente»; esto es esa misma decisión
llevada hasta el final, no una vuelta atrás.

#### Esquema

Todo aditivo salvo un `DROP NOT NULL`.

**Vocabulario de etiquetas**, con la forma de `facet` (ADR-099, añadido: estándar sembradas por clave y traducidas;
propias del espacio con su nombre):

| Tabla | Columnas | Nota |
|---|---|---|
| `conversation_tag` | `id`, `workspace_id` (NULL = estándar), `key`, `label`, `labels`, `sort`, `deal_default boolean`, timestamps | Mismo `CHECK` que `facet_label_by_kind`. Estándar: `sales`, `press`, `coproduction`, `distribution`. `sales` lleva `deal_default = true` |
| `workspace_conversation_tag_setting` | `workspace_id`, `tag_id`, `label`, `labels`, `active`, `sort` | Renombrar o desactivar una estándar en un espacio, como `workspace_facet_setting` |
| `conversation_tagging` | `conversation_id`, `tag_id`, `workspace_id`, `created_by`, `created_at`; PK `(conversation_id, tag_id)` | FK compuesta `(conversation_id, workspace_id) -> conversation (id, workspace_id)` (patrón de `message`, hallazgo 29): una etiqueta no cruza espacios. Pide `UNIQUE (id, workspace_id)` en
`conversation`, que hoy no existe (verificado en las migraciones); es aditivo. Guard: la etiqueta es estándar o de ese espacio, y está activa |

Nombres: `conversation_tag` para el vocabulario y `conversation_tagging` para la unión, para no confundir con `tag` en
otros sitios. **Suposición:** no hay ninguna tabla `tag` hoy (cero `CREATE TABLE` con ese nombre en las migraciones).

La palabra en pantalla de `sales` es la de ADR-134: `conversations.view_sales` con su variante `@music` (Difusión,
Contratación, Difusió, Contractació, Diffusion, Booking). Equipo es `conversations.view_team`. Las demás, claves nuevas
en los cuatro idiomas; si teatro y música piden palabras distintas, la variante `@music` de ADR-129 § 3.

**El trato pasa a añadido.** *Superado por § 8 (Marco, 19-10).* La primera versión de este plan hacía
`conversation.status` opcional (NULL = sin trato). Con § 8 el trato vive en el bolo y la conversación lleva solo el
estado de la relación, que tienen todas: una de Prensa es «contactada» o «en conversación» como una sala, y lo que la
distingue es que no tiene bolos. El «añadido de trato» de una conversación es tener bolos. `deal_default` desaparece
de `conversation_tag`.

**No leídos de una conversación:** `conversation_read (conversation_id, user_id, last_read_at)`, como `thread_read`.
Un no leído es un evento entrante (`direction = 'in'`, sin `metadata.auto`, ADR-126 § 3) posterior a la lectura, o un
mensaje ajeno del hilo del equipo de esa conversación posterior a su `thread_read`.

**Lo que no se toca:** `thread`, `message`, `thread_read`, las facetas, `conversation_event`, `conversation_contact`,
las políticas de lectura de todo lo anterior, el buzón y el envío.

#### Permisos

- **Leer etiquetas:** `conversation_tagging_select` = `EXISTS` sobre `conversation` (hereda la RLS del que llama, como
  `conversation_event`). Quien no ve la conversación no ve sus etiquetas. El vocabulario (`conversation_tag`) lo lee
  cualquier miembro del espacio: son nombres, no datos.
- **Poner y quitar etiquetas:** quien edita la conversación (`edit:conversation` y su privacidad). Solo por RPC
  (`set_conversation_tags(p_conversation_id, p_tag_ids)`), sin grant de escritura directa.
- **Crear, renombrar, desactivar etiquetas del espacio:** el admin del espacio, como las facetas propias.
- **La etiqueta no aparece en ninguna política de lectura de nada.** Es una regla del plan y se comprueba con un test
  (§ 5): ninguna función de `private.*` ni ninguna política nombra `conversation_tagging`.
- Si algún día hace falta que «la de prensa vea Prensa y no Difusión», la respuesta no es la etiqueta: es una línea de
  prensa con su membresía y Converses en esa línea, que hoy `has_permission` no mira (solo espacio y proyecto). Eso es
  permiso por contenedor, ya previsto en el modelo de facetas, y queda fuera de este plan.

#### El hilo de equipo dentro de la ficha de una sala

No cambia. Sigue anclado a la conversación, se lee como ella y se ve al lado del registro. En la lista, la fila de la
sala lleva sus no leídos sumados (registro + hilo); en el chip Equipo aparece también, como hilo, con el nombre de la
sala (lo que ya hace `thread_feed`, ADR-116 § 5).

#### El tablón de un bolo

No cambia. Es un hilo de Equipo: sale bajo el chip Equipo y en «Todas»; abre la ficha de la función con `#board`
(ADR-116 § 3). Quien no tiene Converses lo sigue viendo (ADR-134 § 4).

#### Cómo nace una conversación de prensa

«Añadir» con la etiqueta Prensa marcada (la del filtro activo, si hay uno). Con quién: una organización (el medio) o,
si es una periodista independiente, una organización con su nombre, como ya pasa con un programador independiente
(ADR-102 § 1). Contacto: la persona. Proyecto: el de la obra de la que se habla. **Sin trato**: sin bolos (§ 8; la
primera versión decía `status` NULL), así que no entra en el panel de venta, ni en «se enfría», ni en la temporada. Sí tiene turno y no leídos: si la periodista
contesta, te toca. El buzón sincronizado la trae sola, porque empareja por la dirección del contacto y no mira la
etiqueta (`mail_contact_addresses`).

#### Varias etiquetas

Sí. ADR-102 § 3 dice una conversación por organización y proyecto, así que la sala que programa y además coproduce es
una sola conversación con dos etiquetas (Difusión y Coproducción). Si la regla fuera una sola etiqueta, habría que
romper ADR-102 § 3 o elegir mal una de las dos (pregunta 2).

#### Fijas o por espacio

Estándar sembradas por Hour, y cada espacio las renombra, desactiva o crea las suyas (pregunta 3). Mismo patrón que las
facetas. Como la etiqueta no da permisos, una etiqueta propia es inofensiva: no hay que pensar quién la ve.

### (a) Una sola entidad: la conversación absorbe los hilos

`conversation` gana `kind` (fuera o dentro), `organization_id` y `project_id` pasan a opcionales, gana las anclas y la
faceta de `thread`; `message` y `conversation_event` se unen o conviven como dos historiales de la misma fila.

- **Esquema:** contract sobre la tabla con las 152 conversaciones reales: tres columnas NOT NULL que dejan de serlo,
  la unicidad por organización se vuelve parcial por tipo, las anclas de `thread` se copian, `message.thread_id` pasa
  a `conversation_id`.
- **Permisos:** `conversation_select` tendría dos ramas elegidas por `kind` (Converses y privacidad frente a la cadena
  del contenedor y la faceta). Es exactamente el sitio donde una columna de clasificación decide quién lee, que la
  condición 2 prohíbe en espíritu aunque `kind` no sea la etiqueta. Habría que rehacer `can_read_conversation`,
  `thread_readable`, `thread_feed`, `bolo_board`, `thread_audience`, las seis RPC de mensajes, el directorio
  (ADR-124, que clasifica dossiers por «contacto de alguna conversación») y el envío.
- **Hilo de equipo en la ficha de una sala:** una conversación de dentro anclada a otra conversación. Rompe la idea de
  «una conversación es con alguien».
- **Tablón del bolo:** una conversación de dentro anclada al bolo con faceta.
- **Prensa:** igual que en (b).
- **Por qué no:** mucho más riesgo para el mismo resultado en pantalla. El usuario no ve las tablas.

### (c) La etiqueta es la línea

Sin vocabulario nuevo: la etiqueta de una conversación se deduce de su línea (`line.kind`: `campaign` es Difusión, una
línea de prensa es Prensa…), y Equipo son los hilos.

- **Esquema:** solo valores nuevos de `line_kind` (`press`, `coproduction`) y `status` admitiendo NULL.
- **Permisos:** cero cambios, y deja abierto el permiso por línea si algún día hace falta.
- **Problemas:** una conversación tiene como mucho una línea, así que la sala que coproduce no puede ser dos cosas; una
  conversación sin línea no tiene etiqueta; cada etiqueta nueva es un valor de enum (migración) y no algo que un espacio
  crea; y mezcla dos preguntas distintas (en qué campaña va, de qué va). Hoy `muk-cia` tiene las 152 en una sola línea
  `campaign`, que encaja, pero en cuanto haya una segunda campaña de la misma obra la línea dice «cuál», no «qué».
- **Por qué no:** se queda corta en lo que pide Marco (varias, por espacio) y ata la etiqueta a la temporada por línea
  (ADR-135), que es otro eje.

## 3. La lente con filtros

### Cómo se ve

```
Conversaciones                                     [Añadir] [Seleccionar]
Todas · Difusión · Prensa · Coproducción · Equipo        buscar…
─────────────────────────────────────────────────────────────────────────
[panel: el de la etiqueta activa, o el común]
─────────────────────────────────────────────────────────────────────────
Sala Beckett          Difusión · Opción        te toca · hace 2 días   •2
El Periódico (Laia)   Prensa                   ayer                    •1
Bolo Kursaal 15 nov   Equipo · Técnica         hoy 11:00               •3
Teatre Lliure         Difusión · Coproducción  hace 3 semanas
```

- **Una fila de chips** sustituye los dos fragmentos «Difusión · Equipo» de la cabecera (ADR-134 § 2). «Todas» primero;
  después las etiquetas activas del espacio en su orden, con la de venta en su palabra de oficio; Equipo al final.
  Selección única (un chip activo) en la primera versión: lo que se ve arriba del panel depende de él.
- **La URL lleva el filtro:** `?etiqueta=sales|press|…|team`. `?view=team` redirige a `?etiqueta=team` (301 en carga
  completa, como hizo ADR-134 § 3 con `?view=threads`). Sin parámetro, lo que decida la pregunta 4.
- **La lista** es una sola, con las columnas comunes: con quién (organización y contacto, o el contenedor del hilo),
  etiquetas (y la faceta en un hilo), el estado del trato solo si lo hay, lo último y cuándo, turno si lo hay, no
  leídos. Orden: los no leídos y los «te toca» arriba, después por lo último.
- **Quien no tiene Converses** solo ve el chip Equipo (y «Todas», que es lo mismo para él): como hoy, la lente abre en
  Equipo (ADR-134 § 4). Los chips de etiquetas no se dibujan, porque no hay conversación que pueda leer.

### El panel según el chip

| Chip | Panel | De dónde sale |
|---|---|---|
| Difusión | El de hoy entero: te toca, la temporada por línea (ADR-135), sin noticias (paradas y sin respuesta al envío, ADR-126 § 8), último envío | El overview de hoy, acotado a conversaciones con trato y la etiqueta `sales` |
| Prensa, Coproducción, propias | Común: te toca (respuestas pendientes y seguimientos), no leídos | Lo común del overview, sin estados |
| Equipo | Ninguno, o una línea con los no leídos | `thread_feed` |
| Todas | Común: te toca de todas las de fuera, no leídos de todo | Las dos fuentes |

«Te toca» deja de ser de venta: es común a cualquier conversación con correo de ida y vuelta. La temperatura (se
enfría), la temporada y el último envío **siguen siendo del trato** y solo salen en Difusión.

### Envío en bloque

«Seleccionar» y «Escribir a N» siguen existiendo solo con el chip Difusión (añadido de venta; el envío lleva la base
por dirección, ADR-110 § 2). Si Prensa lo pide (nota de prensa a medios), es la pregunta 6.

### Dashboards (ADR-117, 118, 126, 135)

- ADR-117 § 1 «cada lente responde cómo está su dominio» se mantiene: el dominio de la lente pasa a ser el chip activo.
- ADR-118 § 7 (un bloque y su filtro no pueden contar distinto) sigue valiendo, ahora por chip: el panel de Difusión
  cuenta solo filas con trato y etiqueta `sales`, y su filtro lleva `etiqueta=sales`.
- ADR-118 § 2 (te toca mira todo el alcance) se amplía: con «Todas», todo lo que tiene turno.
- ADR-126 § 8 («sin fecha de contacto»: 151 de 152 en `muk-cia`) sigue igual y solo en Difusión.
- ADR-135 (temporada por línea) solo en Difusión.

### Desk (ADR-121, 127, 133)

- **Te espera** (ADR-127 § 1): hoy toma las filas «te toca» con motivo `reply` del overview de venta. Pasa a tomarlas
  de todas las conversaciones de fuera: si contesta un periódico, te espera igual que una sala. La fila dice la
  etiqueta si no es Difusión.
- **Ha cambiado** (ADR-121 § 5, ADR-127 § 4): hilos con nuevos y salas que escribieron; pasa a «conversaciones que
  escribieron», de cualquier etiqueta. El enlace de su cabecera pasa de «Equipo →» (ADR-134 § 7) a la lente con el chip
  que toque.
- **La puerta de Conversaciones** (ADR-127 § 7): su cifra es de venta (holds de la temporada, vivas, te toca) y sigue
  gateada por Converses. Cambia solo «te toca», que cuenta todas. Si con Prensa en uso la puerta mezcla mal, se revisa.
- **Cobros y cambios de estado** (ADR-133): no se tocan.

### Módulo Conversations de una línea, ficha de persona y de organización

El módulo de una línea es la lente acotada a ella: hereda los chips. El bloque «Conversaciones» de la ficha de una
persona o de una organización lista sus conversaciones con sus etiquetas.

## 4. Migración de lo que hay en producción

Nada se borra ni se reescribe.

1. **Vocabulario:** crear `conversation_tag` con las cuatro estándar y `workspace_conversation_tag_setting` vacía.
2. **Etiquetar lo que hay:** cada conversación existente (vivas y borradas, para que revivir una borrada la deje como
   estaba) recibe `sales`. En `muk-cia`, las 155 filas (152 vivas). Todas tienen estado, así que el trato no cambia.
3. ~~`status` admite NULL~~: superado por § 8. El estado se parte en relación y trato con su propia migración
   (§ 8.5).
4. **`conversation_read`:** tabla nueva vacía. Sin backfill: todo empieza leído para todos (si no, las 152 saldrían
   como no leídas el primer día). En la misma migración, una fila por persona con acceso y conversación sería una
   foto de permisos que caduca; mejor «sin fila = leído hasta su `created_at`» en la regla.
5. **Hilos:** nada. `muk-cia` tiene 0 hilos y 0 mensajes.

Comprobación dentro de la migración (patrón de `20261014100000_comms_threads`): foto antes y después de cuántas
conversaciones lee cada membresía de `muk-cia`; si cambia, `RAISE` y aborta. Ninguna política cambia, así que la foto
tiene que salir igual.

Gate de § 34 (`_notes/tasks-archive.md`): aditiva salvo el `DROP NOT NULL`, que relaja. Backup, plan y apply por
`production-migrate.yml`. Staging opcional; **recomendación: hacerlo**, porque toca la tabla de las 152 reales.

**Rollback** (`build/runbooks/rollback-2026102x-conversation-tags.sql`, probado ida y vuelta en local):
- Borrar `conversation_tagging`, `workspace_conversation_tag_setting`, `conversation_tag`, `conversation_read` y sus
  funciones.
- `status`: con § 8 esta migración ya no lo toca; su rollback va en § 8.5.
- Lo que el rollback no deshace: las etiquetas propias que un espacio haya creado y sus asignaciones (se pierden con la
  tabla; el backup las tiene).

El Worker de la fase 2 lee las tablas nuevas: la migración va antes del deploy, como en ADR-126.

## 5. Riesgos y cómo se prueban

| Riesgo | Por qué importa | Prueba |
|---|---|---|
| Una etiqueta acaba decidiendo quién lee | Condición 2. Es la tentación natural en cuanto alguien pida «solo prensa» | RLS: ninguna política ni función `private.*` nombra `conversation_tagging` (consulta a `pg_policies` y `pg_proc` en el test). Matriz: fixture con Converses ve las conversaciones de todas las etiquetas; sin Converses, ninguna; quitar o poner etiquetas no cambia lo que ve nadie |
| La lectura común filtra de más o de menos | Mezclar dos fuentes en una RPC es donde se cuela una fila | RLS: para cada usuario fixture, los ids de `conversation_feed` son exactamente la unión de lo que devuelven `conversation` y `thread` por PostgREST con su JWT. Privada ajena: ni la fila, ni sus etiquetas, ni sus no leídos, ni su recuento en el panel |
| Las etiquetas de una privada ajena se ven por otro camino | El vocabulario es público al espacio; las asignaciones no | RLS: `conversation_tagging` de una privada ajena da 0 filas; el recuento por etiqueta del panel no la cuenta |
| Una etiqueta cruza espacios | Etiqueta propia de A puesta en una conversación de B | RLS: `set_conversation_tags` con una etiqueta de otro espacio da 42501; la FK compuesta lo impide en el esquema |
| Una desactivada sigue saliendo | Desactivar oculta, no borra | Unit: el chip no sale; la conversación conserva la asignación y la recupera al reactivar |
| El cambio de estado rompe lecturas que daban por hecho hold y confirmed | Doce ficheros leen `ConversationStatus` | Ver § 8.6 |
| ~~Un bolo enlazado a una conversación sin trato~~ | Superado por § 8: tener bolo es tener trato; enlazar un bolo a una de Prensa es legítimo (la convierte en negocio) | |
| No leídos de 152 conversaciones el primer día | Ruido que esconde lo nuevo | Regla «sin fila = leído hasta su creación»; unit |
| Coste de la lectura común | ADR-118 midió que el overview no escala más allá de ~1.000 | La RPC nueva sigue el patrón de `thread_feed` (corte materializado por espacio, después la regla) y el `DISTINCT ON` que ADR-118 dejó propuesto. Medir en local con 2.000 conversaciones y 20.000 hilos, como ADR-116 |
| Desk cuenta distinto que la lente | ADR-118 § 7 | Unit: Desk y la lente leen la misma función de «te toca» |
| E2E escribe en datos reales | El usuario fixture es admin de `muk-cia` (memoria del proyecto) | Los specs nuevos crean y borran sus propias conversaciones en `playwright`; nunca etiquetan las de `muk-cia` |

Suites: `pnpm --filter web test:rls` con un fichero nuevo `tests/rls/conversation-tags.test.ts` (los casos de arriba)
y los que ya existen sin cambios; E2E contra un origen desplegado (`PW_BASE_URL`), con specs de chips, alta de Prensa
sin trato, URL (`?view=team` redirige), Desk con una respuesta de Prensa. Nunca la RLS y el E2E a la vez.

## 6. Fases

Cada fase se despliega sola y deja la app coherente.

| Fase | Qué | Migración | Carriles |
|---|---|---|---|
| 0 | ADR con el modelo y las respuestas a § 7. Enmienda ADR-106 (la lente), ADR-117/118 (el dominio es el chip), ADR-134 (las vistas pasan a chips) | No | Coordinador |
| 1 | Esquema: vocabulario, `conversation_tagging` con backfill `sales`, `set_conversation_tags`, `conversation_read` y `mark_conversation_read`. Tests RLS. El Worker no lee nada todavía | Sí, § 34 | 1 |
| 2 | Pantalla mínima: chips en la cabecera (Todas · Difusión · etiquetas · Equipo) sobre las dos lecturas de hoy; «Añadir» con etiqueta y sin trato; etiquetas en la ficha y en la fila; el panel de Difusión acotado a `sales` con trato y el común para el resto; `?view=team` redirige. «Todas» todavía como dos bloques uno bajo otro (conversaciones y hilos), sin mezclar orden | No | 1 |
| 3 | Lectura común: RPC `conversation_feed` (mezcla, orden por no leídos y turno, no leídos de conversación), «Todas» en una sola lista, búsqueda en las dos fuentes (organización, contacto, contenedor; el cuerpo de mensajes y eventos, si Marco lo quiere, es otra RPC). Desk: te espera y ha cambiado de todas las etiquetas | Sí, aditiva (la RPC) | 2, uno detrás de otro (base y RPC; pantalla y Desk) |
| 4 | Etiquetas del espacio en Ajustes: crear, renombrar, desactivar, ordenar (admin) | No (el esquema llega en la 1) | 1 |

Total: 5 carriles más el ADR. La 4 puede ir en paralelo con la 3 (no comparten ficheros salvo el diccionario). Si
Marco quiere ver antes cómo se siente, la fase 2 sola ya enseña la idea (chips, una de Prensa sin trato).

## 7. Preguntas para Marco

1. **¿Qué modelo?**
   - **(b) Dos entidades, una lectura común, etiquetas en la conversación** (recomendada). La fractura es con quién
     (fuera o dentro), no de qué; mantiene las dos reglas de permisos que ya funcionan y da la misma lista en pantalla.
   - (a) Una sola entidad. Más limpio sobre el papel, pero mete dos fronteras de lectura en una tabla elegidas por una
     columna y rehace casi todo comms.
   - (c) La etiqueta es la línea. Cero vocabulario nuevo, pero una sola por conversación, fijas y atadas a la campaña.

2. **¿Una conversación puede tener varias etiquetas?**
   - **Sí, varias** (recomendada). Con una conversación por sala y proyecto (ADR-102 § 3), la sala que programa y
     coproduce es una sola conversación: necesita las dos.
   - Una sola, y la unicidad pasa a sala, proyecto y etiqueta: dos conversaciones con la misma sala, con dos registros
     que el buzón tendría que repartir (el mismo correo, ¿a cuál?).
   - Una sola, y la sala coproductora va en Difusión: más simple, pero Coproducción deja de ser un filtro fiable.

3. **¿Etiquetas fijas o de cada espacio?**
   - **Estándar de Hour (Difusión, Prensa, Coproducción, Distribución) y cada espacio renombra, desactiva o crea las
     suyas** (recomendada). Es el patrón de las facetas y del oficio; como no dan permisos, una propia no tiene riesgo.
   - Solo las de Hour, fijas. Menos pantalla (la fase 4 desaparece); cada etiqueta nueva la añade Hour.
   - Libres por espacio, sin estándar. Cada compañía empieza de cero y el panel de venta no sabe cuál es la suya.

4. **¿Qué abre la lente sin filtro?**
   - **Todas** (recomendada). Es lo que dice la idea: Conversaciones no deja de ser conversaciones. Lo urgente
     (no leídos, te toca) sube arriba de todas formas.
   - El último chip que usaste, guardado en el navegador. Cómodo para quien vive en Difusión, pero el Planner ya quitó
     la vista recordada (ADR-120 § 2) por confusa.
   - Difusión, como hoy. Ningún cambio de costumbre, pero la idea queda escondida detrás de un clic.

5. ~~¿El trato depende de la etiqueta?~~ **Cerrada por § 8 (Marco, 19-10):** el trato vive en el bolo, así que no
   depende de la etiqueta ni de la conversación. Se deja el texto original como historia.
   - **No: es un añadido propio de la conversación.** Difusión lo propone al crear; cualquier conversación puede
     tenerlo o no (recomendada). Una coproducción con un teatro puede acabar en bolo; una de Difusión puede ser solo
     un contacto de cortesía. La etiqueta dice de qué va; el trato, si hay negocio.
   - Sí: solo las de Difusión tienen trato, y quitar Difusión lo quita. Más simple de explicar; quitar una etiqueta
     borraría un estado.

6. **¿Envío en bloque para Prensa (nota de prensa a medios)?**
   - **Más adelante, cuando haga falta de verdad** (recomendada). El envío lleva base por dirección y protección de la
     cuenta pensadas para difusión (ADR-110); abrirlo a prensa pide pensar la base de un periodista.
   - Ya en la fase 2, con el mismo envío y la misma base. Poco código, pero estrena el envío con un público para el que
     no se diseñó.

7. **¿Equipo es un chip más o se queda aparte?**
   - **Un chip más, en la misma fila, que no se pone ni se quita** (recomendada). Es lo que pide la idea, y el usuario
     no necesita saber que por dentro es otra tabla.
   - Aparte, a la derecha de la fila de etiquetas, como «lo de dentro». Más honesto con la diferencia, pero vuelve a
     ser dos vistas.

## 8. Añadido el 19-10: tres capas de estado y la regla entre lentes

Marco validó (vía el coordinador, 19-10) partir el estado en tres capas y fijar una regla del Planner. Esta sección
manda sobre lo anterior donde chocan; los sitios que cambian están marcados «superado por § 8».

**Caso que lo motiva.** Teatre de la Llum (espacio `testing`) sale «Confirmed» en la conversación, pero lo confirmado
es una fecha, no la relación. Verificado en producción: la conversación está en `confirmed` y su bolo también.

### 8.1 El trato vive en el bolo

- `bolo.status` ya tiene el ciclo: nace en `proposed`, `hold`, `hold_1..3` o `confirmed`, y se mueve además a
  `cancelled` y `done` (`20260829140000_bolo_status_lifecycle`, `bolo_status_can_open` y `bolo_status_can_move`;
  `invoiced` y `paid` no los escribe nadie en un bolo). No hace falta esquema nuevo para el trato.
- **La conversación pierde `hold`, `confirmed` y `declined` como trato.** Su estado pasa a ser solo el de la
  relación (§ 8.2).
- **La ficha de la conversación lista sus bolos** con fecha y estado: «14 mar · confirmado», «oct 27 · 1ª opción». La
  palabra de cada estado es la del Planner y del oficio (ADR-128: Opción, *hold* en EN), no una nueva.
- **Choque con el permiso, a decidir (pregunta 8).** `bolo_select` exige `read:money`
  (`20260722102000_money_v3_bolo`) y ADR-106 § 1 sacó «el estado del trato» de `bolo_board` por ser dinero. Quien
  lleva la difusión sin Diners no vería entonces el estado de sus bolos en su propia conversación. La propuesta es una
  RPC acotada, `conversation_bolos(p_conversation_id)`: fecha (primera y última función viva), sala, ciudad y estado,
  **nunca caché ni pagador**, para quien lee la conversación y tiene `read:performance` en el proyecto. El argumento:
  el estado de una función (opción, confirmada) ya lo ve cualquiera con acceso al Planner, y el del bolo es el mismo
  dato a otra altura. Pide enmendar ADR-106 § 1 en ese punto.
- **El panel de Difusión cambia de fuente.** La temporada por línea (ADR-135) y sus tramos se pintaban con los estados
  de la conversación; ahora la barra de cada línea cuenta relaciones (§ 8.2) y, aparte, los bolos de esas
  conversaciones por estado («3 en opción · 2 confirmados»), por la misma RPC sin dinero. La puerta de Conversaciones
  del Desk («conversaciones en hold», ADR-127 § 7) pasa a «bolos en opción de la temporada». Las dos leen el mismo
  módulo puro (ADR-118 § 7).

### 8.2 El estado de la relación vive en la conversación

Es de todo el espacio (no personal) y lo tienen todas las conversaciones, de cualquier etiqueta.

| Estado | Clave | Cómo se sabe |
|---|---|---|
| Nunca contactada | `never` | Derivado: ningún evento con dirección, sin `first_contacted_at` |
| Contactada | `contacted` | Derivado: hemos escrito y no han contestado |
| En conversación | `talking` | Derivado: han contestado (un evento entrante que no es automático, ADR-126 § 3) y hay actividad en los últimos 30 días |
| Dormida | `dormant` | Derivado: hubo conversación y no hay actividad en más de 30 días (el umbral de «sin actividad» de ADR-117 § 5) |
| Habitual | `regular` | Derivado: la organización tiene al menos un bolo `done` en una temporada anterior, en cualquier proyecto del espacio |
| No esta vez | `not_now` | **Manual** (ver abajo) |

- **Derivado gana.** Una conversación no guarda su estado: lo calcula una función sobre el historial, los sellos y los
  bolos, la misma que usan la lista, el panel, Desk y la RPC de lectura común (§ 6, fase 3). Así no hay dos verdades
  (la etiqueta que alguien olvidó cambiar y el historial).
- **Lo que se guarda a mano** es solo lo que el historial no puede saber: `not_now_at` (cuándo dijeron que no) y, opcional,
  `not_now_until` (cuándo volver a escribir, que es un siguiente paso con fecha). Se borra solo con un evento entrante
  posterior (han vuelto a hablar) o a mano.
- **Habitual por organización, no por proyecto.** La conversación es por organización y proyecto (ADR-102 § 3), pero
  que una sala sea habitual es de la relación con la compañía: si programó la obra anterior, la nueva empieza con una
  sala habitual. **Suposición** a confirmar con uso: «temporada anterior» es cualquiera antes de la actual
  (septiembre a agosto, ADR-117 § 3).
- **Precedencia:** `not_now` vigente > `regular` > `talking` > `dormant` > `contacted` > `never`. Una habitual que
  calla sigue siendo habitual; su silencio lo dice «se enfría» del panel, no el estado.

**Qué pasa con «declined».** Propuesta: **sobrevive como `not_now`, «no esta vez»** (la palabra de ADR-128 § 1). Por
qué:
1. No es un estado del trato: cuando una sala dice que no, casi nunca hay bolo que cancelar. Si hubiera opción, se
   cancela el bolo y la relación sigue aparte.
2. No se puede derivar: el «no» va dentro del cuerpo de un correo, y adivinarlo sería inventarlo.
3. Cambia lo que hace la app: una sala en «no esta vez» no entra en la segunda ronda de un envío ni en «se enfría», y
   nadie le vuelve a escribir esta temporada por error. Sin el estado, esa información solo vive en la memoria de
   quien leyó el correo.
4. Es temporal, no un veredicto: «rechazada» se lee como cerrada para siempre; «no esta vez» deja la puerta abierta y
   caduca sola con `not_now_until` o con una respuesta nueva.

**Esquema.** `conversation.status` y su enum se sustituyen en expand/contract: expand añade `not_now_at`,
`not_now_until` y la función `public.conversation_relation(...)` (o `private.`, con envoltorio para la política, según
lo lea la RPC); el Worker pasa a leer la relación derivada; contract borra `status`, el enum y el trigger
`conversation_contact_timestamps` en la parte que sellaba por cambio de estado (ADR-098: el sello de contacto lo
siguen moviendo los eventos). `reply_settled_at` y `next_action_*` no cambian.

**Choque con los 151 «sin fecha de contacto»** (ADR-126 § 8: 151 de 152 en `muk-cia`). Hoy están en `contacted` sin
evento ni sello, en buena parte por el DEFAULT de la columna. Derivando, saldrían «nunca contactada», que puede ser
falso si Anouk les escribió fuera de Hour. Pregunta 9.

### 8.3 «Lo conozco» es personal

No es una etiqueta (las etiquetas son de todos) ni un estado de la relación (es de una persona del equipo con un
contacto, no de la compañía con una sala).

**Dónde vive.** Tabla `person_acquaintance`: `workspace_id`, `person_id`, `user_id`, `shared boolean NOT NULL DEFAULT
false`, `created_at`, `updated_at`; PK `(workspace_id, person_id, user_id)`; FK compuesta `(workspace_id, person_id)
-> workspace_person`. Va por el **contacto**, no por la conversación: si Inés deja Pradillo y entra en otra sala,
quien la conoce la sigue conociendo (ADR-102: las personas cambian de sala). Es la misma clave que usa la nota privada
(`note.person_id` con `workspace_id`, ADR-093), y en la ficha va junto a ella: «Lo conozco» y «Mi nota» son las dos
cosas tuyas sobre esa persona.

**RLS.**
- `person_acquaintance_select`: la fila propia (`user_id = auth.uid()`) siempre que se sea miembro del espacio, como
  `note_select`; la de otro, solo si `shared` **y** quien llama puede leer ese dossier
  (`private.workspace_person_readable_by_caller`, ADR-124), **y** el dueño de la fila sigue siendo miembro aceptado.
  Así hereda la privacidad del directorio: el contacto de una privada ajena no se delata porque alguien diga que lo
  conoce.
- Escritura solo por RPC `set_acquaintance(p_workspace_id, p_person_id, p_known, p_shared)`: solo sobre la fila
  propia, y solo de un dossier que quien llama puede leer. Quitar «lo conozco» borra la fila (es tuya; no hay historia
  que guardar).
- La marca nunca abre nada: no da acceso a la conversación, al dossier ni a la sala. Test RLS como el de la etiqueta.

**Pantalla.** En la lista, la fila de una conversación lleva tu marca si conoces a alguno de sus contactos; si la
compartes, el equipo ve «La conoce Marco» (o «Marco y Anouk») en la ficha y en un tooltip de la fila. Compartir es
por marca, no global: puedes conocer a diez y compartir dos. Por defecto, sin compartir (pregunta 10).

### 8.4 Regla entre lentes

**Cada lente es dueña de un tipo de cosa; las demás solo muestran de ella lo que ayuda a decidir allí, con un enlace
de vuelta.** Conversaciones es dueña de las conversaciones y su relación; el Planner, de los bolos y sus funciones (lo
que se hace); Cuentas, del dinero; Desk no es dueño de nada (ADR-088: el digest).

- **En el Planner** lo que se hace cuelga del bolo y de sus funciones; la conversación no se dibuja en la rejilla.
- **Día y Agenda** muestran en el margen los próximos pasos con fecha de las conversaciones (`next_action_at`,
  `not_now_until`) y las tareas, **de la misma fuente que «Te espera»** (`rankWaiting` en `$lib/desk-feed`, ADR-121
  § 2), acotada a los días que enseña la vista. Cada línea abre su conversación (o la tarea en su sitio).
- **Mes y Temporada**, como mucho un número discreto por día o por semana («2 pasos»), que abre el Día.
- **Desde la conversación** se ven sus fechas: la lista de bolos de § 8.1, cada uno abre su función, y un «Ver en el
  Planner» que abre la Agenda en el primer día con el proyecto fijado. **Suposición:** el ámbito del Planner no admite
  hoy fijar un bolo ni una conversación (sus fichas son espacio, proyecto, línea y persona, ADR-092); fijar por bolo
  sería un token nuevo y queda fuera.
- **Choque con ADR-084 § 2** («las tareas no salen en el calendario, por ahora no»). Se lee como «no son eventos de
  la rejilla»: el margen no es la rejilla, y la tarea no ocupa un día ni un hueco. Pide una línea en el ADR de la fase 0
  que lo diga, para que no se lea como una contradicción.

### 8.5 Migración de datos (producción, solo lectura, 2026-10-19)

Regla: una conversación en `hold` o `confirmed` pasa su trato a sus bolos; sin bolo, queda «en conversación». El
estado de un bolo existente nunca se sobrescribe.

| Espacio | `hold` vivas | `confirmed` vivas | De ellas con bolo | `declined` vivas | Resultado |
|---|---|---|---|---|---|
| `muk-cia` (real) | 0 | 0 | 0 | 0 | Las 152 están en `contacted`. No hay nada que mover. `muk-cia` tampoco tiene bolos |
| `testing` | 1 | 1 | 1 (Teatre de la Llum, bolo ya `confirmed`) | 1 | Llum: el bolo ya dice confirmado; la conversación pasa a relación derivada. La de `hold` sin bolo: en conversación. La `declined`: `not_now` |
| `playwright` | 4 (+1 borrada) | 4 | 0 | 4 | Fixtures del E2E: las 8 a en conversación, las 4 `declined` a `not_now`. Los specs que las crean se reescriben en la misma fase |
| `marco-rubiol` | 0 | 0 | 0 | 0 | Nada (sus 17 bolos vivos no cuelgan de ninguna conversación) |

Conteo exacto: `conversation` agrupada por espacio y estado, con `EXISTS` sobre `bolo.conversation_id` vivo, en
`BEGIN READ ONLY`. De las que no están en `contacted`, ninguna tiene solo `performance.conversation_id` sin bolo.

- **«En conversación» como valor guardado no existe** en el modelo derivado (§ 8.2): lo que la migración hace en
  realidad es dejar de guardar el estado. Para no perder lo que alguien marcó a mano, el expand copia el valor viejo a
  `custom_fields.legacy_status` en las filas que no estaban en `contacted` (en producción, 0 en `muk-cia`), y el
  contract no lo borra.
- `dormant` y `recurring` viejos se dejan a la derivación; si sale distinto, gana lo derivado y lo viejo queda en
  `legacy_status`.
- **Rollback:** el expand es aditivo (columnas y función) y se deshace borrándolas. El contract (borrar `status`) se
  vuelve desde `legacy_status` más `contacted` para el resto; ADR-105 permite contract sin rollback SQL porque no hay
  usuarios, pero aquí sí hay datos reales en `muk-cia`, así que el rollback se escribe y se prueba.
- Gate de § 34: el contract es destructivo y toca la tabla de las 152 reales: **staging e `inspect` obligatorios**.

### 8.6 Riesgos nuevos y pruebas

| Riesgo | Prueba |
|---|---|
| El estado de un bolo llega a quien no debe | RLS: `conversation_bolos` nunca devuelve caché ni pagador; sin `read:conversation` o sin `read:performance`, 0 filas; privada ajena, 0 filas |
| «Lo conozco» delata un contacto de una privada ajena | RLS: fila compartida de un dossier que solo es contacto de una privada ajena: 0 filas para el resto, también para el admin (ADR-124 § 2) |
| La relación derivada cuenta distinto en lista, panel y Desk | Unit: una sola función pura, con casos de cada estado y de la precedencia |
| Doce ficheros leen `ConversationStatus` | `check` 0/0 tras cambiar el tipo; un spec E2E por estado derivado en `playwright` |
| Un «no esta vez» se queda para siempre | Unit: caduca con `not_now_until` y con un evento entrante posterior |
| El margen del Planner y «Te espera» divergen | Unit: los dos llaman a `rankWaiting` con la ventana como entrada |

### 8.7 Fases nuevas

Se intercalan con las de § 6; ninguna depende de las etiquetas salvo la última.

| Fase | Qué | Migración | Carriles |
|---|---|---|---|
| E1 | Expand de estado: `not_now_*`, función de relación, `conversation_bolos`, `legacy_status`. El Worker lee la relación derivada; menú de estado con solo «No esta vez»; la ficha lista sus bolos; el panel de Difusión y la puerta del Desk cambian de fuente | Sí, aditiva | 1 |
| E2 | «Lo conozco»: tabla, RPC, marca en la ficha junto a la nota y en la fila | Sí, aditiva | 1 (en paralelo con E1: no comparten ficheros salvo la ficha, que va detrás) |
| E3 | Margen del Planner en Día y Agenda, número en Mes y Temporada, «Ver en el Planner» desde la conversación | No | 1 |
| E4 | Contract de estado: fuera `status` y su enum | Sí, destructiva, staging | 1, tras usar E1 una semana |

### 8.8 Preguntas nuevas para Marco

8. **¿Quién ve el estado de los bolos desde la conversación?**
   - **Quien lee la conversación y el Planner del proyecto, sin caché ni pagador** (recomendada). El estado de una
     función ya es del Planner; el del bolo es el mismo dato. Enmienda ADR-106 § 1 solo en esto.
   - Solo quien tiene Diners. Coherente con `bolo_select`, pero quien lleva la difusión sin dinero ve conversaciones sin
     saber si hay algo confirmado.

9. **Las 151 de `muk-cia` sin fecha de contacto: ¿qué relación tienen?**
   - **«Contactada, sin fecha»: se respeta lo que estaba guardado** (recomendada). La migración les pone un sello de
     contacto sin día (`first_contacted_at` NULL y una marca `contacted_undated`), y la derivación las cuenta como
     contactadas. No inventa un contacto ni lo borra.
   - «Nunca contactada»: lo que dice el historial. Honesto con los datos, pero el DEFAULT de la columna y el trabajo de
     Anouk fuera de Hour se mezclan y no se pueden separar.
   - Preguntar a Anouk y fecharlas en bloque antes de migrar. Lo más exacto, y depende de que ella lo tenga.

10. **«Lo conozco»: ¿compartido por defecto?**
    - **No: cada marca nace privada y se comparte una a una** (recomendada). Es la regla de la nota (ADR-093: siempre
      privada) y la de las conversaciones nuevas (ADR-100: privadas por defecto); decir a quién conoces es decir algo
      de ti.
    - Sí: compartido por defecto, porque el valor está en que el equipo sepa a quién llamar. Más útil el primer día y
      más fácil de compartir sin querer.

## Fuera de este plan

- Conversaciones sin proyecto (prensa de la compañía, una distribuidora de todo el repertorio): `project_id` sigue
  obligatorio. Si hace falta, se decide aparte.
- Permiso por línea (que alguien vea solo las conversaciones de una línea): es contenedor, no etiqueta.
- Invitados externos en hilos, hilos libres con lista de gente, notificaciones (ADR-106, fuera).
- Búsqueda en el texto de correos y mensajes, salvo que Marco la pida en la fase 3.
