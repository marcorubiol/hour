# Hour · CHANGELOG

Lo que ha llegado a producción, contado para quien usa Hour. Hour no tiene versiones: va por meses, el más reciente
arriba. El cómo de cada cambio está en `_context.md`, `_decisions.md` y git. Empezado el 2026-10-09 con lo entregado
hasta entonces, sacado de esos documentos; lo anterior a julio de 2026 está solo resumido.

## Octubre 2026 (en curso)

- En el móvil, Ajustes se navega desde una banda arriba y sus filas ya no desbordan, y la agenda del Planner usa todo el ancho, con cada semana en una línea. El Access desk de Workspaces se lee de izquierda a derecha, sin huecos dentro de su marco. (2026-10-10, `a6c5695`)
- Directorio de salas: al vincular el lugar de una función se puede buscar entre 4.659 salas públicas de España y Francia (teatros, auditorios, salas polivalentes, casas de cultura y ateneos) y adoptarla en vuestro espacio con un clic. Solo datos públicos, con sus fuentes y licencias en «Créditos y licencias». (2026-10-10, `3649036`)
- Hour habla francés, además de catalán, castellano e inglés, según el idioma del navegador. Cuentas, la ficha de la función, el editor de salas, el Planner, Conversations, Ajustes y las fechas ya salen enteros en el idioma de la app; la hoja de ruta pública, en el del navegador (inglés si no es uno de los cuatro). (2026-10-10, `3649036`)
- El Hall saluda por tu nombre de pila, el del perfil, y el menú de cuenta muestra tu nombre completo. (2026-10-10, `3649036`)
- En el diario del Planner, pedir meses anteriores ya no se pierde si la app estaba buscando lo que viene. (2026-10-10, `2f48370`)
- Al crear o editar una función se elige su bolo (el trato con la sala); con un solo bolo abierto se propone solo, y la ficha enlaza al bolo en Cuentas. (2026-10-10, `6d5276c`)
- La escaleta: el orden del día de una función o de un ensayo, con sus momentos y horas, se escribe en la vista Día y en la ficha de la función, se reordena a mano y sale en la hoja de ruta, también la pública. (2026-10-10, `6d5276c`)
- Los viajes tienen origen, destino y tramos (tren, coche, avión…), cada uno con su hora en la zona de su lugar; el lugar se elige entre pueblos, ciudades, aeropuertos o vuestras salas, nunca se adivina. (2026-10-10, `6d5276c`)
- Hour se usa en el móvil: el menú se abre tocando el reloj y Conversations se lee en fichas compactas. (2026-10-10, `6d5276c`)
- Cada conversación guarda su historial: cada contacto (email, llamada, reunión, mensaje o nota) queda apuntado con su fecha y su texto, y se ve desde la celda «Last contact». «Contacted today» pasa a ser «Log contact…». (2026-10-09, `3f6eb44`)
- Los datos de muestra salen del espacio de MüK Cia: queda solo vuestra lista real de contactos de difusión. (2026-10-09)

## Septiembre 2026

- La gira deducida dice que es deducida y de qué viajes sale («deducida · ida 7 oct · vuelta 12 oct») en el mes, la agenda, el día y el Tablero, y se llama «de gira» en vez de «fuera». (2026-09-26, `a67e99c`)

## Agosto 2026

- El estado de un bolo se puede cambiar (propuesto, hold, confirmado…); antes todo bolo creado desde Hour nacía confirmado y se quedaba así. (2026-08-29, `795b6a5`)
- Funciones de varios días: el alta permite «varios días» y el mes dibuja la tanda como un solo elemento. (2026-08-29, `795b6a5`)
- Una función solo puede colgar de un bolo de su mismo proyecto. (2026-08-28)
- El rail ya no salta de altura cuando el próximo show tiene un nombre largo. (2026-08-27, `ad3cf67`)
- El Planner nuevo: día, agenda, mes y tablero, con una sola tarjeta para todo, carriles por persona, notas privadas en el margen y el próximo compromiso siempre a la vista en el rail. (2026-08-10/11, `ea2db77`)

## Julio 2026

- Personas como eje del Planner: ver la agenda de una persona, y enlazar tu login con tu ficha de persona desde Ajustes → Perfil. (2026-07-30, `0f8e12f`)
- Editar la fecha de un evento desde la propia app. (2026-07-30, `0f8e12f`)
- Más seguridad en Books: los datos fiscales (IBAN, NIF) solo los ve quien tiene acceso al dinero, un doble clic ya no duplica un cobro y el login frena los intentos repetidos. (2026-07-25, `252729f`)
- Books ya no se queda en «Cargando…» con los datos llegados. (2026-07-24, `ff6ec4e`)
- Selector de color de identidad con diez tonos y aviso de colores parecidos; el Hall, traducido entero a catalán, inglés y castellano. (2026-07-24, `a643620`)
- Books (antes Money): el bolo como unidad de dinero, facturas y proformas con numeración correlativa, pagos separados de la factura, cobrado y vencido calculados solos, e impuestos por país. Un vencido crea una tarea en Desk. (2026-07-23, `a35e8c4`)
- Planner con disponibilidad, viajes y conflictos; organizaciones y personas propias de cada espacio, con un perfil que se comparte solo si tú quieres. (2026-07-20, `4499848`)

## Antes de julio de 2026

- Abril a junio: el esqueleto. Esquema multi-espacio con RLS, la app en SvelteKit sobre Cloudflare, road sheets con edición colaborativa, el Hall, Desk, Conversations y los primeros módulos. El detalle punto por punto no está escrito en ningún documento; está en git.
