-- Migration: project_initials_and_palette_12
-- ADR-081 — the project identity monogram replaces the color dot app-wide.
--
-- Two coupled changes:
--
-- 1) Palette 8 → 12. The accent index range widens from '1'..'8' to
--    '1'..'12' on all three identity-bearing tables (workspace/project/line).
--    The CHECK was added inline/unnamed in the 2026-05-19 migrations, so the
--    real constraint name is Postgres-generated (conventionally
--    <table>_accent_check). The DO block below discovers and drops whatever
--    check references the accent column — robust to the actual name — then
--    re-adds a well-named, relaxed one. Idempotent.
--
-- 2) project.initials — the stored monogram. Free-form, 1..3 chars, mixed
--    case kept, no internal whitespace. NULL = derive from name at render
--    (IdentityMark / deriveInitials). Collision is defined in the editor UI
--    (case-sensitive exact match); the DB stores, it does not dedupe —
--    'MdM' and 'MDM' are two valid, distinct monograms.
--
-- update_project RPC mirrors update_workspace (jsonb patch, SECURITY DEFINER):
-- only present keys change; ''/null clears nullable fields. Gated to
-- owner/admin/member — the same tiers that can create a project (the project
-- edit level, not the more sensitive space identity which is owner/admin).
--
-- Status: NOT YET APPLIED. Apply via Supabase MCP apply_migration
-- (name: project_initials_and_palette_12). This file is the canonical record.

-- ── 1) Palette 8 → 12 ────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid IN (
        'public.workspace'::regclass,
        'public.project'::regclass,
        'public.line'::regclass
      )
      AND pg_get_constraintdef(c.oid) ILIKE '%accent%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.workspace
  ADD CONSTRAINT workspace_accent_check
    CHECK (accent IS NULL OR accent ~ '^([1-9]|1[0-2])$');
ALTER TABLE public.project
  ADD CONSTRAINT project_accent_check
    CHECK (accent IS NULL OR accent ~ '^([1-9]|1[0-2])$');
ALTER TABLE public.line
  ADD CONSTRAINT line_accent_check
    CHECK (accent IS NULL OR accent ~ '^([1-9]|1[0-2])$');

-- ── 2) project.initials ──────────────────────────────────────────────
ALTER TABLE public.project
  ADD COLUMN initials text
    CHECK (initials IS NULL OR (length(initials) BETWEEN 1 AND 3 AND initials !~ '\s'));

COMMENT ON COLUMN public.project.initials IS
  'Identity monogram (ADR-081). Free-form 1..3 chars, mixed case, no internal whitespace. NULL = derive from name at render. Collision handled in the editor UI (case-sensitive exact match), not the DB.';

-- ── update_project RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid,
  p_patch      jsonb
)
RETURNS public.project
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_project public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  -- Membership: owner/admin/member of the project's workspace — same tiers
  -- that create_project requires.
  IF NOT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.workspace_membership m ON m.workspace_id = p.workspace_id
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND m.user_id     = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.role        IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project p SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                     ELSE p.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')   ELSE p.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')       ELSE p.accent      END,
    initials    = CASE WHEN p_patch ? 'initials'    THEN NULLIF(trim(p_patch->>'initials'), '')     ELSE p.initials    END,
    updated_at  = now()
  WHERE p.id = p_project_id AND p.deleted_at IS NULL
  RETURNING * INTO v_project;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.update_project(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_project(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_project(uuid, jsonb) IS
  'Patch a project (name, description, accent, initials). SECURITY DEFINER; requires owner/admin/member membership of the project workspace. jsonb patch: only present keys change; ""/null clears nullable fields; slug/status not editable here. ADR-081.';
