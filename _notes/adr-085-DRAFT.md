# ADR-085 + enmiendas a ADR-082/083 — BORRADOR listo para pegar

> Redactado 2026-07-20 en sesión autónoma. **No lo he metido en `_decisions.md` a propósito:**
> la sesión paralela está commiteando en la misma rama y ese fichero es el que más duele si
> hay conflicto. Cuando digas, lo pego yo — o pégalo tú, está listo.
>
> **Ojo con la numeración:** ADR-084 ya está cogido por la sesión paralela (`Cubo 2`, commit
> e2d2161). Por eso esto es el 085. Verifica antes de pegar.
>
> Origen: `_notes/spec-access-comms-decisions.md` (el digest de decisiones del grill).
> Orden de pegado: la enmienda de 082 va justo debajo de ADR-082, la de 083 debajo de ADR-083,
> y ADR-085 al final del fichero por orden cronológico.

---

## 1 · Para pegar al FINAL de `_decisions.md` (entrada nueva)

## [2026-07-20] — ADR-085 · El invitat: membresía sin login, y delegación acotada por el delegante

> Continuación del grill de ADR-082/083, reabierto 2026-07-19/20 al dibujar la página de bolo. El disparador fue un accidente de diseño: la segunda pasada inventó un contacto de la sala participando en un hilo por link firmado, y Marco lo tomó como buena idea en vez de como error. Eso obligó a mirar qué separaba realmente "dentro" de "fuera" y a cerrar quién puede meter a quién. Registro de trabajo completo: `_notes/spec-access-comms-decisions.md` §3-§4 (fichero de staging, borrable una vez plegado aquí).

- **Decisiones** (decididas en grill, SIN implementar):
  1. **El `invitat` es una membresía con permisos, menos el login, más una fecha de fin.** No es un mecanismo nuevo: mismos contenedores, mismas facetas, mismo eje `res | veure | veure+editar`. Lo único que cambia es `login = no` + `ends_at`. Cuarto término del vocabulario de ADR-082, junto a rol / permisos / operador.
  2. **No debilita ADR-082 §6, lo hace literal.** *"Login solo para operadores"* sigue siendo cierto palabra por palabra. Lo que cae es el supuesto tácito que iba pegado —que **estar dentro exigía login**—, y que nunca se decidió: se asumió. El muro nunca fue la membresía; el muro es el login y la plaza.
  3. **Se llega por link firmado. Sin cuenta. No consume seat.** El modelo de negocio de Phase 1 (contactos gratis e ilimitados, operadores = plazas) queda intacto.
  4. **Escribe y es parte del hilo**, no espectador. **Ve el historial completo** de los hilos en los que está, incluidos los mensajes anteriores a su invitación: un sub-hilo es *una* conversación, y el historial parcial fabrica referencias a cosas que no puedes ver.
  5. **Se invita a FACETAS de un contenedor, no a hilos sueltos** — así los hilos futuros de esas facetas ya lo incluyen. **Un hilo libre NO hereda los invitados de las facetas**: un hilo libre tiene siempre su lista explícita.
  6. **Puede invitarse a hilos de faceta, Diners incluido.** Marco levantó la restricción anterior ("solo hilos libres"). No rompe la derivación de audiencia: la audiencia pasa a ser `derived(faceta, contenedor) ∪ invitats`, **una sola fórmula para los dos tipos de hilo**, donde el `derived` de un hilo libre es el conjunto vacío. **Es más simple que la versión de dos mecanismos que sustituye** (ADR-083 §5, que enunciaba dos modelos de audiencia según el tipo de hilo).
  7. **Revocar no es borrar.** Lo que escribió un invitado se queda en el hilo: es el registro de la compañía.
  8. **Acaba con la cosa, no con un reloj.** La invitación lleva siempre un final: por defecto derivado del contenedor cuando el contenedor tiene fecha (pasa el bolo → se cierra el acceso, con un margen de semanas para la cola de factura/fotos), elegido explícitamente cuando no la tiene (un hilo libre de proyecto). Revocable a mano en cualquier momento. **Rompe con el precedente de la casa** — `roadsheet_share` tiene `revoked_at` y no `expires_at` — deliberadamente: un documento de una dirección que envejece hasta la irrelevancia no es el mismo riesgo que un canal de escritura vivo desde una URL sin autenticar.
  9. **Siempre visible** en el "quién entra y por qué", con quién lo invitó y cuándo.
  10. **Delegación acotada por el delegante: solo puedes dar lo que tienes**, en los tres ejes — **faceta** (no puedes dar una faceta que no tienes), **verbo** (con `veure` no puedes dar `veure+editar`), **nivel** (tu nivel o más estrecho, nunca más ancho).
  11. **Lo que tienes es el TECHO, nunca el DEFAULT.** El default de cualquier invitación es el preset mínimo; cada faceta por encima se enciende a mano. Un invitado *puede* acabar viendo el caché — nunca por herencia, solo porque alguien que tiene Diners lo dio deliberadamente, con línea de confirmación explícita ("estàs donant la conversa econòmica a algú de fora de la companyia").
  12. **"Invitar" desaparece como capacidad separada.** La regla del techo la sustituye: un admin lo tiene todo, luego puede dar todo; una road manager delega dentro de lo suyo. Una regla en vez de dos, y el caso de las 8 de la mañana sobrevive — puede meter al técnico de la sala en Tècnica/Logística porque las tiene, y no puede meter a nadie en Diners porque no la tiene.

