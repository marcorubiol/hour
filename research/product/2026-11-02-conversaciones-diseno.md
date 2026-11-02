# Conversaciones: diagnóstico y tres direcciones (punto 110)

> 2026-11-02. Encargo de diseño, sin código. Marco (drop 02-11): «el diseño general de conversaciones no funciona. no
> sé dónde mirar, no sé qué es conversación y qué no es conversación». Primero el diagnóstico, después tres
> direcciones; elige Marco y después se construye.

## Cómo se miró

- Capturas con Playwright contra producción (`hour-web.marco-rubiol.workers.dev`, mismo Worker que
  `hour.zerosense.studio`; la sesión de `.playwright/auth.json` sólo lleva cookie para ese origen), sólo lectura: el
  script aborta cualquier petición que no sea GET. Escritorio 1440 y móvil 390.
- Usuario del E2E, espacio `playwright`: datos sintéticos (fixtures, `ZZZ …`) y la interfaz en inglés (idioma de ese
  usuario). Sirve para ver la estructura, no la densidad real. **Falta mirarlo con `muk-cia`** (154 conversaciones
  reales, líneas de verdad, envíos hechos): esta sesión no tiene esa cuenta y no se buscó otra.
- Capturas en `/private/tmp/claude-501/conv-design/` (fuera de git), `-d` escritorio y `-m` móvil:

| Fichero | Qué |
|---|---|
| `01-todas` | chip Todas (la portada de la lente) |
| `02-difusion` | chip Difusión (Venues en inglés) |
| `03-prensa`, `04-coproduccion`, `05-distribucion` | chips de etiqueta |
| `06-equipo` | chip Equipo (hilos) |
| `07-publico` | chip Público (listas e invitaciones) |
| `08-ficha` | ficha de una conversación |
| `09-envio` | un envío (una invitación en borrador) |
| `10-lista` | una lista del público |

Leído además: `build/structure-model.md`, `_context.md` § Modelo, ADR-088, 117, 118, 134, 135, 138, 142, 173, 174,
175, y `apps/web/src/routes/h/conversations/+page.svelte` (su comentario de cabecera describe bien el estado).

## 1. Diagnóstico

### Qué objetos conviven hoy en la lente

| Objeto | Qué es | ¿Conversación? | Dónde aparece hoy |
|---|---|---|---|
| Conversación con fuera | diálogo con una sala, una persona de prensa, una coproductora; lleva etiquetas (ADR-138) | **Sí**: va y vuelve | Todas, cada chip de etiqueta, su ficha |
| Hilo del equipo | lo que el equipo habla dentro, colgado de la conversación, un contenedor o una faceta (ADR-106, 116, 142) | **Sí**: va y vuelve, pero dentro | chip Equipo, mezclado en Todas (`conversation_feed`), y otra vez como panel «Team» y pestaña «Thread» dentro de la ficha |
| Envío de difusión | un correo a muchas salas a la vez (ADR-108 a 115) | **No**: sale a muchos; sus respuestas entran en las conversaciones | sin sitio propio: el bloque «Último envío» del panel de Difusión y el desplegable «Mailout» de la lista de Difusión (los diez últimos) |
| Invitación | un envío de `kind = 'invitation'` a una lista del público y/o a profesionales (ADR-173 § 9 y 10) | **No** | bajo el chip Público, «Latest invitations»; se crea también desde la selección de Difusión («Invitar a N») |
| Lista del público | un conjunto de suscripciones con consentimiento, su formulario, sus textos legales, su importación (ADR-173) | **No**: es una audiencia, casi configuración | bajo el chip Público |
| Suscripción | una persona del público en una lista | **No**, y por diseño no se enlaza con un contacto (ADR-173 § 7) | dentro de la lista |

Dos son conversaciones, cuatro no. Las cuatro que no lo son tienen algo en común: **salen a muchos**. Y la lente
que se llama Conversaciones las aloja todas con el mismo peso.

### Por qué no se sabe dónde mirar

1. **La fila de chips mezcla tres ejes en una sola línea** (`01-todas-d`, `07-publico-d`): «All · Venues · Press ·
   Co-production · Distribution · ZZZ RLS settings · Team · Audience ·». Las etiquetas son un filtro de
   conversaciones; Equipo es otra entidad (hilos, ADR-138 § 1: «un chip más que no se pone ni se quita»); Público es
   otro dominio (listas y envíos). Mismo tamaño, mismo separador: se leen como una dimensión y no lo son. En una
   lista de etiquetas, Equipo y Público parecen etiquetas.
