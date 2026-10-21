# Plan: rediseño de la lista de Conversaciones

> 2026-10-22. Solo plan: sin código, sin migraciones, nada aplicado. Rama `claude/night-plans`. Marco lo lee antes de
> construir (`_tasks.md`, «Rediseño de la lista de Conversations», drop 13-10, y la línea de dashboards que lo absorbe).
> Fuentes: `_context.md`; `build/structure-model.md`; `_decisions.md` ADR-102, 115, 117, 118, 120, 124, 126, 128, 134,
> 135, 138, 139, 140; `build/plans/2026-10-19-conversations-tags.md`; `apps/web/src` y `supabase/migrations/` en
> `origin/main` (`ad7a9cc6`): `routes/h/conversations/+page.svelte`, `ConversationTable.svelte`,
> `ConversationFeed.svelte`, `FeedLine.svelte`, `ConversationOverview.svelte`, `routes/api/conversations/+server.ts`,
> `$lib/server/conversation-overview.ts`, `$lib/calm.ts`, `20261021100000_conversation_feed.sql`,
> `20261020100000_conversation_relation.sql`; revisiones fuera de git `build/coordination/review-conversations/`
> (uso, diseño, móvil y accesibilidad, permisos; 18-10, producción `3864239`) y `build/coordination/review-depth/`
> (19-10). Leído en código, sin capturas nuevas ni consultas a producción esta noche: lo que depende de datos vivos va
> marcado como **suposición** o con la fecha de su fuente.

## La idea, en una línea

Una sola fila para toda la lente, ordenada por lo que te pide, con lo que necesita quien lleva la difusión para decidir
sin abrir la ficha (a quién le toca, en qué está la relación, qué bolos hay, qué se dijo lo último, qué paso viene), y
con las cuatro acciones que se hacen de diez en diez (escribir, «no esta vez», etiquetar, siguiente paso) sobre una
selección que puede ser «todas las que coinciden».

## 1. Estado de hoy, verificado en el árbol

### 1.1 Dos listas distintas según el chip

La lente pinta **dos componentes** según lo que haya en la URL (`+page.svelte`, `mixed`):

| | «Todas» sin filtro | Cualquier otro chip, o «Todas» con un filtro de bloque o de relación |
|---|---|---|
| Componente | `ConversationFeed` (filas `FeedLine`) | `ConversationTable` |
| Fuente | RPC `conversation_feed` (`/api/conversations/feed`), conversaciones e hilos | `/api/conversations` (PostgREST, o la ruta derivada del Worker con los filtros de bloque) |
| Forma | Fila de dos líneas: etiquetas en mono, nombre, «N nuevos», hora; debajo, dónde y lo último | Tabla de 7 columnas (abajo); en móvil, tarjetas (`display: block`) |
| Orden | No leídos, después te toca, después lo último | **Por próximo paso** (`next_action_at.asc.nullslast, updated_at.desc`) si solo hay chip; en el orden del bloque si hay filtro de bloque |
| Página | 100, «Ver más» | 50, Anterior y Siguiente |
| Escribe | Nada (se escribe en la ficha) | Relación («no esta vez» y apuntar contacto), próximo paso, historial |
| Selección | No | Sí, solo con el chip de venta (`canBulkSend`) |

Consecuencia: al pulsar Difusión, la misma sala cambia de forma, de columnas y de posición. La que te escribió ayer
está arriba en «Todas» y en mitad de la tabla en Difusión, porque la tabla ordena por próximo paso. Es la incoherencia
de fondo, más que cualquier columna.

### 1.2 Columnas de la tabla

`Organización` (con la marca «lo conozco» y las etiquetas de la fila) · `Contacto` (el principal) · `Ubicación` (la
ciudad de la persona, si no la de la organización) · `Estado` (la relación derivada; menú con «no esta vez» y «apuntar
contacto») · `Turno` («te toca · hace 2 días», «seguimiento · 24 oct», «les toca · …») · `Último contacto` (abre el
historial) · `Próximo paso` (fecha y nota; abre el diálogo). Encima, un conmutador «Por conversación · Por contacto»
guardado en `localStorage` (`hour:conversations:view`), que agrupa por persona.

### 1.3 Lo que la lista no tiene

