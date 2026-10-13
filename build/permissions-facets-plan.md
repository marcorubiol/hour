# Permisos al modelo de facetas: plan

> ADR-099 §8 (Marco, 2026-10-11): todo el sistema de permisos pasa al modelo nuevo, los paquetes escriben las facetas,
> en expand/contract con ensayo en staging, con una sola fuente de verdad. Decisiones de diseño: **ADR-100** (las seis
> recomendaciones de la primera versión de este plan, aceptadas por Marco). Canon: ADR-082, ADR-083, ADR-085,
> `build/structure-model.md § Facet`.
>
> Estado: **expand y fase 2 en producción** (2026-10-11, `20261011100000` y `20261011300000`). **Fase 3 escrita y
> probada en la Supabase local** (rama `claude/permissions-facets-f3`, § 8), sin aplicar en staging ni en producción.
> El contract no está escrito.

## 1. Qué cambia y qué no

Hoy el acceso vive en tres tablas: `workspace_membership` (rol del espacio: owner, admin, member, viewer, guest),
`project_membership` (roles por proyecto + grants + revokes) y `workspace_role` (cada rol es un paquete de cadenas como
`read:money`). Se lee por `has_permission(project, text)` y cinco ayudantes más, y además a pelo en 15 políticas y 13
RPC.

El modelo nuevo es el de ADR-082/085/100: **membresía por contenedor** (estar = ver el contenedor y su General),
**facetas** con `view | edit` por contenedor, escritas por **paquetes** y retocadas por override, con la tabla de
niveles y las propias facetas como filas.

## 2. El modelo nuevo (expand, `20261011100000_permissions_facets_expand.sql`)

| Objeto | Qué es |
|---|---|
| `container_level` | `workspace`, `project`, `line`, `bolo`, `performance` (ADR-100 §5). |
| `access_verb` | `view`, `edit`; `edit` implica `view`. Sin fila = res. |
| `facet` | Estándar de Hour (`workspace_id` NULL, nombre por clave i18n `facet.<key>`): converses, materials, tecnica, logistica, full_de_ruta, comidas, diners. Propias de un espacio (`workspace_id`, `label`, `labels` por idioma). La clave no cambia. |
| `facet_level` | Dónde existe cada faceta, como filas. Full de ruta y Comidas en bolo y función. |
| `workspace_facet_setting` | Un espacio renombra, desactiva u ordena una faceta (estándar o suya). |
| `access_preset`, `access_preset_facet` | Los cuatro paquetes de ADR-100 §6 (abajo). |
| `membership` | Una fila por persona con login y contenedor: `workspace_role` (solo espacio), `container_verb`, `can_edit_meta`, `can_manage_members`, `roles` (etiqueta), `preset`. |
| `membership_facet` | Faceta + verbo por membresía, `source` = `legacy`, `preset` u `override`. |

Paquetes (ADR-100 §6), expandidos sobre las facetas estándar que existen en el nivel de la membresía:

| Paquete | Contenedor | Facetas | Metadatos | Miembros |
|---|---|---|---|---|
| Mínim | view | ninguna | no | no |
| Equip | view | Materials, Tècnica, Logística, Full de ruta, Comidas: view | no | no |
| Coordinació | edit | todas edit, Diners view | sí | no |
| Direcció | edit | todas edit, Diners incluido | sí | sí (muere en la fase 3, ADR-100 §3) |

Reglas que la base hace cumplir: una faceta solo se concede donde existe y si es estándar o del mismo espacio
(trigger); `workspace_id` y la clave de una faceta son inmutables; una membresía viva por contenedor y persona; se ven
las membresías propias o todas las del espacio si lo administras; solo el admin configura las facetas de su espacio;
nadie escribe membresías por la API salvo la RPC de paquetes.

**`grant_container_preset(level, container, user, preset)`** da un paquete en una línea, un bolo o una función, con el
techo del delegante (faceta, verbo y nivel, ADR-085 §10, mirado por la cadena de contenedores). Proyecto y espacio
devuelven `0A000` hasta la fase 3: hoy esas filas las escribe el espejo y una fila `preset` ahí rompería la paridad.

## 3. Equivalencias exactas

El espejo calcula los permisos efectivos de cada membresía de proyecto exactamente como `has_permission_for_user`
(roles no archivados + grants − revokes) y los escribe con `source = legacy`, sin paquete.

