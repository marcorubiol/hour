# Hour: reglas del sistema base

> Momento 1 de la tarea 147: las reglas de jerarquía y composición que salen del diseño de Hoy en el móvil (tareas 144,
> 145 y 146, cerrado por Marco el 2026-11-13) y que valen para toda la app. La decisión y lo que enmienda: ADR-202.
> Boceto final: https://claude.ai/artifact/7nR2kWXozyqZPQAPpDtgkV (fuente en `build/coordination/hoy-movil/`, fuera de
> git). Los valores viven en `apps/web/src/styles/tokens.css` y su guarda (`tokens-guard.test.ts`); este fichero dice
> roles, no valores.

Cada regla lleva su estado:
- **DECIDIDO**: Marco lo cerró (cita de `_tasks.md` o de un ADR).
- **PROPUESTO**: está en el boceto o en la cola, sin cerrar por Marco. No es regla todavía.
- **ABIERTO**: falta decidirlo; está en ADR-202 § Abierto.

## El criterio

Lo que Marco pidió y de donde sale todo lo demás (`_tasks.md` 146 y 147):

1. **Austera y minimalista.** El tema base es el más limpio.
2. **Para quien tiene déficit de atención:** una sola cosa que llama; la hora siempre a la vista.
3. **Las cosas no se ven todas igual.** El boceto de la 144 falló por eso: «toda la información se ve demasiado igual».

## Las reglas

### 1. Una sola superficie llena por pantalla. DECIDIDO

La pieza de lo de ahora es la única con fondo lleno. Nada más en la pantalla lleva relleno de ese peso.
- **Por qué:** una sola cosa que llama. Si dos piezas tienen fondo, ninguna manda.
- **Decisión:** Marco eligió la B de tres jerarquías (146): «el día es la única superficie llena de la pantalla».
- **Cómo es la superficie:** ni blanco ni negro puros. En claro, un índigo oscuro; en oscuro, una superficie más clara
  que el fondo, no una tarjeta blanca (146, pedido de Marco; boceto).

### 2. Tres alturas, y solo tres: llena, ficha, fondo. DECIDIDO

| Altura | Qué va | Cómo se dibuja | Tokens que ya existen |
|---|---|---|---|
| Llena | Lo de ahora: el día | Relleno de la superficie de foco, tinta propia | Ninguno: falta (ver § Tokens) |
| Ficha | Lo que viene | Papel elevado, raya fina, radio grande | `--bg-ultra-light`, `--border-color-light`, `--radius-l` |
| Fondo | Lo que espera | Sin caja, sobre la página; pastillas hundidas | `--bg`, `--bg-light` |

- **Por qué:** la altura dice la distancia en el tiempo. Lo de ahora pesa, lo de otros días es calendario, lo
  pendiente se lee cuando toca.
- **Decisión:** 146, la B: «lo que viene son fichas de calendario y lo que espera va sobre el fondo».

### 3. Una pantalla es una pila de bloques con nombre, en orden fijo. DECIDIDO

Ahora, lo que viene, lo que espera. Los bloques no cambian de sitio: si uno no está, los de debajo suben.
- **Por qué:** quien vuelve a la pantalla encuentra cada cosa donde la dejó; no hay que buscar.
- **Decisión:** 144 (a), tres bloques con nombre y en ese orden.
- Un bloque vacío no se pinta (ADR-145 § 1), con una excepción en la regla 4.

### 4. Hoy es siempre la pieza grande. DECIDIDO

Si hoy no hay nada, la pieza sigue en su sitio, hueca (sin relleno, con su contorno), lo dice y nombra lo siguiente,
aunque también esté en lo que viene.
- **Por qué:** el sitio de lo de ahora no se mueve; que esté vacío también es información.
- **Decisión:** 146, segunda tanda (b). El texto («Nothing today» o parecido) está ABIERTO.

### 5. La hora siempre a la vista, y relativamente grande. DECIDIDO

El reloj del marco es la cifra en letra display más grande fuera de la pieza llena. Hora y fecha son una pieza: la
cifra grande y, al lado, el día y la fecha en dos líneas. Sin la palabra «Hoy». Tocar el reloj lleva a Hoy y no abre
nada.
- **Por qué:** la app se llama Hour. Y para quien se dispersa, saber qué hora es sin buscarla es la primera ancla.
- **Decisión:** 146 (2), y en la cuarta tanda (a) «la pieza de hora y fecha sin la palabra Today vale»; reloj sin ▾
  ni hoja, DECIDIDO 13-11 noche.

### 6. La hora al tamaño de la cosa. DECIDIDO

