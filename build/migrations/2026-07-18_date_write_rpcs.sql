-- ADR-078 (calendar v2, stage 2): write path for `date` — create_date +
-- delete_date RPCs. Forced by existing policy shape, same two reasons as
-- performance/task/expense:
-- · date_insert is claim-bound (workspace_id = current_workspace_id()),
--   so a direct PostgREST INSERT only works in the JWT-claim workspace —
--   create_date is claim-independent, gated on
--   has_permission(project_id, 'edit:performance') (the date family's
--   permission, same as its policies post edit:show rename).
-- · date has NO DELETE policy and soft-delete by client PATCH is
--   impossible by construction (ADR-048: the updated row must stay
--   SELECT-visible) — delete_date rides SECURITY DEFINER.
--
-- Field edits do NOT need an RPC: date_update is permission-gated, not
-- claim-bound, and the row stays visible after a field edit — PATCH
-- /api/dates/:id goes direct (expense/task pattern), with the
-- line/performance cross-project guard at the API layer (ADR-043 pattern,
-- same as PATCH /api/performances/:key).
--
-- Contract guards carried by create_date (ADR-078):
-- · line ∈ project and performance ∈ project (cascade option C coherence —
--   the composite-FK-free integrity promised by 2026-07-18_date_cascade_travel.sql).
-- · status create-whitelist: tentative | confirmed only (§9 — cancelled/done
--   are lifecycle states, they never ride creation; the API enforces it too,
--   the RPC repeats it so strict AI=UI parity §7 can never bypass it).
-- · travel_direction only on kind='travel_day' (mirrors the DB CHECK with a
--   22023 instead of 23514).
-- · label (free text) only on kind='other', stored at custom_fields.label —
--   the ONLY writer of custom_fields (§8 explicit whitelist).
--
-- ORDER: apply AFTER 2026-07-18_date_kind_day_off.sql AND
-- 2026-07-18_date_cascade_travel.sql (references line_id, travel_direction
-- and the 'day_off' enum value).
--
-- NOT applied to any live DB yet — deliver-files-only pass (calendar-v2).
-- Apply via Supabase MCP apply_migration (name: date_write_rpcs),
-- additive-only; verify with probes (RPCs exist, EXECUTE revoked from
-- anon/PUBLIC, cross-project line rejected with 22023, status 'cancelled'
-- rejected with 22023).

--------------------------------------------------------------------------------
-- 1. create_date
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_date(
  p_project_id uuid,
  p_kind date_kind,
  p_starts_at timestamptz,
  p_ends_at timestamptz DEFAULT NULL,
  p_all_day boolean DEFAULT false,
  p_title text DEFAULT NULL,
  p_venue_name text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_status date_status DEFAULT 'tentative',
  p_performance_id uuid DEFAULT NULL,
  p_line_id uuid DEFAULT NULL,
  p_travel_direction text DEFAULT NULL,
  p_label text DEFAULT NULL
)
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

  -- Cascade coherence (ADR-043 pattern, promised by date_cascade_travel).
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

  -- Travel axis: only travel days carry a direction (22023 beats the CHECK's 23514).
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

COMMENT ON FUNCTION public.create_date(uuid, date_kind, timestamptz, timestamptz, boolean, text, text, text, text, date_status, uuid, uuid, text, text) IS
  'Create a date row (ADR-078). Claim-independent, has_permission(project, edit:performance)-gated; enforces line/performance ∈ project, create status whitelist (tentative|confirmed), travel_direction only on travel_day, label only on kind=other (sole custom_fields writer).';

REVOKE ALL ON FUNCTION public.create_date(uuid, date_kind, timestamptz, timestamptz, boolean, text, text, text, text, date_status, uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_date(uuid, date_kind, timestamptz, timestamptz, boolean, text, text, text, text, date_status, uuid, uuid, text, text) TO authenticated;

--------------------------------------------------------------------------------
-- 2. delete_date
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_date(p_date_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.date
  WHERE id = p_date_id AND deleted_at IS NULL;

  IF v_project_id IS NULL
    OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    -- Not-found and no-permission collapse (no existence oracle).
    RAISE EXCEPTION 'date not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.date SET deleted_at = now()
  WHERE id = p_date_id AND deleted_at IS NULL;
END;
$function$;

COMMENT ON FUNCTION public.delete_date(uuid) IS
  'Soft-delete a date row (ADR-048: no DELETE policy, deleted_at never rides a client PATCH).';

REVOKE ALL ON FUNCTION public.delete_date(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_date(uuid) TO authenticated;
