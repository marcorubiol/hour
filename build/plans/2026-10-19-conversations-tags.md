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

**El trato pasa a añadido:** `conversation.status` admite NULL (= sin trato) y pierde su DEFAULT. La RPC de crear
pone `contacted` solo si alguna etiqueta tiene `deal_default` o se pide un trato. Lo que hoy da por hecho que hay
estado (overview, se enfría, temporada por línea, «sin respuesta», el menú de estado) filtra `status IS NOT NULL`.

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
(ADR-102 § 1). Contacto: la persona. Proyecto: el de la obra de la que se habla. **Sin trato**: `status` NULL, así que
no entra en el panel de venta, ni en «se enfría», ni en la temporada. Sí tiene turno y no leídos: si la periodista
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
3. **`status` admite NULL** (`DROP NOT NULL`, `DROP DEFAULT`). Ninguna fila pasa a NULL.
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
- `status`: si hay filas con NULL (conversaciones sin trato creadas entre medias), el rollback **aborta** y dice
  cuántas. Decidir entonces: ponerles `contacted` (vuelven al panel de venta) o borrarlas a mano. Si no hay ninguna,
  `SET DEFAULT 'contacted'`, `SET NOT NULL`.
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
| `status` NULL rompe lecturas que daban por hecho el estado | Doce ficheros leen `ConversationStatus` | `check` 0/0 con el tipo `ConversationStatus \| null`; unit del overview con filas sin trato (ni se enfrían, ni cuentan en temporada, sí tienen turno); E2E: crear una de Prensa y comprobar que no sale en el panel de Difusión |
| Un bolo enlazado a una conversación sin trato | `bolo.conversation_id` hoy acepta cualquiera | Guard nuevo: solo una conversación con `status` no NULL. RLS: enlazar un bolo a una de Prensa da error |
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
| 1 | Esquema: vocabulario, `conversation_tagging` con backfill `sales`, `status` admite NULL, guard del bolo, `set_conversation_tags`, `conversation_read` y `mark_conversation_read`. Tests RLS. El Worker no lee nada todavía | Sí, § 34 | 1 |
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

5. **¿El trato depende de la etiqueta?**
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

## Fuera de este plan

- Conversaciones sin proyecto (prensa de la compañía, una distribuidora de todo el repertorio): `project_id` sigue
  obligatorio. Si hace falta, se decide aparte.
- Permiso por línea (que alguien vea solo las conversaciones de una línea): es contenedor, no etiqueta.
- Invitados externos en hilos, hilos libres con lista de gente, notificaciones (ADR-106, fuera).
- Búsqueda en el texto de correos y mensajes, salvo que Marco la pida en la fase 3.
