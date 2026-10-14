-- ROLLBACK for 20261014100000_comms_threads.sql (ADR-106, comms carril 2)
--
-- What it undoes: the three tables (thread, message, thread_read), their
-- guards and helpers, the six RPC, the three `facet_level` rows of Logística,
-- Full de ruta and Comidas in the project, and the `membership_facet` rows the
-- re-expansion added for those facets at project level.
--
-- What it cannot undo: the messages people wrote in between. They go with the
-- tables, so after the first real use this stops being a rollback and becomes
-- a deletion; take a backup first. The facet rows removed are ALL project
-- rows of those three facets, also any granted later with a package or by
-- hand (set_membership_facet): after this, they cannot exist at that level.
--
-- Symptom that would call for it: none of the running code depends on it
-- until a Worker that reads threads is deployed. If that Worker is live, roll
-- the Worker back first.

BEGIN;

DROP FUNCTION IF EXISTS public.bolo_board(uuid);
DROP FUNCTION IF EXISTS public.thread_audience(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.mark_thread_read(uuid);
DROP FUNCTION IF EXISTS public.delete_message(uuid);
DROP FUNCTION IF EXISTS public.edit_message(uuid, text);
DROP FUNCTION IF EXISTS public.post_message(text, uuid, text, uuid, uuid);

DROP TABLE IF EXISTS public.thread_read;
DROP TABLE IF EXISTS public.message;
DROP TABLE IF EXISTS public.thread;

DROP FUNCTION IF EXISTS private.guard_message();
DROP FUNCTION IF EXISTS private.guard_thread_immutable();
DROP FUNCTION IF EXISTS private.guard_thread();
DROP FUNCTION IF EXISTS private.can_read_thread(uuid, uuid);
DROP FUNCTION IF EXISTS private.thread_readable(uuid, uuid, uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS private.can_read_container_thread(public.container_level, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS private.can_read_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS private.facet_active_at(public.container_level, uuid, uuid);
DROP FUNCTION IF EXISTS private.thread_container_workspace(public.container_level, uuid);

DELETE FROM public.membership_facet mf
USING public.membership m, public.facet f
WHERE m.id = mf.membership_id
  AND f.id = mf.facet_id
  AND m.level = 'project'
  AND f.workspace_id IS NULL
  AND f.key IN ('logistica', 'full_de_ruta', 'comidas');

DELETE FROM public.facet_level fl
USING public.facet f
WHERE f.id = fl.facet_id
  AND fl.level = 'project'
  AND f.workspace_id IS NULL
  AND f.key IN ('logistica', 'full_de_ruta', 'comidas');

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261014100000';

COMMIT;
