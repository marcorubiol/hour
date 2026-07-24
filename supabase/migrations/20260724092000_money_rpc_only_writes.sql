-- Close the Data API forge path on fiscal documents (hardening audit 2026-07-24).
--
-- money v3 shipped a careful RPC layer — issue_invoice assigns the correlative
-- atomically through next_invoice_number and freezes the issuer/payer snapshots
-- — but never revoked direct table writes. invoice / invoice_line / payment kept
-- `GRANT ALL TO authenticated`, gated only by RLS on edit:money. So a user with
-- edit:money in their OWN tenant could bypass the whole thing with one call:
--
--   PATCH /rest/v1/invoice?id=eq.<uuid>  {"status":"issued","number":"FAC 2026-0001"}
--
-- RLS passes; guard_immutable_invoice_number allows NULL→value; there was no
-- unique constraint on the number. Result: a forged or duplicated fiscal
-- correlative with empty snapshots, never issued through the series. Direct
-- payment inserts likewise skipped create_payment's "payments require an issued
-- invoice" check.
--
-- This is the same hole that was deliberately closed for workspace_membership
-- on 2026-07-20 ("writes are RPC-only"); money v3 simply never got the same
-- treatment. Fix: revoke the direct writes and route the one legitimate direct
-- PATCH (invoice metadata) through a new RPC.
--
-- Not in scope: `expense`. It carries no numbering or snapshot invariant, its
-- direct PATCH is legitimately gated by edit:money, and revoking it would break
-- PATCH /api/expenses/:id for no security gain. Left deliberately.

-- ── invoice metadata patch, the sanctioned direct-UPDATE replacement ─────────
-- Whitelisted fields only. `number` is never writable here (issue_invoice owns
-- it) and `status` accepts only draft/cancelled — moving to 'issued' must go
-- through issue_invoice so the correlative and snapshots are real, and 'paid'
-- is derived by the payment sync trigger, never set by hand.
CREATE OR REPLACE FUNCTION public.update_invoice(
  p_invoice_id uuid,
  p_patch jsonb
) RETURNS public.invoice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inv    public.invoice;
  v_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty patch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_inv.id IS NULL OR NOT (
    (v_inv.project_id IS NOT NULL AND public.has_permission(v_inv.project_id, 'edit:money'))
    OR (v_inv.project_id IS NULL AND public.is_workspace_admin(v_inv.workspace_id))
  ) THEN
    RAISE EXCEPTION 'invoice not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'number' THEN
    RAISE EXCEPTION 'invoice numbers are assigned by issue_invoice(), not by hand'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'status' THEN
    v_status := p_patch->>'status';
    IF v_status = 'issued' THEN
      RAISE EXCEPTION 'issue an invoice through issue_invoice() so it gets a real correlative and frozen snapshots'
        USING ERRCODE = '42501';
    END IF;
    IF v_status = 'paid' THEN
      RAISE EXCEPTION 'paid is derived from payments, not set directly' USING ERRCODE = '42501';
    END IF;
    IF v_status NOT IN ('draft', 'cancelled') THEN
      RAISE EXCEPTION 'status must be draft or cancelled' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.invoice SET
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch->>'status')::public.invoice_status ELSE status END,
    due_on = CASE WHEN p_patch ? 'due_on'
      THEN nullif(p_patch->>'due_on', '')::date ELSE due_on END,
    expected_on = CASE WHEN p_patch ? 'expected_on'
      THEN nullif(p_patch->>'expected_on', '')::date ELSE expected_on END,
    payment_condition = CASE WHEN p_patch ? 'payment_condition'
      THEN nullif(btrim(coalesce(p_patch->>'payment_condition', '')), '') ELSE payment_condition END,
    payer_person_id = CASE WHEN p_patch ? 'payer_person_id'
      THEN nullif(p_patch->>'payer_person_id', '')::uuid ELSE payer_person_id END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN nullif(btrim(coalesce(p_patch->>'notes', '')), '') ELSE notes END
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

COMMENT ON FUNCTION public.update_invoice(uuid, jsonb) IS
  'Whitelisted invoice metadata patch (hardening audit 2026-07-24). Replaces the direct PostgREST UPDATE: number is never writable and status cannot reach issued (issue_invoice) or paid (derived).';

REVOKE ALL ON FUNCTION public.update_invoice(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_invoice(uuid, jsonb) TO authenticated;

-- ── revoke the direct write path ────────────────────────────────────────────
-- SECURITY DEFINER RPCs are unaffected: their bodies run with the function
-- owner's privileges, which is exactly how workspace_membership already works.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.invoice      FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.invoice_line FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment      FROM authenticated, anon;

COMMENT ON TABLE public.invoice IS
  'Fiscal document. Writes are RPC-only (create_invoice_from_bolo / issue_invoice / update_invoice / delete_invoice) — direct Data API writes revoked 2026-07-24 so the correlative series and the issuer/payer snapshot freeze cannot be bypassed.';
COMMENT ON TABLE public.payment IS
  'Observed money in. Writes are RPC-only (create_payment / delete_payment) — direct Data API writes revoked 2026-07-24 so the issued-invoice guard and idempotency cannot be bypassed.';

-- ── defence in depth: no duplicate correlatives, whatever the path ──────────
-- next_invoice_number is atomic, so this should never fire; it exists so a
-- future direct-write regression fails loudly at the storage layer instead of
-- silently minting a second "FAC 2026-0001".
CREATE UNIQUE INDEX invoice_number_unique_per_scope_uidx
  ON public.invoice (workspace_id, doc_type, number)
  WHERE number IS NOT NULL AND deleted_at IS NULL;
