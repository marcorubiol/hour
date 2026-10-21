# Plan: alta de persona, fusión explícita que confirma un admin

> 2026-10-22. Solo plan: sin código, sin migraciones, nada aplicado. Rama `claude/night-plans`. Marco lo lee antes de
> construir (`_tasks.md`, «Alta de persona: la cuenta que acepta ya es otra persona», Marco 14-10, ADR-107).
> Fuentes: `_context.md`; `build/structure-model.md`; `_decisions.md` ADR-092, 093, 102, 107, 124, 138; migraciones de
> `supabase/migrations/` en `origin/main` (`ad7a9cc6`); producción consultada en solo lectura (catálogo y `SELECT`) el
> 2026-10-21; definiciones vivas de `accept_workspace_invitation`, `invite_workspace_person`,
> `share_my_profile_with_workspace`, `sync_shared_profile_to_workspace_people`, `guard_immutable_note_anchor`,
> `mail_contact_addresses` y `write_audit` (`pg_get_functiondef`). Lo que no se pudo comprobar va marcado como
> **suposición**.

## La idea, en una línea

Cuando la cuenta que acepta una invitación ya es otra persona, el admin del espacio confirma que los dos dossiers son el
mismo ser humano y Hour mueve, **solo dentro de ese espacio**, todo lo que colgaba del dossier sobrante al que se queda,
con registro de qué se movió y un «deshacer» durante 30 días.

## 1. Estado de hoy, verificado en producción

### 1.1 Cómo se identifica una persona

- `person` es la identidad global (1.068 filas, 184 con email). `workspace_person` es el dossier local y privado de cada
  espacio, con **clave `(workspace_id, person_id)`**: el dossier no tiene id propio, se nombra por la persona global.
- `create_workspace_person` (ADR-107) crea una persona global anónima (`person-<12 hex>`, sin email) y el dossier con el
  nombre real. Así que casi todas las personas globales viven en un solo espacio: solo **4** aparecen en más de uno.
- `user_profile.person_id` es el puente cuenta a persona: único (`user_profile_person_id_key`), una persona por cuenta.
  Lo escriben `share_my_profile_with_workspace` y, desde ADR-107, `accept_workspace_invitation`.
- `accept_workspace_invitation` enlaza la cuenta al dossier de la invitación **solo si la cuenta no es todavía nadie**.
  Si ya lo es, acepta igual y deja el dossier sin enlazar, en silencio: nadie se entera.

### 1.2 Qué cuelga de una persona (FK reales, `pg_constraint`)

| Tabla | Columna | FK | Unicidad que puede chocar al fusionar | Borrado | Guard |
|---|---|---|---|---|---|
| `workspace_person` | `person_id` | `person` (cascade) | PK `(workspace_id, person_id)`; slug por espacio | blando | |
| `user_profile` | `person_id` | `person` | una persona por cuenta | | sync de perfil |
| `cast_member` | `person_id` | dossier `(ws, person)` | `(project_id, person_id, role)` vivas | blando | ws inmutable |
| `cast_override` | `person_id`, `replaces_person_id` | dossier | `(performance_id, person_id)` vivas | blando | ws inmutable |
| `crew_assignment` | `person_id` | dossier | `(performance_id, person_id, role)` vivas | blando | ws inmutable |
| `availability_block` | `person_id` | dossier | ninguna | blando | ws, autor |
| `commitment_person` | `person_id` | `person` | `(performance_id, person_id)` y `(date_id, person_id)`, **sin parcial** | **sin borrado blando** | |
| `conversation_contact` | `person_id` | dossier (cascade) | `(conversation_id, person_id)`; un principal por conversación | **sin borrado blando** | ws inmutable |
| `person_acquaintance` | `person_id` | dossier (cascade) | PK `(workspace_id, person_id, user_id)` | **sin borrado blando** | |
| `note` | `person_id` | `person` | ninguna | blando | **ancla inmutable** (`guard_immutable_note_anchor`) |
| `workspace_invitation` | `person_id` | dossier | ninguna | | |
| `mailout_recipient` | `person_id` | dossier | ninguna por persona | | ws inmutable |

