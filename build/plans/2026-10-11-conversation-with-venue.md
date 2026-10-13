# Plan: la conversación de difusión es con la sala (ADR-102)

> 2026-10-11. Solo plan: nada aplicado, nada desplegado. Rama `claude/conversation-venue-plan`.
> Actualizado el mismo día con las respuestas de Marco (ADR-102, añadido): § 6 queda contestada y el plan las recoge.
> Fuentes: ADR-098, ADR-099, ADR-100, ADR-102, `_tasks.md § 34`, el repaso del panel
> (`research/product/2026-10-11-comms-conversacion-repaso.md`, rama `claude/comms-conversation-review`),
> el catálogo de producción leído con SELECT el 2026-10-11 y `grep` sobre `supabase/migrations` y `apps/web`.

## Decidido (ADR-102, añadido del 2026-10-11)

1. Sin conversación sin organización: con un programador independiente se crea una organización con su nombre.
2. El enlace organización-directorio, más adelante (fuera de este plan).
3. Una conversación por organización y proyecto.
4. Un correo entra por las fechas del contacto **y además por hilo**: una respuesta a un hilo que ya está en la
   conversación entra siempre (el «gracias» de quien ya se fue); un hilo nuevo, solo dentro de las fechas (§ 3,
   «Emparejado de correos»).
5. **El pagador es la organización**, no el contacto principal: la factura apunta a la organización y a su identidad
   fiscal (§ 3, «Dinero»; fase 2b).
6. Los posibles duplicados se revisan a mano en la fase 3, antes del contract; sin fusión automática.
7. El slug de la conversación pasa al de la organización, con el viejo en `previous_slugs`.

## 0. Estado de partida, verificado

- Producción ya lleva aplicadas `20261011100000_permissions_facets_expand` a `20261011500000_conversation_revive_privacy`
  (la foto de `_context.md` dice `venue_directory` como última: está atrasada).
- `conversation.person_id uuid NOT NULL`, FK simple a `person` (RESTRICT) y compuesta `conversation_workspace_person_fkey`
  `(workspace_id, person_id) -> workspace_person`. Unicidad hoy: dos índices parciales,
  `conversation_project_person_shared_uidx (workspace_id, project_id, person_id) WHERE deleted_at IS NULL AND private_to IS NULL`
  y `conversation_project_person_private_uidx (..., private_to) WHERE ... private_to IS NOT NULL`.
- La conversación no apunta a ninguna organización: la organización llega por `workspace_person.organization_id`.

## 1. Qué depende hoy de `conversation.person_id`

### Base de datos (catálogo de producción)

| Objeto | Qué hace con `person_id` |
|---|---|
| Columna | `NOT NULL`; grant a tabla entera (ALL) a `authenticated` y `anon` (este sin policy). `column_privileges` lo lista por columna, pero no hay grant por columnas: una columna nueva queda cubierta sola |
| FK `conversation_person_id_fkey` | `-> person(id) ON DELETE RESTRICT` |
| FK `conversation_workspace_person_fkey` | `(workspace_id, person_id) -> workspace_person`. **Es el nombre que usan los embeds de PostgREST** |
| Índices | `conversation_person_idx`, `conversation_workspace_person_idx`, los dos `*_project_person_*_uidx` |
| Policies de `conversation` | No usan `person_id` (proyecto, permiso `read/edit:conversation`, `private_to`). No cambian |
| Triggers | Ninguno usa `person_id` (`write_audit` lo copia al log, nada más) |
| Vistas | Ninguna depende de `conversation` |
| `create_conversation(...)` | Resuelve o crea persona y dossier (y organización por nombre), comprueba unicidad por persona, revive la borrada por persona, **slug = slug del dossier** |
| `create_invoice_from_bolo` | `SELECT person_id INTO v_inferred_payer FROM conversation WHERE id = v_bolo.conversation_id`: el pagador por defecto |
| `list_money_payers` | Los pagadores posibles salen de `conversation.person_id` unido al dossier y su organización |
| `mail_contact_addresses` | Las direcciones que sincroniza un buzón: email del dossier de `c.person_id` |
| `mail_ingest_message` | Empareja un correo con las conversaciones cuyo `c.person_id` tiene un email entre las contrapartes |
| `mail_send_authorize` | El destinatario es el email del dossier de `v_conv.person_id` |
| `mail_account_eligible_conversation` | No usa `person_id` (privacidad y alcance); no cambia |
| FKs entrantes | `bolo`, `performance`, `task`, `conversation_event` apuntan a `conversation.id`: **no cambian** |

