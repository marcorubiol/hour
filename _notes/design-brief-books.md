# Books · Cuentas — Brief de rediseño de la lente de dinero

## 1. Qué es y a quién sirve

Books (ES **Cuentas**, FR/CA Comptes) es la lente de dinero de Hour, un SaaS para compañías pequeñas de artes escénicas en vivo (teatro, danza, circo, música). **No es contabilidad.** La contabilidad real (IVA, IRPF, nóminas, impuestos) se externaliza pronto a una gestoría que trabaja FUERA de la app. Books sirve al usuario diario —la persona de difusión/booker/dirección que cierra los bolos— para dos trabajos y solo dos: (1) un **radar de cobro** ("de los bolos que vendí, cuáles están facturados, cuáles cobrados, cuánto neto llega y a QUIÉN reclamo") y (2) un **handoff limpio** a la gestoría. Books se detiene ANTES de la facturación legal certificada. La persona es un artista-operador, no un perfil financiero. El tono es editorial, calmo, opinado — una cuenta que llevas a mano, no un dashboard financiero que se informa a sí mismo.

## 2. La ÚNICA pregunta que responde la pantalla

> **"De los bolos que vendí, ¿quién me debe, quién va tarde, y cuánto me va a llegar de verdad?"**

Todo por encima del pliegue sirve a esa frase. Books abre como un radar de lo pendiente, no como un informe de lo ocurrido. Si en 3 segundos, sin tocar nada, la persona no sabe a quién reclamar esta semana, el diseño falla.

## 3. Jerarquía de la información (por moneda, nunca sumadas)

Las monedas **jamás** se suman. Casi siempre hay una; una segunda se apila debajo con su propia línea, visualmente igual, nunca fusionada. En la sub-tira "pulse" del LensHeader viven los totales como fragmentos de una línea, mono, que enlazan al listado filtrado — **ese es todo el "totales"**, no hay banda de KPIs.

- **HÉROE — Te deben / Vencido (el número de acción).** El bruto pendiente de cobrar lidera. Debajo, como subconjunto en el único acento cálido de la página, el vencido con su cuenta de bolos: `Te deben 18.400 € · 6.200 € vencido · 2 bolos tarde`. Tocar el vencido filtra a los tardíos.
- **SECUNDARIO — Por llegar, neto.** El neto-después-de-impuestos que el pagador transferirá de verdad, más pequeño y apagado: `por llegar · neto 12.200 €`.
- **ACCIÓN — reclamar.** El vencido nace en la fila como tarea de seguimiento a Desk (ver §5).
- **DEGRADADO (3.º/4.º) — Cobrado (historia, plegado) y Pipeline** (holds sin confirmar): nunca en la banda héroe, nunca sumado al "te deben". Pipeline es una cola tenue al fondo: `Pipeline · 3 holds · 9.000 € si se confirman (sin contar)`.

**Doble verdad de altitud:** en la banda global lidera *lo que te deben*; en cada fila lidera *el bruto (el caché)* como identidad. El bruto siempre domina visualmente; el neto va detrás, honesto y menor.

## 4. El objeto central: el **bolo**

El bolo (ADR-087) es la unidad de dinero: un contrato con una sala = un caché, un pagador, una factura, agrupando 1..N **funciones** (las funciones son solo calendario/logística; el dinero vive en el bolo). Regla: "si cambia el dinero o cambia la sala, es otro bolo". **La fila ES el bolo.** Se acaban las secciones paralelas (banda de totales · rolls por obra · cards de caché · Documentos · Gastos) que triplicaban cada cifra. Books es **una sola columna vertical de bolos**, leída como asientos de un libro de cuentas.

**Anatomía de la fila/card** (hairline, radius, fondo suave, aire generoso), de izquierda a derecha:

- **Punto de acento + monograma de la obra** al margen: el ID y la señal de agrupación (nunca un relleno).
- **Sala · ciudad · N funciones** — la identidad del bolo es la sala (venue-first). Fecha(s) en mono tenue: `3 funciones · 12–14 mar`.
- **CACHÉ (bruto)** en serif display, tabular-nums, el número mayor de la fila — el titular, editable in situ. Debajo, hairline: `→ neto 3.645 €` en mono apagado.
- **Línea de estado como frase, no como pill:** un glifo de arco lleno que lee la fracción del viaje del dinero (`○ en conversación · ◔ vendido · ◐ facturado · ◕ parcial · ● cobrado`) + palabra llana + cláusula de deuda + cláusula de aging solo si tarde: `◐ Facturado · te deben 4.500 € · 21 días tarde`. El aging deriva del estado (`within`/`approaching`/`past-expected`); su procedencia (contractual vs esperada) se susurra en hover.
- **Una acción primaria contextual** al borde vivo (ver §5); el resto tras `⋯`.

**Agrupación por obra = señal, no informe.** Los bolos de una misma obra se agrupan bajo una costura fina (punto + monograma + nombre en serif pequeña) que carga como mucho **una** micro-cifra derivada: la del radar (`te deben 4.500 €`), nunca el roll de cuatro columnas contratado/cobrado/pendiente/neto. Cuando el orden ≠ por-obra (p. ej. por retraso), la costura se degrada a punto de acento en cada fila y desaparece la cabecera pegajosa: la agrupación nunca pelea con el orden por urgencia.