- **Rechazado**:
  - *Que el invitado solo pudiera entrar a hilos libres* — Marco lo levantó; la fórmula unificada de audiencia (§6) sale más barata que mantener dos mecanismos para evitar un caso que de todas formas hay que poder autorizar a mano.
  - *Invitado como espectador* (solo lectura por link) — si está en el hilo, está en la conversación; media presencia obliga a explicar por qué unos mensajes no se pueden responder.
  - *Historial parcial desde la fecha de invitación* — produce referencias huérfanas dentro de una misma conversación.
  - *Borrar lo escrito al revocar* — el registro es de la compañía, no del invitado.
  - *Invitación sin caducidad, siguiendo `roadsheet_share`* — ver §8; el precedente se rompe a propósito.
  - *Herencia de facetas al invitar "al bolo"* — Marco se negó a firmar un modelo donde invitar a alguien a un bolo pudiera arrastrar Diners.
  - *Una capacidad "invitar" gateada por permisos* — redundante con §10 (§12).
  - *Acotar la CANTIDAD de invitados* — quien tiene acceso ancho puede crear muchos. Con caducidad y roster visible, se acepta para una compañía de 3-15 personas. **No construir para esto.**

- **Por qué**: el modelo de ADR-082 confundía dos cosas distintas bajo una sola frontera — quién paga plaza y quién puede estar en una conversación. Separarlas cuesta un campo (`ends_at`) y un modo de acceso (link firmado), y a cambio hace representable lo que la coordinación de un bolo hace de verdad: a las 8 de la mañana el técnico de la sala está dentro de Tècnica y de Logística, no fuera con una copia PDF. La fórmula única de audiencia es el dividendo real: el `invitat` no añade un segundo camino de resolución, colapsa los dos que había en uno. Y la delegación acotada por el delegante es la única regla que hace segura la apertura: nadie puede filtrar hacia fuera lo que no ve hacia dentro, y como el default es el mínimo, la fuga por descuido no existe — solo la fuga deliberada, que es la que se puede confirmar por pantalla.

- **Abierto**: (1) **Revocar no tiene pantalla** — un operador deja de serlo al final de una gira: el acceso se cierra, la persona vuelve a contacto, todo lo que escribió se queda. Nadie lo ha diseñado; es la otra mitad de "dar de alta", y aplica igual a operadores y a invitados. (2) **Si `roadsheet_share` debe adoptar la regla de caducidad del invitado** — abierto, no ahora. (3) Schema: ni el `ends_at`, ni el link firmado, ni el nivel de contenedor existen; recuérdese que `has_permission` solo toma `project_id` y que no hay membresía de workspace/línia/performance — **la dimensión de nivel es el coste de construcción entero**. (4) La línea de audiencia por hilo ("Ho veuen 5 — per permís de logística") es lo que sostiene la transparencia de ADR-083 §5 cuando el roster pasa a estar detrás de una puerta: **no puede plegarse nunca**.
- **Status**: **provisional — decidido en grill, SIN implementar. Cero schema tocado.** Amplía ADR-082 (§2 el invitado como cuarto término; §6 aclarado, no revocado) y supera ADR-083 §5 (dos modelos de audiencia → una fórmula). **Sigue en pie el gate duro: usar la app durante una temporada real de difusión antes de construir nada de esto.**
- **Re-evaluate when**: al implementar, junto con ADR-082/083 (orden: nivel de contenedor → invitat → link firmado); si aparece un invitado que necesita volver temporada tras temporada y la caducidad se vuelve fricción en vez de garantía; si el roster de invitados de una compañía crece hasta pedir gestión propia (hoy explícitamente no se construye para ello); si al diseñar la pantalla de revocar se descubre que operador e invitado no comparten la misma salida.

