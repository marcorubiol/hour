-- ADR-084 §1 — drop the one-row-per-day guard (Marco, 2026-07-20).
--
-- It existed to protect the band, whose edges are derived by asking whether
-- the neighbouring DAY belongs to the series. But a rehearsal day holds a
-- morning and an afternoon session and you confirm one without the other —
-- so the unit is the SESSION, not the day. Two rows on one day never broke
-- the edge derivation anyway: the day still belongs.
--
-- What several times on a day DOES affect is display, and a card being small
-- is not a reason for something to stop existing. The month decides how to
-- summarise; the model just records. Supersedes the guard in
-- 2026-07-20_create_date_series_zone_fix.sql (whose timezone reasoning is
-- moot once no day comparison is made at all).

CREATE OR REPLACE FUNCTION public.create_date_series(
  p_project_id uuid,
  p_kind date_kind,
  p_starts timestamptz[],
  p_ends timestamptz[] DEFAULT NULL,
  p_all_day boolean DEFAULT false,
  p_title text DEFAULT NULL,
  p_venue_name text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_status date_status DEFAULT 'tentative',
  p_line_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS SETOF public.date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_label        text := nullif(btrim(coalesce(p_label, '')), '');
  v_series       uuid := uuid_generate_v7();
  v_n            int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  v_n := coalesce(array_length(p_starts, 1), 0);

  -- A "series" of one is just a date: send it to create_date rather than
  -- minting a series_id that would never form a band.
  IF v_n < 2 THEN
    RAISE EXCEPTION 'a series needs at least 2 days — use create_date for one'
      USING ERRCODE = '22023';
  END IF;

  -- Runaway guard. A block is a week or a season of rehearsals, not a year.
  IF v_n > 92 THEN
    RAISE EXCEPTION 'a series is capped at 92 days' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_starts) s WHERE s IS NULL) THEN
    RAISE EXCEPTION 'starts_at cannot be null' USING ERRCODE = '22023';
  END IF;

  IF p_ends IS NOT NULL AND coalesce(array_length(p_ends, 1), 0) <> v_n THEN
    RAISE EXCEPTION 'p_ends must be null or the same length as p_starts'
      USING ERRCODE = '22023';
  END IF;

  -- Two rows on the same day would break the band: its edges are derived by
  -- asking whether the neighbouring DAY belongs to the series.
  IF (
    SELECT count(DISTINCT (s AT TIME ZONE coalesce(v_tz, 'UTC'))::date)
    FROM unnest(p_starts) s
  ) <> v_n THEN
    RAISE EXCEPTION 'a series cannot carry two rows on the same day'
      USING ERRCODE = '22023';
  END IF;

  -- §9: the enum of 4 is never exposed at creation.
  IF p_status IS NULL OR p_status NOT IN ('tentative', 'confirmed') THEN
    RAISE EXCEPTION 'status must be tentative or confirmed on create'
      USING ERRCODE = '22023';
  END IF;

  -- A travel day carries a direction per row; a multi-day travel block is
  -- not a thing this model expresses.
  IF p_kind = 'travel_day' THEN
    RAISE EXCEPTION 'travel_day cannot be created as a series'
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

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  -- §8: label is the Altres axis — only kind='other' rows carry one.
  IF v_label IS NOT NULL AND p_kind <> 'other' THEN
    RAISE EXCEPTION 'label is only accepted for kind=other' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.date (
    workspace_id, project_id, line_id,
    kind, status, title, starts_at, ends_at, all_day,
    venue_name, city, country, series_id, custom_fields, created_by
  )
  SELECT
    v_workspace_id, p_project_id, p_line_id,
    p_kind, p_status,
    nullif(btrim(coalesce(p_title, '')), ''),
    s.starts_at,
    CASE WHEN p_ends IS NULL THEN NULL ELSE p_ends[s.ord] END,
    coalesce(p_all_day, false),
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(upper(btrim(coalesce(p_country, ''))), ''),
    v_series,
    CASE WHEN v_label IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('label', v_label) END,
    v_caller
  FROM unnest(p_starts) WITH ORDINALITY AS s(starts_at, ord)
  ORDER BY s.starts_at
  RETURNING *;
END;
$function$;

COMMENT ON FUNCTION public.create_date_series(uuid, date_kind, timestamptz[], timestamptz[], boolean, text, text, text, text, date_status, uuid, text) IS
  'Create a multi-day block as N date rows sharing one series_id, atomically (ADR-084 §1). Same gate and guards as create_date; caller supplies exact per-day timestamps. Rejects <2 days, >92 days, duplicate days and travel_day.';

REVOKE ALL ON FUNCTION public.create_date_series(uuid, date_kind, timestamptz[], timestamptz[], boolean, text, text, text, text, date_status, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_date_series(uuid, date_kind, timestamptz[], timestamptz[], boolean, text, text, text, text, date_status, uuid, text) TO authenticated;
