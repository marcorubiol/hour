-- Money v3 (ADR-087 · grill 2026-07-23) — Phase 2a′: taxes become country-agnostic.
-- The invoice stops hardcoding Spain's IVA/IRPF as fixed header columns. Instead a
-- document carries N generic `invoice_tax_line`s — each a signed rate line
-- (add | withhold | exempt) — and snapshots the `country` whose regime it was
-- issued under. Spain is just the first preset (IVA add + IRPF withhold, or an
-- exempt line for cross-border); France (TVA) and others plug in later with NO
-- change to this core. total = subtotal + Σ(signed line).
-- Rationale (grill): the tax/legal last mile is inherently per-country, so the
-- money core must not bake one country in. Runs before the issue path (Phase 2b),
-- which rewires create_invoice_from_bolo onto these lines.

-- ── invoice: snapshot the regime, drop the hardcoded ES tax columns ──────────
ALTER TABLE public.invoice
  ADD COLUMN country character(2);

ALTER TABLE public.invoice
  ADD CONSTRAINT invoice_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN public.invoice.country IS
  'ISO-3166-1 alpha-2 of the tax regime this document was issued under (snapshot). Selects the preset/legal adapter; the breakdown itself lives in invoice_tax_line. Null = regime unresolved.';

ALTER TABLE public.invoice
  DROP COLUMN vat_pct,
  DROP COLUMN vat_amount,
  DROP COLUMN irpf_pct,
  DROP COLUMN irpf_amount;

-- ── invoice_tax_line: one signed rate line of a document ─────────────────────
-- kind: add (+, e.g. IVA/TVA) · withhold (−, e.g. IRPF retención) · exempt (0,
-- e.g. intra-EU reverse charge / export — a legal reason, not a rate).
-- base_amount + amount are frozen at creation (ADR-050 snapshot semantics).
CREATE TABLE public.invoice_tax_line (
  id            uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL REFERENCES public.invoice(id) ON DELETE CASCADE,
  label         text NOT NULL,
  kind          text NOT NULL,
  rate_pct      numeric(6,3) NOT NULL DEFAULT 0,
  base_amount   numeric(12,2) NOT NULL,
  amount        numeric(12,2) NOT NULL,
  exempt_reason text,
  ordinal       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_tax_line_label_nonempty CHECK (length(btrim(label)) > 0),
  CONSTRAINT invoice_tax_line_kind_valid CHECK (kind IN ('add', 'withhold', 'exempt')),
  CONSTRAINT invoice_tax_line_rate_range CHECK (rate_pct >= 0 AND rate_pct <= 100),
  CONSTRAINT invoice_tax_line_exempt_reason CHECK (
    kind <> 'exempt' OR length(btrim(coalesce(exempt_reason, ''))) > 0
  ),
  CONSTRAINT invoice_tax_line_amount_sign CHECK (
    (kind = 'add' AND amount >= 0)
    OR (kind = 'withhold' AND amount <= 0)
    OR (kind = 'exempt' AND amount = 0)
  )
);

COMMENT ON TABLE public.invoice_tax_line IS
  'Generic per-document tax lines (grill 2026-07-23). A signed rate line: add (+IVA/TVA), withhold (−IRPF), or exempt (0 + legal reason). Country-agnostic core; the preset that builds these is an app-layer, per-country concern. total = subtotal + Σ(amount). Written only through create_invoice_from_bolo.';

CREATE INDEX invoice_tax_line_invoice_idx ON public.invoice_tax_line (invoice_id);
CREATE INDEX invoice_tax_line_workspace_idx ON public.invoice_tax_line (workspace_id);

ALTER TABLE public.invoice_tax_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_tax_line FORCE ROW LEVEL SECURITY;

-- Mirror invoice_line exactly: read gated on read:money, write on edit:money,
-- both resolved through the parent invoice's project (a workspace-scoped invoice
-- falls back to owner/admin).
CREATE POLICY invoice_tax_line_select ON public.invoice_tax_line
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_tax_line.invoice_id
      AND i.deleted_at IS NULL
      AND (
        (i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'read:money'))
        OR (i.project_id IS NULL AND EXISTS (
          SELECT 1 FROM public.workspace_membership m
          WHERE m.workspace_id = i.workspace_id
            AND m.user_id = (SELECT auth.uid())
            AND m.accepted_at IS NOT NULL
            AND m.role = ANY (ARRAY['owner'::public.membership_role, 'admin'::public.membership_role])
        ))
      )
  ));

CREATE POLICY invoice_tax_line_insert ON public.invoice_tax_line
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_tax_line.invoice_id
      AND i.workspace_id = invoice_tax_line.workspace_id
      AND (
        (i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'edit:money'))
        OR (i.project_id IS NULL AND public.current_workspace_role() = ANY (ARRAY['owner'::public.membership_role, 'admin'::public.membership_role]))
      )
  ));

CREATE POLICY invoice_tax_line_update ON public.invoice_tax_line
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_tax_line.invoice_id
      AND (
        (i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'edit:money'))
        OR (i.project_id IS NULL AND public.current_workspace_role() = ANY (ARRAY['owner'::public.membership_role, 'admin'::public.membership_role]))
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_tax_line.invoice_id
      AND i.workspace_id = invoice_tax_line.workspace_id
      AND (
        (i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'edit:money'))
        OR (i.project_id IS NULL AND public.current_workspace_role() = ANY (ARRAY['owner'::public.membership_role, 'admin'::public.membership_role]))
      )
  ));

CREATE POLICY invoice_tax_line_delete ON public.invoice_tax_line
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_tax_line.invoice_id
      AND (
        (i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'edit:money'))
        OR (i.project_id IS NULL AND public.current_workspace_role() = ANY (ARRAY['owner'::public.membership_role, 'admin'::public.membership_role]))
      )
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_tax_line TO authenticated;