| Hoy | Modelo nuevo |
|---|---|
| `workspace_membership` (rol, aceptación) | `membership` nivel workspace, `workspace_role`, `accepted_at` |
| owner/admin ven todo | `workspace_role in (owner, admin)` |
| `project_membership` existe | `membership` nivel project existe; su `accepted_at` es el del espacio |
| `read:performance` / `edit:performance` | `container_verb` view / edit (ADR-100 §1) |
| `read:money` / `edit:money` | Diners view / edit (proyecto o espacio) |
| `read:conversation` / `edit:conversation` | Converses view / edit |
| `edit:project_meta` | `can_edit_meta` |
| `edit:membership` | `can_manage_members` |
| `read:internal_notes`, `admin:project` | sin traducción: ningún lector; en la fase 2 los sigue contestando la copia congelada; mueren en el contract |
| `project_membership.roles` | `membership.roles` (etiqueta) |

La paridad (`private.access_parity_mismatches()`) compara, para cada persona y cada espacio o proyecto, el rol del
espacio, `can_access_project`, `can_read_workspace_money` y los ocho permisos vivos. Las dos migraciones abortan si da
una sola diferencia.

## 4. Fase 2 (`20261011300000_permissions_facets_reads.sql`)

1. Congela los lectores de hoy como `private.legacy_*` y redefine la paridad contra ellos (sigue comparando lo viejo con
   lo nuevo aunque los lectores públicos ya lean lo nuevo).
2. Cambia el cuerpo, no la firma ni los permisos, de `has_permission_for_user` (y con él `has_permission` y
   `accessible_project_ids`), `can_access_project`, `is_workspace_admin`, `is_workspace_member`,
   `is_workspace_internal_member`, `current_workspace_role` y `can_read_workspace_money`.
3. Reescribe las 15 políticas que leían `workspace_membership` a pelo (audit_log, invoice*, user_profile, venue,
   workspace, alias_request, workspace_organization, workspace_person, workspace_role) con ayudantes, y las 13 RPC
   que preguntaban permisos de espacio a pelo (`adopt_directory_venue`, `create_calendar_share`, `create_line`,
   `create_project`, `create_venue`, `delete_invoice`, `list_calendar_shares`, `request_workspace_alias`,
   `revoke_calendar_share`, `share_my_profile_with_workspace`, `update_project`, `update_workspace` y el hook del JWT).
   Mismo cuerpo; solo cambia la pregunta.

Queda leyendo las tablas viejas, a propósito, lo que **escribe** membresías o las lista por su id (fase 3):
`accept_workspace_invitation`, `create_workspace`, `handle_new_user`, `revoke_workspace_member`,
`update_workspace_member_role`, `list_workspace_access`, `create_workspace_invitation`,
`seed_system_roles_on_workspace`, `validate_project_membership_roles`, y el espejo.

Código de la app: ningún cambio. Pregunta `has_permission` por RPC en cinco sitios y la firma no cambia.

## 5. Orden

1. **Expand** (aditiva). Rollback `build/runbooks/rollback-20261011-permissions-facets-expand.sql`.
2. **Fase 2** (reescribe funciones SECURITY DEFINER: `inspect` + staging + plan + apply). Rollback
   `build/runbooks/rollback-20261011-permissions-facets-reads.sql`, que va antes que el del expand.
3. **Fase 3**: las escrituras pasan al modelo nuevo (invitaciones, cambio de rol, baja, alta de espacio y la RPC de
   paquetes en proyecto y espacio, con overrides); el techo del delegante sustituye a `can_manage_members`; el espejo
   se apaga; `list_workspace_access` devuelve ids de `membership`.
4. **Contract**: borrar `project_membership`, `workspace_role.permissions`, el espejo, `legacy_*`, la paridad,
   `has_permission_by_facets`, `access_parity_report`, las cadenas muertas; `container_verb` obligatorio (ADR-100 §2);
   decidir qué queda de `workspace_membership`.

Ensayo: `build/runbooks/permissions-facets-rehearsal.sql` mueve el modelo viejo por 23 caminos (alta, aceptación,
roles, grants, revokes, roles custom renombrados y borrados, guest, admin, baja, borrados en cascada), prueba los
paquetes en un bolo en 5 pasos más, y exige paridad cero tras cada uno. Corre igual con solo el expand y con la fase 2.

## 6. Riesgos

- **Dinero.** Hoy `edit:money` no implica `read:money`; en el modelo nuevo sí. Una membresía así ganaría lectura de
  dinero. La paridad lo detecta y las migraciones no se aplican; si producción lo tiene, se arregla antes.
- **Desactivar una faceta no quita acceso a datos.** Solo la quita de hilos e interfaz. Si se quisiera que desactivar
  Diners escondiera el dinero, haría falta otra decisión (y rompería la paridad).
