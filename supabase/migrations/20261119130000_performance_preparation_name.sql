-- «Qué preparamos para una función»: quién cerró una cosa a mano (ADR-221, cabo de la fase 3).
--
-- `set_performance_preparation` guarda también el nombre de quien cierra, junto a `por` y
-- `cuando`: { "estado": …, "por": <user id>, "nombre": <texto o null>, "cuando": … }.
-- Es una foto del nombre en ese momento (`user_profile.full_name`, o el de la cuenta). Lo
-- ya cerrado no lo tiene: la línea de lo cerrado dice solo cuándo, como hasta ahora.
-- Mismo permiso, misma firma y mismo grant que antes; solo cambia el cuerpo.
--
-- Aditiva en datos (una clave más por entrada). Rollback:
-- build/runbooks/rollback-20261119-performance-preparation-name.sql (vuelve al cuerpo anterior).

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
  v_nombre text;
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

  -- El nombre de quien cierra se anota con el estado: leerlo luego pediría
  -- permisos de administración del espacio que quien edita la función no tiene.
  SELECT left(coalesce(nullif(btrim(up.full_name), ''), nullif(btrim(au.raw_user_meta_data->>'full_name'), '')), 120)
    INTO v_nombre
  FROM auth.users au
  LEFT JOIN public.user_profile up ON up.user_id = au.id
  WHERE au.id = auth.uid();

  UPDATE public.performance pf
  SET custom_fields = jsonb_set(
        coalesce(pf.custom_fields, '{}'::jsonb),
        '{preparation}',
        CASE
          WHEN p_estado IS NULL THEN coalesce(pf.custom_fields->'preparation', '{}'::jsonb) - p_thing
          ELSE coalesce(pf.custom_fields->'preparation', '{}'::jsonb)
               || jsonb_build_object(p_thing, jsonb_build_object('estado', p_estado, 'por', auth.uid(), 'nombre', v_nombre, 'cuando', now()))
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