`invoice.payer_person_id` ya no existe (el pagador es la organización, ADR-102 § 5). `audit_log` guarda ids en
`entity_id` y en el jsonb de cambios: **no se reescribe**, es historia. **Suposición:** ningún jsonb vivo (p. ej.
`conversation_event.metadata`, `custom_fields`) guarda un `person_id` que alguien lea; no lo he barrido.

Fuera de la base: los pins del eje de persona (`pe:<personId>`, ADR-092) viven en la URL y en el navegador. Tras una
fusión un pin al sobrante apunta a nadie.

### 1.3 Filas por espacio (todas, vivas y borradas)

| Espacio | Dossiers vivos | Reparto | Equipo técnico | Disponib. | Compromisos | Contactos | Notas | Envíos | Lo conozco | Invitaciones con dossier |
|---|---|---|---|---|---|---|---|---|---|---|
| `muk-cia` (real) | 160 | 0 | 0 | 0 | 30 | 157 | 85 | 0 | 0 | 0 |
| `marco-rubiol` | 3 | 0 | 0 | 8 | 0 | 1 | 9 | 0 | 0 | 0 |
| `testing` | 12 | 0 | 0 | 0 | 0 | 12 | 0 | 0 | 0 | 0 |
| `playwright` | 721 | 48 | 0 | 108 | 126 | 669 | 161 | 465 | 15 | 40 |

### 1.4 El caso abierto, hoy

- **Humanos duplicados reales: ninguno.** Cero emails repetidos dentro de un espacio. Los 26 grupos de nombres repetidos
  son todos de `playwright` (118 filas, fixtures `E2E*`).
- De las 4 cuentas, 2 están enlazadas: Marco (un solo `person_id` con dossier en `muk-cia` y `marco-rubiol`, sin
  duplicado) y el usuario del E2E.
- **Las 40 invitaciones aceptadas con dossier están sin enlazar, las 40 en `playwright`:** las acepta el usuario del E2E,
  que ya es otra persona. Es exactamente el caso de ADR-107, repetido por los specs. Sirven de fixture.
- Nadie real lo sufre todavía. Lo sufrirá la primera persona que entre en dos espacios (Anouk en `muk-cia` y en el suyo,
  o alguien invitado a dos compañías).

## 2. Qué significa fusionar

Tres alternativas. La recomendada primero.

### (a) Recomendada · Fusión de dossier dentro de un espacio

Dos dossiers del mismo espacio, `keep` y `drop`. En ese espacio, cada fila que apunta a `drop` pasa a `keep`; el dossier
`drop` se borra en blando con `merged_into`; la persona global `drop` no se toca. Si `keep` no tiene dossier en el
espacio (la cuenta es una persona de otro espacio), se crea a partir del de `drop`.

**Por qué esta.** El dossier es privado de cada espacio (ADR-092, 124): un admin de `muk-cia` no puede ni debe tocar lo
que otro espacio guarda de esa persona. Y como `create_workspace_person` hace personas globales anónimas de un solo
espacio, en la práctica la persona sobrante solo existe allí: fusionar en el espacio es fusionar del todo, sin cruzar
ninguna frontera. Si la sobrante vive también en otro espacio (hoy, 4 personas), allí sigue igual hasta que su admin
haga lo mismo.

Sirve para los tres casos con la misma operación:
1. **La invitación** (el de ADR-107): `drop` = el dossier de la invitación, `keep` = la persona de la cuenta.
2. **La cuenta ya tenía dossier en este espacio** (compartió perfil antes de que la invitaran desde otra ficha): los dos
   dossiers existen, mismo movimiento.
3. **Dos dossiers sin cuenta** del mismo contacto (alguien creó a Inés dos veces): fusión a mano desde la ficha.

### (b) Fusión global de la persona

Reescribir `person_id` en todos los espacios y borrar la persona sobrante.

- Un admin de un espacio movería filas de otros espacios que no puede leer. Rompe la privacidad del directorio
  (ADR-124) y la regla de que cada espacio es su límite RLS.
