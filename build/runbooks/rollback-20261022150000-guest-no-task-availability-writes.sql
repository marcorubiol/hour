-- Rollback de 20261022150000_guest_no_task_availability_writes.
-- Devuelve las cuatro políticas (task_insert, task_update,
-- availability_block_insert, availability_block_update) y las cuatro RPC
-- (create_task, delete_task, create_availability_block,
-- delete_availability_block) a su texto vivo del 2026-10-22: la guarda vuelve
-- a ser is_workspace_member y un guest vuelve a poder escribir tareas y
-- bloques del espacio sin leerlos (el hueco que cerraba). No hay datos que
-- migrar: la migración no añade columnas ni filas.
-- Probado en local dentro de una transacción con ROLLBACK (2026-10-22):
-- migración, rollback y comprobación de que pg_policies y pg_get_functiondef
-- vuelven al texto de antes.

BEGIN;

-- ── políticas (texto vivo de pg_policies, 2026-10-22) ────────────────────
DROP POLICY task_insert ON public.task;
CREATE POLICY task_insert ON public.task
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = current_workspace_id())
              AND is_workspace_member(workspace_id)
              AND (created_by = (SELECT auth.uid() AS uid)));

DROP POLICY task_update ON public.task;
CREATE POLICY task_update ON public.task
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY availability_block_insert ON public.availability_block;
CREATE POLICY availability_block_insert ON public.availability_block
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = current_workspace_id())
              AND is_workspace_member(workspace_id)
              AND (created_by = (SELECT auth.uid() AS uid)));

DROP POLICY availability_block_update ON public.availability_block;
CREATE POLICY availability_block_update ON public.availability_block
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- ── RPC: cuerpo vivo de pg_get_functiondef (2026-10-22), guarda is_workspace_member ──
CREATE OR REPLACE FUNCTION public.create_task(p_title text, p_note text DEFAULT NULL::text, p_due_at date DEFAULT NULL::date, p_from_at date DEFAULT NULL::date, p_lead_days integer DEFAULT NULL::integer, p_workspace_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_line_id uuid DEFAULT NULL::uuid, p_performance_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS task
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_title        text := nullif(btrim(coalesce(p_title, '')), '');
  v_workspace_id uuid;
  v_parents      int  := num_nonnulls(p_project_id, p_line_id, p_performance_id, p_conversation_id);
  v_task         public.task;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_parents > 1 THEN
    RAISE EXCEPTION 'at most one of project_id / line_id / performance_id / conversation_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_parents = 1 AND p_workspace_id IS NOT NULL THEN
    RAISE EXCEPTION 'workspace_id only applies to a task with no parent'
      USING ERRCODE = '22023';
  END IF;

  IF v_parents = 0 AND p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required for a task with no parent'
      USING ERRCODE = '22023';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_lead_days IS NOT NULL AND (p_lead_days < 0 OR p_lead_days > 365) THEN
    RAISE EXCEPTION 'lead_days must be between 0 and 365' USING ERRCODE = '22023';
  END IF;

  IF p_from_at IS NOT NULL AND p_due_at IS NOT NULL AND p_from_at > p_due_at THEN
    RAISE EXCEPTION 'from_at cannot be after due_at' USING ERRCODE = '22023';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;
  ELSIF p_line_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
  ELSIF p_performance_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  ELSIF p_conversation_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.conversation WHERE id = p_conversation_id AND deleted_at IS NULL;
  ELSE
    v_workspace_id := p_workspace_id;
  END IF;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.task (
    workspace_id, project_id, line_id, performance_id, conversation_id,
    title, note, due_at, from_at, lead_days, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id, p_conversation_id,
    v_title, nullif(btrim(coalesce(p_note, '')), ''), p_due_at, p_from_at,
    p_lead_days, v_caller
  )
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.task
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'task not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.task SET deleted_at = now()
  WHERE id = p_task_id AND deleted_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_availability_block(p_workspace_id uuid, p_starts_on date, p_ends_on date, p_person_id uuid DEFAULT NULL::uuid, p_certainty text DEFAULT 'unavailable'::text, p_note text DEFAULT NULL::text)
 RETURNS availability_block
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_block  public.availability_block;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_starts_on IS NULL OR p_ends_on IS NULL THEN
    RAISE EXCEPTION 'starts_on and ends_on are required' USING ERRCODE = '22023';
  END IF;

  IF p_ends_on < p_starts_on THEN
    RAISE EXCEPTION 'ends_on must be on or after starts_on' USING ERRCODE = '22023';
  END IF;

  IF p_certainty IS NULL OR p_certainty NOT IN ('unavailable', 'tentative') THEN
    RAISE EXCEPTION 'certainty must be unavailable or tentative' USING ERRCODE = '22023';
  END IF;

  IF p_workspace_id IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '42501';
  END IF;

  -- Person is a GLOBAL entity — visibility gate is can_see_person.
  IF p_person_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.person
      WHERE id = p_person_id AND deleted_at IS NULL
    ) OR NOT public.can_see_person(p_person_id) THEN
      RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.availability_block (
    workspace_id, person_id, starts_on, ends_on, certainty, note, created_by
  ) VALUES (
    p_workspace_id, p_person_id, p_starts_on, p_ends_on, p_certainty,
    nullif(btrim(coalesce(p_note, '')), ''), v_caller
  )
  RETURNING * INTO v_block;

  RETURN v_block;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_availability_block(p_availability_block_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.availability_block
  WHERE id = p_availability_block_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'availability block not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.availability_block SET deleted_at = now()
  WHERE id = p_availability_block_id AND deleted_at IS NULL;
END;
$function$;

-- ── grants (los de la base viva: EXECUTE a authenticated) ──────────────
REVOKE ALL ON FUNCTION public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_task(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_availability_block(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_availability_block(uuid) TO authenticated;

COMMIT;