---

## 2 · Para pegar DEBAJO de la cabecera de ADR-082

> **ENMIENDA (2026-07-20)** — resultado del grill de acceso+comms del 2026-07-19/20 (registro completo: `_notes/spec-access-comms-decisions.md`). Corrige y precisa §4 (facetas) y §6 (login) de este ADR; el resto queda como está. **Sigue sin implementar: no toca schema.**
>
> **1 · Las facetas existen POR NIVEL de contenedor.** Las dos listas que ADR-082 y ADR-083 esbozaban nunca fueron dos listas: son una sola vista a dos alturas. Este ADR gateaba lo que vive arriba (el libro, los materiales), ADR-083 hablaba de lo que vive abajo (técnica, logística); Diners salía en las dos porque es la única que cruza todos los niveles.
>
> |  | espai | projecte | línia | bolo |
> |---|:--:|:--:|:--:|:--:|
> | Converses | ● | ● | ● | — |
> | Materials | — | ● | ● | ● |
> | Producció | — | ● | ● | ● |
> | Tècnica | — | ● | ● | ● |
> | Logística | — | — | ● | ● |
> | Full de ruta | — | — | — | ● |
> | Diners | ● | ● | ● | ● |
>
> **`General` NO está en la tabla.** No es faceta: es la membresía en el contenedor. El hilo general siempre existe y su audiencia es exactamente los miembros del contenedor; un "permiso de General" sería falso, porque nunca puede valer `res` para un miembro.
>
> **Ausente ≠ denegado.** Una faceta que no existe en un nivel no está "puesta a `res`": no está. La UI tiene que decirlo con esas palabras, o el usuario leerá una prohibición donde solo hay una dimensión inexistente.
>
> **La unión entre niveles no cambia** (§3 de este ADR, intacto). `Diners·veure` a nivel espai sigue concediéndolo en cada bolo. La tabla dice *dónde puede existir* una faceta; no altera cómo se suma el acceso.
>
> Elegido deliberadamente frente a una lista plana, decisión de Marco. Contabilidad honesta: **la ganancia ergonómica es modesta** (espai=2 filas, projecte=5, línia=6, bolo=6; línia y bolo solo difieren en Converses↔Full de ruta). **La ganancia real es de seguridad, no de brevedad:** no puedes conceder `Full de ruta` a nivel espai ni `Converses` en un bolo, porque la fila no está ahí para concederla.
>
> **2 · Renombres del preset, forzados por colisión.** `Convidat` → **`Mínim`**: "convidat" pasa a nombrar al invitado (una persona sin login, ver la enmienda a §6), y el preset más bajo no puede compartir palabra con él. `Producció` → **`Coordinació`**: `Producció` pasa a ser *faceta* (tabla arriba) y ya era *rol*; tres significados para una palabra es exactamente el fallo que §2 de este ADR quería evitar. Escalera final: **Mínim · Equip · Coordinació · Direcció**.
>
> **3 · Delegación acotada por el delegante, en tres ejes.** Solo puedes conceder lo que tienes: **faceta** (no concedes una que no tienes), **verbo** (con `veure` no concedes `veure+editar`), **nivel** (el tuyo o más estrecho, nunca más ancho). Dividendo: **esta regla sustituye a la capacidad separada de "invitar"** de ADR-083 §4. Un admin lo tiene todo, luego puede conceder todo; una road manager delega dentro de lo suyo. Una regla en vez de dos, y el caso de las 8am sobrevive: mete al técnico de la sala en Tècnica/Logística porque las tiene, y no puede meter a nadie en Diners porque no la tiene. Lo que la regla **no** acota es la cantidad — quien tiene acceso ancho puede crear muchos invitados; con caducidad y roster visible, aceptado para una compañía de 3-15. No construir para eso.
>
> **4 · Lo que tienes es el TECHO, nunca el DEFAULT.** El default de cualquier invitación es `Mínim`; cada faceta por encima se enciende a mano. Marco se negó a firmar un modelo donde invitar a alguien "al bolo" arrastrase Diners por herencia. Alguien de fuera *puede* acabar viendo el caché — nunca por herencia, solo porque quien tiene Diners lo dio deliberadamente, con línea de confirmación explícita.
>
> **5 · `Producció` como faceta: se queda, en observación.** El pase de mockup la probó escribiendo un hilo de Producció realista y todos los mensajes habrían ido a tècnica, logística o diners. Y ojo al argumento a favor: "es un rol clásico de teatro" argumenta que sea **rol** — que ya lo es — no que sea faceta. Es la confusión rol↔faceta otra vez. Re-evaluar tras una temporada real.
>
> **6 · Reversibilidad como requisito, no como detalle** (Marco, explícito). La tabla de niveles tiene que ser **filas, nunca código**: mover Tècnica de projecte a línia debe ser un `UPDATE`, no una migración y no un `if`. Lista de facetas, tabla de niveles y presets son datos. Lo que nunca puede ser gratis: una faceta solo significa algo si gatea una tabla, y ese enganche vive en las políticas RLS (hoy `read:money` aparece literalmente en ~11 sitios de `rls-policies.sql`). **Mover una faceta entre niveles: gratis. Añadir una faceta nueva: cuesta su política. Borrar una que ya se usó: cuesta su historial.**
>
> **7 · Coste de construcción, al registro.** **Ya existe:** `has_permission(project_id, text)` resuelve `union(roles.permissions) + permission_grants − permission_revokes`, con roles/grants/revokes como *datos* en `project_membership`. Eso es el motor preset+overrides de §4 de este ADR, ya desplegado. **No existe nada:** ningún nivel que no sea proyecto. `has_permission` recibe un `project_id` y nada más, y no hay membresía de workspace, de línia ni de performance. **La dimensión de nivel es el coste íntegro de esta enmienda.**

