-- ADR-056: the Money module is where the missing expense UI lands. Two
-- RPCs, both forced by existing policy shape:
--
-- · create_expense — expense INSERT is claim-bound (workspace_id =
--   current_workspace_id(), the JWT claim from the user's OLDEST accepted
--   membership), the exact pattern that spawned the create_* RPC family.
--   Eighth case: SECURITY DEFINER + explicit checks, gate
--   has_permission(parent project, 'edit:money').
-- · delete_expense — expense has NO DELETE policy (hard delete denied) and
--   soft-delete by PATCH is impossible by construction (ADR-048: the
--   updated row must stay SELECT-visible). Same shape as delete_invoice.
--
-- Scope: exactly one of p_performance_id / p_line_id (mirrors the table's
-- expense_exactly_one_parent CHECK, validated first for a friendlier error).
--
-- PENDING APPLY — run via Supabase MCP apply_migration
-- (name: expense_rpcs). This file is the canonical record.

CREATE OR REPLACE FUNCTION public.create_expense(
  p_performance_id uuid DEFAULT NULL,
  p_line_id uuid DEFAULT NULL,
  p_category public.expense_category DEFAULT 'other',
  p_description text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT 'EUR',
  p_incurred_on date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.expense
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id   uuid;
  v_description  text := nullif(btrim(coalesce(p_description, '')), '');
  v_currency     text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_expense      public.expense;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF num_nonnulls(p_performance_id, p_line_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of performance_id or line_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_description IS NULL THEN
    RAISE EXCEPTION 'description cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency must be a 3-letter code' USING ERRCODE = '22023';
  END IF;

  IF p_performance_id IS NOT NULL THEN
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.performance
    WHERE id = p_performance_id AND deleted_at IS NULL;
  ELSE
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.line
    WHERE id = p_line_id AND deleted_at IS NULL;
  END IF;

  IF v_project_id IS NULL THEN
    -- Not-found and no-permission collapse (no existence oracle).
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required to record an expense'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.expense (
    workspace_id, performance_id, line_id, category, description, amount,
    currency, incurred_on, notes, created_by
  ) VALUES (
    v_workspace_id, p_performance_id, p_line_id, p_category, v_description,
    round(p_amount, 2), v_currency,
    coalesce(p_incurred_on, CURRENT_DATE),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  )
  RETURNING * INTO v_expense;

  RETURN v_expense;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, public.expense_category, text, numeric, text, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, public.expense_category, text, numeric, text, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id uuid)
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

  SELECT coalesce(p.project_id, l.project_id) INTO v_project_id
  FROM public.expense e
  LEFT JOIN public.performance p ON p.id = e.performance_id
  LEFT JOIN public.line l ON l.id = e.line_id
  WHERE e.id = p_expense_id AND e.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    -- Not-found and no-permission collapse (no existence oracle).
    RAISE EXCEPTION 'expense not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.expense SET deleted_at = now()
  WHERE id = p_expense_id AND deleted_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