### Web (`apps/web/src`)

- Embed por nombre de FK `person:workspace_person!conversation_workspace_person_fkey(...)` en
  `lib/conversation.ts:279` (`CONVERSATION_SELECT`), `lib/task.ts:135`, `lib/server/performance-bundle.ts:247` y
  `routes/api/conversations/+server.ts:119-120` (la búsqueda `q` hace `!inner` sobre el dossier y filtra
  `person.or=(full_name,email)`).
- `routes/api/conversations/+server.ts` POST: `person_id` o `person` inline, exactamente uno, a `create_conversation`.
- `routes/api/persons/[key]/+server.ts:80-84`: la ficha de persona lista sus conversaciones con `person_id=eq.`.
- `routes/api/money/payers` (RPC `list_money_payers`), `routes/api/mail/send` (`mail_send_authorize`),
  `lib/server/mail/db.ts` (`mail_contact_addresses`, `mail_ingest_message`).
- Tipos y normalizadores: `ConversationItem.person` en `lib/conversation.ts`, `desk-feed.ts` (`person.full_name ||
  organization_name`, `personSlug`), `hall-status.ts`, `task.ts`, `roadsheet.ts` (vía bundle).
- Componentes: `ConversationTable.svelte` (nombre, ciudad, enlace a la persona), `line/ConversationsModule.svelte`,
  `RelationshipStub.svelte`, `ConversationHistory.svelte`, `HomeView.svelte`, `DeskBoard.svelte`, páginas
  `h/conversations`, `h/desk`, `h/money`, `h/[workspace]/conversation/[slug]` (stub), `.../person/[slug]`,
  `.../project/[slug]` y `.../line/[line]`. i18n en los cuatro idiomas.
- `lib/db-types.ts`: regenerar en cada fase con schema.

### Tests y fixtures

- RLS: `conversation-lifecycle.test.ts` (12 usos), `line-modules.test.ts` (6), `conversation-revive-privacy.test.ts` (3),
  `conversation-event.test.ts` (2), `mail-google.test.ts` (1), `money-v3.test.ts` (pagador inferido).
- E2E: `conversation-create.spec.ts` (crea persona y conversación, la busca por `person.email`), `conversation-write`,
  `line-detail`, `person`, `scope-url`, `pulse`, `tasks`, `smoke`.
- Fixtures que insertan `conversation.person_id`: `supabase/fixtures/staging.sql`, `playwright-difusion.sql`,
  `seed-season-local.sql`.

## 2. Datos reales (producción, solo SELECT, 2026-10-11)

| Espacio | Vivas | Con organización | Sin organización | Privadas | Proyectos |
|---|---|---|---|---|---|
| `muk-cia` | 154 (155 con 1 borrada) | 154 | 0 | 0 | 1 |
| `playwright` | 24 (34) | 0 | 24 | 0 | 1 |
| `demo` | 3 | 3 | 0 | 0 | 1 |
| `marco-rubiol` | 0 (1 borrada) | 0 | 0 | 0 | 0 |

- **Fusiones por organización: 0.** En `muk-cia` hay 154 organizaciones para 154 dossiers, una por persona; ninguna
  organización tiene más de un dossier ni más de una conversación por proyecto.
- Señales de duplicado que el backfill no ve: **1 par** de organizaciones cuyo nombre coincide al quitar mayúsculas y
  signos (2 conversaciones), y **6 dominios de correo no personales compartidos por 14 dossiers** (pueden ser la misma
  institución o una red municipal con varias salas; no lo sé sin mirar nombres, y no los he mirado). 31 dossiers usan
  correo personal (gmail y similares).
- Las 154 organizaciones son finas: `kind = 'other'` todas, sin email, web ni ciudad. 7 tienen un nombre idéntico en
  `venue_directory`.
- Colgando de conversaciones: 3 bolos, 3 funciones, 0 tareas, 83 eventos (`conversation_event`). 0 facturas con
  `payer_person_id` (de 354). Buzones: 1 conectado, 0 correos procesados (`mail_message` vacío).
- `conversation.role` es nulo en las 154 de `muk-cia`.

## 3. Modelo propuesto

### La entidad: `workspace_organization`

- `workspace_organization` es «quien programa» en el espacio: tiene `kind` (`theatre`, `festival`, `presenter`,
  `institution`…), RLS por espacio y ya es la organización del dossier. Es la contraparte de ADR-102.
- `venue` no: es el **lugar** físico de una función (`performance.venue_id`, aforo, zona horaria). Una organización
  programa varios lugares (una red municipal) y un lugar acoge a varios programadores (un festival en un teatro).