---

## 3 · Para pegar DEBAJO de la cabecera de ADR-083

> **ENMIENDA (2026-07-20)** — segunda vuelta del mismo grill, tras dibujar la capa (`_notes/spec-access-comms-decisions.md`, `app design/*.html`). Sigue SIN implementar y sin tocar schema.

- **1 · Una sola fórmula de audiencia — cae el §5.** La audiencia de cualquier hilo es `derived(facet, container) ∪ invited`. Vale igual para los hilos de faceta y para los libres: un hilo libre no tiene faceta, así que su conjunto derivado es vacío y queda solo la lista de invitados — que es exactamente el "participantes explícitos" del §5, sin mecanismo aparte. **Supera el reparto en dos modelos de audiencia del §5**; lo que allí eran dos reglas es un caso degenerado de una. Menos superficie, no más.
- **2 · Un invitat puede entrar en hilos de faceta, incluido Diners.** Marco levanta la restricción implícita de "solo hilos libres". No rompe la derivación: el invitado entra por el término `∪ invited`, el derivado sigue resolviéndose por permiso como siempre. El `invitat` (membresía sin login, con fecha de fin) se define en la enmienda de ADR-082; aquí solo importa que es un sumando de la audiencia, no una excepción a ella.
- **3 · Un hilo libre nunca hereda los invitados concedidos a nivel de faceta.** Siempre tiene su lista explícita propia. Es la única asimetría que sobrevive, y es deliberada: la herencia por faceta es lo que arrastraría a alguien de fuera a una conversación que nadie decidió darle.
- **4 · "Una sola lista para las tres cosas" (§4) ahora es literal — pero la lista es por nivel de contenedor.** Ordenar, ver y abrir siguen colgando de la misma lista de facetas; lo que cambia es que esa lista no es plana: qué facetas existen depende del nivel (espai / projecte / línia / bolo). Ver la enmienda de ADR-082 para la tabla y su regla de reversibilidad (filas, nunca código).
- **5 · `General` no es una faceta.** Es el hilo propio del contenedor: existe siempre y su audiencia son exactamente los miembros. Un "permiso de General" sería falso — no puede ser `res` para un miembro. Queda fuera de la tabla de facetas.
- **6 · La transparencia del §5 sobrevive en un sitio concreto: la línea de audiencia por hilo.** "Ho veuen 5 — per permís de logística", pegada al hilo, **nunca plegable**. Es donde hace falta la respuesta: justo antes de escribir. El roster completo de permisos pasa detrás de una puerta — se leen hilos cincuenta veces al día y se comprueba quién los ve tres veces al mes; esa frecuencia no justifica una columna permanente. La exigencia del §5 no se rebaja, se coloca.
- **7 · `Producció` como faceta queda en probatoria.** El pase de maquetas escribió un hilo realista de Producció y todos sus mensajes habrían ido a tècnica, logística o diners. Que sea un oficio clásico de teatro argumenta a favor de que sea un **rol** — ya lo es —, no de que sea una faceta. Se mantiene; se re-evalúa tras una temporada real.

