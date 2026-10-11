-- ROLLBACK for 20261011100000_permissions_facets_expand.sql (permisos al modelo
-- de facetas, fase expand)
--
-- Drops the three mirror triggers, the new readers, the two check RPCs, the
-- five new tables and the two new types.
--
-- DATA LOST: none that is not derivable. Every row of membership and
-- membership_facet is a copy computed from workspace_membership,
-- project_membership and workspace_role, which this migration never wrote.
-- Re-applying the migration rebuilds them. (Once the preset RPC of phase 2
-- writes rows with source preset/override, this stops being true: those rows
-- are original data and this rollback would lose them.)
--
-- Worker: the deployed Worker never reads any of it. Only the RLS tests of
-- tests/rls/permissions-facets.test.ts call has_permission_by_facets and
-- access_parity_report; they fail after this rollback, the rest do not.

BEGIN;

DROP TRIGGER IF EXISTS workspace_membership_mirror_access ON public.workspace_membership;
DROP TRIGGER IF EXISTS project_membership_mirror_access ON public.project_membership;
DROP TRIGGER IF EXISTS workspace_role_mirror_access ON public.workspace_role;

DROP FUNCTION IF EXISTS public.access_parity_report();
DROP FUNCTION IF EXISTS public.has_permission_by_facets(uuid, text);
DROP FUNCTION IF EXISTS private.access_parity_mismatches();
DROP FUNCTION IF EXISTS private.mirror_workspace_role();
DROP FUNCTION IF EXISTS private.mirror_project_membership();
DROP FUNCTION IF EXISTS private.mirror_workspace_membership();
DROP FUNCTION IF EXISTS private.sync_workspace_access(uuid, uuid);
DROP FUNCTION IF EXISTS private.sync_project_access(uuid, uuid);
DROP FUNCTION IF EXISTS private.model_can_read_workspace_money(uuid, uuid);
DROP FUNCTION IF EXISTS private.model_can_access_project(uuid, uuid);
DROP FUNCTION IF EXISTS private.model_has_permission(uuid, text, uuid);
DROP FUNCTION IF EXISTS private.model_has_facet(uuid, text, public.access_verb, uuid);
DROP FUNCTION IF EXISTS private.model_workspace_role(uuid, uuid);

DROP TABLE IF EXISTS public.membership_facet;
DROP FUNCTION IF EXISTS private.guard_membership_facet_level();
DROP TABLE IF EXISTS public.membership;
DROP TABLE IF EXISTS public.access_preset;
DROP TABLE IF EXISTS public.facet_level;
DROP TABLE IF EXISTS public.facet;

DROP TYPE IF EXISTS public.access_verb;
DROP TYPE IF EXISTS public.container_level;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011100000';

COMMIT;
