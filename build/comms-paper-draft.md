# Comms: borrador en papel

> 2026-10-10. Borrador para reaccionar, sin código y sin decisiones nuevas. Fuentes: ADR-082, 083, 085, 093 y 098,
> `build/structure-model.md`, `_tasks.md § Bloqueado`, la rama `feat/comms-threads` (migración sin aplicar, prototipos,
> review de 32 hallazgos) y `research/product/22-venue-directory-personal-data-legal.md`. Lo que no sale de un documento
> va marcado **[suposición]**.

## 1. Qué problema resuelve

Una compañía como MüK Cia habla con tres grupos de gente, y hoy cada uno vive en una herramienta distinta:

- **Programadores y salas, para vender** (difusión): 154 conversaciones reales de MaMeMi en `muk-cia`. Se escribe por
  correo, se espera semanas, se vuelve a escribir.
- **La sala, para producir** cuando el bolo ya está cerrado: técnico, producción de la sala, horarios, carga, hotel.
- **El equipo propio**: quién va, qué cambia, qué falta. Hoy, WhatsApp.

Comms es que lo hablado quede pegado al dato del que habla, para que dentro de tres meses se pueda saber qué se dijo y
quién lo sabía. Cuatro escenas de una semana. Las tres últimas salen de ejemplos de los propios ADR; el orden y los
detalles de la semana son **[suposición]**.

1. **Lunes, difusión.** Anouk manda la propuesta de MaMeMi a 15 programadores desde su correo. Necesita saber, por
   cada uno, cuándo se mandó qué, y que el siguiente paso no se le pase. Esto es lo que motivó ADR-098: «Contacted
   today» pisaba la fecha anterior.
2. **Miércoles, la respuesta.** La Nau Ivanow contesta que solo tienen domingos (ejemplo de ADR-093). Anouk quiere
   comentarlo con Marco sin reenviarle el correo, y que el comentario quede en esa conversación, no en un chat aparte.
3. **Jueves, el equipo.** Cambia el camión del Antic (ejemplo de ADR-093). Hay que decírselo a los cuatro que van, y a
   nadie más. Hoy es un WhatsApp que nadie encontrará después.
4. **Día de bolo, 8:00.** El técnico de la sala necesita los horarios y el rider, y tiene preguntas. Es «el caso de las
   8 de la mañana» de ADR-085: está dentro de Técnica y Logística de ese bolo, no fuera con un PDF.

## 2. El modelo decidido, sin jerga

Todo lo de esta sección está decidido en grill (ADR-083 y 085, enmiendas del 2026-07-20) y **sin implementar**.

**Un solo mecanismo.** Un *hilo* es una conversación escrita, asíncrona (sin chat en vivo, sin «está escribiendo»), que
cuelga de una cosa de Hour: el espacio, un proyecto, una línea, una función o una conversación de difusión. Igual que una
tarea puede colgar de casi cualquier cosa. No hay «canales»: la propia jerarquía (espacio, proyecto, línea, función) es
la agrupación.

**Cada cosa tiene su tablón.** Dentro de cada contenedor hay:

- **General**: siempre existe; lo leen exactamente los miembros de ese contenedor. No es un permiso, es estar dentro.
- **Hilos por tema** (las *facetas*): Converses, Materials, Tècnica, Logística, Full de ruta, Diners. No todas existen en
  todos los niveles: Full de ruta solo en la función, Logística desde la línea hacia abajo, Diners en todos. Que no
  exista no es que esté prohibida.
- **Hilos libres** con nombre, para lo que no cabe en ninguna faceta, con su lista de gente explícita.

**Quién ve qué.** Una sola regla: lo ven quienes tienen permiso de esa faceta en ese contenedor o en uno de encima, más
los invitados. Si tienes Diners en todo el espacio, lo ves en cada bolo. Encima de cada hilo, una línea que no se pliega
nunca: «Lo ven 5, por permiso de logística». El editor de permisos completo va detrás de una puerta.

**El invitado.** Alguien de fuera (el técnico de la sala) entra sin cuenta, por un enlace, con fecha de fin derivada del
bolo. Escribe, ve el historial completo de los hilos donde está, y lo que escribió se queda al revocarle. Solo puedes dar
lo que tú tienes, y por defecto se da lo mínimo: nadie de fuera ve el caché por herencia.

**Hacia fuera, puente y no casa.** Los programadores nunca entran en Hour (ADR-082 §6). Se les habla por correo y Hour
archiva por BCC (ADR-083 §6, mecanismo de ADR-028).

**La nota privada ya existe** (ADR-093): el post-it del Planner es solo tuyo. Todo lo que se le dice a otro es comms, y
la tabla `note` nació con la forma que un mensaje necesitará.

**Cómo encaja con lo que ya corre.**

- `conversation` es la relación con una contraparte: una persona o una organización, con estado (contactado, en
  conversación, hold, confirmado...). Es 1 a 1 y tiene estado. Un hilo es N a N y no tiene estado.
