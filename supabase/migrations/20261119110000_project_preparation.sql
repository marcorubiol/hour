-- «Qué preparamos para una función»: la lista de cada proyecto (ADR-221, fase 2).
--
-- La lista vive en `project.custom_fields.preparation` (JSON, sin columna nueva):
--   { "items": [ { "id": "status", "on": true }, … ] }
-- `update_project` aprende una clave más en su parche, `preparation`: guarda ese
-- objeto bajo esa clave y conserva el resto de `custom_fields`. `null` borra la
-- lista (el proyecto vuelve a la de serie). Mismo permiso que el resto del parche
-- (owner, admin o member del espacio); no cambia ninguna política ni grant.
--
-- Aditiva: CREATE OR REPLACE con la firma y el cuerpo de la base viva
-- (20261011300000) más la clave nueva. La forma exacta de los ítems la valida la
-- app; la base solo exige un objeto con `items` array (22023 si no).
-- Rollback: build/runbooks/rollback-20261119-project-preparation.sql (las listas
-- ya guardadas se quedan en custom_fields y la app las ignora hasta volver a aplicar).

CREATE OR REPLACE FUNCTION public.update_project(p_project_id uuid, p_patch jsonb)
 RETURNS project
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_project public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.membership m ON m.workspace_id = p.workspace_id AND m.level = 'workspace'
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND m.user_id     = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.workspace_role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'preparation'
     AND jsonb_typeof(p_patch->'preparation') <> 'null'
     AND (jsonb_typeof(p_patch->'preparation') <> 'object'
          OR jsonb_typeof(p_patch->'preparation'->'items') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'preparation must be an object with an items array' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project p SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                   ELSE p.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '') ELSE p.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')     ELSE p.accent      END,
    initials    = CASE WHEN p_patch ? 'initials'    THEN NULLIF(trim(p_patch->>'initials'), '')   ELSE p.initials    END,
    custom_fields = CASE
      WHEN NOT (p_patch ? 'preparation') THEN p.custom_fields
      WHEN jsonb_typeof(p_patch->'preparation') = 'null' THEN coalesce(p.custom_fields, '{}'::jsonb) - 'preparation'
      ELSE coalesce(p.custom_fields, '{}'::jsonb) || jsonb_build_object('preparation', p_patch->'preparation')
    END,
    updated_at  = now()
  WHERE p.id = p_project_id AND p.deleted_at IS NULL
  RETURNING * INTO v_project;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_project;
END;
$function$
;
