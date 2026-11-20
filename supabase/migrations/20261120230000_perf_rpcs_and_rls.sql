-- 20261120230000_perf_rpcs_and_rls
--
-- Mobile startup & data loading performance migration (gate § 34: do NOT apply
-- directly without backup + plan + apply via production-migrate.yml).
--
-- 1. `accessible_project_ids(text)` (ADR-160 § Límite): pre-filter projects to
--    `private.caller_member_workspaces()` before evaluating `has_permission`,
--    instead of scanning every live project across all tenants.
-- 2. `money_access_any()`: single RPC replacing the 1 + N loop in
--    `GET /api/money/access` (mirrors `conversation_access()`).
-- 3. `list_roadsheet_share_counts(uuid[])`: single batched RPC replacing the
--    per-performance N+1 `list_roadsheet_shares` loop in `missing-facts.ts`.
-- 4. `mailout_select` RLS policy: evaluate `accessible_project_ids('read:conversation')`
--    once per query (InitPlan, same pattern as ADR-160) instead of calling
--    `has_permission` per row (~1.1 s measured on 637 rows).
-- 5. Partial indexes on `conversation_event` for `last_turn` / `last_in` embeds,
--    plus `pg_trgm` GIN indexes for `/api/search` (`ilike '%term%'`).
--
-- Rollback: build/runbooks/rollback-20261120-perf-rpcs-and-rls.sql

-- ── 1 · Scope accessible_project_ids() to the caller's workspaces ───────────
CREATE OR REPLACE FUNCTION public.accessible_project_ids(p_perm text)
RETURNS uuid[]
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(DISTINCT p.id), '{}'::uuid[])
  FROM public.project p
  JOIN public.membership m
    ON m.level = 'workspace'
   AND m.workspace_id = p.workspace_id
   AND m.user_id = (SELECT auth.uid())
   AND m.accepted_at IS NOT NULL
  WHERE p.deleted_at IS NULL
    AND public.has_permission(p.id, p_perm);
$$;

-- ── 2 · money_access_any(): 1 call instead of 1 + N in /api/money/access ────
CREATE OR REPLACE FUNCTION public.money_access_any()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project p
    JOIN public.membership m
      ON m.level = 'workspace'
     AND m.workspace_id = p.workspace_id
     AND m.user_id = (SELECT auth.uid())
     AND m.accepted_at IS NOT NULL
    WHERE p.deleted_at IS NULL
      AND private.model_has_permission(p.id, 'read:money', (SELECT auth.uid()))
  );
$$;

COMMENT ON FUNCTION public.money_access_any() IS
  'Whether the caller holds read:money on any live project. Single-RPC gate for the Books lens, mirroring conversation_access().';

REVOKE ALL ON FUNCTION public.money_access_any() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_access_any() TO authenticated;

-- ── 3 · list_roadsheet_share_counts(uuid[]): batched missing-facts check ────
CREATE OR REPLACE FUNCTION public.list_roadsheet_share_counts(p_performance_ids uuid[])
RETURNS TABLE (performance_id uuid, live_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH allowed AS (
    SELECT p.id
    FROM public.performance p
    WHERE p.id = ANY (coalesce(p_performance_ids, '{}'::uuid[]))
      AND p.deleted_at IS NULL
      AND p.project_id = ANY (public.accessible_project_ids('edit:performance'))
  )
  SELECT a.id AS performance_id,
         count(rs.id)::integer AS live_count
  FROM allowed a
  LEFT JOIN public.roadsheet_share rs
    ON rs.performance_id = a.id
   AND rs.revoked_at IS NULL
   AND (rs.expires_at IS NULL OR rs.expires_at > now())
  GROUP BY a.id;
$$;

COMMENT ON FUNCTION public.list_roadsheet_share_counts(uuid[]) IS
  'Count of active (non-revoked, non-expired) roadsheet shares per performance for callers holding edit:performance. Batched replacement for per-row list_roadsheet_shares calls in missing-facts.';

REVOKE ALL ON FUNCTION public.list_roadsheet_share_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_roadsheet_share_counts(uuid[]) TO authenticated;

-- ── 4 · mailout_select: resolve permissions once per query (InitPlan) ───────
ALTER POLICY mailout_select ON public.mailout
  USING (
    CASE kind
      WHEN 'outreach' THEN project_id = ANY (((SELECT public.accessible_project_ids('read:conversation'::text)))::uuid[])
                           AND private.mailout_readable_by_caller(id, created_by)
      ELSE private.invitation_readable_by_caller(id, workspace_id, created_by)
    END
  );

-- ── 5 · Indexes for conversation turn embeds & /api/search ilike scans ──────
CREATE INDEX IF NOT EXISTS conversation_event_last_turn_idx
  ON public.conversation_event (conversation_id, occurred_at DESC)
  WHERE direction IS NOT NULL
    AND kind IN ('email', 'message', 'call')
    AND (metadata ->> 'auto') IS NULL;

CREATE INDEX IF NOT EXISTS conversation_event_last_in_idx
  ON public.conversation_event (conversation_id, occurred_at DESC)
  WHERE direction = 'inbound'
    AND kind IN ('email', 'message', 'call')
    AND (metadata ->> 'auto') IS NULL;

CREATE INDEX IF NOT EXISTS workspace_person_full_name_trgm_idx
  ON public.workspace_person USING gin (full_name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS workspace_person_email_trgm_idx
  ON public.workspace_person USING gin ((email::text) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS workspace_organization_name_trgm_idx
  ON public.workspace_organization USING gin (name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS venue_name_trgm_idx
  ON public.venue USING gin (name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS venue_city_trgm_idx
  ON public.venue USING gin (city extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND city IS NOT NULL;

CREATE INDEX IF NOT EXISTS performance_venue_name_trgm_idx
  ON public.performance USING gin (venue_name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND venue_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS performance_city_trgm_idx
  ON public.performance USING gin (city extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND city IS NOT NULL;

CREATE INDEX IF NOT EXISTS bolo_venue_name_trgm_idx
  ON public.bolo USING gin (venue_name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND venue_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS bolo_city_trgm_idx
  ON public.bolo USING gin (city extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL AND city IS NOT NULL;
