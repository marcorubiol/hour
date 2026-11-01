-- 45 · El cron de 10 minutos recomprueba el DNS de los dominios de envío
-- (ADR-169 § 5). La lista sale de una RPC de máquina, la frontera de ADR-110:
-- la clave de servicio solo llama a RPC con nombre (`SERVICE_RPCS` en
-- `apps/web/src/lib/server/mailout/db.ts`, que ya la nombra), nunca a tablas.
--
-- `mail_domain_pending_checks()`: los dominios sin verificar de un servicio
-- real (no el simulador), dados de alta hace menos de 72 h, del más viejo al
-- más nuevo, 50 como mucho. Sin espacio ni persona: es la pasada de todos. El
-- Worker filtra además los que ya fallaron (`domainsToRecheck`, mismo módulo
-- de `recheck.ts`). Las columnas son las de `PendingDomainRow`.
--
-- Solo `service_role`: REVOKE de PUBLIC, anon y authenticated. Lo que hace una
-- persona («Comprobar» en Ajustes) sigue por su JWT.
--
-- ADITIVA según § 34: una función nueva, ningún dato tocado. Hasta aplicarla,
-- la pasada del cron deja `mail_domain_recheck_unavailable` en el log y no hace
-- nada (ADR-169 § 5).
--
-- Rollback: DROP FUNCTION public.mail_domain_pending_checks();

CREATE FUNCTION public.mail_domain_pending_checks()
 RETURNS TABLE (
   id                  uuid,
   provider            public.mail_sending_provider,
   domain              text,
   mail_from_subdomain text,
   tenant_name         text,
   configuration_set   text,
   dkim_status         text,
   mail_from_status    text,
   verified_at         timestamptz,
   created_at          timestamptz
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d.id, d.provider, d.domain::text, d.mail_from_subdomain, d.tenant_name,
         d.configuration_set, d.dkim_status, d.mail_from_status, d.verified_at, d.created_at
  FROM public.mail_domain d
  WHERE d.verified_at IS NULL
    AND d.provider <> 'simulator'
    AND d.created_at > now() - interval '72 hours'
  ORDER BY d.created_at
  LIMIT 50;
$function$;

ALTER FUNCTION public.mail_domain_pending_checks() OWNER TO postgres;
COMMENT ON FUNCTION public.mail_domain_pending_checks() IS
  'ADR-169 § 5: dominios de envío sin verificar de un servicio real, de las últimas 72 h, para la recomprobación del cron. Solo service_role (ADR-110).';
REVOKE ALL ON FUNCTION public.mail_domain_pending_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_domain_pending_checks() TO service_role;
