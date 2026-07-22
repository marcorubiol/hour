-- Money v3 (ADR-086) — Phase 1: fiscal identity foundation. Additive only.
-- Introduces the fiscal_identity entity (soft-owned by an account issuer or a
-- workspace receiver / per-workspace issuer override), the account/workspace
-- wiring columns, and the workspace.settings.invoicing_mode setting (same
-- shape as booking_mode, ADR-002). No money v2 behaviour changes here — the
-- invoice reshaping, numbering series and payment decouple are later phases.

-- ── fiscal_identity ─────────────────────────────────────────────────────────
CREATE TABLE public.fiscal_identity (
  id               uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  -- Soft owner: exactly one of an account (issuer default) or a workspace
  -- (a receiver you bill, or a per-workspace issuer override). ADR-086 D2/D6.
  account_id       uuid REFERENCES public.account(id)   ON DELETE CASCADE,
  workspace_id     uuid REFERENCES public.workspace(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  label            text NOT NULL DEFAULT '',
  legal_name       text NOT NULL,
  tax_id           text,
  address_line_1   text,
  address_line_2   text,
  postal_code      text,
  city             text,
  region           text,
  country          text,
  -- Issuer-only; a receiver identity is asymmetric (no banking / defaults).
  iban             text,
  swift_bic        text,
  default_vat_pct  numeric(5,2),
  default_irpf_pct numeric(5,2),
  archived         boolean NOT NULL DEFAULT false,
  custom_fields    jsonb NOT NULL DEFAULT '{}',
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT fiscal_identity_soft_owner CHECK (
    (account_id IS NOT NULL)::int + (workspace_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT fiscal_identity_kind_valid CHECK (kind IN ('issuer', 'receiver')),
  CONSTRAINT fiscal_identity_legal_name_nonempty CHECK (length(btrim(legal_name)) > 0),
  CONSTRAINT fiscal_identity_default_vat_range CHECK (
    default_vat_pct IS NULL OR (default_vat_pct >= 0 AND default_vat_pct <= 100)
  ),
  CONSTRAINT fiscal_identity_default_irpf_range CHECK (
    default_irpf_pct IS NULL OR (default_irpf_pct >= 0 AND default_irpf_pct <= 100)
  )
);

COMMENT ON TABLE public.fiscal_identity IS
  'Tax details of one legal party (ADR-086). Soft-owned: account_id = your issuer identity(ies); workspace_id = a receiver you bill, or a per-workspace issuer override (freelance case). Frozen as a snapshot on the invoice when it is issued (ADR-050); this row stays editable.';

CREATE INDEX fiscal_identity_account_id_idx
  ON public.fiscal_identity (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX fiscal_identity_workspace_id_idx
  ON public.fiscal_identity (workspace_id) WHERE workspace_id IS NOT NULL;

ALTER TABLE public.fiscal_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_identity FORCE ROW LEVEL SECURITY;

-- Read: any member of the owning account/workspace (identities appear on money
-- surfaces). Write: owner/admin of the owning account/workspace. No delete
-- policy — soft-delete via a future RPC, mirroring invoice/expense; `archived`
-- is a separate user-facing flag.
CREATE POLICY fiscal_identity_select ON public.fiscal_identity
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
      OR (account_id IS NOT NULL AND public.is_account_member(account_id))
    )
  );

CREATE POLICY fiscal_identity_insert ON public.fiscal_identity
  FOR INSERT TO authenticated
  WITH CHECK (
    (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id))
    OR (account_id IS NOT NULL AND public.is_account_admin(account_id))
  );

CREATE POLICY fiscal_identity_update ON public.fiscal_identity
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL AND (
      (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id))
      OR (account_id IS NOT NULL AND public.is_account_admin(account_id))
    )
  )
  WITH CHECK (
    (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id))
    OR (account_id IS NOT NULL AND public.is_account_admin(account_id))
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.fiscal_identity TO authenticated;

-- ── account / workspace wiring ──────────────────────────────────────────────
ALTER TABLE public.account
  ADD COLUMN default_fiscal_identity_id uuid
    REFERENCES public.fiscal_identity(id) ON DELETE SET NULL;
