-- ADR-087 · `_tasks.md § 37`: una función puede NACER colgada de su bolo.
--
-- Hasta hoy enlazar eran dos pasos: `create_performance` y después un PATCH de
-- `bolo_id`. Entre los dos existe una ventana en la que la función ya está en
-- el calendario y el dinero todavía no la cuenta (`function_count`,
-- `next_performed_at`), y si el segundo paso falla la ventana se queda abierta.
-- Marco decidió el 2026-08-28 que el gesto primario del alta es colgar de un
-- bolo que ya existe, así que la RPC aprende `p_bolo_id`.
--
-- LA MISMA PUERTA QUE EL PATCH, NO OTRA. Enlazar por PATCH pide
-- `edit:performance` (la policy `performance_update`) y la coherencia la
-- sujeta el trigger `performance_guard_bolo` (20260828100000): bolo vivo y del
-- mismo proyecto, con UN solo mensaje para «no existe» y «no es tuyo» (42501),
-- para no ser un oráculo de existencia. La RPC ya exige `edit:performance`, y
-- el INSERT dispara ese mismo trigger, así que aquí no se repite ninguna regla:
-- una segunda comprobación en la RPC sería una segunda opinión sobre lo mismo.
-- NO se pide `edit:money` ni `read:money`: quien coloca fechas puede colgarlas
-- de su trato sin ver el caché, igual que por el PATCH.
--
-- `create_performance_series` aprende lo mismo: una tanda corta en la misma
-- sala es justo el caso de 1 bolo con N funciones (Marco, 2026-08-28), y que
-- la tanda tuviera que enlazarse día a día con N PATCH reabriría la ventana N
-- veces. Todas las filas de la tanda cuelgan del mismo bolo.
--
-- COMPATIBLE CON EL WORKER DESPLEGADO: `p_bolo_id` va al final con DEFAULT
-- NULL, y PostgREST resuelve la RPC por nombre de argumentos, así que la
-- llamada de hoy (ocho argumentos con nombre) cae en la función nueva y hace
-- exactamente lo de siempre. Lo que NO puede quedar es la firma vieja al lado:
-- con dos sobrecargas que aceptan la misma llamada, PostgREST no sabe elegir y
-- responde 300. Por eso la vieja se borra en la misma transacción.
--
-- Y de paso (advisors de producción, 2026-10-10): las funciones de trigger de
-- `public` se podían ejecutar como RPC por `anon`/`authenticated`. No es
-- explotable —una función de trigger no se puede invocar fuera de un trigger—
-- pero no tienen por qué estar expuestas. Ver § 3.

