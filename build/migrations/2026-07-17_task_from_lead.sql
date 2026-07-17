-- ADR-070: task model v1 — anytime / from / due+lead. Two columns on task:
-- · from_at    — the task sleeps (dormant) until this day; at the date it
--               surfaces on its own (Marco's `@from:` semantics).
-- · lead_days  — "at most how many days before due it becomes urgent".
--               Never required: the AI proposes it (ADR-069), the human
--               corrects. Urgency is always DERIVED, never stored — the
--               surfacing rule max(from_at, due_at − lead_days) lives in
--               $lib/task.ts (taskSurfaceState), not in the schema.
--
-- create_task is re-created with the two new params. Postgres would treat
-- a changed signature as an OVERLOAD (the 2026-07-12 lesson: no overloads,
-- PostgREST refuses ambiguous RPC names) — so DROP first, then CREATE, then
-- re-apply the grant discipline (REVOKE from PUBLIC strips the default
-- EXECUTE a bare anon revoke leaves in place).
--
-- Applied 2026-07-17 via Supabase MCP apply_migration (name: task_from_lead).
-- This file is the canonical record.

ALTER TABLE public.task
  ADD COLUMN from_at   timestamptz,
  ADD COLUMN lead_days smallint;

ALTER TABLE public.task
  ADD CONSTRAINT task_lead_days_gte_zero CHECK (lead_days IS NULL OR lead_days >= 0),
  ADD CONSTRAINT task_from_before_due CHECK (
    from_at IS NULL OR due_at IS NULL OR from_at <= due_at
  );

COMMENT ON COLUMN public.task.from_at IS
  'Date-only contract at the API (YYYY-MM-DD). Dormant until this day — the Desk never renders it before (ADR-070).';
COMMENT ON COLUMN public.task.lead_days IS
  'How many days before due_at the task turns urgent. AI-proposed, human-corrected, never required (ADR-069/070). Urgency is derived at read time, never stored.';

DROP FUNCTION public.create_task(text, text, date, uuid, uuid, uuid, uuid, uuid);

CREATE FUNCTION public.create_task(
  p_title text,
  p_note text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
  p_from_at date DEFAULT NULL,
  p_lead_days int DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_line_id uuid DEFAULT NULL,
  p_performance_id uuid DEFAULT NULL,
  p_engagement_id uuid DEFAULT NULL
)
RETURNS public.task
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_title        text := nullif(btrim(coalesce(p_title, '')), '');
  v_workspace_id uuid;
  v_parents      int  := num_nonnulls(p_project_id, p_line_id, p_performance_id, p_engagement_id);
  v_task         public.task;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_parents > 1 THEN
    RAISE EXCEPTION 'at most one of project_id / line_id / performance_id / engagement_id'
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

  -- Resolve the workspace from the live parent, or take it verbatim for a
  -- free task.
  IF p_project_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;
  ELSIF p_line_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
  ELSIF p_performance_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  ELSIF p_engagement_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.engagement WHERE id = p_engagement_id AND deleted_at IS NULL;
  ELSE
    v_workspace_id := p_workspace_id;
  END IF;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.task (
    workspace_id, project_id, line_id, performance_id, engagement_id,
    title, note, due_at, from_at, lead_days, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id, p_engagement_id,
    v_title, nullif(btrim(coalesce(p_note, '')), ''), p_due_at, p_from_at,
    p_lead_days, v_caller
  )
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$function$;

COMMENT ON FUNCTION public.create_task(text, text, date, date, int, uuid, uuid, uuid, uuid, uuid) IS
  'Create a task (ADR-068/070). At most one parent; workspace derived from the parent, or p_workspace_id (member-gated) for a free task. origin is always manual here — protocol/ai writers arrive with their own paths.';

REVOKE ALL ON FUNCTION public.create_task(text, text, date, date, int, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, date, date, int, uuid, uuid, uuid, uuid, uuid) TO authenticated;
