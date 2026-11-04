-- 122 · El grupo del bolo dice quién lo lee con nombre y papel (ADR-177 § 6).
--
-- `thread_audience` devolvía `{user_id, name}` por lector. Ahora cada lector
-- lleva además:
--   - `person_id`: su persona (`user_profile.person_id`, ADR de login ↔
--     persona); null si no ha enlazado su perfil;
--   - `roles`: en un hilo de bolo, 'cast' si está en el reparto de alguna
--     función viva del bolo y 'crew' si está en su equipo técnico; `[]` si en
--     ninguno, y siempre `[]` en un hilo de conversación.
--
-- El reparto de una función es la regla de `rosterPersonIds` ($lib/planner):
-- el `cast_member` vivo del proyecto menos a quien sustituye un
-- `cast_override` de esa función, más los propios `cast_override`. El equipo
-- técnico, `crew_assignment` vivo de la función.
--
-- Permisos: no cambian. Lo sigue pidiendo sólo quien lee el hilo (mismo
-- 42501 a quien no), y lo que añade es si alguien que ya ve en la línea está
-- en el reparto o la técnica de ese mismo bolo: lo que el equipo de la noche
-- ve en su hoja de ruta. Ni rol libre, ni contacto, ni dinero.
--
-- Misma firma `(text, uuid, uuid)`, copiada de producción con
-- `pg_get_functiondef` el 2026-11-04 (no de 20261014100000): CREATE OR
-- REPLACE, sin sobrecarga. El grant (`authenticated` EXECUTE) se conserva.
-- Único cambio en el cuerpo: el SELECT de `v_people`.
--
-- Gate (§ 34), antes del apply: `pg_get_functiondef` del vivo tiene que dar
-- el cuerpo de partida de esta migración (sin el SELECT nuevo); si no, se
-- rehace desde el vivo. Aditivo para el cliente (dos claves más); sin datos
-- que tocar.
--
-- Orden en producción: indiferente. El Worker de antes ignora las claves
-- nuevas; el nuevo, sin ellas, enseña sólo nombres.
--
-- Rollback: volver a crear la función con el cuerpo vivo de antes (el de
-- este fichero sin `person_id` ni `roles`).

CREATE OR REPLACE FUNCTION public.thread_audience(p_anchor_kind text, p_anchor_id uuid, p_facet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_ws     uuid;
  v_people jsonb;
  v_reason jsonb;
BEGIN
  IF v_caller IS NULL OR p_anchor_kind IS NULL OR p_anchor_kind NOT IN ('bolo', 'conversation') THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
  END IF;

  IF p_anchor_kind = 'conversation' THEN
    IF p_facet_id IS NOT NULL OR NOT private.can_read_conversation(p_anchor_id, v_caller) THEN
      RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
    END IF;
    SELECT c.workspace_id INTO v_ws FROM public.conversation c WHERE c.id = p_anchor_id;
    v_reason := jsonb_build_object('kind', 'conversation');
  ELSE
    IF NOT private.can_read_container_thread('bolo', p_anchor_id, p_facet_id, v_caller) THEN
      RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
    END IF;
    v_ws := private.thread_container_workspace('bolo', p_anchor_id);
    v_reason := CASE
      WHEN p_facet_id IS NULL THEN jsonb_build_object('kind', 'container', 'level', 'bolo')
      ELSE (
        SELECT jsonb_build_object(
          'kind', 'facet', 'facet_id', f.id, 'facet_key', f.key,
          'label', coalesce(s.label, f.label),
          'labels', f.labels || coalesce(s.labels, '{}'::jsonb))
        FROM public.facet f
        LEFT JOIN public.workspace_facet_setting s ON s.workspace_id = v_ws AND s.facet_id = f.id
        WHERE f.id = p_facet_id)
    END;
  END IF;

  WITH perf AS (
    -- Las funciones vivas del bolo; ninguna en un hilo de conversación.
    SELECT p.id, p.project_id
    FROM public.performance p
    WHERE p_anchor_kind = 'bolo' AND p.bolo_id = p_anchor_id AND p.deleted_at IS NULL
  ),
  cast_people AS (
    SELECT cm.person_id
    FROM perf
    JOIN public.cast_member cm ON cm.project_id = perf.project_id AND cm.deleted_at IS NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cast_override co
      WHERE co.performance_id = perf.id AND co.deleted_at IS NULL AND co.replaces_person_id = cm.person_id)
    UNION
    SELECT co.person_id
    FROM perf
    JOIN public.cast_override co ON co.performance_id = perf.id AND co.deleted_at IS NULL
  ),
  crew_people AS (
    SELECT ca.person_id
    FROM perf
    JOIN public.crew_assignment ca ON ca.performance_id = perf.id AND ca.deleted_at IS NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
                              'user_id', x.user_id, 'name', x.name, 'person_id', x.person_id,
                              'roles', to_jsonb(array_remove(ARRAY[
                                CASE WHEN x.person_id IN (SELECT person_id FROM cast_people) THEN 'cast' END,
                                CASE WHEN x.person_id IN (SELECT person_id FROM crew_people) THEN 'crew' END
                              ], NULL)))
                            ORDER BY x.name NULLS LAST, x.user_id), '[]'::jsonb)
  INTO v_people
  FROM (
    SELECT m.user_id, up.full_name AS name, up.person_id
    FROM public.membership m
    LEFT JOIN public.user_profile up ON up.user_id = m.user_id
    WHERE m.level = 'workspace'
      AND m.workspace_id = v_ws
      AND m.accepted_at IS NOT NULL
      AND CASE p_anchor_kind
            WHEN 'conversation' THEN private.can_read_conversation(p_anchor_id, m.user_id)
            ELSE private.can_read_container_thread('bolo', p_anchor_id, p_facet_id, m.user_id)
          END
  ) x;

  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_people),
    'reason', v_reason,
    'people', v_people
  );
END;
$function$;
