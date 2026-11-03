-- 104 · Una invitación sale en el idioma de cada suscripción, no en el del
-- envío (Marco, 2026-11-03).
--
-- `audience_subscription.language` ya existe (NOT NULL, es|ca|en|fr, ADR-173):
-- no hay columna nueva. Lo que falta es que el montaje del correo lo lea. Las
-- tres funciones del montaje ganan una columna AL FINAL, `subscriber_language`
-- (null para un profesional): el Worker desplegado sigue funcionando porque
-- ignora columnas que no conoce, y el código nuevo sin esta migración cae al
-- idioma del envío (mailout-compose.ts, `recipientLanguage`).
--
-- Según § 34: sin tablas ni datos; DROP y CREATE de tres funciones de lectura
-- (cambia el tipo de salida, así que no vale CREATE OR REPLACE), con sus
-- grants de nuevo. Cuerpos copiados de 20261102180100_audience.sql, la última
-- migración que las define. RIESGO: no se ha comparado con
-- pg_get_functiondef de producción; antes del apply, comprobar que el cuerpo
-- vivo de las tres es el de esa migración.
-- Rollback: volver a correr el bloque de las tres funciones de
-- 20261102180100_audience.sql (líneas de «Montaje del correo») y sus grants.

DROP FUNCTION public.mailout_compose_preview(uuid);
DROP FUNCTION public.mailout_send_context(uuid[]);
DROP FUNCTION private.mailout_compose_rows(uuid[]);

CREATE FUNCTION private.mailout_compose_rows(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  contact_first_name       text,
  contact_name             text,
  organization_name        text,
  city                     text,
  company_name             text,
  company_city             text,
  company_website          text,
  company_phone            text,
  company_signature        text,
  privacy_url              text,
  mailout_kind             public.mailout_kind,
  audience_subscription_id uuid,
  audience_name            text,
  subscriber_name          text,
  subscribed_at            timestamptz,
  venue_name               text,
  venue_city               text,
  subscriber_language      text
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
         w.privacy_url,
         m.kind,
         r.audience_subscription_id,
         a.name,
         nullif(btrim(s.name), ''),
         s.confirmed_at,
         coalesce(nullif(btrim(pf.venue_name), ''), nullif(btrim(v.name), '')),
         coalesce(nullif(btrim(pf.city), ''), nullif(btrim(v.city), '')),
         -- 104: el idioma en que se dio de alta (o entró importada) la persona.
         s.language
  FROM public.mailout_recipient r
  JOIN public.mailout m ON m.id = r.mailout_id
  JOIN public.workspace w ON w.id = r.workspace_id
  LEFT JOIN public.conversation c ON c.id = r.conversation_id
  LEFT JOIN public.workspace_person wp
    ON wp.workspace_id = r.workspace_id AND wp.person_id = r.person_id AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization o
    ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
  LEFT JOIN public.mail_basis b
    ON b.workspace_id = r.workspace_id AND b.address = r.address AND b.withdrawn_at IS NULL
   AND r.conversation_id IS NOT NULL
  LEFT JOIN public.audience_subscription s ON s.id = r.audience_subscription_id
  LEFT JOIN public.audience a ON a.id = s.audience_id
  LEFT JOIN public.performance pf ON pf.id = m.performance_id AND pf.deleted_at IS NULL
  LEFT JOIN public.venue v ON v.id = pf.venue_id AND v.deleted_at IS NULL
  WHERE r.id = ANY (p_recipient_ids)
  ORDER BY r.created_at, r.id;
$$;

-- La cola, sin persona detrás: los destinatarios que acaba de tomar.
CREATE FUNCTION public.mailout_send_context(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  contact_first_name       text,
  contact_name             text,
  organization_name        text,
  city                     text,
  company_name             text,
  company_city             text,
  company_website          text,
  company_phone            text,
  company_signature        text,
  privacy_url              text,
  mailout_kind             public.mailout_kind,
  audience_subscription_id uuid,
  audience_name            text,
  subscriber_name          text,
  subscribed_at            timestamptz,
  venue_name               text,
  venue_city               text,
  subscriber_language      text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM private.mailout_compose_rows(coalesce(p_recipient_ids, '{}'));
$$;

-- La vista previa: los destinatarios que quien llama ve (las conversaciones
-- privadas de otra persona no salen; el público, con la faceta), con lo mismo
-- que usará la cola.
CREATE FUNCTION public.mailout_compose_preview(p_id uuid)
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  contact_first_name       text,
  contact_name             text,
  organization_name        text,
  city                     text,
  company_name             text,
  company_city             text,
  company_website          text,
  company_phone            text,
  company_signature        text,
  privacy_url              text,
  mailout_kind             public.mailout_kind,
  audience_subscription_id uuid,
  audience_name            text,
  subscriber_name          text,
  subscribed_at            timestamptz,
  venue_name               text,
  venue_city               text,
  subscriber_language      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout := private.mailout_for_caller(p_id, false);
  v_audience boolean := private.audience_access(v_m.workspace_id, false);
  v_ids      uuid[];
BEGIN
  SELECT coalesce(array_agg(r.id), '{}') INTO v_ids
  FROM public.mailout_recipient r
  LEFT JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  WHERE r.mailout_id = v_m.id
    AND CASE WHEN r.conversation_id IS NOT NULL THEN c.id IS NOT NULL ELSE v_audience END;
  RETURN QUERY SELECT * FROM private.mailout_compose_rows(v_ids);
END;

DO $$
BEGIN
  ALTER FUNCTION private.mailout_compose_rows(uuid[]) OWNER TO postgres;
  REVOKE ALL ON FUNCTION private.mailout_compose_rows(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

  ALTER FUNCTION public.mailout_compose_preview(uuid) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.mailout_compose_preview(uuid) FROM PUBLIC, anon, service_role;
  GRANT EXECUTE ON FUNCTION public.mailout_compose_preview(uuid) TO authenticated;

  ALTER FUNCTION public.mailout_send_context(uuid[]) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.mailout_send_context(uuid[]) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.mailout_send_context(uuid[]) TO service_role;
END;
$$;
