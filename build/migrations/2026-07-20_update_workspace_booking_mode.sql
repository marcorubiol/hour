-- ADR-002 §hold semantics — make booking_mode editable through the one
-- workspace write path (ADR-062's update_workspace), instead of leaving it
-- a knob only SQL can reach.
--
-- It is the first `settings` key the RPC touches, so it is also the first
-- one that needs the "clear it" semantics spelled out: sending an empty
-- value REMOVES the key rather than storing "". Absent means simple, and
-- storing an explicit "simple" that behaves identically would be two ways
-- to say one thing — the kind of duplication a jsonb settings blob rots by.
--
-- Validated twice on purpose: here for an honest 22023 the UI can show, and
-- by the workspace_booking_mode_valid CHECK for anything that reaches the
-- table another way.

CREATE OR REPLACE FUNCTION public.update_workspace(
  p_workspace_id uuid,
  p_patch        jsonb
)
RETURNS public.workspace
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
  v_mode      text := NULLIF(trim(coalesce(p_patch->>'booking_mode', '')), '');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.role         IN ('owner', 'admin')
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'booking_mode' AND v_mode IS NOT NULL
     AND v_mode NOT IN ('simple', 'prioritized') THEN
    RAISE EXCEPTION 'booking_mode must be simple or prioritized'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace w SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                           ELSE w.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')         ELSE w.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')             ELSE w.accent      END,
    domain      = CASE WHEN p_patch ? 'domain'      THEN NULLIF(p_patch->>'domain', '')::workspace_domain ELSE w.domain      END,
    city        = CASE WHEN p_patch ? 'city'        THEN NULLIF(trim(p_patch->>'city'), '')               ELSE w.city        END,
    logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN NULLIF(trim(p_patch->>'logo_url'), '')            ELSE w.logo_url    END,
    settings    = CASE
                    WHEN NOT (p_patch ? 'booking_mode') THEN w.settings
                    WHEN v_mode IS NULL                 THEN w.settings - 'booking_mode'
                    ELSE jsonb_set(w.settings, '{booking_mode}', to_jsonb(v_mode))
                  END,
    updated_at  = now()
  WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
  RETURNING * INTO v_workspace;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_workspace;
END;
$$;

REVOKE ALL ON FUNCTION public.update_workspace(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_workspace(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_workspace(uuid, jsonb) IS
  'Patch a workspace identity (name, description, accent, domain, city, logo_url) and settings.booking_mode. SECURITY DEFINER; requires owner/admin membership. jsonb patch: only present keys change; ""/null clears nullable fields and REMOVES booking_mode (absent = simple); slug/kind not editable here. ADR-062 + ADR-002.';
