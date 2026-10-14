# Plan: comms, carril 2. Hilos con facetas (ADR-099)

> 2026-10-14. Solo plan: nada aplicado, nada desplegado, ni una línea de código de aplicación. Rama
> `claude/comms-threads-plan`. Marco lo revisa antes de construir (`_tasks.md`, «Comms, carril 2», opción a).
> Fuentes: ADR-082, 083, 085, 093, 098, 099, 100, 102, 104, 105; `build/structure-model.md`;
> `build/permissions-facets-plan.md`; `_notes/spec-access-comms-decisions.md`;
> `_notes/review-comms-migration-2026-07-20.md`; `origin/feat/comms-threads` (`0f1ff5c`); `origin/claude/comms-mock`
> (`e377a13`); `origin/claude/comms-conversation-review` (`c1c347f`); `supabase/migrations/` y `apps/web/src` en
> `origin/main` (`ff8c18e`). Lo que no se pudo comprobar va marcado como **suposición**.

## Decidido antes de este plan

1. Hilos internos, **sin invitados** (ADR-099 §7). El invitado sin login (bloqueante 1) queda fuera.
2. **El tablón del día cuelga del bolo** (ADR-099 §6, cerrado tras la maqueta): variante «a» de la maqueta, donde un
   mensaje de Técnica dice de qué función habla.
3. Lo hablado con fuera es registro (`conversation_event`, ADR-098); el hilo del equipo va al lado, o mezclado en la
   vista «hilo». Presentación, no dos modelos (ADR-099 §5, cerrado).
4. Hilo (N a N, sin estado) y conversación de difusión (1 a 1, con estado) **no se fusionan**: lo que une es la lente
   (ADR pendiente «comms sube a Conversations», `_tasks.md § Bloqueado`).
5. Un solo mecanismo polimórfico (ADR-083 §1); asíncrono, **sin realtime** (ADR-083 §2); `General` no es faceta, es
   estar en el contenedor (enmienda de ADR-082); la línea de audiencia «Lo ven N, por permiso de X» no se pliega nunca
   (ADR-083 enmienda §6).

## 1. Estado de partida, verificado en el árbol

### Lo que ya existe (producción, por migraciones en `main`)

| Pieza | Dónde | Para los hilos |
|---|---|---|
| `facet`, `facet_level`, `workspace_facet_setting` | `20261011100000_permissions_facets_expand` | Vocabulario y niveles. Siete estándar: converses, materials, tecnica, logistica, full_de_ruta, comidas, diners |
| `membership` (niveles workspace, project, line, bolo, performance) y `membership_facet` | expand + `20261013300000_permissions_facets_contract` | Única fuente del acceso desde el 2026-10-13 |
| `private.container_chain(level, id)`, `private.chain_memberships(level, id, user)` | expand | La cadena hacia arriba por claves desnormalizadas; exige `accepted_at` |
| `private.model_has_facet_at(level, id, facet_id, verb, user)` | expand | Faceta por la cadena, solo donde existe (`facet_level`); owner/admin, todo. Hoy solo la usan `can_grant_preset`, `can_manage_membership`, `set_membership_facet` |
| `private.model_container_verb_at(level, id, user)` | expand | Acceso al contenedor por la cadena (`edit`, `view` o NULL). La fila de espacio no lleva verbo: un `member` sin proyecto da NULL |
| `has_permission(project, perm)` -> `private.model_has_permission` | contract | Siete permisos; mira solo membresías de espacio y de proyecto, no de línea ni bolo |
| `grant_container_preset`, `set_membership_facet`, `revoke_membership` | `20261013200000_permissions_facets_writes` + contract | Escriben membresías y facetas de cualquier nivel, con el techo del delegante |
| `membership_select` | expand | La propia o todas si administras: la matriz no se publica |
| `guard_immutable_workspace_id()`, `set_updated_at()` | checkpoint | Triggers de la casa |
| `note` (ADR-093) | `20260731120000_note_absorbs_person_note` | Post-it privado. Su comentario dice «Shaped for `message` so comms migrates nothing» |
| Ficha de conversación con el sitio del hilo del equipo reservado | `routes/h/[workspace]/conversation/[slug]/+page.svelte` | Comentario: «El hilo del equipo llega con el carril 2»; claves `mail.team_later`, `mail.team_later_thread`, `mail.inside_team` en los cuatro idiomas |

