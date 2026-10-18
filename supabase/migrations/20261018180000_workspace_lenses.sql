-- ADR-131 · cada espacio enciende o apaga sus tres lentes.
--
-- `workspace.lenses_off` guarda las lentes que el espacio NO usa: `planner`,
-- `conversations` (la lente de venta: Difusión o Contratación según el
-- oficio) y `books` (Cuentas). Vacío por defecto: todas encendidas, así que
-- una lente que se añada mañana nace encendida en todos los espacios. Desk no
-- es una lente y no se apaga. Apagar no borra nada: la app deja de enseñar
-- la entrada (navegación, ⌘K, puertas de Desk, enlaces) y la pantalla dice que
-- está apagada; los datos y su RLS siguen igual.
--
-- `workspace_admin_names` dice a un miembro interno a quién pedírselo: los
-- nombres de quien administra el espacio, que la policy de `membership` no le
-- deja leer (solo ve su propia fila).
--
-- Aditiva. Lo escribe un owner/admin por `update_workspace` (o PATCH directo,
-- que la policy `workspace_update` ya limita a owner/admin).
-- Rollback: build/runbooks/rollback-20261018-workspace-lenses.sql.

ALTER TABLE public.workspace
  ADD COLUMN lenses_off text[] NOT NULL DEFAULT '{}'::text[],
  ADD CONSTRAINT workspace_lenses_off_check
    CHECK (lenses_off <@ ARRAY['planner', 'conversations', 'books']::text[]);

COMMENT ON COLUMN public.workspace.lenses_off IS
  'ADR-131: the lenses this workspace does not use (planner | conversations | books). Empty = all on. Hides the entry points in the app, deletes nothing. Owner/admin edit it.';

GRANT UPDATE (lenses_off) ON TABLE public.workspace TO authenticated;

CREATE OR REPLACE FUNCTION public.update_workspace(p_workspace_id uuid, p_patch jsonb)
 RETURNS workspace
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
  v_mode      text := NULLIF(trim(coalesce(p_patch->>'booking_mode', '')), '');
  v_inv_mode  text := NULLIF(trim(coalesce(p_patch->>'invoicing_mode', '')), '');
  v_fid       uuid := NULLIF(trim(coalesce(p_patch->>'fiscal_identity_id', '')), '')::uuid;
  v_settings  jsonb;
  v_lenses    text[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller, ARRAY['owner', 'admin']::public.membership_role[]) THEN
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

  -- ADR-131: las lentes apagadas, un array JSON de ids; null o [] las
  -- enciende todas. Sin repetidos y en orden, para que el valor sea uno.
  IF p_patch ? 'lenses_off' THEN
    IF jsonb_typeof(p_patch->'lenses_off') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'lenses_off must be an array of lens ids'
        USING ERRCODE = '22023';
    END IF;
    v_lenses := ARRAY(
      SELECT DISTINCT l
      FROM jsonb_array_elements_text(coalesce(NULLIF(p_patch->'lenses_off', 'null'::jsonb), '[]'::jsonb)) AS l
      ORDER BY l
    );
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
    trade              = CASE WHEN p_patch ? 'trade'       THEN coalesce(NULLIF(trim(p_patch->>'trade'), ''), 'stage') ELSE w.trade END,
    lenses_off         = CASE WHEN p_patch ? 'lenses_off'  THEN v_lenses                                          ELSE w.lenses_off END,
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
$function$
;

COMMENT ON FUNCTION public.update_workspace(uuid, jsonb) IS
  'Patch a workspace (name, description, accent, domain, city, logo_url, fiscal_identity_id, trade, lenses_off) and settings.booking_mode / invoicing_mode. SECURITY DEFINER; owner/admin only. Only present keys change; "" clears nullable fields; "" or null trade goes back to stage; null or [] lenses_off turns every lens on. ADR-062, ADR-002, ADR-086, ADR-128, ADR-131.';

CREATE OR REPLACE FUNCTION public.workspace_admin_names(p_workspace_id uuid)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT coalesce(NULLIF(trim(up.full_name), ''), NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''))
  FROM public.membership m
  JOIN auth.users au ON au.id = m.user_id
  LEFT JOIN public.user_profile up ON up.user_id = m.user_id
  WHERE public.is_workspace_internal_member(p_workspace_id)
    AND m.level = 'workspace'
    AND m.workspace_id = p_workspace_id
    AND m.accepted_at IS NOT NULL
    AND m.workspace_role IN ('owner', 'admin')
    AND coalesce(NULLIF(trim(up.full_name), ''), NULLIF(trim(au.raw_user_meta_data->>'full_name'), '')) IS NOT NULL
  ORDER BY 1;
$function$;

COMMENT ON FUNCTION public.workspace_admin_names(uuid) IS
  'ADR-131: the names of whoever administers the workspace, for an internal member who finds a lens off. No emails, no roles; nothing for a guest or a stranger.';

REVOKE ALL ON FUNCTION public.workspace_admin_names(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_admin_names(uuid) TO authenticated;
