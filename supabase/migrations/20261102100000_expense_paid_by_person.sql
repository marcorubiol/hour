-- 79 · Gastos adelantados: quién lo pagó (una persona, no un login) y cuándo
-- se le devolvió (`_tasks.md` § AHORA, ADR-168 «Lo que no entra»).
--
-- `expense.paid_by_user_id` solo nombra a quien tiene login, y quien adelanta
-- gastos en gira (gasolina, dietas) es casi siempre alguien del equipo sin
-- login: un `person`. «Se debe al equipo» por persona necesita:
--
--   1. `expense.paid_by_person_id` → `person(id)` ON DELETE SET NULL, y
--      `expense.reimbursed_on` (la fecha en que se devolvió; solo con
--      `reimbursed`). Índice parcial para «se debe a X».
--   2. Relleno desde `user_profile.person_id` donde `paid_by_user_id` tenga
--      persona con dossier en el espacio del gasto. En producción, el
--      2026-11-01, 0 de 170 gastos tienen `paid_by_user_id`: no mueve nada.
--   3. `private.guard_expense_paid_by_person`: la persona tiene que tener
--      dossier vivo (`workspace_person`) en el espacio del gasto (23514). Solo
--      cuando cambia: borrar el dossier después no bloquea editar el gasto.
--      Cubre también el PATCH directo (la policy `expense_update` deja a
--      `edit:money` escribir la fila).
--   4. `create_expense` gana `p_paid_by_person_id DEFAULT NULL` al final. DROP
--      de la firma vieja y CREATE en esta misma migración (otra firma al lado
--      sería una sobrecarga: PostgREST respondería 300). Firma y cuerpo de
--      partida: `pg_get_functiondef` de producción, 2026-11-01 (sin comentario
--      en la base; grants vivos: authenticated sí, anon y service_role no).
--   5. `set_expense_reimbursed(p_expense_id, p_reimbursed, p_on)`: marca o
--      desmarca devuelto con su fecha. `edit:money` sobre el proyecto del
--      gasto (`private.project_id_of_expense`), 42501 igual para «no existe»
--      y «no puedes», como `delete_expense`.
--
-- Funciones existentes que se llaman (producción, 2026-11-01):
-- `public.has_permission(uuid, text)`, `private.project_id_of_expense(uuid)`.
-- `expense` tiene grant de tabla entera a `authenticated`: las columnas nuevas
-- no piden grant por columnas.
--
-- ADITIVA según § 34: dos columnas nulas, un índice, un guard, una RPC nueva y
-- `create_expense` redefinida con un parámetro opcional al final (las llamadas
-- de hoy, por nombre, siguen resolviendo). Contract posterior: DROP
-- `paid_by_user_id` cuando nada lo lea.
--
-- Rollback:
--   DROP FUNCTION public.set_expense_reimbursed(uuid, boolean, date);
--   DROP FUNCTION public.create_expense(uuid, uuid, expense_category, text, numeric, text, date, text, text, uuid);
--   -- y recrear la de 9 parámetros con el cuerpo de abajo sin p_paid_by_person_id
--   DROP TRIGGER expense_guard_paid_by_person ON public.expense;
--   DROP FUNCTION private.guard_expense_paid_by_person();
--   ALTER TABLE public.expense DROP COLUMN reimbursed_on, DROP COLUMN paid_by_person_id;

-- ── 1 · columnas ─────────────────────────────────────────────────────────
ALTER TABLE public.expense
  ADD COLUMN paid_by_person_id uuid REFERENCES public.person (id) ON DELETE SET NULL,
  ADD COLUMN reimbursed_on date,
  ADD CONSTRAINT expense_reimbursed_on_needs_reimbursed
    CHECK (reimbursed_on IS NULL OR reimbursed);

COMMENT ON COLUMN public.expense.paid_by_person_id IS
  '79: la persona que adelantó el gasto (con o sin login). Dossier vivo en el espacio del gasto al escribirla (guard_expense_paid_by_person). NULL = lo pagó la compañía.';
COMMENT ON COLUMN public.expense.reimbursed_on IS
  '79: el día en que se le devolvió a paid_by_person_id. Solo con reimbursed = true; se escribe con set_expense_reimbursed.';

CREATE INDEX expense_paid_by_person_idx ON public.expense (paid_by_person_id)
  WHERE deleted_at IS NULL AND paid_by_person_id IS NOT NULL;

