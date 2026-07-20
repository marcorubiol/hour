-- Phase 0.9 onboarding and workspace access lifecycle.
-- Invitations are capability links: plaintext tokens are returned once,
-- stored only as SHA-256 hashes, expire, and can be revoked before acceptance.

CREATE TABLE public.workspace_invitation (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  email extensions.citext NOT NULL,
  role public.membership_role NOT NULL,
  project_id uuid REFERENCES public.project(id) ON DELETE CASCADE,
  project_role_code text,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_invitation_email_nonempty
    CHECK (length(btrim(email::text)) > 2),
  CONSTRAINT workspace_invitation_role_not_owner
    CHECK (role <> 'owner'),
  CONSTRAINT workspace_invitation_project_role_pair
    CHECK (
      (project_id IS NULL AND project_role_code IS NULL)
      OR (project_id IS NOT NULL AND project_role_code IS NOT NULL)
    ),
  CONSTRAINT workspace_invitation_terminal_state
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX workspace_invitation_workspace_created_idx
  ON public.workspace_invitation (workspace_id, created_at DESC);
CREATE INDEX workspace_invitation_pending_email_idx
  ON public.workspace_invitation (lower(email::text), expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.workspace_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_invitation FROM PUBLIC, anon, authenticated;

-- Membership writes have one auditable path now. The historical table grants
-- let an admin mint owner rows or bypass invitation acceptance through a
-- handcrafted Data API call even though the product UI did not expose it.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workspace_membership
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.membership_role DEFAULT 'guest',
  p_project_id uuid DEFAULT NULL,
  p_project_role_code text DEFAULT NULL,
  p_expires_days integer DEFAULT 7
) RETURNS TABLE (
  id uuid,
  email text,
  role public.membership_role,
  project_id uuid,
  project_role_code text,
  expires_at timestamptz,
  token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
  v_invitation public.workspace_invitation%ROWTYPE;
BEGIN
  IF v_caller IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'valid email required' USING ERRCODE = '22023';
  END IF;
  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'owner transfer is a separate operation' USING ERRCODE = '22023';
  END IF;
  IF p_expires_days < 1 OR p_expires_days > 30 THEN
    RAISE EXCEPTION 'expiry must be between 1 and 30 days' USING ERRCODE = '22023';
  END IF;
  IF (p_project_id IS NULL) <> (p_project_role_code IS NULL) THEN
    RAISE EXCEPTION 'project and project role must be supplied together'
      USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.workspace_role wr
      ON wr.workspace_id = p.workspace_id
     AND wr.code = p_project_role_code
     AND wr.archived_at IS NULL
    WHERE p.id = p_project_id
      AND p.workspace_id = p_workspace_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project role does not belong to this workspace'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace_invitation wi
  SET revoked_at = now()
  WHERE wi.workspace_id = p_workspace_id
    AND lower(wi.email::text) = v_email
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL;

  v_token := replace(replace(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_');
  INSERT INTO public.workspace_invitation (
    workspace_id, email, role, project_id, project_role_code, token_hash,
    invited_by, expires_at
  ) VALUES (
    p_workspace_id, v_email, p_role, p_project_id, p_project_role_code,
    encode(digest(v_token, 'sha256'), 'hex'), v_caller,
    now() + make_interval(days => p_expires_days)
  )
  RETURNING * INTO v_invitation;

  RETURN QUERY SELECT
    v_invitation.id,
    v_invitation.email::text,
    v_invitation.role,
    v_invitation.project_id,
    v_invitation.project_role_code,
    v_invitation.expires_at,
    v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_workspace_access(p_workspace_id uuid)
RETURNS TABLE (
  access_kind text,
  id uuid,
  user_id uuid,
  email text,
  display_name text,
  role public.membership_role,
  project_id uuid,
  project_name text,
  project_role_code text,
  status text,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'member'::text,
         wm.id,
         wm.user_id,
         au.email::text,
         coalesce(up.full_name, au.raw_user_meta_data->>'full_name', au.email::text),
         wm.role,
         NULL::uuid,
         NULL::text,
         NULL::text,
         CASE WHEN wm.accepted_at IS NULL THEN 'pending' ELSE 'active' END,
         wm.accepted_at,
         NULL::timestamptz,
         wm.created_at
  FROM public.workspace_membership wm
  JOIN auth.users au ON au.id = wm.user_id
  LEFT JOIN public.user_profile up ON up.user_id = wm.user_id
  WHERE wm.workspace_id = p_workspace_id

  UNION ALL

  SELECT 'invitation'::text,
         wi.id,
         wi.accepted_by,
         wi.email::text,
         wi.email::text,
         wi.role,
         wi.project_id,
         p.name,
         wi.project_role_code,
         CASE
           WHEN wi.accepted_at IS NOT NULL THEN 'accepted'
           WHEN wi.revoked_at IS NOT NULL THEN 'revoked'
           WHEN wi.expires_at <= now() THEN 'expired'
           ELSE 'pending'
         END,
         wi.accepted_at,
         wi.expires_at,
         wi.created_at
  FROM public.workspace_invitation wi
  LEFT JOIN public.project p ON p.id = wi.project_id
  WHERE wi.workspace_id = p_workspace_id
  ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_workspace_invitation(p_token text)
RETURNS TABLE (
  workspace_id uuid,
  workspace_slug text,
  workspace_name text,
  email text,
  role public.membership_role,
  project_id uuid,
  project_name text,
  project_role_code text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT wi.workspace_id,
         w.slug,
         w.name,
         wi.email::text,
         wi.role,
         wi.project_id,
         p.name,
         wi.project_role_code,
         wi.expires_at
  FROM public.workspace_invitation wi
  JOIN public.workspace w ON w.id = wi.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.project p ON p.id = wi.project_id AND p.deleted_at IS NULL
  JOIN auth.users au
    ON au.id = (SELECT auth.uid())
   AND au.email_confirmed_at IS NOT NULL
   AND lower(au.email::text) = lower(wi.email::text)
  WHERE wi.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL
    AND wi.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(p_token text)
RETURNS TABLE (
  workspace_id uuid,
  workspace_slug text,
  workspace_name text,
  role public.membership_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_invitation public.workspace_invitation%ROWTYPE;
  v_workspace public.workspace%ROWTYPE;
BEGIN
  SELECT wi.* INTO v_invitation
  FROM public.workspace_invitation wi
  JOIN auth.users au
    ON au.id = v_caller
   AND au.email_confirmed_at IS NOT NULL
   AND lower(au.email::text) = lower(wi.email::text)
  WHERE wi.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL
    AND wi.expires_at > now()
  FOR UPDATE;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_workspace
  FROM public.workspace w
  WHERE w.id = v_invitation.workspace_id AND w.deleted_at IS NULL;
  IF v_workspace.id IS NULL THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.workspace_membership (
    workspace_id, user_id, role, accepted_at, invited_by
  ) VALUES (
    v_invitation.workspace_id, v_caller, v_invitation.role, now(),
    v_invitation.invited_by
  )
  ON CONFLICT ON CONSTRAINT workspace_membership_workspace_id_user_id_key DO UPDATE
  SET role = CASE
        WHEN public.workspace_membership.accepted_at IS NULL THEN excluded.role
        ELSE public.workspace_membership.role
      END,
      accepted_at = coalesce(public.workspace_membership.accepted_at, excluded.accepted_at),
      invited_by = coalesce(public.workspace_membership.invited_by, excluded.invited_by),
      updated_at = now();

  IF v_invitation.project_id IS NOT NULL THEN
    INSERT INTO public.project_membership (
      project_id, user_id, roles, invited_by
    ) VALUES (
      v_invitation.project_id,
      v_caller,
      ARRAY[v_invitation.project_role_code]::text[],
      v_invitation.invited_by
    )
    ON CONFLICT ON CONSTRAINT project_membership_project_id_user_id_key DO UPDATE
    SET roles = (
          SELECT array_agg(DISTINCT role_code ORDER BY role_code)
          FROM unnest(
            public.project_membership.roles || excluded.roles
          ) AS role_code
        ),
        updated_at = now();
  END IF;

  UPDATE public.workspace_invitation
  SET accepted_at = now(), accepted_by = v_caller
  WHERE id = v_invitation.id;

  RETURN QUERY SELECT
    v_workspace.id,
    v_workspace.slug,
    v_workspace.name,
    (
      SELECT wm.role
      FROM public.workspace_membership wm
      WHERE wm.workspace_id = v_workspace.id AND wm.user_id = v_caller
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.workspace_invitation
  WHERE id = p_invitation_id AND accepted_at IS NULL;
  IF v_workspace_id IS NULL OR NOT public.is_workspace_admin(v_workspace_id) THEN
    RAISE EXCEPTION 'invitation not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workspace_invitation SET revoked_at = now()
  WHERE id = p_invitation_id AND revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_workspace_member_role(
  p_membership_id uuid,
  p_role public.membership_role
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_target public.workspace_membership%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM public.workspace_membership WHERE id = p_membership_id;
  IF v_target.id IS NULL OR NOT public.is_workspace_admin(v_target.workspace_id) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_target.role = 'owner' OR p_role = 'owner' THEN
    RAISE EXCEPTION 'owner transfer is a separate operation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workspace_membership
  SET role = p_role, updated_at = now()
  WHERE id = p_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_workspace_member(p_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_target public.workspace_membership%ROWTYPE;
  v_caller_role public.membership_role;
BEGIN
  SELECT * INTO v_target FROM public.workspace_membership WHERE id = p_membership_id;
  IF v_target.id IS NULL OR NOT public.is_workspace_admin(v_target.workspace_id) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_caller_role
  FROM public.workspace_membership
  WHERE workspace_id = v_target.workspace_id
    AND user_id = v_caller
    AND accepted_at IS NOT NULL;

  IF v_target.role = 'owner' THEN
    IF v_caller_role <> 'owner' OR (
      SELECT count(*) FROM public.workspace_membership
      WHERE workspace_id = v_target.workspace_id
        AND role = 'owner'
        AND accepted_at IS NOT NULL
    ) <= 1 THEN
      RAISE EXCEPTION 'the last owner cannot be revoked' USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.project_membership pm
  USING public.project p
  WHERE pm.project_id = p.id
    AND p.workspace_id = v_target.workspace_id
    AND pm.user_id = v_target.user_id;

  DELETE FROM public.workspace_membership WHERE id = p_membership_id;
END;
$$;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.create_workspace_invitation(uuid,text,public.membership_role,uuid,text,integer)'::regprocedure,
    'public.list_workspace_access(uuid)'::regprocedure,
    'public.preview_workspace_invitation(text)'::regprocedure,
    'public.accept_workspace_invitation(text)'::regprocedure,
    'public.revoke_workspace_invitation(uuid)'::regprocedure,
    'public.update_workspace_member_role(uuid,public.membership_role)'::regprocedure,
    'public.revoke_workspace_member(uuid)'::regprocedure
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END;
$$;

COMMENT ON TABLE public.workspace_invitation IS
  'Short-lived, hashed capability invitations. Acceptance also requires a verified Supabase user whose email matches the invitation.';
