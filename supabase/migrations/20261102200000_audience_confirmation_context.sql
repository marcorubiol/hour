-- Punto 98, fase 2 (plan 2026-11-01-audience § 3.3): lo que el Worker necesita
-- para mandar el correo de confirmación de un alta. audience_subscribe da el
-- token; esto da a quién, en qué idioma, de qué lista y por qué identidad.
--
-- La identidad es el primer dominio verificado del espacio con propósito
-- `audience` (ADR-173 § 5): la confirmación sale del subdominio del público,
-- nunca del de la difusión. Sin él no hay fila de dominio y el Worker no manda
-- nada (en producción una lista solo abre con dominio del público en SES o en
-- un espacio del simulador, set_audience_status).
--
-- Solo service_role (frontera de ADR-110, ampliada a `audience_*` por
-- ADR-173 § 4). Aditiva. Rollback: DROP FUNCTION.

CREATE FUNCTION public.audience_confirmation_context(p_subscription_id uuid)
RETURNS TABLE (
  address            text,
  name               text,
  language           text,
  audience_name      text,
  company_name       text,
  logo_url           text,
  form_key           text,
  provider           public.mail_sending_provider,
  from_address       text,
  from_name          text,
  tenant_name        text,
  configuration_set  text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.address::text, s.name, s.language, a.name, w.name, w.logo_url, a.form_key,
         d.provider, d.from_local_part || '@' || d.domain::text, coalesce(d.from_name, w.name),
         d.tenant_name, d.configuration_set
  FROM public.audience_subscription s
  JOIN public.audience a ON a.id = s.audience_id
  JOIN public.workspace w ON w.id = s.workspace_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.mail_domain md
    WHERE md.workspace_id = s.workspace_id AND md.purpose = 'audience' AND md.verified_at IS NOT NULL
    ORDER BY md.created_at, md.id
    LIMIT 1
  ) d ON true
  WHERE s.id = p_subscription_id;
$$;

COMMENT ON FUNCTION public.audience_confirmation_context(uuid) IS
  'ADR-173 · plan § 3.3: who gets the confirmation email of a subscription, in which language, and through which audience identity (first verified audience domain; NULL provider = none, send nothing). service_role only.';

ALTER FUNCTION public.audience_confirmation_context(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.audience_confirmation_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audience_confirmation_context(uuid) TO service_role;
