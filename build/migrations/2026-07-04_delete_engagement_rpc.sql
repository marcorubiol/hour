-- ADR-051 (cont.): engagement soft-delete RPC — a mistyped contact is the
-- same "created by error" class as a mistyped gig (ADR-052). ADR-048 rule:
-- soft-deletes never ride a client PATCH; always RPC.
--
-- Gate: has_permission(project, 'edit:engagement') — same code as create.
--
-- Live performances referencing the conversation BLOCK deletion (23503 →
-- API 409): a gig would silently lose its programmer link otherwise.
-- Unlink or delete the gigs first.
--
-- Re-adding the same person to the same project later works: the
-- (workspace, project, person) UNIQUE constraint is FULL, so
-- create_engagement resurrects the soft-deleted row instead of INSERTing.
--
-- No UI for now — this exists for the API surface (e2e self-cleaning) and
-- the resurrect symmetry; whether the gate month asks for a button is
-- Marco's call.

CREATE OR REPLACE FUNCTION public.delete_engagement(
  p_engagement_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.engagement
  WHERE id = p_engagement_id AND deleted_at IS NULL;

  -- Not-found and no-permission collapse: no existence oracle.
  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:engagement') THEN
    RAISE EXCEPTION 'engagement % not found', p_engagement_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.performance
    WHERE engagement_id = p_engagement_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'engagement has performances — unlink or delete them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.engagement
  SET deleted_at = now()
  WHERE id = p_engagement_id;
END;
$function$;

-- Grants: strip the default PUBLIC EXECUTE (ADR-043 review lesson),
-- authenticated only.
REVOKE ALL ON FUNCTION public.delete_engagement(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_engagement(uuid) TO authenticated;