### Lo que no existe

- Ninguna tabla de hilo ni de mensaje (`grep` en `supabase/migrations`: cero `CREATE TABLE` de `thread` o `message`).
- Ninguna ruta, componente ni endpoint de hilos. La maqueta vive solo en `claude/comms-mock` (`/h/prototype/comms`).
- Ninguna pantalla de facetas por espacio: `workspace_facet_setting`, `grant_container_preset` y `facet_level` solo
  aparecen en `apps/web/src/lib/db-types.ts`. Nadie puede dar hoy una membresía de línea, bolo o función desde la app.
- Ninguna página del bolo fuera de Cuentas: el bolo es dinero. `bolo_select` exige `read:money`
  (`20260722102000_money_v3_bolo`) y `performance.bolo_id` está fuera del grant por columnas «porque saber de qué trato
  cuelga una fecha es dinero» (`20261010140000_list_performance_bolo_links`). **Esto choca de frente con un tablón
  colgado del bolo que tiene que ver el equipo técnico** (pregunta 1).
- Realtime de Postgres: la web solo usa canales de presencia (`lib/realtime/`); ningún `postgres_changes`.

### Material de `feat/comms-threads`: qué sirve y qué está muerto

La migración `build/migrations/2026-07-20_comms_threads_and_membership.sql` (604 líneas, verificado) se escribió
contra `workspace_membership` y `project_membership`, que ya no existen.

| Pieza de la rama | Estado | Por qué |
|---|---|---|
| `facet`, `facet_level`, `membership`, `membership_facet`, enums | Muerta | Producción ya las tiene, con otra forma (`facet_id` uuid, niveles con bolo, `container_verb`) |
| `container_chain`, `is_container_member`, `has_facet` | Muerta | Sustituidas por `private.container_chain`, `chain_memberships`, `model_has_facet_at`, `model_container_verb_at` |
| Backfill, `membership_select` ancha | Muerta | El contract ya lo hizo, y la política de producción es la estrecha |
| `thread`: anclas FK + `CHECK` de un solo padre, tipos excluyentes, únicos por faceta y por General | **Sirve la idea** | Se reescribe: `bolo_id` en vez de `performance_id`, `facet_id` en vez de `facet_key`, sin `label` en este corte |
| `can_read_thread` en tres ramas | **Sirve la forma** | Se reescribe sobre los lectores reales; la rama de participantes desaparece en este corte |
| `message` con `author_person_id` | Cambia | Sin invitados el autor es siempre un login: `author_id` (auth.users). `author_person_id` entra, aditivo, con el invitado |
| `guard_message_immutable_anchor`, `set_updated_at` en tablas nuevas | **Sirve** | Se copia |
| Políticas `message_insert` / `message_update` | Muerta | Las escrituras van por RPC (patrón de `record_conversation_event` y money v3): no hay grant de escritura |
| `thread_participant` | Fuera de este corte | Es de hilos libres e invitados |
| Prototipos `app design/` | Referencia | `comms-hub-performance-prototype.html`: el hub como sección de la página del bolo y la línea de audiencia. Los de invitar, revocar, editor de permisos y roles no tocan este corte |
| `_comms-wip.md` «cómo retomar» | Superado | Los pasos 2 a 4 los hizo el carril de permisos |

### Los 32 hallazgos del review, hoy