-- ── 0 · lo que se reemplaza es lo que creemos ─────────────────────────────
-- Los grants y el modo de ejecución de abajo se escriben a mano, copiados del
-- catálogo local (= checkpoint): `{postgres=X, authenticated=X}`, SECURITY
-- DEFINER, `search_path=public, pg_temp`, en las dos. Si la base donde corre
-- esto lleva otra cosa, se aborta antes de tocar nada, en vez de «conservar»
-- unos grants que no eran los suyos.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || ' acl=' || coalesce(p.proacl::text, 'NULL')
                    || ' definer=' || p.prosecdef::text
                    || ' config=' || coalesce(p.proconfig::text, 'NULL'), '; ')
    INTO v_bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('create_performance', 'create_performance_series')
    AND NOT (
      p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, pg_temp']
      AND p.proacl IS NOT NULL
      AND (SELECT array_agg(DISTINCT coalesce(r.rolname::text, 'PUBLIC') ORDER BY coalesce(r.rolname::text, 'PUBLIC'))
             FROM aclexplode(p.proacl) a
             LEFT JOIN pg_roles r ON r.oid = a.grantee
            WHERE a.privilege_type = 'EXECUTE')
          = ARRAY['authenticated', 'postgres']::text[]
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'create_performance* is not what this migration expects to replace: %', v_bad;
  END IF;
END;
$$;

-- ── 1 · fuera las firmas viejas, POR NOMBRE ───────────────────────────────
-- `DROP FUNCTION IF EXISTS f(firma)` quita UNA sobrecarga y calla si no
-- encuentra nada (lo que tumbó el primer apply de 20260731120000). Se pregunta
-- al catálogo: si producción lleva una sobrecarga que el checkpoint no
-- registra, se va con las demás y queda exactamente una de cada.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_performance', 'create_performance_series')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

-- ── 2 · las dos RPC, con `p_bolo_id` al final ─────────────────────────────
-- El cuerpo es el de siempre (checkpoint y 20260829100000) más `bolo_id` en el
-- INSERT. El trigger `performance_guard_bolo` rechaza un bolo ajeno o
-- inexistente con 42501, que el bucle de slug no captura (solo captura
-- unique_violation): sube tal cual, y la API lo da como 403.
CREATE FUNCTION public.create_performance(
  p_project_id uuid,
  p_performed_at date,
  p_venue_name text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_status public.performance_status DEFAULT 'proposed'::public.performance_status,
  p_conversation_id uuid DEFAULT NULL::uuid,
  p_line_id uuid DEFAULT NULL::uuid,
  p_bolo_id uuid DEFAULT NULL::uuid
)
RETURNS public.performance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_base_slug    text;
  v_slug         text;
  v_perf         public.performance;
  v_try          int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_performed_at IS NULL THEN
    RAISE EXCEPTION 'performed_at cannot be null' USING ERRCODE = '22023';
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

  v_base_slug := public.slugify(
    coalesce(NULLIF(trim(p_venue_name), ''), NULLIF(trim(p_city), ''), 'gig')
  ) || '-' || to_char(p_performed_at, 'YYYY-MM-DD');
  v_slug := v_base_slug;

  LOOP
    BEGIN
      INSERT INTO public.performance (
        workspace_id, project_id, line_id, conversation_id, bolo_id,
        performed_at, status, venue_name, city, country, slug, created_by
      ) VALUES (
        v_workspace_id, p_project_id, p_line_id, p_conversation_id, p_bolo_id,
        p_performed_at, p_status,
        NULLIF(trim(p_venue_name), ''),
        NULLIF(trim(p_city), ''),
        NULLIF(upper(trim(p_country)), ''),
        v_slug, v_caller
      )
      RETURNING * INTO v_perf;
      RETURN v_perf;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 20 THEN RAISE; END IF;
      v_slug := v_base_slug || '-' || (v_try + 1)::text;
    END;
  END LOOP;
END;
$function$;

CREATE FUNCTION public.create_performance_series(
  p_project_id uuid,
  p_performed_at date[],
  p_venue_name text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_country text DEFAULT NULL::text,
  p_status public.performance_status DEFAULT 'proposed'::public.performance_status,
  p_conversation_id uuid DEFAULT NULL::uuid,
  p_line_id uuid DEFAULT NULL::uuid,
  p_bolo_id uuid DEFAULT NULL::uuid
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
          workspace_id, project_id, line_id, conversation_id, bolo_id,
          performed_at, status, venue_name, city, country,
          slug, series_id, created_by
        ) VALUES (
          v_workspace_id, p_project_id, p_line_id, p_conversation_id, p_bolo_id,
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

-- Los mismos grants que tenían (ver § 0): solo `authenticated` y el dueño.
ALTER FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid, uuid
) TO authenticated;

ALTER FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid, uuid
) TO authenticated;

COMMENT ON FUNCTION public.create_performance(
  uuid, date, text, text, text, public.performance_status, uuid, uuid, uuid
) IS 'ADR-043/087: create one performance, gated on edit:performance. p_bolo_id hangs it from its deal at birth; performance_guard_bolo enforces live bolo of the same project (42501, one message for missing and foreign).';
COMMENT ON FUNCTION public.create_performance_series(
  uuid, date[], text, text, text, public.performance_status, uuid, uuid, uuid
) IS 'ADR-084 §1/087: N rows of one multi-day run, atomically. p_bolo_id hangs every row from the same deal; performance_guard_bolo enforces the same project.';

-- ── 3 · las funciones de trigger no son RPC ───────────────────────────────
-- Toda función de `public` que devuelve `trigger` aparece en /rest/v1/rpc, y
-- varias llevaban EXECUTE para PUBLIC, `anon` y `authenticated` (por los
-- default privileges, o por un ACL vacío, que significa PUBLIC). Postgres no
-- comprueba EXECUTE al disparar un trigger, solo al crearlo, así que quitarlo
-- no cambia nada de lo que hacen. Por catálogo y no por lista, para que una
-- que solo tenga producción salga igual. A `service_role` no se le quita su grant explícito si lo tiene (con un ACL vacío pierde el implícito de PUBLIC, y da igual: tampoco es una RPC).
-- En local (2026-10-10) son ocho: guard_immutable_author, _created_by,
-- _note_anchor, _task_parents, _workspace_id, guard_performance_bolo_same_project,
-- maintain_conversation_contact_timestamps y set_updated_at.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END;
$$;

-- Y se comprueba en el catálogo, que es el único sitio donde se ve: PostgREST
-- nunca publica una función de trigger (responde 404 con o sin el grant,
-- comprobado en local antes y después), así que ningún test por HTTP distingue
-- el grant. Si queda alguna ejecutable por `anon` o `authenticated`, por grant
-- directo o heredado de PUBLIC, la migración entera revierte.
DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(oid::regprocedure::text, ', ') INTO v_left
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND prorettype = 'trigger'::regtype
    AND (has_function_privilege('anon', oid, 'EXECUTE')
         OR has_function_privilege('authenticated', oid, 'EXECUTE'));
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'trigger functions still executable by anon/authenticated: %', v_left;
  END IF;
END;
$$;