- `venue_directory` tampoco: es catálogo global y público, sin RLS de espacio. Puede alimentar una organización (crearla
  desde una ficha del directorio), pero la conversación cuelga de la copia del espacio. Enlazar organización y
  directorio es una pregunta aparte (§ 6, P2) y no bloquea este plan.

### Cambios

```
conversation
  + organization_id uuid           -- NOT NULL en la fase de contract
    FK (workspace_id, organization_id) -> workspace_organization (workspace_id, id)   -- mismo espacio por construcción
  - person_id, - role              -- en contract
  unicidad: (workspace_id, project_id, organization_id) WHERE deleted_at IS NULL AND private_to IS NULL
            (workspace_id, project_id, organization_id, private_to) WHERE ... private_to IS NOT NULL
  slug: el de la organización; el slug de persona pasa a previous_slugs (las URLs viejas siguen resolviendo)

conversation_contact                -- nueva
  id uuid pk, workspace_id, conversation_id -> conversation ON DELETE CASCADE
  person_id, FK (workspace_id, person_id) -> workspace_person
  role text NULL                    -- «programadora», «técnico», «producción»...
  since date NULL, until date NULL  -- until NULL = contacto vigente; CHECK until >= since
  is_primary boolean NOT NULL DEFAULT false
  created_by, created_at, updated_at
  UNIQUE (conversation_id, person_id)          -- una fila por persona; volver es poner until a NULL
  UNIQUE (conversation_id) WHERE is_primary AND until IS NULL   -- un principal vigente como mucho
```

- `workspace_person.organization_id` se queda: dice dónde trabaja hoy la persona. El contacto dice qué papel tiene en
  esta conversación y desde cuándo. No se sincronizan solos: cambiar de organización a Inés propone (en UI) cerrar su
  contacto en la conversación de Pradillo, no lo hace la base.
- Un contacto no tiene por qué pertenecer a la organización (una distribuidora, un agente): no hay CHECK entre las dos.

### Sin organización

Hoy no hay ninguna conversación real sin organización; las 24 sin ella son fixtures de `playwright`. Propuesta:
`organization_id` obligatorio, y crear una conversación solo con una persona crea la organización con el nombre que se
dé (por defecto, el de la persona, para un programador independiente). Una sola clave de unicidad y un solo título del
panel. Es la P1 de § 6.

### Emparejado de correos (ADR-099 §3)

Dirección -> dossier (`workspace_person.email`) -> sus filas de `conversation_contact` -> conversación. Un correo entra
en una conversación por una de dos vías (decisión 4):

1. **Por fechas.** Alguna contraparte era contacto **en la fecha del correo**: `since IS NULL OR occurred_at::date >= since`
   y `until IS NULL OR occurred_at::date <= until`. Así un hilo nuevo de Inés desde su sitio nuevo no cae en Pradillo.
2. **Por hilo.** Alguna contraparte es o fue contacto de la conversación (cualquier fecha) **y** el correo sigue un hilo
   que ya tiene un evento en esa conversación: mismo `metadata.provider_thread_id` en el mismo buzón
   (`metadata.mail_account_id`; el id de hilo de Gmail es por buzón), o un `In-Reply-To`/`References` que nombra el
   `rfc_message_id` de un evento de la conversación (esto cruza buzones: el personal y el común). Es el «gracias» de
   quien ya se fue. Un hilo nuevo fuera de fechas no entra.

La vía 2 exige que el conector mande `in_reply_to` y `references` en `p_message` (hoy no los manda: cambio en
`lib/server/mail/`) y un índice de expresión sobre `conversation_event ((metadata ->> 'provider_thread_id'))` donde
`source = 'email'`. El orden importa en una pasada: los correos de un hilo se ingieren del más viejo al más nuevo, para
que la respuesta encuentre ya dentro el correo al que responde.

Si una dirección casa con varias conversaciones (dos proyectos con Pradillo), entra en todas, como hoy; la idempotencia
por `external_ref` no cambia. `mail_contact_addresses` sincroniza las direcciones de los contactos vigentes, más los
cerrados hace menos de 12 meses (para traer su historial, ADR-100, y para ver las respuestas de la vía 2). `mail_send_authorize` devuelve los contactos
vigentes con email, el principal primero; enviar elige uno.

### Privacidad (ADR-099 §4, ADR-100)

- `private_to` sigue en `conversation` y la unicidad lo lleva, como hoy: dos personas pueden tener cada una su
  conversación privada con Pradillo en el mismo proyecto, y una compartida.