| Hallazgos | Estado | Nota |
|---|---|---|
| 1, 7, 22 (General abierto a todo el espacio) | **Vivo como requisito** | El General se gatea con `model_container_verb_at` del contenedor, no con `is_workspace_member`. Test 2 |
| 2, 13, 24, 8 (autor falsificable, anclas mutables) | Resuelto por diseño | Solo RPC; el autor es `auth.uid()` dentro de la RPC; trigger de anclas inmutables de respaldo |
| 3, 11, 17, 23 (conversación fuera de la cadena) | Obsoleto por diseño | Un hilo de conversación no tiene facetas: solo su hilo del equipo, que hereda la lectura de la conversación |
| 4, 6, 9, 21, 28 (participantes, puente persona) | Obsoleto en este corte | No hay hilos libres ni invitados |
| 5 (invitado sin autenticación) | Fuera | Bloqueante 1, sigue abierto |
| 10, 14, 18 (`accepted_at`) | Resuelto en producción | `chain_memberships` lo exige |
| 12 (matriz de permisos publicada) | Resuelto en producción, **vuelve en pequeño** | La línea de audiencia dice quién lee un hilo: la RPC `thread_audience` solo responde a quien ya lo lee, y solo de ese hilo |
| 15, 25 (`updated_at`, `guard_immutable_workspace_id`) | **Vivo como requisito** | Las dos tablas nuevas llevan los dos triggers |
| 16, 19, 26 y el «defecto nuevo» del backfill | Resuelto u obsoleto | Paquetes expandidos y contract aplicados |
| 20 (tabla faceta × nivel al escribir) | Resuelto para membresías, **vivo para hilos** | Guard al crear un hilo: la faceta existe en ese nivel y es del espacio |
| 27, 32 (`container_chain` expuesto) | Resuelto en producción | En `private`, `REVOKE ALL FROM PUBLIC` |
| 29 (`message.workspace_id` suelto) | **Vivo como requisito** | FK compuesta `(thread_id, workspace_id) -> thread (id, workspace_id)` |
| 30, 31 (comentarios, rollback) | Práctica | Comentarios al día; rollback en `build/runbooks/` |

De `_tasks.md § Bloqueado` quedan muertos el bloqueante 2, la entrada de la migración de 604 líneas y el «defecto
nuevo»; los «hallazgos abiertos» se reducen a los requisitos de arriba. Limpiar esa sección es del coordinador.

## 2. Modelo de datos propuesto

### `thread`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 PK | |
| `workspace_id` | uuid NOT NULL -> workspace CASCADE | Igual al del ancla (guard) |
| `project_id`, `line_id`, `bolo_id`, `conversation_id` | uuid NULL, FK CASCADE | `CHECK (num_nonnulls(...) = 1)`. En este corte la RPC solo abre `bolo` y `conversation` (pregunta 5); proyecto y línea caben sin migración |
| `facet_id` | uuid NULL -> facet RESTRICT | NULL = General. En un hilo de conversación, siempre NULL |
| `created_by` | uuid -> auth.users SET NULL | |
| `created_at`, `updated_at`, `last_message_at` | timestamptz | `last_message_at` lo mueve la RPC al escribir |

- Único: `UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, line_id, bolo_id, conversation_id, facet_id)`
  (Postgres 17): un General y un hilo por faceta en cada contenedor. Más `UNIQUE (id, workspace_id)` para la FK
  compuesta de `message`.
- **El hilo nace perezoso**: la primera escritura lo crea (`INSERT ... ON CONFLICT DO NOTHING`). Leer un tablón vacío
  no escribe nada; la pantalla pinta las facetas del nivel desde `facet_level`.
- Guard `BEFORE INSERT` (`private.guard_thread`, SECURITY DEFINER): el ancla existe, está viva y es del mismo espacio;
  la faceta es estándar o del espacio, existe en el nivel del ancla (`facet_level`) y no está desactivada
  (`workspace_facet_setting.active`); un hilo de conversación no lleva faceta. Un solo 42501 para «no existe» y «no es
  tuyo».
