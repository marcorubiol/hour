-- ADR-089 P2 (Travel v2, the screen): each end of a stage keeps its own clock,
-- and can be one of the space's venues.
--
-- A flight leaves Barcelona at 8h15 Madrid time and lands in London at 9h40
-- London time. Until now a stage had two instants and no zone, so the screen
-- typed and read both in the trip's clock (its space's), and an arrival in
-- another zone came out an hour wrong. Marco, 2026-10-10: a stage can leave
-- in one zone and arrive in another.
--
-- WHAT THIS DOES:
--   1. `travel_stage.depart_tz` and `arrive_tz`, IANA names, nullable. NULL
--      means «the space's clock», which is exactly what every stage meant up
--      to today: no backfill, nothing changes meaning.
--   2. `travel_stage.from_venue_id` and `to_venue_id`, optional links to a
--      venue OF THE SAME SPACE (Marco, 2026-10-10): a stage that ends at the
--      venue of tonight's show says which one, and that venue's zone
--      (`venue.timezone`, ADR-053) is the end's zone. ON DELETE SET NULL: a
--      venue removed for good leaves the stage with its words.
--   3. `create_travel_stage` and `update_travel_stage` learn the four, as the
--      last parameters with DEFAULT NULL. update still REPLACES the stage
--      (ADR-097): a caller that does not send them clears them. A venue of
--      another space, a deleted one and one that does not exist all give the
--      same 22023: no existence oracle.
--
-- The instants do not change: `depart_at`/`arrive_at` were always absolute.
-- The zone only says which wall clock a person typed them in and reads them
-- back in.
--
-- A zone must be a name Postgres knows (`pg_timezone_names`): the RPC refuses
-- anything else with 22023. The CHECK only holds the shape, because a CHECK
-- cannot look at a catalog view.
--
-- ADDITIVE according to § 34, with one caveat: the two RPCs change signature,
-- so there is a DROP. Dropped BY NAME asking the catalog (the 2026-08-10
-- lesson), like 20260926100000 did. The deployed Worker calls by named
-- arguments without the new two, and resolves to the new functions unchanged.
-- Rollback: build/runbooks/rollback-20261010-travel-stage-ends.sql.

-- ── 1 · the zones ─────────────────────────────────────────────────────────
ALTER TABLE public.travel_stage
  ADD COLUMN depart_tz text,
  ADD COLUMN arrive_tz text;