## 5. Momentos y acciones (primaria/secundaria)

Books no tiene CTA de página primaria: es un radar, no un flujo de creación. Los cuatro momentos, en orden de una semana real:

- **GLANCE (diario, 10 s).** El orden por defecto = el gradiente de ansiedad: **tarde primero** (deuda más vieja arriba), luego por vencer, luego por facturar, luego cobrado (plegado y atenuado, `12 cobrados · 38.400 €`). La página se reordena sola en torno a la pregunta. Los toggles (por fecha, obra, caché) existen, pero *deber-y-tarde* es la postura de apertura.
- **CHASE (semanal — el trabajo más afilado).** Las filas tarde ya están arriba; cada una expone **una** acción inline: **`Reclamar →`**. Un gesto engendra la tarea de seguimiento a Desk **pre-compuesta** (bolo + pagador + importe vencido + días tarde, título tipo *"Reclamar Teatro Central — 4.500 € · 21 días tarde"*). Consent-first: el sistema redacta, la persona confirma; la fila pasa a `reclamado · avisado hoy` con reloj de servidor. Clic en el pagador abre su identidad fiscal y la conversación enlazada: se reclama *a través de la relación* (Conversations), no con un cliente de correo propio.
- **RECORD (por evento, 20 s).** (a) **Fijar/editar caché** inline sobre el número bruto, sin diálogo (ADR-043). (b) **Registrar cobro**: hoja compacta, importe (por defecto el pendiente), fecha (hoy), método. El cobro está **desacoplado de la factura** (money v3): se puede registrar sin documento alguno; si existe, es un checkbox tranquilo, nunca una barrera. Anticipo + resto funcionan solos. Los **gastos** son el espejo: `+ gasto` por bolo, no una sección — se pliegan en el neto de ese bolo.
- **HANDOFF (mensual/trimestral — el guardián de la frontera).** Acción secundaria y tranquila en el LensHeader: `Handoff a gestoría →`. Elige ventana (trimestre/gira/rango), muestra un **manifiesto de solo lectura** (bolos, caché, desglose de impuestos, neto, cobros con fecha/método, documentos emitidos, gastos con contraparte; subtotales por moneda, nunca fusionados) y **exporta** un paquete limpio (PDF/CSV + los PDF de factura/proforma en house-style). Books es un **mensajero**, no un motor de informes: no produce P&L ni libro mayor. Ese export es lo que hace *cierta en la UI* la promesa "Books no es contabilidad": el artefacto contable sale del edificio.

**Documentos y Gastos NO son secciones** — son facetas del bolo. La factura/proforma es un chip mono dentro de la fila (`proforma #2026-014 · emitida`); los gastos ligados a un bolo se pliegan en su neto. Solo un gasto sin bolo (overhead general) vive en un cajón fino y plegado al fondo.

## 6. Tono y dirección de arte (tokens de Hour)

- **Tres pesos de dinero, rankeables por el ojo antes de leer etiqueta:** serif display (**Newsreader**) = el caché bruto, la identidad/valía, casi tinta plena. Mono (**JetBrains Mono**, `tabular-nums`) apagado = neto y derivados. Mono cálido = actúa ya. Regla del ojo: *serif = valía, mono-apagado = neto/derivado, mono-cálido = reclama*. Cuerpo y etiquetas en **Inter**.
- **Vencido = calor, no alarma.** Prohibido el rojo de semáforo (nada de pills/filas/fondos rojos). El vencido se lee con: un **hairline cálido** al margen izquierdo (`--warning`, ámbar), engrosado ~1px, como una marca a lápiz; la **frase de aging en palabras** (`21 días tarde` en `--warning-dark`); y **peso, no saturación**, en la cifra debida. Escalada gradual: *por vencer* (`vence en 4 días`, apagado) → *vencido* (hairline + frase ámbar) → *muy vencido* (60+ días: la frase se hunde a `--danger` solo como tinta, más `→ Reclamar`). Tres filas tarde = tres marcas cálidas que se *sienten* en la periferia; cero = una columna serena y monocroma.
- **Impuestos, ligeros y genéricos.** Nunca un formulario IVA/IRPF fijo. En reposo solo `bruto → neto`; el impuesto vive dentro de la flecha. En hover/expand se despliegan **líneas de impuesto firmadas**, genéricas y por país: `base 4.000 · + IVA 21% 840 · − ret. 15% −600 · neto 3.240`. El signo es el sistema (`+` añade, `−` retiene, `— exento · motivo`). España es solo el primer preset que rellena *etiquetas*; el layout es agnóstico (un bolo francés muestra `+ TVA / − retenue`, uno transfronterizo `— exento`, sin cambio de layout). Nunca columnas nombradas.
- **Ritmo:** una columna medida, ~72ch, márgenes generosos, un beat por bolo, densidad baja — una página que lees de pie con un café, no una hoja de cálculo. Un divisor hairline `— al día —` separa "te necesita" de "en reposo".
- **Movimiento casi nulo y solo diegético.** Registrar cobro: la cifra debida se funde hacia abajo y la marca cálida se apaga (~200ms), luego la fila se desliza a la cola de cobrados (~300ms) — ves saldarse una deuda. Sin entradas animadas, sin count-ups, sin confeti, sin skeletons ruidosos. Respeta `prefers-reduced-motion`.
- **Modo calma** (existe en Hour): pliega cada bolo a una línea (sala · caché en serif · una palabra de estado); quita neto, impuestos, fechas, chips; monocromo salvo la marca cálida (desaturada un paso). La tira pulse se reduce a un fragmento: la línea te-deben-y-tarde, o `todo al día`. Calm Books es la respuesta a "¿estoy bien?" de un vistazo.
- **Estados vacíos, editoriales, nunca sad-SaaS.** Sin bolos: una línea en serif centrada alta — *"No hay bolos todavía. Cuando cierres uno, aquí llevas la cuenta."* — con una acción tranquila debajo, sin mascota ni drop-zone. Todo cobrado: `— todo cobrado —` como regla serif tenue, la recompensa emocional de la lente, un exhalar quieto, no un check verde.