- **Por qué no:** pide una autoridad que no existe en Hour (nadie es admin de dos espacios a la vez por definición).

### (c) Alias sin mover nada

Una tabla `person_alias (workspace_id, person_id, same_as)`, y cada lector une los dos ids.

- Cero filas movidas y deshacer trivial.
- Pero cada lector de persona (eje del Planner, `/api/team`, reparto, «voy», Desk, directorio, ficha, buzón) tendría que
  conocer el alias para siempre. Es la deuda que no se paga nunca, y un lector que la olvide parte a la persona en dos.
- **Por qué no:** el coste está en cada consulta futura, no en una migración.

## 3. Esquema (alternativa a)

Todo aditivo, salvo redefinir el guard de `note` (misma firma, copiada de la base viva).

| Tabla | Columnas | Nota |
|---|---|---|
| `person_merge` | `id`, `workspace_id`, `keep_person_id`, `drop_person_id`, `reason` (`invitation`, `manual`), `invitation_id` NULL, `keep_dossier_before jsonb` (NULL si no existía), `drop_dossier_before jsonb`, `merged_by`, `merged_at`, `undone_at`, `undone_by` | Una fila por fusión. RLS: la lee el admin del espacio. Los dossiers en jsonb son datos que el admin ya puede leer |
| `person_merge_row` | `merge_id`, `table_name`, `row_id`, `column_name`, `action` (`repointed`, `retired`, `removed`), `row_before jsonb` NULL | Lo que se movió. **Sin grant a nadie**: solo la leen las RPC. `row_before` solo para `removed` (filas sin borrado blando: `commitment_person`, `conversation_contact`, `person_acquaintance`) y nunca con texto libre privado (ver abajo) |
| `workspace_person.previous_slugs text[] NOT NULL DEFAULT '{}'` | | El slug de `drop` sigue abriendo la ficha de `keep`, como `previous_slugs` de la conversación (ADR-102 § 7) |

**Por qué `person_merge_row` no se publica.** Una fusión mueve también lo que el admin no ve: notas privadas de otros
(`note`, ADR-093), «lo conozco» sin compartir (`person_acquaintance`) y contactos de conversaciones privadas ajenas
(ADR-124). Si el admin pudiera leer la lista, sabría quién conoce a quién y que existe una conversación privada con esa
persona. Las RPC la usan; la pantalla solo enseña recuentos de lo que el admin ya puede leer.

**El guard de la nota.** `guard_immutable_note_anchor` hoy prohíbe cambiar `note.person_id` («delete and rewrite»).
Borrar y reescribir cambiaría el id y el autor de notas ajenas. Propuesta: el guard deja pasar el cambio de
`person_id`, y solo ese, cuando `current_setting('hour.person_merge', true)` trae el id de una fusión en curso **y**
`current_user` no es `authenticated` ni `anon` (o sea, dentro de una función SECURITY DEFINER). PostgREST no expone
`set_config`, así que nadie lo activa desde fuera. Test RLS que lo intenta.

## 4. RPC

