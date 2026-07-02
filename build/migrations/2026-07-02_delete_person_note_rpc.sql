-- ADR-045: author-scoped soft-delete for person notes. A direct PATCH
-- setting deleted_at is rejected by RLS (observed live: `SET body=body`
-- passes the same UPDATE policy but `SET deleted_at=now()` violates it —
-- interplay between the soft-delete and row visibility; mechanism noted
-- in _notes/_flux.md for a fresh-eyes look). SECURITY DEFINER with an
-- explicit author check sidesteps it and gives the UI a proper delete
-- affordance later.
--
-- Applied 2026-07-02 via Supabase MCP apply_migration
-- (name: delete_person_note_rpc).

CREATE OR REPLACE FUNCTION public.delete_person_note(p_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.person_note
  SET deleted_at = now()
  WHERE id = p_note_id
    AND author_id = v_caller
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'note not found or not yours' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_person_note(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_person_note(uuid) TO authenticated;