- **El trato.** Desde ADR-138 § 3 vive en el bolo. El panel de Difusión ya lee `conversations_bolos` (hasta 2.000 ids
  por llamada, sin dinero); la lista no: una sala con una 1ª opción en marzo se ve igual que una que nunca contestó.
- **Lo último que se dijo.** La tabla da cuándo, no qué ni quién. El feed sí lo da (asunto del último evento).
- **No leídos** en la tabla: solo en el feed.
- **La tanda.** Se puede filtrar por respuestas o rebotes de un envío (`?envio=&r=respuestas|rebotes`, ADR-126 § 9),
  no por «recibieron este envío» ni por «no contestaron a este envío». La línea solo filtra junto a la temporada
  (`linea` exige `temporada=actual`).
- **Acciones en bloque** salvo «Escribir a N». No hay «no esta vez» a varias, ni etiquetar, ni siguiente paso, ni «no
  pide respuesta» a varias.
- **Seleccionar más allá de la página.** La selección vive entre páginas y filtros, pero «todas» marca solo las 50
  visibles.
- **Quién la lleva.** ADR-102 lo nombra en la franja de la ficha; **no hay columna** en `conversation` (`db-types.ts`:
  solo `created_by` y `private_to`). No se puede enseñar ni filtrar sin esquema.

### 1.4 Lo que dijeron las revisiones, y qué queda

De `review-conversations/` (18-10), lo de la lista que ADR-126 ya arregló: turno de las confirmadas, estado en la URL,
foco tras filtrar, «quedarse con» un proyecto en la barra, altura común de controles, error propio, tarjeta entera como
casilla en el móvil. **Lo que sigue vivo**:

- Móvil 11: la lista empieza a ~1,7 pantallas bajo el panel. Hay un salto «Ir a la lista», pero la lista sigue lejos.
- Móvil 1: la tarjeta del móvil reordena celdas con `order` y la tabla pierde su semántica en Safari (suposición del
  informe, sin WebKit).
- Diseño B1: el título «La lista» no dice nada.
- `review-depth/ui-visual.md` P4 (aceptada en ADR-139 § 4 y 6): **una fila de lista compartida** (columna izquierda
  fija en mono, nombre en sans, una línea de meta mono tenue, palabra al final). La tabla de Conversaciones es justo la
  que no la usa.
- `review-depth/calma-densidad.md` H2: en calma, Conversaciones esconde la lista entera y deja «Te toca». Se mantiene.

## 2. Qué información sirve, por chip

Pregunta de quien lleva la difusión al abrir la lista: **¿a quién escribo ahora, y qué le digo?** Después: ¿cómo va
cada sala? Lo demás es consulta y va a la ficha (el vistazo lateral, ADR-139 § 1, que ya abre cualquier enlace de
conversación de una lente).

| Dato | Para qué decide | Difusión | Prensa y propias | Todas | Equipo |
|---|---|:-:|:-:|:-:|:-:|
| Turno (te toca, seguimiento, les toca) | A quién escribo | sí | sí | sí | no |
| No leídos | Qué ha pasado | sí | sí | sí | sí |
| Con quién: la sala, y el contacto de verdad con su papel | A quién me dirijo | sí | sí | sí | no (el hilo: sala o bolo y faceta) |
| Relación derivada (nunca, contactada, en conversación, dormida, habitual, no esta vez) | Cómo la trato | sí | sí | sí | no |
| Bolos: estado y primera fecha («1ª opción · 14 mar», «+1») | Si hay negocio | sí | solo si tiene | si tiene | no |
| Lo último: quién, qué asunto, cuándo | Qué le digo | sí | sí | sí | sí (el mensaje) |
| Próximo paso: fecha y nota | Lo que me prometí | sí | sí | sí | no |
| Línea (la campaña) | En qué tanda va | sí, si hay más de una en el alcance | no | no | no |
| Último envío que recibió («22 sept · sin respuesta») | Segunda ronda | sí | no (no hay envío a prensa, ADR-138 § 7) | no | no |
| Ciudad | Rutas, agrupar a mano | en la línea de meta | en la meta | en la meta | en la meta |
| Etiquetas | De qué va | no (el chip ya lo dice) | otras etiquetas | sí | «Equipo» y la faceta |
| Proyecto | Solo si el alcance tiene varios | en la meta | en la meta | en la meta | en la meta |

