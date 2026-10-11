# Permisos al modelo de facetas: plan

> ADR-099 §8 (Marco, 2026-10-11): todo el sistema de permisos pasa al modelo nuevo, los paquetes escriben las facetas,
> en expand/contract con ensayo en staging, con una sola fuente de verdad. Canon: ADR-082, ADR-083, ADR-085 (y sus
> enmiendas del 2026-07-20), `build/structure-model.md § Facet`. Material de julio: rama `feat/comms-threads`
> (migración sin aplicar y review de 32 hallazgos).
>
> Estado: **fase expand escrita y probada en la Supabase local**, sin aplicar en producción. Rama
> `claude/permissions-facets`. Lo que necesita decisión de Marco está en § 8.

## 1. Qué cambia y qué no

Hoy el acceso vive en tres tablas: `workspace_membership` (rol del espacio: owner, admin, member, viewer, guest),
`project_membership` (roles por proyecto + grants + revokes) y `workspace_role` (cada rol es un paquete de cadenas como
`read:money`). Se lee por `has_permission(project, text)` y por cinco ayudantes más.

El modelo nuevo es el de ADR-082/085: **membresía por contenedor** (estar = ver el contenedor y su General) y **facetas**
con `view | edit` por contenedor, escritas por **paquetes** (Mínim, Equip, Coordinació, Direcció) y retocadas por
override, con la tabla de niveles como filas.

La migración no es «cambiar `has_permission`»: es mover **91 políticas** (53 con `has_permission`, el resto leyendo
`workspace_membership` directamente o por ayudante) en 34 tablas, y **77 funciones** (RPC y ayudantes) que leen
alguna de las tres tablas. Por eso va en cuatro fases y la primera no cambia ninguna lectura.

## 2. El modelo nuevo

| Objeto | Qué es |
|---|---|
| `container_level` | `workspace`, `project`, `line`, `bolo`. El cuarto es el bolo (ADR-099 §6); ver § 8.5. |
| `access_verb` | `view`, `edit`. `edit` implica `view` (ADR-082 §4). Sin fila = res. |
| `facet` | Las seis: converses, materials, tecnica, logistica, full_de_ruta, diners. Datos, no enum. |
| `facet_level` | La tabla de la enmienda, 16 filas. Mover una faceta de nivel es una fila. |
| `access_preset` | Los cuatro nombres. El contenido no está decidido (§ 3). |
| `membership` | Una fila por persona con login y contenedor. Lleva lo que **no es faceta** (abajo). |
| `membership_facet` | Faceta + verbo por membresía, con `source` = `legacy`, `preset` u `override`. |

Lo que no es faceta y vive en `membership`:

- `workspace_role` (solo nivel espacio): el owner..guest de hoy. owner/admin lo ven todo, como hoy.
- `container_verb`: el acceso al propio contenedor, es decir, a lo que hoy gatea `read/edit:performance` (funciones,
  fechas, líneas, reparto, equipo, horarios, viajes, materiales, enlaces de hoja de ruta). Ver § 8.1.
- `can_edit_meta` (= `edit:project_meta`) y `can_manage_members` (= `edit:membership`). Ver § 8.3.
- `roles`: los códigos de rol como **etiqueta** (ADR-082: el rol es lo que haces, no lo que puedes).

Reglas que la base hace cumplir:

- Una faceta solo se concede donde existe: trigger `guard_membership_facet_level` (cierra el hallazgo abierto «nada
  obliga la tabla faceta x nivel en escritura»). La lectura también cruza con `facet_level`.
- Se ven las membresías propias, o todas las del espacio si eres owner/admin (el patrón de
  `workspace_membership_select`; cierra el hallazgo «`membership_select` publica la matriz entera»).
- Nadie escribe por la API en el expand. `workspace_id` inmutable (`guard_immutable_workspace_id`).
- Unicidad por (contenedor, usuario) y nivel: no caben dos membresías vivas de la misma persona en un contenedor.

Fuera a propósito del expand (ADR-099 §7, sin invitados en el primer corte): `person_id`, `ends_at`, `revoked_at`, el
enlace firmado. Llegan con el invitado; las columnas son aditivas.

## 3. Paquetes (propuesta, decide Marco)

Ningún documento fija qué lleva cada paquete; solo los nombres y que el default de una invitación es Mínim. Propuesta,
para que la RPC de paquetes tenga algo que expandir:

| Paquete | Contenedor | Converses | Materials | Tècnica | Logística | Full de ruta | Diners | Miembros, metadatos |
|---|---|---|---|---|---|---|---|---|
| Mínim | view | | | | | | | |
| Equip | view | | view | view | view | view | | |
| Coordinació | edit | edit | edit | edit | edit | edit | view | metadatos |
| Direcció | edit | edit | edit | edit | edit | edit | edit | los dos |

Cada celda se escribe solo donde la faceta existe en el nivel de la membresía. Equivalencia aproximada con los roles de
hoy: viewer y los oficios de diseño o intérprete se parecen a Equip; producer, production_manager y tour_manager a
Coordinació con Diners edit; owner/admin a Direcció en el espacio. **No es exacta**, por eso el relleno no usa paquetes
(§ 4).

## 4. Equivalencias exactas

El relleno no traduce roles a paquetes: calcula, para cada membresía de proyecto, los permisos efectivos exactamente
como `has_permission_for_user` (unión de los roles no archivados + grants − revokes) y escribe el resultado con
`source = legacy` y `preset = NULL`. Así no se aplana nada (cierra el hallazgo «el backfill aplana roles a
equip/direccio») y el contract puede asignar paquetes con criterio, no con un `CASE`.

| Hoy | Modelo nuevo | Lectores de hoy |
|---|---|---|
| `workspace_membership` (rol, aceptación) | `membership` nivel workspace, `workspace_role`, `accepted_at` | `is_workspace_member`, `is_workspace_internal_member`, `is_workspace_admin`, `current_workspace_role`, ~35 políticas y RPC directas |
| owner/admin ven todo | `workspace_role in (owner, admin)` | el bypass dentro de `has_permission_for_user` y `can_access_project` |
| `project_membership` existe | `membership` nivel project existe | `can_access_project` (`project_select`) |
| aceptación del espacio | `membership.accepted_at` de la fila de proyecto = la del espacio | la join con `workspace_membership` en `has_permission_for_user` |
| `read:performance` | `container_verb is not null` | 9 políticas (performance, date, line, cast, crew, asset, schedule_slot, travel_stage...) |
| `edit:performance` | `container_verb = edit` (y por tanto view, como hoy) | 18 políticas, 19 RPC, `can_user_write_collab` |
| `read:money` | `diners` view (proyecto o espacio) | bolo, invoice*, payment, expense; `can_read_workspace_money`; `accessible_project_ids` en `list_money_bolos`, `list_expenses_for_scope`, `list_performance_bolo_links` |
| `edit:money` | `diners` edit | 12 políticas, 13 RPC (create/delete/issue/update de bolo, factura, pago, gasto; `list_money_payers`) |
| `read:conversation` | `converses` view | `conversation_select` (y por ella `conversation_event`) |
| `edit:conversation` | `converses` edit | 2 políticas, `create_conversation`, `delete_conversation`, `record_conversation_event` |
| `edit:project_meta` | `can_edit_meta` | `project_update`, `line_*`, `can_edit_project`, `can_user_write_collab`, `NotesModule` |
| `edit:membership` | `can_manage_members` | 4 políticas de `project_membership` |
| `read:internal_notes` | nada | ningún lector desde `20260827100000`; muere en el contract |
| `admin:project` | nada | ningún lector; muere en el contract |
| `project_membership.roles` | `membership.roles` (etiqueta) | `validate_project_membership_roles`, invitaciones |
| `workspace_role.permissions` | contenido de paquete (fase 3) | `has_permission_for_user`, `seed_system_roles_on_workspace` |

Lo comprueba `private.access_parity_mismatches()`: para cada persona y cada espacio o proyecto donde aparece, pregunta
a los lectores reales de hoy (suplantando `auth.uid()`) y a los del modelo nuevo, en los ocho permisos vivos y en
`can_access_project`, `is_workspace_member/internal_member/admin`, el rol del espacio y
`can_read_workspace_money`.

Nota: el encargo citaba `list_money_performances` y `update_performance_fee`; ya no existen. Money v3 los sustituyó por
`list_money_bolos` y `update_bolo_fee`, que sí están en la tabla.

## 5. Todo lo que lee permisos hoy, y cómo pasa cada cosa

