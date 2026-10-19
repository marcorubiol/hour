-- ADR-138 § 5 · «lo conozco» es personal y va con la persona de contacto.
--
-- Plan: `build/plans/2026-10-19-conversations-tags.md` § 8.3 (fase E2).
--
-- Una fila dice que un miembro del equipo conoce a un contacto. Es suya, como
-- la nota privada (ADR-093): va por el dossier (`workspace_person`), no por la
-- conversación, porque las personas cambian de sala (ADR-102) y quien las
-- conoce las sigue conociendo. Nace privada (`shared = false`) y se comparte
-- una a una.
--
-- Aditiva: una tabla, una función de lectura, una RPC. Sin datos.
-- Rollback: `build/runbooks/rollback-20261020-person-acquaintance.sql`.
--
-- Lectura, por fila:
--   * la propia, si quien llama es miembro del espacio (como `note_select`);
--   * la de otro, solo si está compartida, quien llama puede leer ese dossier
--     (`private.workspace_person_readable_by_caller`, ADR-124) y el dueño
--     sigue siendo miembro aceptado del espacio. Así hereda la privacidad del
--     directorio: el contacto de una privada ajena no se delata porque alguien
--     diga que lo conoce, tampoco ante el admin.
-- Escritura: solo `set_acquaintance`, solo la fila propia y solo de un dossier
-- que quien llama lee. Quitar «lo conozco» borra la fila: es tuya, no hay
-- historia que guardar. La marca nunca abre nada: no da acceso a la
-- conversación, al dossier ni a la sala.

-- ── La tabla ─────────────────────────────────────────────────────────────────
CREATE TABLE public.person_acquaintance (
  workspace_id uuid NOT NULL,
  person_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  shared       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_acquaintance_pkey PRIMARY KEY (workspace_id, person_id, user_id),
  CONSTRAINT person_acquaintance_workspace_person_fkey FOREIGN KEY (workspace_id, person_id)
    REFERENCES public.workspace_person (workspace_id, person_id) ON DELETE CASCADE,
  CONSTRAINT person_acquaintance_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

-- «A quién conozco yo en este espacio»: la lista de Conversaciones.
CREATE INDEX person_acquaintance_user_idx ON public.person_acquaintance (user_id, workspace_id);

-- ENABLE y FORCE: FORCE solo no hace nada si RLS no está activo.
ALTER TABLE public.person_acquaintance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.person_acquaintance FORCE ROW LEVEL SECURITY;
ALTER TABLE public.person_acquaintance OWNER TO postgres;

COMMENT ON TABLE public.person_acquaintance IS
  'ADR-138 § 5: a team member knows a contact (a workspace_person dossier). Personal, private by default; shared one by one. Inherits the directory privacy (ADR-124) and opens nothing. Written only by set_acquaintance.';

CREATE TRIGGER person_acquaintance_set_updated_at BEFORE UPDATE ON public.person_acquaintance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sin INSERT, UPDATE ni DELETE para la API: se escribe por la RPC.
GRANT SELECT ON TABLE public.person_acquaintance TO authenticated;
GRANT ALL ON TABLE public.person_acquaintance TO service_role;

-- ── Lectura de una marca ─────────────────────────────────────────────────────
-- Quien llama es `auth.uid()`, como `workspace_person_readable_by_caller`: la
-- política no puede preguntar por otro.
CREATE FUNCTION private.person_acquaintance_readable_by_caller(
  p_workspace_id uuid, p_person_id uuid, p_user_id uuid, p_shared boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT CASE
    WHEN p_user_id = me.uid THEN private.model_has_workspace_role(p_workspace_id, me.uid)
    ELSE p_shared
      AND private.model_has_workspace_role(p_workspace_id, p_user_id)
      AND EXISTS (
        SELECT 1 FROM public.workspace_person wp
        WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id
          AND wp.deleted_at IS NULL
      )
      AND private.workspace_person_readable_by_caller(p_workspace_id, p_person_id)
  END
  FROM me;
$$;

REVOKE ALL ON FUNCTION private.person_acquaintance_readable_by_caller(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.person_acquaintance_readable_by_caller(uuid, uuid, uuid, boolean) TO authenticated;

CREATE POLICY person_acquaintance_select ON public.person_acquaintance
  FOR SELECT TO authenticated
  USING (private.person_acquaintance_readable_by_caller(workspace_id, person_id, user_id, shared));

-- ── set_acquaintance ─────────────────────────────────────────────────────────
-- p_known false borra la fila propia (y p_shared no cuenta). p_known true la
-- crea o la deja con `shared = p_shared`; null en p_shared es «sin compartir».
-- Devuelve la fila, o ninguna si se borró.
CREATE FUNCTION public.set_acquaintance(
  p_workspace_id uuid,
  p_person_id uuid,
  p_known boolean,
  p_shared boolean DEFAULT false
) RETURNS SETOF public.person_acquaintance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR p_person_id IS NULL OR p_known IS NULL THEN
    RAISE EXCEPTION 'workspace_id, person_id and known are required' USING ERRCODE = '22023';
  END IF;

  -- Un dossier que no lees no existe para ti: no-encontrado y sin permiso son
  -- el mismo error (sin oráculo de existencia).
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id
      AND wp.deleted_at IS NULL
  ) OR NOT private.workspace_person_readable_by_caller(p_workspace_id, p_person_id) THEN
    RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
  END IF;

  IF NOT p_known THEN
    DELETE FROM public.person_acquaintance
    WHERE workspace_id = p_workspace_id AND person_id = p_person_id AND user_id = v_caller;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.person_acquaintance AS a (workspace_id, person_id, user_id, shared)
  VALUES (p_workspace_id, p_person_id, v_caller, coalesce(p_shared, false))
  ON CONFLICT (workspace_id, person_id, user_id)
  DO UPDATE SET shared = EXCLUDED.shared
  RETURNING a.*;
END;
$$;

COMMENT ON FUNCTION public.set_acquaintance(uuid, uuid, boolean, boolean) IS
  'ADR-138 § 5: mark (or unmark) that the caller knows a contact, and whether the team sees it. Own row only, of a dossier the caller reads; known=false deletes the row. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.set_acquaintance(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_acquaintance(uuid, uuid, boolean, boolean) TO authenticated;
