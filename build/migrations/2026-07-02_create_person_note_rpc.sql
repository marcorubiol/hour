-- ADR-045: creation RPC for person notes — the direct INSERT policy is
-- claim-bound (workspace_id = current_workspace_id()), which denies
-- adding notes in any workspace that isn't the caller's first
-- membership. Same pattern as create_project/create_line/
-- create_performance: SECURITY DEFINER + explicit membership check.
--
-- Applied 2026-07-02 via Supabase MCP apply_migration
-- (name: create_person_note_rpc).

CREATE OR REPLACE FUNCTION public.create_person_note(
  p_person_id uuid,
  p_workspace_id uuid,
  p_body text,
  p_visibility public.person_note_visibility DEFAULT 'workspace'
)
RETURNS public.person_note
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_note   public.person_note;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'note body cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'note body too long (max 4000)' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.person
    WHERE id = p_person_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person % not found', p_person_id USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.accepted_at  IS NOT NULL
      AND m.role         IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.person_note (person_id, workspace_id, author_id, body, visibility)
  VALUES (p_person_id, p_workspace_id, v_caller, trim(p_body), p_visibility)
  RETURNING * INTO v_note;

  RETURN v_note;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_person_note(uuid, uuid, text, public.person_note_visibility) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_person_note(uuid, uuid, text, public.person_note_visibility) TO authenticated;
