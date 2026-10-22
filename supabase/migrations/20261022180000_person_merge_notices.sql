-- Fusión de dossiers, fase 3: el aviso de la invitación sin unir y los pins.
--
-- Plan: `build/plans/2026-10-22-person-merge.md` § 6.1 y § 6.2 (Marco aprobó
-- las recomendadas el 2026-10-22). Dos lecturas, nada se escribe:
--
--   1. `list_unmerged_invitations(p_workspace_id)`: las invitaciones aceptadas
--      por una cuenta que ya era otra persona, con el dossier de la invitación
--      aún vivo y sin fusionar. Es el caso abierto de ADR-107, deducido sin
--      columna nueva (plan § 6.1). Solo el admin del espacio (42501 si no):
--      `workspace_invitation` no tiene grant a nadie y `list_workspace_access`
--      no devuelve `person_id`. Una fila por pareja (dossier, cuenta), con lo
--      que la ficha y Ajustes necesitan para abrir el diálogo preseleccionado.
--      Fuera: lo que `merge_workspace_person` rechazaría (dossier que el admin
--      no puede leer, dossier que ya es otra cuenta, cuenta que ya no es del
--      espacio y no tiene ficha en él) y lo que ya se fusionó una vez por esa
--      invitación o esa pareja, aunque se deshiciera: deshacer dice «no es la
--      misma», y el aviso no vuelve a insistir.
--   2. `resolve_merged_persons(p_person_ids)`: a qué persona apunta hoy cada
--      id fusionado (un pin `pe:<id>` del Planner vive en el navegador, plan
--      § 6.2). Sigue la cadena (A en B, luego B en C) hasta 8 saltos. Solo
--      fusiones vivas en un espacio donde quien llama puede leer la ficha que
--      se quedó, y solo si la persona sobrante no tiene ya ninguna ficha viva
--      que quien llama pueda leer (en otro espacio sigue siendo ella). Lo que
--      dice: «el id que ya tenías es hoy esta ficha que ya ves».
--
-- Funciones existentes que se llaman (firmas de producción,
-- `pg_get_functiondef`, 2026-10-22): `public.is_workspace_admin(ws_id uuid)`,
-- `private.workspace_person_readable_by_caller(p_workspace_id uuid,
-- p_person_id uuid)`. Tablas de la fase 1 (`20261022130000`, aplicada):
-- `person_merge`.
--
-- ADITIVA según § 34: dos funciones nuevas, ningún dato movido, ninguna
-- tabla tocada. El Worker de esta rama las llama y aguanta que no existan
-- (sin aviso y sin reescribir pins hasta aplicarla).
-- Rollback: build/runbooks/rollback-20261022180000-person-merge-notices.sql.

