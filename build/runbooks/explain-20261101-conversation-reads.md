# EXPLAIN: las dos lecturas de conversaciones de 1,7 s (2026-11-01)

Las corre Marco, o el gate de `_tasks.md § 34` con su OK, en el SQL editor de `hour-phase0`. Solo leen. Cada bloque va
dentro de una transacción que acaba en `ROLLBACK`.

Qué se quiere saber: dónde se van los unos 1,7 s de servidor de `GET /api/conversations?limit=100&lean=1` (Hoy, el
margen del Planificador) y de `GET /api/conversations/overview` (Hoy, Conversaciones). Hipótesis, de más a menos
probable, en `build/coordination/claude-conversations-endpoints.md`.

## 0. Lo barato primero: qué dice `pg_stat_statements`

```sql
SELECT round(mean_exec_time::numeric, 1) AS ms_media, calls, round(total_exec_time::numeric) AS ms_total,
       left(regexp_replace(query, '\s+', ' ', 'g'), 300) AS consulta
FROM extensions.pg_stat_statements
WHERE query ILIKE '%conversation_event%' OR query ILIKE '%conversation_regular%'
ORDER BY mean_exec_time DESC
LIMIT 15;
```

Si la consulta de PostgREST sobre `conversation` con `last_turn`/`last_in` sale arriba con cientos de ms de media,
lo que sigue explica por qué.

## Preparación de cada bloque

El usuario de las mediciones es el del E2E (`playwright@hour.test`). Su id sale de:

```sql
SELECT id FROM auth.users WHERE email = 'playwright@hour.test';
```

Cada bloque empieza así, con ese id en `<SUB>`:

```sql
BEGIN;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<SUB>', 'role', 'authenticated')::text, true);
-- … la EXPLAIN …
ROLLBACK;
```

Para aislar la RLS, repetir las EXPLAIN 2, 3 y 6 sin `SET LOCAL role authenticated` (como `postgres`, que se salta la
RLS). La diferencia de tiempo entre las dos pasadas es lo que cuestan las políticas.

## 1. Solo la política de `conversation`

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT c.id FROM public.conversation c
WHERE c.deleted_at IS NULL
ORDER BY c.next_action_at ASC NULLS LAST, c.updated_at DESC
LIMIT 100;
```

Se mira: cuántas veces corre `has_permission` (en `VERBOSE`, el filtro de la política) y el tiempo total.

## 2. El campo calculado `conversation_regular` (hipótesis 2)

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT c.id, public.conversation_regular(c) AS regular
FROM public.conversation c
WHERE c.deleted_at IS NULL
ORDER BY c.next_action_at ASC NULLS LAST, c.updated_at DESC
LIMIT 100;
```

Comparar con la 1: lo que sube es el coste de `can_read_conversation` + `organization_is_regular` por fila. Para ver
el plan de dentro de la función (es SQL con SECURITY DEFINER, no se aplana), como `postgres`:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT EXISTS (
  SELECT 1
  FROM public.bolo b
  JOIN public.conversation bc ON bc.id = b.conversation_id
  WHERE b.workspace_id = '<WORKSPACE>' AND bc.workspace_id = '<WORKSPACE>'
    AND bc.organization_id = '<ORGANIZATION>'
    AND b.deleted_at IS NULL AND b.status = 'done'
    AND (SELECT coalesce(max(pf.performed_at) FILTER (WHERE pf.status <> 'cancelled'), max(pf.performed_at))
         FROM public.performance pf WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL)
        < make_date(extract(year FROM current_date)::int - (extract(month FROM current_date) < 9)::int, 9, 1)
);
```

con `<WORKSPACE>` y `<ORGANIZATION>` de una conversación de `muk-cia` que tenga organización. Se mira si recorre
`bolo_workspace_id_idx` (todos los bolos del espacio por cada conversación) o entra por la organización.

## 3. Los dos embebidos del turno (hipótesis 1)

Lo que genera PostgREST para `last_turn` y `last_in`, como `LATERAL`:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT c.id, lt.occurred_at AS last_turn_at, li.occurred_at AS last_in_at
FROM public.conversation c
LEFT JOIN LATERAL (
  SELECT e.direction, e.occurred_at, e.kind
  FROM public.conversation_event e
  WHERE e.conversation_id = c.id
    AND e.direction IS NOT NULL
    AND e.kind = ANY ('{email,message,call}')
    AND (e.metadata ->> 'auto') IS NULL
  ORDER BY e.occurred_at DESC
  LIMIT 1
) lt ON true
LEFT JOIN LATERAL (
  SELECT e.occurred_at
  FROM public.conversation_event e
  WHERE e.conversation_id = c.id
    AND e.direction = 'inbound'
    AND e.kind = ANY ('{email,message,call}')
    AND (e.metadata ->> 'auto') IS NULL
  ORDER BY e.occurred_at DESC
  LIMIT 1
) li ON true
WHERE c.deleted_at IS NULL
ORDER BY c.next_action_at ASC NULLS LAST, c.updated_at DESC
LIMIT 100;
```

Se mira, en los nodos de `conversation_event`, `rows removed by filter` y `loops`. Si el índice
`(conversation_id, occurred_at DESC, recorded_at DESC)` recorre muchos eventos por conversación antes del primero que
cumple, y en cada uno corre la política `EXISTS (… conversation …)` con su `has_permission`, el coste es N × eventos ×
permiso. Con `->>` sobre `metadata`, que no es leakproof, el filtro no puede ir antes que la política.

## 4. Contactos y etiquetas (hipótesis 3)

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT c.id,
  (SELECT json_agg(json_build_object('p', wp.full_name, 'o', wo.name))
   FROM public.conversation_contact cc
   LEFT JOIN public.workspace_person wp ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
   LEFT JOIN public.workspace_organization wo ON wo.id = wp.organization_id
   WHERE cc.conversation_id = c.id) AS contacts,
  (SELECT json_agg(t.key)
   FROM public.conversation_tagging ct JOIN public.conversation_tag t ON t.id = ct.tag_id
   WHERE ct.conversation_id = c.id) AS tags
FROM public.conversation c
WHERE c.deleted_at IS NULL
ORDER BY c.next_action_at ASC NULLS LAST, c.updated_at DESC
LIMIT 100;
```

Se mira el coste de `workspace_person_readable_by_caller` y `workspace_organization_readable_by_caller` por fila, y
la política `EXISTS (… conversation …)` de `conversation_contact` y `conversation_tagging`.

## 5. La política viva, antes de cualquier migración

```sql
SELECT policyname, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('conversation', 'conversation_event', 'conversation_contact', 'conversation_tagging')
  AND cmd = 'SELECT';
```

`conversation_select` tiene que ser el USING de `20261011200000_mail_google.sql`: la migración
`supabase/migrations/20261101110000_conversation_select_once.sql` (ADR-160) parte de ese.

## 6. Con la migración, dentro de la misma transacción

Para probarla sin aplicarla: en un bloque con `ROLLBACK`, como `postgres`, ejecutar el `ALTER POLICY` de la migración,
después `SET LOCAL role authenticated` y las claims, y repetir la 1 y la 3. El `ROLLBACK` deshace también el
`ALTER POLICY`. Ojo: `= ANY ((SELECT …))` sin el `::uuid[]` falla (`uuid = uuid[]`); la migración lleva la forma buena.
Resultado del 01-11 y decisión: ADR-160.