- `conversation_contact` hereda la frontera literalmente, como `conversation_event` (ADR-098): policy de lectura =
  `EXISTS (SELECT 1 FROM conversation c WHERE c.id = conversation_id)` corriendo con la RLS de la conversación. Sin
  INSERT, UPDATE ni DELETE para `authenticated`; se escribe por RPC con `edit:conversation`, y «no existe» y «no es
  tuyo» dan el mismo 42501. SELECT a tabla entera (sin grant por columnas).
- La ficha de persona lista sus conversaciones vía `conversation_contact` embebiendo `conversation!inner`: una privada
  ajena no aparece ni cuenta.

### Facetas (ADR-100)

La conversación sigue siendo del proyecto: `read:conversation` y `edit:conversation` siguen siendo la faceta `converses`
del contenedor. Los contactos no crean faceta propia. La organización es del espacio (la lee cualquier miembro interno,
como hoy); el nombre de una sala no es secreto, lo hablado con ella sí, y eso vive en la conversación y sus eventos.

### Dinero

El pagador es la organización (decisión 5). Hoy la factura lleva dos punteros: `payer_person_id` (a quién, inferido de
`conversation.person_id`) y `payer_fiscal_identity_id` (una `fiscal_identity` `kind = 'receiver'` del espacio, que
`issue_invoice` congela en `payer_snapshot`). 0 de 354 facturas tienen `payer_person_id`.

- `invoice.payer_organization_id uuid`, FK compuesta `(workspace_id, payer_organization_id) -> workspace_organization`.
  Sustituye a `payer_person_id`, que se borra en el contract (fase 4).
- `workspace_organization.fiscal_identity_id uuid -> fiscal_identity` (receptora del mismo espacio): los datos fiscales
  de la sala. Mismo patrón que `workspace.fiscal_identity_id` para el emisor, y `fiscal_identity` no cambia. Un guard
  exige `kind = 'receiver'` y mismo espacio.
- `create_invoice_from_bolo` infiere `payer_organization_id` de `conversation.organization_id` del bolo y, si la factura
  no trae `payer_fiscal_identity_id`, toma el de la organización. `issue_invoice` no cambia: sigue congelando la
  identidad fiscal en el snapshot. El parámetro `p_payer_person_id` se sustituye por `p_payer_organization_id`.
- `update_invoice` acepta `payer_organization_id` en el patch (borrador), con la misma regla de espacio.
- `list_money_payers` lista organizaciones (id, slug, nombre, si tienen identidad fiscal) de las conversaciones que
  quien llama puede ver. **Hoy no filtra `private_to`** (es SECURITY DEFINER y une `conversation` sin la condición de
  ADR-099): enseña a otro editor de dinero la persona de una conversación privada ajena. La reescritura lo corrige.
- Books (web): el desplegable de pagador pasa a organizaciones; la factura enseña la organización y avisa si no tiene
  datos fiscales antes de emitir. Crear o editar la identidad fiscal de una organización vive en su ficha.

## 4. Fases (expand/contract), cada una desplegable

### Fase 1 · Expand: columna, tabla y relleno (aditiva) · construida

Migración `20261011600000_conversation_organization_expand.sql` (rama `claude/conversation-venue-plan`, sin aplicar en
ninguna base alojada):
1. `conversation.organization_id` nullable con la FK compuesta `conversation_workspace_organization_fkey` (sin
   `ON DELETE`: la organización se borra en blando) y su índice parcial.
2. `conversation_contact` con RLS forzada, policy de lectura heredada, `write_audit`, `set_updated_at`,
   `guard_immutable_workspace_id`. FK compuesta al dossier (`ON DELETE CASCADE`), `UNIQUE (conversation_id, person_id)`,
   `until >= since`, y dos reglas para el principal: uno como mucho (índice único parcial) y siempre vigente
   (`CHECK (NOT is_primary OR until IS NULL)`). Solo SELECT para `authenticated`.
3. Relleno en la misma transacción: `organization_id` desde el dossier (solo si la organización está viva), sin tocar
   `updated_at` (se desactiva su trigger durante el UPDATE; la auditoría sí lo apunta); un contacto principal por
   conversación, también las borradas. Comprobaciones que abortan si algo no cuadra.
   **Desviación:** `since` queda NULL, no `first_contacted_at::date`. Las 154 de `muk-cia` se dieron de alta en
   octubre y ese sello es la fecha del alta: con él, el emparejado por fechas dejaría fuera todo el correo anterior.