- Triggers: `guard_immutable_workspace_id`, `set_updated_at`, y anclas y faceta inmutables.
- Índices: `(workspace_id, last_message_at DESC) WHERE` vivo; uno por cada FK (`bolo_id`, `conversation_id`,
  `project_id`, `line_id`, `facet_id`, `created_by`), como pide el advisor.

### `message`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid v7 PK | |
| `thread_id`, `workspace_id` | NOT NULL; FK compuesta -> `thread (id, workspace_id)` CASCADE | Cierra el hallazgo 29 en el esquema, no en una política |
| `author_id` | uuid -> auth.users SET NULL | La RPC lo pone a `auth.uid()`. Revocar no es borrar (ADR-085 §7): si el login se borra, el mensaje queda sin autor |
| `performance_id` | uuid NULL -> performance SET NULL | De qué función habla (variante «a»). Solo en hilos de bolo, y la función tiene que colgar de ese bolo (guard) |
| `body` | text NOT NULL, `CHECK length(btrim(body)) BETWEEN 1 AND 10000` | Límite propuesto, sin base medida |
| `created_at`, `edited_at`, `deleted_at` | timestamptz | Borrado blando por RPC (el `note_select` enseñó por qué un UPDATE de `deleted_at` falla por PostgREST) |

- Índices: `(thread_id, created_at DESC) WHERE deleted_at IS NULL`; `author_id`; `performance_id`.
- Triggers: `guard_immutable_workspace_id`; anclas inmutables (`thread_id`, `author_id`, `created_at`,
  `performance_id` salvo por la RPC de editar).
- Sin `write_audit`: el mensaje ya es el registro, y el cuerpo no se copia a `audit_log` (ADR-100, añadido: lo mismo que
  el correo).

### `thread_read` (solo si la pregunta 6 sale «a»)

`(thread_id, user_id) PK, last_read_at`. Política: solo la fila propia. Escribe la RPC `mark_thread_read`.

### `note` no se toca

Propuesta: `message` es tabla propia y `note` sigue siendo el post-it privado (pregunta 4).

### Lectura: un ayudante y tres políticas

`private.can_read_thread(p_thread_id uuid, p_user_id uuid) RETURNS boolean`, SECURITY DEFINER, `REVOKE ALL FROM
PUBLIC` y `GRANT EXECUTE TO authenticated` (mismo patrón que `private.has_workspace_role`). Dos ramas excluyentes:

| Hilo | Lo lee quien |
|---|---|
| De conversación (`conversation_id`) | Lee la conversación: viva, `has_permission_for_user(project, 'read:conversation', uid)` y `private_to IS NULL OR private_to = uid`. En un ayudante `private.can_read_conversation(id, uid)` que usan la política y las RPC (hoy `record_conversation_event` repite la misma regla a mano) |
| General de un contenedor | `model_container_verb_at(nivel, id, uid) IS NOT NULL`, con el ancla viva |
| De faceta | `model_has_facet_at(nivel, id, facet_id, 'view', uid)` y la faceta activa en el espacio |

- `thread_select`: `private.can_read_thread(id, (SELECT auth.uid()))`.
- `message_select`: `deleted_at IS NULL AND EXISTS (SELECT 1 FROM thread t WHERE t.id = message.thread_id)`: hereda la
  frontera del hilo con la RLS del que llama, como `conversation_event_select` (ADR-098).
- `thread_read_select`: `user_id = auth.uid()`.
- Grants: `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT SELECT` a tabla entera a `authenticated` (sin grant por columnas:
  la rotura de `performance` del 2026-08-29). Ningún INSERT, UPDATE ni DELETE directo.
- Ojo, verificado en el árbol: `model_has_facet_at` solo cuenta una faceta en el nivel de la membresía que la tiene.
  **Logística, Comidas y Full de ruta no existen en proyecto**, así que el Equip de un proyecto no las tiene, y en un
  bolo solo las verían owner/admin y quien tenga membresía de bolo, que hoy nadie puede dar desde la app (pregunta 2).

