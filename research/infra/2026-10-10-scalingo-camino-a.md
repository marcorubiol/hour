# Coste del camino A (Scalingo) frente a Supabase

> 2026-10-10. Precios consultados ese día, sin IVA, en scalingo.com/pricing, la API pública de planes de Scalingo
> y supabase.com/pricing. Dimensionamiento del camino A: supuesto, sin probar. Encargo: `_tasks.md § 41`.

## Coste mensual

| Escenario | Supabase Free | Supabase Pro | Pro + PITR | Camino A con HA |
|---|---|---|---|---|
| Solo Marco | 0 $ (se pausa; el keepalive lo tapa) | 25 $ | 125 $ | 83,20 € |
| Beta, ~5 compañías | no apto | 25 $ | 125 $ | 83,20 € |
| ~50 compañías | no apto | ~30 $ (Small) | ~130 $ | ~166 € |

- Camino A, beta: PostgreSQL Business 1G (40 €, 2 nodos, PITR 7 días, backups hasta 12 meses) + 2 GoTrue en S y 2
  PostgREST en M (43,20 €). A 50 compañías: Business 2G (80 €) + 2 GoTrue en M y 2 PostgREST en L (86,40 €). Sin HA,
  ~29 €.
- Supabase no vende HA utilizable hoy: Multigres está en alfa privada, fuera del SLA y sin Realtime ni PITR; una réplica
  de lectura no da cambio automático.

## Qué se opera uno mismo en el camino A
GoTrue (fork `supabase/auth`, por el hook de claims), SMTP propio, PostgREST, la presencia (a Durable Objects) y los
workflows de backup, restore, staging, migración y keepalive. Se pierden el panel, los advisors y el MCP.

## Esfuerzo
10 a 13 días. Conteo en el repo: `auth.uid()` 133 líneas en 25 migraciones, `auth.jwt()` 1, 41 `GRANT … TO
authenticated`, ~22 RPC, `rest/v1` en 11 ficheros y `/auth/v1` en 5, Realtime solo presencia y broadcast (11 ficheros).
§ 41 da cifras más altas (119, 100, 48): otro criterio de conteo.

## Riesgos y sin verificar
- Backups: gana Scalingo Business (PITR y 12 meses incluidos). RGPD: Scalingo es francés; Cloudflare sigue en EE. UU.
- Sin verificar: Docker o solo buildpacks en Scalingo, roles/BYPASSRLS/extensiones, si `auth.jwt()` lo crean las
  migraciones de GoTrue, si el crédito de Pro cubre staging.

## Recomendación del estudio
1. Supabase Pro antes de la beta (25 $): quita la pausa y activa HIBP, cero días.
2. Pro + PITR (125 $) cuando perder hasta un día de datos deje de ser aceptable.
3. Camino A solo con un motivo que Supabase no cubra (SLA o HA por contrato, alojamiento francés como argumento).