4. Doble escritura: `conversation_fill_organization` (BEFORE INSERT o cambio de `person_id`: organización del dossier
   si falta) y `conversation_sync_primary_contact` (AFTER INSERT o cambio de `person_id`/`role`: el principal es
   `(person_id, role)`; si cambia la persona, el anterior sigue de contacto sin la marca).
5. RPC, sin uso en la UI: `set_conversation_contact(conversation_id, person_id, role, since, is_primary)` (añade o
   rehace, y deja vigente) y `end_conversation_contact(conversation_id, person_id, until)` (hoy por defecto).
   Regla de convivencia hasta la fase 4: el principal es `conversation.person_id`, así que no se puede cerrar ni
   degradar sin nombrar antes a otro (22023), y nombrar principal a otra persona cambia `person_id` y `role` (23505 si
   esa persona ya tiene otra conversación compartida en el proyecto).
6. No se crea todavía la unicidad por organización (el alta vieja la rompería con un 23505 sin salida en la UI).

Gate (§ 34, aditiva): reconstrucción local desde cero con la migración, tipos regenerados, RLS completa. Producción por
`production-migrate.yml` (`backup`, `plan`, `apply`). Recomiendo además `inspect` antes: el backfill escribe en las 154
reales aunque no reescriba nada existente.

Tests RLS (`tests/rls/conversation-contact.test.ts`, 9): el alta por `create_conversation` deja organización y un
principal con su papel; toda conversación visible tiene un principal y es su `person_id`; anon no lee ni escribe; sin
INSERT, UPDATE ni DELETE directos; añadir, cerrar (`until < since` da 400) y volver; el principal no se cierra ni se
degrada; nombrar otro principal mueve `person_id`, deja uno solo y el anterior sigue vigente; dossier o conversación
inexistentes dan el mismo 403; sin `read:conversation` no se ve ni se escribe, y una privada ajena es «no existe».

API y UI: nada cambia (la columna nueva sale en los `select=*`, y ningún normalizador la mira). Rollback:
`build/runbooks/rollback-20261011-conversation-organization-expand.sql`, probado en local bajada y subida con datos. Lo
que no deshace: contactos añadidos por RPC entre medias (no hay UI, así que ninguno salvo a mano).

### Fase 2 · Lecturas y alta por organización

Migración `..._conversation_with_organization_reads.sql`:
1. Unicidad nueva por organización (compartida y privada), parcial `WHERE organization_id IS NOT NULL`. Los datos la
   cumplen hoy (0 fusiones); la migración lo comprueba y aborta si no.
2. `create_conversation` gana `p_organization_id` / `p_organization_name` y la persona pasa a ser opcional (contacto
   principal). Unicidad, revivir y 409 por organización. Si la organización ya tiene conversación en el proyecto y llega
   una persona nueva, devuelve el 23505 con el id existente para que la UI ofrezca «añadirla como contacto».
   Slug de la organización para las nuevas.
3. `mail_contact_addresses`, `mail_ingest_message`, `mail_send_authorize` leen de `conversation_contact` con las
   fechas y la regla del hilo (§ 3), más el índice de `provider_thread_id`. El conector manda `in_reply_to` y
   `references` y ordena los mensajes de un hilo del más viejo al más nuevo. El dinero va aparte (fase 2b).
4. Slugs de las existentes: pasan al de su organización, el viejo a `previous_slugs` (resuelve igual). Es reescritura
   de datos: va con `inspect` y backup.

API: `CONVERSATION_SELECT` embebe `organization:workspace_organization!conversation_workspace_organization_fkey(id,slug,name,kind,city)`
y `contacts:conversation_contact(person_id,role,since,until,is_primary,person:workspace_person!...(slug,full_name,email,phone))`;
se mantiene `person` derivado del principal en el normalizador para no romper consumidores en el mismo deploy. La
búsqueda `q` pasa a nombre de organización o de cualquier contacto (`or` sobre dos embeds; si PostgREST no lo resuelve
limpio, una RPC de búsqueda). POST acepta `organization_id`/`organization` además de `person_id`/`person`.
`/api/persons/[key]` lista conversaciones vía contacto. Nuevos `POST/PATCH /api/conversations/[id]/contacts`.

UI: el título de fila y del panel es la organización; debajo, el contacto principal. Tabla, Desk, Hall, tareas, bundle
de función y ficha de persona. El alta pide organización (con autocompletar sobre las del espacio) y persona opcional.

