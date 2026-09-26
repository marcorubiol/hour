-- ROLLBACK for 20260926100000_travel_stages.sql (ADR-089 P1)
--
-- Written with the migration on 2026-09-26. The previous `create_date` below
-- was captured from a database rebuilt from every migration up to
-- 20260829140000, NOT from live production: before using this against
-- production, compare it with what `inspect` reports for create_date, because
-- production is exactly where a signature nobody wrote down can live.
--
-- What it undoes: the stage table and its four RPCs, the endpoint columns on
-- `date`, the enum, and the new signature of `create_date`. What it cannot
-- undo: the endpoints and stages people typed in between. Those rows are lost
-- with their columns, so after the first real use this stops being a rollback
-- and becomes a deletion; take a backup first.
--
-- Symptom that would call for it: `POST /api/dates` failing for every kind
-- (the new create_date is the one thing the running Worker calls).

BEGIN;

DROP FUNCTION IF EXISTS public.reorder_travel_stages(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.delete_travel_stage(uuid);
DROP FUNCTION IF EXISTS public.update_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.create_travel_stage(
  uuid, public.transport_mode, text, text, text, text, text, text,
  timestamptz, timestamptz, text, text);
DROP TABLE IF EXISTS public.travel_stage;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'create_date'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

ALTER TABLE public.date
  DROP CONSTRAINT IF EXISTS date_travel_endpoints,
  DROP CONSTRAINT IF EXISTS date_destination_country_format,
  DROP CONSTRAINT IF EXISTS date_origin_country_format,
  DROP COLUMN IF EXISTS destination_country,
  DROP COLUMN IF EXISTS destination_city,
  DROP COLUMN IF EXISTS origin_country,
  DROP COLUMN IF EXISTS origin_city;

DROP TYPE IF EXISTS public.transport_mode;

-- The previous create_date, verbatim.
CREATE OR REPLACE FUNCTION public.create_date(p_project_id uuid, p_kind date_kind, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_all_day boolean DEFAULT false, p_title text DEFAULT NULL::text, p_venue_name text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_status date_status DEFAULT 'tentative'::date_status, p_performance_id uuid DEFAULT NULL::uuid, p_line_id uuid DEFAULT NULL::uuid, p_travel_direction text DEFAULT NULL::text, p_label text DEFAULT NULL::text)
 RETURNS public.date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_label        text := nullif(btrim(coalesce(p_label, '')), '');
  v_row          public.date;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_starts_at IS NULL THEN
    RAISE EXCEPTION 'starts_at cannot be null' USING ERRCODE = '22023';
  END IF;

  -- §9: the enum of 4 is never exposed at creation.
  IF p_status IS NULL OR p_status NOT IN ('tentative', 'confirmed') THEN
    RAISE EXCEPTION 'status must be tentative or confirmed on create'
      USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a date'
      USING ERRCODE = '42501';
  END IF;

  -- Cascade coherence (ADR-043 pattern).
  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_performance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.performance
    WHERE id = p_performance_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'performance does not belong to project' USING ERRCODE = '22023';
  END IF;

  -- Travel axis: only travel days carry a direction.
  IF p_travel_direction IS NOT NULL THEN
    IF p_kind <> 'travel_day'
      OR p_travel_direction NOT IN ('outbound', 'return', 'leg') THEN
      RAISE EXCEPTION 'travel_direction requires kind=travel_day and one of outbound/return/leg'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- §8: label is the Altres axis — only kind='other' rows carry one.
  IF v_label IS NOT NULL AND p_kind <> 'other' THEN
    RAISE EXCEPTION 'label is only accepted for kind=other' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.date (
    workspace_id, project_id, line_id, performance_id,
    kind, status, title, starts_at, ends_at, all_day,
    venue_name, city, country, travel_direction, custom_fields, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id,
    p_kind, p_status,
    nullif(btrim(coalesce(p_title, '')), ''),
    p_starts_at, p_ends_at, coalesce(p_all_day, false),
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(upper(btrim(coalesce(p_country, ''))), ''),
    p_travel_direction,
    CASE WHEN v_label IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('label', v_label) END,
    v_caller
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_date(
  uuid, public.date_kind, timestamptz, timestamptz, boolean, text, text, text,
  text, public.date_status, uuid, uuid, text, text
) TO authenticated;

COMMIT;
