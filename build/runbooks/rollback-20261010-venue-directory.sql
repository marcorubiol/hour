-- ROLLBACK for 20261010200000_venue_directory.sql (directorio global de salas, fase 1)
--
-- Drops adopt_directory_venue, venue.directory_id and the two directory tables.
--
-- DATA LOST: the whole directory (it is rebuilt by re-running the import,
-- scripts/venue-directory/) and the link of every adopted venue to its entry.
-- The adopted venues THEMSELVES stay, with everything that was copied into
-- them and every later edit: adopting is a copy.
--
-- Worker: a Worker that calls /api/venue-directory or adopt_directory_venue
-- (this branch) gets 404/500 on the directory search and on «adopt» after
-- this rollback; the rest of the venue screens keep working. Roll the Worker
-- back first, or together. The Worker before this branch never touches any
-- of it.

BEGIN;

DROP FUNCTION IF EXISTS public.adopt_directory_venue(uuid, uuid);

DROP INDEX IF EXISTS public.venue_workspace_directory_uidx;
ALTER TABLE public.venue DROP COLUMN IF EXISTS directory_id;

DROP TABLE IF EXISTS public.venue_directory;
DROP TABLE IF EXISTS public.venue_directory_source;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261010200000';

COMMIT;