Gate: aditiva más reescritura de slugs. Local desde cero, RLS, `inspect`, backup. Staging recomendado, no obligatorio.
E2E contra producción tras el deploy: `conversation-create` busca por organización; `person.spec` ve la conversación
por contacto.

Tests RLS nuevos: unicidad por organización (compartida y privada conviven; dos compartidas no); revivir por
organización; el correo de una persona con `until` pasado no entra; uno con fecha dentro sí; un correo cuya dirección
es contacto de dos conversaciones entra en las dos; la respuesta de un contacto cerrado a un hilo que ya está en la
conversación entra (por `provider_thread_id` del mismo buzón y por `In-Reply-To` desde otro buzón); un hilo nuevo del
mismo contacto cerrado no entra; un hilo de otro buzón con el mismo `provider_thread_id` no cuenta;
`mail_send_authorize` no da contactos de una privada ajena; la ficha de persona no filtra conversaciones privadas
ajenas.

Rollback: restaurar las funciones anteriores (cuerpos de `20261011500000` y `20261011200000`) y los slugs desde
`previous_slugs`; drop de los índices nuevos.

**Construida (2026-10-11, rama `claude/conversation-venue-f2`, sin aplicar ni desplegar).** Tres migraciones:
`20261011800000_conversation_with_organization_reads` (alta y lecturas por organización, correo por fechas y por
hilo con espera de los que llegan antes que su hilo, destinatario = contacto principal, grant por columnas),
`20261011810000_conversation_slug_organization` (reescribe slugs) y `20261011820000_conversation_contact_inline`
(«Añadir como contacto» desde el alta). Rollbacks en `build/runbooks/`.

**Orden de despliegue (de la revisión):**
1. `20261011800000` y `20261011820000` por `production-migrate.yml` (`inspect`, backup, plan, apply). Cambian firmas
   (`create_conversation`): `inspect` antes. El Worker viejo sigue funcionando con ellas: llama a `create_conversation`
   sin `p_organization_id` (tiene valor por defecto), busca con su embed de persona (la FK sigue) y su sincronización
   no manda cabeceras de hilo (entra solo por fechas).
2. El Worker (`pnpm --filter web run deploy`).
3. `20261011810000` (slugs), con backup: el Worker nuevo resuelve también el slug viejo por `previous_slugs`.

### Fase 2b · Books: el pagador es la organización

Depende solo de la fase 1 (necesita `conversation.organization_id` relleno); puede ir antes o después de la 2.
Migración `..._invoice_payer_organization.sql`, aditiva salvo funciones:
1. `invoice.payer_organization_id` con su FK compuesta e índice; `workspace_organization.fiscal_identity_id` con su
   guard (receptora, mismo espacio, viva).
2. Relleno: ninguno que hacer (0 facturas con `payer_person_id`); la migración lo comprueba y aborta si hay alguna, para
   no perder un pagador sin traducirlo.
3. `create_invoice_from_bolo` (firma nueva con `p_payer_organization_id`; la vieja se borra en la misma migración tras
   comprobar que no la llama nadie más), `update_invoice`, `list_money_payers` (organizaciones, con `private_to`).
4. `payer_person_id` se queda hasta la fase 4, sin escritores.

API y UI: `/api/money/payers` devuelve organizaciones; `/api/invoices` POST y PATCH aceptan `payer_organization_id`;
`MoneyInvoices.svelte`, `line/MoneyModule.svelte`, `h/money`, `money.ts`, `moneybook.ts`, `desk-feed.ts` (que lee el
pagador) y la i18n. La ficha de organización gana «Datos fiscales» (crear o enlazar una `fiscal_identity` receptora,
con `edit:money`).

Gate: cambia firmas de función (borra la vieja de `create_invoice_from_bolo`): `inspect` antes, por la deriva de
sobrecargas que tumbó los applies del 2026-08-10; local desde cero, RLS (`money-v3.test.ts` reescrito), E2E de Books.

Tests RLS nuevos: el pagador inferido es la organización de la conversación del bolo; la identidad fiscal de la
organización se toma por defecto y `issue_invoice` la congela; una organización de otro espacio se rechaza; una
identidad `issuer` no se puede enlazar a una organización; `list_money_payers` no lista la organización de una
conversación privada ajena (hoy la persona sí sale: es el hueco que cierra).

Rollback: restaurar los cuerpos anteriores (`20260722104500`, `20260724092000`, `20260724093000`) y borrar las dos
columnas.

### Fase 3 · Contactos en la UI