En la pieza llena, qué y cuándo van al mismo tamaño, qué a la izquierda y la hora a la derecha. La cuenta atrás baja a
la segunda línea. Mientras haces algo, la hora grande es hasta cuándo («→ 17h») y debajo, cuánto queda.
- **Por qué:** la hora es la mitad del hecho, no un detalle; y una cuenta atrás grande mete prisa.
- **Decisión:** 146, pedido de Marco: «la hora al tamaño de la cosa, no solo la cuenta atrás».

### 7. El monograma del proyecto delante de cada cosa. DECIDIDO

Cada cosa de la pieza llena, del día y de las fichas lleva el monograma de su proyecto (`IdentityMark` mini, tres
letras sobre su tinte). Sustituye a los cuadraditos de color. En una pieza estrecha va encima de la palabra, no al
lado.
- **Por qué:** con varias compañías a la vez, de quién es cada cosa se lee antes que qué es. El color agrupa; el
  monograma identifica (lo dice ya `tokens.css`, accents).
- **Decisión:** 146, quinta vuelta; Marco cerró el diseño con ella.

### 8. La ficha de día: número grande, día y mes al lado. DECIDIDO

Una ficha por día con algo; dentro, dos cosas como mucho y «+1». La misma forma que la pieza de hora y fecha (regla 5).
- **Por qué:** una forma por idea. El calendario de papel ya se sabe leer.
- **Decisión:** 146 (pedido de Marco: «fichas con el mes y una por día») y 13-11 noche (b). Candidata a vista del
  Planificador (148, sin decidir).

### 9. Lo que se repite se dice en una cifra; las filas, solo lo que pesa. DECIDIDO

Lo que espera abre con una pastilla por tipo y su cifra (llamadas, respuestas, tareas, cobros). Debajo, solo las filas
de más peso: tres un día normal, cinco un día sin nada, ninguna el día de bolo (las pastillas se quedan siempre).
- **Por qué:** la cifra dice cuánto sin pedir leer; la fila es para lo que se va a hacer ahora.
- **Decisión:** 144 (a) y boceto final. Ver ADR-202 § Abierto: 144 (a) decía «una línea el día de bolo» y el boceto
  pinta solo las pastillas.

### 10. La puerta es la pieza, no un enlace escrito. DECIDIDO

Las cabeceras de bloque no llevan «Ver todo» ni «Planner →». Cada ficha abre su día en el Planificador; cada pastilla
abre su lista (llamadas y respuestas en Conversaciones, el cobro en Cuentas, las tareas en la suya). Lo que viene acaba
en una ficha final «Planner →».
- **Por qué:** en el móvil las secciones ya están fijas abajo; una puerta escrita repite la barra.
- **Decisión:** 146 (1), y 13-11 noche (b) para la ficha final.

### 11. La cabecera de bloque es la voz del margen. DECIDIDO (ya vigente)

Mono, mayúsculas, tinta suave, sin raya debajo. Es lo único en mayúsculas mono de un bloque.
- **Por qué:** nombra sin competir con lo que nombra.
- **Decisión:** ADR-145 § 3; el boceto la mantiene.

### 12. El retraso se dice en color solo en el metadato. DECIDIDO (por el boceto)

«2 días tarde», «vence hoy» van en el tono de aviso, en la línea pequeña. Nunca el título, nunca un relleno.
- **Por qué:** una sola cosa llama (regla 1); el aviso tiñe una palabra, no una pieza.
- **Decisión:** boceto final, cerrado por Marco. Tokens: la familia de estado que ya existe (`--warning`,
  `--tone-warning-fg`).

### 13. Lo de ahora va al alcance del pulgar. DECIDIDO (por el boceto)

Las acciones de la pieza llena (Llamar, Mapa, Hoja) van en una fila a todo el ancho, de igual tamaño, al pie de la
pieza.
- **Por qué:** el día de bolo el teléfono se usa con una mano.
- **Decisión:** boceto final, día de bolo; recoge las tres acciones de Ahora (ADR-146 § 1).

### 14. Calma es una marca, la misma en todos los temas. DECIDIDO

La onda que se aquieta (path `M1.5 8c1.1-3.6 2.9-3.6 4 0c.9 2.3 2.4 2.3 3.3 0H14.5`, viewBox 16), en trazo
`currentColor`, dentro de un círculo: apagada, contorno; encendida, círculo lleno con la marca en negativo. El grosor
del trazo es una variable del tema. En el móvil, calma va en la barra de arriba.
- **Por qué:** una palabra cambia con el idioma y el tema; una marca no. Y un tema punk la engorda sin redibujarla.
- **Decisión:** 13-11 noche (a); calma a la barra de arriba, en el DECIDIDO de quitar la hoja del reloj.
- Qué hace calma en Hoy (dejar el día, lo que viene y las pastillas, sin filas) está PROPUESTO.