### Escritura: RPC

| RPC | Puerta | Hace |
|---|---|---|
| `post_message(p_anchor_kind, p_anchor_id, p_facet_id, p_body, p_performance_id)` | Leer el hilo (pregunta 3) | Crea el hilo si falta, inserta con `author_id = auth.uid()`, mueve `last_message_at`. Devuelve el mensaje |
| `edit_message(p_id, p_body)` | Autor, y aún lee el hilo | `body`, `edited_at` |
| `delete_message(p_id)` | Autor | Borrado blando |
| `thread_audience(p_anchor_kind, p_anchor_id, p_facet_id)` | Leer el hilo | `{count, reason, people[{user_id, name}]}`: recorre las membresías de espacio aceptadas y evalúa la misma regla por persona. La razón sale del tipo de hilo: «por estar en el bolo», «por permiso de Técnica», «quien ve esta conversación» |
| `bolo_board(p_performance_id)` | Acceso a la función y pregunta 1 | El bolo de esa función sin dinero: id, funciones hermanas (día, hora, sala), hilos con su recuento y último mensaje |
| `mark_thread_read(p_thread_id)` | Leer el hilo | Solo con la pregunta 6 |

Todas SECURITY DEFINER con `search_path` fijo, «no existe» y «no es tuyo» con el mismo 42501, `REVOKE` a `anon`.

### Realtime

No. ADR-083 §2 lo descarta. La pantalla abierta refresca con TanStack Query al recuperar el foco y cada 30 s mientras
está visible (cifra propuesta, sin medir). Supabase Free aguanta eso con 3 a 15 personas por compañía
(**suposición**, no medido).

## 3. Pantalla

### Dónde vive

- **ADR-106, a escribir en la fase 0**: comms sube a la lente Conversations, con dos proyecciones (patrón ADR-076):
  «con quién hablas» (la lista de hoy, difusión) y «de qué se habla» (hilos internos por contenedor). Ninguna es
  secundaria. Recoge también las respuestas de Marco a este plan.
- **El tablón del día**: una sección de la ficha de la función (`/h/[workspace]/performance/[slug]`), no una página
  (spec de julio, §5: «el hub es una sección de la página del bolo, no la página»). Toda función con bolo enseña el
  tablón de su bolo; las funciones hermanas lo comparten. Una función sin bolo no tiene tablón (**decisión del plan**:
  sin bolo no hay de qué colgarlo; el aviso dice «sin bolo, sin tablón»).
- **El hilo del equipo de una conversación**: sustituye el sitio reservado en la ficha de conversación. Vista
  «registro»: columna al lado. Vista «hilo»: mezclado con el registro por fecha, con su marca «Solo el equipo».
- **«De qué se habla» en Conversations**: lista de hilos con actividad, agrupados por contenedor (bolo con sus fechas,
  conversación con su sala), con el último mensaje y, con la pregunta 6, los no leídos. Abrir lleva a la ficha.

### Qué se ve en el tablón (variante «a» de la maqueta)

- Cabecera del bolo: sala, ciudad, días y funciones; nunca caché ni estado del trato.
- Un bloque por hilo, en el orden de `facet.sort` (o el del espacio): General primero y después las facetas que existen
  en el bolo y están activas. Solo salen las que el que mira puede leer; las que no, no salen (ni «bloqueado»: ausente
  no es denegado, y una faceta que no puedes leer tampoco se anuncia).
- Encima de cada bloque, la línea de audiencia, sin plegar: «Lo ven 5, por permiso de Técnica».
- Mensajes con autor, hora y, si lo marcó, la función («sáb 15 · 11:00»).
- Un hilo vacío es una línea («Sin mensajes») con su compositor.

### Cómo se escribe

