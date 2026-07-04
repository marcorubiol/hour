-- ADR-052: performance soft-delete RPC — gigs created by mistake can
-- finally be removed from the UI. ADR-048 rule applied: with the
-- universal `deleted_at IS NULL` SELECT pattern, NO soft-delete can go
-- through a client PATCH (the updated row must stay SELECT-visible for
-- the updater — setting deleted_at breaks that mid-statement). Always RPC.
--
-- Gate: has_permission(project, 'edit:show') — same domain rule as
-- create_performance (ADR-043).
--
-- Deliberate semantics:
--   · This is for MISTAKES. A gig that fell through keeps its history —
--     that's what status 'cancelled' is for (already in the status menu).
--   · Live, non-cancelled invoices BLOCK deletion (23503 → API 409):
--     money records must never dangle. Discard the draft (ADR-050) or
--     cancel the invoice first.
--   · Children (crew_assignment, cast_override, date, asset_version) are
--     left untouched: they become unreachable through the bundle join and
--     come back whole if the row is ever restored by hand.
--
-- Also unblocks the e2e performance-write self-cleaning (the suite used
-- to accumulate e2e-venue-* gigs; purge was manual, see
-- build/runbooks/test-user-setup.md).

CREATE OR REPLACE FUNCTION public.delete_performance(
  p_performance_id uuid
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
  FROM public.performance
  WHERE id = p_performance_id AND deleted_at IS NULL;

  -- Not-found and no-permission collapse into one error: existence is
  -- never confirmed to a caller who couldn't see the row anyway.
  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:show') THEN
    RAISE EXCEPTION 'performance % not found', p_performance_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_line il
    JOIN public.invoice i ON i.id = il.invoice_id
    WHERE il.performance_id = p_performance_id
      AND i.deleted_at IS NULL
      AND i.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'performance has invoices — discard or cancel them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.performance
  SET deleted_at = now()
  WHERE id = p_performance_id;
END;
$function$;

-- Grants: strip the default PUBLIC EXECUTE (ADR-043 review lesson),
-- authenticated only.
REVOKE ALL ON FUNCTION public.delete_performance(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_performance(uuid) TO authenticated;
