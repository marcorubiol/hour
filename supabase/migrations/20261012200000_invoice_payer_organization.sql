-- ADR-102 fase 2b · Books: el pagador es la organización (decisión 5).
--
-- Hasta hoy la factura apuntaba a una persona (`payer_person_id`, inferida de
-- `conversation.person_id`) y, aparte, a una identidad fiscal receptora
-- (`payer_fiscal_identity_id`, que `issue_invoice` congela en
-- `payer_snapshot`). La conversación es ya con la sala (fase 1), así que el
-- pagador pasa a ser la organización de la conversación del bolo, con sus
-- datos fiscales.
--
--   1. `invoice.payer_organization_id`, FK compuesta a workspace_organization
--      (mismo espacio por construcción).
--   2. `workspace_organization.fiscal_identity_id`: los datos fiscales de la
--      sala. Mismo patrón que `workspace.fiscal_identity_id` para el emisor.
--      Un guard exige una receptora viva del mismo espacio.
--   3. Relleno inocuo: una factura con `payer_person_id` toma la organización
--      de ese dossier (0 en producción el 2026-10-11).
--   4. `can_edit_workspace_money(ws)`: quién edita dinero en un espacio (owner
--      o admin, o `edit:money` en algún proyecto suyo). Gobierna los datos
--      fiscales de una organización, que no cuelgan de ningún proyecto.
--   5. `set_organization_fiscal_identity`: crea o edita la receptora de una
--      organización. La única vía de escritura (fiscal_identity no tiene
--      grants de escritura para `authenticated`).
--   6. `create_invoice_from_bolo` infiere la organización (con el filtro de
--      privacidad de ADR-099 §4) y, sin identidad fiscal explícita, toma la de
--      la organización. Firma NUEVA con `p_payer_organization_id DEFAULT
--      NULL` al final: el Worker desplegado, que llama con `p_payer_person_id`
--      y sin el parámetro nuevo, sigue resolviendo a esta función entre la
--      migración y el deploy. `p_payer_person_id` sigue aceptándose y
--      escribiéndose igual que antes hasta la fase 4.
--   7. `update_invoice` acepta `payer_organization_id` (solo en borrador): fija
--      la organización y con ella su identidad fiscal.
--   8. `list_money_payer_organizations`: función NUEVA. `list_money_payers`
--      (personas) se queda intacta para el Worker desplegado; la borra la
--      fase 4.
--
-- `issue_invoice` no cambia. `payer_person_id` se queda hasta la fase 4.
-- Rollback: build/runbooks/rollback-20261012-invoice-payer-organization.sql

-- ── 1 · invoice.payer_organization_id ─────────────────────────────────────
ALTER TABLE public.invoice
  ADD COLUMN payer_organization_id uuid;

ALTER TABLE public.invoice
  ADD CONSTRAINT invoice_workspace_payer_organization_fkey
  FOREIGN KEY (workspace_id, payer_organization_id)
  REFERENCES public.workspace_organization (workspace_id, id)
  ON DELETE SET NULL (payer_organization_id);

CREATE INDEX invoice_workspace_payer_organization_idx
  ON public.invoice (workspace_id, payer_organization_id)
  WHERE payer_organization_id IS NOT NULL;

COMMENT ON COLUMN public.invoice.payer_organization_id IS
  'Who pays: the organization of the bolo''s conversation (ADR-102 decision 5). Set by create_invoice_from_bolo / update_invoice. Replaces payer_person_id, dropped in phase 4.';

-- ── 2 · workspace_organization.fiscal_identity_id ─────────────────────────
ALTER TABLE public.workspace_organization
  ADD COLUMN fiscal_identity_id uuid
  REFERENCES public.fiscal_identity (id) ON DELETE SET NULL;

CREATE INDEX workspace_organization_fiscal_identity_id_idx
  ON public.workspace_organization (fiscal_identity_id)
  WHERE fiscal_identity_id IS NOT NULL;

