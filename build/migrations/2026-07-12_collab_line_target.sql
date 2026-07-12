-- ADR-056: the line Notes module joins the collab family — widen the
-- collab_snapshot target CHECK so 'line' rooms can persist snapshots.
-- Without this the DO's saveSnapshot fails 23514 SILENTLY (onSave catches
-- and logs; the notes write-back still works, masking the data-loss risk):
-- service_role bypasses RLS but NOT check constraints.
--
-- MUST be live BEFORE any hour-collab deploy that allows the 'line' target.
--
-- PENDING APPLY — run via Supabase MCP apply_migration
-- (name: collab_line_target). This file is the canonical record.

ALTER TABLE public.collab_snapshot
  DROP CONSTRAINT collab_snapshot_target_table_chk;

ALTER TABLE public.collab_snapshot
  ADD CONSTRAINT collab_snapshot_target_table_chk
  CHECK (target_table IN ('performance', 'project', 'line'));
