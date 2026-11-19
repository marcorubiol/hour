-- Rollback de 20261119110000_project_preparation: `update_project` vuelve a su
-- cuerpo anterior (sin la clave `preparation`). No borra datos: las listas ya
-- guardadas siguen en `project.custom_fields.preparation` y la app, sin la
-- migración, no las puede cambiar (las lee igualmente; para quitarlas:
-- UPDATE public.project SET custom_fields = custom_fields - 'preparation';).

BEGIN;

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

  UPDATE public.project p SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                   ELSE p.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '') ELSE p.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')     ELSE p.accent      END,
    initials    = CASE WHEN p_patch ? 'initials'    THEN NULLIF(trim(p_patch->>'initials'), '')   ELSE p.initials    END,
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

COMMIT;
