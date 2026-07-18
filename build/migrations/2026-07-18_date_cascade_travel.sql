-- ADR-072 §3 / ADR-078: `date` hangs in cascade — option C (project* +
-- line? + performance?), the pattern `performance` already uses. Rule:
-- ATTACH SPECIFIC, VIEW AGGREGATE — where it hangs is data, where it
-- shows is a view. This adds the missing middle level (`line_id`) plus
-- the travel axis (`travel_direction`) for kind='travel_day' rows, which
-- feeds the derived away band (`awayBands()` in $lib/calendar.ts —
-- ADR-078 §6: outbound day X + next return day Y of the same line ⇒
-- band; display-only in v1).
--
-- Integrity (line must belong to the date's project): enforced at the
-- API/RPC layer, NOT by composite FK — replicating exactly how
-- `performance.line_id` and `conversation.line_id` do it (ADR-043
-- pattern; see create_performance / create_engagement's
-- "line does not belong to project" guard and the PATCH cross-project
-- guard in /api). A composite FK here would make `date` the odd one out.
--
-- ORDER: apply AFTER 2026-07-18_date_kind_day_off.sql (that file's
-- ADD VALUE must ride its own transaction; this one only references
-- pre-existing enum values, but the pair was split for that rule and
-- the declared order keeps the record honest).
--
-- NOT applied to any live DB yet — deliver-files-only pass (calendar-v2).
-- Apply via Supabase MCP apply_migration (name: date_cascade_travel),
-- additive-only; verify with probes (columns exist, CHECK rejects a
-- travel_direction on kind<>'travel_day', index present).

--------------------------------------------------------------------------------
-- 1. line_id — the cascade's middle level
--------------------------------------------------------------------------------

ALTER TABLE public.date
  ADD COLUMN line_id uuid REFERENCES public.line (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.date.line_id IS
  'ADR-072 §3: optional operational frame — the line this date hangs from (cascade option C, like performance.line_id). Must belong to the same project; enforced by the /api/dates writers and the PATCH cross-project guard, not by composite FK (ADR-043 pattern).';

CREATE INDEX date_line_idx
  ON public.date (line_id)
  WHERE deleted_at IS NULL AND line_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 2. travel_direction — only meaningful on travel days
--------------------------------------------------------------------------------

ALTER TABLE public.date
  ADD COLUMN travel_direction text;

ALTER TABLE public.date
  ADD CONSTRAINT date_travel_direction CHECK (
    travel_direction IS NULL
    OR (
      kind = 'travel_day'
      AND travel_direction IN ('outbound', 'return', 'leg')
    )
  );

COMMENT ON COLUMN public.date.travel_direction IS
  'ADR-072 §4 / ADR-078 §6: outbound | return | leg, only on kind=travel_day (CHECK). An outbound paired with the NEXT return of the same line (fallback: same project) brackets the derived away band. TEXT + CHECK, not an enum — same promotion rule as availability_block.certainty.';