- **Data API.** Siete tablas nuevas en `public`, RLS forzado; escritura solo en la configuración de facetas (admin).
  RPC nuevas: `grant_container_preset` (techo en servidor), `has_permission_by_facets` (solo lo tuyo),
  `access_parity_report` (solo `service_role`). Lo demás en `private`, sin exponer. `private.has_workspace_role` y
  `private.shares_workspace_with` tienen `EXECUTE` para `authenticated` porque las llaman políticas.
- **SECURITY DEFINER.** La fase 2 reescribe 20 funciones DEFINER. El cuerpo de las 13 RPC es el de hoy salvo la
  pregunta de permiso (diff mecánico, revisado línea a línea). El hook del JWT es INVOKER como `supabase_auth_admin`:
  se le da SELECT y una política sobre `membership`; el login de los fixtures lo prueba en cada test.
- **El espejo es ahora crítico.** Desde la fase 2, si un trigger del espejo falla, la escritura vieja falla con él (es
  el mismo statement); si se desactivara, el acceso dejaría de seguir a las tablas viejas. No tocar triggers en
  `workspace_membership`, `project_membership` ni `workspace_role` hasta la fase 3.
- **Membresías de bolo sin borrado.** `grant_container_preset` crea filas que nada borra todavía (la fase 3 trae
  revocar). El test RLS deja una para la fixture limitada; es idempotente.
- **Tests contra producción.** `permissions-facets.test.ts` falla allí mientras las migraciones no estén aplicadas.

## 7. Dudas cerradas (Marco, 2026-10-11)

1. Equip ve Comidas.
2. Comidas existe en el bolo y en cada función.
3. Las etiquetas de las facetas estándar valen como están (CA Àpats, ES Comidas, EN Meals, FR Repas; Diners es
   Dinero, Money, Argent).

## 8. Fase 3 (`20261013200000_permissions_facets_writes.sql`)

Las escrituras pasan al modelo nuevo. Desde aquí **la única tabla que se escribe para dar o quitar acceso es
`membership`** (con `membership_facet`); las tablas viejas dejan de ser fuente y pasan a ser una proyección.

### 8.1 Qué pasa con las tablas viejas: proyección inversa

Decisión: **`workspace_membership` y `project_membership` se siguen escribiendo, pero al revés**: un trigger en
`membership` y otro en `membership_facet` las recalculan desde el modelo nuevo (el espejo del expand iba de lo viejo a
lo nuevo; este va de lo nuevo a lo viejo). Por qué:

1. **Rollback sin pérdida de acceso.** Si la fase 3 se revierte, las tablas viejas ya dicen quién tiene qué, porque se
   escribieron en el mismo statement. Congelarlas obligaría al rollback a reconstruirlas con una lógica que solo se
   ejecuta el día que algo va mal.
2. **La paridad sigue siendo una prueba.** `access_parity_mismatches()` compara las copias congeladas de los lectores
   viejos con el modelo; con la proyección da cero por construcción, y el ensayo y la migración lo exigen. Si las
   tablas viejas se congelaran, la paridad se rompería con la primera invitación y dejaría de vigilar nada hasta el
   contract.
3. **`workspace_membership` sujeta cosas que no son acceso:** `mail_signature` (la firma personal por espacio) y la FK
   `project.owner_id`. Qué queda de ella lo decide el contract (§ 5).

Cómo se proyecta, exacto para los ocho permisos vivos:

| `membership` | `workspace_membership` |
|---|---|
| fila de espacio | misma pareja: `role` = `workspace_role`, `accepted_at`, `invited_by`. No toca `mail_signature`. |
| sin fila de espacio | se borra |

| `membership` de proyecto | `project_membership` |
|---|---|
| `roles` (etiqueta) | `roles`, igual |
| lo que da: `container_verb`, Diners, Converses, `can_edit_meta`, `can_manage_members` | `permission_grants` = esas cadenas (`edit` implica `read`) |
| lo que no da | `permission_revokes` = el resto de los ocho permisos vivos |
| sin fila | se borra |

Con `revokes` = los ocho menos lo concedido, el permiso efectivo viejo (roles + grants − revokes) es exactamente lo
concedido, **digan lo que digan los permisos de los roles**: editar `workspace_role.permissions` ya no cambia el acceso
de nadie (en el modelo nuevo el rol es etiqueta, ADR-082), y por eso el espejo de `workspace_role` se apaga sin
sustituto. `read:internal_notes` y `admin:project` no entran en los revokes: siguen saliendo de los roles, como hoy (no
los lee nadie y mueren en el contract; `update-workspace.test.ts` pregunta el primero).

