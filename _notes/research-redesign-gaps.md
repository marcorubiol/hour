# Research — Huecos y sobras (gap analysis para el rediseño)

> Fecha: 2026-07-04 · Sesión .zerø + Marco
> Motivo: rediseño de la app en marcha (la UI se ve densa/apretada). Pregunta guía: ¿el cliente puede hacer todo lo que necesita de forma **fácil y rápida**? ¿Qué falta, qué sobra?
> Método: superficie realmente construida a 2026-07-04 (rutas + componentes, post-maratón ADR-040→050) contrastada contra el ciclo real del cliente (difusión → hold → confirmed → producción → bolo → cobro), `build/competition.md § Gap analysis`, `_tasks.md`, `build/roadmap.md § Current next action` y `_notes/_flux.md § TAM levers`.

## Estado de partida (verificado)

El ciclo entero **ya se opera dentro de Hour** — 4 lenses vivas, write paths de engagement/performance/venue/invoice, road sheet con link público revocable, notas colaborativas. Eso está conseguido y no es poco.

Los huecos están en los **bordes del ciclo** (cómo entran y salen los datos de la app). El "sobra" está casi todo en el **shell** — y de ahí viene la sensación de app apretada, más que del CSS.

## Faltan — ordenados por cuánto bloquean el uso diario

### 1. Alta de datos desde la UI — hueco #1 [ya detectado, `_tasks.md` nivel 1a-1c]
Sin `POST /api/persons` ni `/api/engagements`, la difusión no puede *empezar* en Hour: un contacto captado en una feria no se puede meter sin SQL. Ídem delete de performance (1b) y edición de venue (1c — sin timezone, la dual-time del road sheet sigue coja). Nada importa más que este bloque. Relacionado: **quick capture** — apuntar "me ha dicho llámame en marzo" debería ser un gesto, no una navegación.

### 2. Salida al calendario real — ICS feed [NUEVO — propuesto para nivel 1]
Verificado: cero rastro de `.ics`/`webcal`/`text/calendar` en el código, ni mención en roadmap/deferred. Un artista vive en su Google/Apple Calendar; si los bolos confirmados no son *suscribibles*, alguien los copiará a mano y las fuentes divergirán. Barato: endpoint con token firmado, mismo patrón que el road sheet público (ADR-047). Probablemente la feature ausente con más valor diario por hora de trabajo.

### 3. Los follow-ups no te encuentran
`next_action_at` existe y se edita inline (ADR-040), pero el recordatorio solo vive dentro de la app, y solo si la abres. El oficio de la difusión ES el follow-up. Dos capas:
- **(a) Today debe liderar con "vencidas hoy / esta semana"** — hoy es la lens más floja de las cuatro: su propio header (`routes/h/[workspace]/+page.svelte:1-17`) declara datos parcialmente mockeados, engagements de un solo project/workspace (convención "1 project per workspace" en el código) y placeholders "—". Central para el rediseño: Today debería responder *¿qué hago ahora?*, no ser dashboard editorial.
- (b) Más adelante: digest por email de acciones vencidas (notifications in-app ya están en Deferred 0.4).

### 4. Registro de comunicación mínimo — el riesgo existencial de datos muertos
La difusión real pasa en Gmail. Si actualizar Hour es trabajo extra *después* del trabajo real, en semanas los datos están rancios y la herramienta muere de eso. El propio análisis TAM (`_flux.md § 2026-05-18`) señala comms (D4) como palanca #1. No hace falta D4 completo: el **BCC-archive estilo Basecamp** ya diseñado en la exploración de `share`/ADR-028 (`eng-xxx@in.hour...` vía Cloudflare Email Workers) es la versión mínima que cierra el loop. Medio plazo, pero nombrarlo ya en el plan de cierre.

### 5. El contrato como etapa del funnel
Entre `confirmed` y factura existe en la realidad: enviar contrato → firmado → contrafirmado. Hour no lo modela ni como estado ni como checklist. `build/competition.md § Strategic takeaways` lo dice explícitamente: estudiar los workflows de contrato/advancing/settlement de SystemOne/ABOSS/Overture. Para Phase 0 quizás basta un campo/checklist en performance; el hueco se ve cuando prometes "booking → production → invoicing".

### 6. Dinero: la mitad que falta
- **`expense` existe en schema (ADR-003) con cero UI** (verificado: solo aparece en `db-types.ts`). La pregunta real de una compañía pequeña por bolo es el **margen** (caché − viajes − hotel − dietas), no solo pipeline/invoiced/paid.
- **Fork estratégico pendiente**: ¿la factura de Hour es *registro sombra* (número manual, la oficial vive en Holded/gestoría — lo que es hoy con ADR-050) o *emisora real* (PDF + serie propia, hoy en Shelf)? Si algún día emite para clientes españoles entra territorio **Veri*factu / RD 1007/2023** — plazos vigentes sin verificar a fecha de esta nota, pero el fork debe decidirse conscientemente antes de Phase 1, no deslizarse.

### 7. Offline el día del bolo
El link público cubre al técnico de la sala; el propio equipo en la furgoneta sin cobertura necesita el road sheet **cacheado**. Está literalmente como checkbox sin verificar de Phase 0.0 en `_tasks.md` Deferred ("app abre offline con datos cacheados"). Verificarlo es barato y es el escenario de uso más hostil del producto.

### 8. Ferias (D7 — diferido correcto, pero con fecha)
La difusión 2026-27 real pasa por ferias este otoño (import de asistentes, cruce con contactos existentes). El diferido está bien; el piloto lo va a pedir antes de lo que el roadmap asume.