Un compositor por hilo, de texto plano. En un hilo de bolo con varias funciones, un selector opcional «de qué función»
(por defecto, ninguna: habla del bolo). Editar y borrar lo propio desde el menú del mensaje. Sin adjuntos, sin
menciones, sin reacciones.

### Qué se descarta de la maqueta

- La variante «b» (técnica en cada función) y el modo «lado a lado»: ADR-099 §6 eligió «a».
- La faceta «Dinero» como etiqueta: la faceta es `diners` y su nombre sale de la clave i18n (`facet.diners`).
- «Comidas: lo ven 5, por permiso de logística» de `data.ts`: Comidas es su propia faceta; la razón dirá Comidas.
- Los recuentos inventados de la línea de audiencia: los da `thread_audience`.
- La cabecera «MaMeMi en Cuarta Pared» como título del bolo: el bolo no tiene título; se compone de obra y sala.
- Los paneles de Conversación y Buzones: ya en producción por el carril 1 y ADR-102.

## 4. Fases

Nada de lo de abajo es destructivo: no hay contract. Cada fase se despliega sola.

### Fase 0 · ADR-106 y respuestas (solo documentos)

ADR-106 con la lente y las respuestas a § 5. Si la pregunta 2 sale «a», se anota aquí también el cambio de
`facet_level`. Commit directo a `main` (solo documentos).

### Fase 1 · Esquema y RPC (migración aditiva)

`supabase/migrations/2026101xxxxxxx_comms_threads.sql`: `thread`, `message` (y `thread_read`), ayudantes, guards,
políticas, grants y las RPC de § 2. Si la pregunta 2 sale «a», en la misma migración: filas de `facet_level` en
proyecto y re-expansión de los paquetes de las membresías de proyecto con `preset` (solo añade filas `preset`;
las `override` no se tocan), con foto del acceso antes y después y `RAISE` si cambia algo fuera de esas facetas.
Rollback en `build/runbooks/rollback-2026101x-comms-threads.sql`. El Worker no lee nada de esto: entra antes que el
código.

Puerta:
- Reconstrucción local desde cero con la migración; tipos regenerados (`db-types.ts`).
- `pnpm --filter web check` 0/0 y `pnpm --filter web test:unit`.
- `pnpm --filter web test:rls`, con `apps/web/tests/rls/comms-threads.test.ts` nuevo (lista abajo).
- § 34: aditiva, staging opcional. **Recomendación: staging igualmente si entra la pregunta 2 «a»**, porque cambia el
  acceso efectivo de personas reales (gana, no pierde). Backup, plan y apply por `production-migrate.yml`.
- Antes del apply, un SELECT en producción: cuántas membresías de línea, bolo y función hay (la **suposición** es
  cero) y cuántas filas tiene `note` (por la pregunta 4).

Tests RLS nuevos (`comms-threads.test.ts`, en el espacio `playwright`, cada spec dueña de sus filas):

1. Un login de otro espacio no lee hilo ni mensaje de un bolo ajeno, y `post_message` le da 42501.
2. Un `member` del espacio sin membresía de proyecto no lee el General del bolo (hallazgos 1, 7, 22).
3. Mínim en el proyecto lee y escribe en el General; no lee Técnica ni Diners.
4. Equip lee Técnica (proyecto -> bolo); no lee Diners. Logística y Comidas, según la pregunta 2.
5. Coordinació lee Diners; Direcció y owner/admin, todo.
6. Una faceta desactivada en el espacio: no se lista y `post_message` la rechaza.
7. Una faceta que no existe en el nivel (Converses en un bolo) o de otro espacio: rechazada.
8. `post_message` firma con el que llama (no hay parámetro de autor); cuerpo vacío o de más de 10.000: rechazado.
9. INSERT, PATCH y DELETE directos sobre `thread` y `message` por PostgREST: denegados.
10. `edit_message` y `delete_message` de un mensaje ajeno: el mismo 42501 que uno inexistente; uno borrado ya no se lee.
11. `message.workspace_id` distinto del de su hilo: imposible (FK compuesta); `thread.workspace_id` distinto del ancla:
    rechazado por el guard.
