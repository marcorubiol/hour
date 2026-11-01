-- 20261101100000_conversation_select_once
--
-- CANDIDATA, fuera de supabase/migrations a propósito: NO APLICAR sin antes correr las EXPLAIN de
-- build/runbooks/explain-20261101-conversation-reads.md y sin el OK de Marco
-- (_tasks.md § 34: backup, plan, apply). Si el EXPLAIN no muestra el coste en
-- has_permission por fila, esta migración se borra.
--
-- Qué: la política de lectura de `conversation` resuelve los proyectos que
-- quien llama puede leer UNA vez por consulta (un InitPlan sobre
-- `accessible_project_ids`, el patrón del 2026-07-24) en vez de llamar a
-- `has_permission(project_id, 'read:conversation')` en cada fila.
--
-- Por qué: `GET /api/conversations?limit=100&lean=1` y
-- `GET /api/conversations/overview` tardan unos 1,7 s de servidor cada uno con
-- el usuario del E2E (espacio `playwright`, pocas conversaciones; medido el
-- 01-11 desde el navegador). Las dos leen `conversation` con embebidos de
-- `conversation_event` (dos por fila), `conversation_contact` y
-- `conversation_tagging`, y las políticas de esas tres tablas son
-- `EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = …)`: cada fila hija
-- que se toca vuelve a evaluar la política de `conversation`, y con ella un
-- `has_permission` (STABLE, que Postgres no recuerda entre filas). Con el
-- InitPlan, cada una de esas comprobaciones es una búsqueda en un array.
--
-- Equivalencia: `accessible_project_ids(p)` son los proyectos vivos donde
-- `has_permission(id, p)`; `has_permission` ya exige proyecto vivo
-- (`private.model_has_facet`: `p.deleted_at IS NULL`). Las demás condiciones
-- (borrado, privada) no cambian. Antes de aplicar, comparar el USING vivo
-- (`pg_policies`) con el de 20261011200000: esta migración parte de ese.
--
-- Cómo se valida: `pnpm --filter web test:rls` entero (las lecturas de
-- conversación, privadas, guest de bolo y facetas) y la medición por HTTP de
-- los dos endpoints antes y después.
-- Rollback: el ALTER POLICY de abajo con el USING de 20261011200000.

ALTER POLICY conversation_select ON public.conversation
  USING (
    deleted_at IS NULL
    AND project_id = ANY ((SELECT public.accessible_project_ids('read:conversation'::text)))
    AND (private_to IS NULL OR private_to = (SELECT auth.uid()))
  );
