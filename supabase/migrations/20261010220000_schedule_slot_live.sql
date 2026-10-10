-- ADR-090 P2 · la escaleta en directo: el doc colaborativo manda (`_tasks.md § 17`).
--
-- DECIDIDO por Marco (2026-10-10): la escaleta la escribe SIEMPRE el doc en
-- directo, como las notas. El PATCH de la función deja de escribir franjas y
-- la pantalla escribe por el doc. El Durable Object de collab materializa el
-- `Y.Array` `schedule` en `schedule_slot` con la misma RPC que diffea por id.
--
-- El DO entra a Postgres como `service_role`, sin el JWT de nadie. P1 le
-- cerró a `service_role` la escritura y la lectura de la escaleta, y
-- `collab_snapshot` y `can_user_write_collab` no conocían `date`. Esta
-- migración abre lo justo, y nada más:
--
--   1. `date` en el CHECK de `collab_snapshot`: el doc `date:<id>` de un
--      ensayo puede guardar su snapshot.
--   2. `date` en `can_user_write_collab`, con la puerta de la escaleta
--      (`edit:performance`, la de ADR-090).
--   3. La puerta del padre con el usuario explícito
--      (`private.schedule_slot_parent_for`), y la de siempre pasa a ser
--      ella con `auth.uid()`. Una sola regla.
--   4. El cuerpo de `replace_schedule_slots` se muda a `private` con el
--      usuario explícito. `public.replace_schedule_slots` (authenticated)
--      lo llama con `auth.uid()`: mismo contrato, mismo resultado.
--      `public.replace_schedule_slots_for_user` (SOLO `service_role`) lo
--      llama con el usuario que el DO dice que editó, y la puerta sigue
--      siendo `edit:performance` DE ESE USUARIO: el DO no escribe nada que la
--      persona no podría escribir.
--   5. `service_role` puede LEER `schedule_slot` (el DO siembra el doc desde
--      las filas la primera vez). Solo SELECT: escribe por la RPC.
--
-- ADITIVA: no quita ni renombra nada que el Worker desplegado lea o escriba.
-- `replace_schedule_slots` conserva firma, grants y resultado. Orden de
-- despliegue: esta migración → Worker `hour-collab` → Worker `hour-web`.

-- ── 1 · collab_snapshot admite date ───────────────────────────────────────
ALTER TABLE public.collab_snapshot
  DROP CONSTRAINT collab_snapshot_target_table_chk,
  ADD CONSTRAINT collab_snapshot_target_table_chk
    CHECK (target_table = ANY (ARRAY['performance', 'project', 'line', 'date']));

