-- ADR-080 §2: notice-by-lead-time, not a negotiated date. A hold's urgency
-- is DERIVED from `start_at − notice` — no stored decision entity, no
-- settings page. The one optional column lives on the performance and only
-- surfaces in the form/detail while the status is hold*:
--   NULL = standard default (30 days, HOLD_NOTICE_DEFAULT in
--          $lib/performance.ts — the app-side constant, deliberately not a
--          DB default so NULL keeps meaning "follow the standard")
--   0    = no notice (this hold never turns urgent)
--   N    = notify N days before start_at
-- Copy stays honest: "decidir abans de {start_at − aviso}". If venues ever
-- hand out hard hold dates, an optional `hold_expires_on date` that WINS
-- over the lead time is additive (ADR-080 re-evaluate (b)).
--
-- NOT applied to any live DB yet — deliver-files-only pass
-- (planner-decisions). Apply via Supabase MCP apply_migration
-- (name: hold_notice_days), additive-only.

ALTER TABLE public.performance
  ADD COLUMN hold_notice_days smallint
    CHECK (hold_notice_days IS NULL OR (hold_notice_days >= 0 AND hold_notice_days <= 365));

COMMENT ON COLUMN public.performance.hold_notice_days IS
  'ADR-080 §2: hold decision notice as lead time. NULL = standard default (30) · 0 = no notice · N = notify N days before start_at. Urgency is derived (start_at − notice), never stored.';
