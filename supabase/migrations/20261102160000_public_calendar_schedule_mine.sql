-- 71b y 90 · El calendario suscrito: escaleta, tramos e idioma (71b, lo que
-- ADR-162 § 4 y «Pide migración» dejaron escrito) y «solo lo mío» con las
-- opciones como TENTATIVE (90). Una sola redefinición de `get_public_calendar`.
--
-- Firmas y cuerpos de partida: `pg_get_functiondef` de producción, 2026-11-01:
-- `get_public_calendar(text)` (CREATE OR REPLACE, misma firma; grants vivos
-- anon y authenticated, no cambian) y `create_calendar_share(uuid)` (se
-- redefine con un parámetro más: DROP de la firma vieja y CREATE en esta misma
-- migración, para no dejar una sobrecarga; grants vivos: authenticated sí,
-- anon y service_role no). Ninguna de las dos tiene comentario en la base.
-- `list_calendar_shares` devuelve `SETOF calendar_share`: la columna nueva
-- sale sola, sin tocarla. En producción, el 2026-11-01, hay 0 enlaces vivos.
--
-- 1. `calendar_share.scope`: 'all' (la compañía entera, lo de siempre) o
--    'mine' (solo lo de quien creó el enlace). DEFAULT 'all': los enlaces que
--    existan no cambian.
-- 2. `create_calendar_share(p_workspace_id, p_scope DEFAULT 'all')`. «Lo mío»
--    pide que quien llama sea una persona (`user_profile.person_id`): sin
--    ella no hay nada suyo que enseñar (22023).
-- 3. `private.person_is_on_performance`: la regla de «lo mío» de ADR-151 en
--    SQL. Está en una función si está en su reparto (el del proyecto que un
--    cambio de la función no sustituye, más los cambios y el equipo técnico:
--    `rosterPersonIds` en $lib/planner) o dijo «voy». En una fecha, solo si
--    dijo «voy» (las fechas no tienen reparto). Nadie se adivina (ADR-147).
-- 4. `get_public_calendar`:
--    · Las opciones (`hold`, `hold_1..3`) entran con su `status`; el feed las
--      marca TENTATIVE y «· opción» (`$lib/ics`). `proposed` y `cancelled` no.
--    · `schedule` por función: la escaleta entera (`kind`, `label`, `at`,
--      `ends_at`, en su orden), sin notas. `$lib/ics` ya la prefiere.
--    · `stages` por fecha de viaje: los tramos en su orden, con modo,
--      extremos y horas. Sin `reference` (el localizador sirve para tocar
--      una reserva y un feed suscrito no caduca) ni `notes`.
--    · `workspace.trade`: el oficio del espacio, para no depender del
--      `&trade=` del enlace. El espacio no tiene idioma propio
--      (`workspace` no lleva columna de idioma): el idioma sigue en el enlace
--      (`?lang=`, ADR-162 § 2).
--    · Con `scope = 'mine'`, solo las filas de la persona de quien creó el
--      enlace; si ya no tiene persona, nada.
--
-- ADITIVA según § 34: una columna con DEFAULT, una función interna nueva,
-- `create_calendar_share` con un parámetro opcional más (las llamadas de hoy,
-- por nombre, siguen resolviendo) y claves nuevas en el JSON del feed. Ojo de
-- orden: las opciones entran en el feed con la migración; el Worker que las
-- marca TENTATIVE es el de esta rama. Con 0 enlaces vivos, el orden no cambia
-- nada hoy.
--
-- Rollback:
--   volver a aplicar el cuerpo de get_public_calendar de arriba (producción 2026-11-01);
--   DROP FUNCTION public.create_calendar_share(uuid, text); y recrear la de (uuid);
--   DROP FUNCTION private.person_is_on_performance(uuid, uuid);
--   ALTER TABLE public.calendar_share DROP COLUMN scope;

-- ── 1 · scope ────────────────────────────────────────────────────────────
ALTER TABLE public.calendar_share
  ADD COLUMN scope text NOT NULL DEFAULT 'all',
  ADD CONSTRAINT calendar_share_scope_check CHECK (scope IN ('all', 'mine'));
COMMENT ON COLUMN public.calendar_share.scope IS
  '90: all = el calendario de la compañía; mine = solo las funciones y fechas de la persona de created_by (reparto o «voy», ADR-151).';

-- ── 2 · create_calendar_share ────────────────────────────────────────────
DROP FUNCTION public.create_calendar_share(uuid);

