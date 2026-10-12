-- Rollback de 20261012100000_commitment_person (ADR-103).
--
-- Aditiva: deshacerla borra la tabla y con ella cada «voy / no voy» apuntado.
-- Antes de correrlo, desplegar un Worker que no pida el embed
-- `commitments:commitment_person(...)` (feeds de funciones y de dates, y el
-- bundle de la función): con la tabla fuera, esos selects fallan.

BEGIN;
DROP FUNCTION IF EXISTS public.set_commitment_person(text, uuid, uuid, public.commitment_state);
DROP TABLE IF EXISTS public.commitment_person;
DROP TYPE IF EXISTS public.commitment_state;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261012100000';
COMMIT;
