-- Migration: add_line_last_navigated_at
-- ADR-038: cada line registra cuándo fue visitada por última vez. LineList
-- lo usa para sort by recency en su modalidad "siempre visible, filtrada
-- por SelectionStore". Tracking global (no per-user) por simplicidad
-- Phase 0. Si emerge necesidad de per-user tracking, junction table
-- `line_visit (line_id, user_id, at)` en Phase 0.5+.
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- add_line_last_navigated_at). This file is the canonical record.

ALTER TABLE public.line ADD COLUMN last_navigated_at timestamptz;

-- Backfill: usar updated_at como baseline. Garantiza order determinista para
-- las lines existentes desde el día 1 sin necesidad de visitas reales.
UPDATE public.line SET last_navigated_at = updated_at WHERE last_navigated_at IS NULL;

-- Index para el sort. Partial WHERE deleted_at IS NULL (alineado con el resto).
CREATE INDEX line_last_navigated_idx
  ON public.line (workspace_id, last_navigated_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- RPC: SECURITY DEFINER + check manual de membership (RLS está bypaseada en
-- SECURITY DEFINER por design, así que validamos explícitamente).
-- Cualquier workspace member puede tocar; no requiere edit:show permission
-- (visitar ≠ editar).
CREATE OR REPLACE FUNCTION public.touch_line_visit(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.line
  WHERE id = p_line_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Line not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member' USING ERRCODE = '42501';
  END IF;

  UPDATE public.line SET last_navigated_at = now() WHERE id = p_line_id;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_line_visit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.touch_line_visit(uuid) TO authenticated;

COMMENT ON COLUMN public.line.last_navigated_at IS
  'Set by touch_line_visit() RPC when an authenticated workspace member opens this line detail page. Used by LineList to sort by recency (Phase 0.2 sidebar filter system).';

COMMENT ON FUNCTION public.touch_line_visit(uuid) IS
  'Touches line.last_navigated_at to now() if caller is a workspace member. Used by client when navigating to line detail; tracking global (not per-user) for Phase 0.';
