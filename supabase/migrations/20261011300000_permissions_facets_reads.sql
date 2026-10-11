-- Permisos al modelo de facetas, FASE 2: las lecturas pasan al modelo nuevo
-- (ADR-099 §8, ADR-100; plan en build/permissions-facets-plan.md § 6).
--
-- Va DESPUÉS de 20261011100000_permissions_facets_expand. A partir de aquí
-- quien decide el acceso es `membership` + `membership_facet`; las tablas
-- viejas (workspace_membership, project_membership, workspace_role) siguen
-- recibiendo TODAS las escrituras y el espejo del expand las copia al modelo
-- nuevo en el mismo statement. Las escrituras se mueven en la fase 3.
--
-- WHAT THIS DOES:
--   1. Congela los lectores de hoy como `private.legacy_*` (mismo cuerpo,
--      usuario como parámetro) y redefine la paridad contra ellos: sigue
--      comparando el modelo viejo con el nuevo aunque los lectores públicos ya
--      lean el nuevo.
--   2. Cambia el CUERPO (no la firma ni los permisos) de los lectores
--      públicos: has_permission_for_user (y con él has_permission y
--      accessible_project_ids), can_access_project, is_workspace_admin,
--      is_workspace_member, is_workspace_internal_member,
--      current_workspace_role y can_read_workspace_money. Con eso pasan de golpe
--      las políticas y las RPC que los llaman.
--   3. Reescribe los 15 lectores directos de workspace_membership en políticas
--      y los 13 en funciones (permisos de espacio en RPC, y el hook del JWT)
--      para que pregunten al modelo nuevo.
--   4. Aborta si la paridad no es cero.
--
-- NO toca: las funciones que ESCRIBEN membresías o las listan por su id
-- (accept_workspace_invitation, create_workspace, handle_new_user,
-- revoke_workspace_member, update_workspace_member_role,
-- list_workspace_access, create_workspace_invitation,
-- seed_system_roles_on_workspace, validate_project_membership_roles). Son la
-- fase 3.
--
-- REESCRIBE FUNCIONES SECURITY DEFINER: es «destructiva» para § 34 (inspect +
-- staging + plan + apply). Rollback:
-- build/runbooks/rollback-20261011-permissions-facets-reads.sql.

-- ── 1 · los lectores de hoy, congelados ───────────────────────────────────
CREATE FUNCTION private.legacy_has_permission_for_user(p_project_id uuid, p_perm text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.workspace_membership wm
      JOIN public.project p ON p.workspace_id = wm.workspace_id
      WHERE p.id = p_project_id
        AND p.deleted_at IS NULL
        AND wm.user_id = p_user_id
        AND wm.accepted_at IS NOT NULL
        AND wm.role IN ('owner', 'admin')
    )
    OR EXISTS (
      WITH membership AS (
        SELECT pm.roles, pm.permission_grants, pm.permission_revokes, p.workspace_id
        FROM public.project_membership pm
        JOIN public.project p ON p.id = pm.project_id AND p.deleted_at IS NULL
        JOIN public.workspace_membership wm
          ON wm.workspace_id = p.workspace_id
         AND wm.user_id = pm.user_id
         AND wm.accepted_at IS NOT NULL
        WHERE pm.project_id = p_project_id
          AND pm.user_id = p_user_id
      ),
      role_permissions AS (
        SELECT unnest(wr.permissions) AS permission
        FROM public.workspace_role wr
        JOIN membership m ON m.workspace_id = wr.workspace_id
        WHERE wr.code = ANY (m.roles)
          AND wr.archived_at IS NULL
      ),
      effective AS (
        SELECT permission FROM role_permissions
        UNION
        SELECT unnest(m.permission_grants) FROM membership m
        EXCEPT
        SELECT unnest(m.permission_revokes) FROM membership m
      )
      SELECT 1
      FROM effective
      WHERE permission = p_perm
         OR (p_perm = 'read:performance' AND permission = 'edit:performance')
    )
  );
$$;

CREATE FUNCTION private.legacy_workspace_role(p_workspace_id uuid, p_user_id uuid)
RETURNS public.membership_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT wm.role FROM public.workspace_membership wm
  WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_user_id AND wm.accepted_at IS NOT NULL;