### 15. Buscar y acotar, un solo campo. DECIDIDO

Sin acotar, el campo dice «Search everything». Acotado, lleva lo acotado dentro como una etiqueta con su × y el campo
dice solo «Search». No hay pastilla de ámbito en la fila del título.
- **Por qué:** una puerta por gesto, y que el ámbito se vea donde se busca.
- **Decisión:** 146, «DECIDIDO por Marco (13-11, noche): el punto (5), en toda la app».

### 16. El ámbito acota todo; lo tuyo de fuera se cuenta; un aviso no se acota. DECIDIDO

Acotado, también se acota lo personal: la agenda y la pieza de Hoy, lo que viene, el pulso del raíl. Si algo tuyo de
hoy queda fuera, una línea lo dice debajo de la pieza («1 más hoy fuera de MaMeMi»), contando solo lo de la persona.
Los avisos (el técnico que llega tarde, una opción que vence hoy) salen siempre.
- **Por qué:** quien lleva muchas compañías trabaja acotado a una y espera ver solo esa; una regla que se dice en una
  frase. La línea y los avisos evitan que acotar esconda algo urgente.
- **Decisión:** 145, y 146 segunda tanda (c).

### 17. Un tema cambia tokens, nunca la estructura. PROPUESTO

Qué bloques hay, su orden, una sola superficie llena y la hora a la vista son del sistema. Un tema cambia lo que se
expresa en tokens: color, tipografía, grosor de trazo, radios, cómo es la superficie llena.
- **Por qué:** 4 a 8 temas de verdad distintos solo son posibles si ninguno toca la composición.
- **Estado:** principio propuesto en la 147 (13-11), sin cerrar por Marco. Las reglas 1 a 16 ya están escritas para
  cumplirlo.

## Contra los cinco principios (`03_AGENCY/_area-methød/code/philosophy.md`)

- **Medio nativo:** la tira de lo que viene es `overflow-x` con `scroll-snap`; la marca de calma, un `<svg>` con
  `currentColor`. Nada que el navegador ya haga.
- **Defaults bajos:** las tres alturas (regla 2) son contextuales en `tokens.css`; un componente las lee, no las
  redefine.
- **Contratos de variables:** la pieza llena declara su superficie y su tinta, y lo que va dentro las hereda: el
  monograma sobre la pieza llena retoca `--identity-tint-base` en ese ámbito, no se pinta aparte.
- **Taxonomía:** tres alturas, una por categoría de tiempo (ahora, otro día, pendiente). Si una pieza duda entre dos,
  la pieza está mal definida.
- **Nombres por rol:** la superficie se llama por lo que es (foco), no por su color (índigo).

## Tokens que faltan: trabajo para el carril de construcción

No se tocan en esta tarea. El carril los añade en `tokens.css`, en claro, oscuro y `stress`, antes de usarlos:

- **La superficie llena y su tinta.** No existe. `--bg-ultra-dark` es casi negro y la regla 1 pide otra cosa. Nombre
  por rol, por ejemplo `--surface-focus` y `--surface-focus-ink`, derivados de los tonos base (la guarda prohíbe
  `--primary` en un componente).
- **Tres tamaños display con nombre:** la hora del marco, la cosa y su hora en la pieza llena, el número de la ficha.
  Hoy el reloj lee `--text-xl` (20 a 25 px) y el boceto pinta 38, 34 y 30 px a 390. Ningún token de la escala actual
  es un rol de estos.
- **El grosor del trazo de una marca dibujada** (`--mark-stroke` o el nombre que el carril elija): hoy solo están las
  `--line-*` generales, y la regla 14 pide que un tema lo cambie sin tocar las rayas.
- **El ancho de una ficha de la tira** (el boceto, 37 % del ancho, para que asome la tercera).

## Lo que no es regla todavía

En ADR-202 § Abierto, con la recomendación de cada punto: la cabecera en dos filas, el texto de «Nothing today», el
nombre del tercer bloque, cuánto de Ahora cabe en la pieza, los plegables y qué hace calma en Hoy, guardados y
recientes del ámbito, Ahora en escritorio, y si el pulso permite contar lo tuyo fuera del ámbito.

## Cuándo se revisa

Al aplicar estas reglas a la primera pantalla que no es Hoy (147, momento 2), y con el segundo tema (147, momento 3):
lo que el tema punk no pueda decir sin tocar un componente es una regla mal escrita.
