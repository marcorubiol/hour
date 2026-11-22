# Sincronización con Apple Calendar y Google Calendar: el plan

Hilo «Planear la sincronización con Apple y Google Calendar», 22-11-2026. Es un plan, sin código.
Parte de ADR-240 (20-11: «entra, cada persona con su cuenta»), ADR-054 (el feed `.ics` de hoy), ADR-016 (el calendario
de Hour es el de verdad; lo de fuera es un puente) y ADR-151 («lo mío / todo»).

## 1. La idea en una frase

Hour escribe **lo tuyo** en **un calendario llamado «Hour»** dentro de tu cuenta de Apple o de Google, lo mantiene al día
solo, y a cambio lee de tus otros calendarios **cuándo estás ocupado**. Hour manda sobre lo que es de Hour; tu calendario
manda sobre lo que es tuyo.

Eso es «bidireccional» de la forma que no se rompe. No es un espejo de dos calendarios iguales: un espejo completo
obligaría a decidir en cada cambio quién tiene razón, y un bolo movido por error desde el teléfono movería la función
a toda la compañía.

## 2. Qué tipo de sincronización, y por qué

### 2.1 Qué sale de Hour hacia tu calendario

| Sale | Cómo | Por qué |
|---|---|---|
| Funciones confirmadas en las que estás | Un evento por función | Es el compromiso que no puede faltar |
| Opciones (`hold`) y funciones a las que te han convocado y no has contestado | Evento provisional, con «· opción» o «· por contestar» en el título | Reservan el día; ver pregunta 2 |
| Ensayos, residencias, prensa, otras fechas | Un evento por fecha | Son tu agenda real |
| Viajes | Un evento por viaje, de la primera salida a la última llegada, con los tramos dentro | Un evento por tramo llenaría el día |
| Días libres | Evento de día entero, marcado como libre | Informa sin bloquear |

«En las que estás» es la regla que ya existe (`private.person_is_on_performance`, ADR-151): reparto, equipo técnico o tu
«voy». Por espacio, el calendario sigue lo que ya elegiste en Ajustes («Lo mío» o «Todo»), con una tercera opción,
«Nada», para un espacio que no quieres en tu calendario. No se inventa otro interruptor.

| No sale | Por qué |
|---|---|
| Tareas | Una tarea sin hora en un calendario es ruido; su sitio es «Te espera» |
| Seguimientos de conversaciones, envíos | No son tiempo tuyo, son trabajo pendiente |
| Dinero: cachés, cobros, vencimientos de factura | ADR-054: nunca dinero fuera de Hour |
| Notas internas, localizadores de reserva, datos de otras personas | ADR-054, y un calendario se comparte y se ve en pantallas bloqueadas |
| Cada momento de la escaleta como evento | Serían seis eventos por bolo; van como líneas dentro del evento |
| Funciones canceladas, o en las que dijiste «no puedo» | Se quitan del calendario |

### 2.2 Qué vuelve de tu calendario a Hour

Tres cosas posibles, de menos a más riesgo. Recomiendo construir la primera, dejar la segunda para después y no hacer
la tercera.

1. **Tu tiempo ocupado (recomendado, fase 3).** Eliges qué calendarios tuyos cuentan (Personal, Familia…). Hour lee solo
   *cuándo* estás ocupado, nunca el título ni el sitio. Con eso, quien planifica ve «Marco tiene algo ese día» al
   convocarte, y tú ves el choque en tu Día. Es lo que hoy tecleas a mano en «Días que no puedo» (`availability_block`).
   Un evento de día entero o de varios días cuenta como día que no puedes; uno de dos horas es solo un aviso de choque.
2. **Cambios hechos en el calendario sobre un evento de Hour, como propuesta (fase 4, opcional).** Si mueves un ensayo
   desde Apple Calendar y tienes permiso para editarlo en Hour, aparece una fila en «Te espera»: «Moviste el ensayo del
   jueves a las 17h en tu calendario · Aplicar · Descartar». Nada cambia para los demás sin ese toque. Encaja con la
   regla de la casa: alguien propone, una persona aprueba, el sistema ejecuta.
3. **Edición directa (no recomendado).** Lo que cambias en el calendario cambia en Hour sin preguntar. Las horas de una
   función viven en el documento colaborativo (ADR-090 P2) y un arrastre accidental en el teléfono las movería para
   todos. Tampoco hay forma limpia de saber a qué proyecto pertenece un evento nuevo creado en el calendario.