2. **Cada chip es una pantalla distinta bajo la misma cabecera.** Todas y Prensa: bloque «We owe a reply» y una
   lista de filas sin estado (`01`, `03`). Difusión: temporada por línea, siete controles, tabla con columna de
   estado y notas (`02`). Equipo: un feed de hilos, aquí vacío en una línea (`06`). Público: dos listas de enlaces
   subrayados y un botón negro (`07`). Cinco formas de fila, cinco paneles: cambiar de chip no filtra, cambia de
   aplicación. Es lo que ADR-138 § 2 decidió («el panel sigue al chip») y es la raíz del «no sé dónde mirar».
3. **La portada (Todas) no es la que tiene la información.** El panel con más señal (temporada, estados, último envío)
   sólo existe en Difusión. Todas repite la etiqueta «Venues» en casi todas las filas (`01-todas-d`: 30 de 31) y no
   enseña estado, así que mirando Todas no se sabe cómo va nada.
4. **Los envíos no tienen casa.** Un envío de difusión hecho hace tres semanas sólo se encuentra eligiéndolo en un
   desplegable de filtro llamado «Mailout: None» (`02-difusion-d`). Una invitación a profesionales, que es casi lo
   mismo que un envío de difusión (mismo dominio, misma base, deja evento en la conversación, ADR-173 § 10), vive bajo
   Público. Dos cosas de la misma tabla (`mailout`) en dos sitios distintos según su `kind`.
5. **Al abrir algo, la lente se pierde.** En la ficha, el envío y la lista (`08`, `09`, `10`) la píldora
   «Conversations» de la barra deja de estar marcada; la ficha tiene migas («playwright › ZZZ e2e collab ›
   Conversation»), el envío sólo un rótulo «INVITATION» y la lista un enlace «AUDIENCE». Tres formas de decir «estás
   dentro de Conversaciones», ninguna completa.
6. **El equipo aparece tres veces y con dos nombres por ficha.** Chip Equipo en la lente; en la ficha, pestaña
   «Record · Thread» y además un panel lateral «Team · 0» con «Write in Team» (`08-ficha-d`). Mismo objeto, tres
   entradas.
7. **Móvil** (`01-todas-m`): los chips ocupan tres líneas y «Go to the list» cae en medio de ellos como si fuera uno
   más. Las conclusiones de 1 a 3 pesan el doble en 390 px.
8. **Menor:** «We owe a reply» sale como bloque arriba y otra vez como rótulo de la primera fila, en la misma pantalla.

La respuesta corta a «¿qué es conversación y qué no?»: **conversación es lo que va y vuelve con alguien** (con fuera o
dentro); **lo que sale a muchos no lo es** (envío, invitación, lista). Hoy la lente no hace esa distinción en ningún
sitio visible. Las tres direcciones la hacen; difieren en dónde ponen lo que no es conversación.

## 2. Direcciones

Arreglos que valen para las tres y no cuentan como dirección: la píldora de la lente marcada en ficha, envío y lista,
con las mismas migas en las tres; el equipo con una sola entrada en la ficha; en móvil, nada de enlaces sueltos en la
fila de filtros.

### A. Hablar y enviar (recomendada)

Boceto: `sketch-A-hablar-y-enviar.html` (y `.png`).

- **Navegación.** Dos vistas en la cabecera de la lente, por el verbo: **Conversaciones** (lo que va y vuelve) y
  **Envíos** (lo que sale a muchos). La lente sigue siendo una y sigue llamándose Conversaciones (ADR-134 § 1).
- **Pantalla principal (Conversaciones).** Una sola lista con una sola forma de fila para conversaciones con fuera y
  hilos del equipo: turno a la izquierda, quién y contexto, estado (relación, o «Equipo» para un hilo), última
  actividad. Arriba, tres cifras que no cambian con el filtro: Te toca, Se enfría, Nuevos del equipo. Debajo, la
  temporada por línea de Difusión como banda plegable, presente siempre que el ámbito tiene conversaciones de
  difusión (no depende del chip). Los filtros bajan a una línea discreta: «Todo · Con fuera · Del equipo» y, aparte,
  desplegables de etiqueta, línea y orden. **El filtro filtra; el panel no cambia.**
