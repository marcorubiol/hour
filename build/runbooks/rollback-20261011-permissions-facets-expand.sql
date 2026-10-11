-- ROLLBACK for 20261011100000_permissions_facets_expand.sql (permisos al modelo
-- de facetas, fase expand)
--
-- Si la fase 2 (20261011300000_permissions_facets_reads) está aplicada, se
-- revierte ANTES con su propio rollback: la fase 2 hace que los lectores de hoy
-- lean las tablas que este fichero borra.
--
-- Drops the three mirror triggers, the new readers, the preset RPC, the two
-- check RPCs, the seven new tables and the two new types.
--
-- DATA LOST: the rows of membership/membership_facet written by the mirror are
-- copies and come back on re-apply. NOT derivable: the memberships of line,
-- bolo and performance written by grant_container_preset, the facets a space
-- created and the renames or deactivations in workspace_facet_setting.
--
-- Worker: the deployed Worker never reads any of it. Only the RLS tests of
-- tests/rls/permissions-facets.test.ts call the new RPCs; they fail after
-- this rollback, the rest do not.

BEGIN;

DROP TRIGGER IF EXISTS workspace_membership_mirror_access ON public.workspace_membership;
DROP TRIGGER IF EXISTS project_membership_mirror_access ON public.project_membership;
DROP TRIGGER IF EXISTS workspace_role_mirror_access ON public.workspace_role;

DROP FUNCTION IF EXISTS public.access_parity_report();
DROP FUNCTION IF EXISTS public.has_permission_by_facets(uuid, text);
DROP FUNCTION IF EXISTS public.grant_container_preset(public.container_level, uuid, uuid, text);
DROP FUNCTION IF EXISTS private.access_parity_mismatches();
DROP FUNCTION IF EXISTS private.mirror_workspace_role();
DROP FUNCTION IF EXISTS private.mirror_project_membership();
DROP FUNCTION IF EXISTS private.mirror_workspace_membership();
DROP FUNCTION IF EXISTS private.sync_workspace_access(uuid, uuid);
DROP FUNCTION IF EXISTS private.sync_project_access(uuid, uuid);
DROP FUNCTION IF EXISTS private.can_grant_preset(public.container_level, uuid, text, uuid);
DROP FUNCTION IF EXISTS private.expand_preset(uuid, text, uuid);
DROP FUNCTION IF EXISTS private.model_container_verb_at(public.container_level, uuid, uuid);
DROP FUNCTION IF EXISTS private.model_has_facet_at(public.container_level, uuid, uuid, public.access_verb, uuid);
DROP FUNCTION IF EXISTS private.chain_memberships(public.container_level, uuid, uuid);
DROP FUNCTION IF EXISTS private.container_chain(public.container_level, uuid);
DROP FUNCTION IF EXISTS private.model_can_read_workspace_money(uuid, uuid);
DROP FUNCTION IF EXISTS private.model_can_access_project(uuid, uuid);
DROP FUNCTION IF EXISTS private.model_has_permission(uuid, text, uuid);
DROP FUNCTION IF EXISTS private.model_has_facet(uuid, text, public.access_verb, uuid);
DROP FUNCTION IF EXISTS private.model_has_workspace_role(uuid, uuid, public.membership_role[]);
DROP FUNCTION IF EXISTS private.model_workspace_role(uuid, uuid);
DROP FUNCTION IF EXISTS private.standard_facet_id(text);

DROP TABLE IF EXISTS public.membership_facet;
DROP FUNCTION IF EXISTS private.guard_membership_facet();
DROP TABLE IF EXISTS public.membership;
DROP TABLE IF EXISTS public.access_preset_facet;
DROP TABLE IF EXISTS public.access_preset;
DROP TABLE IF EXISTS public.workspace_facet_setting;
DROP FUNCTION IF EXISTS private.guard_workspace_facet_setting();
DROP TABLE IF EXISTS public.facet_level;
DROP TABLE IF EXISTS public.facet;
DROP FUNCTION IF EXISTS private.guard_facet_key();

DROP TYPE IF EXISTS public.access_verb;
DROP TYPE IF EXISTS public.container_level;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011100000';

COMMIT;
