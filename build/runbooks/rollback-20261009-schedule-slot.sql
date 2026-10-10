-- ROLLBACK for 20261009200000_schedule_slot.sql (ADR-090 P1, § 17)
--
-- Written with the migration on 2026-10-09. The two public projections below
-- are copied verbatim from the checkpoint (20260720105713), which is what every
-- migration up to 20261009100000 leaves in place; before using this against
-- production, compare them with what `inspect` reports, because production is
-- where a body nobody wrote down can live.
--
-- What it undoes: the table, its five RPCs and three private helpers, and the
-- new bodies of get_public_calendar / get_public_roadsheet. It puts the five
-- timeslot columns back on `performance`, refills them from the slots of kind
-- load_in | soundcheck | start | loadout | wrap (the first of each kind, by
-- sort), restores the CHECK and the column SELECT grant.
--
-- What it cannot undo: slots that are not one of the five kinds (a "photo
-- call", a rehearsal day's running order). Those rows go with the table, so
-- after the first real use this stops being a pure rollback and loses data;
-- take a backup first. And if someone saved an out-of-order schedule through
-- replace_schedule_slots, restoring `performance_timeslots_ordered` fails and
-- the whole rollback reverts: fix those rows first (the error names the
-- constraint).
--
-- ROLL THE WORKER BACK FIRST. The Worker that ships with this migration reads
-- `schedule_slot` and no longer names the five columns; with the table gone,
-- its feeds 4xx. Roll the Worker back to the previous build, then run this.

BEGIN;

ALTER TABLE public.performance
  ADD COLUMN load_in_at    timestamptz,
  ADD COLUMN soundcheck_at timestamptz,
  ADD COLUMN start_at      timestamptz,
  ADD COLUMN loadout_at    timestamptz,
  ADD COLUMN wrap_at       timestamptz;

UPDATE public.performance p SET
  load_in_at    = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'load_in'    ORDER BY s.sort LIMIT 1),
  soundcheck_at = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'soundcheck' ORDER BY s.sort LIMIT 1),
  start_at      = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'start'      ORDER BY s.sort LIMIT 1),
  loadout_at    = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'loadout'    ORDER BY s.sort LIMIT 1),
  wrap_at       = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'wrap'       ORDER BY s.sort LIMIT 1)
WHERE EXISTS (SELECT 1 FROM public.schedule_slot s WHERE s.performance_id = p.id);

ALTER TABLE public.performance
  ADD CONSTRAINT performance_timeslots_ordered CHECK (((("load_in_at" IS NULL) OR ("soundcheck_at" IS NULL) OR ("load_in_at" <= "soundcheck_at")) AND (("soundcheck_at" IS NULL) OR ("start_at" IS NULL) OR ("soundcheck_at" <= "start_at")) AND (("start_at" IS NULL) OR ("loadout_at" IS NULL) OR ("start_at" <= "loadout_at")) AND (("loadout_at" IS NULL) OR ("wrap_at" IS NULL) OR ("loadout_at" <= "wrap_at"))));

COMMENT ON COLUMN public.performance.load_in_at IS 'ADR-023: crew arrival / venue access begins.';
COMMENT ON COLUMN public.performance.soundcheck_at IS 'ADR-023: soundcheck start.';
COMMENT ON COLUMN public.performance.start_at IS 'ADR-023: doors-open / actual performance start. May differ from performed_at (which is just a date).';
COMMENT ON COLUMN public.performance.loadout_at IS 'ADR-023: load-out start.';
COMMENT ON COLUMN public.performance.wrap_at IS 'ADR-023: crew leaves venue.';
COMMENT ON COLUMN public.performance.hold_notice_days IS 'ADR-079 §2: hold decision notice as lead time. NULL = standard default (30) · 0 = no notice · N = notify N days before start_at. Urgency is derived (start_at − notice), never stored.';

-- The column SELECT grant of 20260720172431 (the other privileges on
-- `performance` are table-level and cover new columns by themselves).
GRANT SELECT (load_in_at, soundcheck_at, start_at, loadout_at, wrap_at)
  ON public.performance TO authenticated;

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
