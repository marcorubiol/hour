# Plan: comms, carril 2. Hilos con facetas, segundo corte (ADR-099)

> 2026-10-22. Solo plan: sin código, sin migraciones, nada aplicado. Rama `claude/night-plans`. Marco lo lee antes
> de construir (`_tasks.md`, «Comms, carril 2», opción a del 14-10).
> Fuentes: `_context.md`; `build/structure-model.md`; `build/architecture.md`; `_decisions.md` ADR-082, 083, 085, 099,
> 100, 103, 104 a 107, 116, 126, 134, 138 a 140; `build/plans/2026-10-14-comms-threads.md` (el plan del primer corte);
> `origin/claude/comms-mock` (`e377a133`); `origin/feat/comms-threads` (`0f1ff5c4`); `supabase/migrations/` y
> `apps/web/src` en `origin/main` (`ad7a9cc6`); producción consultada en solo lectura el 2026-10-21 (noche). Lo que
> no se pudo comprobar va marcado como **suposición**.

## La idea, en una línea

**El primer corte de hilos ya está construido y en producción desde el 14 y 15-10** (plan del 14-10, ADR-106 y 116):
la entrada de `_tasks.md` que pide «primero un plan» está desfasada. Lo que falta no es más hilo, es **gente que lo
lea**: hoy cada espacio real tiene una sola membresía (Marco), `muk-cia` no tiene bolos, y un técnico invitado «para
una noche», que es para quien se hizo el tablón, no puede llegar a él. Este plan es el segundo corte: **el equipo de
una noche**.

## 1. Estado de hoy, verificado

### 1.1 Lo construido (primer corte)

| Pieza | Dónde | Estado |
|---|---|---|
| `thread` (un ancla de cuatro: proyecto, línea, bolo, conversación; faceta opcional; perezoso), `message` (autor = login, función opcional, borrado blando), `thread_read` | `20261014100000_comms_threads` | Producción, `b2b410b` |
| Lectura: `private.thread_readable` (conversación, General por la cadena, faceta por la cadena y activa); `message` hereda | misma | Producción |
| Escritura por RPC: `post_message` (solo anclas `bolo` y `conversation`), `edit_message`, `delete_message`, `mark_thread_read`; `thread_audience`; `bolo_board(p_performance_id)` sin dinero | misma | Producción |
| Logística, Comidas y Full de ruta también en proyecto (ADR-106 § 2) | misma | Producción |
| Tablón del bolo en la ficha de la función (`BoloBoard` en `PerformanceRecord`, también dentro del vistazo de función, que monta el mismo `PerformanceRecord`) | `ef53fcc` | Producción |
| Hilo del equipo en la ficha de la conversación (`ThreadBlock` en `ConversationRecord`) | `0e6f3ef` | Producción |
| `thread_feed` (ADR-116), absorbido por `conversation_feed` (`20261021100000`, ADR-138 fase 3): «Todas» mezcla conversaciones e hilos, chip Equipo | `0181d26`, 21-10 | Producción |
| Refresco al foco y cada 30 s, sin realtime | `THREAD_REFRESH_MS` en `BoloBoard` y `ConversationFeed` | Producción |

### 1.2 Producción (solo lectura, 2026-10-21)

| Espacio | Hilos | De bolo | De proyecto o línea | Mensajes vivos | Bolos vivos | Membresías | Facetas propias / ajustes |
|---|---|---|---|---|---|---|---|
| `muk-cia` (real) | 0 | 0 | 0 | 0 | **0** | 1 (espacio, Marco) | 0 / 0 |
| `marco-rubiol` | 0 | 0 | 0 | 0 | 17 | 1 (espacio) | 0 / 0 |
| `testing` | 4 | 0 | 0 | 11 | 1 | 1 (espacio) | 0 / 0 |
| `playwright` | 569 | 457 | 0 | 256 | 6 | (fixtures) | 1 / 2 |

Ninguna membresía de línea, bolo o función en ningún espacio. Nadie ha escrito un hilo real. Cambiar el esquema de
hilos no arriesga datos de nadie.

### 1.3 Lo que no existe

1. **Invitar a un bolo o a una función.** `workspace_invitation` solo lleva espacio y, opcional, proyecto con paquete
   (`project_preset`). `grant_container_preset` escribe membresías de cualquier nivel, pero ninguna pantalla lo llama
   (solo aparece en `db-types.ts`).
