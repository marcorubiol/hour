-- 20261101110000_conversation_select_once (ADR-160)
--
-- Qué: la política de lectura de `conversation` resuelve los proyectos que
-- quien llama puede leer UNA vez por consulta (un InitPlan sobre
-- `accessible_project_ids`, el patrón de 20260724093000) en vez de llamar a
-- `has_permission(project_id, 'read:conversation')` en cada fila.
--
-- Por qué (medido el 01-11 en producción, solo lecturas, como el usuario de
-- Marco: muk-cia, 309 conversaciones, 152 visibles): las lecturas de lista de
-- `conversation` tardan de 1,4 a 1,7 s de media en la base
-- (pg_stat_statements, miles de llamadas). La política sola, 1559 ms en frío
-- y 335 en caliente, todo en el filtro `has_permission` por fila sobre las 309
-- filas de `conversation_workspace_idx`. Con este predicado: 181 y 44 ms, por
-- `conversation_project_idx` (Index Cond) con el InitPlan una vez; 152 = 152
-- filas con las dos formas.
--
-- Equivalencia: `accessible_project_ids(p)` son los proyectos vivos donde
-- `has_permission(id, p)`, y `has_permission` ya exige proyecto vivo
-- (`private.model_has_facet`: `p.deleted_at IS NULL`). Borrado y privada no
-- cambian. Parte del USING de 20261011200000_mail_google: antes del apply,
-- comprobar en pg_policies que es el vivo (§ 5 del runbook de EXPLAIN).
--
-- Las tablas hijas (`conversation_event`, `conversation_contact`,
-- `conversation_tagging`) no se tocan: sus políticas son
-- `EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = …)` y aplican esta
-- política dentro; su InitPlan no depende de la fila de fuera, así que se
-- calcula una vez por consulta y no por fila hija. Comprobarlo tras el apply
-- con la § 3 de build/runbooks/explain-20261101-conversation-reads.md.
--
-- Cómo se valida: `pnpm --filter web test:rls` entero, con
-- tests/rls/conversation-select-once.test.ts (con y sin Converses, privada,
-- proyecto borrado, otro espacio, y las tablas hijas), y la medición por HTTP
-- de `/api/conversations?lean=1` y `/api/conversations/overview`.
-- Rollback: build/runbooks/rollback-20261101-conversation-select-once.sql.

ALTER POLICY conversation_select ON public.conversation
  USING (
    deleted_at IS NULL
    AND project_id = ANY (((SELECT public.accessible_project_ids('read:conversation'::text)))::uuid[])
    AND (private_to IS NULL OR private_to = (SELECT auth.uid()))
  );
