-- =============================================================================
-- Migration: post_roadsheet_cleanup
-- Date: 2026-05-01 (later same day as reset_v2_roadsheet)
-- Source: independent post-apply DB review surfaced two LOW drift items.
--
-- DRIFT #1: workspace + project carried a non-partial UNIQUE constraint on
-- slug from reset_v2_schema. The new partial unique index from the roadsheet
-- migration (`WHERE deleted_at IS NULL`) is shadowed by the stricter
-- non-partial form, blocking slug rehydration after soft-delete — breaks
-- the rename intent of ADR-024.
--
-- DRIFT #2: the 3 slug helpers (slugify, is_reserved_slug, validate_slug)
-- retained EXECUTE for PUBLIC, anon, service_role. Inconsistent with the
-- 2026-05-01 SECURITY DEFINER hardening pattern applied to the asset/show
-- helpers. Not a data leak (these don't read tables), but DoS surface and
-- consistency debt.
--
-- Recovery: applied via supabase apply_migration (no incremental shenanigans
-- this time, all simple DDL).
-- =============================================================================

ALTER TABLE workspace DROP CONSTRAINT workspace_slug_key;
ALTER TABLE project   DROP CONSTRAINT project_workspace_id_slug_key;

REVOKE EXECUTE ON FUNCTION public.slugify(text)            FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.is_reserved_slug(text)   FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.validate_slug()          FROM PUBLIC, anon, service_role, authenticated;

GRANT EXECUTE ON FUNCTION public.slugify(text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_reserved_slug(text)    TO authenticated;
-- validate_slug() intentionally has NO grants — fires only as a trigger.
