-- ROLLBACK for 20261013200000_permissions_facets_writes.sql (permisos al
-- modelo de facetas, fase 3: escrituras)
--
-- Vuelve a la fase 2: las tablas viejas mandan otra vez por el espejo del
-- expand y las RPC de membresía vuelven a escribirlas. Va ANTES que los
-- rollbacks de la fase 2 y del expand (si se quiere seguir bajando).
--
-- Qué hace:
--   1. Quita la proyección inversa y la validación de etiquetas en membership.
--   2. Deja `membership` como la habría dejado el espejo: las facetas de
--      proyecto pasan a source = legacy y el paquete de proyecto a NULL.
--   3. Restaura los triggers del espejo y de validación, y los grants de
--      project_membership a anon y authenticated.
--   4. Borra las RPC y funciones nuevas, y restaura los cuerpos de la fase 2
--      (create_workspace_invitation vuelve a 6 parámetros).
--   5. Borra workspace_invitation.project_preset.
--   6. Resincroniza todo desde las tablas viejas, que la proyección tenía al
--      día, y exige paridad cero.
--
-- DATA LOST: las facetas de proyecto que el modelo viejo no expresa (Materials
-- y Tècnica dadas por paquete u override: el espejo las borra al
-- resincronizar), el nombre del paquete de las membresías de proyecto y el
-- paquete de las invitaciones pendientes (al aceptarse darán lo que diga su
-- rol). El acceso a proyectos y espacios no cambia. Las membresías de línea,
-- bolo y función se quedan como estaban.
--
-- Worker: create_workspace_invitation pierde p_project_preset. Un Worker que
-- ya lo mande (el de la rama de la fase 3) recibiría error al invitar con
-- proyecto: desplegar antes el Worker anterior, o aceptar ese fallo hasta el
-- deploy.

BEGIN;

-- ── 1 · fuera la proyección y la validación nueva ─────────────────────────
DROP TRIGGER membership_project_legacy ON public.membership;
DROP TRIGGER membership_facet_project_legacy ON public.membership_facet;
DROP TRIGGER membership_validate_roles ON public.membership;

-- ── 2 · membership como la dejaría el espejo ──────────────────────────────
UPDATE public.membership_facet mf
SET source = 'legacy', granted_by = NULL
FROM public.membership m
WHERE m.id = mf.membership_id AND m.level = 'project' AND mf.source <> 'legacy';

UPDATE public.membership SET preset = NULL WHERE level = 'project' AND preset IS NOT NULL;

-- ── 3 · espejo, validación y grants de antes ──────────────────────────────
CREATE TRIGGER workspace_membership_mirror_access
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_membership
  FOR EACH ROW EXECUTE FUNCTION private.mirror_workspace_membership();
CREATE TRIGGER project_membership_mirror_access
  AFTER INSERT OR UPDATE OR DELETE ON public.project_membership
  FOR EACH ROW EXECUTE FUNCTION private.mirror_project_membership();
CREATE TRIGGER workspace_role_mirror_access
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_role
  FOR EACH ROW EXECUTE FUNCTION private.mirror_workspace_role();
CREATE TRIGGER project_membership_validate_roles
  BEFORE INSERT OR UPDATE ON public.project_membership
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_membership_roles();

GRANT INSERT, UPDATE, DELETE ON public.project_membership TO anon, authenticated;

-- ── 4 · RPC y funciones ───────────────────────────────────────────────────
DROP FUNCTION public.set_membership_facet(uuid, uuid, public.access_verb);
DROP FUNCTION public.revoke_membership(uuid);
DROP FUNCTION public.create_workspace_invitation(uuid, text, public.membership_role, uuid, text, integer, text);

