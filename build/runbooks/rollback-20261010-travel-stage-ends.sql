-- ROLLBACK for 20261010160000_travel_stage_ends.sql (ADR-089 P2)
--
-- Brings back the twelve-argument create_travel_stage and update_travel_stage
-- of 20260926100000 (copied verbatim from that migration, grants included),
-- drops the zone and venue helpers and the four columns.
--
-- DATA LOST: every depart_tz / arrive_tz and every from_venue_id /
-- to_venue_id written in between (the place's NAME stays in from_place /
-- to_place, which is older than this migration). The instants
-- stay right (they were always absolute); the screen goes back to reading
-- every hour in the space's clock, so a stage that arrived in another zone
-- reads off by the zones' difference again.
--
-- Worker: a Worker that sends p_depart_tz / p_arrive_tz / p_*_venue_id (this branch) gets a
-- PostgREST 404 «function not found» on stage writes after this rollback:
-- roll the Worker back first, or together. The Worker before this branch
-- never sends them and works on both sides.

BEGIN;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_travel_stage', 'update_travel_stage', 'travel_stage_zone', 'travel_stage_venue')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

ALTER TABLE public.travel_stage
  DROP COLUMN depart_tz,
  DROP COLUMN arrive_tz,
  DROP COLUMN from_venue_id,
  DROP COLUMN to_venue_id;

-- ── from 20260926100000, verbatim ─────────────────────────────────────────
-- create_travel_stage: añade un tramo AL FINAL del viaje.
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
  p_notes        text DEFAULT NULL
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

  -- FOR UPDATE: dos altas a la vez en el mismo viaje se ponen en fila, en vez
  -- de calcular la misma posición y chocar contra la UNIQUE al confirmar.
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
    depart_at, arrive_at, reference, notes, created_by
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
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- update_travel_stage: SUSTITUYE los campos del tramo. Lo que llega NULL se
-- borra: el editor manda el tramo entero, y un parcial aquí obligaría a
-- distinguir «no lo toques» de «vacíalo». La posición no se toca aquí; para
-- eso está reorder_travel_stages.
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
  p_notes        text DEFAULT NULL
) RETURNS public.travel_stage
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_row        public.travel_stage;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT s.project_id INTO v_project_id
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
    reference    = nullif(btrim(coalesce(p_reference, '')), ''),
    notes        = nullif(btrim(coalesce(p_notes, '')), '')
  WHERE id = p_stage_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text
) TO authenticated;

COMMIT;
