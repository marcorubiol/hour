-- «Qué preparamos para una función»: lo hecho a mano en cada función (ADR-221, fase 3).
--
-- El estado de cada cosa a mano de la lista del proyecto vive en
-- `performance.custom_fields.preparation`, por id de cosa:
--   { "m_k3j9x2ab": { "estado": "hecho" | "no_aplica", "por": <user id>, "cuando": <instante> } }
-- `set_performance_preparation` lo escribe sin tocar el resto de `custom_fields` ni las
-- demás cosas (una sola clave por llamada, atómica en una sentencia). `p_estado` NULL
-- reabre la cosa (borra su clave). Mismo permiso que editar la función
-- (`has_permission(project, 'edit:performance')`); `por` y `cuando` los pone la base
-- (auth.uid(), now()), nunca el cliente. Solo ids de cosa a mano (`m_` y 4 a 16
-- minúsculas o dígitos): las de la app se cierran por el dato.
--
-- Aditiva: función nueva, ninguna política ni grant existente cambia.
-- Rollback: build/runbooks/rollback-20261119-performance-preparation.sql (borra la
-- función; el estado ya guardado se queda en custom_fields sin que nadie lo lea).

CREATE OR REPLACE FUNCTION public.set_performance_preparation(
  p_performance_id uuid,
  p_thing text,
  p_estado text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_project_id uuid;
  v_prep jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_thing IS NULL OR p_thing !~ '^m_[a-z0-9]{4,16}$' THEN
    RAISE EXCEPTION 'thing must be a hand-made id (m_…)' USING ERRCODE = '22023';
  END IF;
  IF p_estado IS NOT NULL AND p_estado NOT IN ('hecho', 'no_aplica') THEN
    RAISE EXCEPTION 'estado must be hecho, no_aplica or null' USING ERRCODE = '22023';
  END IF;

  SELECT pf.project_id INTO v_project_id
  FROM public.performance pf
  WHERE pf.id = p_performance_id
    AND pf.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'performance not found or edit:performance required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.performance pf
  SET custom_fields = jsonb_set(
        coalesce(pf.custom_fields, '{}'::jsonb),
        '{preparation}',
        CASE
          WHEN p_estado IS NULL THEN coalesce(pf.custom_fields->'preparation', '{}'::jsonb) - p_thing
          ELSE coalesce(pf.custom_fields->'preparation', '{}'::jsonb)
               || jsonb_build_object(p_thing, jsonb_build_object('estado', p_estado, 'por', auth.uid(), 'cuando', now()))
        END,
        true
      ),
      updated_at = now()
  WHERE pf.id = p_performance_id
    AND pf.deleted_at IS NULL
  RETURNING pf.custom_fields->'preparation' INTO v_prep;

  RETURN coalesce(v_prep, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.set_performance_preparation(uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_performance_preparation(uuid, text, text)
  TO authenticated;
