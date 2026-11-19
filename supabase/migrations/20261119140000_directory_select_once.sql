-- 20261119140000_directory_select_once (ADR-124, mismo patrón que ADR-160)
--
-- Qué: las políticas de lectura de `workspace_person` y
-- `workspace_organization` resuelven UNA vez por consulta los espacios donde
-- quien llama es miembro y los espacios donde lee conversaciones (dos
-- InitPlan), en vez de preguntar `reads_conversations_in` en cada fila.
-- La regla de ADR-124 (20261018100000_directory_privacy) no cambia.
--
-- Por qué (medido el 19-11 en producción, solo lecturas, como el usuario de
-- Marco): Hoy tarda en abrir en el móvil, y las lecturas que cuelgan del
-- directorio (conversaciones con su contacto y su sala) tardan de 1,2 a 1,5 s
-- de media (pg_stat_statements). Las dos políticas solas: 594 ms
-- (`workspace_person`) y 641 ms (`workspace_organization`). El grueso es
-- `reads_conversations_in`: 2,3 s sumados en 1.796 llamadas, una por fila que
-- no es del equipo, y cada una recorre los proyectos del espacio con
-- `model_has_facet`. La respuesta es la misma para todas las filas de un
-- espacio: aquí se calcula una vez.
--
-- Equivalencia: `model_has_workspace_role(ws, uid, roles)` es «hay membresía
-- de espacio aceptada con uno de esos roles», que es exactamente
-- `caller_member_workspaces()`. `reads_conversations_in` solo se evaluaba
-- detrás de esa comprobación, así que basta calcularla sobre esos espacios
-- (`caller_conversation_workspaces()`). El resto de cada regla se copia sin
-- tocar en funciones atadas a quien llama. Comprobado el 19-11 en producción
-- con postgres, para cada usuario con membresía, filas visibles de
-- `workspace_person` antes / después: 575/575, 754/754, 152/152, 166/166.
-- En `workspace_organization` las piezas son el texto de antes partido en
-- dos (soporte de equipo o dinero; directorio abierto), con el mismo AND.
-- Las funciones `*_readable_by_caller` de dos argumentos (las usan
-- 20261113100000_contact_import y otras RPC) se reescriben con las mismas
-- piezas, para que política y RPC no se separen nunca.
--
-- Seguridad: ninguna función nueva lee filas para quien llama. Las dos de
-- conjuntos devuelven solo espacios de quien llama (`auth.uid()`). Las cuatro
-- de fila exigen ser miembro del espacio y responden sí/no sobre un id que
-- quien llama ya conoce; no aceptan un usuario ni un «lee conversaciones»
-- como parámetro, así que no se pueden engañar. `person_is_team`,
-- `person_only_in_foreign_private` y `reads_conversations_in` siguen sin
-- permiso para `authenticated`.
--
-- Cómo se valida: `pnpm --filter web test:rls` entero en el Mac, en especial
-- tests/rls/directory-privacy.test.ts (equipo, directorio con y sin
-- Converses, privadas ajenas, salas de dinero), que fija la regla que esta
-- migración no cambia. Tras aplicar, el EXPLAIN de una lectura de
-- `workspace_person` como Marco debe mostrar los dos InitPlan una vez.
-- Rollback: build/runbooks/rollback-20261119-directory-select-once.sql.

-- ── Conjuntos de quien llama (una vez por consulta) ──────────────────────────
CREATE FUNCTION private.caller_member_workspaces()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(DISTINCT m.workspace_id), '{}'::uuid[])
  FROM public.membership m
  WHERE m.level = 'workspace'
    AND m.workspace_id IS NOT NULL
    AND m.user_id = auth.uid()
    AND m.accepted_at IS NOT NULL
    AND m.workspace_role = ANY (ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[]);
$$;

CREATE FUNCTION private.caller_conversation_workspaces()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(w), '{}'::uuid[])
  FROM unnest(private.caller_member_workspaces()) AS w
  WHERE private.reads_conversations_in(w, auth.uid());
$$;

-- ── Piezas de fila, atadas a quien llama ─────────────────────────────────────
-- Dossier del equipo: lo ve cualquier miembro interno.
CREATE FUNCTION private.person_team_for_caller(p_workspace_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_has_workspace_role(p_workspace_id, auth.uid(),
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND private.person_is_team(p_workspace_id, p_person_id);
$$;

-- Dossier del directorio que no existe solo por privadas ajenas. Quien lo
-- usa exige además que quien llama lea conversaciones en el espacio.
CREATE FUNCTION private.person_open_for_caller(p_workspace_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.model_has_workspace_role(p_workspace_id, auth.uid(),
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
    AND NOT private.person_only_in_foreign_private(p_workspace_id, p_person_id, auth.uid());
$$;

-- Sala del equipo o pagadora de una factura que quien llama lee.
CREATE FUNCTION private.organization_supported_for_caller(p_workspace_id uuid, p_organization_id uuid)
RETURNS boolean
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
    )
  FROM me;
$$;

-- Sala del directorio que no se oculta por privadas ajenas. Quien la usa
-- exige además que quien llama lea conversaciones en el espacio.
CREATE FUNCTION private.organization_open_for_caller(p_workspace_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS p_user_id)
  SELECT private.model_has_workspace_role(p_workspace_id, p_user_id,
                                          ARRAY['owner', 'admin', 'member', 'viewer']::public.membership_role[])
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
  FROM me;
$$;

-- ── Las RPC de dos argumentos, con las mismas piezas ────────────────────────
CREATE OR REPLACE FUNCTION private.workspace_person_readable_by_caller(p_workspace_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.person_team_for_caller(p_workspace_id, p_person_id)
    OR (
      private.reads_conversations_in(p_workspace_id, auth.uid())
      AND private.person_open_for_caller(p_workspace_id, p_person_id)
    );
$$;

CREATE OR REPLACE FUNCTION private.workspace_organization_readable_by_caller(p_workspace_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.organization_supported_for_caller(p_workspace_id, p_organization_id)
    OR (
      private.reads_conversations_in(p_workspace_id, auth.uid())
      AND private.organization_open_for_caller(p_workspace_id, p_organization_id)
    );
$$;

REVOKE ALL ON FUNCTION private.caller_member_workspaces() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.caller_conversation_workspaces() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.person_team_for_caller(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.person_open_for_caller(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.organization_supported_for_caller(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.organization_open_for_caller(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.caller_member_workspaces() TO authenticated;
GRANT EXECUTE ON FUNCTION private.caller_conversation_workspaces() TO authenticated;
GRANT EXECUTE ON FUNCTION private.person_team_for_caller(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.person_open_for_caller(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.organization_supported_for_caller(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.organization_open_for_caller(uuid, uuid) TO authenticated;

-- ── Las políticas ────────────────────────────────────────────────────────────
ALTER POLICY workspace_person_select ON public.workspace_person
  USING (
    deleted_at IS NULL
    AND workspace_id = ANY ((SELECT private.caller_member_workspaces()))
    AND (
      private.person_team_for_caller(workspace_id, person_id)
      OR (
        workspace_id = ANY ((SELECT private.caller_conversation_workspaces()))
        AND private.person_open_for_caller(workspace_id, person_id)
      )
    )
  );

ALTER POLICY workspace_organization_select ON public.workspace_organization
  USING (
    deleted_at IS NULL
    AND workspace_id = ANY ((SELECT private.caller_member_workspaces()))
    AND (
      private.organization_supported_for_caller(workspace_id, id)
      OR (
        workspace_id = ANY ((SELECT private.caller_conversation_workspaces()))
        AND private.organization_open_for_caller(workspace_id, id)
      )
    )
  );