2. **Un miembro de bolo no puede abrir el tablón.** `bolo_board` le deja pasar (mira `model_container_verb_at` en la
   función, que sigue la cadena), pero la ficha de la función se lee por PostgREST y `performance_select` pide
   `has_permission(project_id, 'read:performance')`, que solo mira membresías de espacio y de proyecto (verificado en
   `pg_policies`). Es el riesgo que el plan del 14-10 dejó apuntado («una membresía de bolo da el tablón, no la ficha
   de función»), y hoy es un agujero de producto: la persona entra y no ve nada. Lo mismo, **suposición**, con la
   sala: `venue_select` pide `is_workspace_internal_member`, y no está comprobado qué rol de espacio deja una
   invitación de bolo.
3. **Pantalla de facetas por espacio** (`_tasks.md`, «Facetas configurables», Marco 11-10). `workspace_facet_setting`
   existe; ningún fichero de `apps/web/src` la lee fuera de `db-types.ts`. Las etiquetas de conversación (ADR-138 fase 4)
   sí tienen pantalla en Ajustes: es el molde.
4. **Señal fuera de la lente.** Desk enseña hilos con nuevos en «Ha cambiado» (ADR-121, 134 § 7), pero «Lo siguiente»
   (la próxima función) no dice que su tablón tiene mensajes. Sin avisos ni correo (ADR-106 § 6).
5. **Hilos de proyecto y de línea**: el esquema los admite; `post_message` y la lectura común solo abren bolo y
   conversación.
6. **Deuda:** un override de faceta no queda en `audit_log` (`membership_facet` no tiene `id`, `_tasks.md`).

### 1.4 Material de las ramas, qué sirve ahora

| Material | Para este corte |
|---|---|
| `claude/comms-mock`, `DayBoardMock`: variante «b» (Técnica en cada función) y «lado a lado» | Descartadas por ADR-099 § 6. No vuelven |
| `claude/comms-mock`, cabecera «Bolo · sala · ciudad · días · N funciones · N del equipo» | **Sirve**: «N del equipo» es justo lo que falta; hoy la cabecera no dice quién está |
| `feat/comms-threads`, `app design/operator-invite-flow-prototype.html`, `revoke-access-prototype.html`, `permissions-editor-prototype.html` | **Referencia de forma** para invitar y quitar a alguien de un bolo. Escritos contra el modelo viejo de membresías: se toma el flujo, no los datos |
| `feat/comms-threads`, `thread_participant` | Sigue fuera: es de hilos libres e invitados sin login (bloqueante 1) |
| `feat/comms-threads`, migración de 604 líneas | Muerta (plan del 14-10, § 1) |

### 1.5 Encaje con lo construido después del 14-10

- **ADR-138:** la etiqueta Equipo no se guarda, la tienen todos los hilos; nada de este plan toca etiquetas ni la regla
  de que una etiqueta no decide permisos. El trato vive en el bolo: el tablón cuelga del mismo bolo y sigue sin dinero.
- **ADR-139 (vistazo lateral):** el vistazo de una función ya enseña el tablón. El de un bolo es `BoloRecord`, que es
  Cuentas (`peek.open_books`): para quien no lee dinero, un bolo se mira desde una de sus funciones. No cambia.
- **ADR-140 (secciones en el marco):** el miembro de una noche aterriza en la ficha de la función; el selector marca
  la lente de la que viene. Si no puede leer ninguna lente (solo tiene un bolo), ver § 3.4.
- **ADR-103 y ADR-107:** «quién va» de una función (`commitment_person`) y el dossier con su invitación son las piezas
  de las que sale la propuesta de acceso (§ 2).

## 2. El modelo: quién entra en el tablón

Tres alternativas. La recomendada primero.

### (a) Recomendada · Invitar al bolo con paquete, y «quién va» lo propone

- **Invitar a un bolo** es una invitación como la de proyecto, con un nivel más: `workspace_invitation` gana
  `bolo_id` y `bolo_preset` (Mínim o Equip; Coordinació y Direcció no tienen sentido en una noche). Al aceptarla,
  `accept_workspace_invitation` crea la membresía de espacio con el rol más bajo (**suposición**: `guest`, comprobar
  qué hace hoy con una de proyecto) y la de bolo por `grant_container_preset`. Caduca y se revoca como las de hoy
  (token hasheado, `expires_at`).