Lo que **sale** de la fila: `Ubicación` como columna (pasa a la meta), `Contacto` como columna aparte (pasa bajo la
sala, con su papel), la fecha absoluta de «Último contacto» (va en el `title`). El drop pedía «contacto de verdad en
vez del nombre de la sala repetido»: cuando la organización lleva el nombre de la persona (programador independiente,
ADR-102 § 1), la segunda línea no repite el nombre (la regla de `conversation_feed`, que ya devuelve `person` solo si
es distinto del título).

## 3. La fila

### 3.1 Escritorio (desde 64 rem)

Una fila de dos líneas, la forma de `FeedLine` con columnas fijas (P4 de `ui-visual.md`). La columna izquierda en mono
es el turno: es lo primero que se lee y lo que ordena.

```
Conversaciones                                                     [Añadir conversación]
Todas · Difusión · Prensa · Coproducción · Equipo                  buscar salas, contactos…
[panel de Difusión]
──────────────────────────────────────────────────────────────────────────────────────────────────────────
Línea: todas ▾   Relación: cualquiera ▾   Envío: ninguno ▾   Orden: lo que pide ▾          [Seleccionar]
153 conversaciones
──────────────────────────────────────────────────────────────────────────────────────────────────────────
TE TOCA     Teatre de Salt  •2                 En conversación   1ª opción · 14 mar     ayer
ayer        Pep Vila, programación · Salt      «Re: Ruido blanco, fechas en marzo»                        24 oct · llamar
──────────────────────────────────────────────────────────────────────────────────────────────────────────
SEGUIMIENTO Sala Beckett                       Habitual          Confirmado · 2 nov +1  hace 3 semanas
hoy         Toni Casares, dirección · Barcelona  Tú: «Te paso el rider»                                   hoy · enviar rider
──────────────────────────────────────────────────────────────────────────────────────────────────────────
LES TOCA    Teatre Municipal de Girona         Contactada                               hace 4 semanas
            Laia Puig · Girona · MaMeMi 26-27 Cat.   Envío 22 sept · sin respuesta
──────────────────────────────────────────────────────────────────────────────────────────────────────────
            Centre Cívic Sant Andreu           Contactada, sin fecha
            programacio@… · Barcelona
──────────────────────────────────────────────────────────────────────────────────────────────────────────
                                              Ver 50 más
```

Columnas, de izquierda a derecha:

1. **Turno** (mono, ancho fijo): `TE TOCA`, `SEGUIMIENTO`, `LES TOCA` o vacío; debajo, desde cuándo o la fecha del
   seguimiento. Sale de `turnOf`/`followUpDue` (`$lib/conversation-overview`), las mismas funciones que el panel y
   Desk (ADR-118 § 7). Tarde (ADR-126 § 1) es el tono de aviso de la casa en esta columna, no un rojo nuevo.
2. **Con quién** (sans): la sala con sus no leídos («•2», el `Badge` del feed) y la marca «lo conozco»; debajo, el
   contacto principal con su papel, la ciudad y, si el alcance tiene varios, el proyecto y la línea.
3. **Relación** (pastilla `xs`, `StateBadge`): la palabra derivada. Es también el menú de «no esta vez» en la fila,
   como hoy.
4. **Bolos** (solo con el chip de venta o si la fila tiene alguno): el estado del bolo vivo más cercano y su primera
   fecha, con «+N» si hay más; la palabra del Planner (ADR-128). Abre el bolo en el vistazo.
5. **Lo último** (segunda línea, ocupa las columnas 3 y 4): quién («Tú:» o nada si fueron ellos) y el asunto o el
   mensaje; en una fila sin historial, el último envío que recibió.
6. **Cuándo y próximo paso** (derecha): arriba, cuándo fue lo último (`relativeContactDate`, días de calendario);
   abajo, el próximo paso con su nota, que abre su diálogo.

Un hilo del equipo en «Todas» o en Equipo es la misma fila: en la columna de turno, `EQUIPO` o la faceta
(`TÉCNICA`); con quién, la sala o el bolo; lo último, el mensaje; sin relación ni bolos. Es lo que ya hace
`ThreadFeedRow`; la fila nueva lo hereda.

### 3.2 Tableta (48 a 64 rem)

