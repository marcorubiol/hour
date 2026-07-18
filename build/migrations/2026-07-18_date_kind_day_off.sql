-- ADR-078 §3: `day_off` enters date_kind — the PLANNED day off while on
-- tour (UI label "Dia off"); the sector's own vocabulary (show day /
-- travel day / day off), same anti-CRM principle as hold and bolo.
-- Distinct from the DERIVED away band (ADR-078 §6, awayBands() in
-- $lib/calendar.ts): this is a fact of the tour plan, that one is an
-- inference painted over silent days.
--
-- OWN FILE ON PURPOSE: `ALTER TYPE … ADD VALUE` cannot be used in the
-- same transaction that references the new value (Postgres rule), and the
-- house apply channel (Supabase MCP apply_migration) wraps each migration
-- in one transaction. Keeping the ADD VALUE alone makes the split
-- explicit — apply this BEFORE 2026-07-18_date_cascade_travel.sql.
--
-- NOT applied to any live DB yet — deliver-files-only pass (calendar-v2).
-- Apply via Supabase MCP apply_migration (name: date_kind_day_off).

ALTER TYPE public.date_kind ADD VALUE IF NOT EXISTS 'day_off';
