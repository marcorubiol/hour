# Permisos al modelo de facetas: plan

> ADR-099 §8 (Marco, 2026-10-11): todo el sistema de permisos pasa al modelo nuevo, los paquetes escriben las facetas,
> en expand/contract con ensayo en staging, con una sola fuente de verdad. Decisiones de diseño: **ADR-100** (las seis
> recomendaciones de la primera versión de este plan, aceptadas por Marco). Canon: ADR-082, ADR-083, ADR-085,
> `build/structure-model.md § Facet`.
>
> Estado: **expand y fase 2 escritas y probadas en la Supabase local**, sin aplicar en producción ni en staging. Rama
> `claude/permissions-facets`. La fase 3 y el contract no están escritos.

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
