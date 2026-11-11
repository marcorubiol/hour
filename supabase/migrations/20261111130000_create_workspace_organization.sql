-- 136 · Alta directa de una organización y de una persona con su organización,
-- desde ⌘K, sin conversación.
--
-- Hasta hoy una organización solo nacía dentro de `create_conversation` (o al
-- importar): `authenticated` no tiene INSERT en `workspace_organization`, y el
-- vínculo de un dossier con su organización (`workspace_person.organization_id`)
-- solo lo escribían el alta de una conversación y las fusiones. Aquí:
--   1. `create_workspace_organization`: el permiso de la política
--      `workspace_organization_insert` (owner, admin, member) y las mismas
--      reglas de `update_workspace_organization` (nombre, tipo, ciudad, email);
--      el slug como en el contract de 20261013100000. Un nombre que ya tiene otra
--      organización viva del espacio es 23505: la pantalla abre la existente.
--   2. `set_workspace_person_organization`: el permiso de
--      `create_workspace_person` (`private.can_write_workspace_person`); la
--      organización tiene que ser del mismo espacio, viva y legible por quien
--      llama. NULL la quita.
--
-- Aditiva: dos funciones nuevas, sin tocar firmas existentes. El Worker
-- desplegado no se entera. Rollback:
--   DROP FUNCTION public.create_workspace_organization(uuid, text, text, text, text);
--   DROP FUNCTION public.set_workspace_person_organization(uuid, uuid, uuid);

-- ── 1 · create_workspace_organization ───────────────────────────────────────
CREATE FUNCTION public.create_workspace_organization(
  p_workspace_id uuid,
  p_name         text,
  p_kind         text DEFAULT NULL,
  p_city         text DEFAULT NULL,
  p_email        text DEFAULT NULL
) RETURNS public.workspace_organization
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_kind   text := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'other');
  v_city   text := nullif(btrim(coalesce(p_city, '')), '');
  v_email  extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_id     uuid;
  v_slug   text;
  v_row    public.workspace_organization;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.has_workspace_role(
    p_workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('company', 'festival', 'theatre', 'presenter', 'agency', 'institution', 'solo', 'other') THEN
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
    WHERE o.workspace_id = p_workspace_id AND o.deleted_at IS NULL
      AND lower(btrim(o.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'another organization in this workspace has that name' USING ERRCODE = '23505';
  END IF;

  v_id := public.uuid_generate_v7();
  v_slug := coalesce(nullif(rtrim(left(public.slugify(v_name), 63), '-'), ''), 'organization');
  IF EXISTS (
    SELECT 1 FROM public.workspace_organization o
    WHERE o.workspace_id = p_workspace_id AND o.slug = v_slug AND o.deleted_at IS NULL
  ) THEN
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_id::text, '-', ''), 6);
  END IF;

  INSERT INTO public.workspace_organization (id, workspace_id, slug, name, kind, city, email, created_by)
  VALUES (v_id, p_workspace_id, v_slug, v_name, v_kind, v_city, v_email, v_caller)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.create_workspace_organization(uuid, text, text, text, text) IS
  '136: an organization without a conversation (⌘K). Gate of workspace_organization_insert (owner, admin, member); rules of update_workspace_organization; a name another live organization of the workspace holds is 23505.';
REVOKE ALL ON FUNCTION public.create_workspace_organization(uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_workspace_organization(uuid, text, text, text, text) TO authenticated;

-- ── 2 · set_workspace_person_organization ───────────────────────────────────
CREATE FUNCTION public.set_workspace_person_organization(
  p_workspace_id    uuid,
  p_person_id       uuid,
  p_organization_id uuid
) RETURNS public.workspace_person
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.workspace_person;
BEGIN
  IF auth.uid() IS NULL OR NOT private.can_write_workspace_person(p_workspace_id) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_organization o
    WHERE o.id = p_organization_id AND o.workspace_id = p_workspace_id AND o.deleted_at IS NULL
      AND private.workspace_organization_readable_by_caller(p_workspace_id, o.id)
  ) THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspace_person wp
  SET organization_id = p_organization_id
  WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id AND wp.deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.person_id IS NULL THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.set_workspace_person_organization(uuid, uuid, uuid) IS
  '136: the organization a dossier belongs to. Gate of create_workspace_person; the organization must be of the same workspace, alive and readable by the caller. NULL clears it.';
REVOKE ALL ON FUNCTION public.set_workspace_person_organization(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_workspace_person_organization(uuid, uuid, uuid) TO authenticated;
