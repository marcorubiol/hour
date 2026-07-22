-- Money v3 (ADR-086) — Phase 2a: the invoice becomes a real emitted document.
-- Additive only: doc_type (factura|proforma), frozen issuer + payer snapshots
-- (ADR-050 semantics extended to the fiscal identity), provenance FKs, and the
-- auto-correlative numbering series (two series: legal by issuer identity+year,
-- proforma by workspace+year). No existing behaviour changes — the issue path
-- and create_invoice v3 that consume these land in Phase 2b.

-- ── invoice: document type, snapshots, provenance ───────────────────────────
ALTER TABLE public.invoice
  ADD COLUMN doc_type text NOT NULL DEFAULT 'factura',
  ADD COLUMN issuer_fiscal_identity_id uuid REFERENCES public.fiscal_identity(id) ON DELETE SET NULL,
  ADD COLUMN payer_fiscal_identity_id  uuid REFERENCES public.fiscal_identity(id) ON DELETE SET NULL,
  ADD COLUMN issuer_snapshot jsonb,
  ADD COLUMN payer_snapshot  jsonb;

ALTER TABLE public.invoice
  ADD CONSTRAINT invoice_doc_type_valid CHECK (doc_type IN ('factura', 'proforma'));

COMMENT ON COLUMN public.invoice.doc_type IS
  'factura (legal, invoicing_mode=legal) | proforma (invoicing_mode=interno). Existing rows default to factura.';
COMMENT ON COLUMN public.invoice.issuer_fiscal_identity_id IS
  'Provenance: which issuer identity produced this document. The printed data is frozen in issuer_snapshot at issue time (ADR-050).';
COMMENT ON COLUMN public.invoice.payer_fiscal_identity_id IS
  'Provenance: the receiver identity. Frozen in payer_snapshot at issue time; may be absent for a proforma.';
COMMENT ON COLUMN public.invoice.issuer_snapshot IS
  'Frozen copy of the issuer fiscal identity (legal_name, tax_id, structured address, iban, swift_bic) at issue. The document renders from this, not the live row.';
COMMENT ON COLUMN public.invoice.payer_snapshot IS
  'Frozen copy of the receiver fiscal identity at issue. Null in off/interno modes where the receiver is just a name.';

CREATE INDEX invoice_issuer_fiscal_identity_id_idx
  ON public.invoice (issuer_fiscal_identity_id) WHERE issuer_fiscal_identity_id IS NOT NULL;
CREATE INDEX invoice_payer_fiscal_identity_id_idx
  ON public.invoice (payer_fiscal_identity_id) WHERE payer_fiscal_identity_id IS NOT NULL;

-- Once assigned (free-text at creation, or a series number at issue), an
-- invoice number is immutable — a fiscal document's correlative cannot be
-- rewritten. issue_invoice assigns NULL -> value, which this allows.
CREATE OR REPLACE FUNCTION public.guard_immutable_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'invoice number is immutable once assigned' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_immutable_invoice_number()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER invoice_guard_immutable_number
BEFORE UPDATE OF number ON public.invoice
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_invoice_number();

-- ── numbering series (internal counter, RPC-only) ───────────────────────────
-- scope_ref normalises the two series into one unique key so the atomic
-- upsert-counter can target it: legal → issuer fiscal_identity, proforma →
-- workspace. Numbers are assigned only at issue (a draft has no number).
CREATE TABLE public.invoice_number_series (
  id                 uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id       uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  scope_kind         text NOT NULL,
  fiscal_identity_id uuid REFERENCES public.fiscal_identity(id) ON DELETE CASCADE,
  scope_ref          uuid NOT NULL,
  year               integer NOT NULL,
  next_seq           integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_series_scope_kind_valid CHECK (scope_kind IN ('legal', 'proforma')),
  CONSTRAINT invoice_series_scope_shape CHECK (
    (scope_kind = 'legal'    AND fiscal_identity_id IS NOT NULL AND scope_ref = fiscal_identity_id)
    OR (scope_kind = 'proforma' AND fiscal_identity_id IS NULL     AND scope_ref = workspace_id)
  ),
  CONSTRAINT invoice_series_year_valid CHECK (year BETWEEN 2000 AND 2200),
  CONSTRAINT invoice_series_next_seq_positive CHECK (next_seq >= 1),
  CONSTRAINT invoice_series_unique UNIQUE (scope_kind, scope_ref, year)
);

COMMENT ON TABLE public.invoice_number_series IS
  'Internal auto-correlative counters (ADR-086 D5). Two series: legal by issuer fiscal_identity + year, proforma by workspace + year. Accessed only through next_invoice_number (SECURITY DEFINER); no direct Data API surface.';

CREATE INDEX invoice_number_series_workspace_id_idx
  ON public.invoice_number_series (workspace_id);
CREATE INDEX invoice_number_series_fiscal_identity_id_idx
  ON public.invoice_number_series (fiscal_identity_id) WHERE fiscal_identity_id IS NOT NULL;

CREATE TRIGGER invoice_number_series_set_updated_at
BEFORE UPDATE ON public.invoice_number_series
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.invoice_number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_number_series FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_number_series FROM PUBLIC, anon, authenticated;

-- Atomic counter: one upsert bumps and returns the number to use. Concurrency
-- safe — the ON CONFLICT DO UPDATE takes the row lock. Called only from the
-- issue path (Phase 2b); not exposed to any client role.
CREATE OR REPLACE FUNCTION public.next_invoice_number(
  p_workspace_id uuid,
  p_doc_type text,
  p_fiscal_identity_id uuid,
  p_year integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_scope_kind text := CASE WHEN p_doc_type = 'factura' THEN 'legal' ELSE 'proforma' END;
  v_prefix     text := CASE WHEN p_doc_type = 'factura' THEN 'FAC' ELSE 'PRO' END;
  v_scope_ref  uuid := CASE WHEN v_scope_kind = 'legal' THEN p_fiscal_identity_id ELSE p_workspace_id END;
  v_seq        integer;
BEGIN
  IF p_doc_type NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'doc_type must be factura or proforma' USING ERRCODE = '22023';
  END IF;
  IF v_scope_kind = 'legal' AND p_fiscal_identity_id IS NULL THEN
    RAISE EXCEPTION 'a legal invoice requires an issuer fiscal identity' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_number_series (
    workspace_id, scope_kind, fiscal_identity_id, scope_ref, year, next_seq
  ) VALUES (
    p_workspace_id, v_scope_kind,
    CASE WHEN v_scope_kind = 'legal' THEN p_fiscal_identity_id ELSE NULL END,
    v_scope_ref, p_year, 2
  )
  ON CONFLICT (scope_kind, scope_ref, year) DO UPDATE
    SET next_seq = public.invoice_number_series.next_seq + 1, updated_at = now()
  RETURNING next_seq - 1 INTO v_seq;

  RETURN v_prefix || ' ' || p_year::text || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, text, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