Sin migración (las RPC están desde la fase 1). En el panel «Conversación» (dirección A): bloque «Contacto» con el
principal y los demás; añadir, cambiar principal, cerrar con fecha («Inés deja Pradillo en enero, entra Jordi»).
En la ficha de persona: «contacto en Pradillo desde…, hasta…». Al cambiar la organización de un dossier, aviso de que
sigue siendo contacto vigente en N conversaciones de la organización vieja.
Aquí se resuelven a mano el par de organizaciones con nombre casi igual y los 14 dossiers con dominio compartido, si
Marco decide fusionar (P6). Una RPC `merge_workspace_organization(from, into)` que mueva dossiers y conversaciones y
falle si la fusión choca con la unicidad.

E2E: alta de contacto, cierre y cambio de principal sobre una conversación propia del spec (no sobre `muk-cia`).

### Fase 4 · Contract (destructiva)

Migración `..._conversation_with_organization_contract.sql`:
1. Comprobaciones que abortan: ninguna conversación sin `organization_id`; cada una con persona tiene su contacto.
2. Organizaciones para lo que quede sin ella (hoy solo fixtures; antes se corrigen `staging.sql`,
   `playwright-difusion.sql` y `seed-season-local.sql` para que creen organización y contacto).
3. `organization_id SET NOT NULL`.
4. Drop: trigger de doble escritura, `conversation_project_person_*_uidx`, `conversation_person_idx`,
   `conversation_workspace_person_idx`, `conversation_workspace_person_fkey`, `conversation_person_id_fkey`, columnas
   `person_id` y `role`; firma vieja de `create_conversation` (con persona obligatoria). Los índices nuevos dejan de ser
   parciales por `organization_id IS NOT NULL`.
5. Books: drop de `invoice.payer_person_id`, su FK compuesta y sus dos índices (sin escritores desde la fase 2b).

Antes, en el código (desplegado en un deploy previo, no en el mismo): fuera el `person` derivado del normalizador, fuera
`person_id` del POST, fuera cualquier `select` que nombre `person_id` en `conversation` o `payer_person_id` en `invoice`
(nombrar una columna que ya no existe rompe el `select` entero).

Gate (§ 34, destructiva): staging despierto y reconstruido con las cuatro migraciones, suites completas allí;
`inspect` contra producción (nada fuera de las migraciones sujeta `person_id`: funciones, vistas, el esquema
`hour_backup_*`); backup; plan; apply. RLS y E2E contra producción después.

Rollback: script que vuelve a añadir `person_id` nullable, lo rellena desde el contacto principal (o el último que lo
fue), repone FKs, índices y trigger, y deja `NOT NULL` si no quedan nulos. Lo que no recupera: `role` por conversación
si se editó en el contacto (vuelve el del principal), y las conversaciones creadas sin persona (quedan con `person_id`
nulo hasta asignarles uno).

**Construida (2026-10-13, rama `claude/adr-102-f4`, aplicada solo en la Supabase local).** Migración
`20261013100000_conversation_with_organization_contract`, rollback en `build/runbooks/` (probado en local: bajada y
subida). En local: `check` 0/0, unit 843/843, RLS contra la base local 308/312 (4 saltados), y la app en `vite dev`
contra ella (Conversations, Desk, Cuentas, `/api/money/payers` y `/api/tasks` sin errores).
Desviaciones del plan:
1. **`person` se queda en la API**, derivado del contacto principal (`contacts`), no del FK: lo leen la tabla, Desk,
   Hall, tareas y el bundle de función. Lo que se borra es todo `select` que nombra `person_id` o el embed por
   `conversation_workspace_person_fkey` (tres: `CONVERSATION_SELECT`, `TASK_SELECT`, el bundle).
2. **La misma persona sin organización sigue dando 409** si ya es la principal de una viva del proyecto. Sin esta regla
   el alta abría una segunda conversación con la organización del dossier; antes la paraba la unicidad por persona.
3. `POST /api/conversations` devuelve `primary_person_id`: el alta en varios proyectos lo usaba de `conversation.person_id`.
4. El relleno no aborta por facturas con `payer_person_id` y sin organización: avisa con un NOTICE (las escribía
   `create_invoice_from_bolo` hasta hoy).
5. `staging.sql`, `playwright-difusion.sql` y `seed-season-local.sql` crean organización y contacto principal.

Orden en producción: primero el Worker (no necesita la migración: usa `contacts`, que existe desde la fase 1, y llama a
`create_invoice_from_bolo` sin `p_payer_person_id`, que la firma de 12 acepta), después el gate de § 34 completo para
la migración. Antes, revisar a mano los posibles duplicados de organización (punto 6 de las decisiones) y cuántas
conversaciones de producción quedarían sin organización (el relleno crea una con el nombre de la persona).

