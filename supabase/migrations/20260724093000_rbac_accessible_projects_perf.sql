-- Stop re-evaluating has_permission() once per row (hardening audit 2026-07-24).
--
-- has_permission → has_permission_for_user is a STABLE SECURITY DEFINER whose
-- body is two EXISTS over a WITH…UNION/EXCEPT CTE. The CTE makes it
-- non-inlineable, and Postgres does not memoize a scalar filter function across
-- rows (Memoize only applies to nested-loop join inners). Used as a row filter
-- it therefore re-runs the full membership resolution — workspace_membership ⋈
-- project_membership ⋈ workspace_role — for EVERY candidate row.
--
-- With a scope pin the project/workspace indexes prune first, so it stays cheap.
-- Unscoped (Money or Desk with no pins) there is no indexable filter, so it ran
-- across every non-deleted bolo / expense / conversation in the tenant, and
-- single-threaded (SECURITY DEFINER defaults to parallel-unsafe, which also
-- blocked parallel scans).
--
-- Fix: resolve the caller's accessible project set ONCE per call, then filter
-- with set membership. N function calls become 1 (well, one per project — tens,
-- not thousands), and the scans can use the existing project_id indexes.
-- Authorization semantics are identical: the same has_permission decides, just
-- once per project instead of once per row.

CREATE OR REPLACE FUNCTION public.accessible_project_ids(p_perm text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(p.id), '{}'::uuid[])
  FROM public.project p
  WHERE p.deleted_at IS NULL
    AND public.has_permission(p.id, p_perm);
$$;

COMMENT ON FUNCTION public.accessible_project_ids(text) IS
  'Every live project where the caller holds p_perm. Resolve once per RPC and filter with = ANY(...) instead of calling has_permission per row (hardening audit 2026-07-24).';

