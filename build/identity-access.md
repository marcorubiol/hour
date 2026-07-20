# Identidad portátil, dossiers privados y acceso

> Estado: **MODELO APLICADO; HITOS POSTERIORES PENDIENTES — 2026-07-20**
> Fecha: 2026-07-20
> Motivo: conservar una identidad personal que atraviesa compañías sin convertir
> las fichas, conversaciones o notas de esas compañías en datos globales.

## Decisión aplicada

Mantener la identidad portátil. No mantener una ficha de contacto global compartida.

### Implementación aterrizada el 2026-07-20

- Migración reproducible: `supabase/migrations/20260720105800_workspace_identity_and_organizations.sql`.
- `workspace_person` y `workspace_organization`, RLS forzada, grants explícitos,
  backfill y claves compuestas `(workspace_id, person_id)` en todas las relaciones.
- La escritura directa de dossiers/organizaciones por PostgREST queda cerrada hasta
  definir la matriz RBAC; los flujos actuales escriben solo mediante RPCs validados.
- Perfil portátil ampliado y RPCs explícitos `share_my_profile_with_workspace` /
  `stop_sharing_my_profile_with_workspace`; revocar detiene la sincronización y
  conserva la copia local.
- `create_conversation` deduplica email solo dentro del workspace. Un alta de
  contacto jamás enlaza silenciosamente dos compañías; el enlace cross-workspace
  requiere usuario autenticado, email verificado y la acción explícita de compartir.
- Las APIs de personas, conversaciones, equipo, disponibilidad, facturas, tareas y
  road sheets ya leen el dossier local. `person` queda accesible al rol autenticado
  solo por su `id` opaco.
- Quedan para un milestone posterior: invitación transaccional, registro de claims y
  merges reversibles, procedencia por campo y UI de selección de campos compartidos.
- El directorio `supabase/migrations/` ya contiene el checkpoint defensivo, los tres
  hotfixes y la migración de identidad en el mismo orden/versiones del historial remoto.
  El checkpoint aborta sobre una base vacía o equivocada; todavía falta sustituirlo
  por un baseline reconstructivo real antes de crear producción desde cero.

Hoy `person` representa a la vez tres verdades distintas:

1. quién es el ser humano;
2. qué datos personales controla y comparte ese ser humano;
3. qué sabe cada compañía sobre él.

La solución recomendada es separar esas tres categorías. La identidad global será
mínima y opaca; el usuario tendrá un perfil portátil propio; cada workspace tendrá
su dossier privado. Compartir identidad no compartirá automáticamente información.

## Invariantes

- Una misma cuenta puede pertenecer a varias compañías y tener roles distintos en
  cada workspace y proyecto.
- La identidad nunca concede acceso. Una `workspace_membership` aceptada y vigente
  es siempre el perímetro exterior; los permisos de proyecto solo especializan el
  acceso dentro de ese perímetro.
- Una compañía no puede leer ni modificar el dossier, las notas, las conversaciones,
  los campos propios ni las relaciones de otra compañía.
- Coincidir por email no prueba identidad. La unión entre un usuario y una persona
  requiere email verificado más invitación o claim explícito y auditable.
- El usuario puede ver su propia participación transversal, pero una compañía solo
  ve lo que sucede dentro de su workspace. Un conflicto externo puede proyectarse
  como «no disponible» sin revelar cliente, espectáculo, lugar ni motivo.
- Los datos de IA conservan procedencia, propietario, momento de observación,
  confianza y visibilidad; una inferencia no sustituye silenciosamente un dato
  confirmado.

## Modelo objetivo

| Capa | Propiedad | Contenido |
|---|---|---|
| `auth.users` | Plataforma | Login, email verificado y sesión. No es una libreta de contactos. |
| `person` | Plataforma | Identificador opaco, estado y merges reversibles. Sin PII aportado por compañías. |
| `user_profile` | La persona | Nombre, avatar, locale y campos portátiles que ella controla. `person_id` y los privilegios de plataforma no son editables directamente. |
| `workspace_person` | Workspace | Nombre usado localmente, emails/teléfonos, cargo, fuente, procedencia por campo y `custom_fields`. Una fila por `(workspace_id, person_id)`. |
| `person_profile_share` | La persona | Consentimiento por workspace y por campo, revocable y fechado. |
| `workspace_invitation` | Workspace | Invitación previa al alta, rol exterior y concesiones iniciales; token con caducidad. |
| `person_claim` | Plataforma | Evidencia auditada que enlaza `user_id` y `person_id`. |

`user_profile.person_id` continúa siendo el puente entre cuenta e identidad, pero se
establece solo mediante un RPC verificado. Un usuario autenticado no puede escribirlo
por PostgREST, igual que no puede autoconcederse `is_platform_admin`.

### Organizaciones

Añadir `workspace_organization` como entidad separada de persona y venue. Un teatro,
festival o distribuidora no es una persona ni necesariamente un lugar físico. La
relación contacto-organización, sus notas y el historial siguen siendo privados del
workspace. Si algún día existe un directorio público verificado, será otra capa; no
debe nacer mezclado con los dossiers internos.

### Conversaciones

`conversation`, sus notas y un futuro `conversation_event` pertenecen al workspace.
Apuntan al contacto local, no a una ficha global compartida. El email entrante,
saliente, una llamada o un evento de WhatsApp usan el mismo contrato de evento con
`source`, `direction`, participantes, timestamps, procedencia y enlace al original.