### 2.3 Qué pasa al editar o borrar en cada lado

| Haces esto | Pasa esto |
|---|---|
| Cambias algo en Hour | El evento se actualiza en tu calendario en la siguiente pasada (minutos) |
| Se cancela en Hour, te quitan del reparto o dices «no puedo» | El evento desaparece de tu calendario |
| Editas en el calendario un evento de Hour | Hour lo deja como estaba en la siguiente pasada (y en la fase 4, te lo propone antes) |
| Borras en el calendario un evento de Hour | Hour lo vuelve a poner. La forma de decir que no vas es «No puedo» en Hour. Un bolo que falta en el calendario es el peor fallo posible |
| Lo mueves a otro calendario tuyo | Para Hour es un borrado: lo repone en «Hour» y tu copia queda suelta |
| Creas un evento nuevo dentro del calendario «Hour» | Hour no lo toca ni lo importa. Se avisa una vez al conectar: «este calendario lo escribe Hour» |
| Desconectas | Hour borra el calendario «Hour» entero de tu cuenta y olvida la credencial y lo leído |
| La credencial deja de valer (en Apple pasa al cambiar la contraseña de la cuenta) | La conexión queda en pausa, con una sola fila en «Te espera»: «Tu calendario dejó de actualizarse · Reconectar». Es de lo poco que merece aviso |

Regla de conflicto, una sola: **en el calendario «Hour» gana Hour; en el resto de tus calendarios Hour solo lee.** Para
no pisar ni entrar en bucle, Hour guarda de cada evento su versión remota (`etag`) y una huella de lo último que
escribió; un cambio remoto cuya huella coincide es el eco de su propia escritura y se ignora.

## 3. Protocolo

### 3.1 Apple (iCloud)

| Vía | Qué da | Coste | Veredicto |
|---|---|---|---|
| **Suscripción `.ics` por usuario** | Solo lectura. Apple refresca cuando quiere (de minutos a horas) | Casi hecho: el feed de ADR-054 ya tiene «solo lo mío», falta que cruce espacios | Fase 1, como base y como salida para quien no quiera dar credenciales |
| **CalDAV contra iCloud** | Lectura y escritura reales | El usuario crea una «contraseña de app» en account.apple.com (pide doble factor) y la pega en Hour. No hay aviso de cambios: hay que preguntar cada pocos minutos | **La vía para lo bidireccional. Fase 2** |
| OAuth de iCloud | Lo mismo sin contraseña de app | Apple lo tiene como programa piloto con formulario de interés, para equipos de pago del programa de desarrolladores, sin garantía de entrar | Pedirlo, no depender de él |
| EventKit (app nativa) | Acceso local al calendario | Hour es una web instalable, no una app nativa | Fuera |

Lo que hay que saber de la contraseña de app, sin adornos:
- No es solo de calendario: abre también el correo y los contactos de iCloud por sus protocolos. Hour solo hablaría con
  `caldav.icloud.com`, pero la confianza que se pide es mayor que con Google. Para ti y tu equipo vale; para la beta
  externa hay que explicarlo bien o esperar al OAuth de Apple.
- Muere cuando cambias la contraseña de tu cuenta de Apple. De ahí la fila «Reconectar».
- Se guarda cifrada (AES-256-GCM, como los buzones de ADR-099, con una clave propia en Wrangler), nunca viaja al
  navegador ni a un log. El repo es público: la clave nunca en git.

Esto **enmienda ADR-240 § 3**, que dejaba fuera el CalDAV de escritura. Pide ADR nuevo cuando lo apruebes.

### 3.2 Google

Google Calendar API v3 con OAuth. Tres piezas:
- **Escribir:** el permiso `calendar.app.created` («crear calendarios secundarios y gestionar los eventos que hay en
  ellos»). Hour no puede tocar tu calendario principal ni leer tus eventos con él. Es el permiso mínimo exacto.
- **Leer ocupado:** `calendar.events.freebusy` o `calendar.freebusy` (solo disponibilidad, sin títulos), más
  `calendar.calendarlist.readonly` para que elijas qué calendarios cuentan.