Las tres SECURITY DEFINER, `search_path` fijo, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`.

### `preview_person_merge(p_workspace_id, p_keep_person_id, p_drop_person_id)`

Solo lectura. Devuelve los dos dossiers (nombre, email, teléfono, cargo, cuenta enlazada sí/no), los recuentos por tipo
**de lo que quien llama puede leer** (reparto, funciones, «voy», conversaciones, envíos, notas propias) y los choques que
se resolverán y cómo. Rechaza lo mismo que la fusión. La pantalla de confirmar la llama.

### `merge_workspace_person(p_workspace_id, p_keep_person_id, p_drop_person_id, p_fields jsonb DEFAULT '{}', p_invitation_id uuid DEFAULT NULL)`

En una transacción, con `SELECT ... FOR UPDATE` sobre los dos dossiers:

1. **Puertas** (42501 igual para «no existe» y «no puedes», como el resto de la casa):
   `is_workspace_admin(p_workspace_id)`; los dos dossiers vivos y legibles por quien llama
   (`private.workspace_person_readable_by_caller`); `keep <> drop`.
2. **Cuentas** (22023): si `drop` está enlazado a una cuenta y `keep` no, se intercambian solos (la persona de una cuenta
   siempre se queda: su `person_id` es global y moverlo tocaría otros espacios). Si los dos tienen cuenta, se rechaza:
   dos logins son dos personas, o un problema de cuentas que esto no resuelve.
3. **Dossier `keep`.** Si no existe en el espacio, se crea con los campos de `drop` y el slug de `drop`. Si existe, cada
   campo vacío de `keep` toma el de `drop`; `notes` se concatenan; `p_fields` deja elegir a mano nombre, email y
   teléfono cuando los dos tienen valor. Si `keep` tiene `profile_sync_enabled`, los campos compartidos los manda el
   perfil de la persona en la siguiente sincronización (es su dato, ADR-107: enlazar no es compartir, compartir sí).
4. **Reapuntar**, con `hour.person_merge` puesto, en este orden y solo filas con `workspace_id = p_workspace_id`:

   | Tabla | Si choca con una fila de `keep` | Acción guardada |
   |---|---|---|
   | `cast_member` | mismo proyecto y papel, viva: la de `drop` se borra en blando; `joined_at` el más antiguo, `left_at` el más reciente o NULL | `retired` |
   | `cast_override` | misma función: se queda la de `keep`. Una que acaba sustituyéndose a sí misma (`person_id = replaces_person_id`) se borra en blando | `retired` |
   | `crew_assignment` | misma función y papel: se queda la de `keep`, `notes` se concatenan | `retired` |
   | `availability_block` | sin choque | `repointed` |
   | `commitment_person` | misma función o fecha: gana la actualizada más tarde; la otra se borra | `removed` con `row_before` (estado, quién lo puso) |
   | `conversation_contact` | misma conversación: una sola fila; `since` el más antiguo, `until` el más reciente o NULL, principal si cualquiera lo era, papel el de `keep` si lo tiene | `removed` con `row_before` |
   | `person_acquaintance` | mismo usuario: una fila, `shared` solo si **las dos** estaban compartidas (gana lo más privado) | `removed` con `row_before` |
   | `note` | sin choque; autor y cuerpo no cambian | `repointed` (sin cuerpo) |
   | `workspace_invitation`, `mailout_recipient` | sin choque; el historial pasa a nombrar a `keep` | `repointed` |

5. **Dossier `drop`:** `deleted_at = now()`, `custom_fields.merged_into = keep`; su slug pasa a
   `keep.previous_slugs`. La persona global `drop` no se toca.
6. **Enlace:** si viene de una invitación (`p_invitation_id`) y la cuenta que la aceptó es `keep`, nada más que hacer;
   si la cuenta no era nadie (no debería pasar: entonces ya se habría enlazado), se enlaza.
7. Fila en `person_merge`. Los triggers `write_audit` de cada tabla escriben su antes y después como siempre.

Devuelve el id de la fusión y los recuentos.

### `undo_person_merge(p_merge_id)`

Admin del espacio, fusión de menos de 30 días y no deshecha.

- Revive el dossier `drop` con su `drop_dossier_before`; devuelve `keep` a `keep_dossier_before` (o lo borra en blando
  si la fusión lo creó y no tiene filas nuevas); quita el slug de `previous_slugs`.
- Cada fila `repointed` y `retired` vuelve a `drop` y se revive; cada `removed` se reinserta desde `row_before`.
- **Lo que no se deshace:** lo creado sobre `keep` después de la fusión se queda en `keep` (no se puede saber de quién
  era). Una fila movida que después se borró se salta. La RPC devuelve cuántas se saltó.
- Pone `undone_at`. Una fusión deshecha no se rehace: se fusiona otra vez.

## 5. Permisos

- **Fusionar y deshacer: solo el admin del espacio.** No `private.can_write_workspace_person` (quien puede crear un
  dossier): la fusión mueve notas ajenas y contactos de conversaciones, que no son suyos. Es la autoridad que ADR-107 ya
  le dio a invitar.
- **Lo que el admin no ve se mueve, pero no se cuenta.** Notas privadas de otros, «lo conozco» sin compartir y contactos
  de conversaciones privadas ajenas pasan a `keep` igual que el resto (es la misma persona) y no salen en la vista
  previa ni en el resultado (ADR-099 § 4: una privada desaparece también de los recuentos). Pregunta 3.
- Un dossier que el admin no puede leer (solo es contacto de una privada ajena, ADR-124 § 2) no se puede fusionar: 42501.
- `person_merge` la lee el admin del espacio. `person_merge_row` no la lee nadie por PostgREST.
- La persona fusionada **no tiene que confirmar** (pregunta 2): los dos dossiers son datos del espacio, y ella ya aceptó
  una invitación al email del dossier.

## 6. Pantalla

### 6.1 Al aceptar la invitación: el aviso le llega al admin

Hoy nadie se entera. `accept_workspace_invitation` sigue igual (no fusiona sola), y el caso se deduce sin columna nueva:
invitación aceptada con `person_id`, la cuenta que la aceptó es otra persona, el dossier de la invitación sigue vivo y
no hay fusión. Sale en dos sitios, de la misma consulta:

- **En la ficha del dossier**, en la franja «Falta» de ADR-139 (§ 2):

```
Inés Ortega                                              [Invitar] [···]
programación · Pradillo · ines@sala.example
─────────────────────────────────────────────────────────────────────────
Falta   Inés aceptó la invitación con una cuenta que ya es otra persona.
        [Unir con su cuenta]