### Riesgos

| Riesgo | Cómo se cubre |
|---|---|
| Embeds por nombre de FK rotos en contract | Fase 2 cambia todos los embeds a la FK de organización y a contactos; la fase 4 solo va cuando `grep conversation_workspace_person_fkey` da cero |
| Correos asignados a la conversación equivocada por un contacto que se fue | Fechas del contacto en el emparejado; test RLS específico |
| La búsqueda `q` sobre dos embeds | Si no sale limpia con PostgREST, RPC de búsqueda; el E2E de alta lo cubre |
| Organizaciones duplicadas que se convierten en dos conversaciones | Hoy 1 par candidato; revisión a mano en fase 3 antes de la 4 |
| El código viejo escribe `person_id` mientras conviven | Trigger de doble escritura de la fase 1 hasta la 4 |
| Datos reales de `muk-cia` | Backfill en transacción con comprobaciones que abortan; `inspect` y backup antes de cada apply; los specs nunca escriben en `muk-cia` |

## 5. Lo que este plan no hace

- «Quién la lleva» (responsable), consentimiento y canal (LSSI), adjuntos por evento: salen del mismo repaso pero son
  columnas aparte; pueden ir en la migración de la fase 1 si Marco lo quiere, no lo he metido.
- El enlace organización-directorio (P2).

## 6. Preguntas para Marco (contestadas el 2026-10-11)

Respuestas en «Decidido», arriba, y en ADR-102 (añadido). P1, P2, P3, P6 y P7: la recomendada. P4: las fechas, más la
regla del hilo. P5: la organización (la opción 2), que añade la fase 2b. Se conserva el texto de las preguntas como
estaba.

**P1. ¿Puede haber conversación sin organización?**
1. **No: siempre hay organización, y si es un programador independiente se crea con su nombre** (recomendada). Una
   sola clave de unicidad, un solo título del panel, y la contraparte de la difusión es siempre quien programa. Hoy no
   hay ninguna real sin organización.
2. Sí: organización opcional y la conversación puede ser solo con una persona. Dos regímenes de unicidad y dos formas
   de pintar el panel para siempre.

**P2. ¿La organización se enlaza con el directorio de salas?**
1. **Ahora no; más adelante, una columna `directory_id` en la organización y «crear organización desde el directorio»**
   (recomendada). No bloquea la migración y el directorio aún no tiene programadores (ADR-101).
2. Ya en la fase 1, con el enlace de las 7 que coinciden por nombre exacto. Coincidencia por nombre no es identidad.

**P3. ¿Una conversación por organización y proyecto?**
1. **Sí, como hoy por persona** (recomendada). La relación con Pradillo para MaMeMi es una; las temporadas son bolos
   dentro de ella.
2. Una por organización y línea (campaña): cada temporada de difusión sería otra conversación y el historial con la
   sala se partiría.

**P4. Un contacto que deja la sala: ¿sus correos nuevos entran?**
1. **No: entra solo lo que cae entre `since` y `until`** (recomendada). Es lo que hace que «Inés deja Pradillo» no
   contamine la conversación.
2. Sí, mientras siga siendo contacto en alguna fila, sin mirar fechas. Más simple, y mezcla su trabajo nuevo con
   Pradillo.

**P5. ¿Quién es el pagador de una factura de un bolo?**
1. **Por ahora el contacto principal, como hoy con la persona** (recomendada). No cambia `invoice` ni la identidad
   fiscal y no hay ninguna factura con pagador.
2. La organización, con su identidad fiscal. Es lo correcto a la larga (se factura a la sala), pero pide modelo de
   identidad fiscal de organización: decisión de Books, aparte.

**P6. Las posibles organizaciones duplicadas de `muk-cia` (1 par por nombre, 6 dominios compartidos por 14 dossiers).**
1. **Las reviso contigo (o con Anouk) en la fase 3 con la herramienta de fusión, antes del contract** (recomendada). Un
   dominio compartido puede ser una red de salas distintas; solo una persona lo sabe.
2. Fusión automática por nombre normalizado en el backfill. Arriesga juntar dos salas distintas en una conversación
   real.

**P7. ¿El slug de la conversación pasa al de la organización?**
1. **Sí, con el viejo en `previous_slugs`** (recomendada). La URL nombra la contraparte y los enlaces viejos siguen
   resolviendo.
2. Se queda el de la persona en las existentes y solo las nuevas nacen con el de la organización. Dos convenciones.