-- Los cuerpos de la fase 2, tal como estaban en el catálogo.
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(p_token text)
 RETURNS TABLE(workspace_id uuid, workspace_slug text, workspace_name text, role membership_role)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.can_grant_preset(p_level container_level, p_id uuid, p_preset text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p      public.access_preset;
  v_verb   public.access_verb := private.model_container_verb_at(p_level, p_id, p_user_id);
  v_admin  boolean;
  v_meta   boolean;
  v_members boolean;
BEGIN
  SELECT * INTO v_p FROM public.access_preset WHERE key = p_preset;
  IF v_p.key IS NULL OR v_verb IS NULL THEN
    RETURN false;
  END IF;
  IF v_p.container_verb = 'edit' AND v_verb <> 'edit' THEN
    RETURN false;
  END IF;

  SELECT coalesce(bool_or(m.level = 'workspace' AND m.workspace_role IN ('owner', 'admin')), false),
         coalesce(bool_or(m.can_edit_meta), false),
         coalesce(bool_or(m.can_manage_members), false)
  INTO v_admin, v_meta, v_members
  FROM private.chain_memberships(p_level, p_id, p_user_id) m;

  IF NOT v_admin AND ((v_p.can_edit_meta AND NOT v_meta)
                   OR (v_p.can_manage_members AND NOT v_members)) THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.access_preset_facet pf
    JOIN public.facet f ON f.key = pf.facet_key AND f.workspace_id IS NULL
    JOIN public.facet_level fl ON fl.facet_id = f.id AND fl.level = p_level
    WHERE pf.preset_key = p_preset
      AND NOT private.model_has_facet_at(p_level, p_id, f.id, pf.verb, p_user_id)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_slug text DEFAULT NULL::text, p_accent text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS workspace
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_workspace_invitation(p_workspace_id uuid, p_email text, p_role membership_role DEFAULT 'guest'::membership_role, p_project_id uuid DEFAULT NULL::uuid, p_project_role_code text DEFAULT NULL::text, p_expires_days integer DEFAULT 7)
 RETURNS TABLE(id uuid, email text, role membership_role, project_id uuid, project_role_code text, expires_at timestamp with time zone, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.grant_container_preset(p_level container_level, p_container_id uuid, p_user_id uuid, p_preset text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_ws     uuid;
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_level NOT IN ('line', 'bolo', 'performance') THEN
    RAISE EXCEPTION 'presets at % level arrive in phase 3', p_level USING ERRCODE = '0A000';
  END IF;

  SELECT c.workspace_id INTO v_ws
  FROM private.container_chain(p_level, p_container_id) c
  WHERE c.level = p_level;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'container not found' USING ERRCODE = '42501';
  END IF;

  IF NOT private.can_grant_preset(p_level, p_container_id, p_preset, v_caller) THEN
    RAISE EXCEPTION 'you can only grant what you hold' USING ERRCODE = '42501';
  END IF;
  IF NOT private.model_has_workspace_role(v_ws, p_user_id) THEN
    RAISE EXCEPTION 'grantee is not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  SELECT m.id INTO v_id FROM public.membership m
  WHERE m.level = p_level AND m.user_id = p_user_id
    AND CASE p_level
          WHEN 'line'        THEN m.line_id = p_container_id
          WHEN 'bolo'        THEN m.bolo_id = p_container_id
          WHEN 'performance' THEN m.performance_id = p_container_id
        END;

  IF v_id IS NULL THEN
    INSERT INTO public.membership (workspace_id, level, line_id, bolo_id, performance_id,
                                   user_id, accepted_at, invited_by)
    VALUES (v_ws, p_level,
            CASE WHEN p_level = 'line' THEN p_container_id END,
            CASE WHEN p_level = 'bolo' THEN p_container_id END,
            CASE WHEN p_level = 'performance' THEN p_container_id END,
            p_user_id, now(), v_caller)
    RETURNING id INTO v_id;
  END IF;

  PERFORM private.expand_preset(v_id, p_preset, v_caller);
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.list_workspace_access(p_workspace_id uuid)
 RETURNS TABLE(access_kind text, id uuid, user_id uuid, email text, display_name text, role membership_role, project_id uuid, project_name text, project_role_code text, status text, accepted_at timestamp with time zone, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_workspace_member(p_membership_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_workspace_member_role(p_membership_id uuid, p_role membership_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

REVOKE ALL ON FUNCTION public.create_workspace_invitation(uuid, text, public.membership_role, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(uuid, text, public.membership_role, uuid, text, integer) TO authenticated;

DROP FUNCTION private.can_manage_membership(uuid, uuid);
DROP FUNCTION private.membership_container_id(public.membership);
DROP FUNCTION private.membership_to_legacy();
DROP FUNCTION private.membership_facet_to_legacy();
DROP FUNCTION private.project_legacy_pair(public.container_level, uuid, uuid, uuid);
DROP FUNCTION private.project_legacy_project(uuid, uuid);
DROP FUNCTION private.project_legacy_workspace(uuid, uuid);
DROP FUNCTION private.legacy_project_grants(uuid);
DROP FUNCTION private.validate_membership_roles();

-- ── 5 · invitaciones ──────────────────────────────────────────────────────
ALTER TABLE public.workspace_invitation DROP COLUMN project_preset;

COMMENT ON TABLE public.membership IS
  'Membresía por nivel de contenedor (ADR-082). Estar es ver el contenedor y su hilo General. Espacio y proyecto: espejo de workspace_membership y project_membership hasta la fase 3. Línea, bolo y función: los escribe grant_container_preset.';
COMMENT ON COLUMN public.membership.can_manage_members IS
  'edit:membership. Muere en la fase 3: invitar no es una capacidad, manda el techo del delegante (ADR-100 §3).';
COMMENT ON TABLE public.workspace_membership IS NULL;
COMMENT ON TABLE public.project_membership IS NULL;

-- ── 6 · resincronizar desde las tablas viejas y exigir paridad ────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT wm.workspace_id, wm.user_id FROM public.workspace_membership wm
    UNION
    SELECT m.workspace_id, m.user_id FROM public.membership m WHERE m.level = 'workspace'
  LOOP
    PERFORM private.sync_workspace_access(r.workspace_id, r.user_id);
  END LOOP;
  FOR r IN
    SELECT pm.project_id, pm.user_id FROM public.project_membership pm
    UNION
    SELECT m.project_id, m.user_id FROM public.membership m WHERE m.level = 'project'
  LOOP
    PERFORM private.sync_project_access(r.project_id, r.user_id);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_count  integer;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(format('%s %s %s %s legacy=%s model=%s',
                                     m.user_id, m.workspace_id, coalesce(m.project_id::text, '-'),
                                     m.probe, m.legacy, m.model), E'\n')
  INTO v_count, v_detail
  FROM private.access_parity_mismatches() m;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'rollback permissions_facets_writes: % parity mismatch(es)', v_count
      USING DETAIL = v_detail;
  END IF;
END;
$$;

COMMIT;