La misma fila sin la columna de bolos: el bolo pasa a la línea de meta, delante de la ciudad («1ª opción 14 mar ·
Salt»). Sin cambio de componente, por container query.

### 3.3 Móvil (menos de 48 rem)

```
┌───────────────────────────────────────────┐
│ TE TOCA · ayer                         •2 │
│ Teatre de Salt                            │
│ En conversación · 1ª opción 14 mar        │
│ «Re: Ruido blanco, fechas en marzo»       │
│ Siguiente: 24 oct · llamar                │
└───────────────────────────────────────────┘
┌───────────────────────────────────────────┐
│ LES TOCA · hace 4 semanas                 │
│ Teatre Municipal de Girona                │
│ Contactada · envío 22 sept sin respuesta  │
└───────────────────────────────────────────┘
          [Seleccionar]   (barra de lentes abajo)
```

- La tarjeta es una lista de líneas, no una tabla en bloque: se acaba el problema de semántica en Safari (móvil 1)
  porque ya no hay `table`.
- Tocar la tarjeta abre el vistazo como hoja (ADR-140 § 4). En modo selección, tocarla la marca (como hoy).
- Una línea vacía no se pinta: una contactada sin nada son dos líneas.
- **La lista sube.** En el móvil el panel de Difusión se pliega a su primera línea por bloque (la idea de móvil 11) y
  la lista empieza en la primera pantalla. Es pantalla, no datos.

### 3.4 Densidad

Una sola: dos líneas. La primera para decidir (turno, quién, relación, cuándo), la segunda para recordar (contacto,
lo último, el paso). Con 153 salas en 1440×900 caben unas 9 filas bajo un panel plegado y unas 14 sin panel
(**suposición**: medido a ojo con la altura de `FeedLine`, sin captura). Una vista compacta de una línea es la
pregunta 4.

## 4. Orden

**Una regla para toda la lente**, la de `conversation_feed`: no leídos, después te toca (respuestas, la más reciente
arriba, ADR-126 § 1; después seguimientos de hoy o vencidos), después lo último. Difusión deja de ordenar por próximo
paso.

Un menú «Orden» con cuatro, en la URL (`?orden=`): **lo que pide** (por defecto), **último movimiento**, **próximo
paso** (el orden de hoy en Difusión, para quien trabaja por agenda), **nombre**. Sin orden guardado en el navegador:
el Planner quitó la vista recordada por confusa (ADR-120 § 2), y por lo mismo el conmutador «Por conversación · Por
contacto» sale de la lente (pregunta 6).

Los filtros de bloque (te toca, se enfría, un tramo de la temporada) siguen ordenando en el orden de su bloque, como
dice ADR-118 § 7: el bloque y la lista enseñan lo mismo en el mismo orden.

## 5. Filtros

Una fila de filtros sobre la lista, cada uno en la URL y pintado como el selector de relación de hoy:

| Filtro | Valores | Hoy | Cambio |
|---|---|---|---|
| Etiqueta | los chips | `?etiqueta=` | ninguno |
| Relación | las seis | `?relacion=` | ninguno |
| Línea | las líneas del alcance, «sin línea» | `?linea=` solo con `temporada` | `linea` vale sola (Worker; `parseLinea` deja de exigir la temporada) |
| Envío (la tanda) | los envíos del alcance (los 10 últimos), y por cada uno: recibieron · contestaron · sin respuesta · rebotes | `?envio=&r=respuestas\|rebotes` | `r=todos` y `r=sin-respuesta` (Worker, desde `mailout_recipient`, la misma regla que la cifra) |
| Turno, temperatura, temporada | los de los bloques | `?turno=`, `?temp=`, `?temporada=` | ninguno; siguen llegando desde el panel como chip quitable |

«Sin respuesta a este envío» es la tanda de la segunda ronda, que hoy solo existe agregada en «se enfría · sin
respuesta al envío» (ADR-126 § 8) y para el último envío. Con el filtro, cualquier envío anterior es una tanda.

## 6. Acciones

### 6.1 Por fila

Sin cambios de fondo: relación («no esta vez» con fecha opcional, apuntar contacto), próximo paso, «no pide respuesta»
(hoy en el bloque y en la ficha; pasa también al menú de la fila cuando le toca a uno), abrir en el vistazo. Con el
teclado, la fila es un elemento de una lista con foco propio: flechas arriba y abajo, Intro abre el vistazo, `x` marca
en modo selección, Esc sale. ⌘K sigue siendo del marco.