Al aplicar, la migración proyecta todas las membresías de espacio y de proyecto una vez: cada fila de
`project_membership` queda en la forma canónica (mismos roles, permisos explícitos). El acceso no cambia (la paridad lo
exige antes de terminar) y es lo que hace que la proyección se pruebe contra los datos reales de producción en el apply.

Las tablas viejas se cierran a la API: `authenticated` y `anon` pierden INSERT, UPDATE y DELETE sobre
`project_membership` (`workspace_membership` ya no los tenía). Una escritura directa ya no cambiaría el acceso y
rompería la paridad.

### 8.2 El espejo se apaga

Se borran los tres triggers del expand (`*_mirror_access` en `workspace_membership`, `project_membership` y
`workspace_role`). Las funciones `private.sync_*` y `private.mirror_*` se quedan, sin trigger, para el rollback; las
borra el contract. `project_membership_validate_roles` también se quita de `project_membership` (es una proyección: un
rol archivado después bloquearía la proyección) y su papel pasa a `membership` (§ 8.3).

### 8.3 RPC y triggers que cambian

| Objeto | Antes | Fase 3 |
|---|---|---|
| `handle_new_user`, `create_workspace` | insertan `workspace_membership` owner | insertan `membership` de espacio owner; la proyección crea la fila vieja |
| `seed_system_roles_on_workspace` | siembra los 16 roles con permisos | **sin cambios.** Las etiquetas siguen haciendo falta (las validan `membership.roles` y las invitaciones) y los permisos se quedan para que el rollback sea exacto; el contract vacía la columna |
| `validate_project_membership_roles` (trigger en `project_membership`) | valida los códigos | se quita de ahí; `private.validate_membership_roles` valida en `membership` las etiquetas **nuevas** de una fila (un rol archivado después no bloquea) |
| `create_workspace_invitation` | 6 parámetros | + `p_project_preset` (por defecto `minim`, ADR-085 §11). Nueva columna `workspace_invitation.project_preset`. La firma vieja se borra para que PostgREST no vea dos (el Worker desplegado llama con 6 argumentos con nombre y sigue funcionando) |
| `accept_workspace_invitation` | upsert en `workspace_membership` y `project_membership` (une roles) | upsert de la fila de espacio en `membership`; si había membresías pendientes debajo, heredan la aceptación; con proyecto: si no es miembro, crea la membresía con la etiqueta y expande el paquete de la invitación; si ya lo es, solo añade la etiqueta (una invitación no rebaja ni sube a nadie) |
| `list_workspace_access` | ids de `workspace_membership` | ids de `membership` (fila de espacio). Misma firma |
| `update_workspace_member_role`, `revoke_workspace_member` | por id de `workspace_membership` | por id de `membership` de espacio; mismas reglas (admin, el owner aparte, el último owner no se va). La baja borra todas las membresías de la persona en el espacio, de cualquier nivel |
| `grant_container_preset` | línea, bolo, función | **todos los niveles**. Proyecto como los de abajo. Espacio: § 8.5. Si la membresía ya existe, hay que poder gestionarla (abajo) |
| `private.can_grant_preset` | techo con `can_manage_members` | el techo ya no mira `can_manage_members` (ADR-100 §3): Direcció = Coordinació + Diners edit, y eso lo decide el techo de facetas |
| nueva `set_membership_facet(membership, facet, verb)` | | override de una faceta en una membresía (`verb` NULL la quita), `source = override`. Techo: das la faceta a ese verbo solo si la tienes; tocar la membresía exige poder gestionarla. No en el espacio (§ 8.5) |
| nueva `revoke_membership(membership)` | | quita una membresía de proyecto, línea, bolo o función (la de espacio es `revoke_workspace_member`). Puede quien la gestiona. Lo que cuelga debajo no se toca: una membresía de bolo existe sin la de proyecto |
| `can_manage_members` | gateaba `project_membership` por API y el techo | no gatea nada. La columna se sigue escribiendo (la paridad de `edit:membership` la lee) hasta el contract |

**Quién gestiona una membresía ajena** (`private.can_manage_membership`): el admin del espacio, o quien podría haberla
dado: su `container_verb`, sus metadatos y cada una de sus facetas caben en el techo de quien llama en ese contenedor.
Es la regla del techo (ADR-085 §10) aplicada también a quitar: una road manager con Equip puede dar y quitar Mínim o
Equip, no tocar a quien tiene Coordinació. Provisional (§ 8.6, punto 2).

### 8.4 Qué hace la app distinto

- `WorkspacesSection.svelte`: la invitación a un proyecto elige **paquete** (Mínim por defecto) además de la etiqueta
  de rol; las etiquetas dejan de prometer acceso («lectura de la producción»), que ahora da el paquete.
