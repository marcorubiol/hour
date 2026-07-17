-- Migration: close_adr036_show_debt
-- Closes the last live traces of `show`, the word ADR-036 renamed to
-- `performance` on 2026-05-19. That migration renamed the table, the enum, the
-- columns, the indexes and the triggers — but three things kept the dead word
-- and nobody noticed for two months, because they are the kind a grep over the
-- app never reaches: they live only in the catalog.
--
-- Found while sweeping ADR-075 (engagement → conversation). Same argument as
-- ADR-075 § "por qué también la DB": ADR-069 wants an AI-legible schema, and a
-- trigger called `guard_show_fee_columns` firing on a table called `performance`
-- is a translation dictionary for every agent that reads it. Marco, 2026-07-17:
-- "arregla la deuda".
--
--   1. FUNCTION `guard_show_fee_columns()` — the trigger that calls it was
--      already renamed to `performance_guard_fee_columns` (ADR-036 §12), but the
--      function it EXECUTEs was not. Its RAISE message is worse than the name:
--      "edit:money required to modify show fee columns" is user-facing text
--      naming an entity that has not existed since May.
--   2. CONSTRAINT `asset_version_inbound_has_show` — name only; the body already
--      reads `performance_id` (Postgres rewrote it by attnum on the column
--      rename, which is exactly why the name was left behind).
--   3. Two COMMENTs that name the entity in prose.
--
-- Also here (same "the two lists must mirror" hygiene): `is_reserved_slug` gains
-- `agenda` and `people`, the two entries `apps/web/src/lib/reserved-slugs.ts`
-- had and the DB did not. `agenda` is not cosmetic — ADR-076 (2026-07-18) makes
-- the agenda a first-class projection reachable by "ruta alias hacia la misma
-- lente", so an unreserved `agenda` could be claimed as a workspace alias and
-- collide with a route this project has already decided to build.
--
-- NOT touched: the enum value `hold`, `performed_at`, and Postgres's own
-- built-in comments that contain the word "show" (SHOW X as a function, etc. —
-- those are pg_catalog's, not ours).
--
-- Applied via Supabase MCP apply_migration 2026-07-17 (name:
-- close_adr036_show_debt). This file is the canonical record. BEGIN/COMMIT are
-- omitted from the MCP call (apply_migration supplies its own transaction) and
-- kept here so the file runs standalone under psql.

BEGIN;

-- ═══ §1 The fee guard: function name + its user-facing message ═══════════
-- RENAME first, then CREATE OR REPLACE under the new name: replace preserves
-- the ACL, and the trigger follows the function by oid (pg_depend), so
-- `performance_guard_fee_columns` needs no touching.
ALTER FUNCTION public.guard_show_fee_columns() RENAME TO guard_performance_fee_columns;

CREATE OR REPLACE FUNCTION public.guard_performance_fee_columns()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.fee_amount IS DISTINCT FROM OLD.fee_amount OR NEW.fee_currency IS DISTINCT FROM OLD.fee_currency THEN
    IF NOT public.has_permission(NEW.project_id, 'edit:money') THEN
      RAISE EXCEPTION 'edit:money required to modify performance fee columns' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ═══ §2 The constraint name left behind by the column rename ═════════════
ALTER TABLE public.asset_version
  RENAME CONSTRAINT asset_version_inbound_has_show TO asset_version_inbound_has_performance;

-- ═══ §3 Comments that still name the dead entity ═════════════════════════
COMMENT ON TABLE public.cast_member IS
  'ADR-034: project-level canonical cast. Per-performance substitutions live in cast_override (replaces_person_id resolves to a person on the canonical cast).';
COMMENT ON COLUMN public.performance.start_at IS
  'ADR-023: doors-open / actual performance start. May differ from performed_at (which is just a date).';

-- ═══ §4 Reserved slugs: make the DB mirror the client ════════════════════
-- The client list (reserved-slugs.ts) is the superset today; these two were the
-- whole drift. Client-side, the duplicate 'desk' entry is dropped in the same
-- change so the two lists are literally the same set.
CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    'h','public','api','auth','login','logout','signup','signin','signout','oauth',
    'www','app','home','about','pricing','docs','blog','help','support','legal','terms','privacy','contact','careers','status','changelog',
    'admin','settings','account','profile','billing','dashboard','new','edit','delete','search','explore','discover',
    'house','room','run','gig','desk','plaza','roadsheet','conversation','conversations','person','venue','asset','invoice','calendar','money','comms','archive',
    'agenda','people',
    'staging','dev','playground','booking','assets','static','cdn'
  ]);
$function$;

COMMIT;