-- ── 2 · relleno ──────────────────────────────────────────────────────────
UPDATE public.expense e
SET paid_by_person_id = up.person_id
FROM public.user_profile up
WHERE up.user_id = e.paid_by_user_id
  AND up.person_id IS NOT NULL
  AND e.paid_by_person_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = e.workspace_id AND wp.person_id = up.person_id
      AND wp.deleted_at IS NULL
  );

-- ── 3 · guard ────────────────────────────────────────────────────────────
CREATE FUNCTION private.guard_expense_paid_by_person()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.paid_by_person_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.paid_by_person_id IS NOT DISTINCT FROM OLD.paid_by_person_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = NEW.workspace_id
      AND wp.person_id = NEW.paid_by_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'paid_by_person_id must have a live dossier in the expense workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION private.guard_expense_paid_by_person() IS
  '79: quien adelantó un gasto tiene dossier vivo en el espacio del gasto. Solo cuando la columna cambia.';
REVOKE ALL ON FUNCTION private.guard_expense_paid_by_person() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER expense_guard_paid_by_person
  BEFORE INSERT OR UPDATE OF paid_by_person_id, workspace_id ON public.expense
  FOR EACH ROW EXECUTE FUNCTION private.guard_expense_paid_by_person();

-- ── 4 · create_expense ───────────────────────────────────────────────────
DROP FUNCTION public.create_expense(uuid, uuid, expense_category, text, numeric, text, date, text, text);

CREATE FUNCTION public.create_expense(p_bolo_id uuid DEFAULT NULL::uuid, p_line_id uuid DEFAULT NULL::uuid, p_category expense_category DEFAULT 'other'::expense_category, p_description text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_currency text DEFAULT 'EUR'::text, p_incurred_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_counterparty text DEFAULT NULL::text, p_paid_by_person_id uuid DEFAULT NULL::uuid)
 RETURNS expense
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_project_id   uuid;
  v_description  text := nullif(btrim(coalesce(p_description, '')), '');
  v_currency     text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_expense      public.expense;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_bolo_id, p_line_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of bolo_id or line_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'description cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency must be a 3-letter code' USING ERRCODE = '22023';
  END IF;

  IF p_bolo_id IS NOT NULL THEN
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.bolo WHERE id = p_bolo_id AND deleted_at IS NULL;
  ELSE
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
  END IF;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'parent not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required to record an expense' USING ERRCODE = '42501';
  END IF;

  -- 79: la persona sin dossier en el espacio la rechaza el guard (23514).
  INSERT INTO public.expense (
    workspace_id, bolo_id, line_id, category, description, amount,
    currency, incurred_on, notes, counterparty, created_by, paid_by_person_id
  ) VALUES (
    v_workspace_id, p_bolo_id, p_line_id, p_category, v_description,
    round(p_amount, 2), v_currency,
    coalesce(p_incurred_on, CURRENT_DATE),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_counterparty, '')), ''),
    v_caller,
    p_paid_by_person_id
  ) RETURNING * INTO v_expense;

  RETURN v_expense;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, expense_category, text, numeric, text, date, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, expense_category, text, numeric, text, date, text, text, uuid) TO authenticated;

-- ── 5 · set_expense_reimbursed ───────────────────────────────────────────
CREATE FUNCTION public.set_expense_reimbursed(
  p_expense_id uuid,
  p_reimbursed boolean,
  p_on         date DEFAULT NULL
)
 RETURNS expense
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id uuid;
  v_expense    public.expense;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_reimbursed IS NULL THEN
    RAISE EXCEPTION 'reimbursed must be true or false' USING ERRCODE = '22023';
  END IF;

  SELECT private.project_id_of_expense(e.id) INTO v_project_id
  FROM public.expense e
  WHERE e.id = p_expense_id AND e.deleted_at IS NULL;

  IF v_project_id IS NULL OR NOT public.has_permission(v_project_id, 'edit:money') THEN
    RAISE EXCEPTION 'expense not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.expense SET
    reimbursed    = p_reimbursed,
    reimbursed_on = CASE WHEN p_reimbursed THEN coalesce(p_on, CURRENT_DATE) END
  WHERE id = p_expense_id
  RETURNING * INTO v_expense;

  RETURN v_expense;
END;
$function$;

COMMENT ON FUNCTION public.set_expense_reimbursed(uuid, boolean, date) IS
  '79: marca un gasto adelantado como devuelto (con su día, hoy si no se da) o lo desmarca (sin día). edit:money sobre el proyecto del gasto; 42501 igual si no existe.';
REVOKE ALL ON FUNCTION public.set_expense_reimbursed(uuid, boolean, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_expense_reimbursed(uuid, boolean, date) TO authenticated;
