-- Rollback de 20261019100000_reserve_books_slug: `is_reserved_slug` vuelve a
-- su lista sin `books`. No se pierde ningún dato.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    'h','public','api','auth','login','logout','signup','signin','signout','oauth',
    'www','app','home','about','pricing','docs','blog','help','support','legal','terms','privacy','contact','careers','status','changelog',
    'admin','settings','account','profile','billing','dashboard','new','edit','delete','search','explore','discover',
    'house','room','run','gig','desk','plaza','roadsheet','conversation','conversations','person','venue','asset','invoice','calendar','planner','money','comms','archive',
    'agenda','people',
    'staging','dev','playground','booking','assets','static','cdn'
  ]);
$$;

COMMIT;
