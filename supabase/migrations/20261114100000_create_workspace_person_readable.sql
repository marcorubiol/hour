-- 149 · `create_workspace_person` ya no devuelve un dossier que quien llama no lee.
--
-- Hasta aquí, un correo que ya tenía un dossier vivo en el espacio devolvía esa
-- fila entera (nombre, teléfono, cargo, organización...) a cualquiera que pase
-- `private.can_write_workspace_person`, sin mirar la política de lectura de
-- `workspace_person` (ADR-124, 20261018100000): un miembro sin Converses podía
-- leer así la ficha de un contacto del directorio.
--
-- Ahora, si ese dossier no es legible por quien llama
-- (`private.workspace_person_readable_by_caller`, la misma regla que la
-- política SELECT), 42501 sin datos y sin crear un duplicado: el mismo trato
-- que `import_contacts` (138) da a un correo que quien importa no ve. Que el
-- correo está ocupado sigue siendo deducible (también lo dice el 23505 de
-- `update_workspace_person`): un correo es uno por espacio.
--
-- Misma firma, mismo cuerpo salvo el bloque de deduplicación; comentario,
-- grants, SECURITY DEFINER y search_path como en 20261014200000. El Worker no
-- cambia. Rollback: volver a aplicar la función de 20261014200000.

CREATE OR REPLACE FUNCTION public.create_workspace_person(
  p_workspace_id uuid,
  p_full_name    text,
  p_email        text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_title        text DEFAULT NULL
) RETURNS public.workspace_person
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email     extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title     text := nullif(btrim(coalesce(p_title, '')), '');
  v_person_id uuid;
  v_slug      text;
  v_row       public.workspace_person;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.can_write_workspace_person(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) > 60 OR length(v_title) > 200 THEN
    RAISE EXCEPTION 'phone or title is too long' USING ERRCODE = '22023';
  END IF;

  -- Mismo email en el espacio: es la misma persona; se devuelve su dossier,
  -- solo si quien llama lo lee (149). Si no, ni se devuelve ni se duplica.
  IF v_email IS NOT NULL THEN
    SELECT wp.* INTO v_row
    FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.email = v_email AND wp.deleted_at IS NULL
    ORDER BY wp.created_at, wp.person_id
    LIMIT 1;
    IF v_row.person_id IS NOT NULL THEN
      IF NOT private.workspace_person_readable_by_caller(p_workspace_id, v_row.person_id) THEN
        RAISE EXCEPTION 'person not readable' USING ERRCODE = '42501';
      END IF;
      RETURN v_row;
    END IF;
  END IF;

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
    WHERE wp.workspace_id = p_workspace_id AND wp.slug = v_slug AND wp.deleted_at IS NULL
  ) THEN
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_person_id::text, '-', ''), 6);
  END IF;
  INSERT INTO public.workspace_person (
    workspace_id, person_id, slug, full_name, email, phone, title, created_by
  ) VALUES (
    p_workspace_id, v_person_id, v_slug, v_full_name, v_email, v_phone, v_title, v_caller
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
