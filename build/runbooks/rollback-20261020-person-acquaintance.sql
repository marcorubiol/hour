-- Rollback de 20261020110000_person_acquaintance (ADR-138 § 5).
-- Borra la RPC, la función de lectura y la tabla. Lo que se pierde: a quién
-- conoce cada miembro del equipo y qué marcas había compartido. Antes de
-- aplicarlo, desplegar un Worker que no lea `person_acquaintance` ni llame a
-- `set_acquaintance` (`/api/acquaintances`).

BEGIN;

DROP FUNCTION IF EXISTS public.set_acquaintance(uuid, uuid, boolean, boolean);
DROP POLICY IF EXISTS person_acquaintance_select ON public.person_acquaintance;
DROP FUNCTION IF EXISTS private.person_acquaintance_readable_by_caller(uuid, uuid, uuid, boolean);
DROP TABLE IF EXISTS public.person_acquaintance;

COMMIT;
