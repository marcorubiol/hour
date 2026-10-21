-- Borrado lógico de organización y de persona del espacio, por RPC.
--
-- Hoy no hay forma de quitar una `workspace_organization` ni un
-- `workspace_person`: `authenticated` no tiene UPDATE en ninguna de las dos
-- (las políticas de UPDATE existen, pero sin grant no sirven) y toda escritura
-- va por RPC. Los specs E2E acumulan unas 12 por pasada en `playwright`; el
-- 21-10 se ocultaron a mano 204 organizaciones y 164 personas `E2E*`.
--
-- Regla ADR-048: un borrado lógico nunca va por PATCH del cliente, va por RPC.
--
-- Quién: dueño, admin o miembro del espacio (lo mismo que dicen las políticas
-- de UPDATE de las dos tablas). Un rol limitado de proyecto no borra el
-- directorio del espacio.
--
-- Qué se niega (23503, la pantalla lo dice 409): borrar lo que algo vivo usa.
--   · organización: una conversación viva o una factura viva que la tiene de
--     pagadora;
--   · persona: el contacto de una conversación viva, reparto, equipo, una
--     sustitución o una indisponibilidad vivos, o el perfil de una cuenta
--     (`user_profile.person_id`: es quien entra, no un contacto).
-- Lo que no existe, ya está borrado o no es de quien llama: 42501, sin decir
-- cuál de las tres.
--
-- Aditiva: dos RPC. Sin datos. Deshacer un borrado: `deleted_at = null`.
-- Rollback: `build/runbooks/rollback-20261021-delete-organization-person.sql`.

-- ── delete_workspace_organization ────────────────────────────────────────────
CREATE FUNCTION public.delete_workspace_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org public.workspace_organization;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org
  FROM public.workspace_organization
  WHERE id = p_organization_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_org.id IS NULL OR NOT private.has_workspace_role(
    v_org.workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversation c
    WHERE c.workspace_id = v_org.workspace_id AND c.organization_id = v_org.id
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'organization has live conversations' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.workspace_id = v_org.workspace_id AND i.payer_organization_id = v_org.id
      AND i.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'organization pays live invoices' USING ERRCODE = '23503';
  END IF;

  UPDATE public.workspace_organization SET deleted_at = now() WHERE id = v_org.id;
END;
$$;

COMMENT ON FUNCTION public.delete_workspace_organization(uuid) IS
  'Soft-delete an organization of the workspace (owner, admin or member). Refuses (23503) while a live conversation or invoice uses it. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.delete_workspace_organization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_workspace_organization(uuid) TO authenticated;

-- ── delete_workspace_person ──────────────────────────────────────────────────
-- El dossier del espacio; la persona global (`person`) no se toca.
CREATE FUNCTION public.delete_workspace_person(p_workspace_id uuid, p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.workspace_person wp
  WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id
    AND wp.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT private.has_workspace_role(
    p_workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profile up WHERE up.person_id = p_person_id
  ) THEN
    RAISE EXCEPTION 'person is an account' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conversation_contact cc
    JOIN public.conversation c ON c.id = cc.conversation_id
    WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id
      AND c.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.cast_member m
    WHERE m.workspace_id = p_workspace_id AND m.person_id = p_person_id AND m.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.crew_assignment a
    WHERE a.workspace_id = p_workspace_id AND a.person_id = p_person_id AND a.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.cast_override o
    WHERE o.workspace_id = p_workspace_id
      AND (o.person_id = p_person_id OR o.replaces_person_id = p_person_id)
      AND o.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.availability_block b
    WHERE b.workspace_id = p_workspace_id AND b.person_id = p_person_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person is in use' USING ERRCODE = '23503';
  END IF;

  UPDATE public.workspace_person SET deleted_at = now()
  WHERE workspace_id = p_workspace_id AND person_id = p_person_id;
END;
$$;

COMMENT ON FUNCTION public.delete_workspace_person(uuid, uuid) IS
  'Soft-delete a person''s dossier in the workspace (owner, admin or member). Refuses (23503) while a live conversation, cast, crew, override or availability uses it, or while it is an account''s identity. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.delete_workspace_person(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_workspace_person(uuid, uuid) TO authenticated;
