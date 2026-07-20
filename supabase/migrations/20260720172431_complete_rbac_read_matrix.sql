-- Phase 0.9 RBAC read matrix.
--
-- 1. Introduce the missing read:performance capability and use it for every
--    production/read surface while keeping edit:performance on writes.
-- 2. Make non-admin project visibility assignment-bound.
-- 3. Keep guests out of workspace-wide directories and operational feeds.
-- 4. Remove fee columns from direct authenticated SELECT and expose them only
--    through a read:money-gated RPC.
-- 5. Add a service-role-only live authorization seam for collab sockets.

CREATE OR REPLACE FUNCTION public.has_permission_for_user(
  p_project_id uuid,
  p_perm text,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
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
        SELECT pm.roles,
               pm.permission_grants,
               pm.permission_revokes,
               p.workspace_id
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
         OR (
           p_perm = 'read:performance'
           AND permission = 'edit:performance'
         )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_permission_for_user(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_permission(p_project_id uuid, p_perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT public.has_permission_for_user(p_project_id, p_perm, (SELECT auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.workspace_membership wm
      ON wm.workspace_id = p.workspace_id
     AND wm.user_id = (SELECT auth.uid())
     AND wm.accepted_at IS NOT NULL
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        wm.role IN ('owner', 'admin')
        OR EXISTS (
          SELECT 1
          FROM public.project_membership pm
          WHERE pm.project_id = p.id
            AND pm.user_id = (SELECT auth.uid())
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_project(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_workspace_internal_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_membership wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = (SELECT auth.uid())
      AND wm.accepted_at IS NOT NULL
      AND wm.role IN ('owner', 'admin', 'member', 'viewer')
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_internal_member(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_internal_member(uuid) TO authenticated;

-- Existing system roles receive the new read capability. Editing always
-- implies reading in has_permission_for_user, including for custom roles and
-- one-off grants, so no existing editor becomes a blind writer.
UPDATE public.workspace_role
SET permissions = array_append(permissions, 'read:performance'),
    updated_at = now()
WHERE is_system
  AND NOT ('read:performance' = ANY (permissions));

INSERT INTO public.workspace_role (
  workspace_id, code, label, is_system, access_level, permissions
)
SELECT id, 'viewer', 'Viewer', true, 'viewer', ARRAY['read:performance']::text[]
FROM public.workspace
ON CONFLICT (workspace_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_system_roles_on_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.workspace_role (
    workspace_id, code, label, is_system, access_level, permissions
  ) VALUES
    (NEW.id, 'owner',              'Owner',              true, 'owner',    ARRAY['read:performance','read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta','edit:membership','admin:project']::text[]),
    (NEW.id, 'admin',              'Admin',              true, 'admin',    ARRAY['read:performance','read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta','edit:membership']::text[]),
    (NEW.id, 'producer',           'Producer',           true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'production_manager', 'Production Manager', true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'tour_manager',       'Tour Manager',       true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'distribution',       'Distribution',       true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:person_note_private','read:internal_notes','edit:performance','edit:conversation','edit:project_meta']::text[]),
    (NEW.id, 'director',           'Director',           true, 'member',   ARRAY['read:performance','read:conversation','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'author',             'Author',             true, 'member',   ARRAY['read:performance','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'technical_director', 'Technical Director', true, 'member',   ARRAY['read:performance','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'performer',          'Performer',          true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'light_design',       'Light Design',       true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'sound_design',       'Sound Design',       true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'stage_design',       'Stage Design',       true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'costume_design',     'Costume Design',     true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'press',              'Press',              true, 'member',   ARRAY['read:performance','read:conversation','read:internal_notes']::text[]),
    (NEW.id, 'viewer',             'Viewer',             true, 'viewer',   ARRAY['read:performance']::text[]);
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.workspace_role.permissions IS
  'Closed vocabulary: read:performance, read:money, read:conversation, read:person_note_private, read:internal_notes, edit:performance, edit:conversation, edit:money, edit:project_meta, edit:membership, admin:project.';

-- Project and production reads are now independent from write authority.
DROP POLICY IF EXISTS project_select ON public.project;
CREATE POLICY project_select ON public.project FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.can_access_project(id));

DROP POLICY IF EXISTS line_select ON public.line;
CREATE POLICY line_select ON public.line FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.has_permission(project_id, 'read:performance')
    OR public.has_permission(project_id, 'edit:project_meta')
  )
);

DROP POLICY IF EXISTS performance_select ON public.performance;
CREATE POLICY performance_select ON public.performance FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.has_permission(project_id, 'read:performance'));

DROP POLICY IF EXISTS date_select ON public.date;
CREATE POLICY date_select ON public.date FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.has_permission(project_id, 'read:performance'));

DROP POLICY IF EXISTS cast_member_select ON public.cast_member;
CREATE POLICY cast_member_select ON public.cast_member FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.has_permission(project_id, 'read:performance'));

DROP POLICY IF EXISTS cast_override_select ON public.cast_override;
CREATE POLICY cast_override_select ON public.cast_override FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.has_permission(
    public.project_id_of_performance(performance_id),
    'read:performance'
  )
);

DROP POLICY IF EXISTS crew_assignment_select ON public.crew_assignment;
CREATE POLICY crew_assignment_select ON public.crew_assignment FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.has_permission(
    public.project_id_of_performance(performance_id),
    'read:performance'
  )
);

DROP POLICY IF EXISTS asset_version_select ON public.asset_version;
CREATE POLICY asset_version_select ON public.asset_version FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.has_permission(
    public.project_id_of_asset_version(project_id, line_id, performance_id),
    'read:performance'
  )
);

-- Guests enter the workspace shell but do not receive its complete directory,
-- availability, task feed or member list. Their project role exposes only the
-- assigned production surfaces above.
DROP POLICY IF EXISTS workspace_membership_select ON public.workspace_membership;
CREATE POLICY workspace_membership_select ON public.workspace_membership
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.is_workspace_admin(workspace_id)
);

DROP POLICY IF EXISTS workspace_person_select ON public.workspace_person;
CREATE POLICY workspace_person_select ON public.workspace_person FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

DROP POLICY IF EXISTS workspace_organization_select ON public.workspace_organization;
CREATE POLICY workspace_organization_select ON public.workspace_organization FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

DROP POLICY IF EXISTS venue_select ON public.venue;
CREATE POLICY venue_select ON public.venue FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

DROP POLICY IF EXISTS availability_block_select ON public.availability_block;
CREATE POLICY availability_block_select ON public.availability_block FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

DROP POLICY IF EXISTS task_select ON public.task;
CREATE POLICY task_select ON public.task FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_workspace_internal_member(workspace_id));

DROP POLICY IF EXISTS collab_snapshot_select ON public.collab_snapshot;
CREATE POLICY collab_snapshot_select ON public.collab_snapshot FOR SELECT TO authenticated
USING (public.is_workspace_internal_member(workspace_id));

CREATE OR REPLACE FUNCTION public.can_see_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_person wp
    WHERE wp.person_id = p_person_id
      AND wp.deleted_at IS NULL
      AND public.is_workspace_internal_member(wp.workspace_id)
  ) OR EXISTS (
    SELECT 1
    FROM public.user_profile up
    WHERE up.user_id = (SELECT auth.uid())
      AND up.person_id = p_person_id
  );
$$;

-- RLS cannot protect fee columns. Remove them from the base-table SELECT
-- grant so a custom PostgREST request cannot bypass read:money.
REVOKE SELECT ON TABLE public.performance FROM authenticated;
GRANT SELECT (
  id, workspace_id, project_id, line_id, conversation_id, performed_at,
  venue_id, venue_name, city, country, status, notes, custom_fields,
  created_by, created_at, updated_at, deleted_at, load_in_at, soundcheck_at,
  start_at, loadout_at, wrap_at, logistics, hospitality, technical, slug,
  previous_slugs, hold_notice_days, readiness
) ON public.performance TO authenticated;

REVOKE SELECT ON public.performance_redacted FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_money_performances(
  p_project_ids uuid[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL,
  p_line_ids uuid[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS TABLE (
  id uuid,
  slug text,
  performed_at date,
  status public.performance_status,
  venue_name text,
  city text,
  fee_amount numeric,
  fee_currency character(3),
  project_id uuid,
  line_id uuid,
  project jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT pf.id,
         pf.slug,
         pf.performed_at,
         pf.status,
         pf.venue_name,
         pf.city,
         pf.fee_amount,
         pf.fee_currency,
         pf.project_id,
         pf.line_id,
         jsonb_build_object(
           'id', p.id,
           'slug', p.slug,
           'name', p.name,
           'accent', p.accent,
           'workspace_id', p.workspace_id
         ) AS project
  FROM public.performance pf
  JOIN public.project p ON p.id = pf.project_id AND p.deleted_at IS NULL
  WHERE pf.deleted_at IS NULL
    AND public.has_permission(pf.project_id, 'read:money')
    AND (
      (coalesce(cardinality(p_project_ids), 0) = 0 AND coalesce(cardinality(p_workspace_ids), 0) = 0)
      OR pf.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR pf.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
    AND (
      coalesce(cardinality(p_line_ids), 0) = 0
      OR pf.line_id = ANY (p_line_ids)
    )
    AND (p_from IS NULL OR pf.performed_at >= p_from)
    AND (p_to IS NULL OR pf.performed_at <= p_to)
  ORDER BY pf.performed_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_money_performances(
  uuid[], uuid[], uuid[], date, date, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_money_performances(
  uuid[], uuid[], uuid[], date, date, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_performance_fee(
  p_performance_id uuid,
  p_fee_amount numeric,
  p_fee_currency text DEFAULT 'EUR'
) RETURNS TABLE (
  id uuid,
  fee_amount numeric,
  fee_currency character(3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_currency text;
BEGIN
  SELECT pf.project_id INTO v_project_id
  FROM public.performance pf
  WHERE pf.id = p_performance_id
    AND pf.deleted_at IS NULL;

  IF v_project_id IS NULL
     OR NOT public.has_permission(v_project_id, 'edit:performance')
     OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'performance not found or edit:money required'
      USING ERRCODE = '42501';
  END IF;

  IF p_fee_amount IS NOT NULL
     AND (p_fee_amount < 0 OR p_fee_amount > 9999999999.99) THEN
    RAISE EXCEPTION 'fee amount out of range' USING ERRCODE = '22023';
  END IF;

  v_currency := upper(coalesce(nullif(btrim(p_fee_currency), ''), 'EUR'));
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'fee currency must be an ISO 4217 code'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.performance pf
  SET fee_amount = p_fee_amount,
      fee_currency = v_currency::character(3),
      updated_at = now()
  WHERE pf.id = p_performance_id
    AND pf.deleted_at IS NULL
  RETURNING pf.id, pf.fee_amount, pf.fee_currency;
END;
$$;

REVOKE ALL ON FUNCTION public.update_performance_fee(uuid, numeric, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_performance_fee(uuid, numeric, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.can_user_write_collab(
  p_user_id uuid,
  p_target_table text,
  p_target_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_permission text;
BEGIN
  CASE p_target_table
    WHEN 'project' THEN
      SELECT p.id INTO v_project_id
      FROM public.project p
      WHERE p.id = p_target_id AND p.deleted_at IS NULL;
      v_permission := 'edit:project_meta';
    WHEN 'line' THEN
      SELECT l.project_id INTO v_project_id
      FROM public.line l
      WHERE l.id = p_target_id AND l.deleted_at IS NULL;
      v_permission := 'edit:project_meta';
    WHEN 'performance' THEN
      SELECT pf.project_id INTO v_project_id
      FROM public.performance pf
      WHERE pf.id = p_target_id AND pf.deleted_at IS NULL;
      v_permission := 'edit:performance';
    ELSE
      RETURN false;
  END CASE;

  RETURN v_project_id IS NOT NULL
    AND public.has_permission_for_user(v_project_id, v_permission, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_user_write_collab(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_write_collab(uuid, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.can_user_write_collab(uuid, text, uuid) IS
  'Service-role-only live authorization used by the collab Durable Object to close sockets after membership/permission revocation.';