12. Hilo de conversación: no lo lee quien no lee la conversación, ni nadie salvo su dueño si es privada; con faceta,
    rechazado.
13. `performance_id` de una función de otro bolo, o en un hilo que no es de bolo: rechazado.
14. `thread_audience`: denegado a quien no lee el hilo; a quien sí, el recuento coincide con los logins de prueba que
    lo leen.
15. `bolo_board`: quien no lee dinero recibe funciones y hilos sin caché ni estado del trato; un ajeno, nada (según la
    pregunta 1).
16. `anon`: nada en ninguna tabla ni RPC.
17. `thread_read`: solo la fila propia (con la pregunta 6).

Unit (Vitest): orden de las facetas del tablón, la línea de audiencia por tipo de hilo, la mezcla registro + equipo de
la vista «hilo» y la etiqueta de función de un mensaje.

### Fase 2 · El tablón en la ficha de la función

Endpoints en `routes/api/` (lecturas por `bolo_board`, escrituras por las RPC), la sección del tablón, el compositor,
la línea de audiencia y el selector de función. i18n en los cuatro idiomas. E2E: un usuario con Equip escribe en
Técnica marcando una función y lo ve; no ve Diners.

Puerta: check 0/0, unit, RLS (sin cambios de esquema, por si acaso), deploy con OK y E2E contra
`https://hour.zerosense.studio` después del deploy.

### Fase 3 · El hilo del equipo en la conversación

Sustituye el sitio reservado y las claves `mail.team_later*` (se borran). Vista «registro»: columna; vista «hilo»:
mezclado. E2E: escribir en el hilo del equipo de una conversación propia del espacio `playwright`; una conversación
privada ajena no enseña hilo.

Puerta: la de la fase 2.

### Fase 4 · «De qué se habla» en Conversations

La segunda proyección de la lente (ADR-106), con los no leídos si la pregunta 6 sale «a». E2E: el hilo con un mensaje
nuevo sale arriba y abre la ficha correcta.

Puerta: la de la fase 2.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El tablón enseña qué funciones van en el mismo trato a quien no lee dinero | Pregunta 1. `bolo_board` nunca devuelve caché, estado ni pagador |
| El Equip no ve Logística ni Comidas en el bolo (verificado: no existen en proyecto) | Pregunta 2 |
| `has_permission` y los hilos leen la cadena distinto: una membresía de bolo da el tablón, no la ficha de función (que pide `read:performance` de proyecto) | Hoy no hay membresías de bolo (suposición, SELECT antes del apply). Si llegan, el tablón necesitará otra puerta |
| `private.can_read_conversation` duplica la regla de `conversation_select` | Un solo ayudante para hilos y RPC; un test RLS que cubre privada y sin permiso. Pasar `conversation_select` al ayudante es otra tarea |
| Coste de RLS por fila (`model_*` SECURITY DEFINER por hilo) | La política de `message` va por `EXISTS` sobre `thread`: una evaluación por hilo, no por mensaje. Medir con el plan de la consulta en local |
| Los tests RLS escriben en producción | Espacio `playwright`, cada spec borra lo suyo; nunca `muk-cia` |
| Sin realtime, el día del bolo alguien no ve un mensaje a tiempo | Refresco al foco y cada 30 s; la pregunta 6 da la señal de novedad. Notificaciones fuera de este corte |
| Facetas propias de un espacio en un bolo | Funcionan solas si tienen fila en `facet_level`; sin pantalla para crearlas (`_tasks.md`, «Facetas configurables»), en la práctica no hay |

## Fuera de este plan

