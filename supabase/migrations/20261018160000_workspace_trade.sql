-- ADR-128 § 2 · el oficio del espacio: unas pocas etiquetas cambian con él.
--
-- `workspace.trade` dice con qué palabras habla el espacio: `stage` (escena:
-- teatro, danza, circo, títeres, calle; por defecto) o `music` (música en
-- directo). No cambia el modelo (conversation, performance y bolo siguen
-- igual por dentro): la app elige la variante `clave@<oficio>` del
-- diccionario cuando existe. Añadir un tercer oficio es ampliar el CHECK,
-- la lista `TRADES` de la app y escribir sus variantes.
--
-- Aditiva. Lo escribe un owner/admin por `update_workspace` (o PATCH directo,
-- que la policy `workspace_update` ya limita a owner/admin). '' o null
-- vuelve al defecto. Rollback: build/runbooks/rollback-20261018-workspace-trade.sql.

ALTER TABLE public.workspace
  ADD COLUMN trade text NOT NULL DEFAULT 'stage',
  ADD CONSTRAINT workspace_trade_check CHECK (trade IN ('stage', 'music'));

COMMENT ON COLUMN public.workspace.trade IS
  'ADR-128: the trade whose words the app speaks in this workspace (stage | music). Picks the clave@<trade> variants of the i18n dictionaries; the model is unchanged. Owner/admin edit it.';

-- Un espacio que ya se dijo de música habla como música desde el primer día.
UPDATE public.workspace SET trade = 'music' WHERE domain = 'music' AND deleted_at IS NULL;

-- El grant de UPDATE va por columnas desde 20261015100000_mailout: la nueva
-- entra igual que `domain`.
GRANT UPDATE (trade) ON TABLE public.workspace TO authenticated;

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
  'Patch a workspace (name, description, accent, domain, city, logo_url, fiscal_identity_id, trade) and settings.booking_mode / invoicing_mode. SECURITY DEFINER; owner/admin only. Only present keys change; "" clears nullable fields; "" or null trade goes back to stage. ADR-062, ADR-002, ADR-086, ADR-128.';