**Ayudantes (6 + 2).** `has_permission_for_user` (y su envoltorio `has_permission`), `can_access_project`,
`is_workspace_admin`, `is_workspace_member`, `is_workspace_internal_member`, `current_workspace_role`;
`can_read_workspace_money` y `accessible_project_ids` se apoyan en `has_permission`. **Pasan cambiando el cuerpo**, sin
tocar firma: la fase 2 sustituye cada cuerpo por su gemelo `private.model_*`, que ya existe y ya está probado igual.
Con eso pasan de golpe las 53 políticas con `has_permission`, las que usan los ayudantes y las RPC que los llaman.

**Lectores directos de `workspace_membership`** (~15 políticas: invoice*, workspace, workspace_person,
workspace_organization, workspace_role, user_profile, audit_log, venue_delete, alias_request; y ~25 funciones:
`create_project`, `create_line`, `update_project`, `update_workspace`, calendario, invitaciones, `handle_new_user`,
`custom_access_token_hook`...). Se reescriben uno a uno para leer un ayudante, nunca la tabla nueva a pelo. Es el
trabajo largo de la fase 2 y se puede partir por tablas.

**Escritores** (fase 3, no 2): `accept_workspace_invitation`, `create_workspace_invitation`,
`update_workspace_member_role`, `revoke_workspace_member`, `handle_new_user`, `create_workspace`,
`seed_system_roles_on_workspace`, `validate_project_membership_roles`, y las escrituras REST a `project_membership`
(solo las hacen los tests; la app no tiene pantalla de grants).

**JWT.** `custom_access_token_hook` mete el espacio y el rol en el token. Pasa en la fase 2, con el rol leído de
`membership`. El token sigue sin decidir permisos (las políticas leen la base, no el claim).

**Código de la app.** No lee las tablas; pregunta `has_permission` por RPC en cinco sitios
(`lib/do/auth.ts` para el doc colaborativo, `NotesModule.svelte`, `api/schedule/[target]/[id]`,
`api/dates/[id]/stages`, `api/money/access`) y `apps/collab` va por `can_user_write_collab`. Como la fase 2 conserva
`has_permission`, **ningún cambio de código hasta el contract**, donde las cadenas `edit:performance` y compañía
pueden quedarse como alias o pasar a `has_facet`. Los ~40 comentarios que citan las cadenas se actualizan entonces.

## 6. Orden

1. **Expand (esta rama).** `20261011100000_permissions_facets_expand.sql`: tablas, lectores `private.model_*`, espejo
   por triggers (viejo → nuevo), relleno y autocomprobación. Rollback:
   `build/runbooks/rollback-20261011-permissions-facets-expand.sql`. Aditiva según § 34: reconstrucción local, tipos,
   RLS. **La migración aborta si hay una sola diferencia de paridad**: protege contra el estado que solo tiene
   producción, que staging no ve (§ 34). Después del apply, `test:rls` incluye la paridad global si hay
   `SUPABASE_SERVICE_ROLE_KEY`.
2. **Migrar lecturas.** (a) Cambiar el cuerpo de los 6 ayudantes por los `model_*` y `custom_access_token_hook`. Una
   migración, reversible en una (los cuerpos viejos van en su rollback). (b) Reescribir los lectores directos por
   tablas, en tandas. El espejo sigue vivo: las escrituras aún van a las tablas viejas. Gate: paridad cero, RLS
   completo, E2E tras deploy. Es una reescritura de funciones SECURITY DEFINER, así que es «destructiva» para § 34:
   `inspect` + staging.
3. **Mover las escrituras.** La RPC de paquetes (expande paquete → filas `source=preset`, overrides `source=override`,
   delegación acotada por el delegante en faceta, verbo y nivel, en el servidor: BLOQUEANTE 2), las invitaciones y el
   cambio de rol escriben `membership`. El espejo se invierte o se apaga, según lo que quede leyendo las viejas
   (nada, si la fase 2 se completó). Aquí entran también las membresías de línea y bolo y las facetas de nivel bajo.
4. **Contract.** Borrar `project_membership`, `workspace_role.permissions`, los triggers de espejo,
   `has_permission_by_facets`, `access_parity_report`, `private.access_parity_mismatches`, las cadenas muertas, y
   decidir qué queda de `workspace_membership` (§ 8.4). Destructiva: backup, `inspect`, staging, plan, apply.

## 7. Riesgos

- **Dinero.** Diners es la faceta sensible y la única en los cuatro niveles. Hoy `edit:money` NO implica
  `read:money`; en el modelo nuevo `edit` implica `view` (ADR-082 §4). Una membresía con `edit:money` sin
  `read:money` ganaría lectura de dinero. Con los roles de sistema no ocurre (todos los que editan dinero lo leen),
  pero un grant suelto o un rol custom podría. **La paridad lo detecta** (probado: aparece en `read:money` y en
  `can_read_workspace_money`) y la migración no se aplica. Si producción lo tiene, se arregla a mano antes del apply.