### 6.2 En bloque

La barra de selección de hoy (`action-bar`, fija abajo, sobre la barra de lentes en el móvil) gana cuatro acciones:

```
──────────────────────────────────────────────────────────────────────────────────────────────────────────
 23 marcadas · Seleccionar las 88 que coinciden            [No esta vez] [Etiquetar] [Siguiente paso] [Escribir a 23]
──────────────────────────────────────────────────────────────────────────────────────────────────────────
```

| Acción | Qué hace | Con qué chip | Escribe por |
|---|---|---|---|
| Escribir a N | El envío de hoy: un proyecto, borrador, pantalla del envío | Venta (ADR-138 § 7) | `POST /api/mailout`, sin cambios |
| No esta vez | «No esta vez», con «hasta» opcional, a las N | Todas las de fuera | El PATCH de hoy, una por conversación |
| Etiquetar | Poner o quitar **una** etiqueta a las N, sin tocar las otras | Todas las de fuera | `set_conversation_tags` por conversación, leyendo antes las suyas |
| Siguiente paso | Misma fecha y nota a las N («volver a escribir el 5 nov») | Todas las de fuera | El PATCH de hoy |
| No pide respuesta | Marca atendida la última respuesta de las N | Las que tienen «te toca» | El PATCH de `reply_settled_at` de hoy |

- **Un endpoint de lote en el Worker**, `POST /api/conversations/bulk` (`{ action, ids, args }`, como mucho 500 ids),
  que hace por dentro lo que haría la fila, una conversación cada vez, con el JWT de quien llama. RLS decide cada una:
  lo que no se puede tocar vuelve como fallo de esa fila, nunca se salta. Respuesta: hechas, fallidas con su motivo.
  Sin migración, sin RPC nueva, sin `service_role`.
- **Deshacer** en el aviso («23 en no esta vez · Deshacer»), que reaplica el valor anterior de cada una (el endpoint
  devuelve lo que había). El aviso ya admite acción (ADR-126 § 11).
- **«Seleccionar las N que coinciden»**: cuando la página entera está marcada, una línea ofrece marcar todas las del
  filtro. El Worker ya calcula los ids de un filtro derivado (`filteredPage`) y de un chip (`loadTaggedIds`); se
  devuelven sin leer las filas, con el mismo tope de la lectura derivada (ADR-118, unas 1.000).
- **Envío y varios proyectos:** sin cambios (un envío es de un proyecto; «quedarse con» en la barra). Las otras cuatro
  acciones no tienen esa limitación.
- **Quién la lleva:** no hay acción porque no hay dato (§ 1.3). Pregunta 5.

## 7. Referencias

Lo que se toma de cada una, concreto. Lo que no conozco con certeza va marcado.

| App | Qué se toma |
|---|---|
| Gmail | La línea «Seleccionar todas las conversaciones que coinciden con esta búsqueda» tras marcar la página; las etiquetas que se ponen y quitan a una selección sin tocar las demás; la tecla `x` para marcar |
| Linear | La lista de una línea por cosa con propiedades a la derecha en columnas fijas; las opciones de vista (orden y propiedades visibles) en un menú y no en la cabecera; la barra de acciones en bloque abajo al marcar |
| Superhuman | La bandeja que ordena por lo que te pide y no por fecha de alta; que el teclado sea el camino corto (flechas, abrir, volver). No se toma su bandeja dividida en pestañas: aquí lo hacen los chips |
| Front y Missive | Etiquetas compartidas que no dan permisos y la asignación de una conversación a alguien del equipo, como referencia de la pregunta 5. **Suposición:** cómo resuelven la asignación en bloque no lo he comprobado |
| Attio y HubSpot | Las vistas de lista con columnas de propiedades y la edición de una propiedad en bloque (aquí: siguiente paso, etiqueta). No se toma su vocabulario ni las vistas guardadas por ahora (pregunta 7) |
| Things | La fila que no pinta lo vacío: una contactada sin nada son dos líneas, no siete celdas con guiones |

## 8. Esquema y API

**Sin migración en las fases 1 y 2.**

