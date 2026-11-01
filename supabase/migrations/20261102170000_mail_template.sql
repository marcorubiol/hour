-- La plantilla del correo de difusión (ADR-172).
--
-- Aditiva. El logo de la compañía ya tiene columna (`workspace.logo_url`, en el
-- grant de UPDATE por columnas y en `update_workspace`): no se toca. Lo nuevo:
--
--   1. La imagen del espectáculo de un envío, elegida al redactarlo: tres
--      columnas en `mailout` (la imagen, su texto alternativo y a dónde lleva,
--      el dossier). La imagen la sirve Hour (`/m/ws/<espacio>/mail/…`, R2): la
--      columna no admite otra cosa, ni la de otro espacio.
--   2. `set_mailout_image`: la escribe quien edita el envío, solo en borrador.
--      Sin texto alternativo, el nombre del proyecto.
--   3. `mailout_template`: lo que la cola necesita para la plantilla (logo,
--      nombre de la compañía e imagen), por envío. Solo service_role, como el
--      resto de RPC de máquina del envío (frontera de ADR-110).
--
-- `mailout` tiene SELECT a tabla entera para authenticated (la RLS decide la
-- fila), así que las columnas nuevas se leen sin tocar grants; no hay UPDATE
-- directo (se escribe por RPC).

-- ── 1 · Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public.mailout
  ADD COLUMN image_url      text,
  ADD COLUMN image_alt      text,
  ADD COLUMN image_link_url text;

ALTER TABLE public.mailout
  ADD CONSTRAINT mailout_image_url_own CHECK (
    image_url IS NULL
    OR (length(image_url) <= 300
        AND image_url ~ '^/m/ws/[0-9a-f-]{36}/mail/[A-Za-z0-9._-]+$'
        AND starts_with(image_url, '/m/ws/' || workspace_id::text || '/mail/'))
  ),
  ADD CONSTRAINT mailout_image_alt_length CHECK (image_alt IS NULL OR length(image_alt) BETWEEN 1 AND 200),
  ADD CONSTRAINT mailout_image_link_url_http CHECK (
    image_link_url IS NULL OR (length(image_link_url) <= 2000 AND image_link_url ~* '^https?://[^\s<>"]+$')
  ),
  -- Sin imagen no hay texto ni enlace sueltos.
  ADD CONSTRAINT mailout_image_parts CHECK (image_url IS NOT NULL OR (image_alt IS NULL AND image_link_url IS NULL));

COMMENT ON COLUMN public.mailout.image_url IS
  'ADR-172: show image of this mailout, served by Hour from R2 (/m/ws/<workspace>/mail/<sha>-<w>x<h>.<ext>). NULL = no image. Written by set_mailout_image.';
COMMENT ON COLUMN public.mailout.image_alt IS
  'ADR-172: alt text of the show image (what reads when images are blocked). Defaults to the project name.';
COMMENT ON COLUMN public.mailout.image_link_url IS
  'ADR-172: where the show image links (the dossier). http(s) only. NULL = the image does not link.';

-- ── 2 · Escribir la imagen ──────────────────────────────────────────────────
CREATE FUNCTION public.set_mailout_image(
  p_id             uuid,
  p_image_url      text,
  p_image_alt      text DEFAULT NULL,
  p_image_link_url text DEFAULT NULL
) RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, true);
  v_url text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_row public.mailout;
BEGIN
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout m
  SET image_url = v_url,
      image_alt = CASE WHEN v_url IS NULL THEN NULL ELSE coalesce(
        nullif(btrim(coalesce(p_image_alt, '')), ''),
        (SELECT left(p.name, 200) FROM public.project p WHERE p.id = m.project_id)
      ) END,
      image_link_url = CASE WHEN v_url IS NULL THEN NULL ELSE nullif(btrim(coalesce(p_image_link_url, '')), '') END
  WHERE m.id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.set_mailout_image(uuid, text, text, text) IS
  'ADR-172: set or clear (p_image_url NULL) the show image of a draft mailout, its alt text (default: the project name) and its link (the dossier). edit:conversation on the mailout project (mailout_for_caller).';

-- ── 3 · Lo que la cola necesita para la plantilla ───────────────────────────
CREATE FUNCTION public.mailout_template(p_mailout_ids uuid[])
RETURNS TABLE (
  mailout_id     uuid,
  company_name   text,
  logo_url       text,
  image_url      text,
  image_alt      text,
  image_link_url text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT m.id, w.name, w.logo_url, m.image_url, m.image_alt, m.image_link_url
  FROM public.mailout m
  JOIN public.workspace w ON w.id = m.workspace_id
  WHERE m.id = ANY (coalesce(p_mailout_ids, '{}'));
$$;

COMMENT ON FUNCTION public.mailout_template(uuid[]) IS
  'ADR-172: the mail template pieces per mailout (company name, workspace logo, show image). service_role only: the queue.';

REVOKE ALL ON FUNCTION public.set_mailout_image(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_mailout_image(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.mailout_template(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mailout_template(uuid[]) TO service_role;
