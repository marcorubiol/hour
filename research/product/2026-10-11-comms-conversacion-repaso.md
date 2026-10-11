# Comms: repaso del panel «Conversación» de la maqueta

> 2026-10-11. Encargo de `_tasks.md` (Comms, carril 1): mirar a fondo qué datos lleva el primer panel de la maqueta
> (`/h/prototype/comms?vista=conversacion`, rama `claude/comms-mock`, `e377a13`) y dejarlo más bonito. Rama de este
> repaso: `claude/comms-conversation-review`. Solo toca `apps/web/src/routes/h/prototype/comms/` (`ConversationMock.svelte`
> y `data.ts`); el tablón y los buzones no cambian. Datos inventados, nada habla con el servidor.

## 1. La pregunta del panel

Quien abre una conversación de difusión (Anouk, con un programador) quiere saber, por este orden:

1. **Dónde estamos y qué toca**: el siguiente paso con su fecha, y si la pelota está en nuestro lado o en el suyo.
2. **Qué hay en juego**: las fechas, cuántas funciones, el caché y en qué estado está el trato.
3. **Qué se dijo**: el registro con fuera, y lo que el equipo ha comentado por dentro.
4. **Con quién hablo**: la persona, cómo localizarla, si acepta propuestas y por qué canal.

La maqueta original contestaba bien la 3 y a medias la 1 (en un lateral que en el móvil quedaba debajo de los siete
correos). La 2 no aparecía: el trato estaba solo dentro del texto de los correos, aunque el modelo ya lo tiene (ADR-087:
conversación, bolo, función).

## 2. Auditoría de datos

Columnas: **Modelo** (existe hoy en el schema de producción), **Antes** (salía en la maqueta `e377a13`), **Después**
(sale en esta rama), **Dónde y peso**.

