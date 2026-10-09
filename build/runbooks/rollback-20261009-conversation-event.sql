-- ROLLBACK for 20261009100000_conversation_event.sql (ADR-098, § 40)
--
-- What it undoes: the table, its RPC and the three enums. Nothing else
-- changed: `conversation`, its grants and `conversation_contact_timestamps`
-- were not touched by the migration, so there is nothing to restore there.
--
-- What it cannot undo: the events people recorded in between. They go with
-- the table, so after the first real use this stops being a rollback and
-- becomes a deletion; take a backup first. The `last_contacted_at` /
-- `first_contacted_at` stamps those events moved STAY moved: they are the
-- same columns the status trigger and "contacted today" already wrote, and
-- un-moving them would need the history this deletes.
--
-- Symptom that would call for it: none of the running code depends on it
-- until the Worker that reads `/api/conversations/[id]/events` is deployed.
-- If that Worker is live, roll the Worker back first.

BEGIN;

DROP FUNCTION IF EXISTS public.record_conversation_event(
  uuid, public.conversation_event_kind, timestamptz,
  public.conversation_event_direction, text, public.conversation_event_source,
  jsonb, jsonb, text, text, jsonb);
DROP TABLE IF EXISTS public.conversation_event;
DROP TYPE IF EXISTS public.conversation_event_direction;
DROP TYPE IF EXISTS public.conversation_event_source;
DROP TYPE IF EXISTS public.conversation_event_kind;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261009100000';

COMMIT;