- **Desde dónde:** el tablón dice quién lo ve («Lo ven 3») y lleva «Añadir a alguien». El selector es el de personas
  (`PersonPicker`, ADR-107): elegir un dossier con email invita; sin email, lo pide.
- **«Quién va» lo propone, no lo da** (patrón ADR-103: lo deducido se aprueba o se retira). Si en una función del bolo
  va alguien que no lee el tablón, la línea de audiencia lo dice: «Pau va y no lo ve · Invitar». Un clic, con el
  paquete Equip propuesto. Nunca se da acceso solo porque alguien va.
- **La membresía de bolo deja leer sus funciones.** `performance_select` pasa a `has_permission(project_id,
  'read:performance') OR private.model_container_verb_at('performance', id, auth.uid()) IS NOT NULL`. Es lo que ya
  decidió ADR-100 § 1 («ver la producción es el acceso al contenedor»), aplicado en el único sitio donde la cadena se
  quedaba corta. La función no lleva dinero (ADR-087) y `bolo_id` sigue fuera del grant por columnas, así que abrirla
  no enseña el trato. La sala de la función, lo mismo, por la misma regla (si § 1.3.2 se confirma).
- **Por qué esta.** Es la concesión más estrecha y más común (structure-model: «un técnico para una noche»), con el
  mismo mecanismo que ya existe para proyecto; y aprovecha «quién va» sin convertirlo en permiso por la puerta de
  atrás.

### (b) Membresía de bolo derivada de «quién va»

Quien va a una función del bolo lee su tablón, sin invitar (opción c de la pregunta 2 del 14-10).
- A favor: cero pantalla de acceso; el reparto y la lista de quién va ya existen.
- En contra: «quién va» es un dossier, no un login (ADR-107: enlazar no es compartir); quien no tiene cuenta no gana
  nada. Y convierte una lista de logística en un permiso: añadir a alguien a «quién va» daría lectura de Técnica sin
  que nadie lo decida. Choca con «la IA propone, una persona aprueba».

### (c) Todo por proyecto: invitar al proyecto con Equip

Sin esquema nuevo: el técnico entra en el proyecto con Equip y ve todos sus bolos.
- A favor: cero migración; se puede hacer hoy desde Ajustes.
- En contra: un técnico de una noche ve la temporada entera, sus Generales y sus Técnicas. Es justo lo que el nivel
  bolo existe para evitar.

## 3. Pantalla

### 3.1 El tablón con su audiencia (ficha y vistazo de la función)

```
Tablón del bolo · Kursaal · Manresa · sáb 15 y dom 16 nov · 3 funciones
Lo ven 4: Marco, Anouk, Laia, Pau                          [Añadir a alguien]
Clara va el sáb 15 y no lo ve · Invitar
─────────────────────────────────────────────────────────────────────────────
General                                                     2 nuevos
  Laia · sáb 07:20   Clara y yo vamos en tren, llegamos a las 8:40.
  [Escribe al equipo…]
Técnica · lo ven 3, por Técnica                             1 nuevo
  Pau · sáb 08:55 · sáb 15 11:00   Montaje empezado, 6 varas.
Logística · Comidas                                        (plegados, sin mensajes)
```

- La línea «Lo ven N» ya existe por hilo (`thread_audience`); la de arriba es la del General del bolo, con nombres
  en vez de número cuando son seis o menos (**decisión del plan**, ajustable).
- «Añadir a alguien» y «Invitar» solo los ve quien puede dar ese paquete en ese bolo (el techo del delegante,
  `can_grant_preset`, ADR-085 § 10, ADR-104).
- Quitar a alguien: en la misma línea, menú de su nombre, «Quitar del bolo» (`revoke_membership`; quien podría
  haberla dado o el admin, ADR-104). Solo membresías de bolo: las de proyecto se quitan donde se dieron.

### 3.2 El diálogo de invitar

```
Invitar al bolo de Kursaal · 15 y 16 nov
  Persona   [Pau Riera              ▾]   pau@…  (del dossier; si no hay, escribirlo)
  Acceso    (•) Equip: el tablón con Técnica, Logística, Comidas y Hoja de ruta
            ( ) Mínim: solo el General
  Hasta     el día después de la última función  (caduca sola: § 5, pregunta 4)
                                                   [Cancelar]  [Invitar]
```