$$;

CREATE FUNCTION private.legacy_can_access_project(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.workspace_membership wm
      ON wm.workspace_id = p.workspace_id
     AND wm.user_id = p_user_id
     AND wm.accepted_at IS NOT NULL
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        wm.role IN ('owner', 'admin')
        OR EXISTS (
          SELECT 1 FROM public.project_membership pm
          WHERE pm.project_id = p.id AND pm.user_id = p_user_id
        )
      )
  );
$$;

CREATE FUNCTION private.legacy_can_read_workspace_money(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_workspace_id IS NOT NULL AND (
    coalesce(private.legacy_workspace_role(p_workspace_id, p_user_id) IN ('owner', 'admin'), false)
    OR EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.workspace_id = p_workspace_id
        AND p.deleted_at IS NULL
        AND private.legacy_has_permission_for_user(p.id, 'read:money', p_user_id)
    )
  );
$$;

REVOKE ALL ON FUNCTION private.legacy_has_permission_for_user(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.legacy_workspace_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.legacy_can_access_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.legacy_can_read_workspace_money(uuid, uuid) FROM PUBLIC;

-- La paridad, ahora contra las copias congeladas: ya no hace falta suplantar
-- a nadie, y no compara el modelo nuevo consigo mismo.
CREATE OR REPLACE FUNCTION private.access_parity_mismatches()
RETURNS TABLE (user_id uuid, workspace_id uuid, project_id uuid, probe text, legacy boolean, model boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  c_perms   CONSTANT text[] := ARRAY[
    'read:performance', 'edit:performance', 'read:money', 'edit:money',
    'read:conversation', 'edit:conversation', 'edit:project_meta', 'edit:membership'
  ];
  v_perm    text;
  v_legacy  boolean;
  v_model   boolean;
  v_lrole   public.membership_role;
  v_mrole   public.membership_role;
  r         record;
BEGIN
  FOR r IN
    SELECT DISTINCT x.u, x.ws
    FROM (
      SELECT wm.user_id AS u, wm.workspace_id AS ws FROM public.workspace_membership wm
      UNION
      SELECT m.user_id, m.workspace_id FROM public.membership m WHERE m.level IN ('workspace', 'project')
    ) x
  LOOP
    v_lrole := private.legacy_workspace_role(r.ws, r.u);
    v_mrole := private.model_workspace_role(r.ws, r.u);
    IF v_lrole IS DISTINCT FROM v_mrole THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'workspace_role'; legacy := v_lrole IS NOT NULL; model := v_mrole IS NOT NULL; RETURN NEXT;
    END IF;

    v_legacy := private.legacy_can_read_workspace_money(r.ws, r.u);
    v_model  := private.model_can_read_workspace_money(r.ws, r.u);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := NULL;
      probe := 'can_read_workspace_money'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;
  END LOOP;

  FOR r IN
    SELECT DISTINCT x.u, p.id AS pid, p.workspace_id AS ws
    FROM public.project p
    JOIN (
      SELECT wm.user_id AS u, wm.workspace_id AS ws FROM public.workspace_membership wm
      UNION
      SELECT m.user_id, m.workspace_id FROM public.membership m WHERE m.level IN ('workspace', 'project')
    ) x ON x.ws = p.workspace_id
    UNION
    SELECT pm.user_id, pm.project_id, p.workspace_id
    FROM public.project_membership pm
    JOIN public.project p ON p.id = pm.project_id
  LOOP
    v_legacy := private.legacy_can_access_project(r.pid, r.u);
    v_model  := private.model_can_access_project(r.pid, r.u);
    IF v_legacy IS DISTINCT FROM v_model THEN
      user_id := r.u; workspace_id := r.ws; project_id := r.pid;
      probe := 'can_access_project'; legacy := v_legacy; model := v_model; RETURN NEXT;
    END IF;

    FOREACH v_perm IN ARRAY c_perms LOOP
      v_legacy := private.legacy_has_permission_for_user(r.pid, v_perm, r.u);
      v_model  := private.model_has_permission(r.pid, v_perm, r.u);
      IF v_legacy IS DISTINCT FROM v_model THEN
        user_id := r.u; workspace_id := r.ws; project_id := r.pid;
        probe := v_perm; legacy := v_legacy; model := v_model; RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- ── 2 · los lectores públicos leen el modelo nuevo ────────────────────────
CREATE OR REPLACE FUNCTION public.has_permission_for_user(p_project_id uuid, p_perm text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  -- Los ocho permisos vivos los contesta el modelo nuevo. read:internal_notes y
  -- admin:project no tienen traducción (no los lee ninguna política ni RPC) y
  -- siguen saliendo de las tablas viejas hasta que el contract los borre;
  -- update-workspace.test.ts todavía pregunta read:internal_notes.
  SELECT CASE
    WHEN p_perm IN ('read:performance', 'edit:performance', 'read:money', 'edit:money',
                    'read:conversation', 'edit:conversation', 'edit:project_meta', 'edit:membership')
      THEN private.model_has_permission(p_project_id, p_perm, p_user_id)
    ELSE private.legacy_has_permission_for_user(p_project_id, p_perm, p_user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_can_access_project(p_project_id, (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT private.model_has_workspace_role(ws_id, (SELECT auth.uid()), ARRAY['owner', 'admin']::public.membership_role[]);
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT private.model_has_workspace_role(ws_id, (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_internal_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_has_workspace_role(p_workspace_id, (SELECT auth.uid()),
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[]);
$$;

CREATE OR REPLACE FUNCTION public.current_workspace_role()
RETURNS public.membership_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT private.model_workspace_role(public.current_workspace_id(), (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION public.can_read_workspace_money(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT private.model_can_read_workspace_money(p_workspace_id, (SELECT auth.uid()));
$$;

-- ── 3 · lectores directos ─────────────────────────────────────────────────
-- Dos ayudantes para políticas (corren como el que llama: necesitan EXECUTE).
CREATE FUNCTION private.has_workspace_role(p_workspace_id uuid, p_roles public.membership_role[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_has_workspace_role(p_workspace_id, (SELECT auth.uid()), p_roles);
$$;

-- ¿Comparto algún espacio con esta persona? (los dos aceptados)
CREATE FUNCTION private.shares_workspace_with(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.membership m1
    JOIN public.membership m2
      ON m2.workspace_id = m1.workspace_id
     AND m2.level = 'workspace'
     AND m2.user_id = p_user_id
     AND m2.accepted_at IS NOT NULL
    WHERE m1.level = 'workspace'
      AND m1.user_id = (SELECT auth.uid())
      AND m1.accepted_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION private.has_workspace_role(uuid, public.membership_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.shares_workspace_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_workspace_role(uuid, public.membership_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.shares_workspace_with(uuid) TO authenticated;

ALTER POLICY audit_log_select ON public.audit_log
  USING ((actor_id = (SELECT auth.uid()))
         OR (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id)));

ALTER POLICY invoice_select ON public.invoice
  USING (deleted_at IS NULL AND (
    (project_id IS NOT NULL AND public.has_permission(project_id, 'read:money'))
    OR (project_id IS NULL AND public.is_workspace_admin(workspace_id))));

ALTER POLICY invoice_update ON public.invoice
  USING (deleted_at IS NULL AND (
    (project_id IS NOT NULL AND public.has_permission(project_id, 'edit:money'))
    OR (project_id IS NULL AND public.is_workspace_admin(workspace_id))));

ALTER POLICY invoice_line_select ON public.invoice_line
  USING (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_line.invoice_id
      AND i.deleted_at IS NULL
      AND ((i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'read:money'))
        OR (i.project_id IS NULL AND public.is_workspace_admin(i.workspace_id)))));

ALTER POLICY invoice_tax_line_select ON public.invoice_tax_line
  USING (EXISTS (
    SELECT 1 FROM public.invoice i
    WHERE i.id = invoice_tax_line.invoice_id
      AND i.deleted_at IS NULL
      AND ((i.project_id IS NOT NULL AND public.has_permission(i.project_id, 'read:money'))
        OR (i.project_id IS NULL AND public.is_workspace_admin(i.workspace_id)))));

ALTER POLICY user_profile_select ON public.user_profile
  USING ((user_id = (SELECT auth.uid())) OR private.shares_workspace_with(user_id));

ALTER POLICY venue_delete ON public.venue
  USING (public.is_workspace_admin(workspace_id));

ALTER POLICY workspace_update ON public.workspace
  USING (deleted_at IS NULL AND public.is_workspace_admin(id))
  WITH CHECK (deleted_at IS NULL AND public.is_workspace_admin(id));

ALTER POLICY alias_request_select ON public.workspace_alias_request
  USING (public.is_workspace_member(workspace_id)
         OR EXISTS (SELECT 1 FROM public.user_profile p
                    WHERE p.user_id = (SELECT auth.uid()) AND p.is_platform_admin));

ALTER POLICY workspace_organization_insert ON public.workspace_organization
  WITH CHECK ((created_by = (SELECT auth.uid()))
              AND private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]));

ALTER POLICY workspace_organization_update ON public.workspace_organization
  USING (deleted_at IS NULL
         AND private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]))
  WITH CHECK (private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]));

ALTER POLICY workspace_person_insert ON public.workspace_person
  WITH CHECK ((created_by = (SELECT auth.uid()))
              AND private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]));

ALTER POLICY workspace_person_update ON public.workspace_person
  USING (deleted_at IS NULL
         AND private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]))
  WITH CHECK (private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]));

ALTER POLICY workspace_role_delete ON public.workspace_role
  USING (is_system = false AND public.is_workspace_admin(workspace_id));

ALTER POLICY workspace_role_update ON public.workspace_role
  USING (public.is_workspace_member(workspace_id) AND public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id) AND public.is_workspace_admin(workspace_id));

