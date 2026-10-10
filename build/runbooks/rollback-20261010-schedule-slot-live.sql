-- ROLLBACK for 20261010220000_schedule_slot_live.sql (ADR-090 P2)
--
-- Brings back P1's replace_schedule_slots and private.schedule_slot_parent
-- (copied verbatim from 20261009200000, grants included), drops the
-- service_role materialization seam, takes `date` out of collab_snapshot and
-- can_user_write_collab, and closes service_role's read of schedule_slot.
--
-- DATA LOST: the collab snapshots of rehearsal days (`collab_snapshot` rows
-- with target_table = 'date'). The running orders themselves are NOT lost:
-- the rows in `schedule_slot` stay, and they are what every read surface
-- reads. Edits made in a rehearsal doc after its last materialization are.
-- Performance docs keep their snapshots, `schedule` array included (harmless:
-- the old DO ignores it).
--
-- Workers: roll back hour-web and hour-collab FIRST. A collab Worker from this
-- branch, with this rollback applied, fails to hydrate every performance doc
-- (it reads schedule_slot as service_role and gets 42501), so the notes go
-- unavailable too. The Workers before this branch work on both sides.

BEGIN;

DROP FUNCTION IF EXISTS public.replace_schedule_slots_for_user(uuid, text, uuid, jsonb);

-- P1's body, verbatim (20261009200000 § 3).
CREATE OR REPLACE FUNCTION public.replace_schedule_slots(
  p_target_table text,
  p_target_id    uuid,
  p_slots        jsonb
) RETURNS SETOF public.schedule_slot
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_parent record;
  v_item   jsonb;
  v_ord    integer;
  v_id     uuid;
  v_ids    uuid[] := '{}';
BEGIN
  SELECT * INTO v_parent FROM private.schedule_slot_parent(p_target_table, p_target_id);

  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RAISE EXCEPTION 'slots must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_slots) > 200 THEN
    RAISE EXCEPTION 'too many slots (max 200)' USING ERRCODE = '22023';
  END IF;

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

  DELETE FROM public.schedule_slot s
  WHERE ((p_target_table = 'performance' AND s.performance_id = p_target_id)
      OR (p_target_table = 'date' AND s.date_id = p_target_id))
    AND NOT (s.id = ANY (v_ids));

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
      auth.uid()
    )
    ON CONFLICT (id) DO UPDATE SET
      label   = EXCLUDED.label,
      kind    = EXCLUDED.kind,
      at      = EXCLUDED.at,
      ends_at = EXCLUDED.ends_at,
      sort    = EXCLUDED.sort,
      notes   = EXCLUDED.notes
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

REVOKE ALL ON FUNCTION public.replace_schedule_slots(text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.replace_schedule_slots(text, uuid, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS private.replace_schedule_slots(uuid, text, uuid, jsonb);

-- P1's gate, verbatim (20261009200000 § 2).
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
  IF auth.uid() IS NULL THEN
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

  IF project_id IS NULL OR NOT public.has_permission(project_id, 'edit:performance') THEN
    RAISE EXCEPTION '% % not found', p_target_table, p_target_id USING ERRCODE = '42501';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS private.schedule_slot_parent_for(uuid, text, uuid);

REVOKE SELECT ON TABLE public.schedule_slot FROM service_role;

-- can_user_write_collab as 20260720172431 left it.
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
    ELSE
      RETURN false;
  END CASE;

  RETURN v_project_id IS NOT NULL
    AND public.has_permission_for_user(v_project_id, v_permission, p_user_id);
END;
$$;

-- The rehearsal docs go (see DATA LOST above), then the CHECK narrows again.
DELETE FROM public.collab_snapshot WHERE target_table = 'date';

ALTER TABLE public.collab_snapshot
  DROP CONSTRAINT collab_snapshot_target_table_chk,
  ADD CONSTRAINT collab_snapshot_target_table_chk
    CHECK (target_table = ANY (ARRAY['performance', 'project', 'line']));

-- Postgres keeps the migration's history row; the rollback removes it so the
-- catalogue says what the schema is.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261010220000';

COMMIT;
