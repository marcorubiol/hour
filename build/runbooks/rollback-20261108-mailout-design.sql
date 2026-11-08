-- Rollback de 20261108120000_mailout_design (ADR-190). Borra los diseños
-- guardados: las invitaciones diseñadas en borrador vuelven a carta con su
-- texto derivado en `body`. Desplegar antes el código sin `design` en
-- MAILOUT_SELECT, o la pantalla del envío falla.
BEGIN;

DROP FUNCTION public.set_mailout_design(uuid, jsonb, text, text);

DROP FUNCTION public.mailout_template(uuid[]);
CREATE FUNCTION public.mailout_template(p_mailout_ids uuid[])
RETURNS TABLE (mailout_id uuid, company_name text, logo_url text, image_url text, image_alt text, image_link_url text)
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
REVOKE ALL ON FUNCTION public.mailout_template(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mailout_template(uuid[]) TO service_role;

ALTER TABLE public.mailout
  DROP CONSTRAINT mailout_design_pair,
  DROP CONSTRAINT mailout_design_invitation,
  DROP CONSTRAINT mailout_design_shape,
  DROP CONSTRAINT mailout_design_html_length,
  DROP COLUMN design,
  DROP COLUMN design_html;

COMMIT;