- `/api/conversations` añade a cada fila sus bolos, con `conversations_bolos` en una llamada por página (la que ya usa
  el panel; sin caché ni pagador, solo a quien tiene `read:performance`, ADR-138 § 3), el último envío que recibió
  (`mailout_recipient`, una lectura por página) y el asunto del último evento (`last_turn` ya lo embebe).
- `?orden=` (cuatro valores), `linea` sin temporada, `r=todos|sin-respuesta`, `?ids_only=1` para «las que coinciden».
- `POST /api/conversations/bulk` (§ 6.2).

**Fase 3, aditiva: la lista lee una sola fuente.** `conversation_feed` devuelve también la relación (ya existe en SQL,
`private.relation_of`), el contacto principal con su papel, la ciudad y acepta los filtros de relación, línea y envío.
Así Difusión, Prensa y Todas leen la misma RPC, con el corte primero (patrón de ADR-116) y el `DISTINCT ON` que
ADR-118 dejó propuesto para pasar de ~1.000 conversaciones. **Al redefinir la función, copiar la firma de la base viva
(`pg_get_functiondef`), no de la migración**: otra firma crea una sobrecarga y PostgREST responde 300 (`_context.md`).
Pasa por el gate de § 34 (aditiva: backup, plan, apply).

**Quién la lleva**, si Marco lo quiere (pregunta 5): `conversation.lead_user_id uuid NULL REFERENCES auth.users`,
escrito por RPC (quien edita la conversación; solo un miembro aceptado del espacio que también la lee), sin entrar en
ninguna política de lectura (la regla de la etiqueta: asignar no da acceso). Aditiva.

## 9. Fases

Cada fase se despliega sola y deja la lente coherente.

| Fase | Qué | Migración | Carriles |
|---|---|---|---|
| 0 | ADR: una fila, un orden por defecto, filtros, acciones en bloque. Enmienda ADR-118 (orden de la lista), ADR-134/138 (forma de la lista) | No | Coordinador |
| 1 | `ConversationRow` (desde `FeedLine`) usada por la tabla, el feed y `ThreadFeedRow`; columnas por chip; bolos, lo último y el envío en la fila; `?orden=`; filtros de línea y de envío; fuera el conmutador por contacto (según pregunta 6); el panel plegado en el móvil | No | 1 (`ConversationTable`, `ConversationFeed`, `+page.svelte`, `+server.ts`: todo el mismo carril) |
| 2 | Acciones en bloque: endpoint de lote, barra con las cuatro, deshacer, «las N que coinciden», teclado en la lista | No | 1, detrás de la 1 (mismos ficheros) |
| 3 | `conversation_feed` como única fuente de la lista (relación, contacto, ciudad, filtros); la ruta derivada del Worker queda para el panel | Sí, aditiva, § 34 | 1 |
| 4 | Quién la lleva, si sale «sí» | Sí, aditiva | 1, en paralelo con la 3 si no tocan la misma RPC (si la 3 la añade a la fila, va detrás) |

Total: 3 o 4 carriles más el ADR. Si Marco quiere sentirlo antes, la fase 1 sola ya cambia lo que se ve.

## 10. Riesgos y cómo se prueban

| Riesgo | Por qué importa | Prueba |
|---|---|---|
| Bloque y lista cuentan distinto | ADR-118 § 7 | Unit: la fila, el panel y Desk leen `turnOf`/`dueReason`; un spec por bloque compara cifra y filas |
| El orden nuevo esconde el seguimiento | Lo que apuntaste tú se pierde tras diez respuestas (uso 7) | Unit: en «lo que pide», un seguimiento vencido va antes que una respuesta de hace más de N días (el umbral, a fijar en la fase 1 con los datos de `muk-cia`) |
| Una acción en bloque toca lo que no debe | Privadas ajenas, proyectos sin `edit:conversation` | RLS: el lote con un id de privada ajena o de un proyecto sin edición devuelve fallo en esa fila y no cambia nada; nunca más filas de las pedidas |
| Un lote a medias | 500 PATCH seguidos pueden cortar | El endpoint informa hechas y fallidas; deshacer solo revierte las hechas; unit del endpoint con fallos simulados |
| «Las que coinciden» marca de más | Filtro cambiado entre marcar y actuar | La barra guarda los ids, no el filtro; el texto dice «88 marcadas» y no «todas» |
| Los bolos en la fila filtran dinero | ADR-106 § 1 enmendado por ADR-138 § 3 | RLS de `conversations_bolos` ya existe; E2E: un usuario sin Diners ve el estado y nunca el caché |
| Coste de la página | Bolos y envío por fila | Una llamada por página, no por fila; medir con 1.000 conversaciones en local como ADR-118 |
| E2E escribe en datos reales | El usuario fixture es admin de `muk-cia` | Specs dueños de sus filas en `playwright`; nunca un lote sobre `muk-cia` |
| Literales en componentes | Guard de tokens (vitest, desde el 19-10) | La fila nueva usa los tokens de `FeedLine` y `base.css`; ningún color, px ni duración nuevos |

