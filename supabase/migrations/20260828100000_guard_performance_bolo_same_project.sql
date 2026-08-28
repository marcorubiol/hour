-- ADR-087 — una función solo puede colgar de un bolo de su propio proyecto.
--
-- `performance.bolo_id` es la costura entre el calendario y el dinero: el bolo
-- es la unidad de dinero y agrupa 1..N funciones, así que `function_count`,
-- `next_performed_at` y lo que Books llama «vendido» se derivan de quién apunta
-- a quién. Lo único que sujetaba esa costura era
-- `performance_bolo_id_fkey → bolo(id)`, que solo exige que el bolo EXISTA.
--
-- Encontrado el 2026-08-28, al ir a exponer `bolo_id` en el PATCH de la API:
--   · `authenticated` ya tiene GRANT UPDATE sobre TODAS las columnas de
--     `performance`, `bolo_id` incluida — no hay grant por columna. La única
--     puerta es la policy `performance_update`, o sea `edit:performance`.
--   · Nada comprueba el proyecto. Una función podía colgar de un bolo de otro
--     proyecto, y —con el UUID en la mano— de OTRO ESPACIO: el
--     `function_count` y el `next_performed_at` de un tercero se movían sin que
--     nadie tocara una fila suya.
-- O sea que la capacidad ya existía por PostgREST; lo que faltaba era la regla.
--
-- VERIFICADO CONTRA PRODUCCIÓN antes de escribir esto, no deducido de la base
-- local: un PATCH de `bolo_id` con `Prefer: return=minimal` responde **204**, y
-- el enlace a un bolo de OTRO proyecto se aceptaba. Con
-- `return=representation` responde 403, pero por otra razón — `20260720172431`
-- sacó las columnas de dinero (`bolo_id` incluida) del GRANT de SELECT, así que
-- devolver la fila entera pide una lectura que nadie tiene. Las dos cosas
-- juntas son la trampa: **el agujero parecía cerrado desde fuera y no lo
-- estaba**, y un test escrito con el helper de siempre salía verde por el grant
-- de lectura en vez de por la regla. `tests/rls/performance-bolo.test.ts` lo
-- cuenta donde se puede tropezar con ello.
--
-- Y hoy los dos rechazos NO son iguales: un bolo inexistente da 409 (la FK) y
-- uno de otro proyecto daba 204. Después de esto, los dos dan 403.
-- Esto no estrecha ningún permiso: `edit:performance` sigue siendo la puerta,
-- que es lo que hace falta para que quien coloca fechas pueda colgarlas de su
-- trato sin ver el caché.
--
-- SECURITY DEFINER a propósito: `bolo_select` exige `read:money`, así que una
-- guarda normal no vería el bolo y rechazaría enlaces legítimos de quien
-- coloca fechas y no lee dinero. Lee UNA columna, `project_id`, y no la
-- devuelve. **Un solo mensaje para «no existe» y «no es tuyo»**, para no
-- convertirla en un oráculo de existencia de UUIDs ajenos — la misma lección
-- que `20260725100000_unexpose_project_id_helpers`.

CREATE OR REPLACE FUNCTION public.guard_performance_bolo_same_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  bolo_project uuid;
BEGIN
  IF NEW.bolo_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.project_id INTO bolo_project
    FROM public.bolo b
   WHERE b.id = NEW.bolo_id AND b.deleted_at IS NULL;

  IF bolo_project IS NULL OR bolo_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'bolo_id must reference a live bolo of the same project'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_performance_bolo_same_project() OWNER TO postgres;

-- Se dispara también cuando se mueve `project_id`, porque mover la función de
-- proyecto sin soltar el bolo deja la misma incoherencia por el otro lado.
DROP TRIGGER IF EXISTS performance_guard_bolo ON public.performance;
CREATE TRIGGER performance_guard_bolo
  BEFORE INSERT OR UPDATE OF bolo_id, project_id ON public.performance
  FOR EACH ROW EXECUTE FUNCTION public.guard_performance_bolo_same_project();

COMMENT ON FUNCTION public.guard_performance_bolo_same_project() IS
  'ADR-087: a performance may only hang from a live bolo of its own project. DEFINER because bolo_select demands read:money and placing dates does not.';