## 7. DO / DON'T

**DO**
- Una sola columna de bolos, ordenada por quién-debe-y-va-tarde por defecto.
- El caché bruto (lo que vendiste) lidera cada fila en serif; el neto va detrás, menor.
- "Te deben / vencido" como número héroe y como único fragmento de la tira pulse.
- Estado como glifo + frase llana (`Facturado · te deben 4.500 € · 21 días tarde`).
- Reclamar como acción primaria de fila que nace en la card y viaja a Desk, consent-first.
- Impuestos como líneas firmadas y genéricas, colapsadas entre bruto y neto.
- Monedas apiladas, cada una su fragmento; el handoff como export que *sale*.
- Documentos y gastos plegados dentro de su bolo.

**DON'T**
- Nada de banda de KPIs / grid de tiles / rolls de cuatro columnas por obra.
- Nada de gauges, donuts, anillos, sparklines, barras de progreso, tablas densas con zebra.
- Nada de pills de semáforo ni rojo de alarma; el vencido es ámbar al margen + palabras.
- Nunca sumar monedas — que sea *estructuralmente imposible* renderizar un total combinado.
- Nada de formulario IVA/IRPF fijo ni columnas nombradas por país.
- Las palabras **Fiscal / Contabilidad / VAT/IRPF-como-columna / receivable / vencido-pill** no aparecen en reposo.
- Ninguna cifra en dos sitios: cada número tiene un solo hogar (bruto en el bolo, te-deben en la pulse).
- Nada de cromo de finanzas: sin `$` apilados, sin flechas verde/rojo arriba/abajo, sin "vs mes pasado", sin azul QuickBooks.

## 8. Copy de ejemplo (cifras, etiquetas, estados)

| Elemento | EN | ES |
|---|---|---|
| Título de lente | Books | Cuentas |
| Fragmento pulse | Owed 18,400 € · 6,200 € overdue · 2 late | Te deben 18.400 € · 6.200 € vencido · 2 tarde |
| Previsión | coming · net 12,200 € | por llegar · neto 12.200 € |
| Identidad de fila | caché | caché |
| Sub-cifra de fila | → net 3,645 € | → neto 3.645 € |
| Estados de glifo | held · sold · invoiced · partial · collected | en conversación · vendido · facturado · parcial · cobrado |
| Aging | 21 days late / due in 9 days / not yet invoiced / paid 2 May | 21 días tarde / vence en 9 días / sin facturar / cobrado 2 may |
| Acción (vencido) | Chase → | Reclamar → |
| Acción (por cobrar) | Record payment | Registrar cobro |
| Acción (sin facturar) | Create invoice | Crear factura |
| Confirmación reclamo | chasing · nudged today | reclamado · avisado hoy |
| Impuestos | base 4,000 · + IVA 21% · − ret. 15% · net 3,240 | base 4.000 · + IVA 21% · − ret. 15% · neto 3.240 |
| Pipeline | Pipeline · 3 holds · 9,000 € (not counted) | Pipeline · 3 holds · 9.000 € (sin contar) |
| Cobrado (plegado) | Settled this season · 12 · 38,400 € | Saldado esta temporada · 12 · 38.400 € |
| Handoff | Handoff to gestoría · 8 ready · export | Handoff a gestoría · 8 listos · exportar |
| Vacío | No bolos yet. Close one and you keep the count here. | No hay bolos todavía. Cuando cierres uno, aquí llevas la cuenta. |
| Todo cobrado | — all collected — | — todo cobrado — |

**El test de cualquier píxel:** (1) ¿lidera el bruto —lo que vendí—? (2) ¿encuentro quién va tarde en 3 segundos sin clicar? (3) ¿sentiría una gestoría que esto es *su* herramienta? Si huele a compliance, columnas o contabilidad, está mal. Books es de la persona artista-operadora: la cuenta que lleva para saber que cobrará — y luego entregar. Calma, editorial, un solo filo cálido.