- **Envíos.** Una lista de todo lo que salió o va a salir a muchos, difusión e invitaciones juntas, lo último arriba:
  tipo, asunto, a quién (N salas, lista X + N profesionales), estado y resultado (respuestas, bajas). Al lado, las
  listas del público, como el «a quién» de una invitación. «Ver quién respondió» de un envío abre Conversaciones
  filtrada por él (el `?envio=` de hoy, ya construido). «Nuevo envío» pregunta difusión o invitación.
- **Rompe.** ADR-138 § 1 y 2 en dos puntos: Equipo deja de ser un chip y pasa a filtro de origen, y «el panel sigue al
  chip» se sustituye por un panel fijo (la temperatura y el último envío dejan de ser exclusivos de un chip; la
  temporada sigue siendo sólo de Difusión pero no exige elegirla). ADR-173 § 3: Público deja de ser la tercera vista y
  sus listas pasan a Envíos. ADR-117/118 § «Último envío»: el bloque desaparece del panel porque los envíos tienen su
  vista. La regla «la etiqueta nunca decide permisos» no se toca, ni ningún permiso.
- **Coste.** Dos carriles, uno detrás del otro (los dos tocan `conversations/+page.svelte`): (1) la vista Envíos y
  mover `AudiencePanel` a ella, con `GET /api/mailout` ampliado a todos los tipos, paginado y con sus cifras
  (respuestas, bajas: ya existen en `mailout_preview` y en Desk); (2) cabecera, filtros y panel fijo, una forma de
  fila común sobre `conversation_feed`, y las redirecciones (`?view=audience` y `?etiqueta=team`). Un tercero
  pequeño, en paralelo, para migas y píldora en ficha, envío y lista. Sin migración. Cambian claves de consulta:
  `CACHE_SCHEMA` sube (ADR-158).
- **Por qué primero.** Contesta las dos frases de Marco con una sola distinción visible (hablar o enviar) sin abrir
  una lente nueva (ADR-065 sigue cerrado), sin repartir los envíos por la app y con casi todo ya construido: el feed
  común existe, el filtro por envío existe, el panel del público existe. Es la que menos aprende Marco y la que más
  quita: los cinco paneles pasan a dos.

### B. Cada cosa con su dueño

Boceto: `sketch-B-cada-cosa-con-su-dueno.html` (y `.png`).

- **Navegación.** La lente se queda sólo con lo que va y vuelve, como la pantalla principal de A pero sin segunda
  vista. Lo que sale a muchos vuelve a quien lo origina (ADR-138 § 6 llevado hasta el final: «cada lente es dueña de
  un tipo de cosa»).
- **Dónde viven envíos y listas.** La invitación cuelga de la función a la que invita (Planificador, ficha de la
  función: «Invitaciones · Invitar a esta función»). El envío de difusión cuelga de su línea (la campaña), junto a la
  temporada de esa línea. Las listas del público van a Ajustes › Este espacio › Público: formulario, textos legales e
  importación son configuración, no trabajo diario. La lente sólo enseña de ellos lo que ayuda a decidir allí: un
  bloque «Respuestas a envíos» con enlace a la línea.
- **Rompe.** Lo mismo que A en ADR-138 § 1 y 2 y ADR-173 § 3, y además: ADR-173 § 10 («cómo se eligen»: la selección
  de Conversaciones como punto de partida de una invitación pasa a ser secundaria), y pide una página de línea con
  contenido propio, que hoy no existe como pantalla de trabajo (una línea es una agrupación y un ámbito, no una ficha
  con bloques; `structure-model.md`). Una invitación a varias funciones o sin función no tiene dueño claro.
- **Coste.** Tres o cuatro carriles: la lente simplificada; invitaciones en la ficha de la función; envíos en una
  ficha de línea que hay que diseñar; listas a Ajustes. Sin migración. Toca el Planificador y Ajustes, así que choca
  con más carriles abiertos.
- **Por qué no primero.** Es la más coherente con el modelo, pero responde «¿cómo fue mi envío?» con «depende de qué
  envío»: tres sitios para la misma tabla. Marco pidió saber dónde mirar; B le da más sitios.

### C. Bandeja única

Boceto: `sketch-C-bandeja-unica.html` (y `.png`).