-- ── 2 · can_user_write_collab conoce date ────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_user_write_collab(
  p_user_id uuid,
  p_target_table text,
  p_target_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_permission text;
BEGIN
  CASE p_target_table
    WHEN 'project' THEN
      SELECT p.id INTO v_project_id
      FROM public.project p
      WHERE p.id = p_target_id AND p.deleted_at IS NULL;
      v_permission := 'edit:project_meta';
    WHEN 'line' THEN
      SELECT l.project_id INTO v_project_id
      FROM public.line l
      WHERE l.id = p_target_id AND l.deleted_at IS NULL;
      v_permission := 'edit:project_meta';
    WHEN 'performance' THEN
      SELECT pf.project_id INTO v_project_id
      FROM public.performance pf
      WHERE pf.id = p_target_id AND pf.deleted_at IS NULL;
      v_permission := 'edit:performance';
    WHEN 'date' THEN
      -- ADR-090: la escaleta de un día se escribe con la puerta de la de una
      -- función, la misma que `date` y `bolo`.
      SELECT d.project_id INTO v_project_id
      FROM public.date d
      WHERE d.id = p_target_id AND d.deleted_at IS NULL;
      v_permission := 'edit:performance';
    ELSE
      RETURN false;
  END CASE;

  RETURN v_project_id IS NOT NULL
    AND public.has_permission_for_user(v_project_id, v_permission, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_user_write_collab(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_user_write_collab(uuid, text, uuid)
  TO service_role;

-- ── 3 · la puerta del padre, con el usuario explícito ─────────────────────
-- Igual que `private.schedule_slot_parent` de P1, pero sin leer la sesión:
-- resuelve el padre, lo bloquea y comprueba `edit:performance` del usuario
-- dado. «No existe» y «no es tuyo» siguen dando el mismo 42501.
CREATE FUNCTION private.schedule_slot_parent_for(
  p_user_id      uuid,
  p_target_table text,
  p_target_id    uuid,
  OUT workspace_id uuid,
  OUT project_id   uuid
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_target_table = 'performance' THEN
    SELECT p.workspace_id, p.project_id INTO workspace_id, project_id
    FROM public.performance p
    WHERE p.id = p_target_id AND p.deleted_at IS NULL
    FOR UPDATE;
  ELSIF p_target_table = 'date' THEN
    SELECT d.workspace_id, d.project_id INTO workspace_id, project_id
    FROM public.date d
    WHERE d.id = p_target_id AND d.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'target_table must be performance or date' USING ERRCODE = '22023';
  END IF;

  IF project_id IS NULL
     OR NOT public.has_permission_for_user(project_id, 'edit:performance', p_user_id) THEN
    RAISE EXCEPTION '% % not found', p_target_table, p_target_id USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.schedule_slot_parent_for(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- La de P1 (la usan create/update/delete/reorder) pasa a ser esta con la
-- sesión. Misma firma, mismo comportamiento.
CREATE OR REPLACE FUNCTION private.schedule_slot_parent(
  p_target_table text,
  p_target_id    uuid,
  OUT workspace_id uuid,
  OUT project_id   uuid
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  SELECT f.workspace_id, f.project_id INTO workspace_id, project_id
  FROM private.schedule_slot_parent_for(auth.uid(), p_target_table, p_target_id) f;
END;
$$;

-- ── 4 · el cuerpo de replace, en private, con el usuario explícito ────────
-- Exactamente el cuerpo de P1 (`20261009200000` § 3), con dos cambios: la
-- puerta es `schedule_slot_parent_for(p_user_id, …)` y `created_by` es
-- `p_user_id`.
CREATE FUNCTION private.replace_schedule_slots(
  p_user_id      uuid,
  p_target_table text,
  p_target_id    uuid,
  p_slots        jsonb
) RETURNS SETOF public.schedule_slot
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_parent record;
  v_item   jsonb;
  v_ord    integer;
  v_id     uuid;
  v_ids    uuid[] := '{}';
BEGIN
  SELECT * INTO v_parent
  FROM private.schedule_slot_parent_for(p_user_id, p_target_table, p_target_id);

  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RAISE EXCEPTION 'slots must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_slots) > 200 THEN
    RAISE EXCEPTION 'too many slots (max 200)' USING ERRCODE = '22023';
  END IF;

  -- Ids explícitos: sin repetidos, y ninguno de otra escaleta.
  SELECT coalesce(array_agg((e->>'id')::uuid), '{}') INTO v_ids
  FROM jsonb_array_elements(p_slots) e
  WHERE nullif(e->>'id', '') IS NOT NULL;

  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'duplicate slot id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.schedule_slot s
    WHERE s.id = ANY (v_ids)
      AND NOT ((p_target_table = 'performance' AND s.performance_id IS NOT DISTINCT FROM p_target_id)
            OR (p_target_table = 'date' AND s.date_id IS NOT DISTINCT FROM p_target_id))
  ) THEN
    RAISE EXCEPTION 'slot belongs to another running order' USING ERRCODE = '22023';
  END IF;

  -- Bajas.
  DELETE FROM public.schedule_slot s
  WHERE ((p_target_table = 'performance' AND s.performance_id = p_target_id)
      OR (p_target_table = 'date' AND s.date_id = p_target_id))
    AND NOT (s.id = ANY (v_ids));

  -- Altas y cambios, en orden. Las UNIQUE de `sort` son diferidas.
  FOR v_item, v_ord IN
    SELECT e, o FROM jsonb_array_elements(p_slots) WITH ORDINALITY AS t(e, o)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'each slot must be an object' USING ERRCODE = '22023';
    END IF;
    IF nullif(v_item->>'at', '') IS NULL THEN
      RAISE EXCEPTION 'slot % has no at', v_ord USING ERRCODE = '22023';
    END IF;

    v_id := coalesce(nullif(v_item->>'id', '')::uuid, public.uuid_generate_v7());

    INSERT INTO public.schedule_slot AS s (
      id, workspace_id, project_id, performance_id, date_id,
      label, kind, at, ends_at, sort, notes, created_by
    ) VALUES (
      v_id, v_parent.workspace_id, v_parent.project_id,
      CASE WHEN p_target_table = 'performance' THEN p_target_id END,
      CASE WHEN p_target_table = 'date' THEN p_target_id END,
      nullif(btrim(coalesce(v_item->>'label', '')), ''),
      nullif(btrim(coalesce(v_item->>'kind', '')), ''),
      (v_item->>'at')::timestamptz,
      nullif(v_item->>'ends_at', '')::timestamptz,
      v_ord,
      nullif(btrim(coalesce(v_item->>'notes', '')), ''),
      p_user_id
    )
    ON CONFLICT (id) DO UPDATE SET
      label   = EXCLUDED.label,
      kind    = EXCLUDED.kind,
      at      = EXCLUDED.at,
      ends_at = EXCLUDED.ends_at,
      sort    = EXCLUDED.sort,
      notes   = EXCLUDED.notes
    -- Solo si cambió algo: el doc se materializa a menudo y el audit_log no
    -- debe llenarse de no-cambios.
    WHERE (s.label, s.kind, s.at, s.ends_at, s.sort, s.notes)
          IS DISTINCT FROM
          (EXCLUDED.label, EXCLUDED.kind, EXCLUDED.at, EXCLUDED.ends_at, EXCLUDED.sort, EXCLUDED.notes);
  END LOOP;

  RETURN QUERY
  SELECT * FROM public.schedule_slot
  WHERE (p_target_table = 'performance' AND performance_id = p_target_id)
     OR (p_target_table = 'date' AND date_id = p_target_id)
  ORDER BY sort;
END;
$$;

REVOKE ALL ON FUNCTION private.replace_schedule_slots(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- La de siempre, para `authenticated`: el cuerpo común con la sesión.
CREATE OR REPLACE FUNCTION public.replace_schedule_slots(
  p_target_table text,
  p_target_id    uuid,
  p_slots        jsonb
) RETURNS SETOF public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM private.replace_schedule_slots(auth.uid(), p_target_table, p_target_id, p_slots);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_schedule_slots(text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.replace_schedule_slots(text, uuid, jsonb) TO authenticated;

-- La del DO, SOLO `service_role`. El usuario lo pone el DO (quien editó el
-- doc); la puerta es la de ese usuario. Además se escribe su id como
-- `request.jwt.claim.sub` de ESTA transacción, para que `write_audit`
-- (que lee `auth.uid()`) atribuya cada alta, cambio y baja a la persona y no
-- a un actor vacío. Se devuelve a lo que era al terminar: no sale de la
-- llamada.
CREATE FUNCTION public.replace_schedule_slots_for_user(
  p_user_id      uuid,
  p_target_table text,
  p_target_id    uuid,
  p_slots        jsonb
) RETURNS SETOF public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  RETURN QUERY
  SELECT * FROM private.replace_schedule_slots(p_user_id, p_target_table, p_target_id, p_slots);
  PERFORM set_config('request.jwt.claim.sub', v_sub, true);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_schedule_slots_for_user(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_schedule_slots_for_user(uuid, text, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.replace_schedule_slots_for_user(uuid, text, uuid, jsonb) IS
  'ADR-090 P2: service_role-only materialization of the collab doc''s running order. Same body as replace_schedule_slots, gated on edit:performance of the explicit user, who is also the audit actor.';

-- ── 5 · el DO lee la escaleta ─────────────────────────────────────────────
-- Para sembrar el doc desde las filas. `service_role` salta la RLS; solo le
-- hace falta el grant de tabla. Escribir, únicamente por la RPC de arriba.
GRANT SELECT ON TABLE public.schedule_slot TO service_role;