## Acceso y roles: cuatro ejes, no uno

| Eje | Responde a | Ejemplo |
|---|---|---|
| Identidad (`user_id` / `person_id`) | ¿Quién es? | La misma persona en Hour. |
| `workspace_membership` | ¿Puede entrar aquí? | Admin en compañía A; miembro en B. |
| `project_membership` | ¿Qué puede hacer en este proyecto? | Regiduría en A1; técnico en A2. |
| Asignación operativa | ¿Qué trabajo realiza? | Reparto en una producción; crew en un bolo. |

`cast_member` y `crew_assignment` describen realidad operativa, no deben conceder por
sí solos acceso. Para cada superficie habrá una matriz explícita de lectura y escritura:
Planner, Conversations, Money, People, Tasks, disponibilidad y road sheets. Los roles
de workspace pueden dar defaults; grants y revokes de proyecto ajustan esos defaults.

## Flujos

### Contacto sin cuenta

La compañía crea un `workspace_person`. La búsqueda de coincidencias ocurre solo en
su workspace. Es preferible tolerar identidades opacas duplicadas temporalmente a
fusionar personas por un email compartido, reciclado o mal importado.

### Primera invitación

1. La compañía invita desde su ficha local.
2. El destinatario entra o crea cuenta y verifica el mismo email.
3. Hour muestra compañía, rol, permisos y campos portátiles que se compartirán.
4. Una transacción acepta la membership, registra el claim y vincula la ficha local.
5. Los valores locales y los compartidos permanecen diferenciados y con procedencia.

### Segunda compañía

Se repite el mismo flujo y se enlaza la segunda ficha al mismo `person.id`. El usuario
ve ambas participaciones; cada compañía conserva exclusivamente su dossier y actividad.

### Revocación

- Revocar `workspace_membership` corta acceso aunque el JWT siga vivo y fuerza el
  cierre o la reautorización de sockets colaborativos que ya estaban abiertos.
- Revocar un share deja de proyectar los campos portátiles, pero no borra en silencio
  el dato local que la compañía deba conservar. La UI distingue dato local de dato
  compartido/verificado.
- Un merge de identidad es transaccional, auditado, reversible y nunca mezcla PII de
  dos workspaces.

## Camino de implementación

### 0. Hotfix previo a cualquier beta

- Aplicar y probar `2026-07-20_lock_user_profile_privileged_columns.sql`.
- Aplicar y probar `2026-07-20_reinforce_workspace_membership_envelope.sql`.
- Aplicar y probar `2026-07-20_lock_account_ownership.sql`.
- Probar con owner, admin, miembro limitado y usuario externo; incluir revocación con un JWT
  emitido antes de la revocación.

### 1. Entornos y fixtures

- Crear un Supabase de staging reproducible desde migraciones.
- Mantener tres identidades sintéticas: owner, invitado/performer y externo sin acceso.
- Ejecutar RLS y E2E contra staging, no contra los datos de trabajo.

### 2. Migración aditiva

1. Crear `workspace_person`, `workspace_organization`, shares, invitaciones y claims.
2. Generar un dossier por cada par real `(workspace_id, person_id)` encontrado en
   conversaciones, reparto, crew, sustituciones, notas, disponibilidad y facturas.
3. Copiar deliberadamente los actuales campos globales a cada dossier local; no
   elegir una compañía como verdad universal.
4. Reescribir `create_conversation` para resolver contactos solo dentro del workspace.
5. Cambiar endpoints y pantallas para leer el dossier del workspace indicado por URL.
6. Vaciar finalmente la PII de `person` y retirar su UPDATE directo.

### 3. Corte limpio recomendado

Como los datos actuales son principalmente demo, el corte más seguro no es borrar a
ciegas el proyecto vivo. Primero se guarda un snapshot cifrado; el proyecto actual se
convierte en staging/demo y se crea una producción limpia desde el baseline ya probado.
Solo se reimportan los pocos datos reales que Marco decida conservar. Esto valida a la
vez que la base completa puede reconstruirse sin depender de SQL manual histórico.

## Pruebas de aceptación obligatorias

- El mismo email puede tener teléfonos distintos en dos workspaces sin lectura ni
  modificación cruzada.
- Un cambio en A no cambia B.
- Un UUID conocido de otro tenant devuelve cero filas y no revela su existencia.
- Un invitado ve su participación en A y B, no sus libretas, notas ni conversaciones.
- Un miembro raso no puede cambiarse su rol, `person_id` ni privilegios de plataforma.
- Invitación y claim solo enlazan tras verificación y consentimiento.
- Un buzón compartido no se auto-reclama como persona.
- Revocar membership funciona con JWT vivo; revocar un share deja de proyectar campos.
- Un merge erróneo puede revertirse conservando auditoría y procedencia.

## Decisiones adoptadas para el primer milestone

1. El contrato permite elegir campos; `full_name` es obligatorio. La UI de aceptación
   deberá mostrar la selección antes de invocar el RPC.
2. Revocar conserva el dato local y detiene futuras sincronizaciones.
3. Un conflicto cross-workspace mostrará solo disponibilidad, nunca el otro trabajo;
   esa proyección todavía no forma parte de esta migración.