- **Enterarse de cambios:** canales `watch`. Google llama a Hour cuando algo cambia, pero la llamada solo dice «algo
  cambió»: hay que pedir los cambios con `syncToken`. Los canales caducan y no se renuevan solos, y Google avisa de que
  no son fiables al cien por cien, así que hace falta igualmente una pasada periódica.

Consentimiento aparte del de Buzones (Gmail), pedido solo al conectar el calendario. Por comprobar antes de construir:
en qué categoría de verificación de Google cae cada permiso (la página de permisos no lo dice; hay que mirarlo en la
consola del proyecto de Google).

### 3.3 Un motor, dos adaptadores

```
Hour (funciones, fechas, «voy»)
   │  cambia algo → cola (pgmq, ya existe)
   ▼
Motor de sincronización (Worker, en los cron que ya hay)
   · qué eventos le tocan a esta persona  (función pura, la misma que alimenta el .ics)
   · comparar con lo último escrito       (huella por evento)
   · crear / actualizar / borrar
   ▼
Adaptador CalDAV ──► iCloud (y de regalo Fastmail, Nextcloud…)
Adaptador Google ──► Google Calendar API
```

El evento se modela **una vez**, en el formato neutro que ya usa `$lib/ics.ts` (`VEvent`), y cada adaptador lo traduce.
Así Apple y Google enseñan lo mismo y Outlook, si llega, es un tercer adaptador.

Ritmo: Hour → calendario, al minuto (el cron de un minuto que ya vacía la cola de envíos). Calendario → Hour: Google
casi al momento por `watch`; iCloud cada 10 minutos (el cron que ya existe). Límite a vigilar: Workers Free admite 5
crons por cuenta (se reutilizan los dos que hay) y 50 llamadas salientes por invocación, así que las conexiones se
procesan por tandas.

## 4. Cómo se modela el evento

### 4.1 Campos que usamos

| Campo | Qué ponemos | Nota |
|---|---|---|
| Identificador (`UID`) | `perf-<id>@hour.zerosense.studio`, `date-<id>@…` | Los de ADR-054; estables para siempre |
| Título | `Proyecto · Sala o ciudad`, y la hora de función si el bloque es la jornada (pregunta 3). Provisional: `· opción` o `· por contestar` | Sin guiones largos, regla de la casa |
| Inicio y fin | Con hora si la hay; si no, día entero. Fin por defecto: 2 h después | Lo de hoy en `ics.ts` |
| Zona horaria | La de la sala; la del espacio si la sala no tiene | Hoy el feed manda todo en UTC; al escribir conviene la zona real para que el evento no baile al viajar |
| Lugar | Sala, dirección, ciudad, país, en texto | Apple y Google lo convierten solos en mapa. Más adelante, coordenadas para el «hora de salir» de Apple |
| Notas | La escaleta en líneas («carga 15h»), los tramos del viaje, y «Abrir en Hour» con el enlace al pase | Nunca caché, notas internas, localizadores ni personas |
| Enlace (`URL`) | El pase de la función; para una fecha, su Día | Google no tiene campo de enlace: va en las notas y en `source` |
| Estado | Confirmado o provisional | Cancelado no se marca: se borra |
| Ocupado o libre | Ocupado, salvo los días libres | |
| Versión (`SEQUENCE`, `LAST-MODIFIED`) | Sube con cada cambio | Para que los clientes refresquen bien |

### 4.2 Campos que no usamos, a propósito

| Campo | Por qué no |
|---|---|
| **Invitados y organizador** | Añadir invitados hace que Apple y Google manden correos de invitación y enseña los correos de los demás. Cada persona recibe su propia copia desde su propia conexión. La convocatoria sigue siendo «Voy / No puedo» en Hour |
| **Repetición (`RRULE`)** | Una serie de ensayos en Hour son filas sueltas, cada una con su estado. Un evento por fila. Al leer tu ocupado sí hay que desplegar las repeticiones de tus eventos |
| **Alarmas** | Por defecto, ninguna (pregunta 4). Hour no debe añadir ruido a tu teléfono sin que lo pidas |
| Adjuntos, videollamada, categorías, colores por evento | El color es el del calendario «Hour», que eliges en tu app. Los ficheros viven en el pase |
| Varios calendarios (uno por espacio, uno para opciones) | Un solo calendario «Hour». Menos cosas que encender y apagar. Si un día hace falta separar, se añade sin romper nada |

