-- ADR-068: task entity (D3) — manual tasks v1. The verb layer of the
-- structure model (build/structure-model.md): polymorphic — a task attaches
-- to project / line / performance / engagement (at MOST one; all NULL = a
-- free workspace-level task). `origin` manual|protocol|ai per the D3 spec;
-- only 'manual' ships — protocol chains (ADR-011) are Phase 0.5, ai is
-- Phase 1+. The D1 taxonomy (dispatch/queue/ping/deferred/shelf/trace) and
-- tags stay deferred with D1.
--
-- Access model: workspace-scoped (the venue / person_note family, NOT
-- has_permission) — any accepted member of the workspace reads and edits
-- its tasks. Rationale: tasks are cross-domain verbs (a booking task, a
-- production task and a free to-do are one entity), every parent-mapped
-- permission scheme needs a project the free task doesn't have, and Phase 0
-- roles are all admin-everywhere anyway. Per-role gating lands with the
-- Phase 0.9 role hardening batch.
--
-- Two RPCs, forced by existing policy shape (same reasons as expense):
-- · create_task — INSERT is claim-bound (workspace_id =
--   current_workspace_id(), the JWT claim from the user's OLDEST accepted
--   membership). SECURITY DEFINER + explicit checks; workspace derived from
--   the live parent, or taken verbatim (member-gated) for a free task.
-- · delete_task — no DELETE policy (hard delete denied) and soft-delete by
--   PATCH is impossible by construction (ADR-048: the updated row must stay
--   SELECT-visible).
--
-- Parent FKs are immutable after creation (trigger): v1 has no relink UI,
-- and a PostgREST-direct relink would need cross-workspace coherence guards
-- the app doesn't carry yet. Relink = delete + recreate.
--
-- Applied 2026-07-17 via Supabase MCP apply_migration (name: task_entity).
-- This file is the canonical record.

--------------------------------------------------------------------------------
-- 1. Enums
--------------------------------------------------------------------------------

CREATE TYPE public.task_status AS ENUM ('open', 'done');
CREATE TYPE public.task_origin AS ENUM ('manual', 'protocol', 'ai');

--------------------------------------------------------------------------------
-- 2. Table
--------------------------------------------------------------------------------

CREATE TABLE public.task (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id   uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,

  -- Polymorphic parent (D3): at most ONE of the four. All NULL = a free
  -- workspace-level task.
  project_id     uuid REFERENCES public.project (id) ON DELETE CASCADE,
  line_id        uuid REFERENCES public.line (id) ON DELETE CASCADE,
  performance_id uuid REFERENCES public.performance (id) ON DELETE CASCADE,
  engagement_id  uuid REFERENCES public.engagement (id) ON DELETE CASCADE,

  title          text NOT NULL,
  note           text,
  due_at         timestamptz,
  status         public.task_status NOT NULL DEFAULT 'open',
  origin         public.task_origin NOT NULL DEFAULT 'manual',
  custom_fields  jsonb NOT NULL DEFAULT '{}',

  created_by     uuid REFERENCES auth.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT task_at_most_one_parent CHECK (
    (project_id IS NOT NULL)::int
    + (line_id IS NOT NULL)::int
    + (performance_id IS NOT NULL)::int
    + (engagement_id IS NOT NULL)::int <= 1
  )
);

COMMENT ON TABLE public.task IS
  'The verb layer (ADR-068, D3). At most one parent of project/line/performance/engagement — none = free workspace task. origin=manual only in v1 (protocol → ADR-011 Phase 0.5, ai → Phase 1+).';
COMMENT ON COLUMN public.task.due_at IS
  'Date-only contract at the API (YYYY-MM-DD, Postgres casts) — same as engagement.next_action_at.';
COMMENT ON COLUMN public.task.origin IS
  'manual | protocol | ai (D3). Only manual is written in v1; the enum exists so protocol tasks (ADR-011) land without DDL.';

--------------------------------------------------------------------------------
-- 3. Indexes
--------------------------------------------------------------------------------

CREATE INDEX task_workspace_idx   ON public.task (workspace_id)         WHERE deleted_at IS NULL;
CREATE INDEX task_status_idx      ON public.task (workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX task_due_idx         ON public.task (workspace_id, due_at) WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX task_project_idx     ON public.task (project_id)     WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX task_line_idx        ON public.task (line_id)        WHERE deleted_at IS NULL AND line_id IS NOT NULL;
CREATE INDEX task_performance_idx ON public.task (performance_id) WHERE deleted_at IS NULL AND performance_id IS NOT NULL;
CREATE INDEX task_engagement_idx  ON public.task (engagement_id)  WHERE deleted_at IS NULL AND engagement_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 4. Triggers — the house set + the parent-immutability guard
--------------------------------------------------------------------------------

CREATE TRIGGER task_set_updated_at BEFORE UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER task_guard_ws       BEFORE UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER task_guard_creator  BEFORE UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER task_audit          AFTER INSERT OR UPDATE OR DELETE ON public.task FOR EACH ROW EXECUTE FUNCTION write_audit();

CREATE OR REPLACE FUNCTION public.guard_immutable_task_parents()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.project_id     IS DISTINCT FROM OLD.project_id
  OR NEW.line_id        IS DISTINCT FROM OLD.line_id
  OR NEW.performance_id IS DISTINCT FROM OLD.performance_id
  OR NEW.engagement_id  IS DISTINCT FROM OLD.engagement_id THEN
    RAISE EXCEPTION 'task parent is immutable — delete and recreate'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.guard_immutable_task_parents() IS
  'Task parent is fixed at creation (ADR-068 v1). A relink would need cross-workspace coherence guards the app does not carry; the API whitelist already blocks it in-app — this closes the PostgREST-direct path.';

CREATE TRIGGER task_guard_parents BEFORE UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION guard_immutable_task_parents();

--------------------------------------------------------------------------------
-- 5. RLS — workspace-scoped (venue family). No DELETE policy (hard delete
--    denied; soft delete rides delete_task per ADR-048).
--------------------------------------------------------------------------------

ALTER TABLE public.task ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task FORCE  ROW LEVEL SECURITY;

CREATE POLICY task_select ON public.task
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_workspace_member(workspace_id)
  );

-- Claim-bound like every INSERT policy (kept for coherence); real creation
-- rides the create_task RPC.
CREATE POLICY task_insert ON public.task
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND is_workspace_member(workspace_id)
    AND created_by = auth.uid()
  );

CREATE POLICY task_update ON public.task
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

--------------------------------------------------------------------------------
-- 6. RPCs
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_task(
  p_title text,
  p_note text DEFAULT NULL,
  p_due_at date DEFAULT NULL,
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
    title, note, due_at, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_performance_id, p_engagement_id,
    v_title, nullif(btrim(coalesce(p_note, '')), ''), p_due_at, v_caller
  )
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$function$;

COMMENT ON FUNCTION public.create_task(text, text, date, uuid, uuid, uuid, uuid, uuid) IS
  'Create a task (ADR-068). At most one parent; workspace derived from the parent, or p_workspace_id (member-gated) for a free task. origin is always manual here — protocol/ai writers arrive with their own paths.';

REVOKE ALL ON FUNCTION public.create_task(text, text, date, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, date, uuid, uuid, uuid, uuid, uuid) TO authenticated;

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

COMMENT ON FUNCTION public.delete_task(uuid) IS
  'Soft-delete a task (ADR-048: no DELETE policy, deleted_at never rides a client PATCH).';

REVOKE ALL ON FUNCTION public.delete_task(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_task(uuid) TO authenticated;