-- ── 1 · list_unmerged_invitations ────────────────────────────────────────
CREATE FUNCTION public.list_unmerged_invitations(p_workspace_id uuid)
RETURNS TABLE (
  invitation_id  uuid,
  email          text,
  accepted_at    timestamptz,
  drop_person_id uuid,
  drop_slug      text,
  drop_name      text,
  keep_person_id uuid,
  keep_slug      text,
  keep_name      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_workspace_id IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (wi.person_id, up.person_id)
         wi.id,
         wi.email::text,
         wi.accepted_at,
         wi.person_id,
         dwp.slug,
         dwp.full_name,
         up.person_id,
         kwp.slug,
         coalesce(kwp.full_name, nullif(trim(up.full_name), ''), wi.email::text)
  FROM public.workspace_invitation wi
  JOIN public.user_profile up
    ON up.user_id = wi.accepted_by
   AND up.person_id IS NOT NULL
   AND up.person_id <> wi.person_id
  JOIN public.workspace_person dwp
    ON dwp.workspace_id = wi.workspace_id
   AND dwp.person_id = wi.person_id
   AND dwp.deleted_at IS NULL
  LEFT JOIN public.workspace_person kwp
    ON kwp.workspace_id = wi.workspace_id
   AND kwp.person_id = up.person_id
   AND kwp.deleted_at IS NULL
  WHERE wi.workspace_id = p_workspace_id
    AND wi.accepted_at IS NOT NULL
    AND wi.person_id IS NOT NULL
    -- El dossier de la invitación no es ya otra cuenta (dos cuentas: 22023).
    AND NOT EXISTS (SELECT 1 FROM public.user_profile o WHERE o.person_id = wi.person_id)
    -- Lo que la fusión exige ver (ADR-124 § 2): si no, ni se nombra.
    AND private.workspace_person_readable_by_caller(wi.workspace_id, wi.person_id)
    AND (
      CASE WHEN kwp.person_id IS NOT NULL
        THEN private.workspace_person_readable_by_caller(wi.workspace_id, up.person_id)
        ELSE EXISTS (
          SELECT 1 FROM public.membership m
          WHERE m.workspace_id = wi.workspace_id AND m.level = 'workspace'
            AND m.user_id = up.user_id AND m.accepted_at IS NOT NULL
        )
      END
    )
    -- Ya se unió (o se unió y se deshizo) por esta invitación o esta pareja.
    AND NOT EXISTS (
      SELECT 1 FROM public.person_merge pm
      WHERE pm.workspace_id = wi.workspace_id
        AND (
          pm.invitation_id = wi.id
          OR (pm.drop_person_id = wi.person_id AND pm.keep_person_id = up.person_id)
          OR (pm.drop_person_id = up.person_id AND pm.keep_person_id = wi.person_id)
        )
    )
  ORDER BY wi.person_id, up.person_id, wi.accepted_at DESC;
END;
$function$;

COMMENT ON FUNCTION public.list_unmerged_invitations(uuid) IS
  'Invitaciones aceptadas por una cuenta que ya era otra persona, con el dossier sin unir (plan person-merge § 6.1). Solo admin del espacio.';

REVOKE ALL ON FUNCTION public.list_unmerged_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unmerged_invitations(uuid) TO authenticated;

-- ── 2 · resolve_merged_persons ───────────────────────────────────────────
CREATE FUNCTION public.resolve_merged_persons(p_person_ids uuid[])
RETURNS TABLE (person_id uuid, merged_into uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE
  asked AS (
    SELECT DISTINCT a.id
    FROM unnest(coalesce(p_person_ids, '{}'::uuid[])) AS a(id)
    WHERE (SELECT auth.uid()) IS NOT NULL
    LIMIT 50
  ),
  -- La fusión viva más reciente de cada sobrante, visible para quien llama.
  hop AS (
    SELECT DISTINCT ON (pm.drop_person_id) pm.drop_person_id AS from_id, pm.keep_person_id AS to_id
    FROM public.person_merge pm
    WHERE pm.undone_at IS NULL
      AND private.workspace_person_readable_by_caller(pm.workspace_id, pm.keep_person_id)
    ORDER BY pm.drop_person_id, pm.merged_at DESC
  ),
  chain AS (
    SELECT a.id AS origin, h.to_id AS at, 1 AS depth
    FROM asked a
    JOIN hop h ON h.from_id = a.id
    UNION ALL
    SELECT c.origin, h.to_id, c.depth + 1
    FROM chain c
    JOIN hop h ON h.from_id = c.at
    WHERE c.depth < 8
  )
  SELECT DISTINCT ON (c.origin) c.origin, c.at
  FROM chain c
  WHERE c.at <> c.origin
    -- Si la sobrante aún es una ficha viva que quien llama ve, el pin vale.
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_person wp
      WHERE wp.person_id = c.origin AND wp.deleted_at IS NULL
        AND private.workspace_person_readable_by_caller(wp.workspace_id, wp.person_id)
    )
  ORDER BY c.origin, c.depth DESC;
$function$;

COMMENT ON FUNCTION public.resolve_merged_persons(uuid[]) IS
  'A qué persona apunta hoy cada id fusionado, para reescribir pins pe: del navegador (plan person-merge § 6.2).';

REVOKE ALL ON FUNCTION public.resolve_merged_persons(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_merged_persons(uuid[]) TO authenticated;