Invitados y link firmado (bloqueante 1); hilos libres con lista explícita (salvo pregunta 5 «c»); hubs de espacio,
proyecto y línea (salvo pregunta 5 «b»); notificaciones, Desk y correo; adjuntos y menciones; la pantalla de
membresías de línea, bolo y función; la pantalla de facetas por espacio; la deuda de `audit_log` en
`membership_facet`.

## 5. Preguntas para Marco

1. **El tablón y el dinero: ¿quién puede saber qué funciones van en el mismo bolo?** Hoy eso es dinero
   (`performance.bolo_id` solo lo lee quien lee Cuentas).
   - a. **Una RPC que, desde una función, da su tablón y las funciones hermanas (día, hora, sala), sin caché ni estado
     del trato, a quien tiene acceso a la función** (recomendada: que tres funciones sean el mismo viaje es lo que el
     equipo necesita saber el día del bolo; el caché es lo sensible, y no sale).
   - b. Solo quien lee Cuentas ve el tablón; para el resto no existe. Deja fuera al técnico, que es para quien se hace.
   - c. El tablón cuelga de cada función (variante «b»), contra ADR-099 §6.
2. **Logística, Comidas y Full de ruta no existen en proyecto, así que el Equip de un proyecto no las tiene en el
   bolo.**
   - a. **Añadir proyecto a `facet_level` para Logística y Comidas (y Full de ruta) y re-expandir los paquetes de
     proyecto** (recomendada: hoy no hay forma de dar una membresía de bolo desde la app; mover una faceta de nivel es
     una fila, ADR-082 enmienda §6; y esas tres facetas no gatean ningún dato, solo hilos).
   - b. Dejar la tabla y construir antes «quién está en el bolo» (membresías de bolo con su pantalla).
   - c. Derivar la membresía de bolo de quién va (reparto y `commitment_person`). Es un proyecto propio.
3. **¿Ver una faceta deja escribir en su hilo?**
   - a. **Sí: ver es leer y escribir en el hilo; editar gatea los datos de la faceta, no la palabra** (recomendada:
     Equip solo tiene «ver», y con b el técnico no podría escribir en Técnica; es lo que ya decía la migración de julio
     y el sentido de ADR-085 §4).
   - b. Escribir pide «editar» (ADR-083 §4 al pie de la letra).
4. **¿Los mensajes van en una tabla `message` nueva o `note` crece hasta serlo?** ADR-093 §4 dijo que `note` nacía con
   la forma del mensaje para no migrar nada.
   - a. **`message` propia; `note` sigue siendo el post-it privado** (recomendada: dos regímenes de RLS en una tabla,
     solo el autor o la audiencia del hilo, es el `CASE` en cada política que ADR-093 quería evitar; `on_day NOT NULL`
     no significa nada en un mensaje; y las anclas no coinciden: la nota tiene `date` y `person`, el hilo `bolo` y
     `conversation`).
   - b. `note` gana `thread_id` y la rama `visibility = 'workspace'`, como dice ADR-093.
5. **¿Qué entra en el primer corte de pantallas?**
   - a. **Tablón del bolo, hilo del equipo de la conversación y «de qué se habla» en Conversations** (recomendada: es
     lo decidido en ADR-099 y lo que la ficha de conversación ya reserva; el esquema admite proyecto y línea sin
     migrar).
   - b. Además, el hub del proyecto (General y sus facetas).
   - c. Además, hilos libres con su lista de gente (requiere `thread_participant`).
6. **¿Hay «no leídos» en el primer corte?**
   - a. **Sí, por hilo y por persona, en el tablón y en Conversations; sin Desk, sin avisos ni correo** (recomendada:
     sin realtime ni avisos, un tablón sin señal de novedad obliga a abrirlo para saber si hay algo; el Desk sigue
     abierto en ADR-083).
   - b. No; se mira la hora del último mensaje.
   - c. Además en Desk, solo para un mensaje con una pregunta dirigida a ti (el criterio propuesto en ADR-083).
