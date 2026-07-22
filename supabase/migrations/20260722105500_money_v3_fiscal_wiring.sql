-- Money v3 (ADR-086) — Phase 3b: the issuer-wiring write path. update_workspace
-- gains a `fiscal_identity_id` key (the per-workspace issuer override, ADR-086
-- D2). Same jsonb-patch contract as the other keys: present changes, empty
-- clears. The value must be a workspace-owned issuer identity of this workspace.
-- The account-default write path is deferred to UI wiring. Additive: the money
-- v2 update_workspace calls (name/booking_mode/…) behave exactly as before.

CREATE OR REPLACE FUNCTION public.update_workspace(p_workspace_id uuid, p_patch jsonb)
RETURNS public.workspace
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
  v_mode      text := NULLIF(trim(coalesce(p_patch->>'booking_mode', '')), '');
  v_inv_mode  text := NULLIF(trim(coalesce(p_patch->>'invoicing_mode', '')), '');
  v_fid       uuid := NULLIF(trim(coalesce(p_patch->>'fiscal_identity_id', '')), '')::uuid;
  v_settings  jsonb;
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

  IF p_patch ? 'invoicing_mode' AND v_inv_mode IS NOT NULL
     AND v_inv_mode NOT IN ('off', 'interno', 'legal') THEN
    RAISE EXCEPTION 'invoicing_mode must be off, interno or legal'
      USING ERRCODE = '22023';
  END IF;

  -- The override must be a workspace-owned issuer identity of this workspace.
  IF p_patch ? 'fiscal_identity_id' AND v_fid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = v_fid
      AND fi.workspace_id = p_workspace_id
      AND fi.kind = 'issuer'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'fiscal_identity_id must be a workspace-owned issuer identity'
      USING ERRCODE = '22023';
  END IF;

  SELECT settings INTO v_settings
  FROM public.workspace WHERE id = p_workspace_id AND deleted_at IS NULL;

  IF p_patch ? 'booking_mode' THEN
    v_settings := CASE WHEN v_mode IS NULL
      THEN v_settings - 'booking_mode'
      ELSE jsonb_set(v_settings, '{booking_mode}', to_jsonb(v_mode)) END;
  END IF;
  IF p_patch ? 'invoicing_mode' THEN
    v_settings := CASE WHEN v_inv_mode IS NULL
      THEN v_settings - 'invoicing_mode'
      ELSE jsonb_set(v_settings, '{invoicing_mode}', to_jsonb(v_inv_mode)) END;
  END IF;

  UPDATE public.workspace w SET
    name               = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                           ELSE w.name        END,
    description        = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')         ELSE w.description END,
    accent             = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')             ELSE w.accent      END,
    domain             = CASE WHEN p_patch ? 'domain'      THEN NULLIF(p_patch->>'domain', '')::workspace_domain ELSE w.domain      END,
    city               = CASE WHEN p_patch ? 'city'        THEN NULLIF(trim(p_patch->>'city'), '')               ELSE w.city        END,
    logo_url           = CASE WHEN p_patch ? 'logo_url'    THEN NULLIF(trim(p_patch->>'logo_url'), '')            ELSE w.logo_url    END,
    fiscal_identity_id = CASE WHEN p_patch ? 'fiscal_identity_id' THEN v_fid                                     ELSE w.fiscal_identity_id END,
    settings           = CASE WHEN (p_patch ? 'booking_mode') OR (p_patch ? 'invoicing_mode')
                              THEN v_settings ELSE w.settings END,
    updated_at         = now()
  WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
  RETURNING * INTO v_workspace;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_workspace;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_workspace(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_workspace(uuid, jsonb) IS
  'Patch a workspace identity (name, description, accent, domain, city, logo_url, fiscal_identity_id) and settings.booking_mode / settings.invoicing_mode. SECURITY DEFINER; requires owner/admin membership. jsonb patch: only present keys change; empty clears nullable fields / removes a mode key. fiscal_identity_id must be a workspace-owned issuer identity. ADR-062 + ADR-002 + ADR-086.';