| Dato | Modelo | Antes | Después | Dónde y peso |
|---|---|---|---|---|
| Organización (contraparte) | Sí, indirecto: `workspace_person.organization_id` a `workspace_organization` (y el texto `person.organization_name`). La conversación no la apunta. | Título | Título | Título del panel. Máximo. |
| Tipo de organización | Sí: `workspace_organization.kind` | No | Contacto | Bajo, junto al nombre. |
| Persona | Sí: `conversation.person_id` (NOT NULL, único por proyecto) | Subtítulo | Subtítulo y Contacto | Alto. |
| Papel en esta conversación | Sí: `conversation.role` | Subtítulo | Subtítulo | Medio. |
| Correo y teléfono | Sí: `workspace_person.email`, `.phone` (y `person`) | Solo en las cabeceras del correo | Contacto | Medio: para llamar sin salir de la ficha. |
| Ciudad | Sí: `person.city`, `workspace_organization.city` | Subtítulo | Subtítulo | Bajo. |
| Proyecto y línea | Sí: `conversation.project_id`, `line_id` | Antetítulo | Antetítulo | Bajo, contexto. |
| Estado de la conversación | Sí: `conversation.status` (7 valores) | Badge con tono inventado (`warning`) | Badge con su clase de siempre (`statusBadgeClass`) | Alto, en el subtítulo. |
| Siguiente paso y fecha | Sí: `next_action_note`, `next_action_at` | Lateral | Primera celda de la situación, en tinta | Máximo. |
| Turno (a quién le toca) | Derivable: dirección del último evento del registro | No | Situación («Toca responder», «su último correo es de hace 4 días») | Alto. No se guarda: se deriva. |
| Último y primer contacto | Sí: `last_contacted_at`, `first_contacted_at` | Solo el último | Los dos | Medio. |
| Quién la lleva | **No existe.** Solo `created_by`. | Lateral («Lleva») | Situación («La lleva») | Alto. Falta una columna de responsable. |
| Bolo en juego | Sí: `bolo.conversation_id`, `bolo.status` (`performance_status`), `fee_amount`, `fee_currency`, `venue_name` | No | Bloque «En juego», arriba del lateral y encima del registro en el móvil | Alto. Es la razón de la conversación. |
| Fechas y funciones en juego | Sí: `performance.bolo_id` / `conversation_id`, `performed_at`, `status` (hold_1..3) | No | «En juego», con el grano de la duda del Planner si está en opción | Alto. |
| Sala y aforo | Sí: `performance.venue_id` a `venue` (`capacity`); el bolo solo tiene `venue_name` texto | No | «En juego» | Medio. El aforo pesa en MaMeMi (60). |
| Conflicto de calendario en esas fechas | Derivable (Planner: funciones y `availability_block`) | Solo en un comentario de Marco | No (pendiente) | Alto cuando lo haya; marcar la fecha que choca. |
| Material ya enviado (dossier, rider, ficha) | **Parcial.** `asset_version` tiene `kind` (dossier, rider, tech_sheet…) y `direction`, pero ni él ni `conversation_event` se enlazan: el contrato deja los adjuntos fuera. | Solo en el texto | Línea de adjuntos en cada correo y «Enviado» en «En juego» | Medio. «¿Qué le hemos mandado ya?» es pregunta diaria en difusión. |
| Registro con fuera | Sí: `conversation_event` (kind, source, direction, occurred_at, body, participants) | Lista | Lista con una sola rejilla | Máximo (columna principal). |
| Asunto del correo | No canónico: iría en `metadata` | Sí | Sí | Alto en correos. |
| Buzón por el que entró | **No existe** (ADR-099 §2 y §9, por construir; iría en `metadata` más una tabla de buzones conectados) | Etiqueta de color en cada fila y leyenda | Solo cuando no es el de quien la lleva, en cursiva tenue; «Entra por…» bajo la cabecera; «Buzón» dentro del correo abierto | Bajo: es procedencia, no contenido. |
| Nota de la persona («deja Pradillo en enero») | Sí: `workspace_person.notes` | Como evento `note` en el registro con fuera | Contacto, como nota del dossier | Medio. No es algo hablado con fuera: es un dato de la persona. |
| Otras personas de la misma organización | Derivable vía `workspace_person.organization_id` | No | Contacto («También en Teatro Pradillo») | Bajo. |
| Si acepta propuestas y por qué canal | **No existe.** Lo pide el informe legal (`22-venue-directory-personal-data-legal.md`, LSSI) | No | Contacto | Medio; legal. |
| Privacidad de la conversación | **No existe** (ADR-099 §4, decidido) | Interruptor aparte | Un solo bloque «La ven 3 en MüK Cia / Privada» | Bajo, al final. |
| Audiencia («la ven 3») | Derivable de permisos | Dos veces (bajo «Por dentro» y en la privacidad) | Una vez | Bajo. Es el mismo hecho (ADR-099 §4). |
| Comentarios del equipo | **No existe**: hilos y mensajes son el carril 2 (`note` es privada por ADR-093) | «Por dentro» | «Por dentro» | Alto. |
| Etiquetas | Sí: `conversation.custom_fields.tags` | No | No | Bajo; no lo añadí. |

### Lo que falta en el modelo, por importancia

1. **La contraparte es una persona, no una organización.** `conversation` tiene `person_id` NOT NULL y es única por
   `(workspace, project, person)`. La maqueta titula con la organización, y su propia historia lo rompe: Inés deja
   Pradillo en enero y lo lleva Jordi Sastre. Con el modelo actual eso es otra conversación, y la relación con Pradillo
   (fechas, bolo, lo dicho) se queda colgada de Inés. El borrador en papel dice «una persona o una organización»; el
   schema no. Es la decisión de modelo más grande que destapa este panel, y es previa a construir el buzón (el
   emparejado por dirección va a persona).
2. **Quién la lleva.** No hay responsable; solo `created_by`. Con dos personas en difusión (Anouk y Marco) y buzones
   compartidos hace falta.
