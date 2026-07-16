-- Migration: workspace_shortid_alias (ADR-067 · URL architecture v2)
--
-- The workspace slug stops being a human-claimed global name and becomes a
-- machine short-id; the pretty name moves to an OPTIONAL, validated alias.
-- "Ids donde hay política, nombres donde hay dueño": the space namespace is
-- the only contested one (two real companies can share a name), so identity
-- decouples from the name there — and only there. Project/line slugs keep
-- ADR-024 as-is (clean, unique per container, hard reject).
--
-- Pieces:
--   §1 generate_workspace_sid() — 8 hex chars, collision-safe vs live
--      slug+alias. Hex can never equal a reserved route word.
--   §2 workspace.alias — nullable, partial-unique, slug-format CHECK.
--      Resolved inbound by the shell; NEVER emitted in canonical links
--      (canonical = id form, Marco 2026-07-16, provisional).
--   §3 user_profile.is_platform_admin — minimal operator flag for reviews.
--      Set manually (see bottom). Phase 0.9 admin-minimum seed.
--   §4 workspace_alias_request — the full flow: owner/admin requests →
--      pending → platform admin approves/rejects. workspace_name is
--      snapshotted so the reviewer can see WHO asks without needing RLS
--      access to the workspace row itself.
--   §5 RPCs request_workspace_alias / review_workspace_alias.
--   §6 create_workspace + handle_new_user switch to generate_workspace_sid()
--      (p_slug param kept in signature for compat, now ignored).
--
-- Existing workspaces are GRANDFATHERED: their human slugs stay valid ids.
--
-- Apply: paste in Supabase SQL editor or via MCP apply_migration
-- (name: workspace_shortid_alias). This file is the canonical record.

--------------------------------------------------------------------------------
-- §1 short-id generator
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_workspace_sid()
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sid text;
BEGIN
  LOOP
    v_sid := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.workspace
      WHERE deleted_at IS NULL AND (slug = v_sid OR alias = v_sid)
    );
  END LOOP;
  RETURN v_sid;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_workspace_sid() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.generate_workspace_sid() TO authenticated;

COMMENT ON FUNCTION public.generate_workspace_sid() IS
  'Machine identity segment for a workspace URL: 8 lowercase hex chars, unique vs live slugs AND aliases. Hex-only means it can never collide with a reserved route word (ADR-067).';

--------------------------------------------------------------------------------
-- §2 workspace.alias
--------------------------------------------------------------------------------

ALTER TABLE public.workspace
  ADD COLUMN alias text
    CHECK (alias IS NULL OR alias ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$');

CREATE UNIQUE INDEX workspace_alias_key
  ON public.workspace (alias)
  WHERE deleted_at IS NULL AND alias IS NOT NULL;

COMMENT ON COLUMN public.workspace.alias IS
  'Optional pretty URL alias (ADR-067). Resolved inbound → redirect to the canonical slug form. Never emitted in internal links. Granted through workspace_alias_request review; revocable without breaking any shared link (identity lives in slug).';

--------------------------------------------------------------------------------
-- §3 platform admin flag
--------------------------------------------------------------------------------

ALTER TABLE public.user_profile
  ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profile.is_platform_admin IS
  'Operator flag: reviews alias requests (ADR-067); future Phase 0.9 admin surface. Set manually — no self-service path by design.';

--------------------------------------------------------------------------------
-- §4 workspace_alias_request
--------------------------------------------------------------------------------

CREATE TABLE public.workspace_alias_request (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id   uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  workspace_name text NOT NULL,
  alias          text NOT NULL
    CHECK (alias ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  requested_by   uuid NOT NULL REFERENCES auth.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     uuid REFERENCES auth.users (id)
);

CREATE INDEX workspace_alias_request_ws_idx     ON public.workspace_alias_request (workspace_id);
CREATE INDEX workspace_alias_request_status_idx ON public.workspace_alias_request (status) WHERE status = 'pending';

ALTER TABLE public.workspace_alias_request ENABLE ROW LEVEL SECURITY;

-- Members of the workspace see their own requests; the platform admin sees all.
-- All writes go through the SECURITY DEFINER RPCs — no INSERT/UPDATE policies.
CREATE POLICY alias_request_select ON public.workspace_alias_request
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT m.workspace_id FROM public.workspace_membership m
      WHERE m.user_id = auth.uid() AND m.accepted_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profile p
      WHERE p.user_id = auth.uid() AND p.is_platform_admin
    )
  );

COMMENT ON TABLE public.workspace_alias_request IS
  'Alias claim flow (ADR-067): owner/admin requests → pending → platform admin reviews. workspace_name is a snapshot so reviewers need no RLS access to the workspace row.';