COMMENT ON COLUMN public.workspace_organization.fiscal_identity_id IS
  'The organization''s receiver fiscal identity (ADR-102 phase 2b): a live kind=receiver fiscal_identity of the same workspace. Written by set_organization_fiscal_identity; create_invoice_from_bolo takes it as the payer''s by default.';

CREATE FUNCTION private.guard_organization_fiscal_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.fiscal_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = NEW.fiscal_identity_id
      AND fi.workspace_id = NEW.workspace_id
      AND fi.kind = 'receiver'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'fiscal_identity_id must be a live receiver identity of the same workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_organization_fiscal_identity() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER workspace_organization_guard_fiscal_identity
  BEFORE INSERT OR UPDATE OF fiscal_identity_id, workspace_id ON public.workspace_organization
  FOR EACH ROW EXECUTE FUNCTION private.guard_organization_fiscal_identity();

-- ── 3 · relleno ───────────────────────────────────────────────────────────
UPDATE public.invoice i
SET payer_organization_id = wp.organization_id
FROM public.workspace_person wp
WHERE i.payer_person_id IS NOT NULL
  AND i.payer_organization_id IS NULL
  AND wp.workspace_id = i.workspace_id
  AND wp.person_id = i.payer_person_id
  AND wp.organization_id IS NOT NULL;

