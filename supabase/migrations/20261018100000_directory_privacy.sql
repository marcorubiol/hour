-- ADR-123: el directorio de salas y contactos pide Converses y hereda la
-- privacidad de las conversaciones.
--
-- Revisión del 2026-10-18 (`build/coordination/review-conversations/permisos.md`,
-- hallazgo 1). Hasta aquí `workspace_person` y `workspace_organization`
-- se leían con `is_workspace_internal_member` (matriz RBAC del 2026-07-20,
-- anterior a las privadas): cualquier miembro recibía el directorio entero,
-- también los contactos y las salas de una conversación privada ajena.
--
-- Cambia dos políticas de lectura; añade funciones. Sin tablas ni datos. Rollback: `build/runbooks/rollback-20261018-directory-privacy.sql`.
--
-- La regla, por fila:
--   * Un dossier es del EQUIPO si está enlazado a alguien del espacio
--     (`user_profile.person_id` de una membresía aceptada, ADR-107), a una
--     invitación viva, o está en el reparto, el equipo técnico, un cambio de
--     reparto, una disponibilidad o un compromiso; o si no es contacto de
--     ninguna conversación (el alta sin conversación de ADR-107). Lo del
--     equipo lo ve cualquier miembro interno, como antes.
--   * El resto es el DIRECTORIO de difusión: lo ve quien tiene Converses (ver)
--     en algún proyecto vivo del espacio (o es admin), salvo que solo exista
--     por conversaciones privadas de otra persona.
--   * Una sala es del equipo si es la organización de un dossier del equipo;
--     de dinero si paga una factura que quien llama lee (Diners); el resto es
--     directorio, con la misma herencia: se oculta si todas sus referencias
--     (conversaciones con ella y dossiers de ella) son privadas ajenas y no
--     paga ninguna factura.
-- Una conversación borrada sigue contando: borrar una privada no destapa su
-- contacto ni su sala (ADR-100: la privada sigue oculta para siempre), y un
-- contacto de una compartida borrada sigue siendo del directorio.

