-- Ayuda contextual, enfoque A · lo que cada persona ya ha visto.
--
-- Investigación: `build/coordination/onboarding/investigacion.md` § 3 y § 4 A.
--
-- Una tarjeta de bienvenida por sección y un aviso de primera vez por evento
-- salen una sola vez. «Una vez» es por persona, no por navegador: sigue al
-- usuario del ordenador al teléfono. La «i» de concepto no se guarda nunca.
--
-- Por qué una tabla y no una columna de `user_profile`: `user_profile_select`
-- deja leer la fila de un compañero (el roster lo necesita), y lo visto es solo
-- tuyo. Aquí cada uno lee su fila y nadie más.
--
-- Forma: `seen` es un objeto `{ "card:planner": "2026-10-20T…", … }`; la clave
-- es `card:<sección>` o `event:<evento>`, el valor cuándo se vio.
--
-- Aditiva: una tabla, dos RPC. Sin datos.
-- Rollback: `build/runbooks/rollback-20261020-help-seen.sql`.
--
-- Lectura: la fila propia (`user_id = auth.uid()`).
-- Escritura: solo `mark_help_seen` (añade una clave) y `reset_help_seen`
-- («Volver a ver las ayudas», vacía lo visto). Las dos sobre la fila propia.

-- ── La tabla ─────────────────────────────────────────────────────────────────
CREATE TABLE public.help_seen (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  seen       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_seen_is_object CHECK (jsonb_typeof(seen) = 'object')
);

-- ENABLE y FORCE: FORCE solo no hace nada si RLS no está activo.
ALTER TABLE public.help_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.help_seen FORCE ROW LEVEL SECURITY;
ALTER TABLE public.help_seen OWNER TO postgres;

COMMENT ON TABLE public.help_seen IS
  'Contextual help (approach A): which welcome cards and first-time notes a login has seen. Own row only; written by mark_help_seen and reset_help_seen.';

CREATE TRIGGER help_seen_set_updated_at BEFORE UPDATE ON public.help_seen
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sin INSERT, UPDATE ni DELETE para la API: se escribe por las RPC.
GRANT SELECT ON TABLE public.help_seen TO authenticated;
GRANT ALL ON TABLE public.help_seen TO service_role;

CREATE POLICY help_seen_select_self ON public.help_seen
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── mark_help_seen ───────────────────────────────────────────────────────────
-- Añade la clave a lo visto de quien llama (crea la fila si no la hay). Volver
-- a marcar una clave ya vista no cambia su fecha. Devuelve lo visto entero.
CREATE FUNCTION public.mark_help_seen(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_seen jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^(card|event):[a-z][a-z0-9_]{0,47}$' THEN
    RAISE EXCEPTION 'invalid help key' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.help_seen AS h (user_id, seen)
  VALUES (v_caller, jsonb_build_object(p_key, now()))
  ON CONFLICT (user_id) DO UPDATE
    SET seen = jsonb_build_object(p_key, now()) || h.seen
  RETURNING h.seen INTO v_seen;

  RETURN v_seen;
END;
$$;

COMMENT ON FUNCTION public.mark_help_seen(text) IS
  'Contextual help: record that the caller has seen a welcome card (card:<section>) or a first-time note (event:<name>). Own row only; the first date wins. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.mark_help_seen(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_help_seen(text) TO authenticated;

-- ── reset_help_seen ──────────────────────────────────────────────────────────
-- «Volver a ver las ayudas»: vacía lo visto de quien llama.
CREATE FUNCTION public.reset_help_seen()
RETURNS jsonb
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
  UPDATE public.help_seen SET seen = '{}'::jsonb WHERE user_id = v_caller;
  RETURN '{}'::jsonb;
END;
$$;

COMMENT ON FUNCTION public.reset_help_seen() IS
  'Contextual help: forget every card and first-time note the caller has seen («Show the tips again»). Own row only. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.reset_help_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_help_seen() TO authenticated;
