-- ROLLBACK for 20261009200000_schedule_slot.sql (ADR-090 P1, fase A · expand)
--
-- Only valid while fase B (20261009210000) is NOT applied: if it is, run
-- rollback-20261009-schedule-slot-contract.sql first, which brings the five
-- columns back.
--
-- What it undoes: the mirror triggers, the table, its five RPCs and the
-- private helpers, and the new bodies of get_public_calendar /
-- get_public_roadsheet (restored verbatim from the checkpoint 20260720105713;
-- compare with `inspect` before using it against production). The five
-- timeslot columns were never touched by fase A and the mirror kept them equal
-- to the slots, so nothing has to be copied back.
--
-- What it cannot undo: slots that are not one of the five kinds (a "photo
-- call", a rehearsal day's running order). They go with the table; after the
-- first real use take a backup first.
--
-- Worker: the previous Worker reads columns and keeps working. The Worker that
-- reads schedule_slot does NOT: roll it back first.

BEGIN;

DROP TRIGGER IF EXISTS performance_timeslots_mirror ON public.performance;
DROP TRIGGER IF EXISTS schedule_slot_timeslots_mirror ON public.schedule_slot;
DROP FUNCTION IF EXISTS private.mirror_timeslot_columns_to_slots();
DROP FUNCTION IF EXISTS private.mirror_timeslot_slots_to_columns();

-- The previous public projections, verbatim from the checkpoint. Same
-- signature, so CREATE OR REPLACE keeps their grants to anon.
CREATE OR REPLACE FUNCTION "public"."get_public_calendar"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share public.calendar_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.calendar_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A soft-deleted workspace kills its feeds too.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace w
    WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'workspace', (SELECT jsonb_build_object('name', w.name, 'slug', w.slug, 'timezone', w.timezone)
                  FROM public.workspace w
                  WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL),
    'performances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
        'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
        'country', p.country,
        'load_in_at', p.load_in_at, 'soundcheck_at', p.soundcheck_at,
        'start_at', p.start_at, 'loadout_at', p.loadout_at, 'wrap_at', p.wrap_at,
        'updated_at', p.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = p.project_id),
        'venue', (SELECT jsonb_build_object(
                    'name', vn.name, 'city', vn.city, 'country', vn.country,
                    'address', vn.address, 'timezone', vn.timezone)
                  FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL)
      ) ORDER BY p.performed_at)
      FROM public.performance p
      WHERE p.workspace_id = v_share.workspace_id
        AND p.deleted_at IS NULL
        AND p.status IN ('confirmed', 'done', 'invoiced', 'paid')), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'status', d.status, 'title', d.title,
        'starts_at', d.starts_at, 'ends_at', d.ends_at, 'all_day', d.all_day,
        'venue_name', d.venue_name, 'city', d.city, 'updated_at', d.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = d.project_id)
      ) ORDER BY d.starts_at)
      FROM public.date d
      WHERE d.workspace_id = v_share.workspace_id
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_public_calendar"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_roadsheet"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share public.roadsheet_share;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.roadsheet_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'role', v_share.role,
    'performance', jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
      'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
      'country', p.country,
      'load_in_at', p.load_in_at, 'soundcheck_at', p.soundcheck_at,
      'start_at', p.start_at, 'loadout_at', p.loadout_at, 'wrap_at', p.wrap_at,
      'logistics', p.logistics, 'hospitality', p.hospitality, 'technical', p.technical
    ),
    'project', (SELECT jsonb_build_object('name', pr.name, 'slug', pr.slug)
                FROM public.project pr WHERE pr.id = p.project_id),
    'venue', (SELECT jsonb_build_object(
                'name', vn.name, 'city', vn.city, 'country', vn.country,
                'address', vn.address, 'capacity', vn.capacity,
                'timezone', vn.timezone, 'contacts', vn.contacts)
              FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL),
    'cast', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cm.role,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone)))
      FROM public.cast_member cm
      JOIN public.person pe ON pe.id = cm.person_id
      WHERE cm.project_id = p.project_id AND cm.deleted_at IS NULL), '[]'::jsonb),
    'cast_overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', co.role, 'reason', co.reason,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone),
        'replaces', rp.full_name))
      FROM public.cast_override co
      JOIN public.person pe ON pe.id = co.person_id
      LEFT JOIN public.person rp ON rp.id = co.replaces_person_id
      WHERE co.performance_id = p.id AND co.deleted_at IS NULL), '[]'::jsonb),
    'crew', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', cr.role, 'notes', cr.notes, 'contact_override', cr.contact_override,
        'person', jsonb_build_object('full_name', pe.full_name, 'email', pe.email, 'phone', pe.phone)))
      FROM public.crew_assignment cr
      JOIN public.person pe ON pe.id = cr.person_id
      WHERE cr.performance_id = p.id AND cr.deleted_at IS NULL), '[]'::jsonb),
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', av.kind, 'direction', av.direction, 'notes', av.notes, 'uploaded_at', av.uploaded_at))
      FROM public.asset_version av
      WHERE av.performance_id = p.id AND av.deleted_at IS NULL), '[]'::jsonb)
  ) INTO v_result
  FROM public.performance p
  WHERE p.id = v_share.performance_id AND p.deleted_at IS NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_public_roadsheet"("p_token" "text") OWNER TO "postgres";

DROP FUNCTION IF EXISTS public.replace_schedule_slots(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.reorder_schedule_slots(text, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.delete_schedule_slot(uuid);
DROP FUNCTION IF EXISTS public.update_schedule_slot(uuid, timestamptz, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.create_schedule_slot(text, uuid, timestamptz, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS private.performance_timeslots(uuid);
DROP FUNCTION IF EXISTS private.schedule_slot_compact(text, uuid);
DROP FUNCTION IF EXISTS private.schedule_slot_target(uuid);
DROP FUNCTION IF EXISTS private.schedule_slot_parent(text, uuid);
DROP TABLE IF EXISTS public.schedule_slot;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261009200000';

COMMIT;