3. **Privada** (ADR-099 §4) y **consentimiento / canal** (LSSI): dos columnas nuevas de `conversation`.
4. **Adjuntos**: enlazar un evento con los `asset_version` que llevó, para saber qué material tiene ya cada sala.
5. **Buzón**: de dónde vino cada correo (ADR-099, ya previsto).

Lo que no hace falta guardar: el turno, la audiencia, los conflictos de fecha y las otras personas de la organización se
derivan.

## 3. Direcciones de diseño

### A. La situación arriba y el trato al lado (recomendada, implementada)

Bajo el título, una franja de cuatro hechos sin cajas, entre dos filetes: siguiente paso (en tinta), turno, último
contacto, quién la lleva. Columna principal: el registro. Lateral: **En juego** (el bolo con sus días, el grano de la duda
de `certainty.css` si está en opción, `StateBadge` con el tono de `performanceStatusTone`, caché, sala, material
enviado), **Por dentro**, **Contacto** y **La ven 3 / Privada**. En una columna el lateral se deshace (`display:
contents`) y cada bloque toma su sitio: el trato sube encima del registro, el contacto y la privacidad bajan al final.

Por qué: contesta las preguntas en el orden en que se hacen; saca el trato del texto de los correos y lo pone donde el
modelo ya lo tiene; y todo sale de piezas que existen (clases de estado de `base.css`, `StateBadge`, `.grain`, Avatar,
Button), sin color nuevo.

### B. Ficha a la izquierda, registro a la derecha

Como un cliente de correo con panel de contacto: una columna fija con persona, organización, trato y estado, y el
registro ocupando el resto. Estable y conocida. Contra: el siguiente paso pierde la primera línea, y en el móvil la ficha
empuja el registro hacia abajo igual que antes.

### C. Una sola columna, el registro como hilo con margen

Todo apilado; el registro y lo de dentro en una línea temporal, con lo de dentro como notas al margen sangradas. Es la
lectura «hilo» llevada al final. Contra: mezcla dos audiencias en un solo flujo, que es justo lo que ADR-099 §5 dejó
como provisional, y diluye el trato.

### Cambios finos dentro del registro (en A)

- Una sola rejilla para todas las filas: a la izquierda cuándo y qué (`7 oct · 11h20`, «Correo recibido»), a la derecha
  lo que se dijo. Antes correo, llamada y nota tenían ritmos distintos.
- La hora con el reloj del Planner (`11h20`, no `11:20`).
- Lo que llega de fuera pesa más que lo que sale (rótulo y asunto en tinta; lo enviado, en peso normal).
- Fuera las etiquetas de color de buzón (beige y azul): un buzón es procedencia, no contenido. Se nombra solo cuando no
  es el de quien la lleva.
- Adjuntos visibles en la fila plegada.
- La nota sobre Inés sale del registro con fuera y pasa al contacto.

## 4. Capturas

En `/private/tmp/claude-501/-Users-marcorubiol-Developer-hour/9dbacca4-fedc-468a-a698-eeb9cf4e4b4a/scratchpad/comms-review/`
(scratchpad de la sesión, no van a git):

- Antes: `antes-{desktop,mobile}-{light,dark}.png` y `antes-hilo-…` (lectura «todo en un hilo»).
- Después: `despues-{desktop,mobile}-{light,dark}.png` y `despues-hilo-…`.

Hechas con `vite dev` local desde el worktree, contra la Supabase local con el usuario fixture, y la Playwright del repo
con `chromium_headless_shell-1228`.

## 5. Lo que queda abierto

- Que Marco decida la dirección (A recomendada) y si la contraparte pasa a poder ser una organización (punto 1 de lo
  que falta). Sin eso, el título del panel promete algo que el modelo no guarda.
- «En 6 días» y el turno se calculan contra un «hoy» fijo de la maqueta (`TODAY` en `data.ts`).
- El conflicto de calendario en las fechas en juego no está dibujado.
- Sin E2E ni RLS: es una ruta de prototipo sin servidor.
