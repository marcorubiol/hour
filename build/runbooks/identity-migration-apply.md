# Apply de seguridad, identidad y organizaciones

> Estado 2026-07-20: **EJECUTADO** en `hour-phase0`. Snapshot privado
> `hour_backup_20260720`; dry-run y apply completados; RLS 108 pass / 1 skip.
> Pendiente: tipos generados, asesores y segundo usuario de fixture.

## Alcance y orden

Aplicar exclusivamente al proyecto enlazado `hour-phase0` (`lqlyorlccnniybezugme`),
en este orden:

1. `20260720105713_remote_schema_checkpoint.sql`
2. `20260720105719_lock_user_profile_privileged_columns.sql`
3. `20260720105735_reinforce_workspace_membership_envelope.sql`
4. `20260720105746_lock_account_ownership.sql`
5. `20260720105800_workspace_identity_and_organizations.sql`

El primer fichero no es aún un baseline reconstructivo: comprueba que el proyecto
contiene el esquema histórico esperado y aborta en una base vacía o equivocada.

## 1. Lectura y salvaguarda

Antes de escribir:

- listar las migraciones remotas y comprobar que ninguna de las cinco ya aparece;
- obtener un dump de esquema real o confirmar un backup/restorable snapshot;
- guardar los recuentos de `workspace`, `person`, `conversation`, `cast_member`,
  `crew_assignment`, `person_note`, `availability_block` e `invoice`;
- auditar `select user_id from public.user_profile where is_platform_admin`;
- auditar todos los `owner` actuales de `account_membership` y
  `workspace_membership`.

No borrar datos demo durante este cambio. El backfill los necesita para demostrar
que cada referencia recibe un dossier local sin pérdidas.

## 2. Apply transaccional

Usar la operación `apply_migration` del MCP para cada fichero, conservando el nombre
sin extensión. Detenerse al primer error: no pegar las cinco migraciones como un solo
bloque y no marcar manualmente versiones fallidas como aplicadas.

Después de la quinta migración comprobar:

```sql
select count(*) from public.workspace_person;
select count(*) from public.workspace_organization;

select 'conversation' as source, count(*) as missing
from public.conversation c
left join public.workspace_person wp
  on wp.workspace_id = c.workspace_id and wp.person_id = c.person_id
where c.person_id is not null and wp.person_id is null
union all
select 'cast_member', count(*)
from public.cast_member x
left join public.workspace_person wp
  on wp.workspace_id = x.workspace_id and wp.person_id = x.person_id
where wp.person_id is null
union all
select 'crew_assignment', count(*)
from public.crew_assignment x
left join public.workspace_person wp
  on wp.workspace_id = x.workspace_id and wp.person_id = x.person_id
where wp.person_id is null;
```

Los tres valores `missing` deben ser cero. Comparar también los recuentos previos:
las tablas históricas no deben perder filas.

## 3. Tipos y pruebas

1. Regenerar los tipos TypeScript desde el esquema vivo y reemplazar
   `apps/web/src/lib/db-types.ts`; eliminar sus marcadores `hand-patched pending regen`.
2. Ejecutar `pnpm --filter web test:rls`. La línea base anterior al apply es
   102 passed, 1 skipped, 6 failed; después del apply las seis nuevas deben pasar.
3. Crear o facilitar una identidad sintética limitada y una externa. Ejecutar la
   matriz owner/admin/member/external y revocación usando un JWT emitido antes de la
   revocación. La identidad actual es admin en todos sus workspaces y no puede cubrir
   honestamente esos casos negativos.
4. Ejecutar `pnpm --filter web check`, `pnpm --filter web test:unit`, `pnpm --filter collab test`,
   `pnpm --filter collab exec tsc --noEmit` y `pnpm build`.
5. Consultar los asesores de seguridad y rendimiento de Supabase y resolver cualquier
   hallazgo nuevo causado por las migraciones.

## 4. Corte de entornos

Cuando todo esté verde, conservar `hour-phase0` como demo/staging y crear producción
limpia desde un baseline reconstructivo. Importar solo los pocos datos reales que se
decida conservar. No llamar producción a un proyecto que todavía depende del historial
SQL manual ni desplegar el frontend nuevo contra la base antigua.
