-- The cast writer: `add_cast_member` / `remove_cast_member`.
--
-- WHY THIS EXISTS. Until today nothing in the app could write a roster.
-- `/api/lines/[id]/people` exported only GET and no endpoint touched
-- `cast_member`, `crew_assignment` or `cast_override` — the whole roster was
-- READ-ONLY across the product, and the six rows in production were seeded by
-- hand. That is not a cosmetic gap: `/api/team` is `cast_member ∪
-- crew_assignment`, so it feeds the ⌘K person search, the person pins
-- (ADR-092), the Planner's person axis, the rosters the conflict engine reads
-- and the `no data yet` ghost lane. Whoever was never cast simply did not
-- exist for any of it — including Marco, who is a `person` with dossiers and
-- was still invisible.
--
-- WHY AN RPC AND NOT A DIRECT INSERT. `cast_member_insert` is claim-bound:
--   (workspace_id = current_workspace_id()) AND has_permission(project_id, 'edit:performance')
-- and `current_workspace_id()` reads ONE workspace out of the JWT. Hour is
-- multi-workspace and the app does not re-issue a token per workspace, so a
-- direct insert would only ever work for whichever workspace the claim happens
-- to name. Same reason `create_date` exists (ADR-078). These two are
-- claim-independent and gate on the permission alone.
--
-- The DELETE is a SOFT delete, per ADR-048: `deleted_at` is never written by a
-- client PATCH, and removal goes through an RPC. The table's own DELETE policy
-- stays as it is — this does not widen anything.

CREATE OR REPLACE FUNCTION public.add_cast_member(
  p_project_id uuid,
  p_person_id  uuid,
  p_role       text
)
RETURNS public.cast_member
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_role         text := nullif(btrim(coalesce(p_role, '')), '');
  v_row          public.cast_member;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  -- `role` is NOT NULL with a non-empty CHECK: a cast row without a role is
  -- not a fact anybody can use. Rejected here so the error is a sentence and
  -- not a constraint name.
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'role is required' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    -- Not-found and no-membership collapse (no existence oracle) — same
    -- shape as create_date.
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to cast somebody'
      USING ERRCODE = '42501';
  END IF;

  -- `cast_member_workspace_person_fkey` is (workspace_id, person_id) →
  -- workspace_person: casting somebody REQUIRES they have a local dossier in
  -- this workspace. That is the ADR-085 consent boundary, not an accident, so
  -- it gets its own sentence instead of a foreign-key violation.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_person
    WHERE workspace_id = v_workspace_id
      AND person_id = p_person_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person has no dossier in this workspace'
      USING ERRCODE = '22023';
  END IF;

  -- Somebody can hold SEVERAL roles in one project (musician + lighting) —
  -- `cast_member_project_person_role_uidx` is unique on the triple, not on
  -- the pair. Only the same role twice is a duplicate.
  --
  -- A previously removed row is RESURRECTED rather than re-inserted: the
  -- partial index would allow a second row (it only covers live ones), and a
  -- roster somebody toggles would grow a dead row every time. Coming back to
  -- the same role in the same project is the same fact resuming, so it keeps
  -- its `joined_at` and its notes.
  UPDATE public.cast_member
     SET deleted_at = NULL, updated_at = now()
   WHERE project_id = p_project_id
     AND person_id  = p_person_id
     AND role       = v_role
     AND deleted_at IS NOT NULL
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cast_member
    WHERE project_id = p_project_id
      AND person_id  = p_person_id
      AND role       = v_role
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'already cast in this role' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.cast_member (workspace_id, project_id, person_id, role, created_by)
  VALUES (v_workspace_id, p_project_id, p_person_id, v_role, v_caller)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.add_cast_member(uuid, uuid, text) IS
  'Casts a person in a project. Claim-independent; gated on has_permission(project, ''edit:performance''). Requires a workspace_person dossier (ADR-085). Resurrects a removed row for the same (project, person, role).';


CREATE OR REPLACE FUNCTION public.remove_cast_member(p_cast_member_id uuid)
RETURNS public.cast_member
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
  v_row        public.cast_member;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.cast_member
  WHERE id = p_cast_member_id AND deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'cast member % not found', p_cast_member_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to remove somebody from the cast'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.cast_member
     SET deleted_at = now(), updated_at = now()
   WHERE id = p_cast_member_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

COMMENT ON FUNCTION public.remove_cast_member(uuid) IS
  'Soft-removes a cast row (ADR-048: deleted_at is never written by a client PATCH). Gated on has_permission(project, ''edit:performance'').';


-- Only signed-in callers. `anon` never reaches either.
REVOKE ALL ON FUNCTION public.add_cast_member(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_cast_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_cast_member(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_cast_member(uuid) TO authenticated;
