-- ============================================================================
-- 2026-07-19 — Calendar lens → Planner (reopens ADR-065/076)
--
-- PRODUCT rename only. The iCalendar/ICS interop layer KEEPS the name
-- "calendar" — calendar_share, /api/calendar-shares, /api/public/calendar,
-- ics.ts, the *_calendar_share RPCs, get_public_calendar. That is a real
-- iCalendar feed external apps subscribe to; "calendar" is true there in the
-- interop sense (like the `date` entity keeps its name). This migration
-- touches exactly two things:
--
--   §1  is_reserved_slug(): reserve 'planner' (the new lens route). 'calendar'
--       stays reserved-but-rejected (pre-Planner), like 'agenda'/'people'.
--       Mirror of apps/web/src/lib/reserved-slugs.ts — 65 = 65 (added 'planner').
--   §2  line.modules: swap the module key 'calendar' → 'planner'. 3 live lines
--       on 2026-07-19 (probed). Order preserved — same pattern as the ADR-075
--       'contacts'→'conversations' swap. A data migration, not a read-time alias.
--
-- COUPLED WITH THE CODE DEPLOY: the deployed code drops unknown module keys
-- (modulesForLine filters to MODULE_KEYS), so running §2 before the new code is
-- live would blank the Planner module on those 3 lines until deploy — and the
-- reverse leaves them blank if the code deploys first. Apply this with the
-- deploy, not standalone.
-- ============================================================================

-- ═══ §1  Reserve 'planner' (CREATE OR REPLACE — signature unchanged → ACL kept) ═══
CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    'h','public','api','auth','login','logout','signup','signin','signout','oauth',
    'www','app','home','about','pricing','docs','blog','help','support','legal','terms','privacy','contact','careers','status','changelog',
    'admin','settings','account','profile','billing','dashboard','new','edit','delete','search','explore','discover',
    'house','room','run','gig','desk','plaza','roadsheet','conversation','conversations','person','venue','asset','invoice','calendar','planner','money','comms','archive',
    'agenda','people',
    'staging','dev','playground','booking','assets','static','cdn'
  ]);
$function$;

-- ═══ §2  Swap line module key 'calendar' → 'planner' (order preserved) ═══
UPDATE public.line
SET modules = (
  SELECT jsonb_agg(
    CASE WHEN elem = to_jsonb('calendar'::text) THEN to_jsonb('planner'::text) ELSE elem END
    ORDER BY ord)
  FROM jsonb_array_elements(modules) WITH ORDINALITY AS e(elem, ord)
)
WHERE jsonb_typeof(modules) = 'array'
  AND modules @> to_jsonb(ARRAY['calendar']);

-- Verify after apply:
--   SELECT count(*) FILTER (WHERE modules @> '["calendar"]') AS should_be_0,
--          count(*) FILTER (WHERE modules @> '["planner"]')  AS should_be_3
--   FROM public.line;
--   SELECT is_reserved_slug('planner');  -- → true