- **Navegación.** Sin vistas ni chips. Una columna de lo que pide algo, agrupada por turno: Te toca, Se enfría, En
  marcha, y «El resto» plegado. Una conversación, un hilo y un envío con respuestas nuevas son filas del mismo río,
  cada una con su forma. Etiquetas, equipo y envío pasan a la búsqueda como fichas (`difusión`, `equipo`,
  `envío:ronda 2`).
- **Dónde viven envíos y listas.** Los envíos son filas de la bandeja cuando piden algo (respuestas nuevas, borrador
  sin enviar) y se buscan con la ficha `envío`. Las listas del público van a Ajustes. La temporada de Difusión sale
  sólo con `difusión` en la búsqueda.
- **Rompe.** ADR-138 § 1 y 2 entero (desaparece la fila de chips), ADR-117 § 2 y 118 para Conversaciones (el
  dashboard por sección se convierte en grupos de la bandeja), ADR-173 § 3. Se parece mucho al Desk (ADR-117 § 1:
  Desk responde «qué pide atención hoy, de todo»): la lente dejaría de responder «cómo está su dominio».
- **Coste.** Dos o tres carriles, y el más caro en base: meter envíos en `conversation_feed` es redefinir una RPC
  (migración, tests RLS, gate de § 34). La búsqueda con fichas es nueva.
- **Por qué no primero.** Es la más limpia de mirar, pero duplica el Desk y esconde la temporada, que es lo que Marco
  usa para saber cómo va una campaña (ADR-135). Vale si Marco dice que lo que quiere de la lente es una bandeja y no
  un panel; si es así, mejor llevarlo al Desk que vaciar la lente.

## Lo que queda abierto

- **Falta decidir (Marco):** la dirección. Recomendada A: una sola distinción visible, sin lente nueva, casi todo ya
  construido. Alternativa B si prefiere que cada cosa viva con su dueño aunque haya más sitios. C sólo si lo que quiere
  es una bandeja, y entonces probablemente en el Desk.
- **Antes de construir:** mirar las capturas equivalentes con `muk-cia` (154 conversaciones, líneas reales, envíos
  hechos), que esta sesión no pudo ver. Con datos reales la banda de temporada y la lista de envíos pueden pedir otra
  densidad.
- En A, una pregunta pequeña para el carril 2: si «Del equipo» enseña todos los hilos legibles o sólo los que tienen
  algo nuevo o te toca (hoy Equipo los enseña todos, ADR-116).
- **Decidido (Marco, 2026-11-02):** dirección A. Segunda vuelta abajo.

## Segunda vuelta: el modelo de mensajería

> 2026-11-02, tras elegir Marco la dirección A. Sus palabras: «creo que el problema es que estamos acostumbrados a
> apps tipo WhatsApp, Telegram y demás». Quien entra en Conversaciones trae el modelo de una app de mensajería y la
> lente no se le parece: abre en un panel de cifras, la lista no dice qué se dijo, y la ficha es un registro con el
> hilo del equipo al lado. Esta vuelta rehace A con ese modelo, con criterio: lo que encaja se toma, lo que no se
> explica.

Bocetos en `/private/tmp/claude-501/conv-design/` (fuera de git), HTML estático sobre `sketch.css` más `A2.css`,
renderizados con `render-A2.mjs` (chromium-1228 instalado):

| Fichero | Qué |
|---|---|
| `A2-escritorio.html` / `.png` | los tres marcos de escritorio juntos (1440) |
| `A2-escritorio-lista-y-ficha.png` | lista de chats y una conversación con fuera abierta al lado |
| `A2-escritorio-equipo.png` | chip Equipo y un hilo de bolo abierto, como grupo |
| `A2-escritorio-envios.png` | la vista Envíos, con la temporada arriba |
| `A2-movil.html` / `.png` | los tres móviles juntos (390) |
| `A2-movil-lista.png`, `A2-movil-ficha.png`, `A2-movil-grupo.png` | cada pantalla de móvil sola |

Datos inventados con la forma de MaMeMi; la densidad real de `muk-cia` sigue sin mirarse.

### 1. Qué toma de una app de mensajería y qué no

**Lo que toma**, porque Hour ya tiene el dato y sólo le falta la forma:

