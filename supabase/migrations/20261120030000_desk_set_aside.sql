-- «Ahora no» en «Te espera» (revisión TDAH, fase 5; ADR-232).
--
-- Cada fila de «Te espera» se puede apartar unos días sin borrarla: no se
-- toca la conversación, la tarea ni la factura (lo que la hace salir sigue
-- igual para el resto del equipo). Apartar es de quien aparta: sigue a la
-- persona del ordenador al teléfono, y nadie más lo ve.
--
-- Por qué no reutilizar el «no esta vez» de Conversaciones (`not_now_until`):
-- aquel cierra la relación para todo el espacio; esto solo calla una fila para
-- una persona, y vale también para tareas, cobros y decisiones.
--
-- Forma: `items` es un objeto `{ "conv-…": "2026-11-23", … }`; la clave es el
-- id de la fila de Hoy (`<tipo>-<id>`), el valor el día en que vuelve.
--
-- Aditiva: una tabla y una RPC. Sin datos.
-- Rollback: `build/runbooks/rollback-20261120-desk-set-aside.sql`.
--
-- Lectura: la fila propia (`user_id = auth.uid()`).
-- Escritura: solo `set_aside_desk_item`, sobre la fila propia.

-- ── La tabla ─────────────────────────────────────────────────────────────────
CREATE TABLE public.desk_set_aside (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT desk_set_aside_is_object CHECK (jsonb_typeof(items) = 'object')
);

-- ENABLE y FORCE: FORCE solo no hace nada si RLS no está activo.
ALTER TABLE public.desk_set_aside ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.desk_set_aside FORCE ROW LEVEL SECURITY;
ALTER TABLE public.desk_set_aside OWNER TO postgres;

COMMENT ON TABLE public.desk_set_aside IS
  'Hoy «Te espera»: rows a login has set aside («Ahora no») and the day each comes back. Own row only; written by set_aside_desk_item.';

CREATE TRIGGER desk_set_aside_set_updated_at BEFORE UPDATE ON public.desk_set_aside
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sin INSERT, UPDATE ni DELETE para la API: se escribe por la RPC.
GRANT SELECT ON TABLE public.desk_set_aside TO authenticated;
GRANT ALL ON TABLE public.desk_set_aside TO service_role;

CREATE POLICY desk_set_aside_select_self ON public.desk_set_aside
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── set_aside_desk_item ──────────────────────────────────────────────────────
-- Aparta la fila `p_key` hasta `p_until` (hasta un año), o la trae de vuelta
-- con `p_until` nulo. El día es el de quien aparta: se admite desde el de hoy
-- en UTC, porque al oeste de UTC «mañana» puede ser aún hoy aquí. De paso
-- olvida lo que ya volvió (día anterior al de hoy en UTC), para que el objeto
-- no crezca. Devuelve lo apartado entero.
CREATE FUNCTION public.set_aside_desk_item(p_key text, p_until date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_items jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z]{1,16}-[A-Za-z0-9_:.+-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid desk key' USING ERRCODE = '22023';
  END IF;
  IF p_until IS NOT NULL AND (p_until < current_date OR p_until > current_date + 366) THEN
    RAISE EXCEPTION 'invalid set-aside day' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.desk_set_aside AS s (user_id, items)
  VALUES (v_caller, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO v_items
    FROM public.desk_set_aside s, jsonb_each(s.items) e
   WHERE s.user_id = v_caller
     AND e.key <> p_key
     AND jsonb_typeof(e.value) = 'string'
     AND (e.value #>> '{}') >= current_date::text;

  IF p_until IS NOT NULL THEN
    v_items := v_items || jsonb_build_object(p_key, p_until::text);
  END IF;

  UPDATE public.desk_set_aside SET items = v_items WHERE user_id = v_caller;
  RETURN v_items;
END;
$$;

COMMENT ON FUNCTION public.set_aside_desk_item(text, date) IS
  'Hoy «Te espera»: set a row aside until a day (up to a year), or bring it back with a null day. Own row only; forgets what has already come back. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.set_aside_desk_item(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_aside_desk_item(text, date) TO authenticated;
