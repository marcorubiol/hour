-- ADR-102, fase 2: «Añadir como contacto» desde el alta.
--
-- Cuando el alta de una conversación con una persona choca con la que ya
-- tiene su organización en el proyecto (el 409 de `create_conversation`), la
-- pantalla ofrece añadir a esa persona como contacto de la que ya existe. La
-- persona puede no tener dossier todavía (el alta en línea se deshizo con el
-- 409), así que esta RPC lo busca por correo o lo crea, como el alta, y la
-- añade de contacto.
--
-- Aditiva: una función nueva. Gate igual que `set_conversation_contact`
-- (`edit:conversation` sobre una conversación que quien llama ve; si no,
-- 42501). Si la conversación aún no tiene principal, la persona lo es.
-- Rollback: build/runbooks/rollback-20261011-conversation-contact-inline.sql.

CREATE FUNCTION public.add_conversation_contact(
  p_conversation_id uuid,
  p_full_name       text,
  p_email           text DEFAULT NULL,
  p_phone           text DEFAULT NULL,
  p_role            text DEFAULT NULL
) RETURNS public.conversation_contact
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_conv      public.conversation := public.conversation_for_contact_write(p_conversation_id);
  v_caller    uuid := auth.uid();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email     extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_person_id uuid;
  v_slug      text;
BEGIN
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT wp.person_id INTO v_person_id
    FROM public.workspace_person wp
    WHERE wp.workspace_id = v_conv.workspace_id AND wp.email = v_email AND wp.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_person_id IS NULL THEN
    v_person_id := public.uuid_generate_v7();
    INSERT INTO public.person (id, slug, full_name, email, created_by)
    VALUES (
      v_person_id,
      'person-' || right(replace(v_person_id::text, '-', ''), 12),
      'Person ' || right(replace(v_person_id::text, '-', ''), 8),
      NULL,
      v_caller
    );
    v_slug := coalesce(nullif(rtrim(left(public.slugify(v_full_name), 63), '-'), ''), 'person');
    IF EXISTS (
      SELECT 1 FROM public.workspace_person wp
      WHERE wp.workspace_id = v_conv.workspace_id AND wp.slug = v_slug AND wp.deleted_at IS NULL
    ) THEN
      v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_person_id::text, '-', ''), 6);
    END IF;
    INSERT INTO public.workspace_person (
      workspace_id, person_id, slug, full_name, email, phone, organization_id, created_by
    ) VALUES (
      v_conv.workspace_id, v_person_id, v_slug, v_full_name, v_email,
      nullif(btrim(coalesce(p_phone, '')), ''), v_conv.organization_id, v_caller
    );
  END IF;

  -- La persona ya es contacto vigente: no se rehace nada (ni papel ni fechas).
  IF EXISTS (
    SELECT 1 FROM public.conversation_contact
    WHERE conversation_id = v_conv.id AND person_id = v_person_id AND until IS NULL
  ) THEN
    RETURN (SELECT cc FROM public.conversation_contact cc
            WHERE cc.conversation_id = v_conv.id AND cc.person_id = v_person_id);
  END IF;

  -- Un contacto cerrado vuelve con su `since` y, si no llega otro, su papel.
  RETURN public.set_conversation_contact(
    v_conv.id, v_person_id,
    coalesce(nullif(btrim(coalesce(p_role, '')), ''),
             (SELECT role FROM public.conversation_contact
              WHERE conversation_id = v_conv.id AND person_id = v_person_id)),
    (SELECT since FROM public.conversation_contact
     WHERE conversation_id = v_conv.id AND person_id = v_person_id),
    v_conv.person_id IS NULL
  );
END;
$$;
ALTER FUNCTION public.add_conversation_contact(uuid, text, text, text, text) OWNER TO postgres;
COMMENT ON FUNCTION public.add_conversation_contact(uuid, text, text, text, text) IS
  'ADR-102: add a person (found by email in the workspace, or created) as a contact of a conversation; primary if it has none. Already a current contact: returned unchanged. Gate: edit:conversation on a conversation the caller sees; otherwise 42501.';
REVOKE ALL ON FUNCTION public.add_conversation_contact(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_conversation_contact(uuid, text, text, text, text) TO authenticated;