-- ── Converses en algún proyecto del espacio ──────────────────────────────────
CREATE FUNCTION private.reads_conversations_in(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND (
    private.model_has_workspace_role(p_workspace_id, p_user_id,
                                     ARRAY['owner', 'admin']::public.membership_role[])
    OR EXISTS (
      SELECT 1
      FROM public.project p
      WHERE p.workspace_id = p_workspace_id
        AND p.deleted_at IS NULL
        AND private.model_has_facet(p.id, 'converses', 'view', p_user_id)
    )
  );
$$;

-- ── Dossier del equipo ───────────────────────────────────────────────────────
CREATE FUNCTION private.person_is_team(p_workspace_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.conversation_contact cc
      WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profile up
      JOIN public.membership m
        ON m.level = 'workspace' AND m.workspace_id = p_workspace_id
       AND m.user_id = up.user_id AND m.accepted_at IS NOT NULL
      WHERE up.person_id = p_person_id
    )
    OR EXISTS (
      SELECT 1 FROM public.workspace_invitation i
      WHERE i.workspace_id = p_workspace_id AND i.person_id = p_person_id
        AND i.revoked_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.cast_member x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.crew_assignment x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.cast_override x
      WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
        AND (x.person_id = p_person_id OR x.replaces_person_id = p_person_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.availability_block x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.commitment_person x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id
    );
$$;

-- ── Solo existe por privadas ajenas ──────────────────────────────────────────
-- Contacto de alguna conversación privada de otra persona y de ninguna
-- compartida ni propia. No mira el equipo: eso lo decide quien llama.
CREATE FUNCTION private.person_only_in_foreign_private(
  p_workspace_id uuid, p_person_id uuid, p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_contact cc
    JOIN public.conversation c ON c.id = cc.conversation_id
    WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id
      AND c.private_to IS NOT NULL AND c.private_to IS DISTINCT FROM p_user_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.conversation_contact cc
    JOIN public.conversation c ON c.id = cc.conversation_id
    WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id
      AND (c.private_to IS NULL OR c.private_to = p_user_id)
  );
$$;

-- ── Lectura de un dossier ────────────────────────────────────────────────────
-- Quien llama es `auth.uid()`, como `thread_readable_by_caller`: la política
-- no puede preguntar por otro.
CREATE FUNCTION private.workspace_person_readable_by_caller(
  p_workspace_id uuid, p_person_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND (
      private.person_is_team(p_workspace_id, p_person_id)
      OR (
        private.reads_conversations_in(p_workspace_id, p_user_id)
        AND NOT private.person_only_in_foreign_private(p_workspace_id, p_person_id, p_user_id)
      )
    )
  FROM me;
$$;

-- ── Lectura de una sala ──────────────────────────────────────────────────────
CREATE FUNCTION private.workspace_organization_readable_by_caller(
  p_workspace_id uuid, p_organization_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND (
      -- La organización de alguien del equipo (la hoja de ruta la nombra).
      EXISTS (
        SELECT 1 FROM public.workspace_person wp
        WHERE wp.workspace_id = p_workspace_id AND wp.organization_id = p_organization_id
          AND wp.deleted_at IS NULL
          AND private.person_is_team(p_workspace_id, wp.person_id)
      )
      -- La pagadora de una factura que quien llama lee.
      OR EXISTS (
        SELECT 1 FROM public.invoice i
        WHERE i.workspace_id = p_workspace_id AND i.payer_organization_id = p_organization_id
          AND i.deleted_at IS NULL
          AND private.model_has_permission(i.project_id, 'read:money', p_user_id)
      )
      OR (
        private.reads_conversations_in(p_workspace_id, p_user_id)
        AND NOT (
          -- Alguna referencia es privada ajena…
          (
            EXISTS (
              SELECT 1 FROM public.conversation c
              WHERE c.workspace_id = p_workspace_id AND c.organization_id = p_organization_id
                AND c.private_to IS NOT NULL AND c.private_to IS DISTINCT FROM p_user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.workspace_person wp
              WHERE wp.workspace_id = p_workspace_id AND wp.organization_id = p_organization_id
                AND wp.deleted_at IS NULL
                AND private.person_only_in_foreign_private(p_workspace_id, wp.person_id, p_user_id)
            )
          )
          -- …y ninguna otra la sostiene.
          AND NOT EXISTS (
            SELECT 1 FROM public.conversation c
            WHERE c.workspace_id = p_workspace_id AND c.organization_id = p_organization_id
              AND (c.private_to IS NULL OR c.private_to = p_user_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.workspace_person wp
            WHERE wp.workspace_id = p_workspace_id AND wp.organization_id = p_organization_id
              AND wp.deleted_at IS NULL
              AND NOT private.person_only_in_foreign_private(p_workspace_id, wp.person_id, p_user_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.invoice i
            WHERE i.workspace_id = p_workspace_id AND i.payer_organization_id = p_organization_id
              AND i.deleted_at IS NULL
          )
        )
      )
    )
  FROM me;
$$;

REVOKE ALL ON FUNCTION private.reads_conversations_in(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.person_is_team(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.person_only_in_foreign_private(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.workspace_person_readable_by_caller(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.workspace_organization_readable_by_caller(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.workspace_person_readable_by_caller(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.workspace_organization_readable_by_caller(uuid, uuid) TO authenticated;

ALTER POLICY workspace_person_select ON public.workspace_person
  USING (deleted_at IS NULL
         AND private.workspace_person_readable_by_caller(workspace_id, person_id));

ALTER POLICY workspace_organization_select ON public.workspace_organization
  USING (deleted_at IS NULL
         AND private.workspace_organization_readable_by_caller(workspace_id, id));

-- ── La pantalla: ¿lee o edita conversaciones en algún proyecto? ──────────────
-- Una llamada en vez de `has_permission` por proyecto (permisos.md § 4): la
-- lente se oculta sin `read`, y «Añadir», «Seleccionar» e importar sin `edit`.
-- No abre ningún dato: solo dice sí o no sobre quien llama.
CREATE FUNCTION public.conversation_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH mine AS (
    SELECT p.id
    FROM public.project p
    JOIN public.membership m
      ON m.level = 'workspace' AND m.workspace_id = p.workspace_id
     AND m.user_id = (SELECT auth.uid()) AND m.accepted_at IS NOT NULL
    WHERE p.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'read', EXISTS (SELECT 1 FROM mine WHERE private.model_has_permission(mine.id, 'read:conversation', (SELECT auth.uid()))),
    'edit', EXISTS (SELECT 1 FROM mine WHERE private.model_has_permission(mine.id, 'edit:conversation', (SELECT auth.uid())))
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_access() TO authenticated;
