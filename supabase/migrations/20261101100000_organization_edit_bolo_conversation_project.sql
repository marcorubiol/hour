-- Editar la organización desde su ficha, y `create_bolo` que no cuelga un
-- trato de una conversación de otro proyecto (_tasks.md § 64).
--
-- 1. `update_workspace_organization`. La ficha (ADR-159) lee nombre, tipo,
--    ciudad y correo y no deja cambiarlos: `authenticated` sólo tiene SELECT
--    en `workspace_organization` (la política de UPDATE existe, sin grant no
--    sirve) y toda escritura va por RPC, como `update_workspace_person`.
--    Quién: dueño, admin o miembro del espacio (lo mismo que
--    `delete_workspace_organization` y la política de UPDATE) y, además, que
--    la lea (`workspace_organization_readable_by_caller`, ADR-124): una sala
--    que sólo existe por la conversación privada de otro no se edita, igual
--    que no se ve. Lo que no existe, está borrado, es de otro espacio o no se
--    ve: 42501, sin decir cuál. El slug no cambia: es la URL. Todos los campos
--    llegan siempre; NULL o vacío borra (salvo el nombre; un tipo vacío vuelve
--    a `other`). Un nombre que ya tiene otra organización viva del espacio:
--    23505 (el índice `workspace_organization_name_key` lo diría igual, con
--    otro texto).
--
-- 2. `create_bolo` sólo comprobaba que la conversación fuera del mismo
--    ESPACIO. Un bolo de A colgado de una conversación de B cruza el dinero de
--    un proyecto con la difusión de otro. Ahora, si llega `p_conversation_id`,
--    la conversación es del mismo PROYECTO que el bolo (42501, el mismo texto
--    para «no existe» y «es de otro»). Firma idéntica a la viva: CREATE OR
--    REPLACE, sin sobrecarga. La firma sale de `20260829140000`, la última
--    migración que la define; el gate la confirma con `pg_get_functiondef`
--    antes del apply.
--
-- Aditiva: una RPC nueva y el cuerpo de otra. Sin datos. Un bolo que ya cuelga
-- de una conversación de otro proyecto se queda como está.
-- Rollback: `DROP FUNCTION public.update_workspace_organization(uuid, text, text, text, text);`
-- y volver a aplicar el `create_bolo` de `20260829140000`.

-- ── 1 · update_workspace_organization ────────────────────────────────────────
CREATE FUNCTION public.update_workspace_organization(
  p_organization_id uuid,
  p_name            text,
  p_kind            text DEFAULT NULL,
  p_city            text DEFAULT NULL,
  p_email           text DEFAULT NULL
) RETURNS public.workspace_organization
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_kind  text := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'other');
  v_city  text := nullif(btrim(coalesce(p_city, '')), '');
  v_email extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_org   public.workspace_organization;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org
  FROM public.workspace_organization
  WHERE id = p_organization_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_org.id IS NULL
     OR NOT private.has_workspace_role(
       v_org.workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]
     )
     OR NOT private.workspace_organization_readable_by_caller(v_org.workspace_id, v_org.id)
  THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('company', 'festival', 'theatre', 'presenter', 'agency', 'institution', 'other') THEN
    RAISE EXCEPTION 'kind is not valid' USING ERRCODE = '22023';
  END IF;
  IF length(v_city) > 120 THEN
    RAISE EXCEPTION 'city is too long' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND (length(v_email::text) > 320 OR v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_organization o
    WHERE o.workspace_id = v_org.workspace_id AND o.id <> v_org.id AND o.deleted_at IS NULL
      AND lower(btrim(o.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'another organization in this workspace has that name' USING ERRCODE = '23505';
  END IF;

  UPDATE public.workspace_organization
  SET name = v_name, kind = v_kind, city = v_city, email = v_email
  WHERE id = v_org.id
  RETURNING * INTO v_org;
  RETURN v_org;
END;
$function$;

COMMENT ON FUNCTION public.update_workspace_organization(uuid, text, text, text, text) IS
  'ADR-159: edit an organization''s name, kind, city and email from its file. Owner, admin or member of the workspace who can read it (42501 otherwise, one message). A name another live organization of the workspace holds is 23505. SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.update_workspace_organization(uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_workspace_organization(uuid, text, text, text, text) TO authenticated;

-- ── 2 · create_bolo: la conversación, del mismo proyecto ─────────────────────
-- Cuerpo de 20260829140000 con un solo cambio: el filtro de la conversación
-- pasa de `workspace_id = v_workspace_id` a `project_id = p_project_id`.
CREATE OR REPLACE FUNCTION public.create_bolo(p_project_id uuid, p_venue_name text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_fee_amount numeric DEFAULT NULL::numeric, p_fee_currency text DEFAULT 'EUR'::text, p_line_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid, p_status performance_status DEFAULT 'confirmed'::performance_status)
 RETURNS bolo
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_currency     text := upper(coalesce(nullif(btrim(p_fee_currency), ''), 'EUR'));
  v_country      text := upper(nullif(btrim(p_country), ''));
  v_bolo         public.bolo;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;

  -- Un trato no se abre muerto, ni acabado, ni facturado: ver la cabecera de
  -- 20260829140000. Hasta hoy `p_status` aceptaba cualquier palabra del enum,
  -- y la API ni siquiera lo pasaba.
  IF NOT public.bolo_status_can_open(coalesce(p_status, 'confirmed')) THEN
    RAISE EXCEPTION 'a bolo opens as proposed, hold, hold_1..3 or confirmed'
      USING ERRCODE = '22023';
  END IF;

  IF v_workspace_id IS NULL OR NOT public.has_permission(p_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'project not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line is not in the project' USING ERRCODE = '42501';
  END IF;

  -- La conversación es del proyecto del bolo, no sólo del espacio (§ 64):
  -- el trato de A no cuelga de la difusión de B.
  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation is not in the project' USING ERRCODE = '42501';
  END IF;

  IF p_fee_amount IS NOT NULL AND (p_fee_amount < 0 OR p_fee_amount > 9999999999.99) THEN
    RAISE EXCEPTION 'fee amount out of range' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'fee currency must be an ISO 4217 code' USING ERRCODE = '22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be a 2-letter code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bolo (
    workspace_id, project_id, line_id, conversation_id,
    venue_name, city, country, fee_amount, fee_currency, status, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_conversation_id,
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    v_country,
    p_fee_amount,
    v_currency::character(3),
    coalesce(p_status, 'confirmed'),
    v_caller
  ) RETURNING * INTO v_bolo;

  RETURN v_bolo;
END;
$function$;
