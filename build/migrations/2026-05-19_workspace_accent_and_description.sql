-- Migration: workspace_accent_and_description
-- Adds two columns to workspace + extends create_workspace RPC.
--
-- accent (text, nullable): palette index '1'..'8' OR null (= derive from
-- hash(slug)). Stored as text — not smallint — so the door stays open for
-- free-form colors (hex / oklch) without a schema migration. When custom
-- colors ship, the CHECK relaxes:
--   ALTER TABLE workspace DROP CONSTRAINT workspace_accent_check;
--   ALTER TABLE workspace ADD  CONSTRAINT workspace_accent_check
--     CHECK (accent IS NULL OR accent ~ '^([1-8]|#[0-9a-fA-F]{6}|oklch\(.*\))$');
-- App code already branches on the value shape (`/^[1-8]$/` → palette,
-- else literal color) so no JS change needed when the CHECK relaxes.
--
-- description (text, nullable, <=280 chars): short blurb shown in sidebar
-- tooltip / settings card / future public share. First-order info, not
-- configuration — so it goes on its own column, not in settings jsonb.
--
-- Both columns are NULL for the 4 existing workspaces; consumers must
-- handle NULL (fall through to hash for accent, hide section for desc).
--
-- Applied via Supabase MCP apply_migration 2026-05-19 (name:
-- workspace_accent_and_description). This file is the canonical record.

ALTER TABLE public.workspace
  ADD COLUMN accent      text CHECK (accent IS NULL OR accent ~ '^[1-8]$'),
  ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 280);

COMMENT ON COLUMN public.workspace.accent IS
  'Color identity. ''1''..''8'' = palette index into --accent-N tokens. NULL = derive via hash(slug). Stored as text to allow future free-form colors (hex/oklch) by relaxing the CHECK constraint without a schema migration.';

COMMENT ON COLUMN public.workspace.description IS
  'Short blurb (≤280 chars) describing what this workspace is for. Surfaced in sidebar tooltips, settings cards, and future public share pages.';

-- Extend create_workspace: two optional new params, both nullable. Empty
-- string and whitespace get normalised to NULL so the client doesn't have
-- to send `null` explicitly when the user leaves the field blank.
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
  v_slug        text;
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

  v_slug := COALESCE(NULLIF(trim(p_slug), ''), public.slugify(p_name));
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'workspace-' || substr(gen_random_uuid()::text, 1, 8);
  END IF;

  IF public.is_reserved_slug(v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END IF;

  WHILE EXISTS (
    SELECT 1 FROM public.workspace
    WHERE slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  -- Normalise empty → NULL. Lets the CHECK constraint do the rest.
  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  INSERT INTO public.workspace (slug, name, kind, account_id, accent, description)
  VALUES (v_slug, trim(p_name), 'personal', v_account_id, v_accent, v_description)
  RETURNING * INTO v_workspace;

  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_workspace.id, v_caller, 'owner', now());

  RETURN v_workspace;
END;
$$;

-- The new signature replaces the prior (text, text) overload. We drop it
-- explicitly so PostgREST routes the RPC to the 4-arg version. PostgREST
-- picks overloads by arity + named-arg match, and leaving the old one
-- around would let a 2-arg POST silently bypass the new fields.
DROP FUNCTION IF EXISTS public.create_workspace(text, text);

REVOKE ALL ON FUNCTION public.create_workspace(text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_workspace(text, text, text, text) IS
  'Creates a workspace owned by auth.uid() under their personal account. SECURITY DEFINER bypasses the no-INSERT-policy on workspace; validates membership in personal account first. Cascades into workspace_seed_roles (15 roles) and inserts workspace_membership(owner). v1 defaults to kind=personal — kind/account pickers ship later. p_accent: palette index ''1''..''8'' or NULL (= hash fallback). p_description: short blurb ≤280 chars or NULL.';
