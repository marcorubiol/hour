-- Fix: performance_redacted must run with INVOKER semantics.
--
-- Regression found 2026-07-02 (verified live: anon PostgREST call returned
-- all rows of the view while the base table correctly returned zero).
-- 2026-05-18_rls_findings_fix.sql applied `security_invoker = true` to the
-- then-named show_redacted (Finding 1 — definer-owned view bypasses RLS).
-- The view was then DROPped and recreated twice on 2026-05-19
-- (revert_section_to_line, rename_show_to_performance) WITHOUT the option,
-- silently restoring definer semantics: any caller — including anon —
-- reads every workspace's performances through the view.
--
-- Exposure until applied: all performance_redacted columns except fees
-- (id, workspace/project/line/engagement ids, performed_at, venue_name,
-- city, country, status, notes, custom_fields) — cross-tenant, no auth.
-- As of 2026-07-02 only the demo workspace has performances.
--
-- Apply via Supabase SQL editor or MCP apply_migration. Verify after with:
--   curl -s "$SUPABASE_URL/rest/v1/performance_redacted?select=id&limit=1" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--   → expect [] (or 4xx), never rows.

ALTER VIEW public.performance_redacted SET (security_invoker = true);

-- Belt and braces: the view has no reason to be readable by anon at all
-- (grants arrived via ALTER DEFAULT PRIVILEGES, not by decision).
REVOKE SELECT ON public.performance_redacted FROM anon;