-- El hook del JWT corre como supabase_auth_admin (SECURITY INVOKER): necesita
-- leer `membership`, igual que leía workspace_membership.
GRANT SELECT ON public.membership TO supabase_auth_admin;
CREATE POLICY membership_auth_admin_select ON public.membership
  FOR SELECT TO supabase_auth_admin USING (true);

-- Las RPC que preguntaban workspace_membership a pelo. Mismo cuerpo; solo
-- cambia la pregunta de permiso (o la tabla, en el hook y en dos joins).
-- · adopt_directory_venue
CREATE OR REPLACE FUNCTION public.adopt_directory_venue(p_workspace_id uuid, p_directory_id uuid)
 RETURNS venue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_entry public.venue_directory;
  v_venue public.venue;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_contacts jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry FROM public.venue_directory WHERE id = p_directory_id;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'directory entry not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id AND directory_id = p_directory_id AND deleted_at IS NULL;
  IF v_venue.id IS NOT NULL THEN
    RETURN v_venue;
  END IF;

  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id
    AND deleted_at IS NULL
    AND lower(name) = lower(btrim(v_entry.name))
    AND coalesce(lower(city), '') = coalesce(lower(btrim(v_entry.city)), '');
  IF v_venue.id IS NOT NULL THEN
    IF v_venue.directory_id IS NULL THEN
      UPDATE public.venue SET directory_id = p_directory_id
      WHERE id = v_venue.id
      RETURNING * INTO v_venue;
    END IF;
    RETURN v_venue;
  END IF;

  IF v_entry.email IS NOT NULL OR v_entry.phone IS NOT NULL THEN
    v_contacts := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(v_entry.name), 'email', v_entry.email, 'phone', v_entry.phone)));
  END IF;

  v_base := coalesce(nullif(public.slugify(v_entry.name), ''), 'venue');
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.venue
    WHERE workspace_id = p_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.venue (
    workspace_id, name, city, country, address, capacity, timezone, contacts,
    slug, directory_id, created_by
  ) VALUES (
    p_workspace_id, btrim(v_entry.name), nullif(btrim(coalesce(v_entry.city, '')), ''),
    v_entry.country, v_entry.address, v_entry.capacity, v_entry.timezone, v_contacts,
    v_slug, p_directory_id, v_caller
  )
  RETURNING * INTO v_venue;
  RETURN v_venue;