CREATE FUNCTION public.create_calendar_share(p_workspace_id uuid, p_scope text DEFAULT 'all'::text)
 RETURNS calendar_share
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_share public.calendar_share;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT private.model_has_workspace_role(p_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'a write role is required to publish a calendar feed'
      USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('all', 'mine') THEN
    RAISE EXCEPTION 'scope must be all or mine' USING ERRCODE = '22023';
  END IF;
  -- 90: «lo mío» es de una persona; una cuenta sin persona no tiene nada suyo.
  IF p_scope = 'mine' AND NOT EXISTS (
    SELECT 1 FROM public.user_profile up WHERE up.user_id = v_caller AND up.person_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a personal feed needs the caller to be a person' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.calendar_share (token, workspace_id, created_by, scope)
  VALUES (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_workspace_id, v_caller, p_scope
  )
  RETURNING * INTO v_share;
  RETURN v_share;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_calendar_share(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_calendar_share(uuid, text) TO authenticated;

-- ── 3 · person_is_on_performance ─────────────────────────────────────────
CREATE FUNCTION private.person_is_on_performance(p_performance_id uuid, p_person_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_person_id IS NOT NULL AND (
    -- Reparto del proyecto que ningún cambio de esta función sustituye.
    EXISTS (
      SELECT 1 FROM public.performance p
      JOIN public.cast_member cm ON cm.project_id = p.project_id AND cm.deleted_at IS NULL
      WHERE p.id = p_performance_id AND cm.person_id = p_person_id
        AND NOT EXISTS (
          SELECT 1 FROM public.cast_override co
          WHERE co.performance_id = p.id AND co.deleted_at IS NULL
            AND co.replaces_person_id = p_person_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.cast_override co
      WHERE co.performance_id = p_performance_id AND co.deleted_at IS NULL AND co.person_id = p_person_id
    )
    OR EXISTS (
      SELECT 1 FROM public.crew_assignment cr
      WHERE cr.performance_id = p_performance_id AND cr.deleted_at IS NULL AND cr.person_id = p_person_id
    )
    OR EXISTS (
      SELECT 1 FROM public.commitment_person c
      WHERE c.performance_id = p_performance_id AND c.person_id = p_person_id AND c.state = 'going'
    )
  );
$function$;
COMMENT ON FUNCTION private.person_is_on_performance(uuid, uuid) IS
  '90: la persona está en la función por reparto (rosterPersonIds) o por su «voy» (ADR-151, «lo mío»).';
REVOKE ALL ON FUNCTION private.person_is_on_performance(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 4 · get_public_calendar ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_calendar(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share public.calendar_share;
  v_person uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.calendar_share
  WHERE token = p_token AND revoked_at IS NULL;
  IF v_share.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A soft-deleted workspace kills its feeds too.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace w
    WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- 90: «lo mío» es de la persona de quien creó el enlace.
  IF v_share.scope = 'mine' THEN
    SELECT up.person_id INTO v_person
    FROM public.user_profile up WHERE up.user_id = v_share.created_by;
  END IF;

  SELECT jsonb_build_object(
    'workspace', (SELECT jsonb_build_object('name', w.name, 'slug', w.slug, 'timezone', w.timezone,
                                            'trade', w.trade)
                  FROM public.workspace w
                  WHERE w.id = v_share.workspace_id AND w.deleted_at IS NULL),
    'scope', v_share.scope,
    'performances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'performed_at', p.performed_at,
        'status', p.status, 'venue_name', p.venue_name, 'city', p.city,
        'country', p.country,
        'updated_at', p.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = p.project_id),
        'venue', (SELECT jsonb_build_object(
                    'name', vn.name, 'city', vn.city, 'country', vn.country,
                    'address', vn.address, 'timezone', vn.timezone)
                  FROM public.venue vn WHERE vn.id = p.venue_id AND vn.deleted_at IS NULL)
      ) || private.performance_timeslots(p.id)
        -- 71b: la escaleta entera, en su orden, sin notas.
        || jsonb_build_object('schedule', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'label', s.label, 'at', s.at, 'ends_at', s.ends_at)
               ORDER BY s.sort)
             FROM public.schedule_slot s
             WHERE s.performance_id = p.id), '[]'::jsonb))
        ORDER BY p.performed_at)
      FROM public.performance p
      WHERE p.workspace_id = v_share.workspace_id
        AND p.deleted_at IS NULL
        -- 90: las opciones también, como TENTATIVE en el feed.
        AND p.status IN ('hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed', 'done', 'invoiced', 'paid')
        AND (v_share.scope = 'all' OR private.person_is_on_performance(p.id, v_person))), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'status', d.status, 'title', d.title,
        'starts_at', d.starts_at, 'ends_at', d.ends_at, 'all_day', d.all_day,
        'venue_name', d.venue_name, 'city', d.city, 'updated_at', d.updated_at,
        'project', (SELECT jsonb_build_object('name', pr.name)
                    FROM public.project pr WHERE pr.id = d.project_id),
        -- 71b: los tramos de un viaje, en su orden; sin localizador ni notas.
        'stages', CASE WHEN d.kind = 'travel_day' THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'mode', ts.mode, 'from_city', ts.from_city, 'from_place', ts.from_place,
              'to_city', ts.to_city, 'to_place', ts.to_place,
              'depart_at', ts.depart_at, 'arrive_at', ts.arrive_at,
              'depart_tz', ts.depart_tz, 'arrive_tz', ts.arrive_tz)
              ORDER BY ts.position)
            FROM public.travel_stage ts
            WHERE ts.date_id = d.id), '[]'::jsonb) ELSE '[]'::jsonb END
      ) ORDER BY d.starts_at)
      FROM public.date d
      WHERE d.workspace_id = v_share.workspace_id
        AND d.deleted_at IS NULL
        AND d.status <> 'cancelled'
        AND (v_share.scope = 'all' OR (v_person IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.commitment_person c
          WHERE c.date_id = d.id AND c.person_id = v_person AND c.state = 'going')))), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.get_public_calendar(text) OWNER TO postgres;