## Sobran (o pesan más de lo que aportan) — de aquí viene lo apretado

**Tesis para el rediseño: la densidad es arquitectura de información más que CSS.**

1. **La maquinaria multi-tenant siempre visible.** Plaza con todos los workspaces × projects cross-account + LineList siempre visible + focus mode + master view — para un uso diario de 1 workspace real, 1 project, 2 lines. El *modelo* es correcto (su audiencia real es el manager Phase 1 con N compañías — **no borrar**), pero su *visibilidad* debería escalar con el tamaño de la cuenta: con ≤1 workspace y ≤2 projects el sidebar casi no tiene derecho a existir; el filtro multi-select colapsa a un control compacto que aparece solo cuando hay algo que filtrar. **Progressive disclosure, no amputación.**
2. **Dual-timezone en todas partes** cuando la TZ del venue = la del usuario (o ni existe, porque venue aún no es editable — 1c): mostrar una sola hora cuando coinciden.
3. **10 kinds de line** en un dropdown cuando el uso real son 2 (tour/campaign): schema intacto, opciones visibles recortadas con "more…".
4. **JsonKV genéricos** (logistics/hospitality/technical): se leen como base de datos, no como herramienta — y `_flux.md § 2026-07-02 nota 2` ya detectó que logistics mezcla venue-facing con interno. Campos con opinión (get-in, catering, parking…) presentan e imprimen mejor en el road sheet. Es a la vez un sobra y un falta.
5. **`/booking` legacy y `/playground`** — a matar con el rediseño.
6. **Chrome de colaboración/presencia** para un equipo de 2: mantener, pero silencioso.

## Postura

- El plan existente (cerrar 1a-1c → **parar y usar ~1 mes**) es el correcto; el mes de uso real ordenará esta lista mejor que cualquier análisis.
- Añadir al nivel 1 de cierre: **ICS feed** (#2) y **Today reordenada a acciones vencidas** (#3a) — ambos determinan si la app se abre cada día, que es lo que el gate de 0.3 va a medir.
- Diseñar el rediseño desde las tres preguntas diarias — *¿a quién sigo hoy? ¿qué bolos vienen? ¿cómo va el dinero?* — con la maquinaria de filtros apareciendo solo cuando la cuenta crece.
- No dejar que el rediseño se convierta en construir todo lo que falta: #4-#8 se priorizan después del mes de uso.

## Addendum 2026-07-04 — Módulos y plantillas de line → ADR-055

La pregunta "las lines cambian según su kind" (que este análisis dejó abierta) se decidió el mismo día: **line detail = composición de módulos** (Calendar · Contacts · Road sheets · Notes · Materials · Money · People) y **creación de line por picker de plantillas** (Gira / Difusión / Creación / Prensa & comms / Feria / En blanco). Detalle completo y guardarraíl Airtable en `_decisions.md` ADR-055. Efectos sobre esta nota: el "sobra" #3 (dropdown de 10 kinds) queda resuelto por el picker; el módulo Money es donde aterriza el hueco #6 (UI de expenses); Feria da hogar incremental al hueco #8 (D7); Contacts ≠ People (conversaciones de venta vs equipo + gente de sala).

## Mapa de navegación del rediseño — un trabajo por superficie (2026-07-04)

Principio rector: **cada superficie responde UNA pregunta; si dos superficies responden la misma, una sobra.** La densidad se cura asignando trabajos, no quitando capas.

- **Today** — *¿qué hago ahora?* Acciones vencidas + próximos bolos + dinero que espera. Cross-workspace (resuelve el hueco #3a).
- **Lenses (Calendar · Contacts · Money)** — preguntas transversales de la compañía: *¿estamos libres tal día?* (un ensayo también bloquea — por eso ninguna line basta) / *¿quién es esta persona y qué conversaciones hay?* / *¿cómo va el negocio?* (pipeline, cobros, aging). **ABIERTO — decide Marco**: se plantea quitar Calendar y Money como lenses; su maqueta de home (2026-07-04) es Today como agenda cross-company (tasks/money/waiting/events) con **pins** de space/line como filtro y sin sidebar permanente. Pendiente: dónde viven la vista-mes y los agregados de dinero si las pills caen. Ver ADR-055 § Lenses ↔ módulos (pregunta abierta).
- **Line detail (módulos, ADR-055)** — *trabajar EN una línea*: sus fechas, su gente, su dinero, sus materiales. Line-first. Misma implementación que las lenses, scope y acciones distintas — dos puertas, cero duplicación de código.
- **Sidebar (Plaza + LineList)** — filtro + navegación, visible en proporción al tamaño de la cuenta (progressive disclosure — resuelve el sobra #1).
- **⌘K (Phase 0.4)** — salto directo a cualquier entidad; permite esconder aún más chrome.

Si tras el mes de uso del gate 0.3 una lens no se abre nunca, se mata con esa evidencia — no antes.

## Verificaciones hechas (para no re-derivar)

- `grep -ri "\.ics|webcal|text/calendar"` sobre `apps/web/src` → nada. Sin export de calendario.
- `expense` → solo `lib/db-types.ts`. Sin UI de gastos.
- `pdf` → solo una mención en settings. Factura sin PDF (coherente con Shelf de `_tasks.md`).
- Today (`routes/h/[workspace]/+page.svelte`): header declara mocked/placeholders; engagements scoped al primer project del workspace de la URL; cross-workspace aggregation "deferred to Phase 0.2" según comentario (posiblemente desfasado — verificar al rediseñar).
- Rutas construidas: 4 lenses + engagement/person/project/line/performance/roadsheet + settings + public roadsheet + login/offline/playground/booking(legacy).
