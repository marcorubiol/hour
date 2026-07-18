-- ADR-078 §4/§5 (via ADR-072 §2): availability_block — the blackout
-- entity. Two scopes in one nullable FK: person_id NULL = the whole
-- company is unavailable; person_id set = that one person. Day-precision
-- (starts_on/ends_on are DATEs, never instants — ADR-071's day-level
-- semantics). `certainty` carries the "no sé si puedo" state
-- (unavailable | tentative) as TEXT with a CHECK, not an enum: promoting
-- to an enum later is additive and cheap, and v1 has exactly two values.
--
-- Deliberately NO `kind` column (ADR-078 §4): "no estoy" is complete
-- information — the why, if any, is free prose in `note`. No consumer
-- branches on the reason (the conflict engine reads certainty, the
-- render distinguishes scope and certainty), and inviting users to
-- classify the why pressures them to explain what socially they should
-- not have to.
--
-- Access model: workspace-scoped (the venue / person_note / task family,
-- NOT has_permission — ADR-071's access decision): any accepted member
-- of the workspace reads and edits its blackouts. Write-target is always
-- ONE workspace (ADR-078 §5 — no fan-out); in reading, the conflict
-- engine sees every blackout RLS lets through, so cross-space visibility
-- comes free for people shared between companies.
--
-- Two RPCs, forced by existing policy shape (same reasons as expense and
-- task):
-- · create_availability_block — INSERT is claim-bound (workspace_id =
--   current_workspace_id(), the JWT claim from the user's OLDEST accepted
--   membership). SECURITY DEFINER + explicit checks; workspace taken
--   verbatim, member-gated.
-- · delete_availability_block — no DELETE policy (hard delete denied) and
--   soft-delete by PATCH is impossible by construction (ADR-048: the
--   updated row must stay SELECT-visible).
--
-- NOT applied to any live DB yet — deliver-files-only pass (calendar-v2).
-- Apply via Supabase MCP apply_migration (name: availability_block),
-- additive-only; verify with probes (table exists, RLS forced, anon SELECT
-- denied, RPC EXECUTE revoked from anon/PUBLIC).

--------------------------------------------------------------------------------
-- 1. Table
--------------------------------------------------------------------------------

CREATE TABLE public.availability_block (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,

  -- NULL = the whole company; set = one person of the workspace's team.
  person_id    uuid REFERENCES public.person (id) ON DELETE CASCADE,

  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  certainty    text NOT NULL DEFAULT 'unavailable',
  note         text,

  created_by   uuid REFERENCES auth.users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,

  CONSTRAINT availability_block_range     CHECK (ends_on >= starts_on),
  CONSTRAINT availability_block_certainty CHECK (certainty IN ('unavailable', 'tentative'))
);

COMMENT ON TABLE public.availability_block IS
  'Blackout (ADR-072 §2 / ADR-078 §4): person or whole-company unavailability, day-precision. NO kind/reason axis — the why is free prose in note. Feeds calendar chips, the conflict engine and AI date proposals (ADR-069).';
COMMENT ON COLUMN public.availability_block.person_id IS
  'NULL = whole company. The dialog''s person select is the workspace TEAM (cast_member ∪ crew_assignment), not the contact book (ADR-078 §5).';
COMMENT ON COLUMN public.availability_block.certainty IS
  'unavailable | tentative ("el 8 no sé si puedo"). TEXT + CHECK, not an enum — promoting is additive if a third state ever earns its place.';

--------------------------------------------------------------------------------
-- 2. Indexes
--------------------------------------------------------------------------------

CREATE INDEX availability_block_workspace_idx
  ON public.availability_block (workspace_id)
  WHERE deleted_at IS NULL;
CREATE INDEX availability_block_window_idx
  ON public.availability_block (workspace_id, starts_on, ends_on)
  WHERE deleted_at IS NULL;
CREATE INDEX availability_block_person_idx
  ON public.availability_block (person_id)
  WHERE deleted_at IS NULL AND person_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 3. Triggers — the house set
--------------------------------------------------------------------------------

CREATE TRIGGER availability_block_set_updated_at BEFORE UPDATE ON public.availability_block FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER availability_block_guard_ws       BEFORE UPDATE ON public.availability_block FOR EACH ROW EXECUTE FUNCTION guard_immutable_workspace_id();
CREATE TRIGGER availability_block_guard_creator  BEFORE UPDATE ON public.availability_block FOR EACH ROW EXECUTE FUNCTION guard_immutable_created_by();
CREATE TRIGGER availability_block_audit          AFTER INSERT OR UPDATE OR DELETE ON public.availability_block FOR EACH ROW EXECUTE FUNCTION write_audit();

--------------------------------------------------------------------------------
-- 4. RLS — workspace-scoped (venue family). No DELETE policy (hard delete
--    denied; soft delete rides delete_availability_block per ADR-048).
--------------------------------------------------------------------------------

ALTER TABLE public.availability_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_block FORCE  ROW LEVEL SECURITY;

CREATE POLICY availability_block_select ON public.availability_block
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_workspace_member(workspace_id)
  );

-- Claim-bound like every INSERT policy (kept for coherence); real creation
-- rides the create_availability_block RPC.
CREATE POLICY availability_block_insert ON public.availability_block
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = current_workspace_id()
    AND is_workspace_member(workspace_id)
    AND created_by = auth.uid()
  );

CREATE POLICY availability_block_update ON public.availability_block
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

--------------------------------------------------------------------------------
-- 5. RPCs
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_availability_block(
  p_workspace_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_person_id uuid DEFAULT NULL,
  p_certainty text DEFAULT 'unavailable',
  p_note text DEFAULT NULL
)
RETURNS public.availability_block
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

  -- Person is a GLOBAL entity (no workspace_id column) — the visibility
  -- gate is can_see_person, same as create_conversation's linked-person
  -- path. Unknown id and not-visible collapse (no oracle).
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

COMMENT ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) IS
  'Create a blackout (ADR-078 §4/§5). Workspace verbatim, member-gated; person optional (NULL = whole company), can_see_person-gated. No kind axis by design.';

REVOKE ALL ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_availability_block(uuid, date, date, uuid, text, text) TO authenticated;

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

COMMENT ON FUNCTION public.delete_availability_block(uuid) IS
  'Soft-delete a blackout (ADR-048: no DELETE policy, deleted_at never rides a client PATCH).';

REVOKE ALL ON FUNCTION public.delete_availability_block(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_availability_block(uuid) TO authenticated;