- `POST /api/workspaces/[id]/access` acepta `project_preset` y lo pasa a la RPC.
- Listar, cambiar rol y dar de baja: sin cambios de código (el id que viaja ya es el de `membership`).
- `db-types.ts` regenerado.

### 8.5 El paquete en el espacio

ADR-100 §4 solo fija que Direcció en el espacio equivale a admin. Provisional (§ 8.6, punto 1):
`grant_container_preset('workspace', …)` traduce el paquete al rol del espacio: Direcció = admin; cualquier otro quita
admin (admin pasa a member) y deja como está a member, viewer o guest. Solo lo hace un admin (el techo lo garantiza), al
owner no se le toca, y **no escribe facetas de espacio**: Converses y Diners en el espacio darían esas facetas en todos
los proyectos (`model_has_facet` une hacia abajo), algo que ningún ADR ha decidido para un member y que el modelo viejo
no puede proyectar. `set_membership_facet` rechaza el nivel espacio por lo mismo.

### 8.6 Pendiente de Marco (elegida la primera, provisional)

1. **Qué es un paquete en el espacio.**
   - a) **(implementada)** Solo Direcció tiene traducción (admin, ADR-100 §4); el resto quita admin y no da facetas de
     espacio. Es lo único decidido y no inventa un significado para «Diners en todo el espacio».
   - b) Los cuatro con traducción propia: Direcció admin, Coordinació member con Converses y Diners de espacio, Equip
     member, Mínim viewer.
   - c) Sin paquetes en el espacio: el rol del espacio es su única dimensión y `grant_container_preset` empieza en el
     proyecto.
2. **Quién quita o rebaja una membresía ajena** (ADR-085, Abierto 1: «revocar no tiene pantalla»).
   - a) **(implementada)** Quien podría haberla dado (techo simétrico) o el admin. Una regla para dar y quitar.
   - b) Solo el admin del espacio.
   - c) Quien la dio (`invited_by`) o el admin.
3. **Invitación a proyecto: rol o paquete.**
   - a) **(implementada)** La invitación lleva paquete (por defecto Mínim, ADR-085 §11) y el rol queda como etiqueta.
     Las invitaciones pendientes de antes de la fase 3 no tienen paquete: al aceptarse dan Mínim, aunque su rol
     prometiera más (un director invitado antes recibe solo ver el contenedor).
   - b) Traducir rol a paquete con una tabla fija (intérprete y lector Equip; dirección, producción y distribución
     Coordinació).
   - c) Seguir dando lo que dicen los permisos del rol, como el espejo; aplaza la decisión, pero mantiene vivo
     `workspace_role.permissions`, que el contract quiere borrar.

### 8.7 Riesgos

- **Reescribe datos de `project_membership`** al aplicar (forma canónica, § 8.1) y escribe una fila de `audit_log` por
  fila cambiada. Clase destructiva para `_tasks.md § 34`: `inspect` + staging + plan + apply. El acceso no cambia: la
  migración aborta si la paridad no es cero después.
- **Firma de `create_workspace_invitation`.** Se borra la de 6 parámetros y se crea la de 7 con defecto. Entre el apply
  y el deploy el Worker viejo sigue llamando con nombres y funciona.
- **Ids de membresía.** `list_workspace_access` devuelve otros ids. Un cliente con la lista cacheada de antes del
  apply recibiría `membership not found` al cambiar un rol; recargar lo arregla.
- **Editar `workspace_role.permissions` deja de cambiar accesos.** Es lo que pide el modelo, pero hoy es un efecto
  visible para quien lo hiciera por la API (la app no lo hace).
- **Tests que escribían `project_membership` por la API** (siete ficheros RLS) pasan a `set_membership_facet` y
  `grant_container_preset` con un ayudante común; contra producción fallan hasta que la fase 3 esté aplicada.

### 8.8 Rollback

`build/runbooks/rollback-20261013-permissions-facets-writes.sql`, antes que los de la fase 2 y el expand. Vuelve a los
cuerpos de la fase 2, borra las RPC y triggers nuevos, restaura los triggers del espejo y de validación y los grants de
`project_membership`, y deja `membership` como la habría dejado el espejo: las filas de faceta de proyecto pasan a
`source = legacy`, `preset` de proyecto a NULL, y se resincroniza todo desde las tablas viejas (que ya estaban al día).
Acaba exigiendo paridad cero. **Se pierde**: las facetas de proyecto que el modelo viejo no expresa (Materials y Tècnica
dadas por paquete u override), el nombre del paquete de las membresías de proyecto y `project_preset` de las
invitaciones pendientes. Las membresías de línea, bolo y función se quedan como estaban.