### 4.3 Lo que Hour guarda (boceto, para estimar; se cierra al construir)

- `calendar_connection`: de quién es, proveedor (`icloud`, `google`), credencial cifrada, cuál es el calendario «Hour»,
  marca de sincronización, estado (`ok`, `pausada`), última pasada y último error.
- `calendar_event_link`: conexión, función o fecha de Hour, identificador y versión remotos, huella de lo último escrito.
- `calendar_busy`: conexión, desde, hasta, día entero. Sin título ni lugar. Se borra al desconectar.
- Las tres, cerradas por RLS (cada persona solo lo suyo) y escritas solo desde el Worker. Toca permisos: la puerta
  entera (check, unit, RLS completa y E2E contra el desplegado), migración por su carril (§ 34) y `CACHE_SCHEMA` si
  cambia lo que guarda el dispositivo (los choques nuevos en el Día y en el Planificador lo cambiarán).

## 5. Fases, en serie

| Fase | Qué entrega | Se nota en |
|---|---|---|
| **0. Prueba técnica** (corta, con tu cuenta) | Confirmar desde un Worker contra tu iCloud: descubrir la cuenta, crear el calendario, escribir, leer cambios (`sync-collection`), zonas horarias y alarmas. Pedir a Apple el OAuth piloto. Mirar la categoría de los permisos de Google | Nada visible; quita el riesgo |
| **1. «Mi calendario» por suscripción** | El conjunto de eventos de una persona cruzando espacios, como función pura con tests, servido como `.ics` personal con enlace revocable y con caducidad | Ajustes › Calendario: un enlace. Sirve ya a cualquiera, también Outlook |
| **2. Apple, de Hour al calendario** | Conectar iCloud, calendario «Hour», crear, actualizar y borrar, reponer lo borrado, pausa y reconexión, desconectar | Tu iPhone y tu Mac, en minutos |
| **3. Vuelve tu ocupado** | Elegir calendarios, leer ocupado, choques en el Día y al convocar, días enteros como «no puedo» | Planificador y Día |
| **4. Cambios como propuesta** | La fila «Aplicar · Descartar» en «Te espera», solo para fechas (ensayos, viajes), no para funciones | Te espera |
| **5. Google** | El segundo adaptador: OAuth propio, `watch`, `syncToken`. Lo demás ya está hecho | Ajustes › Calendario: un segundo botón |

La pantalla es una sola, Ajustes › Calendario: un botón que manda («Conectar Apple Calendar»), debajo el estado en una
línea («Al día · hace 3 min») y, plegado, qué espacios entran y qué calendarios cuentan como ocupado.

## 6. Lo que queda abierto y no es tuyo

- Si el `fetch` de Workers acepta los verbos de CalDAV (`PROPFIND`, `REPORT`, `MKCALENDAR`) contra iCloud: fase 0.
- Si iCloud respeta `sync-collection` como las bibliotecas dicen: fase 0. Si no, comparación por `etag`, más lenta.
- Categoría de verificación de los permisos de Google: fase 0.
- Qué plan lo incluye (ADR de precios: STANDARD). Sigue abierto desde ADR-240; no bloquea mientras Hour no cobre.

## 7. Lo que Marco decidió (22-11-2026: «Sí a todo»)

1. **Qué vuelve del calendario.** Tu ocupado (fase 3) y, después, tus cambios sobre fechas de Hour como propuesta que
   apruebas en «Te espera» (fase 4). Sin edición directa.
2. **Opciones y convocatorias sin contestar.** Entran como provisionales, en el mismo calendario «Hour».
3. **El bloque de una función.** La jornada entera, de la citación a la recogida, con la hora de función en el título.
4. **Avisos.** Ninguno por defecto; una sola elección al conectar («la víspera» o «2 h antes»).
5. **Contraseña de app de Apple.** Hour la guarda cifrada. La prueba de la fase 0 se hace con la cuenta de Marco; la
   contraseña la pone él en su Mac (Keychain o un `.env` fuera de git), nunca en un chat ni en el repo.

Lectura del «sí» en la pregunta 1, que era una disyuntiva: entra lo recomendado y también la fase 4. Si Marco quería
solo el ocupado, la fase 4 se cae sin tocar las demás.