- **Abierto (añadido)**: ¿comms aparece en el Desk como quinta preocupación? Un run `MISSATGE` encaja en la gramática, pero pasar de 4 a 5 etiquetas cuesta calma y "todo lo no leído" convierte el Desk en una bandeja de entrada. Criterio propuesto si entra: **solo un mensaje que lleve una pregunta abierta dirigida a ti**.
- **Status de la enmienda**: **provisional — decidido en grill, SIN implementar.** El portón sigue en pie: usar la app una temporada real de difusión antes de construir nada de esto.


---

## Lo que quien redactó no pudo resolver

### ADR-085

Tres cosas que quedan fuera del ADR-085 tal como se pidió y que necesitan entrada propia o enmienda, si no se han hecho ya en otra sesión: (1) §1 del digest — los renombres de preset `Convidat`→`Mínim` y `Producció`→`Coordinació` y la escala final Mínim·Equip·Coordinació·Direcció; en §11 de este ADR he escrito "el preset mínimo" en vez de "Mínim" para no dar por canónico un renombre que aún no está en `_decisions.md`. (2) §2 del digest — facetas por nivel de contenedor; se referencia de refilón en el Abierto (3) porque es el coste de construcción compartido, pero no se decide aquí. (3) §5 del digest — decisiones de diseño (el bastidor, el roster como puerta, la línea de audiencia); solo he traído a este ADR la línea de audiencia por hilo, porque es la que sostiene una promesa de ADR-083.

Contradicción real encontrada, resuelta explícitamente en el texto: ADR-083 §4 convierte "obrir/crear un sub-fil" en una capacidad más gateada por permisos, mientras que §12 de este ADR disuelve "invitar" como capacidad separada. No son la misma capacidad y no se anulan, pero conviene decidir si "abrir sub-hilo" debe caer también bajo la regla del techo (solo puedes abrir un hilo en una faceta que tienes) — cosa que parece obvia y haría desaparecer una segunda capacidad. No lo he dado por decidido porque el digest no lo dice.

Menor: el digest usa terminología catalana para los términos de UI (invitat, faceta, Diners, Tècnica). La he conservado, pero mezclada con prosa castellana produce "los invitats"/"invitados" alternando; he usado `invitat` para el término técnico y "invitado" en prosa corrida. Si prefieres un único registro, decide cuál y lo unifico.

### enmienda 082

Dos puntos a vigilar al plegar el resto del digest:

1. El digest §3 (el `invitat`) no entra en esta enmienda por encargo, pero el punto 2 de arriba (renombre Convidat→Mínim) y el punto 4 (techo/default) lo referencian como si ya estuviera escrito. Si el `invitat` acaba en ADR-085 y no en una enmienda a ADR-082 §6, hay que ajustar la referencia "ver la enmienda a §6" — la he dejado apuntando a §6 de este ADR porque el digest §3 dice explícitamente que no debilita §6 sino que lo hace literal.

2. Colisión de nomenclatura no resuelta en el digest: la tabla de facetas está en catalán (espai/projecte/línia/bolo) mientras el ADR-082 original habla de workspace/proyecto/bolo en castellano, y "línia" no aparece en ninguna parte de ADR-082 ni de ADR-083 — es un nivel de contenedor que la enmienda introduce de facto sin que ningún ADR lo haya definido. Lo he dejado tal cual venía del digest, pero o ADR-085 define "línia" como contenedor o esta tabla cita un nivel que no existe en el modelo escrito.

### enmienda 083

Dos cosas a verificar al pegar: (1) referencio "la enmienda de ADR-082" en los puntos 2 y 4, y esa enmienda todavía no existe en _decisions.md (no hay ningún bloque ENMIENDA en el fichero) — hay que escribirla o cambiar la referencia a `_notes/spec-access-comms-decisions.md § 2 / § 3`. (2) El digest lista `Producció` como faceta de projecte/línia/bolo pero también dice que `Producció` (rol) se renombró a `Coordinació` como preset; el término sigue cargado en dos sitios aunque ya no colisione — es parte de por qué está en probatoria, no una contradicción.
