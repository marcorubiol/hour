-- Money v3 (ADR-087) — Phase 0: the bolo becomes the money unit.
--
-- ADR-086 anchored money v3 to the performance (the function). The grill of
-- 2026-07-23 found that anchor one level too low: money is negotiated per BOLO
-- (the deal with a venue), and one bolo can be 1..N functions. This migration
-- introduces the `bolo` entity ABOVE the performance, moves the fee onto it,
-- and re-anchors the invoice line to it. The later money-v3 phases (invoice
-- issue, payment decouple) are revised in place to speak bolo instead of
-- performance — none of money v3 is deployed, so this is a revision, not a
-- layer on top. Scheduling stays put: the performance keeps performed_at, the
-- ADR-023 slots, road sheet, planner and its own venue/conversation columns.
--
-- Structure: conversation (broadcast) → 1:N bolo (deal: one venue · fee ·
-- document · collected · pending) → 1:N performance (function: day · time ·
-- road sheet). The fee lives ONLY on the bolo now; the performance no longer
-- carries fee_amount/fee_currency. venue_name/city/country and conversation_id
-- are COPIED onto the bolo (money reads the deal's venue/broadcast) while the
-- performance keeps its own (the road sheet and detail bundle read them, and
-- those are deliberately untouched).

-- ── bolo ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.bolo (
  id              uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id    uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  -- A bolo belongs to one obra (project); money groups by obra, never by line.
  project_id      uuid NOT NULL REFERENCES public.project(id) ON DELETE CASCADE,
  line_id         uuid REFERENCES public.line(id) ON DELETE SET NULL,
  -- The broadcast that produced the deal (ADR-087: a bolo is born from a
  -- confirmed conversation, or created by hand). Used to infer the payer.
  conversation_id uuid REFERENCES public.conversation(id) ON DELETE SET NULL,
  -- One bolo = one venue (the deal's sala). Denormalised name/city/country so a
  -- venue-first money card and the invoice description render without a join,
  -- and so a bolo with zero scheduled functions still names its venue.
  venue_name      text,
  city            text,
  country         character(2),
  -- The fee is negotiated per bolo (ADR-087). Nullable = deal exists, fee TBD.
  fee_amount      numeric(12,2),
  fee_currency    character(3) DEFAULT 'EUR',
  -- Reuses performance_status: a deal is contracted when confirmed/done, and
  -- "pending = contracted − collected" keys on the same values money v2 used.
  status          public.performance_status NOT NULL DEFAULT 'proposed',
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT bolo_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  CONSTRAINT bolo_currency_format CHECK (fee_currency IS NULL OR fee_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT bolo_fee_amount_range CHECK (
    fee_amount IS NULL OR (fee_amount >= 0 AND fee_amount <= 9999999999.99)
  )
);

COMMENT ON TABLE public.bolo IS
  'A bolo (ADR-087): the deal with a venue — the unit of money. One venue, one fee, groups 1..N performances (functions). The fee lives here, not on the performance; collected/pending derive from payments against this fee.';
COMMENT ON COLUMN public.bolo.conversation_id IS
  'The broadcast conversation the deal came from (nullable for a hand-made bolo). The performance keeps its own conversation_id for the detail bundle.';
COMMENT ON COLUMN public.bolo.venue_name IS
  'Denormalised venue of the deal. The performance keeps its own venue columns for the road sheet (ADR-023); this one drives the venue-first money card.';

CREATE INDEX bolo_workspace_id_idx    ON public.bolo (workspace_id);
CREATE INDEX bolo_project_id_idx      ON public.bolo (project_id);
CREATE INDEX bolo_line_id_idx         ON public.bolo (line_id)         WHERE line_id IS NOT NULL;
CREATE INDEX bolo_conversation_id_idx ON public.bolo (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX bolo_created_by_idx      ON public.bolo (created_by)      WHERE created_by IS NOT NULL;

ALTER TABLE public.bolo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bolo FORCE ROW LEVEL SECURITY;

-- Read requires read:money on the bolo's obra. All writes go through the
-- SECURITY DEFINER RPCs below (create_bolo / update_bolo_fee / delete_bolo),
-- same posture as invoice_number_series: no direct INSERT/UPDATE/DELETE surface.
REVOKE ALL ON TABLE public.bolo FROM PUBLIC, anon, service_role;

CREATE POLICY bolo_select ON public.bolo
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.has_permission(project_id, 'read:money'));

GRANT SELECT ON TABLE public.bolo TO authenticated;

-- ── performance.bolo_id ──────────────────────────────────────────────────────
ALTER TABLE public.performance
  ADD COLUMN bolo_id uuid REFERENCES public.bolo(id) ON DELETE SET NULL;

CREATE INDEX performance_bolo_id_idx
  ON public.performance (bolo_id) WHERE bolo_id IS NOT NULL;

COMMENT ON COLUMN public.performance.bolo_id IS
  'The deal (ADR-087) this function belongs to. The performance is scheduling; money hangs off the bolo. Nullable: a function not yet tied to a deal.';

-- ── backfill: each existing performance → one N=1 bolo ───────────────────────
-- No triggers on the bolo yet (created below) so the backfill writes no audit
-- noise and needs no auth.uid(). MATERIALIZED so the generated bolo ids are
-- computed once and shared between the INSERT and the linking UPDATE.
WITH src AS MATERIALIZED (
  SELECT
    pf.id                            AS performance_id,
    public.uuid_generate_v7()        AS bolo_id,
    pf.workspace_id,
    pf.project_id,
    pf.line_id,
    pf.conversation_id,
    pf.venue_name,
    pf.city,
    pf.country,
    pf.fee_amount,
    coalesce(pf.fee_currency, 'EUR') AS fee_currency,
    pf.status,
    pf.created_by,
    pf.created_at,
    pf.updated_at,
    pf.deleted_at
  FROM public.performance pf
),
ins AS (
  INSERT INTO public.bolo (
    id, workspace_id, project_id, line_id, conversation_id,
    venue_name, city, country, fee_amount, fee_currency, status,
    created_by, created_at, updated_at, deleted_at
  )
  SELECT
    bolo_id, workspace_id, project_id, line_id, conversation_id,
    venue_name, city, country, fee_amount, fee_currency, status,
    created_by, created_at, updated_at, deleted_at
  FROM src
)
UPDATE public.performance pf
SET bolo_id = src.bolo_id
FROM src
WHERE pf.id = src.performance_id;

-- Now attach the uniform conventions (auto-bump updated_at, audit trail).
CREATE TRIGGER bolo_set_updated_at
BEFORE UPDATE ON public.bolo
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER bolo_audit
AFTER INSERT OR DELETE OR UPDATE ON public.bolo
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── move the fee off the performance ─────────────────────────────────────────
-- performance_redacted existed only to mask the fee by read:money; with the fee
-- gone from the performance it has no purpose and nothing queries it (the money
-- reads go through RPCs). Drop it before the columns it depends on.
DROP VIEW IF EXISTS public.performance_redacted;

-- The fee-column write guard (ADR-043) fired on every performance UPDATE and
-- referenced these columns; retire it with them. The bolo's fee keeps its own
-- edit:money gate in update_bolo_fee.
DROP TRIGGER IF EXISTS performance_guard_fee_columns ON public.performance;
DROP FUNCTION IF EXISTS public.guard_performance_fee_columns();

ALTER TABLE public.performance DROP CONSTRAINT IF EXISTS performance_currency_format;
ALTER TABLE public.performance
  DROP COLUMN fee_amount,
  DROP COLUMN fee_currency;

-- update_performance_fee wrote those columns; it is replaced by update_bolo_fee.
DROP FUNCTION IF EXISTS public.update_performance_fee(uuid, numeric, text);

-- ── invoice_line: re-anchor from the function to the deal ────────────────────
-- An invoice bills a deal, so its line references the bolo. Rename in place,
-- re-point the FK, and remap existing rows (line held a performance id → its
-- bolo). The linking UPDATE reads the OLD value (a performance id) and writes
-- the NEW one (that performance's bolo).
ALTER TABLE public.invoice_line RENAME COLUMN performance_id TO bolo_id;
ALTER TABLE public.invoice_line DROP CONSTRAINT IF EXISTS invoice_line_performance_id_fkey;

UPDATE public.invoice_line il
SET bolo_id = pf.bolo_id
FROM public.performance pf
WHERE pf.id = il.bolo_id;

ALTER TABLE public.invoice_line
  ADD CONSTRAINT invoice_line_bolo_id_fkey
  FOREIGN KEY (bolo_id) REFERENCES public.bolo(id) ON DELETE SET NULL;

ALTER INDEX invoice_line_performance_idx RENAME TO invoice_line_bolo_idx;

COMMENT ON COLUMN public.invoice_line.bolo_id IS
  'The deal this line bills (ADR-087). Was performance_id in money v2; each performance backfilled to one bolo.';

-- ── expense: re-anchor the gig-level cost from the function to the deal ───────
-- No scheduling surface reads per-function expenses (money-only, ADR-056); a
-- gig cost is a cost of the deal (ADR-087). line-anchored expenses are
-- unchanged. Rename in place, remap (performance id → its bolo), re-point the FK
-- and the read/write helpers.
ALTER TABLE public.expense RENAME COLUMN performance_id TO bolo_id;
ALTER TABLE public.expense DROP CONSTRAINT IF EXISTS expense_performance_id_fkey;

UPDATE public.expense e
SET bolo_id = pf.bolo_id
FROM public.performance pf
WHERE pf.id = e.bolo_id;

ALTER TABLE public.expense
  ADD CONSTRAINT expense_bolo_id_fkey
  FOREIGN KEY (bolo_id) REFERENCES public.bolo(id) ON DELETE CASCADE;

ALTER INDEX expense_performance_idx RENAME TO expense_bolo_idx;

COMMENT ON COLUMN public.expense.bolo_id IS
  'The deal this cost is anchored to (ADR-087). Was performance_id in money v2; exactly one of bolo_id / line_id (expense_exactly_one_parent).';

-- The read helper joins the effective project through the bolo now.
CREATE OR REPLACE FUNCTION public.project_id_of_expense(p_expense_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT b.project_id FROM public.bolo b JOIN public.expense e ON e.bolo_id = b.id WHERE e.id = p_expense_id),
    (SELECT l.project_id FROM public.line l JOIN public.expense e ON e.line_id = l.id WHERE e.id = p_expense_id)
  );
$$;

-- The write policies resolve the project through the bolo (was performance).
DROP POLICY IF EXISTS expense_insert ON public.expense;
CREATE POLICY expense_insert ON public.expense
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_permission(
      COALESCE(
        (SELECT b.project_id FROM public.bolo b WHERE b.id = expense.bolo_id),
        (SELECT l.project_id FROM public.line l WHERE l.id = expense.line_id)
      ), 'edit:money')
  );

DROP POLICY IF EXISTS expense_update ON public.expense;
CREATE POLICY expense_update ON public.expense
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND public.has_permission(public.project_id_of_expense(id), 'edit:money'))
  WITH CHECK (
    public.has_permission(
      COALESCE(
        (SELECT b.project_id FROM public.bolo b WHERE b.id = expense.bolo_id),
        (SELECT l.project_id FROM public.line l WHERE l.id = expense.line_id)
      ), 'edit:money')
  );

-- list_expenses_for_scope: the gig filter becomes a bolo filter (param rename
-- forces a DROP + CREATE). Reads still require read:money on the effective project.
DROP FUNCTION public.list_expenses_for_scope(uuid[], uuid[], uuid[], uuid[], public.expense_category, integer);

CREATE FUNCTION public.list_expenses_for_scope(
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

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
          AND public.has_permission(l.project_id, 'read:money')
      )
      OR EXISTS (
        SELECT 1
        FROM public.bolo b
        WHERE b.id = e.bolo_id
          AND b.deleted_at IS NULL
          AND public.has_permission(b.project_id, 'read:money')
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

REVOKE ALL ON FUNCTION public.list_expenses_for_scope(
  uuid[], uuid[], uuid[], uuid[], public.expense_category, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_expenses_for_scope(
  uuid[], uuid[], uuid[], uuid[], public.expense_category, integer
) TO authenticated;

-- delete_expense: resolve the project through the bolo (was performance).
CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(b.project_id, l.project_id) INTO v_project_id
  FROM public.expense e
  LEFT JOIN public.bolo b ON b.id = e.bolo_id
  LEFT JOIN public.line l ON l.id = e.line_id
  WHERE e.id = p_expense_id AND e.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'expense not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.expense SET deleted_at = now()
  WHERE id = p_expense_id AND deleted_at IS NULL;
END;
$$;

-- ── delete_performance: drop the live-invoice guard ──────────────────────────
-- Invoices attach to the bolo now, not the function, so deleting a function no
-- longer risks orphaning an invoice — that guard moves to delete_bolo below.
CREATE OR REPLACE FUNCTION public.delete_performance(p_performance_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'performance % not found', p_performance_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.performance
  SET deleted_at = now()
  WHERE id = p_performance_id;
END;
$$;

-- ── bolo write RPCs ──────────────────────────────────────────────────────────
-- create_bolo: record a deal (from a confirmed conversation, or by hand).
-- Gated on edit:money — the bolo is money, not scheduling, so it needs no
-- edit:performance (unlike the old fee path, which lived on the function).
CREATE FUNCTION public.create_bolo(
  p_project_id uuid,
  p_venue_name text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_fee_amount numeric DEFAULT NULL,
  p_fee_currency text DEFAULT 'EUR',
  p_line_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_status public.performance_status DEFAULT 'confirmed'
) RETURNS public.bolo
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_currency     text := upper(coalesce(nullif(btrim(p_fee_currency), ''), 'EUR'));
  v_country      text := upper(nullif(btrim(p_country), ''));
  v_bolo         public.bolo;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL OR NOT public.has_permission(p_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'project not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line is not in the project' USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND workspace_id = v_workspace_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation is not in the workspace' USING ERRCODE = '42501';
  END IF;

  IF p_fee_amount IS NOT NULL AND (p_fee_amount < 0 OR p_fee_amount > 9999999999.99) THEN
    RAISE EXCEPTION 'fee amount out of range' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'fee currency must be an ISO 4217 code' USING ERRCODE = '22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be a 2-letter code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bolo (
    workspace_id, project_id, line_id, conversation_id,
    venue_name, city, country, fee_amount, fee_currency, status, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_conversation_id,
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    v_country,
    p_fee_amount,
    v_currency::character(3),
    coalesce(p_status, 'confirmed'),
    v_caller
  ) RETURNING * INTO v_bolo;

  RETURN v_bolo;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bolo(uuid, text, text, text, numeric, text, uuid, uuid, public.performance_status)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_bolo(uuid, text, text, text, numeric, text, uuid, uuid, public.performance_status)
  TO authenticated;

-- update_bolo_fee: set/clear the deal's fee. Mirrors the old update_performance_fee
-- return shape (id, fee_amount, fee_currency) so the money endpoint changes only
-- the RPC name and id param. edit:money only.
CREATE FUNCTION public.update_bolo_fee(
  p_bolo_id uuid,
  p_fee_amount numeric,
  p_fee_currency text DEFAULT 'EUR'
) RETURNS TABLE (
  id uuid,
  fee_amount numeric,
  fee_currency character(3)
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_currency   text;
BEGIN
  SELECT b.project_id INTO v_project_id
  FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'bolo not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_fee_amount IS NOT NULL AND (p_fee_amount < 0 OR p_fee_amount > 9999999999.99) THEN
    RAISE EXCEPTION 'fee amount out of range' USING ERRCODE = '22023';
  END IF;

  v_currency := upper(coalesce(nullif(btrim(p_fee_currency), ''), 'EUR'));
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'fee currency must be an ISO 4217 code' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.bolo b
  SET fee_amount = p_fee_amount,
      fee_currency = v_currency::character(3),
      updated_at = now()
  WHERE b.id = p_bolo_id AND b.deleted_at IS NULL
  RETURNING b.id, b.fee_amount, b.fee_currency;
END;
$$;

REVOKE ALL ON FUNCTION public.update_bolo_fee(uuid, numeric, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_bolo_fee(uuid, numeric, text)
  TO authenticated;

-- delete_bolo: soft-delete a deal, blocked while it carries a live invoice
-- (the guard that used to live on delete_performance, ADR-050 integrity).
CREATE FUNCTION public.delete_bolo(p_bolo_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_project_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.bolo WHERE id = p_bolo_id AND deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'bolo % not found', p_bolo_id USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_line il
    JOIN public.invoice i ON i.id = il.invoice_id
    WHERE il.bolo_id = p_bolo_id
      AND i.deleted_at IS NULL
      AND i.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'bolo has invoices — discard or cancel them first'
      USING ERRCODE = '23503';
  END IF;

  -- Payments anchored directly to the deal are collected money; deleting the
  -- bolo would silently drop them from every report. Block on them too.
  IF EXISTS (
    SELECT 1 FROM public.payment
    WHERE bolo_id = p_bolo_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'bolo has recorded payments — remove them first'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.bolo SET deleted_at = now() WHERE id = p_bolo_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_bolo(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bolo(uuid) TO authenticated;