--------------------------------------------------------------------------------
-- §5 RPCs
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_workspace_alias(
  p_workspace_id uuid,
  p_alias        text
)
RETURNS public.workspace_alias_request
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_alias  text := lower(trim(p_alias));
  v_ws     public.workspace;
  v_req    public.workspace_alias_request;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authenticated caller required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ws FROM public.workspace
  WHERE id = p_workspace_id AND deleted_at IS NULL;
  IF v_ws.id IS NULL THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '22023';
  END IF;

  -- Only owner/admin of the space may claim its public address.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_membership m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'owner or admin role required' USING ERRCODE = '42501';
  END IF;

  IF v_alias IS NULL OR v_alias !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'invalid alias format' USING ERRCODE = '22023';
  END IF;
  IF public.is_reserved_slug(v_alias) THEN
    RAISE EXCEPTION 'alias is a reserved word' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace
    WHERE deleted_at IS NULL AND (slug = v_alias OR alias = v_alias)
  ) THEN
    RAISE EXCEPTION 'alias already taken' USING ERRCODE = '23505';
  END IF;

  -- A fresh request supersedes any pending one for the same workspace.
  UPDATE public.workspace_alias_request
  SET status = 'superseded', decided_at = now()
  WHERE workspace_id = p_workspace_id AND status = 'pending';

  INSERT INTO public.workspace_alias_request (workspace_id, workspace_name, alias, requested_by)
  VALUES (p_workspace_id, v_ws.name, v_alias, v_caller)
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.request_workspace_alias(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_workspace_alias(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.request_workspace_alias(uuid, text) IS
  'Owner/admin of a workspace requests a URL alias. Validates format + reserved + availability (vs live slugs AND aliases), supersedes prior pending request, inserts pending (ADR-067).';

CREATE OR REPLACE FUNCTION public.review_workspace_alias(
  p_request_id uuid,
  p_approve    boolean
)
RETURNS public.workspace_alias_request
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_req    public.workspace_alias_request;
BEGIN
  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profile p
    WHERE p.user_id = v_caller AND p.is_platform_admin
  ) THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.workspace_alias_request
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'pending request not found' USING ERRCODE = '22023';
  END IF;

  IF p_approve THEN
    -- Availability may have changed since the request was filed.
    IF EXISTS (
      SELECT 1 FROM public.workspace
      WHERE deleted_at IS NULL AND (slug = v_req.alias OR alias = v_req.alias)
    ) THEN
      RAISE EXCEPTION 'alias no longer available' USING ERRCODE = '23505';
    END IF;

    UPDATE public.workspace SET alias = v_req.alias, updated_at = now()
    WHERE id = v_req.workspace_id;

    UPDATE public.workspace_alias_request
    SET status = 'approved', decided_at = now(), decided_by = v_caller
    WHERE id = p_request_id
    RETURNING * INTO v_req;
  ELSE
    UPDATE public.workspace_alias_request
    SET status = 'rejected', decided_at = now(), decided_by = v_caller
    WHERE id = p_request_id
    RETURNING * INTO v_req;
  END IF;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.review_workspace_alias(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_workspace_alias(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.review_workspace_alias(uuid, boolean) IS
  'Platform admin approves (sets workspace.alias, re-checking availability) or rejects a pending alias request (ADR-067).';

--------------------------------------------------------------------------------
-- §6 creation paths switch to short-ids (p_slug kept in signature, ignored)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_workspace(
  p_name        text,
  p_slug        text DEFAULT NULL,
  p_accent      text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS public.workspace
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_account_id  uuid;
  v_accent      text;
  v_description text;
  v_workspace   public.workspace;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_account_id
  FROM public.account a
  JOIN public.account_membership am ON am.account_id = a.id
  WHERE a.kind = 'personal'
    AND a.deleted_at IS NULL
    AND am.user_id = v_caller
    AND am.role = 'owner'
    AND am.accepted_at IS NOT NULL
    AND am.revoked_at IS NULL
  ORDER BY am.invited_at ASC
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'caller has no personal account — cannot create workspace'
      USING ERRCODE = '42501';
  END IF;

  v_accent := NULLIF(trim(COALESCE(p_accent, '')), '');
  v_description := NULLIF(trim(COALESCE(p_description, '')), '');

  -- ADR-067: identity is machine-chosen. p_slug is ignored (kept for
  -- signature compat); the pretty name goes to workspace.name and, if the
  -- client wants a pretty URL, through the alias request flow.
  INSERT INTO public.workspace (slug, name, kind, account_id, accent, description)
  VALUES (public.generate_workspace_sid(), trim(p_name), 'personal', v_account_id, v_accent, v_description)
  RETURNING * INTO v_workspace;

  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace.id, v_caller, 'owner', now());

  RETURN v_workspace;
END;
$$;

COMMENT ON FUNCTION public.create_workspace(text, text, text, text) IS
  'Creates a workspace under the caller''s personal account. ADR-067: slug is a machine short-id (generate_workspace_sid); p_slug is ignored, kept for signature compat. Pretty URLs go through request_workspace_alias.';

-- Based on the LIVE version (2026-05-18_add_account_layer.sql §10, which
-- provisions account + account_membership before the workspace) — only the
-- slug derivation changes. schema.sql's older body lacks the account layer.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name    text;
  v_slug         text;
  v_account_slug text;
  v_account_id   uuid;
  v_workspace_id uuid;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1));

  INSERT INTO public.user_profile (user_id, full_name, locale)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.raw_user_meta_data ->> 'locale', 'es'))
  ON CONFLICT (user_id) DO NOTHING;

  -- ADR-067: personal workspace gets a machine short-id, not the email
  -- local-part — no signup can ever fight another over a name.
  v_slug := public.generate_workspace_sid();

  v_account_slug := v_slug || '-acc';
  WHILE EXISTS (SELECT 1 FROM public.account WHERE slug = v_account_slug AND deleted_at IS NULL) LOOP
    v_account_slug := v_slug || '-acc-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.account (slug, name, kind)
  VALUES (v_account_slug, v_full_name, 'personal')
  RETURNING id INTO v_account_id;

  INSERT INTO public.account_membership (account_id, user_id, role, accepted_at)
  VALUES (v_account_id, NEW.id, 'owner', now());

  INSERT INTO public.workspace (slug, name, kind, account_id)
  VALUES (v_slug, v_full_name, 'personal', v_account_id)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace_id, NEW.id, 'owner', now());

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- Post-apply, run ONCE by the operator (not part of the migration):
--   UPDATE public.user_profile SET is_platform_admin = true
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = '<marco''s hour login email>');
--------------------------------------------------------------------------------