-- ── 4 · can_edit_workspace_money ──────────────────────────────────────────
CREATE FUNCTION public.can_edit_workspace_money(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_workspace_id IS NOT NULL
    AND public.is_workspace_internal_member(p_workspace_id)
    AND (
      public.is_workspace_admin(p_workspace_id)
      OR EXISTS (
        SELECT 1 FROM public.project p
        WHERE p.workspace_id = p_workspace_id
          AND p.deleted_at IS NULL
          AND public.has_permission(p.id, 'edit:money')
      )
    );
$function$;

COMMENT ON FUNCTION public.can_edit_workspace_money(uuid) IS
  'Whether the caller edits money somewhere in this workspace: an internal member who is owner/admin or holds edit:money on one of its projects. The write twin of can_read_workspace_money, for workspace-level money data (an organization''s fiscal identity, ADR-102 phase 2b).';

REVOKE ALL ON FUNCTION public.can_edit_workspace_money(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_workspace_money(uuid) TO authenticated;

-- ── 5 · set_organization_fiscal_identity ──────────────────────────────────
CREATE FUNCTION public.set_organization_fiscal_identity(p_organization_id uuid, p_fiscal jsonb)
 RETURNS fiscal_identity
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_org     public.workspace_organization;
  v_fi      public.fiscal_identity;
  v_legal   text;
  v_country text;
  v_key     text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_fiscal IS NULL OR jsonb_typeof(p_fiscal) <> 'object' THEN
    RAISE EXCEPTION 'fiscal must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org
  FROM public.workspace_organization
  WHERE id = p_organization_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_org.id IS NULL OR NOT public.can_edit_workspace_money(v_org.workspace_id) THEN
    RAISE EXCEPTION 'organization not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  v_legal := btrim(coalesce(p_fiscal->>'legal_name', ''));
  IF v_legal = '' THEN
    RAISE EXCEPTION 'legal_name is required' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['legal_name', 'tax_id', 'address_line_1', 'address_line_2', 'postal_code', 'city', 'region']
  LOOP
    IF length(coalesce(p_fiscal->>v_key, '')) > 300 THEN
      RAISE EXCEPTION '% is too long', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_country := upper(nullif(btrim(coalesce(p_fiscal->>'country', '')), ''));
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be an ISO alpha-2 code' USING ERRCODE = '22023';
  END IF;

  -- The organization's own identity, if it still has a live one; the guard
  -- already keeps it a receiver of this workspace.
  IF v_org.fiscal_identity_id IS NOT NULL THEN
    SELECT * INTO v_fi
    FROM public.fiscal_identity
    WHERE id = v_org.fiscal_identity_id
      AND workspace_id = v_org.workspace_id
      AND kind = 'receiver'
      AND deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF v_fi.id IS NULL THEN
    INSERT INTO public.fiscal_identity (
      workspace_id, kind, label, legal_name, tax_id, address_line_1, address_line_2,
      postal_code, city, region, country, created_by
    ) VALUES (
      v_org.workspace_id, 'receiver', '', v_legal,
      nullif(btrim(coalesce(p_fiscal->>'tax_id', '')), ''),
      nullif(btrim(coalesce(p_fiscal->>'address_line_1', '')), ''),
      nullif(btrim(coalesce(p_fiscal->>'address_line_2', '')), ''),
      nullif(btrim(coalesce(p_fiscal->>'postal_code', '')), ''),
      nullif(btrim(coalesce(p_fiscal->>'city', '')), ''),
      nullif(btrim(coalesce(p_fiscal->>'region', '')), ''),
      v_country,
      v_caller
    ) RETURNING * INTO v_fi;

    UPDATE public.workspace_organization
    SET fiscal_identity_id = v_fi.id
    WHERE id = v_org.id;
  ELSE
    -- Issued invoices froze their own snapshot: editing in place only reaches
    -- drafts, which is what a correction should do.
    UPDATE public.fiscal_identity SET
      legal_name     = v_legal,
      tax_id         = nullif(btrim(coalesce(p_fiscal->>'tax_id', '')), ''),
      address_line_1 = nullif(btrim(coalesce(p_fiscal->>'address_line_1', '')), ''),
      address_line_2 = nullif(btrim(coalesce(p_fiscal->>'address_line_2', '')), ''),
      postal_code    = nullif(btrim(coalesce(p_fiscal->>'postal_code', '')), ''),
      city           = nullif(btrim(coalesce(p_fiscal->>'city', '')), ''),
      region         = nullif(btrim(coalesce(p_fiscal->>'region', '')), ''),
      country        = v_country
    WHERE id = v_fi.id
    RETURNING * INTO v_fi;
  END IF;

  RETURN v_fi;
END;
$function$;

COMMENT ON FUNCTION public.set_organization_fiscal_identity(uuid, jsonb) IS
  'Create or edit an organization''s receiver fiscal identity (ADR-102 phase 2b). jsonb: legal_name (required), tax_id, address_line_1, address_line_2, postal_code, city, region, country (ISO alpha-2); every key is written, a missing one clears it. SECURITY DEFINER; requires can_edit_workspace_money on the organization''s workspace.';

REVOKE ALL ON FUNCTION public.set_organization_fiscal_identity(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_organization_fiscal_identity(uuid, jsonb) TO authenticated;

-- ── 6 · create_invoice_from_bolo ──────────────────────────────────────────
-- DROP + CREATE: un parámetro nuevo cambia la firma, y dejar la vieja al lado
-- haría ambigua cualquier llamada con los 11 nombres de antes.
DROP FUNCTION public.create_invoice_from_bolo(uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text);

CREATE FUNCTION public.create_invoice_from_bolo(p_bolo_id uuid, p_tax_lines jsonb DEFAULT '[]'::jsonb, p_number text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_expected_on date DEFAULT NULL::date, p_payment_condition text DEFAULT NULL::text, p_payer_person_id uuid DEFAULT NULL::uuid, p_doc_type text DEFAULT NULL::text, p_payer_fiscal_identity_id uuid DEFAULT NULL::uuid, p_country text DEFAULT NULL::text, p_payer_organization_id uuid DEFAULT NULL::uuid)
 RETURNS invoice
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_bolo public.bolo;
  v_ws public.workspace;
  v_project_name text;
  v_first_date date;
  v_inferred_payer uuid;
  v_inferred_org uuid;
  v_payer uuid;
  v_payer_org uuid;
  v_payer_fi uuid;
  v_doc_type text;
  v_country text;
  v_subtotal numeric;
  v_total numeric;
  v_desc text;
  v_invoice public.invoice;
  v_elem jsonb;
  v_label text;
  v_kind text;
  v_rate numeric;
  v_reason text;
  v_amount numeric;
  v_ordinal integer := 0;
  v_tax_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_tax_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'tax_lines must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND upper(btrim(p_country)) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be an ISO alpha-2 code' USING ERRCODE = '22023';
  END IF;
  IF p_payment_condition IS NOT NULL AND length(p_payment_condition) > 2000 THEN
    RAISE EXCEPTION 'payment_condition is too long' USING ERRCODE = '22023';
  END IF;
  IF p_doc_type IS NOT NULL AND p_doc_type NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'doc_type must be factura or proforma' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bolo
  FROM public.bolo
  WHERE id = p_bolo_id AND deleted_at IS NULL;

  IF v_bolo.id IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_bolo.project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
  END IF;
  IF v_bolo.fee_amount IS NULL THEN
    RAISE EXCEPTION 'bolo has no fee — set the fee first' USING ERRCODE = '22023';
  END IF;
  IF p_expected_on IS NOT NULL AND p_expected_on < CURRENT_DATE THEN
    RAISE EXCEPTION 'expected_on cannot precede issued_on' USING ERRCODE = '22023';
  END IF;

  -- Legacy person payer (the Worker before phase 2b). Dropped in phase 4.
  IF p_payer_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_person wp
    WHERE wp.workspace_id = v_bolo.workspace_id
      AND wp.person_id = p_payer_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payer is not in the bolo workspace' USING ERRCODE = '42501';
  END IF;

  IF p_payer_organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_organization o
    WHERE o.workspace_id = v_bolo.workspace_id
      AND o.id = p_payer_organization_id
      AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payer organization is not in the bolo workspace' USING ERRCODE = '42501';
  END IF;

  IF p_payer_fiscal_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = p_payer_fiscal_identity_id
      AND fi.workspace_id = v_bolo.workspace_id
      AND fi.kind = 'receiver'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'receiver fiscal identity is not a workspace receiver' USING ERRCODE = '42501';
  END IF;

  -- doc_type: explicit param wins; else derive from the workspace invoicing_mode
  -- (interno → proforma, legal/off → factura).
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_bolo.workspace_id;
  v_doc_type := coalesce(
    p_doc_type,
    CASE WHEN v_ws.settings->>'invoicing_mode' = 'interno' THEN 'proforma' ELSE 'factura' END
  );

  -- country: the tax regime this document is snapshotted under. The app passes
  -- the resolved regime; fall back to the bolo's, then the workspace's.
  v_country := upper(nullif(btrim(coalesce(p_country, v_bolo.country, v_ws.country, '')), ''));

  SELECT name INTO v_project_name FROM public.project WHERE id = v_bolo.project_id;

  -- The deal may span several functions; date the line by the earliest one.
  SELECT min(pf.performed_at) INTO v_first_date
  FROM public.performance pf
  WHERE pf.bolo_id = v_bolo.id AND pf.deleted_at IS NULL;

  -- ADR-099 §4: nothing is inferred from someone else's private conversation.
  -- The same criterion as the conversation_select policy.
  SELECT person_id, organization_id INTO v_inferred_payer, v_inferred_org
  FROM public.conversation
  WHERE id = v_bolo.conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);

  v_payer := coalesce(p_payer_person_id, v_inferred_payer);

  -- ADR-102 decision 5: the payer is the organization.
  v_payer_org := coalesce(p_payer_organization_id, v_inferred_org);
  IF v_payer_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_organization o
    WHERE o.workspace_id = v_bolo.workspace_id AND o.id = v_payer_org AND o.deleted_at IS NULL
  ) THEN
    v_payer_org := NULL;
  END IF;

  -- Explicit receiver wins; else the organization's own, if still live.
  v_payer_fi := p_payer_fiscal_identity_id;
  IF v_payer_fi IS NULL AND v_payer_org IS NOT NULL THEN
    SELECT fi.id INTO v_payer_fi
    FROM public.workspace_organization o
    JOIN public.fiscal_identity fi
      ON fi.id = o.fiscal_identity_id
     AND fi.workspace_id = o.workspace_id
     AND fi.kind = 'receiver'
     AND fi.deleted_at IS NULL
    WHERE o.id = v_payer_org;
  END IF;

  v_subtotal := v_bolo.fee_amount;
  v_total := v_subtotal;

  -- Validate + compute each generic tax line. The per-country preset (app layer)
  -- decided which lines apply; the core just signs each and sums the total.
  FOR v_elem IN SELECT value FROM jsonb_array_elements(coalesce(p_tax_lines, '[]'::jsonb))
  LOOP
    v_label  := btrim(coalesce(v_elem->>'label', ''));
    v_kind   := coalesce(v_elem->>'kind', '');
    v_rate   := coalesce((v_elem->>'rate_pct')::numeric, 0);
    v_reason := nullif(btrim(coalesce(v_elem->>'exempt_reason', '')), '');

    IF v_label = '' THEN
      RAISE EXCEPTION 'tax line label is required' USING ERRCODE = '22023';
    END IF;
    IF v_kind NOT IN ('add', 'withhold', 'exempt') THEN
      RAISE EXCEPTION 'tax line kind must be add, withhold or exempt' USING ERRCODE = '22023';
    END IF;
    IF v_rate < 0 OR v_rate > 100 THEN
      RAISE EXCEPTION 'tax line rate must be between 0 and 100' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'exempt' AND v_reason IS NULL THEN
      RAISE EXCEPTION 'an exempt tax line needs a reason' USING ERRCODE = '22023';
    END IF;

    v_amount := CASE v_kind
      WHEN 'add'      THEN round(v_subtotal * v_rate / 100, 2)
      WHEN 'withhold' THEN -round(v_subtotal * v_rate / 100, 2)
      ELSE 0
    END;
    v_total := v_total + v_amount;

    v_tax_rows := v_tax_rows || jsonb_build_object(
      'label', v_label, 'kind', v_kind, 'rate_pct', v_rate,
      'base_amount', v_subtotal, 'amount', v_amount,
      'exempt_reason', v_reason, 'ordinal', v_ordinal
    );
    v_ordinal := v_ordinal + 1;
  END LOOP;

  v_desc := concat_ws(
    ' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_bolo.venue_name, v_bolo.city), ''),
    to_char(v_first_date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, expected_on, payment_condition,
    status, doc_type, country, subtotal, total,
    currency, payer_person_id, payer_organization_id, payer_fiscal_identity_id, notes, created_by
  ) VALUES (
    v_bolo.workspace_id,
    v_bolo.project_id,
    nullif(btrim(coalesce(p_number, '')), ''),
    p_due_on,
    p_expected_on,
    nullif(btrim(coalesce(p_payment_condition, '')), ''),
    'draft',
    v_doc_type,
    v_country,
    v_subtotal,
    v_total,
    coalesce(v_bolo.fee_currency, 'EUR'),
    v_payer,
    v_payer_org,
    v_payer_fi,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line (
    workspace_id, invoice_id, bolo_id, description, quantity, unit_amount
  ) VALUES (
    v_bolo.workspace_id, v_invoice.id, v_bolo.id, v_desc, 1, v_subtotal
  );

  INSERT INTO public.invoice_tax_line (
    workspace_id, invoice_id, label, kind, rate_pct, base_amount, amount, exempt_reason, ordinal
  )
  SELECT
    v_bolo.workspace_id, v_invoice.id,
    e->>'label', e->>'kind', (e->>'rate_pct')::numeric,
    (e->>'base_amount')::numeric, (e->>'amount')::numeric,
    e->>'exempt_reason', (e->>'ordinal')::integer
  FROM jsonb_array_elements(v_tax_rows) AS e;

  RETURN v_invoice;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text, uuid
) TO authenticated;

-- ── 7 · update_invoice ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_invoice(p_invoice_id uuid, p_patch jsonb)
 RETURNS invoice
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_inv    public.invoice;
  v_status text;
  v_org    uuid;
  v_org_fi uuid;
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

  -- ADR-102 phase 2b: the payer organization, on a draft only (an issued
  -- invoice froze its payer). Setting it also sets the receiver fiscal
  -- identity to the organization's own (null if it has none, or on clear):
  -- re-setting the same organization after adding its fiscal data is how a
  -- draft picks them up before issue_invoice freezes them.
  IF p_patch ? 'payer_organization_id' THEN
    IF v_inv.status <> 'draft' THEN
      RAISE EXCEPTION 'the payer can only change on a draft' USING ERRCODE = '22023';
    END IF;
    v_org := nullif(p_patch->>'payer_organization_id', '')::uuid;
    IF v_org IS NOT NULL THEN
      SELECT o.id, fi.id INTO v_org, v_org_fi
      FROM public.workspace_organization o
      LEFT JOIN public.fiscal_identity fi
        ON fi.id = o.fiscal_identity_id
       AND fi.workspace_id = o.workspace_id
       AND fi.kind = 'receiver'
       AND fi.deleted_at IS NULL
      WHERE o.id = v_org
        AND o.workspace_id = v_inv.workspace_id
        AND o.deleted_at IS NULL;
      IF v_org IS NULL THEN
        RAISE EXCEPTION 'payer organization is not in the invoice workspace' USING ERRCODE = '42501';
      END IF;
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
    payer_organization_id = CASE WHEN p_patch ? 'payer_organization_id'
      THEN v_org ELSE payer_organization_id END,
    payer_fiscal_identity_id = CASE WHEN p_patch ? 'payer_organization_id'
      THEN v_org_fi ELSE payer_fiscal_identity_id END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN nullif(btrim(coalesce(p_patch->>'notes', '')), '') ELSE notes END
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$function$;

-- ── 8 · list_money_payer_organizations ────────────────────────────────────
CREATE FUNCTION public.list_money_payer_organizations(p_project_ids uuid[] DEFAULT NULL::uuid[], p_workspace_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, workspace_id uuid, slug text, name text, has_fiscal_identity boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT DISTINCT ON (o.workspace_id, o.id)
    o.id,
    o.workspace_id,
    o.slug,
    o.name,
    EXISTS (
      SELECT 1 FROM public.fiscal_identity fi
      WHERE fi.id = o.fiscal_identity_id
        AND fi.workspace_id = o.workspace_id
        AND fi.kind = 'receiver'
        AND fi.deleted_at IS NULL
    )
  FROM public.conversation c
  JOIN public.workspace_organization o
    ON o.workspace_id = c.workspace_id
   AND o.id = c.organization_id
   AND o.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.project_id = ANY (v_projects)
    -- ADR-099 §4: a private conversation is only its owner's. The same
    -- criterion as the conversation_select policy.
    AND (c.private_to IS NULL OR c.private_to = auth.uid())
    AND (
      (
        coalesce(cardinality(p_project_ids), 0) = 0
        AND coalesce(cardinality(p_workspace_ids), 0) = 0
      )
      OR c.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR c.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
  ORDER BY o.workspace_id, o.id
  LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.list_money_payer_organizations(uuid[], uuid[], integer) IS
  'Organizations the caller may invoice (ADR-102 decision 5): those of conversations in projects where the caller holds edit:money, without someone else''s private conversations (ADR-099 §4). has_fiscal_identity says whether a factura can be issued to them. Replaces list_money_payers (persons), dropped in phase 4.';

REVOKE ALL ON FUNCTION public.list_money_payer_organizations(uuid[], uuid[], integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_money_payer_organizations(uuid[], uuid[], integer)
  TO authenticated;