- **La lista como lista de chats.** Cada fila: con quién (monograma y nombre), lo último que se dijo, cuándo, cuántos
  sin leer, y a quién le toca. `conversation_feed` ya trae casi todo: `unread_count` (registro más su hilo del
  equipo), `last` con dirección, tipo y asunto, `last_at`, el turno (`turnOf`/`dueReason`) y la relación. Hoy la fila
  enseña nombre, contacto y una etiqueta que se repite (30 de 31 filas decían «Venues», `01-todas-d`); pasa a enseñar
  lo que un ojo de mensajería busca primero: la última línea y el número de no leídos.
- **La ficha como hilo**, de lo antiguo a lo nuevo, lo último abajo, una raya de «N nuevos» donde se dejó de leer, y
  el campo de escribir al pie. La vista «hilo» ya existe en `ConversationRecord` (ADR-099, añadido: dos vistas
  conmutables sobre el mismo registro); pasa a ser la que abre, y la de «registro» queda detrás de «Detalles».
- **El hilo de un bolo como grupo.** El General, Técnica o Comidas de un bolo son lo que en una app de mensajería es
  un grupo: mensajes cortos, por autor, Intro envía. Su fila lleva un monograma de trazo discontinuo para distinguirlo
  de una organización.
- **La búsqueda arriba de la lista**, una sola, que lee conversaciones e hilos (la de hoy ya lo hace).
- **Chips de filtro con cifra** encima de la lista, como los «No leídos · Grupos» de una app de mensajería: Todo ·
  Te toca · Se enfría · Equipo. Filtran la misma lista; ninguno cambia la pantalla.
- **Tocar la cabecera abre los detalles** (contactos, bolos, etiquetas, organización, privacidad), como la ficha de
  contacto de un chat.
- **En móvil, lista a pantalla entera y el hilo encima**, con la barra de lentes de abajo escondida dentro del hilo,
  como un chat abierto. **En escritorio, dos paneles**: lista a la izquierda y el hilo al lado, que es el vistazo
  lateral de ADR-139 p1 fijo en esta lente.
- **La selección** (Escribir a N, Invitar a N, No esta vez) como la selección de chats: botón «Seleccionar» en
  escritorio, pulsación larga en móvil.

**Lo que no toma, y por qué:**

- **El chat no es con una persona.** Una conversación de Hour es con una organización (ADR-102): Laia deja la sala,
  entra Jordi, sigue siendo la misma. El monograma y el nombre de la fila son de la organización; las personas salen
  como quien habla dentro del hilo y en la línea bajo el título. Una app de mensajería haría un chat por persona y
  rompería eso.
- **Un correo no es una burbuja.** Lo de fuera llega casi siempre por correo: asunto, texto largo, citas, adjuntos.
  Se pinta como una carta compacta (quién, asunto, tres líneas, «ver correo entero»), alineada a un lado u otro
  según quién habla, que es lo único de la burbuja que ayuda. Los mensajes del equipo sí son cortos y van con forma
  de mensaje.
- **Sin «escribiendo…», sin «visto», sin doble check, sin «en línea».** El correo no da esa información y fingirla
  sería inventar; saber si alguien abrió un correo pide un píxel de seguimiento, que choca con el diseño
  consent-first de los envíos y con la LSSI. «Sin leer» es sólo lo que tú no has leído (`conversation_read`).
- **Intro no envía un correo.** Un correo es un borrador con destinatario, asunto y firma, que sale por tu buzón
  conectado (ADR-099, ADR-100, firma por persona). El campo del pie empieza corto, Intro hace salto de línea, y
  «Abrir como correo» lo despliega entero. En un grupo del equipo, Intro sí envía.
- **Un solo campo de escribir con tres destinos**, que una app de mensajería no tiene: «Correo a Laia» (sale fuera),
  «Solo el equipo» (nota interna dentro del hilo, marcada y sombreada) y «Apuntar llamada o nota» (un
  `conversation_event` que no se manda a nadie, ADR-098). El parecido aquí es con las bandejas compartidas de correo
  con comentarios internos, no con WhatsApp: el hilo del equipo de una conversación no es un chat aparte, va
  intercalado en el de fuera. Por eso no sale como fila propia en la lista (la RPC ya lo suma a la fila de su
  conversación).