ALTER TABLE public.travel_stage
  ADD CONSTRAINT travel_stage_depart_tz_format
    CHECK (depart_tz IS NULL OR (length(depart_tz) BETWEEN 1 AND 64 AND depart_tz ~ '^[A-Za-z][A-Za-z0-9_+/-]*$')),
  ADD CONSTRAINT travel_stage_arrive_tz_format
    CHECK (arrive_tz IS NULL OR (length(arrive_tz) BETWEEN 1 AND 64 AND arrive_tz ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'));

COMMENT ON COLUMN public.travel_stage.depart_tz IS
  'ADR-089 P2: IANA zone the departure is typed and read in. NULL = the space''s zone.';
COMMENT ON COLUMN public.travel_stage.arrive_tz IS
  'ADR-089 P2: IANA zone the arrival is typed and read in (a flight lands in another clock). NULL = the space''s zone.';

-- ── 2 · the venues ────────────────────────────────────────────────────────
ALTER TABLE public.travel_stage
  ADD COLUMN from_venue_id uuid REFERENCES public.venue(id) ON DELETE SET NULL,
  ADD COLUMN to_venue_id   uuid REFERENCES public.venue(id) ON DELETE SET NULL;

CREATE INDEX travel_stage_from_venue_id_idx ON public.travel_stage (from_venue_id) WHERE from_venue_id IS NOT NULL;
CREATE INDEX travel_stage_to_venue_id_idx   ON public.travel_stage (to_venue_id)   WHERE to_venue_id IS NOT NULL;

COMMENT ON COLUMN public.travel_stage.from_venue_id IS
  'ADR-089 P2: the venue a stage leaves from, when it is one of the space''s. Its timezone is the end''s zone.';
COMMENT ON COLUMN public.travel_stage.to_venue_id IS
  'ADR-089 P2: the venue a stage arrives at (tonight''s show), when it is one of the space''s.';

-- ── 3 · the two writers, by name ──────────────────────────────────────────
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_travel_stage', 'update_travel_stage')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

-- A zone the catalog knows, or NULL. Empty text is NULL.
CREATE FUNCTION public.travel_stage_zone(p_tz text)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tz text := nullif(btrim(coalesce(p_tz, '')), '');
BEGIN
  IF v_tz IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
    RAISE EXCEPTION 'unknown time zone %', v_tz USING ERRCODE = '22023';
  END IF;
  RETURN v_tz;
END;
$$;

REVOKE ALL ON FUNCTION public.travel_stage_zone(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.travel_stage_zone(text) TO authenticated;

-- A venue of the trip's space, alive, or NULL. Not there, deleted and «of
-- another space» are the same answer.
CREATE FUNCTION public.travel_stage_venue(p_venue_id uuid, p_workspace_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_venue_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue
    WHERE id = p_venue_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'venue not available' USING ERRCODE = '22023';
  END IF;
  RETURN p_venue_id;
END;
$$;

REVOKE ALL ON FUNCTION public.travel_stage_venue(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- create_travel_stage: appends a stage AT THE END of the trip.
CREATE FUNCTION public.create_travel_stage(
  p_date_id      uuid,
  p_mode         public.transport_mode DEFAULT 'other',
  p_from_city    text DEFAULT NULL,
  p_from_country text DEFAULT NULL,
  p_from_place   text DEFAULT NULL,
  p_to_city      text DEFAULT NULL,
  p_to_country   text DEFAULT NULL,
  p_to_place     text DEFAULT NULL,
  p_depart_at    timestamptz DEFAULT NULL,
  p_arrive_at    timestamptz DEFAULT NULL,
  p_reference    text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_depart_tz    text DEFAULT NULL,
  p_arrive_tz    text DEFAULT NULL,
  p_from_venue_id uuid DEFAULT NULL,
  p_to_venue_id   uuid DEFAULT NULL
) RETURNS public.travel_stage
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_date     public.date;
  v_position integer;
  v_row      public.travel_stage;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_date
  FROM public.date WHERE id = p_date_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_date.id IS NULL OR NOT public.has_permission(v_date.project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'date % not found', p_date_id USING ERRCODE = '42501';
  END IF;

  IF v_date.kind <> 'travel_day' THEN
    RAISE EXCEPTION 'only a travel_day has stages' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(position), 0) + 1 INTO v_position
  FROM public.travel_stage WHERE date_id = p_date_id;

  INSERT INTO public.travel_stage (
    workspace_id, project_id, date_id, position, mode,
    from_city, from_country, from_place,
    to_city, to_country, to_place,
    depart_at, arrive_at, depart_tz, arrive_tz,
    from_venue_id, to_venue_id,
    reference, notes, created_by
  ) VALUES (
    v_date.workspace_id, v_date.project_id, p_date_id, v_position,
    coalesce(p_mode, 'other'),
    nullif(btrim(coalesce(p_from_city, '')), ''),
    nullif(upper(btrim(coalesce(p_from_country, ''))), ''),
    nullif(btrim(coalesce(p_from_place, '')), ''),
    nullif(btrim(coalesce(p_to_city, '')), ''),
    nullif(upper(btrim(coalesce(p_to_country, ''))), ''),
    nullif(btrim(coalesce(p_to_place, '')), ''),
    p_depart_at, p_arrive_at,
    public.travel_stage_zone(p_depart_tz),
    public.travel_stage_zone(p_arrive_tz),
    public.travel_stage_venue(p_from_venue_id, v_date.workspace_id),
    public.travel_stage_venue(p_to_venue_id, v_date.workspace_id),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- update_travel_stage: REPLACES the stage's fields, zones included (ADR-097).
CREATE FUNCTION public.update_travel_stage(
  p_stage_id     uuid,
  p_mode         public.transport_mode,
  p_from_city    text DEFAULT NULL,
  p_from_country text DEFAULT NULL,
  p_from_place   text DEFAULT NULL,
  p_to_city      text DEFAULT NULL,
  p_to_country   text DEFAULT NULL,
  p_to_place     text DEFAULT NULL,
  p_depart_at    timestamptz DEFAULT NULL,
  p_arrive_at    timestamptz DEFAULT NULL,
  p_reference    text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_depart_tz    text DEFAULT NULL,
  p_arrive_tz    text DEFAULT NULL,
  p_from_venue_id uuid DEFAULT NULL,
  p_to_venue_id   uuid DEFAULT NULL
) RETURNS public.travel_stage
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id   uuid;
  v_workspace_id uuid;
  v_row          public.travel_stage;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT s.project_id, s.workspace_id INTO v_project_id, v_workspace_id
  FROM public.travel_stage s
  JOIN public.date d ON d.id = s.date_id AND d.deleted_at IS NULL
  WHERE s.id = p_stage_id;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'stage % not found', p_stage_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.travel_stage SET
    mode         = coalesce(p_mode, 'other'),
    from_city    = nullif(btrim(coalesce(p_from_city, '')), ''),
    from_country = nullif(upper(btrim(coalesce(p_from_country, ''))), ''),
    from_place   = nullif(btrim(coalesce(p_from_place, '')), ''),
    to_city      = nullif(btrim(coalesce(p_to_city, '')), ''),
    to_country   = nullif(upper(btrim(coalesce(p_to_country, ''))), ''),
    to_place     = nullif(btrim(coalesce(p_to_place, '')), ''),
    depart_at    = p_depart_at,
    arrive_at    = p_arrive_at,
    depart_tz    = public.travel_stage_zone(p_depart_tz),
    arrive_tz    = public.travel_stage_zone(p_arrive_tz),
    from_venue_id = public.travel_stage_venue(p_from_venue_id, v_workspace_id),
    to_venue_id   = public.travel_stage_venue(p_to_venue_id, v_workspace_id),
    reference    = nullif(btrim(coalesce(p_reference, '')), ''),
    notes        = nullif(btrim(coalesce(p_notes, '')), '')
  WHERE id = p_stage_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text, text, text, uuid, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text, text, text, uuid, uuid
) TO authenticated;
