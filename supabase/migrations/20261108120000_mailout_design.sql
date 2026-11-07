-- El correo diseñado de una invitación (tarea 99, ADR-192).
--
-- Aditiva salvo `mailout_template`, que cambia lo que devuelve (una columna
-- más) y por eso se borra y se crea (CREATE OR REPLACE no cambia el tipo de
-- salida). Firma tomada de la base viva (pg_get_functiondef, 2026-11-08).
--
--   1. Dos columnas en `mailout`: `design` (el JSON del editor, la fuente) y
--      `design_html` (lo que compiló el navegador, ya limpio por el Worker,
--      con los campos `{nombre}` sin poner). Las dos o ninguna, y solo en una
--      invitación: la difusión sigue siendo una carta (ADR-180).
--   2. `set_mailout_design`: la escribe quien edita el envío, solo en
--      borrador. El Worker comprueba los bloques y las imágenes, y deriva el
--      texto plano, que guarda en `body` por `update_mailout`.
--   3. `mailout_template` devuelve también `design_html`: la cola monta el
--      correo diseñado con lo que ya lee. Desplegar antes de aplicar no rompe
--      la cola (sin la columna, la invitación sale como carta con el texto
--      derivado), pero sí la pantalla del envío, que lee `design` en el
--      SELECT: se aplica antes del deploy.
--
-- `mailout` tiene SELECT a tabla entera para authenticated (la RLS decide la
-- fila): las columnas nuevas se leen sin tocar grants. Sin UPDATE directo.
--
-- Rollback: build/runbooks/rollback-20261108-mailout-design.sql.

-- ── 1 · Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public.mailout
  ADD COLUMN design      jsonb,
  ADD COLUMN design_html text;

ALTER TABLE public.mailout
  ADD CONSTRAINT mailout_design_pair CHECK ((design IS NULL) = (design_html IS NULL)),
  ADD CONSTRAINT mailout_design_invitation CHECK (design IS NULL OR kind = 'invitation'),
  ADD CONSTRAINT mailout_design_shape CHECK (
    design IS NULL
    OR (jsonb_typeof(design) = 'object'
        AND jsonb_typeof(design -> 'blocks') = 'array'
        AND octet_length(design::text) <= 262144)
  ),
  ADD CONSTRAINT mailout_design_html_length CHECK (design_html IS NULL OR length(design_html) BETWEEN 1 AND 90000);

COMMENT ON COLUMN public.mailout.design IS
  'ADR-192: the designed invitation, as the Templatical editor saves it (the source). NULL = a letter. Only kind = invitation. Written by set_mailout_design.';
COMMENT ON COLUMN public.mailout.design_html IS
  'ADR-192: the design compiled to HTML in the browser and cleaned by the Worker, merge fields ({nombre}) unfilled, without footer (Hour adds it). NULL with design.';

-- ── 2 · Escribir el diseño ──────────────────────────────────────────────────
CREATE FUNCTION public.set_mailout_design(
  p_id          uuid,
  p_design      jsonb,
  p_design_html text
)
RETURNS public.mailout
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, true);
  v_row public.mailout;
BEGIN
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF p_design IS NOT NULL AND v_m.kind <> 'invitation' THEN
    RAISE EXCEPTION 'only an invitation can be designed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout m
  SET design      = p_design,
      design_html = CASE WHEN p_design IS NULL THEN NULL ELSE p_design_html END
  WHERE m.id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.set_mailout_design(uuid, jsonb, text) IS
  'ADR-192: set or clear (NULL) the design of a draft invitation. Who edits the mailout (mailout_for_caller). The Worker checks blocks and images and derives the plain text first.';

REVOKE ALL ON FUNCTION public.set_mailout_design(uuid, jsonb, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_mailout_design(uuid, jsonb, text) TO authenticated;

-- ── 3 · La cola lee el diseño con la plantilla ──────────────────────────────
DROP FUNCTION public.mailout_template(uuid[]);

CREATE FUNCTION public.mailout_template(p_mailout_ids uuid[])
RETURNS TABLE (
  mailout_id     uuid,
  company_name   text,
  logo_url       text,
  image_url      text,
  image_alt      text,
  image_link_url text,
  design_html    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT m.id, w.name, w.logo_url, m.image_url, m.image_alt, m.image_link_url, m.design_html
  FROM public.mailout m
  JOIN public.workspace w ON w.id = m.workspace_id
  WHERE m.id = ANY (coalesce(p_mailout_ids, '{}'));
$$;

COMMENT ON FUNCTION public.mailout_template(uuid[]) IS
  'ADR-172, ADR-192: the mail template pieces per mailout (company name, workspace logo, show image, design HTML). service_role only: the queue.';

REVOKE ALL ON FUNCTION public.mailout_template(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mailout_template(uuid[]) TO service_role;
