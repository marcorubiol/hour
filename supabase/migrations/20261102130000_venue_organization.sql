-- 92 · La sala sabe qué organización la programa (`_tasks.md` § AHORA; ADR-164
-- dejó la ficha de sala sin relación con la organización).
--
--   · `venue.organization_id`, nula. FK compuesta (workspace_id,
--     organization_id) → `workspace_organization (workspace_id, id)`, como
--     `invoice.payer_organization_id`: una sala solo apunta a una organización
--     de su mismo espacio, lo dice la base. ON DELETE SET NULL de la columna.
--   · `private.guard_venue_organization`: la organización tiene que estar viva
--     al escribirla (23514); solo cuando cambia, así que borrar la organización
--     después no bloquea editar la sala. El borrado blando de una organización
--     no limpia la columna: quien lee filtra por `deleted_at` como con
--     `conversation.organization_id`.
--   · `venue` tiene grant de tabla entera a `authenticated` (producción,
--     2026-11-01): la columna nueva se lee y se escribe con las policies de
--     siempre (`venue_update`: miembros internos del espacio). `create_venue`
--     no cambia: la organización se pone con el PATCH de la sala.
--
-- La fusión de organizaciones (`20261102140000`) reapunta esta columna.
--
-- ADITIVA según § 34: una columna nula, un índice, una FK y un guard. Sin datos.
--
-- Rollback:
--   DROP TRIGGER venue_guard_organization ON public.venue;
--   DROP FUNCTION private.guard_venue_organization();
--   ALTER TABLE public.venue DROP COLUMN organization_id;

ALTER TABLE public.venue
  ADD COLUMN organization_id uuid,
  ADD CONSTRAINT venue_workspace_organization_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES public.workspace_organization (workspace_id, id)
    ON DELETE SET NULL (organization_id);

COMMENT ON COLUMN public.venue.organization_id IS
  '92: la organización que programa esta sala, del mismo espacio (FK compuesta). Viva al escribirla (guard_venue_organization).';

CREATE INDEX venue_organization_idx ON public.venue (organization_id)
  WHERE organization_id IS NOT NULL AND deleted_at IS NULL;

CREATE FUNCTION private.guard_venue_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_organization o
    WHERE o.workspace_id = NEW.workspace_id AND o.id = NEW.organization_id
      AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'organization_id must be a live organization of the venue workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.guard_venue_organization() IS
  '92: la organización de una sala está viva y es de su espacio. Solo cuando la columna cambia.';
REVOKE ALL ON FUNCTION private.guard_venue_organization() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER venue_guard_organization
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON public.venue
  FOR EACH ROW EXECUTE FUNCTION private.guard_venue_organization();
