-- Comms, carril 2, fase 2, paso 0: un guest no escribe tareas ni bloques de
-- disponibilidad del espacio.
--
-- El hueco que dejó la fase 1 (20261022100000_bolo_membership): desde ella un
-- no admin puede dejar a alguien como `guest` en el espacio (la invitación de
-- bolo). Un guest NO LEE `task` ni `availability_block` (sus SELECT piden
-- `is_workspace_internal_member` desde ADR-104), pero sí podía escribirlas,
-- porque INSERT, UPDATE y las cuatro RPC pedían `is_workspace_member`, que
-- cuenta cualquier rol, guest incluido. Un UPDATE ciego por PostgREST (sin
-- WHERE que lea columnas) pasaba solo con la política de UPDATE: el técnico de
-- una noche podía reescribir todas las tareas del espacio sin verlas.
--
-- Qué decide: un guest no toca nada de las dos tablas, ni lo suyo. «Solo lo
-- suyo» no encaja: no puede leerlo (no vería la tarea que acaba de crear) y
-- ninguna pantalla de un guest las enseña. Es el mismo corte que la fase 1
-- hizo con `venue_insert` y `venue_update`. ADR-100 § 1 (ver la producción es
-- el acceso al contenedor; una tarea del espacio no es de ningún contenedor
-- que el guest tenga), ADR-104 (guest fuera de los directorios del espacio),
-- ADR-105.
--
-- Para owner, admin, member y viewer no cambia nada: `is_workspace_internal_member`
-- es `is_workspace_member` menos `guest`. Las notas (`note_*`) no se tocan:
-- son del autor (ADR-093), un guest solo toca las suyas.
--
-- Políticas que cambian, con el texto vivo de `pg_policies` (2026-10-22):
--   task_insert, task_update, availability_block_insert, availability_block_update.
-- Funciones que se redefinen, firma y cuerpo copiados de la base viva con
-- `pg_get_functiondef` (2026-10-22); solo cambia la guarda de membresía:
--   · public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid)
--   · public.delete_task(uuid)
--   · public.create_availability_block(uuid, date, date, uuid, text, text)
--   · public.delete_availability_block(uuid)
-- Grants: CREATE OR REPLACE conserva los de la base viva; se vuelven a
-- escribir explícitos abajo (EXECUTE a authenticated, nunca a anon).
--
-- Gate § 34: estrecha cuatro escrituras que hoy nadie usa (0 guests en
-- producción, SELECT 2026-10-22: solo owners, y un member y una membresía de
-- proyecto en `playwright`). Los pasos 0 y 4 hacen la foto de qué lee y qué
-- escribe cada membresía de cada espacio real y abortan si cambia.
-- Rollback: build/runbooks/rollback-20261022150000-guest-no-task-availability-writes.sql.

-- ── 0 · foto de antes ────────────────────────────────────────────────────
-- `playwright` queda fuera: la suite cambia el rol de su fixture a guest y
-- vuelta (limited-role, guest-writes), y no hay datos de nadie.
CREATE TEMP TABLE guest_writes_access_before ON COMMIT DROP AS
SELECT m.id AS membership_id,
       (SELECT count(*) FROM public.task t
        WHERE t.workspace_id = w.id AND t.deleted_at IS NULL
          AND private.model_has_workspace_role(t.workspace_id, m.user_id,
                ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])) AS tasks_read,
       (SELECT count(*) FROM public.availability_block a
        WHERE a.workspace_id = w.id AND a.deleted_at IS NULL
          AND private.model_has_workspace_role(a.workspace_id, m.user_id,
                ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])) AS blocks_read,
       private.model_has_workspace_role(w.id, m.user_id) AS writes
FROM public.membership m
JOIN public.workspace w ON w.id = m.workspace_id
WHERE w.slug <> 'playwright';

-- ── 1 · políticas ────────────────────────────────────────────────────────
-- Texto vivo de pg_policies con is_workspace_member → is_workspace_internal_member.
DROP POLICY task_insert ON public.task;
CREATE POLICY task_insert ON public.task
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = current_workspace_id())
              AND is_workspace_internal_member(workspace_id)
              AND (created_by = (SELECT auth.uid() AS uid)));

DROP POLICY task_update ON public.task;
CREATE POLICY task_update ON public.task
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_internal_member(workspace_id))
  WITH CHECK (is_workspace_internal_member(workspace_id));

DROP POLICY availability_block_insert ON public.availability_block;
CREATE POLICY availability_block_insert ON public.availability_block
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id = current_workspace_id())
              AND is_workspace_internal_member(workspace_id)
              AND (created_by = (SELECT auth.uid() AS uid)));

DROP POLICY availability_block_update ON public.availability_block;
CREATE POLICY availability_block_update ON public.availability_block
  FOR UPDATE TO authenticated
  USING ((deleted_at IS NULL) AND is_workspace_internal_member(workspace_id))
  WITH CHECK (is_workspace_internal_member(workspace_id));

-- ── 2 · RPC ──────────────────────────────────────────────────────────────
-- Cuerpos de la base viva (2026-10-22); solo cambia la guarda.
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

  -- 20261022150000: un guest no crea tareas (no las lee).
  IF v_workspace_id IS NULL OR NOT public.is_workspace_internal_member(v_workspace_id) THEN
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

  -- 20261022150000: un guest no borra tareas.
  IF v_workspace_id IS NULL OR NOT public.is_workspace_internal_member(v_workspace_id) THEN
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

  -- 20261022150000: un guest no crea bloques de disponibilidad (no los lee).
  IF p_workspace_id IS NULL OR NOT public.is_workspace_internal_member(p_workspace_id) THEN
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

  -- 20261022150000: un guest no borra bloques de disponibilidad.
  IF v_workspace_id IS NULL OR NOT public.is_workspace_internal_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'availability block not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.availability_block SET deleted_at = now()
  WHERE id = p_availability_block_id AND deleted_at IS NULL;
END;
$function$;

-- ── 3 · grants explícitos ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, date, date, integer, uuid, uuid, uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_task(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_availability_block(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_availability_block(uuid) TO authenticated;
-- Tablas: los grants por columnas de task y availability_block no cambian
-- (INSERT, SELECT, UPDATE a authenticated); las políticas deciden quién.

-- ── 4 · foto de después ──────────────────────────────────────────────────
DO $$
DECLARE
  v_changed int;
BEGIN
  SELECT count(*) INTO v_changed
  FROM guest_writes_access_before b
  JOIN public.membership m ON m.id = b.membership_id
  JOIN public.workspace w ON w.id = m.workspace_id
  WHERE b.tasks_read IS DISTINCT FROM (
          SELECT count(*) FROM public.task t
          WHERE t.workspace_id = w.id AND t.deleted_at IS NULL
            AND private.model_has_workspace_role(t.workspace_id, m.user_id,
                  ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[]))
     OR b.blocks_read IS DISTINCT FROM (
          SELECT count(*) FROM public.availability_block a
          WHERE a.workspace_id = w.id AND a.deleted_at IS NULL
            AND private.model_has_workspace_role(a.workspace_id, m.user_id,
                  ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[]))
     OR b.writes IS DISTINCT FROM private.model_has_workspace_role(w.id, m.user_id,
                  ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[]);
  IF v_changed > 0 THEN
    RAISE EXCEPTION 'guest_no_task_availability_writes: % memberships would read or write tasks or availability differently', v_changed;
  END IF;
END;
$$;
