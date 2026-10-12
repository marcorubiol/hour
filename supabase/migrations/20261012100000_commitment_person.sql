-- ADR-103 · «quién va»: lo deducido se aprueba o se retira.
--
-- Hasta hoy un `date` (ensayo, viaje, residencia) no tenía personas: quién va
-- se deducía siempre del reparto del proyecto (`$lib/people`), y esa deducción
-- no se podía confirmar ni quitar. Una función sí tiene reparto (elenco del
-- proyecto − sustituidos + sustituciones + equipo técnico), y solo sale
-- deducida cuando ese reparto está vacío.
--
-- `commitment_person` guarda la palabra de una persona sobre un compromiso:
-- `going` («voy», pasa a explícito) o `not_going` («no voy», deja de salirle).
-- Es OPCIONAL: sin filas, todo se sigue deduciendo como antes. Se decide
-- persona a persona, no la fila entera: si Laia confirma, Pau sigue deducido
-- hasta que diga algo.
--
-- Decisiones de Marco (12-10, sobre la propuesta):
--   · Permisos (a): cada uno confirma o retira lo suyo con solo poder leer el
--     compromiso; quien edita el Planner (`edit:performance` del proyecto)
--     puede tocar la lista de cualquiera desde la ficha.
--   · «No voy» en una función con reparto explícito (a): no existe. Estar en
--     el reparto es un hecho y se cambia editando el reparto; «no voy» solo
--     resuelve lo deducido. La RPC lo rechaza.
--
-- Postura de `schedule_slot` y `travel_stage`: RLS forzada, solo SELECT
-- directo, escritura por RPC. Aditiva: no toca nada que el Worker desplegado
-- lea o escriba (gate de § 34 sin staging obligatorio).

-- ── 1 · la tabla ──────────────────────────────────────────────────────────
CREATE TYPE public.commitment_state AS ENUM ('going', 'not_going');

CREATE TABLE public.commitment_person (
  id             uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id   uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.project(id) ON DELETE CASCADE,
  performance_id uuid REFERENCES public.performance(id) ON DELETE CASCADE,
  date_id        uuid REFERENCES public.date(id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES public.person(id) ON DELETE CASCADE,
  state          public.commitment_state NOT NULL,
  set_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commitment_person_one_parent
    CHECK (num_nonnulls(performance_id, date_id) = 1),
  -- Una palabra por persona y compromiso. Los NULL no chocan entre sí, así
  -- que cada UNIQUE solo cubre a los hijos de su tipo de padre.
  CONSTRAINT commitment_person_performance_key UNIQUE (performance_id, person_id),
  CONSTRAINT commitment_person_date_key UNIQUE (date_id, person_id)
);

COMMENT ON TABLE public.commitment_person IS
  'ADR-103: a person''s word on a performance XOR a date — going (confirmed) or not_going (withdrawn from an inference). Optional: with no rows, attribution is inferred from the project cast as before. Written only through set_commitment_person.';

CREATE INDEX commitment_person_workspace_id_idx ON public.commitment_person (workspace_id);
CREATE INDEX commitment_person_project_id_idx   ON public.commitment_person (project_id);
CREATE INDEX commitment_person_person_id_idx    ON public.commitment_person (person_id);
CREATE INDEX commitment_person_set_by_idx       ON public.commitment_person (set_by) WHERE set_by IS NOT NULL;

ALTER TABLE public.commitment_person ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitment_person FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.commitment_person FROM PUBLIC, anon, service_role;

-- Se lee con el permiso con que se lee el padre, y desaparece con él.
CREATE POLICY commitment_person_select ON public.commitment_person
  FOR SELECT TO authenticated
  USING (
    public.has_permission(project_id, 'read:performance')
    AND (
      (performance_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.performance p
        WHERE p.id = commitment_person.performance_id AND p.deleted_at IS NULL))
      OR
      (date_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.date d
        WHERE d.id = commitment_person.date_id AND d.deleted_at IS NULL))
    )
  );

GRANT SELECT ON TABLE public.commitment_person TO authenticated;