- **El chat lleva el estado del trato.** Bajo la cabecera, una línea fija con la relación (en conversación,
  contactada…), los bolos con fecha y estado (ADR-138 § 3), el siguiente paso y a quién le toca. Un chat sólo tiene
  nombre y foto; aquí sin esa línea no se sabe cómo va nada, que era el punto 3 del diagnóstico.
- **El orden no es sólo el último mensaje.** Por defecto, «lo que pide» (no leídos, después te toca, después lo
  último; `comparePide`), que es lo que sirve para trabajar; «Recientes» queda como orden alternativo.
- **Un grupo no se monta desde el chat.** Quién lee un hilo de bolo lo da el acceso al bolo (ADR-142) o la regla de
  la faceta (ADR-106), nunca «añadir participante». La cabecera del grupo dice «lo leen 6» y lleva a «Abrir el
  bolo › Acceso».
- **Los envíos no son chats.** Nada de «listas de difusión» como filas de la lista: un envío sale a muchos y sus
  respuestas entran en cada conversación. Dentro del hilo, lo que salió con un envío se pinta como una tarjeta de
  trazo discontinuo («Tú, con el envío «Ronda 2» · a 40 salas · abrir el envío») que enlaza con Envíos.
- **Archivar no es esconder para siempre.** El equivalente de archivar es «No esta vez» (ADR-138 § 4), que caduca
  con una respuesta nueva o en su fecha. No se añade un archivo aparte.

### 2. Qué cambia en la vista Conversaciones y qué se queda en Envíos

**Lista** (`A2-escritorio-lista-y-ficha`, `A2-movil-lista`):

- Fila de chat en tres líneas: nombre y hora; última línea («Laia: Re: marzo nos encaja…», «Tú: …», «Llamada: …») y
  número de no leídos; y una línea pequeña de contexto: turno (sólo «Te toca» en tinta), etiqueta, proyecto si el
  ámbito tiene varios, y el bolo si lo hay. La etiqueta deja de ser una píldora en cada fila.
- Encima: la búsqueda y los chips Todo · Te toca · Se enfría · Equipo, con su cifra. «Filtrar ▾» abre etiqueta,
  línea y orden, aparte y con otra forma: no se confunde con los chips.
- Cabecera: «Seleccionar», «Nueva conversación» y el segmento Conversaciones · Envíos.

**Ficha** (`A2-escritorio-lista-y-ficha`, `A2-movil-ficha`; grupo en `A2-escritorio-equipo`, `A2-movil-grupo`):

- Cabecera: monograma, organización, contactos con su papel; «Detalles» (o tocar la cabecera en móvil).
- Línea de hechos fija: relación, bolos, siguiente paso, turno. Es la franja de estado de ADR-102 y la «Falta» de
  ADR-139 p2 juntas en una línea.
- Hilo: correos como cartas, notas del equipo intercaladas, llamadas apuntadas como una línea centrada, tarjetas de
  envío, raya de nuevos.
- Pie: el campo con sus tres destinos. Sin buzón conectado, «Correo a…» dice «conecta un buzón» y el destino por
  defecto pasa a «Apuntar».
- Lo que hoy está en la columna derecha (bolos, último contacto, Planificador, etiquetas, «lo conozco», detalles,
  privacidad) va a «Detalles». Desaparecen el panel «Team» lateral y la pestaña «Record · Thread»: el equipo tiene
  una sola entrada, la del pie (cierra el punto 6 del diagnóstico).
- Un hilo de bolo abierto desde la lista es un grupo: mensajes por autor, Intro envía, «Abrir el bolo».

**El panel de arriba no sobrevive como panel: se pliega en los chips.** Te toca, Se enfría y Nuevos del equipo eran
cifras que filtraban la lista (ADR-117 § 1); ahora son exactamente eso, chips con cifra. Una lista de chats con un
tablero encima ya no se lee como lista de chats, y en 390 px el tablero empuja la primera conversación fuera de la
pantalla. Caliente, Ronda y Sin fecha pasan a «Filtrar ▾» (siguen en la URL como hoy).

**La temporada baja a Envíos.** La barra de la temporada por línea mide cómo va una campaña de difusión: lo que sale
a muchos y lo que vuelve de ello. Va a la cabeza de Envíos, con «ver las 24 en Conversaciones», que filtra la lista
por esa línea (`A2-escritorio-envios`). Con un filtro de línea puesto en Conversaciones, una línea fina con la cifra
de la temporada encabeza la lista; sin filtro, no sale.

