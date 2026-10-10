-- ROLLBACK for 20261009210000_schedule_slot_contract.sql (ADR-090 P1, fase B)
--
-- Brings the database back to fase A: the five timeslot columns on
-- `performance`, refilled from the slots of kind load_in | soundcheck | start
-- | loadout | wrap (the first of each kind, by sort), their CHECK, comments and
-- column SELECT grant, and the two mirror triggers that keep columns and slots
-- equal. The columns come back at the END of the table (column order is the
-- only difference from the original schema).
--
-- No data is lost: the slots stay. If someone saved an out-of-order schedule
-- of the five kinds, restoring `performance_timeslots_ordered` fails and the
-- rollback reverts: fix those rows first (the error names the constraint).
--
-- Worker: none needed. The Worker that reads schedule_slot works on fase A too.
-- To go further back, run rollback-20261009-schedule-slot.sql next.

BEGIN;

ALTER TABLE public.performance
  ADD COLUMN load_in_at    timestamptz,
  ADD COLUMN soundcheck_at timestamptz,
  ADD COLUMN start_at      timestamptz,
  ADD COLUMN loadout_at    timestamptz,
  ADD COLUMN wrap_at       timestamptz;

UPDATE public.performance p SET
  load_in_at    = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'load_in'    ORDER BY s.sort LIMIT 1),
  soundcheck_at = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'soundcheck' ORDER BY s.sort LIMIT 1),
  start_at      = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'start'      ORDER BY s.sort LIMIT 1),
  loadout_at    = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'loadout'    ORDER BY s.sort LIMIT 1),
  wrap_at       = (SELECT s.at FROM public.schedule_slot s WHERE s.performance_id = p.id AND s.kind = 'wrap'       ORDER BY s.sort LIMIT 1)
WHERE EXISTS (SELECT 1 FROM public.schedule_slot s WHERE s.performance_id = p.id);

ALTER TABLE public.performance
  ADD CONSTRAINT performance_timeslots_ordered CHECK (((("load_in_at" IS NULL) OR ("soundcheck_at" IS NULL) OR ("load_in_at" <= "soundcheck_at")) AND (("soundcheck_at" IS NULL) OR ("start_at" IS NULL) OR ("soundcheck_at" <= "start_at")) AND (("start_at" IS NULL) OR ("loadout_at" IS NULL) OR ("start_at" <= "loadout_at")) AND (("loadout_at" IS NULL) OR ("wrap_at" IS NULL) OR ("loadout_at" <= "wrap_at"))));

COMMENT ON COLUMN public.performance.load_in_at IS 'ADR-023: crew arrival / venue access begins.';
COMMENT ON COLUMN public.performance.soundcheck_at IS 'ADR-023: soundcheck start.';
COMMENT ON COLUMN public.performance.start_at IS 'ADR-023: doors-open / actual performance start. May differ from performed_at (which is just a date).';
COMMENT ON COLUMN public.performance.loadout_at IS 'ADR-023: load-out start.';
COMMENT ON COLUMN public.performance.wrap_at IS 'ADR-023: crew leaves venue.';
COMMENT ON COLUMN public.performance.hold_notice_days IS 'ADR-079 §2: hold decision notice as lead time. NULL = standard default (30) · 0 = no notice · N = notify N days before start_at. Urgency is derived (start_at − notice), never stored.';

-- The column SELECT grant of 20260720172431 (the other privileges on
-- `performance` are table-level and cover new columns by themselves).
GRANT SELECT (load_in_at, soundcheck_at, start_at, loadout_at, wrap_at)
  ON public.performance TO authenticated;

CREATE FUNCTION private.mirror_timeslot_columns_to_slots()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_kind  text;
  v_new   timestamptz;
  v_slot  public.schedule_slot;
  v_dirty boolean := false;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  FOR v_kind, v_new IN
    SELECT * FROM (VALUES
      ('load_in',    NEW.load_in_at),
      ('soundcheck', NEW.soundcheck_at),
      ('start',      NEW.start_at),
      ('loadout',    NEW.loadout_at),
      ('wrap',       NEW.wrap_at)
    ) AS t(kind, at)
  LOOP
    SELECT * INTO v_slot FROM public.schedule_slot
    WHERE performance_id = NEW.id AND kind = v_kind
    ORDER BY sort LIMIT 1;

    IF v_new IS NULL THEN
      IF v_slot.id IS NOT NULL THEN
        DELETE FROM public.schedule_slot WHERE id = v_slot.id;
        v_dirty := true;
      END IF;
    ELSIF v_slot.id IS NULL THEN
      INSERT INTO public.schedule_slot (
        workspace_id, project_id, performance_id, kind, at, sort, created_by
      ) VALUES (
        NEW.workspace_id, NEW.project_id, NEW.id, v_kind, v_new,
        (SELECT coalesce(max(sort), 0) + 1 FROM public.schedule_slot WHERE performance_id = NEW.id),
        auth.uid()
      );
    ELSIF v_slot.at IS DISTINCT FROM v_new THEN
      UPDATE public.schedule_slot SET at = v_new WHERE id = v_slot.id;
    END IF;
  END LOOP;

  IF v_dirty THEN
    PERFORM private.schedule_slot_compact('performance', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.mirror_timeslot_columns_to_slots() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER performance_timeslots_mirror
AFTER INSERT OR UPDATE OF load_in_at, soundcheck_at, start_at, loadout_at, wrap_at
ON public.performance
FOR EACH ROW EXECUTE FUNCTION private.mirror_timeslot_columns_to_slots();

CREATE FUNCTION private.mirror_timeslot_slots_to_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pid uuid;
  v_t   jsonb;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  v_pid := coalesce(
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.performance_id END,
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.performance_id END);
  IF v_pid IS NULL THEN
    RETURN NULL;
  END IF;

  v_t := private.performance_timeslots(v_pid);
  UPDATE public.performance SET
    load_in_at    = (v_t->>'load_in_at')::timestamptz,
    soundcheck_at = (v_t->>'soundcheck_at')::timestamptz,
    start_at      = (v_t->>'start_at')::timestamptz,
    loadout_at    = (v_t->>'loadout_at')::timestamptz,
    wrap_at       = (v_t->>'wrap_at')::timestamptz
  WHERE id = v_pid
    AND (load_in_at, soundcheck_at, start_at, loadout_at, wrap_at) IS DISTINCT FROM (
      (v_t->>'load_in_at')::timestamptz, (v_t->>'soundcheck_at')::timestamptz,
      (v_t->>'start_at')::timestamptz, (v_t->>'loadout_at')::timestamptz,
      (v_t->>'wrap_at')::timestamptz);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.mirror_timeslot_slots_to_columns() FROM PUBLIC, anon, authenticated;

-- DIFERIDO a la confirmación: `replace_schedule_slots` mueve varios slots en
-- sentencias sucesivas y un estado intermedio podría romper el CHECK de orden
-- de las columnas. Al confirmar se recalcula desde el estado final.
CREATE CONSTRAINT TRIGGER schedule_slot_timeslots_mirror
AFTER INSERT OR UPDATE OR DELETE ON public.schedule_slot
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.mirror_timeslot_slots_to_columns();

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261009210000';

COMMIT;