CREATE TRIGGER commitment_person_set_updated_at
BEFORE UPDATE ON public.commitment_person
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER commitment_person_audit
AFTER INSERT OR DELETE OR UPDATE ON public.commitment_person
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── 2 · la única puerta de escritura ──────────────────────────────────────
-- set_commitment_person(target, id, person, state): `state` NULL borra la
-- palabra y la persona vuelve a deducirse.
--
-- Puerta: sobre uno mismo basta `read:performance` del proyecto (si lo ves, lo
-- puedes confirmar o retirar); sobre otra persona hace falta
-- `edit:performance`. «No existe» y «no es tuyo» dan el mismo 42501.
CREATE FUNCTION public.set_commitment_person(
  p_target_table text,
  p_target_id    uuid,
  p_person_id    uuid,
  p_state        public.commitment_state
) RETURNS SETOF public.commitment_person
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_workspace_id uuid;
  v_project_id   uuid;
  v_self         boolean;
  v_rostered     boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'person_id cannot be null' USING ERRCODE = '22023';
  END IF;

  IF p_target_table = 'performance' THEN
    SELECT p.workspace_id, p.project_id INTO v_workspace_id, v_project_id
    FROM public.performance p
    WHERE p.id = p_target_id AND p.deleted_at IS NULL
    FOR UPDATE;
  ELSIF p_target_table = 'date' THEN
    SELECT d.workspace_id, d.project_id INTO v_workspace_id, v_project_id
    FROM public.date d
    WHERE d.id = p_target_id AND d.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'target_table must be performance or date' USING ERRCODE = '22023';
  END IF;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION '% % not found', p_target_table, p_target_id USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_profile up
    WHERE up.user_id = auth.uid() AND up.person_id = p_person_id
  ) INTO v_self;

  IF NOT public.has_permission(
    v_project_id, CASE WHEN v_self THEN 'read:performance' ELSE 'edit:performance' END
  ) THEN
    RAISE EXCEPTION '% % not found', p_target_table, p_target_id USING ERRCODE = '42501';
  END IF;

  -- Solo gente del espacio: una palabra sobre un desconocido no es un dato.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = v_workspace_id AND wp.person_id = p_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person is not in this workspace' USING ERRCODE = '22023';
  END IF;

  -- «No voy» solo resuelve lo deducido: en el reparto explícito de una
  -- función (elenco no sustituido, sustitución o equipo técnico) no existe.
  IF p_state = 'not_going' AND p_target_table = 'performance' THEN
    SELECT
      EXISTS (
        SELECT 1 FROM public.cast_member cm
        WHERE cm.project_id = v_project_id AND cm.person_id = p_person_id
          AND cm.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.cast_override co
            WHERE co.performance_id = p_target_id
              AND co.replaces_person_id = p_person_id AND co.deleted_at IS NULL))
      OR EXISTS (
        SELECT 1 FROM public.cast_override co
        WHERE co.performance_id = p_target_id AND co.person_id = p_person_id
          AND co.deleted_at IS NULL)
      OR EXISTS (
        SELECT 1 FROM public.crew_assignment ca
        WHERE ca.performance_id = p_target_id AND ca.person_id = p_person_id
          AND ca.deleted_at IS NULL)
    INTO v_rostered;
    IF v_rostered THEN
      RAISE EXCEPTION 'person is on the explicit roster; edit the roster instead'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_state IS NULL THEN
    DELETE FROM public.commitment_person c
    WHERE c.person_id = p_person_id
      AND ((p_target_table = 'performance' AND c.performance_id = p_target_id)
        OR (p_target_table = 'date' AND c.date_id = p_target_id));
    RETURN;
  END IF;

  IF p_target_table = 'performance' THEN
    RETURN QUERY
    INSERT INTO public.commitment_person AS c
      (workspace_id, project_id, performance_id, person_id, state, set_by)
    VALUES (v_workspace_id, v_project_id, p_target_id, p_person_id, p_state, auth.uid())
    ON CONFLICT (performance_id, person_id)
      DO UPDATE SET state = EXCLUDED.state, set_by = EXCLUDED.set_by
    RETURNING c.*;
  ELSE
    RETURN QUERY
    INSERT INTO public.commitment_person AS c
      (workspace_id, project_id, date_id, person_id, state, set_by)
    VALUES (v_workspace_id, v_project_id, p_target_id, p_person_id, p_state, auth.uid())
    ON CONFLICT (date_id, person_id)
      DO UPDATE SET state = EXCLUDED.state, set_by = EXCLUDED.set_by
    RETURNING c.*;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_commitment_person(text, uuid, uuid, public.commitment_state) IS
  'ADR-103: set (going|not_going) or clear (NULL) one person''s word on a performance or date. Self needs read:performance, anyone else edit:performance. not_going on a person already on a performance''s explicit roster is rejected (22023).';

REVOKE ALL ON FUNCTION public.set_commitment_person(text, uuid, uuid, public.commitment_state)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_commitment_person(text, uuid, uuid, public.commitment_state)
  TO authenticated;