### 3.3 Desk

«Lo siguiente» (la próxima función, ADR-121 § 1) gana una línea si su tablón tiene nuevos: «Tablón · 3 nuevos», que
abre la ficha con `#board`. Misma regla de «nuevo» que `bolo_board` y `conversation_feed`. Es la señal que falta el
día del bolo, sin avisos ni correo.

### 3.4 Quien solo tiene un bolo

Al entrar no tiene lente que leer: el Planner y Conversaciones salen vacíos y Cuentas no se pinta. Propuesta: Desk
le enseña «Lo siguiente» con su función y su tablón, y el Planner le enseña sus funciones (la lectura amplía igual que
la ficha, § 2 a). **Suposición** a verificar: que el Planner lee `performance` por PostgREST con la política y no por
otra vía que pida `read:performance`.

### 3.5 Facetas del espacio en Ajustes

Calco de la pantalla de etiquetas (ADR-138 fase 4): lista de facetas estándar con su nombre traducido, renombrar
(`label`, `labels` por idioma), desactivar, ordenar; crear propias con los niveles donde existen (casillas de la
tabla de `structure-model.md`). Solo admin. Desactivar oculta el hilo y la palabra; **no cambia quién lee los datos**
que la faceta gatea (structure-model § Facet). Las propias no entran en los paquetes: se dan a mano.

## 4. Esquema y permisos

| Cambio | Tipo | Nota |
|---|---|---|
| `workspace_invitation.bolo_id`, `bolo_preset` con `CHECK` (preset solo con bolo; bolo del mismo espacio) | Aditivo | `create_workspace_invitation` y `accept_workspace_invitation` por firma: copiar la de la base viva (`pg_get_functiondef`), regla de `_context.md` |
| `performance_select` con la rama de la cadena | **Cambia una lectura** | Amplía, no quita. Foto antes y después de lo que lee cada membresía de `muk-cia`: tiene que salir igual (nadie tiene membresía fina) |
| `venue_select`, si hace falta (§ 1.3.2) | Cambia una lectura | Solo la sala de las funciones que se leen por la cadena; nunca el directorio entero (ADR-124) |
| `membership_facet.id` y `write_audit` | Aditivo | Cierra la deuda de auditoría; da el «quién dio acceso» de la línea de audiencia |
| `workspace_facet_setting` | Sin cambio | Ya existe; solo pantalla y RPC `set_workspace_facet` (admin) |
| `facet` propia con niveles | Aditivo si falta | RPC `create_workspace_facet(p_workspace_id, p_key, p_label, p_labels, p_levels)` que escribe `facet` y `facet_level` |

Lo que no se toca: `thread`, `message`, `thread_read`, `private.thread_readable`, `bolo_board` (ya sigue la cadena),
`conversation_feed`, las etiquetas, el dinero (`bolo_select` sigue en `read:money`).

Gate de § 34: aditiva salvo el cambio de dos políticas, que amplían. Backup, plan y apply por
`production-migrate.yml`; staging recomendado porque cambia lecturas.

## 5. Riesgos y cómo se prueban

| Riesgo | Prueba |
|---|---|
| Un miembro de bolo lee funciones de otro bolo del mismo proyecto | RLS: membresía de bolo A, `performance` del bolo B da 0 filas; la función sin bolo del proyecto, 0 filas |
| Lee dinero por la ficha | RLS: `bolo`, `invoice`, `bolo.fee*` por PostgREST, 0; `performance.bolo_id` sigue fuera del grant |
| Lee el directorio entero por la sala | RLS: `venue` de una sala que no es la de sus funciones, 0 filas |
| «Quién va» da acceso sin querer | RLS: añadir a alguien a `commitment_person` no cambia `thread_readable` para su login |
| Invitar más alto que el techo | RLS: Equip en el proyecto no puede invitar con Coordinació; el 42501 de siempre |
| La ampliación de `performance_select` cambia lo que ve alguien de hoy | Foto en la migración: recuento por membresía antes y después; `RAISE` si cambia (hoy no hay membresías finas) |
| Una faceta desactivada esconde datos o los abre | Unit y RLS: desactivar quita el hilo de `bolo_board` y no cambia ninguna lectura de datos |
| E2E escribe en datos reales | Specs en `playwright`, cada uno crea su bolo y su invitado; nunca `muk-cia` |

