-- ADR-087 — un trato tiene vida: nace donde está y se mueve.
--
-- EL AGUJERO, encontrado el 2026-08-29 mirando datos de demo: `create_bolo`
-- lleva `p_status DEFAULT 'confirmed'` y `POST /api/money/bolos` **no lo pasa**,
-- así que **todo bolo creado desde Hour nace confirmado**. Y no hay vuelta
-- atrás: `bolo` no tiene policy de UPDATE y la única RPC que lo escribe es
-- `update_bolo_fee`, o sea que el estado se fija al nacer y no cambia nunca.
-- El embudo —propuesto → en opción → cerrado— existía en el enum y en ningún
-- otro sitio.
--
-- LO QUE UN HUMANO PUEDE DECIR, Y LO QUE NO. `bolo.status` comparte enum con
-- `performance`, y ahí dentro hay dos palabras que NO son suyas: `invoiced` y
-- `paid`. Verificado contra el catálogo antes de escribir esto — ninguna
-- función escribe esos dos valores en un bolo, porque money v3 deriva lo
-- cobrado de los pagos contra el caché (ADR-087) y no de esta columna. Dejar
-- que alguien los escriba a mano sería crear un segundo sitio donde vive la
-- verdad del dinero, que es exactamente lo que ese modelo evita.
--
--   nacer  → proposed · hold · hold_1..3 · confirmed
--   mover  → los anteriores + cancelled + done
--
-- `cancelled` y `done` no son estados de nacimiento: un trato no se abre
-- muerto ni acabado. Y ninguno de los dos caminos admite `invoiced`/`paid`.

-- ── 1 · nacer donde toca ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bolo_status_can_open(p_status public.performance_status)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_status IN ('proposed', 'hold', 'hold_1', 'hold_2', 'hold_3', 'confirmed');
$function$;

CREATE OR REPLACE FUNCTION public.bolo_status_can_move(p_status public.performance_status)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.bolo_status_can_open(p_status) OR p_status IN ('cancelled', 'done');
$function$;

ALTER FUNCTION public.bolo_status_can_open(public.performance_status) OWNER TO postgres;
ALTER FUNCTION public.bolo_status_can_move(public.performance_status) OWNER TO postgres;

-- ── 2 · `create_bolo` valida dónde puede nacer ────────────────────────────
CREATE OR REPLACE FUNCTION public.create_bolo(p_project_id uuid, p_venue_name text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_fee_amount numeric DEFAULT NULL::numeric, p_fee_currency text DEFAULT 'EUR'::text, p_line_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid, p_status performance_status DEFAULT 'confirmed'::performance_status)
 RETURNS bolo
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_currency     text := upper(coalesce(nullif(btrim(p_fee_currency), ''), 'EUR'));
  v_country      text := upper(nullif(btrim(p_country), ''));
  v_bolo         public.bolo;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;

  -- Un trato no se abre muerto, ni acabado, ni facturado: ver la cabecera de
  -- 20260829140000. Hasta hoy `p_status` aceptaba cualquier palabra del enum,
  -- y la API ni siquiera lo pasaba.
  IF NOT public.bolo_status_can_open(coalesce(p_status, 'confirmed')) THEN
    RAISE EXCEPTION 'a bolo opens as proposed, hold, hold_1..3 or confirmed'
      USING ERRCODE = '22023';
  END IF;

  IF v_workspace_id IS NULL OR NOT public.has_permission(p_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'project not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line
    WHERE id = p_line_id AND project_id = p_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line is not in the project' USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = p_conversation_id AND workspace_id = v_workspace_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation is not in the workspace' USING ERRCODE = '42501';
  END IF;

  IF p_fee_amount IS NOT NULL AND (p_fee_amount < 0 OR p_fee_amount > 9999999999.99) THEN
    RAISE EXCEPTION 'fee amount out of range' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'fee currency must be an ISO 4217 code' USING ERRCODE = '22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be a 2-letter code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bolo (
    workspace_id, project_id, line_id, conversation_id,
    venue_name, city, country, fee_amount, fee_currency, status, created_by
  ) VALUES (
    v_workspace_id, p_project_id, p_line_id, p_conversation_id,
    nullif(btrim(coalesce(p_venue_name, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    v_country,
    p_fee_amount,
    v_currency::character(3),
    coalesce(p_status, 'confirmed'),
    v_caller
  ) RETURNING * INTO v_bolo;

  RETURN v_bolo;
END;
$function$;

-- ── 3 · y ahora se puede MOVER ────────────────────────────────────────────
-- Molde calcado de `update_bolo_fee`: misma puerta (`edit:money` sobre el
-- proyecto del trato), mismo 42501 que junta «no existe» y «no es tuyo» para
-- no ser un oráculo, y mismo RETURNING para que el llamador vea lo que quedó.
CREATE OR REPLACE FUNCTION public.update_bolo_status(
  p_bolo_id uuid,
  p_status public.performance_status
)
RETURNS TABLE(id uuid, status public.performance_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT b.project_id INTO v_project_id
  FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'bolo not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR NOT public.bolo_status_can_move(p_status) THEN
    RAISE EXCEPTION 'invoiced and paid are derived from payments, not set by hand'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.bolo b
  SET status = p_status,
      updated_at = now()
  WHERE b.id = p_bolo_id AND b.deleted_at IS NULL
  RETURNING b.id, b.status;
END;
$function$;

ALTER FUNCTION public.update_bolo_status(uuid, public.performance_status) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_bolo_status(uuid, public.performance_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_bolo_status(uuid, public.performance_status) TO authenticated;