REVOKE ALL ON FUNCTION public.accessible_project_ids(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accessible_project_ids(text) TO authenticated;

-- Read-only RBAC helpers are parallel-safe; SECURITY DEFINER only defaults them
-- to unsafe, which suppressed parallel workers on every large filtered read.
ALTER FUNCTION public.has_permission(uuid, text) PARALLEL SAFE;
ALTER FUNCTION public.has_permission_for_user(uuid, text, uuid) PARALLEL SAFE;
ALTER FUNCTION public.accessible_project_ids(text) PARALLEL SAFE;

-- Backs the ORDER BY of list_expenses_for_scope, which previously seq-scanned
-- the whole expense table and sorted it externally on every Money page load.
CREATE INDEX IF NOT EXISTS expense_incurred_on_idx
  ON public.expense (incurred_on DESC)
  WHERE deleted_at IS NULL;

-- ── list_money_bolos: one permission resolution, not one per bolo ────────────
CREATE OR REPLACE FUNCTION public.list_money_bolos(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_line_ids uuid[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS TABLE (
  id uuid,
  project_id uuid,
  line_id uuid,
  conversation_id uuid,
  venue_name text,
  city text,
  country character(2),
  fee_amount numeric,
  fee_currency character(3),
  status public.performance_status,
  project jsonb,
  collected numeric,
  function_count integer,
  next_performed_at date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_projects uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('read:money');

  RETURN QUERY
  SELECT b.id,
         b.project_id,
         b.line_id,
         b.conversation_id,
         b.venue_name,
         b.city,
         b.country,
         b.fee_amount,
         b.fee_currency,
         b.status,
         jsonb_build_object(
           'id', p.id,
           'slug', p.slug,
           'name', p.name,
           'accent', p.accent,
           'workspace_id', p.workspace_id
         ) AS project,
         coalesce((
           SELECT sum(pay.amount)
           FROM public.payment pay
           WHERE pay.deleted_at IS NULL
             AND (
               pay.bolo_id = b.id
               -- Invoice-linked only when the payment carries NO direct anchor,
               -- so a payment is counted once (never via both anchor and invoice).
               OR (pay.bolo_id IS NULL AND pay.invoice_id IN (
                 SELECT il.invoice_id
                 FROM public.invoice_line il
                 JOIN public.invoice iv ON iv.id = il.invoice_id AND iv.deleted_at IS NULL
                 WHERE il.bolo_id IS NOT NULL
                 GROUP BY il.invoice_id
                 HAVING bool_and(il.bolo_id = b.id)
               ))
             )
         ), 0) AS collected,
         fx.function_count::integer,
         fx.next_performed_at
  FROM public.bolo b
  JOIN public.project p ON p.id = b.project_id AND p.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT count(*) AS function_count, min(pf.performed_at) AS next_performed_at
    FROM public.performance pf
    WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
  ) fx ON true
  WHERE b.deleted_at IS NULL
    AND b.project_id = ANY (v_projects)
    AND (
      (coalesce(cardinality(p_project_ids), 0) = 0 AND coalesce(cardinality(p_workspace_ids), 0) = 0)
      OR b.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR b.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
    AND (
      coalesce(cardinality(p_line_ids), 0) = 0
      OR b.line_id = ANY (p_line_ids)
    )
    AND (p_from IS NULL OR fx.next_performed_at >= p_from)
    AND (p_to IS NULL OR fx.next_performed_at <= p_to)
  ORDER BY fx.next_performed_at ASC NULLS LAST, b.created_at ASC
  LIMIT p_limit;
END;
$$;

-- ── list_expenses_for_scope: same, and it no longer calls has_permission 2×/row ──
CREATE OR REPLACE FUNCTION public.list_expenses_for_scope(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_line_ids uuid[] DEFAULT NULL,
  p_bolo_ids uuid[] DEFAULT NULL,
  p_category public.expense_category DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS SETOF public.expense
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_projects uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('read:money');

  RETURN QUERY
  SELECT e.*
  FROM public.expense e
  WHERE e.deleted_at IS NULL
    AND (p_category IS NULL OR e.category = p_category)
    AND (
      EXISTS (
        SELECT 1
        FROM public.line l
        WHERE l.id = e.line_id
          AND l.deleted_at IS NULL
          AND l.project_id = ANY (v_projects)
      )
      OR EXISTS (
        SELECT 1
        FROM public.bolo b
        WHERE b.id = e.bolo_id
          AND b.deleted_at IS NULL
          AND b.project_id = ANY (v_projects)
      )
    )
    AND (
      (
        coalesce(cardinality(p_project_ids), 0) = 0
        AND coalesce(cardinality(p_workspace_ids), 0) = 0
        AND coalesce(cardinality(p_line_ids), 0) = 0
        AND coalesce(cardinality(p_bolo_ids), 0) = 0
      )
      OR e.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
      OR e.line_id = ANY (coalesce(p_line_ids, '{}'::uuid[]))
      OR e.bolo_id = ANY (coalesce(p_bolo_ids, '{}'::uuid[]))
      OR EXISTS (
        SELECT 1 FROM public.line l
        WHERE l.id = e.line_id
          AND l.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      )
      OR EXISTS (
        SELECT 1 FROM public.bolo b
        WHERE b.id = e.bolo_id
          AND b.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      )
    )
  ORDER BY e.incurred_on DESC, e.created_at DESC
  LIMIT p_limit;
END;
$$;

-- ── list_money_payers: the payer dropdown no longer costs one RBAC pass per
--    conversation in the tenant ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_money_payers(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_limit integer DEFAULT 500
) RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  slug text,
  full_name text,
  organization_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_projects uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('edit:money');

  RETURN QUERY
  SELECT DISTINCT ON (wp.workspace_id, wp.person_id)
    wp.person_id,
    wp.workspace_id,
    wp.slug,
    wp.full_name,
    org.name
  FROM public.conversation c
  JOIN public.workspace_person wp
    ON wp.workspace_id = c.workspace_id
   AND wp.person_id = c.person_id
   AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization org
    ON org.workspace_id = wp.workspace_id
   AND org.id = wp.organization_id
   AND org.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.project_id = ANY (v_projects)
    AND (
      (
        coalesce(cardinality(p_project_ids), 0) = 0
        AND coalesce(cardinality(p_workspace_ids), 0) = 0
      )
      OR c.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR c.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
  ORDER BY wp.workspace_id, wp.person_id, wp.full_name
  LIMIT p_limit;
END;
$$;
