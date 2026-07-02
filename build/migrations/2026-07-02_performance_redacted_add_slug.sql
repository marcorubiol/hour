-- ADR-046 (Money lens): the redacted view is the money-safe read path,
-- but it lacked `slug` — Money rows couldn't link to the performance
-- detail. Views only accept new columns at the END. Re-assert invoker
-- semantics + anon revoke (the 2026-05-19 incident taught us to never
-- recreate this view without them).
--
-- Applied 2026-07-02 via Supabase MCP apply_migration
-- (name: performance_redacted_add_slug).

CREATE OR REPLACE VIEW public.performance_redacted AS
SELECT id, workspace_id, project_id, line_id, engagement_id, performed_at,
       venue_id, venue_name, city, country, status,
       CASE WHEN has_permission(project_id, 'read:money'::text) THEN fee_amount   ELSE NULL::numeric END AS fee_amount,
       CASE WHEN has_permission(project_id, 'read:money'::text) THEN fee_currency ELSE NULL::bpchar  END AS fee_currency,
       notes, custom_fields, created_by, created_at, updated_at, deleted_at,
       slug
FROM public.performance;

ALTER VIEW public.performance_redacted SET (security_invoker = true);
REVOKE SELECT ON public.performance_redacted FROM anon;
