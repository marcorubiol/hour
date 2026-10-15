-- ADR-115 · Envío en bloque, fase 3: lo que hace falta para montar cada correo.
-- Plan: build/plans/2026-10-14-bulk-send.md (§ 3.4, § 7.1, § 10, § 11 fase 3).
--
-- Aditiva: solo funciones nuevas. Nada cambia en tablas ni en las RPC de la
-- fase 1 (20261015100000_mailout).
--   · `mailout_send_context` (service_role): por destinatario, los campos del
--     correo (`{nombre}`, `{sala}`, `{ciudad}`) y las piezas del pie (la
--     compañía, su firma, su política de privacidad). La cola la llama después
--     de `mailout_claim`, que no las devuelve.
--   · `mailout_compose_preview` (authenticated): lo mismo para la vista previa,
--     con la RLS de quien llama: solo los destinatarios de conversaciones que
--     ve. Las dos salen de una sola función privada: lo que se ve es lo que
--     sale.
--   · `mailout_unsubscribe_info` (anon, por token): lo que enseña la página de
--     baja (nombre de la compañía, idioma del envío y si ya está de baja).
-- Rollback: build/runbooks/rollback-20261016-mailout-send.sql.

CREATE FUNCTION private.mailout_compose_rows(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id        uuid,
  mailout_id          uuid,
  address_kind        public.mailout_address_kind,
  basis_kind          public.mail_basis_kind,
  contact_first_name  text,
  contact_name        text,
  organization_name   text,
  city                text,
  company_name        text,
  company_city        text,
  company_website     text,
  company_phone       text,
  company_signature   text,
  privacy_url         text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT r.id, r.mailout_id, r.address_kind,
         -- La base congelada al poner en cola; antes, la vigente.
         coalesce(r.basis_kind, b.kind),
         CASE WHEN r.address_kind = 'contact'
              THEN coalesce(nullif(btrim(wp.first_name), ''), nullif(split_part(btrim(wp.full_name), ' ', 1), '')) END,
         CASE WHEN r.address_kind = 'contact' THEN nullif(btrim(wp.full_name), '') END,
         nullif(btrim(o.name), ''),
         coalesce(nullif(btrim(o.city), ''), CASE WHEN r.address_kind = 'contact' THEN nullif(btrim(wp.city), '') END),
         w.name,
         nullif(btrim(w.city), ''),
         nullif(btrim(w.website), ''),
         nullif(btrim(w.phone), ''),
         nullif(btrim(w.mail_signature), ''),
         w.privacy_url
  FROM public.mailout_recipient r
  JOIN public.conversation c ON c.id = r.conversation_id
  JOIN public.workspace w ON w.id = r.workspace_id
  LEFT JOIN public.workspace_person wp
    ON wp.workspace_id = r.workspace_id AND wp.person_id = r.person_id AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization o
    ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
  LEFT JOIN public.mail_basis b
    ON b.workspace_id = r.workspace_id AND b.address = r.address AND b.withdrawn_at IS NULL
  WHERE r.id = ANY (p_recipient_ids)
  ORDER BY r.created_at, r.id;
$$;

-- La cola, sin persona detrás: los destinatarios que acaba de tomar.
CREATE FUNCTION public.mailout_send_context(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id        uuid,
  mailout_id          uuid,
  address_kind        public.mailout_address_kind,
  basis_kind          public.mail_basis_kind,
  contact_first_name  text,
  contact_name        text,
  organization_name   text,
  city                text,
  company_name        text,
  company_city        text,
  company_website     text,
  company_phone       text,
  company_signature   text,
  privacy_url         text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM private.mailout_compose_rows(coalesce(p_recipient_ids, '{}'));
$$;

-- La vista previa: los destinatarios del envío que quien llama ve (las
-- conversaciones privadas de otra persona no salen), con lo mismo que usará
-- la cola.
CREATE FUNCTION public.mailout_compose_preview(p_id uuid)
RETURNS TABLE (
  recipient_id        uuid,
  mailout_id          uuid,
  address_kind        public.mailout_address_kind,
  basis_kind          public.mail_basis_kind,
  contact_first_name  text,
  contact_name        text,
  organization_name   text,
  city                text,
  company_name        text,
  company_city        text,
  company_website     text,
  company_phone       text,
  company_signature   text,
  privacy_url         text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, false);
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(r.id), '{}') INTO v_ids
  FROM public.mailout_recipient r
  JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  WHERE r.mailout_id = v_m.id;
  RETURN QUERY SELECT * FROM private.mailout_compose_rows(v_ids);
END;
$$;

-- La página de baja: de quién son los envíos, en qué idioma, y si esa
-- dirección ya está de baja. Un token que no existe no devuelve nada.
CREATE FUNCTION public.mailout_unsubscribe_info(p_token text)
RETURNS TABLE (company_name text, language text, unsubscribed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT w.name, m.language,
         EXISTS (SELECT 1 FROM public.mail_suppression s
                 WHERE s.workspace_id = r.workspace_id AND s.address = r.address
                   AND s.reason IN ('unsubscribe', 'complaint'))
  FROM public.mailout_recipient r
  JOIN public.mailout m ON m.id = r.mailout_id
  JOIN public.workspace w ON w.id = r.workspace_id
  WHERE r.unsubscribe_token = btrim(coalesce(p_token, '')) AND r.address IS NOT NULL;
$$;

DO $$
DECLARE
  f text;
BEGIN
  EXECUTE 'ALTER FUNCTION private.mailout_compose_rows(uuid[]) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION private.mailout_compose_rows(uuid[]) FROM PUBLIC, anon, authenticated, service_role';

  EXECUTE 'ALTER FUNCTION public.mailout_compose_preview(uuid) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION public.mailout_compose_preview(uuid) FROM PUBLIC, anon, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.mailout_compose_preview(uuid) TO authenticated';

  EXECUTE 'ALTER FUNCTION public.mailout_unsubscribe_info(text) OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION public.mailout_unsubscribe_info(text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.mailout_unsubscribe_info(text) TO anon, authenticated, service_role';

  -- De máquina: solo service_role (la frontera de ADR-110).
  f := 'public.mailout_send_context(uuid[])';
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
END;
$$;
