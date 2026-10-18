-- `is_reserved_slug` reserva `books`, la ruta de Cuentas desde ADR-119.
--
-- El espejo de la app (RESERVED_WORKSPACE_SLUGS en
-- apps/web/src/lib/reserved-slugs.ts) la reserva desde entonces y la base no:
-- un alias `books` pasaría la comprobación de la base y nunca resolvería,
-- porque la ruta estática `/h/books` gana. Mismo orden que el espejo.
--
-- Aborta si algún espacio ya usa `books` como alias. Aditiva: CREATE OR
-- REPLACE conserva dueño, grants y comentario.
-- Rollback: build/runbooks/rollback-20261019-reserve-books-slug.sql.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspace WHERE alias = 'books') THEN
    RAISE EXCEPTION 'a workspace uses books as alias; resolve it before reserving the word';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT lower(coalesce(candidate, '')) = ANY (ARRAY[
    'h','public','api','auth','login','logout','signup','signin','signout','oauth',
    'www','app','home','about','pricing','docs','blog','help','support','legal','terms','privacy','contact','careers','status','changelog',
    'admin','settings','account','profile','billing','dashboard','new','edit','delete','search','explore','discover',
    'house','room','run','gig','desk','plaza','roadsheet','conversation','conversations','person','venue','asset','invoice','calendar','planner','money','books','comms','archive',
    'agenda','people',
    'staging','dev','playground','booking','assets','static','cdn'
  ]);
$$;
