# Hour · CHANGELOG

Lo que ha llegado a producción, contado para quien usa Hour. Hour no tiene versiones: va por meses, el más reciente
arriba. El cómo de cada cambio está en `_context.md`, `_decisions.md` y git. Empezado el 2026-10-09 con lo entregado
hasta entonces, sacado de esos documentos; lo anterior a julio de 2026 está solo resumido.

## Octubre 2026 (en curso)

- En la ficha de una persona, cada conversación abre la conversación. Y la interfaz en inglés ya no habla de «pipeline» ni de «leads»: dice «in progress», «notice» y «Outreach tracking». (2026-10-15, `6248c06`)
- Alguien del equipo se da de alta desde el reparto o desde «quién va»: escribes su nombre y «Añadir». Su ficha se edita (email, teléfono, cargo) y desde ella un admin la invita a Hour; al aceptar, su cuenta queda enlazada con esa ficha. (2026-10-14, `0e6f3ef`)
- La ficha de una conversación tiene el hilo del equipo, Equipo, en la columna lateral: lo que habláis entre vosotros sobre esa sala, aparte del registro con fuera, con lo nuevo marcado. «Todo en un hilo» lo junta todo por fecha. (2026-10-14, `0e6f3ef`)
- La ficha de una función tiene el tablón de su bolo: las funciones del trato y un hilo General más uno por cada faceta que puedes ver (Técnica, Logística, Comidas…), donde el equipo escribe y puede marcar a qué función se refiere. Lo nuevo desde tu última visita se marca, y los hilos sin mensajes quedan plegados al final. Quien no ve el dinero no ve su hilo. (2026-10-14, `ef53fcc`)
- Por dentro, Hour ya guarda hilos de conversación interna del equipo, por bolo, conversación, proyecto o línea y por faceta, y quién los ha leído; Logística, Comidas y Hoja de ruta existen también a nivel de proyecto. Aún sin pantalla: nada cambia para nadie. (2026-10-14, `b2b410b`)
- Por dentro, el acceso de cada persona vive solo en el modelo de facetas: fuera las tablas de membresía antiguas y los permisos de los roles, que ahora son solo etiquetas. Nada cambia para nadie. (2026-10-14, `8884feb`)
- Invitar a alguien a un proyecto le da un paquete de acceso (Mínim, Equip, Coordinació o Direcció; Mínim por defecto), no los permisos de su rol: el rol queda como etiqueta. Por dentro, el acceso de todo el mundo vive ya en un solo sitio, el modelo de facetas, y no cambia para nadie. Y la fila de invitar en Ajustes ya no se corta. (2026-10-13, `05f1c96`)
- Ajustes ya no pide un `sw.js` que no existe en cada carga. (2026-10-13, `071208a`)
- Una conversación de difusión es siempre con una organización y sus personas son sus contactos, uno de ellos el principal: Hour ya no guarda una persona fija por conversación. Las salas que estaban dos veces en MüK Cia (la Feria de Teatro de Ciudad Rodrigo y Circuito Claps) son ahora una sola, con las dos personas como contactos. (2026-10-13, `70660bb`)
- En Cuentas, quien paga una factura es la organización (la sala o quien programa), no una persona: el pagador se elige entre organizaciones, una factura hecha desde un bolo toma la de su conversación y sus datos fiscales, y un borrador avisa si a la organización le faltan datos fiscales antes de emitirla. Los datos fiscales de una organización se editan desde la conversación o desde el borrador. (2026-10-13, `816707f`)
- Lo que Hour deduce sobre ti se puede contestar: en el rail, bajo lo siguiente, «voy · no voy»; en la ficha de un ensayo, viaje o residencia, y en la de una función sin reparto, «Quién va» con cada persona deducida en cursiva, para confirmarla, retirarla o añadir a alguien del equipo. Cada uno contesta lo suyo; quien edita el Planner, por cualquiera. Un «voy» cuenta para los conflictos: si esa persona tiene una ausencia ese día, o dijo «voy» a otra cosa a la vez, el Planner lo avisa. (2026-10-12, `9e3835b`)
- En el historial de una conversación, lo que apuntas sale arriba al momento, aunque la lista aún estuviera cargando. (2026-10-12, `c5fdaac`)
- Las conversaciones de difusión son con la sala (la organización que programa), con sus contactos: la tabla de Conversations empieza por la organización, el alta pide primero la organización y la autocompleta, y si alguien de una sala que ya tiene conversación entra, se añade como contacto en vez de abrir otra. Los correos del Gmail entran en la conversación de la sala, también la respuesta de alguien que ya no está. (2026-10-11, `be17af8`)
- En el rail, cuando el próximo compromiso es deducido (nadie te ha puesto en él), solo su nombre va en cursiva. (2026-10-11, `be17af8`)
- En Cuentas, la lista de pagadores y las facturas creadas desde un bolo ya no muestran a la persona de una conversación privada de otra persona del equipo. (2026-10-11, `6cf690c`)
- Por dentro, cada conversación de difusión queda ligada a su organización y a sus contactos, el primer paso para que la conversación sea con la sala y no con una persona (ADR-102). Nada cambia todavía en pantalla. (2026-10-11, `f036b19`)
- En Conversations, cambiar de ámbito desde la ficha de una persona o de una conversación te devuelve a Conversations ya filtrado, en vez de mandarte a Desk; y «Add to project» solo ofrece los proyectos de ese ámbito. (2026-10-11, `9f867e4`)
- Desk se queda en lo cercano: los próximos 7 días, día a día; lo demás es una línea («Más adelante · 25 cosas hasta el 15 dic») que abre la Agenda, y una tanda de varios días sale como una sola fila. (2026-10-11, `d2fe32c`)
- En Desk, «Agenda» abre la Agenda del Planner en el día de esa entrada, y los días salen siempre abiertos. (2026-10-11, `35bf4c0`)
- Una conversación privada sigue siendo solo tuya aunque alguien del equipo vuelva a crear una con la misma persona: cada uno tiene la suya. (2026-10-11, `762192f`)
- La firma de los correos es tuya en cada compañía: Hour te propone una con tu nombre, tu rol y los datos de la compañía, la editas en tu perfil de ese espacio, y el buzón común firma con la de la compañía. (2026-10-11, `b42f799`)
- Cada persona puede conectar su Gmail, y un admin el buzón común de la compañía: los correos con los contactos de Hour entran solos en su conversación, se responde desde Hour con una firma propia, y la conversación se lee como historial o como un solo hilo. Las conversaciones nuevas nacen privadas salvo que el admin elija lo contrario. En modo prueba de Google (hasta 100 cuentas). (2026-10-11, `6c4cd0a`)
- Los permisos pasan por dentro al modelo de facetas (Conversaciones, Materiales, Técnica, Logística, Hoja de ruta, Comidas, Dinero), sin cambiar lo que ve cada persona. (2026-10-11, `6c4cd0a`)
- El directorio de salas pasa a 6.802 salas: más de España (Andalucía, Madrid, Valencia y el resto de municipios pequeños) y de Francia. (2026-10-11)
- La escaleta se edita en directo entre varias personas, como las notas, en la vista Día y en la ficha de la función o del ensayo; la presencia cuenta a cada persona una sola vez. (2026-10-11, `fffa2cd`)
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