- `conversation_event` (ADR-098, en producción) es el registro de lo que pasó con fuera: un correo enviado, una llamada,
  con canal, dirección y fecha real. Solo se añade, nunca se edita. Su contrato ya prevé `source = email` y un
  `external_ref` que hace idempotente la captura del mismo correo dos veces.
- Hay una tensión escrita: ADR-083 §1 dice que el log de difusión «pasa a ser hilo colgado de una conversación», pero el
  ADR pendiente de `_tasks.md` («comms sube a la lente Conversations») dice no fusionar las entidades: una lente, dos
  proyecciones, *con quién hablas* (difusión, por contraparte) y *de qué se habla* (interno, por contenedor). ADR-098 se
  construyó como tabla propia, lo que va con la segunda lectura. Lo dejo como pregunta 1.

## 3. Lo que bloquea, en llano

### Bloqueante 1: el invitado no puede entrar

La base puede guardar un invitado, pero nada le deja leer ni escribir: toda la seguridad de Hour pregunta «¿quién eres?»
a partir del login. Los enlaces públicos que existen (road sheet, calendario) son de solo lectura y devuelven una copia
ya filtrada. El invitado escribe, y sería la primera escritura sin login de todo el sistema.

| Opción | Qué implica |
|---|---|
| a. Sin invitado en el primer corte | Solo operadores con cuenta. El técnico de la sala sigue por correo o WhatsApp. Cero riesgo nuevo; la escena 4 queda fuera. |
| b. Enlace firmado con escritura | Copiar el patrón de `workspace_invitation` (token guardado cifrado, caducidad, revocación) y una única puerta de escritura que valide el token. Es una superficie de seguridad nueva que hay que diseñar y probar entera. |
| c. El invitado contesta por correo **[suposición: no está en ningún documento]** | El hilo le llega por email y su respuesta entra por la misma captura de la sección 4. No hay escritura web sin login; a cambio, depende de construir la captura de correo primero. |

### Bloqueante 2: nadie tiene permisos de faceta

Para que alguien vea un hilo de Tècnica tiene que existir una fila que diga «esta persona tiene Tècnica aquí». No hay
nada que escriba esas filas a partir de los paquetes (Mínim, Equip, Coordinació, Direcció). Sin eso, solo los admins ven
hilos de faceta. Y el plan de la migración (mover los permisos actuales a la tabla nueva y tirar las viejas) envejeció:
desde julio los permisos actuales se partieron y de ellos cuelgan 8 políticas de lectura y dos funciones de dinero.

| Opción | Qué implica |
|---|---|
| a. Mover todo el sistema de permisos al modelo nuevo | Una sola fuente de verdad. Es la migración más delicada que ha tenido Hour: toca dinero y funciones, y pide RLS completo y staging. |
| b. Convivir: el modelo nuevo solo para comms | Más rápido. Dos sistemas de permisos que pueden contradecirse; hay que decir cuál manda cuando choquen. |
| c. Primer corte sin facetas | Solo General y libres. Esquiva el bloqueante. **Contradice** el Status de ADR-085 (2026-07-20): Marco decidió hilos con facetas como primera vuelta. |

### Defectos y hallazgos abiertos de la migración

- **Toda membresía de proyecto nacería inerte**: el relleno inicial no marca la aceptación y el control añadido después
  rechaza justo esas filas. Tras aplicar, nadie tendría acceso a nada por proyecto.
- **Cualquier miembro vería la matriz de permisos entera** del espacio (quién tiene Diners y dónde). `main` ya corrigió
  ese patrón en otra tabla; la migración no.
- **El relleno inicial aplana roles** a Equip o Direcció con paquetes vacíos: la vista «de dónde sale cada permiso»
  mentiría.
- **Nada impide conceder una faceta en un nivel donde no existe**: la concesión ilegal queda inerte, pero se puede
  escribir, y la ganancia de seguridad de la tabla por niveles era precisamente impedirla.
- **Un mensaje puede quedar marcado con un espacio distinto al de su hilo**; faltan los candados de «el espacio de una
  fila no cambia» que llevan las otras 13 tablas; los índices permiten dos membresías vivas para la misma persona.
- **Desajuste nuevo que no está en el review** **[observación mía]**: la tabla de facetas habla de «bolo» y
  `structure-model.md` de «performance». Las dos se escribieron antes de ADR-087 (2026-07-23), que separó el bolo
  (trato con una sala, dinero, 1..N funciones) de la función (día y hora). La migración cuelga hilos de la función.
  Diners vive en el bolo y Full de ruta en la función. Ver pregunta 2.

## 4. Primer corte construible

La puerta de ADR-085 sigue: usar una temporada real de difusión antes de construir hilos. Anouk empieza ahora. El corte
que sirve es el que alimenta esa temporada sin abrir ningún bloqueante.

**Lo legal pesa en el correo.** Según el informe del directorio: en España, una propuesta de espectáculo a un
programador es casi seguro comunicación comercial, y la LSSI exige consentimiento previo también entre empresas (AEPD y
Audiencia Nacional). La excepción útil: si la sala pide propuestas por un canal (convocatoria, «envíen dossiers a...»),
el envío está solicitado. Francia permite B2B con información y baja. El informe concluye que Hour no debe ofrecer envíos
masivos a contactos del directorio y que conviene guardar si la sala acepta propuestas y por qué canal. La pregunta 1
para el abogado (si un envío uno a uno cuenta) sigue abierta.