- **Miembro sin acceso al contenedor.** Un revoke de `read:performance` deja una membresía de proyecto que ve el
  proyecto pero no su producción. ADR-082 dice que General nunca puede ser `res` para un miembro. El expand lo
  representa (`container_verb = NULL`) para ser exacto; el contract decide (§ 8.2). Lo usa `limited-role.test.ts`.
- **Data API.** Cinco tablas nuevas en `public`, con RLS forzado y solo SELECT. Dos RPC nuevas: `has_permission_by_facets`
  (misma superficie que `has_permission`: solo contesta lo tuyo) y `access_parity_report` (solo `service_role`). Todo
  lo demás vive en `private`, que PostgREST no expone, con `EXECUTE` revocado a PUBLIC.
- **SECURITY DEFINER.** Los lectores y el espejo son DEFINER (escriben tablas sin GRANT de escritura). Todos con
  `search_path` fijo. El espejo comprueba que espacio, proyecto y usuario siguen existiendo antes de escribir, porque
  corre dentro de borrados en cascada (probado: usuario y proyecto borrados). El de paridad suplanta `auth.uid()` con
  `set_config(..., true)` y lo restaura; solo lo llaman la migración y `service_role`.
- **Coste por escritura.** Cada escritura en las tres tablas viejas recalcula la pareja tocada; cambiar el paquete de un
  rol recalcula a todos los que lo llevan en el espacio. Con 3-15 personas por compañía es despreciable; con muchas,
  pasar a triggers por sentencia.
- **Doble verdad mientras dure.** Del expand al final de la fase 3 hay dos representaciones. Las lecturas siguen en la
  vieja hasta la fase 2, y la paridad se comprueba en cada paso; no dejar el espejo vivo meses.
- **Tests contra producción.** `test:rls` corre contra producción. `permissions-facets.test.ts` falla allí mientras la
  migración no esté aplicada: aplicar antes de correr la suite, o correrla sin ese fichero.

## 8. Lo que tiene que decidir Marco

1. **`read/edit:performance` no cabe en las facetas.** Es el acceso a toda la producción de un proyecto, y la tabla de
   niveles no deja conceder Logística ni Full de ruta en el proyecto. Con facetas solas, hoy no se puede expresar «ve
   todas las funciones de la obra». Opciones: (a) **recomendada**: es el acceso al contenedor (`container_verb`), que
   es lo que ADR-082 dice que da la membresía; las facetas Tècnica, Logística y Full de ruta gatean después los
   campos y los hilos que les toquen. (b) Una séptima faceta («Planificació») en todos los niveles: cuesta su política
   y contradice que Producció se cayó por ser el contenedor. (c) Bajar el acceso de producción a línea y bolo:
   rompe la paridad y obliga a membresías por bolo.
2. **Miembro sin acceso al contenedor** (§ 7). (a) **Recomendada**: en el contract deja de existir; ser miembro es ver,
   y quien no debe ver no es miembro. (b) Mantener `container_verb` nullable para siempre.
3. **`edit:membership` frente a ADR-085 §12** (invitar deja de ser capacidad; manda el techo del delegante).
   (a) **Recomendada**: en la fase 3 lo sustituye la regla del techo y `can_manage_members` muere. (b) Mantenerla como
   capacidad de Direcció.
4. **El rol del espacio (owner, admin, member, viewer, guest) frente a los paquetes.** Gatea mucho más que facetas
   (crear proyectos, directorio, tareas, sedes). (a) **Recomendada**: se queda como dimensión propia del nivel espacio,
   y Direcció en el espacio equivale a admin. (b) Fundirlo en paquetes de espacio.
5. **Bolo o función como cuarto nivel.** La enmienda y `structure-model.md` dicen «performance» (o «bolo» en el sentido
   de antes de ADR-087); ADR-099 §6 cuelga el tablón del bolo. El expand usa `bolo`. Full de ruta es por función como
   documento: si se quiere su faceta en la función, es una fila de `facet_level` y un valor del enum. Hay que corregir
   `structure-model.md` en cualquier caso.
6. **Contenido de los paquetes** (§ 3). Hace falta antes de la fase 3.
