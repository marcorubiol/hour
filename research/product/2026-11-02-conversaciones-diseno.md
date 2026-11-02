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