### Opción A (recomendada): registrar lo enviado fuera, por BCC

Anouk sigue escribiendo desde su correo. Pone en copia oculta una dirección de Hour; Hour guarda el correo como
`conversation_event` (`source = email`, `direction = outbound`) en la conversación cuyo contacto coincide, y las
respuestas que reenvíe, como `inbound`. Si no hay coincidencia, queda en una bandeja de «sin asignar» para colocarlo a
mano. Se añade a la conversación un campo de consentimiento: si la sala acepta propuestas y por qué canal.

Por qué primero:

- Responde la escena 1 y la 2 a medias (el registro), que es lo que Anouk necesita ya.
- No toca ningún bloqueante: no hay hilos, ni facetas, ni invitados. Escribe en una tabla que ya existe, con un contrato
  congelado que ya prevé `source`, `external_ref` e idempotencia.
- Lo legal no cambia **[suposición, para el abogado]**: quien envía sigue siendo la compañía, desde su buzón; Hour
  archiva. El campo de consentimiento convierte la recomendación del informe en dato.
- Es la temporada que ADR-085 pide: lo que salga de ahí decide los hilos.

Coste: una entrada de correo en Cloudflare (Email Workers, ya en el stack según ADR-028), el emparejado por dirección y
la bandeja de sin asignar. Riesgo: un correo mal emparejado aparece en la conversación equivocada; la bandeja y el
emparejado solo por coincidencia exacta lo acotan **[suposición]**.

### Opción B: General por conversación, solo para operadores

Un hilo General colgado de cada conversación de difusión, para que Anouk y Marco comenten la respuesta de la Nau Ivanow
ahí (escena 2). Sin facetas ni invitados, con la audiencia de quien ya puede leer la conversación. Cubre lo interno de
difusión. Coste: es la tabla de hilos y mensajes, aunque recortada, y el review avisa de que los hilos colgados de una
conversación pierden la herencia de proyecto y línea (hallazgos 3, 11, 17, 23). Y contradice el «con facetas primero»
del 2026-07-20.

### Opción C: enviar desde Hour

Redactar y enviar desde la ficha, con plantilla. Es lo que más se parece a «comms», y lo que más expone: Hour pasaría a
ser la plataforma que ejecuta el envío comercial, necesitaría el consentimiento previo como condición dura antes de
enviar a un contacto español, y entregabilidad por dominio de cada compañía (SPF, DKIM) **[suposición técnica]**. Hoy Hour
no envía ningún correo desde la app (comprobado: no hay código de envío). No ahora.

**Lo que no haría en ningún corte**: envíos masivos ni plantillas a listas del directorio.

## 5. Preguntas para Marco

Solo las que cambian el diseño.

1. **Lo hablado con fuera, ¿es un hilo o es el registro de la conversación?**
   - a. **Registro** (recomendada): `conversation_event` es lo que pasó con fuera; los hilos son lo que se dice dentro;
     la lente Conversations los enseña juntos. Ya está construido así y es lo que dice el ADR pendiente.
   - b. Hilo: los correos pasan a ser mensajes de un hilo colgado de la conversación, como dice ADR-083 §1 al pie de la
     letra. Una sola forma de leer todo, a cambio de migrar ADR-098.

2. **¿El tablón del día cuelga del bolo o de la función?**
   - a. **Del bolo** (recomendada **[razonamiento mío]**): la sala, el técnico y el contrato son los mismos para las 3
     funciones de un bolo; una conversación, no tres. Full de ruta sigue siendo por función, como documento.
   - b. De la función, como dice `structure-model.md`. Más fino, pero un bolo de tres días son tres tablones con la
     misma gente.
   - c. Según la faceta: Diners en el bolo, el resto en la función. Fiel al dato, más difícil de explicar.

3. **¿Primer corte: difusión o hilos?**
   - a. **Difusión** (recomendada): opción A de la sección 4, y los hilos esperan a la temporada, como pide ADR-085.
   - b. Hilos con facetas sin invitados, como decidiste el 2026-07-20; obliga a resolver el bloqueante 2 antes.
   - c. Las dos, en dos carriles; el de hilos sigue bloqueado por el 2.

4. **¿El invitado entra en el primer corte de hilos?**
   - a. **No** (recomendada): operadores con cuenta primero; el técnico de la sala por correo. Se evita abrir la primera
     escritura sin login.
   - b. Sí, por enlace firmado (bloqueante 1, opción b).
   - c. Sí, pero por correo (bloqueante 1, opción c), cuando exista la captura.

5. **La dirección de captura: ¿una por espacio o una por conversación?**
   - a. **Una por espacio** (recomendada): Anouk pone siempre la misma en BCC y Hour empareja por destinatario. Cambia lo
     que decidió ADR-028 (una por conversación).
   - b. Una por conversación, como ADR-028: emparejado exacto, pero hay que copiar una dirección distinta en cada envío.