Suites: `pnpm --filter web test:rls` con `tests/rls/bolo-membership.test.ts` (los casos de arriba) y los de hilos sin
cambios; E2E contra un origen desplegado: invitar a un bolo, aceptar con un login fixture, ver el tablón y la ficha,
no ver Cuentas ni el otro bolo.

## 6. Fases

| Fase | Qué | Migración | Carriles |
|---|---|---|---|
| 0 | Cerrar en `_tasks.md` el primer corte (hecho el 14 y 15-10) y abrir este; ADR con las respuestas de § 7 | No | Coordinador |
| 1 | Esquema: invitación de bolo, `performance_select` (y `venue_select`) por la cadena, `membership_facet.id` con auditoría. Tests RLS. El Worker no lo lee aún | Sí, § 34, staging | 1 |
| 2 | Pantalla: audiencia con nombres, «Añadir a alguien», diálogo, «Quitar del bolo», la propuesta desde «quién va»; aceptar una invitación de bolo aterriza en la función | No | 1 |
| 3 | Desk: «Tablón · N nuevos» en lo siguiente; quien solo tiene un bolo (§ 3.4) | No | 1 |
| 4 | Facetas del espacio en Ajustes | Aditiva si faltan las RPC | 1, en paralelo con la 2 o la 3 (no comparten ficheros salvo el diccionario) |

**Antes de construir, lo que lo hace útil:** que `muk-cia` tenga bolos (hoy 0; los 17 de MaMeMi viven en
`marco-rubiol`) y que entre Anouk (`_tasks.md`, «Recorrer la app antes de invitar a Anouk»). Sin las dos cosas, el
segundo corte se construye para nadie, como el primero.

## Fuera de este plan

Invitados sin login y link firmado (bloqueante 1); hilos libres con lista de gente (`thread_participant`); hilos de
proyecto y de línea (pregunta 3); avisos por correo o push; realtime (ADR-083 § 2); adjuntos, menciones y reacciones;
membresías de línea y de función (la de función sola, para Full de ruta, cuando alguien la pida).

## 7. Falta decidir (Marco)

1. **¿Cómo entra el equipo de una noche en el tablón?**
   - **(a) Invitación al bolo con paquete, y «quién va» la propone** (recomendada). La concesión más estrecha, con el
     mecanismo que ya existe para proyecto; lo deducido se aprueba (ADR-103).
   - (b) Derivada de «quién va», sin invitar. Cero pantalla, pero una lista de logística pasa a dar permisos y no sirve
     a quien no tiene cuenta.
   - (c) Invitar al proyecto con Equip. Cero esquema, pero ve toda la temporada.

2. **¿Una membresía de bolo deja leer la ficha de sus funciones?**
   - **Sí, por la cadena, sin dinero** (recomendada). Sin esto el tablón es inalcanzable; ADR-100 § 1 ya dice que ver la
     producción es el acceso al contenedor, y la función no lleva dinero.
   - No: una vista propia del tablón (`/h/board/<bolo>`), fuera de la ficha. No toca políticas, pero es una segunda
     página para lo mismo, contra ADR-139 (una forma, vistazo y completa).

3. **¿Qué va primero después de esto?**
   - **Facetas del espacio en Ajustes** (recomendada). Marco lo pidió el 11-10, el esquema existe y la pantalla de
     etiquetas es el molde: poco riesgo y cierra una tarea abierta.
   - Hilos de proyecto y de línea (el General de la obra). Útil cuando haya equipo estable; hoy no hay nadie.
   - Avisos por correo de un tablón con nuevos. Pide decidir qué es «dirigido a ti» (ADR-083) y LSSI no aplica (es
     interno), pero abre el primer envío de Hour a su propio equipo.

4. **¿La invitación de bolo caduca sola?**
   - **Sí, el día después de la última función del bolo, ampliable a mano** (recomendada). Es el «para una noche»; nadie
     se acuerda de quitar al técnico.
   - No, se quita a mano. Más simple, y el técnico sigue leyendo Técnica del bolo meses después.
