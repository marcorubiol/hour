-- ADR-084 §1 — una función puede durar varios días. Simétrico a `date`.
--
-- Hasta hoy `performance.performed_at` era UN día, así que una residencia de
-- tres noches eran tres filas que no sabían que eran la misma cosa. El molde ya
-- existía y llevaba meses funcionando —`date.series_id` +
-- `create_date_series`—, así que esto es calcarlo, no inventarlo.
--
-- POR QUÉ FILAS POR DÍA Y NO UN RANGO, dicho en `MonthGrid` y repetido aquí
-- porque es la razón de la forma: la banda es un DIBUJO de las filas, y qué día
-- es un borde se deriva en cada pintada. Confirmar un solo día de una tanda lo
-- muestra como lo que es, dentro de la banda, sin un span guardado que se
-- desincronice de los días que dice cubrir.
--
-- LA LEY QUE NO SE PUEDE ROMPER (Marco, 2026-07-20, ya escrita para `date`):
-- dos funciones DISTINTAS el mismo día no se colapsan nunca — los dos nombres
-- tienen que poder leerse. Colapsar es solo para sesiones de UNA misma serie.
--
-- EXPOSICIÓN CONOCIDA, y se deja igual que en `date` a propósito: la columna
-- hereda el GRANT de UPDATE de la tabla, así que se puede escribir un
-- `series_id` a mano y agrupar dos funciones que no van juntas. No cruza
-- tenants —el feed ya está filtrado por RLS y scope, así que como mucho
-- agrupas mal lo tuyo— y `date` tiene exactamente la misma forma desde el
-- principio. Si algún día se guarda, se guardan las dos; una asimetría aquí
-- sería peor que la exposición.

ALTER TABLE public.performance
  ADD COLUMN IF NOT EXISTS series_id uuid;

COMMENT ON COLUMN public.performance.series_id IS
  'ADR-084 §1: N rows of one multi-day run share it. The band is derived, never stored. Same shape as date.series_id.';

-- Parcial y calcado del de `date`: solo interesa lo vivo y lo que es serie.
CREATE INDEX IF NOT EXISTS performance_series_idx
  ON public.performance USING btree (series_id)
  WHERE (deleted_at IS NULL AND series_id IS NOT NULL);

-- ── La RPC, atómica ───────────────────────────────────────────────────────
-- Calcada de `create_date_series`, con las validaciones de `create_performance`
-- —incluido su bucle de slug, que aquí va POR FILA porque cada día genera el
-- suyo (`sala-2026-09-18`, `sala-2026-09-19`) y dos funciones el mismo día en
-- la misma sala sí chocarían.
--
-- El estado NO se restringe, a diferencia de `create_date_series` (que exige
-- tentative|confirmed): `create_performance` no lo restringe y esto es su
-- hermano. Inventar aquí una regla que su gemelo de una sola fila no tiene
-- sería una segunda opinión sobre lo mismo, que es justo lo que ADR-095 §0
-- cobra caro.
CREATE OR REPLACE FUNCTION public.create_performance_series(
  p_project_id uuid,
  p_performed_at date[],
  p_venue_name text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_status public.performance_status DEFAULT 'proposed'::public.performance_status,
  p_conversation_id uuid DEFAULT NULL::uuid,
  p_line_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF public.performance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_series       uuid := uuid_generate_v7();
  v_n            int;
  v_day          date;
  v_base_slug    text;
  v_slug         text;
  v_try          int;
  v_perf         public.performance;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  v_n := coalesce(array_length(p_performed_at, 1), 0);

  IF v_n < 2 THEN
    RAISE EXCEPTION 'a series needs at least 2 rows — use create_performance for one'
      USING ERRCODE = '22023';
  END IF;

  IF v_n > 92 THEN
    RAISE EXCEPTION 'a series is capped at 92 rows' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_performed_at) d WHERE d IS NULL) THEN
    RAISE EXCEPTION 'performed_at cannot be null' USING ERRCODE = '22023';
  END IF;

  -- Un mismo día dos veces no es una tanda, es un error de quien llama: la
  -- serie es «la misma cosa a lo largo de días», uno por día.
  IF (SELECT count(DISTINCT d) FROM unnest(p_performed_at) d) <> v_n THEN
    RAISE EXCEPTION 'a series cannot repeat a day' USING ERRCODE = '22023';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:performance') THEN
    RAISE EXCEPTION 'edit:performance required to create a performance'
      USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation does not belong to project' USING ERRCODE = '22023';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line does not belong to project' USING ERRCODE = '22023';
  END IF;

  FOR v_day IN
    SELECT d FROM unnest(p_performed_at) AS d ORDER BY d
  LOOP
    v_base_slug := public.slugify(
      coalesce(NULLIF(trim(p_venue_name), ''), NULLIF(trim(p_city), ''), 'gig')
    ) || '-' || to_char(v_day, 'YYYY-MM-DD');
    v_slug := v_base_slug;
    v_try := 0;

    LOOP
      BEGIN
        INSERT INTO public.performance (
          workspace_id, project_id, line_id, conversation_id,
          performed_at, status, venue_name, city, country,
          slug, series_id, created_by
        ) VALUES (
          v_workspace_id, p_project_id, p_line_id, p_conversation_id,
          v_day, p_status,
          NULLIF(trim(p_venue_name), ''),
          NULLIF(trim(p_city), ''),
          NULLIF(upper(trim(p_country)), ''),
          v_slug, v_series, v_caller
        )
        RETURNING * INTO v_perf;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_try := v_try + 1;
        IF v_try > 20 THEN RAISE; END IF;
        v_slug := v_base_slug || '-' || (v_try + 1)::text;
      END;
    END LOOP;

    RETURN NEXT v_perf;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid
) TO authenticated;