**Envíos queda como en A**: difusión e invitaciones juntas, lo último arriba, con sus cifras; las listas del público
al lado; «Nuevo envío». Más la temporada arriba. Las respuestas de un envío se leen en Conversaciones (`?envio=`).

### 3. Coste en carriles y qué ADR toca (actualizado)

Tres carriles y uno opcional. 1 y 2 tocan `conversations/+page.svelte` y van uno detrás del otro; el 3 toca la ficha
y puede ir en paralelo con cualquiera de los dos.

1. **Envíos** (como en A, más la temporada): la vista, `AudiencePanel` a ella, `GET /api/mailout` con todos los
   tipos, paginado y con cifras; la banda de temporada movida desde el panel de Difusión.
2. **La lista como chats**: cabecera con el segmento, chips con cifra sobre `conversation_feed`, «Filtrar ▾», fila
   común de tres líneas, dos paneles en escritorio con el vistazo fijo, pantalla entera en móvil, redirecciones
   (`?view=audience`, `?etiqueta=team` y los chips de etiqueta viejos a su filtro). Sube `CACHE_SCHEMA` (ADR-158):
   cambian claves de consulta.
3. **La ficha como hilo**: la vista hilo por defecto, la línea de hechos, el campo único con tres destinos (funde
   «Escribir correo», el compositor del equipo y «Apuntar llamada»), la columna derecha a «Detalles», la tarjeta del
   envío en el hilo, y en móvil esconder la barra de lentes dentro de una ficha (toca el shell de `/h`). Sin
   migración.
4. **Opcional, después: la vista previa del texto.** Hoy la RPC da el asunto del último correo, no su texto; un hilo
   de bolo sí da su último mensaje (280 caracteres). Para «Laia: marzo nos encaja…» en vez de «Laia: Re: MaMeMi
   26-27…», y para que el último mensaje del equipo de una conversación salga en su fila, hay que redefinir
   `conversation_feed` (devolver un trozo del texto del último evento y del último mensaje de su hilo). Migración
   sólo de función, no destructiva, pero con el gate de § 34 (backup, plan, apply), la firma copiada de la base viva
   (`pg_get_functiondef`), tests RLS y `CACHE_SCHEMA`. El carril 2 vive con el asunto, que ya es más que lo de hoy.

**ADR que toca:**

- **ADR-134 § 2**: las vistas de la cabecera pasan a ser Conversaciones · Envíos (§ 1, el nombre de la lente, no
  cambia).
- **ADR-138 § 1 y 2**: Equipo deja la fila de etiquetas y pasa a chip de la lista; las etiquetas pasan a «Filtrar»;
  «el panel sigue al chip» se sustituye por «el chip filtra, la pantalla no cambia». § 3 a 7 no cambian (la etiqueta
  sigue sin decidir permisos).
- **ADR-117 § 2 y ADR-118**, para Conversaciones: el dashboard se pliega en chips con cifra; la temporada se muda a
  Envíos; el «Último envío» sale del panel (como en A). ADR-117 § 1 (cada bloque filtra la lista) se cumple más que
  antes.
- **ADR-173 § 3**: Público deja de ser una vista y sus listas van a Envíos (como en A).
- **ADR-099, añadido al punto 5**: las dos vistas siguen siendo presentación de un solo dato; la de hilo pasa a ser
  la que abre y la de registro va a Detalles. El compositor del equipo se funde con el del correo.
- **ADR-139 p1**: en esta lente el vistazo lateral queda fijo en escritorio, como segundo panel.
- **ADR-102, ADR-098 y ADR-142 no cambian**, se apoyan: la fila es la organización; «Apuntar» es
  `record_conversation_event`; quién lee un grupo lo sigue dando el bolo.
- Hace falta **un ADR nuevo** que recoja esta vuelta («Conversaciones con forma de mensajería») con las enmiendas de
  arriba.

**Dos preguntas pequeñas antes de construir (Marco):**

- Destino por defecto del pie cuando no hay turno: recomendado «Correo a» el contacto principal, porque es lo que más
  se hace; alternativa, «Solo el equipo».
- Deslizar una fila en móvil: recomendado no en el primer corte (la pulsación larga ya da las acciones en bloque);
  alternativa, deslizar para «Atendida» y «No esta vez».