END;
$function$
;

-- · create_calendar_share
CREATE OR REPLACE FUNCTION public.create_calendar_share(p_workspace_id uuid)
 RETURNS calendar_share
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_share public.calendar_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'a write role is required to publish a calendar feed'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.calendar_share (token, workspace_id, created_by)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_workspace_id, v_caller
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$function$
;

-- · create_line
CREATE OR REPLACE FUNCTION public.create_line(p_project_id uuid, p_name text, p_accent text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_kind line_kind DEFAULT 'other'::line_kind, p_modules jsonb DEFAULT NULL::jsonb)
 RETURNS public.line
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_accent       text;
  v_description  text;
  v_line_id      uuid;
  v_slug         text;
  v_line         public.line;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_modules IS NOT NULL AND jsonb_typeof(p_modules) <> 'array' THEN
    RAISE EXCEPTION 'modules must be a json array' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.model_has_workspace_role(v_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', v_workspace_id
      USING ERRCODE = '42501';
  END IF;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  v_line_id := public.uuid_generate_v7();
  v_slug := coalesce(nullif(left(public.slugify(trim(p_name)), 57), ''), 'line');
  v_slug := rtrim(v_slug, '-');
  IF public.is_reserved_slug(v_slug) OR EXISTS (
    SELECT 1 FROM public.line
    WHERE workspace_id = v_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) THEN
    v_slug := v_slug || '-' ||
      substring(replace(v_line_id::text, '-', '') FROM 1 FOR 6);
  END IF;

  INSERT INTO public.line (
    id, slug, workspace_id, project_id, name, kind, accent, description,
    modules, created_by
  )
  VALUES (
    v_line_id, v_slug, v_workspace_id, p_project_id, trim(p_name), p_kind,
    v_accent, v_description, p_modules, v_caller
  )
  RETURNING * INTO v_line;

  RETURN v_line;
END;
$function$
;

-- · create_project
CREATE OR REPLACE FUNCTION public.create_project(p_workspace_id uuid, p_name text, p_accent text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_slug text DEFAULT NULL::text)
 RETURNS project
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller      uuid := auth.uid();
  v_slug        text;
  v_accent      text;
  v_description text;
  v_project     public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'caller is not a member of workspace % with sufficient role', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  v_slug := COALESCE(NULLIF(trim(p_slug), ''), public.slugify(p_name));
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'project-' || substr(gen_random_uuid()::text, 1, 8);
  END IF;

  IF public.is_reserved_slug(v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END IF;

  WHILE EXISTS (
    SELECT 1 FROM public.project
    WHERE workspace_id = p_workspace_id
      AND slug = v_slug
      AND deleted_at IS NULL
  ) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  v_accent      := NULLIF(trim(p_accent), '');
  v_description := NULLIF(trim(p_description), '');

  INSERT INTO public.project (
    workspace_id, slug, name, status, accent, description, created_by
  )
  VALUES (
    p_workspace_id, v_slug, trim(p_name), 'active', v_accent, v_description, v_caller
  )
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$function$
;

-- · create_venue
CREATE OR REPLACE FUNCTION public.create_venue(p_workspace_id uuid, p_name text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_timezone text DEFAULT NULL::text)
 RETURNS venue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_slug text;
  v_base text;
  v_n int := 1;
  v_venue public.venue;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name is required' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND p_country !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'country must be ISO 3166 alpha-2' USING ERRCODE = '22023';
  END IF;
  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  -- Idempotent promote: same name+city in the workspace → return it.
  SELECT * INTO v_venue FROM public.venue
  WHERE workspace_id = p_workspace_id
    AND deleted_at IS NULL
    AND lower(name) = lower(v_name)
    AND coalesce(lower(city), '') = coalesce(lower(v_city), '');
  IF v_venue.id IS NOT NULL THEN
    RETURN v_venue;
  END IF;

  v_base := coalesce(nullif(public.slugify(v_name), ''), 'venue');
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.venue
    WHERE workspace_id = p_workspace_id AND slug = v_slug AND deleted_at IS NULL
  ) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.venue (workspace_id, name, city, country, address, capacity, timezone, slug, created_by)
  VALUES (p_workspace_id, v_name, v_city, upper(p_country), nullif(btrim(coalesce(p_address, '')), ''), p_capacity, p_timezone, v_slug, v_caller)
  RETURNING * INTO v_venue;
  RETURN v_venue;
END;
$function$
;

-- · custom_access_token_hook
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id      uuid  := (event ->> 'user_id')::uuid;
  v_claims       jsonb := COALESCE(event -> 'claims', '{}'::jsonb);
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id
    INTO v_workspace_id
    FROM public.membership
   WHERE level = 'workspace' AND user_id = v_user_id
     AND accepted_at IS NOT NULL
   ORDER BY accepted_at ASC
   LIMIT 1;

  IF v_workspace_id IS NOT NULL THEN
    v_claims := v_claims || jsonb_build_object(
      'current_workspace_id', v_workspace_id::text
    );
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$function$
;

-- · delete_invoice
CREATE OR REPLACE FUNCTION public.delete_invoice(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_inv public.invoice;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found' USING ERRCODE = '42501';
  END IF;
  IF v_inv.project_id IS NOT NULL THEN
    IF NOT public.has_permission(v_inv.project_id, 'edit:money') THEN
      RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT private.model_has_workspace_role(v_inv.workspace_id, v_caller, ARRAY['owner', 'admin']::public.membership_role[]) THEN
      RAISE EXCEPTION 'workspace owner/admin required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft invoices can be deleted — cancel it instead' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoice SET deleted_at = now() WHERE id = p_invoice_id;
END;
$function$
;

-- · list_calendar_shares
CREATE OR REPLACE FUNCTION public.list_calendar_shares(p_workspace_id uuid)
 RETURNS SETOF calendar_share
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT private.model_has_workspace_role(p_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.calendar_share
    WHERE workspace_id = p_workspace_id AND revoked_at IS NULL
    ORDER BY created_at DESC;
END;
$function$
;

-- · request_workspace_alias
CREATE OR REPLACE FUNCTION public.request_workspace_alias(p_workspace_id uuid, p_alias text)
 RETURNS workspace_alias_request
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller, ARRAY['owner', 'admin']::public.membership_role[]) THEN
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
$function$
;

-- · revoke_calendar_share
CREATE OR REPLACE FUNCTION public.revoke_calendar_share(p_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT s.workspace_id INTO v_ws
  FROM public.calendar_share s
  WHERE s.id = p_share_id AND s.revoked_at IS NULL;
  IF v_ws IS NULL OR auth.uid() IS NULL OR NOT private.model_has_workspace_role(v_ws, auth.uid(), ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_share SET revoked_at = now() WHERE id = p_share_id;
END;
$function$
;

-- · share_my_profile_with_workspace
CREATE OR REPLACE FUNCTION public.share_my_profile_with_workspace(p_workspace_id uuid, p_fields text[] DEFAULT ARRAY['full_name'::text, 'first_name'::text, 'last_name'::text, 'phone'::text, 'website'::text, 'city'::text, 'country'::text, 'languages'::text, 'professional_title'::text])
 RETURNS workspace_person
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_profile public.user_profile;
  v_person public.person;
  v_person_id uuid;
  v_email extensions.citext;
  v_slug text;
  v_allowed constant text[] := array[
    'full_name', 'first_name', 'last_name', 'phone', 'website', 'city',
    'country', 'languages', 'professional_title'
  ];
  v_fields text[];
  v_result public.workspace_person;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'accepted workspace membership required' using errcode = '42501';
  end if;

  select * into v_profile from public.user_profile where user_id = v_caller;
  if v_profile.user_id is null then
    raise exception 'user profile not found' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct f order by f), '{}') into v_fields
  from unnest(coalesce(p_fields, '{}')) f
  where f = any(v_allowed);
  if cardinality(v_fields) = 0 or not ('full_name' = any(v_fields)) then
    raise exception 'shared fields must include full_name' using errcode = '22023';
  end if;

  v_person_id := v_profile.person_id;
  if v_person_id is null then
    select u.email::extensions.citext into v_email
    from auth.users u
    where u.id = v_caller and u.email_confirmed_at is not null;

    -- Explicit share + verified auth email is the claim event. Unlike contact
    -- capture, this may link an existing local dossier to the signed-in user.
    -- Prefer the target workspace, then another accepted workspace.
    if v_email is not null then
      select p.* into v_person
      from public.workspace_person wp
      join public.membership m on m.workspace_id = wp.workspace_id and m.level = 'workspace'
      join public.person p on p.id = wp.person_id
      where wp.email = v_email and wp.deleted_at is null
        and m.user_id = v_caller and m.accepted_at is not null
        and not exists (
          select 1 from public.user_profile claimed where claimed.person_id = p.id
        )
      order by (wp.workspace_id = p_workspace_id) desc, wp.created_at asc
      limit 1;
    end if;

    -- Legacy rows may still carry the old global email without any local
    -- dossier. Keep this as a migration bridge, after the workspace lookup.
    if v_person.id is null and v_email is not null then
      select p.* into v_person
      from public.person p
      where p.email = v_email and p.deleted_at is null
        and not exists (
          select 1 from public.user_profile claimed where claimed.person_id = p.id
        )
      limit 1;
    end if;

    if v_person.id is null then
      v_person_id := public.uuid_generate_v7();
      v_slug := 'person-' || substring(replace(v_person_id::text, '-', '') from 1 for 12);
      insert into public.person (id, slug, full_name, email, created_by)
      values (
        v_person_id,
        v_slug,
        'Person ' || substring(replace(v_person_id::text, '-', '') from 1 for 8),
        null,
        v_caller
      );
    else
      v_person_id := v_person.id;
    end if;

    update public.user_profile set person_id = v_person_id where user_id = v_caller;
  end if;

  v_slug := coalesce(
    nullif(rtrim(left(public.slugify(v_profile.full_name), 63), '-'), ''),
    'person'
  );
  if exists (
    select 1 from public.workspace_person wp
    where wp.workspace_id = p_workspace_id and wp.slug = v_slug
      and wp.person_id <> v_person_id and wp.deleted_at is null
  ) then
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || substring(replace(v_person_id::text, '-', '') from 1 for 6);
  end if;

  insert into public.workspace_person (
    workspace_id, person_id, slug, full_name, first_name, last_name, phone,
    website, city, country, languages, title, profile_sync_enabled,
    profile_shared_fields, profile_shared_at, created_by
  ) values (
    p_workspace_id, v_person_id, v_slug, v_profile.full_name,
    case when 'first_name' = any(v_fields) then v_profile.first_name end,
    case when 'last_name' = any(v_fields) then v_profile.last_name end,
    case when 'phone' = any(v_fields) then v_profile.phone end,
    case when 'website' = any(v_fields) then v_profile.website end,
    case when 'city' = any(v_fields) then v_profile.city end,
    case when 'country' = any(v_fields) then v_profile.country end,
    case when 'languages' = any(v_fields) then v_profile.languages else '{}' end,
    case when 'professional_title' = any(v_fields) then v_profile.professional_title end,
    true, v_fields, now(), v_caller
  )
  on conflict (workspace_id, person_id) do update set
    full_name = case when 'full_name' = any(v_fields) then excluded.full_name else workspace_person.full_name end,
    first_name = case when 'first_name' = any(v_fields) then excluded.first_name else workspace_person.first_name end,
    last_name = case when 'last_name' = any(v_fields) then excluded.last_name else workspace_person.last_name end,
    phone = case when 'phone' = any(v_fields) then excluded.phone else workspace_person.phone end,
    website = case when 'website' = any(v_fields) then excluded.website else workspace_person.website end,
    city = case when 'city' = any(v_fields) then excluded.city else workspace_person.city end,
    country = case when 'country' = any(v_fields) then excluded.country else workspace_person.country end,
    languages = case when 'languages' = any(v_fields) then excluded.languages else workspace_person.languages end,
    title = case when 'professional_title' = any(v_fields) then excluded.title else workspace_person.title end,
    profile_sync_enabled = true,
    profile_shared_fields = v_fields,
    profile_shared_at = now(),
    deleted_at = null
  returning * into v_result;

  return v_result;
end;
$function$
;

-- · update_project
CREATE OR REPLACE FUNCTION public.update_project(p_project_id uuid, p_patch jsonb)
 RETURNS project
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_project public.project;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.membership m ON m.workspace_id = p.workspace_id AND m.level = 'workspace'
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND m.user_id     = v_caller
      AND m.accepted_at IS NOT NULL
      AND m.workspace_role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'caller lacks permission to edit project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'name' AND length(trim(coalesce(p_patch->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'name cannot be empty' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project p SET
    name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                   ELSE p.name        END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '') ELSE p.description END,
    accent      = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')     ELSE p.accent      END,
    initials    = CASE WHEN p_patch ? 'initials'    THEN NULLIF(trim(p_patch->>'initials'), '')   ELSE p.initials    END,
    updated_at  = now()
  WHERE p.id = p_project_id AND p.deleted_at IS NULL
  RETURNING * INTO v_project;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_project;
END;
$function$
;

-- · update_workspace
CREATE OR REPLACE FUNCTION public.update_workspace(p_workspace_id uuid, p_patch jsonb)
 RETURNS workspace
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_workspace public.workspace;
  v_mode      text := NULLIF(trim(coalesce(p_patch->>'booking_mode', '')), '');
  v_inv_mode  text := NULLIF(trim(coalesce(p_patch->>'invoicing_mode', '')), '');
  v_fid       uuid := NULLIF(trim(coalesce(p_patch->>'fiscal_identity_id', '')), '')::uuid;
  v_settings  jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller, ARRAY['owner', 'admin']::public.membership_role[]) THEN
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

  -- The override must be a workspace-owned issuer identity of this workspace.
  IF p_patch ? 'fiscal_identity_id' AND v_fid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = v_fid
      AND fi.workspace_id = p_workspace_id
      AND fi.kind = 'issuer'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'fiscal_identity_id must be a workspace-owned issuer identity'
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
    name               = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')                           ELSE w.name        END,
    description        = CASE WHEN p_patch ? 'description' THEN NULLIF(trim(p_patch->>'description'), '')         ELSE w.description END,
    accent             = CASE WHEN p_patch ? 'accent'      THEN NULLIF(trim(p_patch->>'accent'), '')             ELSE w.accent      END,
    domain             = CASE WHEN p_patch ? 'domain'      THEN NULLIF(p_patch->>'domain', '')::workspace_domain ELSE w.domain      END,
    city               = CASE WHEN p_patch ? 'city'        THEN NULLIF(trim(p_patch->>'city'), '')               ELSE w.city        END,
    logo_url           = CASE WHEN p_patch ? 'logo_url'    THEN NULLIF(trim(p_patch->>'logo_url'), '')            ELSE w.logo_url    END,
    fiscal_identity_id = CASE WHEN p_patch ? 'fiscal_identity_id' THEN v_fid                                     ELSE w.fiscal_identity_id END,
    settings           = CASE WHEN (p_patch ? 'booking_mode') OR (p_patch ? 'invoicing_mode')
                              THEN v_settings ELSE w.settings END,
    updated_at         = now()
  WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
  RETURNING * INTO v_workspace;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_workspace;
END;
$function$
;


-- ── 4 · la migración no se aplica si la paridad no es cero ────────────────
DO $$
DECLARE
  v_count  integer;
  v_detail text;
BEGIN
  CREATE TEMP TABLE permissions_facets_reads_parity ON COMMIT DROP AS
    SELECT * FROM private.access_parity_mismatches();

  SELECT count(*) INTO v_count FROM permissions_facets_reads_parity;
  SELECT string_agg(format('%s %s %s %s legacy=%s model=%s',
                           m.user_id, m.workspace_id, coalesce(m.project_id::text, '-'),
                           m.probe, m.legacy, m.model), E'\n')
  INTO v_detail
  FROM (SELECT * FROM permissions_facets_reads_parity LIMIT 50) m;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'permissions_facets_reads: % parity mismatch(es); nothing applied', v_count
      USING DETAIL = v_detail;
  END IF;
END;
$$;