```

- **En Ajustes › Equipo**, junto a las invitaciones: «Aceptada, sin unir · Unir».

La persona que acepta ve lo de hoy: entra en el espacio. **Suposición:** no hace falta decirle nada; su ficha en el
espacio aparece cuando el admin une.

### 6.2 En la ficha: «Fusionar con…»

Menú `···` de la ficha de persona, solo para el admin. Abre el selector de personas de siempre (`PersonPicker`),
excluyendo la propia; después, la confirmación:

```
Fusionar dos fichas                                                 [×]
─────────────────────────────────────────────────────────────────────────
                    Se queda                    Desaparece
Nombre        (•) Inés Ortega             ( ) Inés Ortega Ruiz
Email         (•) ines@sala.example        ( ) ines@correo.example
Teléfono          (vacío)                 (•) 600 000 000
Cuenta            sí (entra en Hour)          no
─────────────────────────────────────────────────────────────────────────
Pasa a «Inés Ortega»: 2 papeles de reparto · 5 «voy» · 1 conversación
· 3 notas tuyas.  Si las dos están en lo mismo, se queda una.
La dirección que desaparece deja de traer correo a Hour.
Se puede deshacer durante 30 días.
                                        [Cancelar]  [Fusionar]
```

- Se queda por defecto la que tiene cuenta; si ninguna, la más antigua. Los radios solo salen donde las dos tienen valor.
- Tras fusionar, la ficha de `keep` con un aviso con acción, el toast de ADR-126 § 11: «Fichas fusionadas · Deshacer».
- En la ficha de `keep`, una línea plegada en «Detalles»: «Fusionada con Inés Ortega Ruiz el 22 oct · Deshacer» mientras
  quepa el plazo; después, solo la fecha.
- La URL vieja de `drop` abre `keep` (`previous_slugs`). Un pin `pe:<drop>` del Planner se cambia por `pe:<keep>` al
  leerlo, mirando `person_merge` (el endpoint de equipo ya resuelve pins; **suposición** sobre dónde exactamente).

### 6.3 El email que desaparece

`workspace_person` lleva un solo email, y el buzón empareja solo por él (`mail_contact_addresses`). Fusionar con dos
emails distintos pierde uno para el buzón: los correos de esa dirección dejan de entrar. La confirmación lo dice
(«deja de traer correo») y el admin elige cuál se queda. Pregunta 4.

## 7. Auditoría

- `person_merge`: quién, cuándo, por qué (invitación o a mano), los dos dossiers antes.
- Cada fila movida deja su antes y después en `audit_log` por su trigger `write_audit` (ya existe en reparto, compromisos,
  contactos, notas, disponibilidad). `audit_log` no se reescribe: una fila vieja sigue diciendo `drop`, que es lo que
  pasó.
- `workspace_person` no tiene trigger de auditoría (verificado): el cambio del dossier queda en `person_merge`.

## 8. Migración

Aditiva: dos tablas, una columna con DEFAULT, tres RPC, el guard de `note` redefinido con su firma viva. No mueve datos:
las 40 de `playwright` se quedan como están (son la fixture de los tests). Gate de § 34: backup, plan y apply por
`production-migrate.yml`; staging opcional, **recomendación: no hace falta** (no toca filas existentes); el guard
redefinido se compara byte a byte con el de la base viva en el rollback.

Rollback (`build/runbooks/rollback-2026102x-person-merge.sql`, probado ida y vuelta en local): borrar RPC, tablas y
columna; el guard vuelve a la versión viva. Lo que no deshace: fusiones ya hechas (las filas se quedan en `keep`; se
deshacen con `undo_person_merge` antes del rollback).

## 9. Riesgos y pruebas

| Riesgo | Por qué importa | Prueba |
|---|---|---|
| Una fusión toca otro espacio | Rompe el límite RLS | RLS: persona `drop` con dossier en dos espacios de `playwright`; tras fusionar en A, en B no cambia ni una fila |
| Alguien que no es admin fusiona | Mueve notas y contactos ajenos | RLS: member con `edit:performance` y owner de otro espacio: 42501 |
| Un dossier invisible se fusiona o se delata | ADR-124 § 2 | RLS: dossier que solo es contacto de una privada ajena: 42501, el mismo error que uno inexistente; la vista previa no cuenta filas de una privada ajena ni notas ajenas |
| La lista de lo movido delata quién conoce a quién | `person_acquaintance` sin compartir | RLS: `person_merge_row` da 0 filas o permiso denegado a todos, también al admin |
| Dos cuentas en una persona | `user_profile_person_id_key` y dos humanos | RLS: `keep` y `drop` con cuenta: 22023; `drop` con cuenta y `keep` sin: se intercambian |
| Un choque de unicidad aborta a medias | Seis índices únicos | RLS: fixture con reparto en el mismo proyecto y papel, «voy» en la misma función, contacto en la misma conversación y «lo conozco» del mismo usuario: la fusión pasa y queda una fila de cada |
| El guard de la nota se abre desde fuera | Cambiar el ancla de notas ajenas | RLS: `PATCH note.person_id` por PostgREST: 42501, también tras llamar a cualquier RPC |
| Deshacer deja la persona a medias | Filas borradas o creadas después | RLS: fusionar, añadir un «voy» a `keep`, borrar una fila movida, deshacer: lo movido vuelve, lo nuevo se queda en `keep`, lo borrado se cuenta como saltado |
| Deshacer fuera de plazo o dos veces | | RLS: a los 31 días (fecha forzada en la fila) y una segunda vez: 22023 |
| Correo que deja de entrar | Un email por dossier | Unit del aviso; RLS: `mail_contact_addresses` tras fusionar devuelve el email elegido |
| Pins y URL viejas | El eje de persona, enlaces guardados | Unit: pin `pe:<drop>` se resuelve a `keep`; E2E: la URL vieja abre la ficha nueva |
| E2E escribe en datos reales | El usuario del E2E es admin de `muk-cia` (memoria del proyecto) | Todo en `playwright`, cada spec crea sus dos dossiers; nunca `muk-cia` |

Suites: `pnpm --filter web test:rls` con `tests/rls/person-merge.test.ts` (los casos de arriba); unit del mezclado de
campos y del pin; E2E contra un origen desplegado: invitar, aceptar con la cuenta del E2E (ya es otra persona), ver
«Falta» en la ficha, unir, ver la ficha con el reparto de las dos, deshacer.

## 10. Fases

| Fase | Qué | Migración | Carriles |
|---|---|---|---|
| 0 | ADR con el modelo y las respuestas de § 11. Enmienda ADR-107 («el caso abierto») | No | Coordinador |
| 1 | Esquema y RPC: `person_merge`, `person_merge_row`, `previous_slugs`, guard de `note`, las tres RPC. Tests RLS. El Worker no lee nada | Sí, aditiva, § 34 | 1 |
| 2 | Ficha: «Fusionar con…», confirmación con vista previa, toast y línea de «Deshacer», URL vieja | No | 1 |
| 3 | El aviso: «Falta» en la ficha del dossier de una invitación aceptada sin unir, línea en Ajustes › Equipo, pins del Planner | No | 1, detrás de la 2 (comparten la ficha) |

Total: 3 carriles y el ADR, uno detrás de otro. La fase 2 sola ya resuelve el caso a mano.

## 11. Falta decidir (tu llamada)

1. **¿Qué se fusiona?**
   - **El dossier dentro de un espacio** (recomendada). El dossier es privado de cada espacio y las personas globales
     que crea Hour son de un solo espacio: fusionar ahí es fusionar del todo sin cruzar ninguna frontera.
   - La persona global en todos los espacios. Una sola identidad de verdad, pero un admin movería filas de espacios que
     no puede leer.
   - Un alias sin mover filas. Deshacer gratis, a cambio de que cada lector de persona lo conozca para siempre.

2. **¿Quién confirma?**
   - **Solo el admin del espacio** (recomendada). Es lo que decidiste el 14-10 (ADR-107), los dos dossiers son datos del
     espacio y la persona ya aceptó una invitación a ese email.
   - El admin propone y la persona acepta desde su cuenta. Más consentimiento, pero el caso de «dos fichas sin cuenta»
     no tiene a quién preguntar, y deja la persona partida mientras no conteste.

3. **Lo que el admin no ve (notas ajenas, «lo conozco» sin compartir, contactos de privadas ajenas):**
   - **Se mueve y no se cuenta** (recomendada). Es la misma persona; moverlo no enseña nada a nadie, y dejarlo atrás
     partiría a la persona justo en lo privado.
   - Se rechaza la fusión si hay filas así. Más prudente en apariencia, pero el rechazo delata que existen.
   - Se queda en el dossier sobrante. La nota privada de Anouk sobre Inés acabaría colgando de una ficha borrada.

4. **Dos emails distintos:**
   - **El admin elige cuál se queda, y la confirmación avisa de que el otro deja de traer correo** (recomendada). Cero
     esquema nuevo y la pérdida queda dicha.
   - Varios emails por dossier (`other_emails`) y el buzón empareja por todos. Lo completo, pero toca
     `mail_contact_addresses`, el envío y la base por dirección (ADR-110); va mejor como tarea propia.

5. **¿Cuánto dura «Deshacer»?**
   - **30 días** (recomendada). Cubre el «me equivoqué de Inés» de la semana siguiente sin guardar para siempre la lista
     de lo movido.
   - Siempre. Más seguro, pero cuanto más tarde, más filas nuevas sobre `keep` que deshacer no puede repartir.
   - Solo el toast, unos segundos. Lo más simple; un error visto al día siguiente ya no tiene arreglo sin backup.

6. **¿Se avisa en Desk al admin de una invitación aceptada sin unir?**
   - **No: «Falta» en la ficha y la línea de Ajustes** (recomendada). Pasará pocas veces y no corre prisa: nada se rompe
     mientras no se une, solo hay dos fichas.
   - Sí, en «Te espera». Imposible de pasar por alto, pero mete en Desk una tarea de mantenimiento.

## Fuera de este plan

- Fusionar organizaciones (ADR-102 § 6: a mano, se hizo por SQL el 13-10). Tendría la misma forma; si hace falta, otro
  plan.
- Detectar duplicados solos (mismo nombre, mismo teléfono) y proponerlos. Encaja con «la IA propone, una persona
  aprueba», pero hoy no hay ni un duplicado real.
- Fusionar dos cuentas de Hour.
- Limpiar las 40 invitaciones sin unir de `playwright`: son la fixture de los tests.