ALTER TABLE public.workspace
  ADD COLUMN fiscal_identity_id uuid
    REFERENCES public.fiscal_identity(id) ON DELETE SET NULL;

CREATE INDEX account_default_fiscal_identity_id_idx
  ON public.account (default_fiscal_identity_id) WHERE default_fiscal_identity_id IS NOT NULL;
CREATE INDEX workspace_fiscal_identity_id_idx
  ON public.workspace (fiscal_identity_id) WHERE fiscal_identity_id IS NOT NULL;

COMMENT ON COLUMN public.account.default_fiscal_identity_id IS
  'The account''s default issuer identity (ADR-086). A workspace may override via workspace.fiscal_identity_id.';
COMMENT ON COLUMN public.workspace.fiscal_identity_id IS
  'Per-workspace issuer override (ADR-086 D2): the freelance-bills-as-a-person case. Absent = use the account default.';

-- ── workspace.settings.invoicing_mode ───────────────────────────────────────
ALTER TABLE public.workspace
  ADD CONSTRAINT workspace_invoicing_mode_valid CHECK (
    (settings ->> 'invoicing_mode') IS NULL
    OR (settings ->> 'invoicing_mode') IN ('off', 'interno', 'legal')
  );

-- Extend update_workspace to patch settings.invoicing_mode alongside
-- booking_mode. Same contract: present key changes, empty clears/removes it.
CREATE OR REPLACE FUNCTION public.update_workspace(p_workspace_id uuid, p_patch jsonb)
RETURNS public.workspace
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
  v_mode      text := NULLIF(trim(coalesce(p_patch->>'booking_mode', '')), '');
  v_inv_mode  text := NULLIF(trim(coalesce(p_patch->>'invoicing_mode', '')), '');
  v_settings  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = v_caller
      AND m.role         IN ('owner', 'admin')
      AND m.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'booking_mode' AND v_mode IS NOT NULL
     AND v_mode NOT IN ('simple', 'prioritized') THEN
    RAISE EXCEPTION 'booking_mode must be simple or prioritized'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'invoicing_mode' AND v_inv_mode IS NOT NULL
     AND v_inv_mode NOT IN ('off', 'interno', 'legal') THEN
    RAISE EXCEPTION 'invoicing_mode must be off, interno or legal'
      USING ERRCODE = '22023';
  END IF;

  SELECT settings INTO v_settings
  FROM public.workspace WHERE id = p_workspace_id AND deleted_at IS NULL;

  IF p_patch ? 'booking_mode' THEN
    v_settings := CASE WHEN v_mode IS NULL
      THEN v_settings - 'booking_mode'
      ELSE jsonb_set(v_settings, '{booking_mode}', to_jsonb(v_mode)) END;
  END IF;
  IF p_patch ? 'invoicing_mode' THEN
    v_settings := CASE WHEN v_inv_mode IS NULL
      THEN v_settings - 'invoicing_mode'
      ELSE jsonb_set(v_settings, '{invoicing_mode}', to_jsonb(v_inv_mode)) END;
  END IF;

  UPDATE public.workspace w SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                           ELSE w.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')         ELSE w.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')             ELSE w.accent      END,
    domain      = CASE WHEN p_patch ? 'domain'      THEN NULLIF(p_patch->>'domain', '')::workspace_domain ELSE w.domain      END,
    city        = CASE WHEN p_patch ? 'city'        THEN NULLIF(trim(p_patch->>'city'), '')               ELSE w.city        END,
    logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN NULLIF(trim(p_patch->>'logo_url'), '')            ELSE w.logo_url    END,
    settings    = CASE WHEN (p_patch ? 'booking_mode') OR (p_patch ? 'invoicing_mode')
                       THEN v_settings ELSE w.settings END,
    updated_at  = now()
  WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
  RETURNING * INTO v_workspace;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_workspace;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_workspace(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_workspace(uuid, jsonb) IS
  'Patch a workspace identity (name, description, accent, domain, city, logo_url) and settings.booking_mode / settings.invoicing_mode. SECURITY DEFINER; requires owner/admin membership. jsonb patch: only present keys change; empty clears nullable fields and REMOVES the mode key (absent booking_mode = simple). ADR-062 + ADR-002 + ADR-086.';