Suites: `check` 0/0 y `test:unit` en cada fase; `test:rls` en la 2 (endpoint de lote, aunque no hay esquema) y en la
3 y 4; E2E contra un origen desplegado (`PW_BASE_URL`) tras cada deploy: orden, filtro por envío, «no esta vez» a
varias con deshacer, etiquetar a varias.

## 11. Falta decidir

1. **¿Una fila para toda la lente o tabla en Difusión?**
   - **Una fila de dos líneas en todos los chips** (recomendada). La misma sala no cambia de forma al cambiar de chip;
     es la pieza compartida que ADR-139 eligió (P4 A), y quita el problema de la tabla en el móvil.
   - Tabla en Difusión y fila en el resto. Más columnas a la vista en venta, pero dos formas que aprender y una
     incoherencia más en cada cambio de chip.
   - Tabla en todos. Densa y sortable por columna, pero un hilo del equipo no tiene esas columnas.

2. **¿Qué orden por defecto?**
   - **Lo que pide (no leídos, te toca, lo último) en todos los chips, con menú de orden en la URL** (recomendada). La
     pregunta de la lista es a quién escribo; el próximo paso queda a un clic para quien trabaja por agenda.
   - Próximo paso en Difusión, como hoy. Sin cambio de costumbre, pero la respuesta de ayer sigue en mitad de la lista.

3. **¿Qué acciones en bloque entran?**
   - **Las cuatro: no esta vez, etiquetar, siguiente paso y no pide respuesta, además de escribir** (recomendada). Son
     las que hoy obligan a abrir diez fichas; todas reutilizan escrituras que ya existen y no piden esquema.
   - Solo no esta vez y etiquetar. Lo mínimo que pidió el drop; el siguiente paso en bloque se añade si se echa de menos.
   - Ninguna nueva; solo «las N que coinciden» para el envío. Lo más barato, y deja el drop sin hacer.

4. **¿Densidad?**
   - **Una sola, dos líneas** (recomendada). La segunda línea es lo que se dijo y el paso, que es justo lo que falta hoy;
     un modo compacto es otro dibujo que mantener.
   - Un conmutador compacto de una línea, en la URL. Caben el doble de salas; se pierde lo último.

5. **¿Quién la lleva?**
   - **Todavía no** (recomendada). Con Marco y Anouk, y las conversaciones nuevas privadas por defecto (ADR-100), quién
     la creó y la privacidad ya lo dicen; se decide al abrir la beta, con equipos de verdad.
   - Sí, columna `lead_user_id` aditiva (fase 4), con filtro «las mías» y asignar en bloque. Útil en cuanto haya tres
     personas en la difusión; asignar nunca da acceso.

6. **El conmutador «Por conversación · Por contacto»: ¿se queda?**
   - **Sale de la lente; agrupar por persona vive en la ficha de la persona** (recomendada). Es otro dibujo, se recuerda
     en el navegador (lo que ADR-120 § 2 quitó del Planner) y con la conversación por sala (ADR-102) la persona ya no
     es la fila.
   - Se queda como orden «por contacto» del menú. Sin perder nada, con una forma más que dibujar en la fila.

7. **¿Vistas guardadas («Mis salas de Catalunya sin respuesta»)?**
   - **No: la URL es la vista y se comparte copiándola** (recomendada). Todos los filtros ya viajan en la URL; una vista
     guardada es una tabla, una pantalla y un nombre que gestionar.
   - Sí, por persona, como las de Linear o Attio. Útil con muchas campañas; pide esquema y Ajustes.
