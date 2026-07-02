-- ADR-049: venue entity write path. Fifth case of the claim-bound INSERT
-- pattern (venue_insert requires workspace_id = current_workspace_id()):
-- the RPC is claim-independent and gates on accepted membership of the
-- target workspace — the same audience the policy intends.
--
-- Idempotent on the (workspace, lower(name), lower(city)) live-unique
-- index: promoting a denormalized venue trio that already exists returns
-- the existing row instead of erroring — the "link what I typed" flow.
--
-- Applied live 2026-07-02 via Supabase MCP (migration `create_venue_rpc`).

CREATE OR REPLACE FUNCTION public.create_venue(
  p_workspace_id uuid,
  p_name text,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_capacity integer DEFAULT NULL,
  p_timezone text DEFAULT NULL
)
RETURNS public.venue
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_slug text;
  v_base text;
  v_n int := 1;
  v_venue public.venue;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND p_country !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'country must be ISO 3166 alpha-2' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  -- Idempotent promote: same name+city in the workspace → return it.
  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id
    AND deleted_at IS NULL
    AND lower(name) = lower(v_name)
    AND coalesce(lower(city), '') = coalesce(lower(v_city), '');
  IF v_venue.id IS NOT NULL THEN
    RETURN v_venue;
  END IF;

  v_base := coalesce(nullif(public.slugify(v_name), ''), 'venue');
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.venue
    WHERE workspace_id = p_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.venue (workspace_id, name, city, country, address, capacity, timezone, slug, created_by)
  VALUES (p_workspace_id, v_name, v_city, upper(p_country), nullif(btrim(coalesce(p_address, '')), ''), p_capacity, p_timezone, v_slug, v_caller)
  RETURNING * INTO v_venue;
  RETURN v_venue;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_venue(uuid, text, text, text, text, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_venue(uuid, text, text, text, text, integer, text) TO authenticated;
