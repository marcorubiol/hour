-- ADR-090 P1 · `schedule_slot`, fase B (contract): las cinco columnas de
-- franja se van de `performance` (`_tasks.md § 17`).
--
-- Va DESPUÉS de dos cosas: la fase A (`20261009200000_schedule_slot`) y el
-- deploy del Worker que lee y escribe `schedule_slot`. Con el Worker viejo
-- todavía vivo, esta migración rompe el mes, la agenda, el tablero, el detalle
-- y el road sheet (piden las columnas en su `select`).
--
-- DESTRUCTIVA SEGÚN § 34 (DROP COLUMN): staging obligatorio e `inspect` antes.
-- Sin CASCADE a propósito: si algo que solo tiene producción depende de una de
-- las columnas (una vista en `hour_backup_20260720`, por ejemplo), el DROP
-- falla y la transacción entera revierte.

-- ── 1 · fuera el espejo temporal ──────────────────────────────────────────
DROP TRIGGER IF EXISTS performance_timeslots_mirror ON public.performance;
DROP TRIGGER IF EXISTS schedule_slot_timeslots_mirror ON public.schedule_slot;
DROP FUNCTION IF EXISTS private.mirror_timeslot_columns_to_slots();
DROP FUNCTION IF EXISTS private.mirror_timeslot_slots_to_columns();

-- ── 2 · columnas y slots dicen lo mismo ───────────────────────────────────
-- El espejo de la fase A las ha mantenido iguales. Si alguna función no
-- cuadra, algo escribió por un camino que el espejo no ve: se aborta antes de
-- que el DROP se lleve la otra versión, y la lista dice cuáles mirar.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.id::text, ', ') INTO v_bad
  FROM public.performance p, LATERAL (SELECT private.performance_timeslots(p.id) AS t) x
  WHERE (p.load_in_at, p.soundcheck_at, p.start_at, p.loadout_at, p.wrap_at)
        IS DISTINCT FROM (
          (x.t->>'load_in_at')::timestamptz, (x.t->>'soundcheck_at')::timestamptz,
          (x.t->>'start_at')::timestamptz, (x.t->>'loadout_at')::timestamptz,
          (x.t->>'wrap_at')::timestamptz);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'timeslot columns and schedule_slot disagree for performance(s): %', v_bad;
  END IF;
END;
$$;

-- ── 3 · el catálogo, antes del DROP ───────────────────────────────────────
-- Una función plpgsql que nombre una columna no la sujeta (no hay dependencia
-- registrada): el DROP pasaría y la función moriría en la primera llamada.
-- Se pregunta al catálogo, en TODOS los esquemas de usuario (también
-- `hour_backup_20260720`), por cualquier cuerpo que nombre una de las cinco.
-- Las dos proyecciones públicas ya no las nombran como columnas; las claves
-- del JSON las pone `private.performance_timeslots`, que por eso se excluye.
DO $$
DECLARE
  v_hits text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_hits
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND p.oid <> 'private.performance_timeslots(uuid)'::regprocedure
    AND p.prosrc ~ '\m(load_in_at|soundcheck_at|start_at|loadout_at|wrap_at)\M';
  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'functions still name the dropped timeslot columns: %', v_hits;
  END IF;
END;
$$;

-- ── 4 · las cinco columnas se van ─────────────────────────────────────────
-- Sin CASCADE: una vista o un objeto que dependa de ellas hace fallar el DROP
-- y revertir la migración entera, que es justo lo que se quiere. Los grants
-- de SELECT por columnas (20260720172431) se van con las columnas.
ALTER TABLE public.performance
  DROP CONSTRAINT performance_timeslots_ordered,
  DROP COLUMN load_in_at,
  DROP COLUMN soundcheck_at,
  DROP COLUMN start_at,
  DROP COLUMN loadout_at,
  DROP COLUMN wrap_at;

COMMENT ON COLUMN public.performance.hold_notice_days IS
  'ADR-079 §2: hold decision notice as lead time. NULL = standard default (30) · 0 = no notice · N = notify N days before the start slot (schedule_slot kind=start, ADR-090). Urgency is derived (start − notice), never stored.';
