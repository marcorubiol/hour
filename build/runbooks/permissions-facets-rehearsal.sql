-- Ensayo del espejo de permisos (fase expand, 20261011100000).
--
-- Se corre como postgres contra una base con la migración aplicada (la local o
-- staging; NUNCA producción: escribe, aunque todo acaba en ROLLBACK). Mueve el
-- modelo de hoy por cada camino que el espejo tiene que seguir y, después de
-- cada paso, exige paridad cero entre los lectores de hoy y los del modelo
-- nuevo. Al final comprueba que la tabla de niveles se cumple al escribir.
--
-- Uso local:
--   docker exec -i supabase_db_hour-phase0 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < build/runbooks/permissions-facets-rehearsal.sql
-- Sale con error en el primer paso que rompa la paridad; si llega al final,
-- imprime «rehearsal ok».

BEGIN;

CREATE FUNCTION pg_temp.assert_parity(p_step text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_n integer; v_d text;
BEGIN
  SELECT count(*), string_agg(format('%s %s %s legacy=%s model=%s', user_id, coalesce(project_id::text, workspace_id::text), probe, legacy, model), E'\n')
  INTO v_n, v_d FROM private.access_parity_mismatches();
  IF v_n > 0 THEN
    RAISE EXCEPTION 'parity broken after «%»: % mismatch(es)', p_step, v_n USING DETAIL = v_d;
  END IF;
  RAISE NOTICE 'ok: %', p_step;
END $$;

-- Un proyecto y dos personas de prueba en el primer espacio con dueño.
CREATE TEMP TABLE t AS
SELECT w.id AS ws,
       (SELECT wm.user_id FROM public.workspace_membership wm
         WHERE wm.workspace_id = w.id AND wm.role = 'owner' LIMIT 1) AS owner_id
FROM public.workspace w
WHERE EXISTS (SELECT 1 FROM public.workspace_membership wm WHERE wm.workspace_id = w.id AND wm.role = 'owner')
LIMIT 1;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-00000000f001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-a@hour.test', now(), now()),
       ('00000000-0000-7000-8000-00000000f002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-b@hour.test', now(), now());

INSERT INTO public.project (id, workspace_id, name, slug, created_by)
SELECT '00000000-0000-7000-8000-00000000f0a0', t.ws, 'Rehearsal', 'zzz-rehearsal-facets', t.owner_id FROM t;
SELECT pg_temp.assert_parity('setup');

-- Alta en el espacio, aún sin aceptar: nada concede.
INSERT INTO public.workspace_membership (workspace_id, user_id, role)
SELECT t.ws, '00000000-0000-7000-8000-00000000f001', 'member' FROM t;
INSERT INTO public.project_membership (project_id, user_id, roles)
VALUES ('00000000-0000-7000-8000-00000000f0a0', '00000000-0000-7000-8000-00000000f001', '{performer}');
SELECT pg_temp.assert_parity('pending workspace membership');

UPDATE public.workspace_membership SET accepted_at = now()
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('accept');

UPDATE public.project_membership SET roles = '{producer}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('role change to producer');

UPDATE public.project_membership SET permission_revokes = '{read:money,edit:money}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('revoke money');

UPDATE public.project_membership
SET roles = '{performer,press}', permission_grants = '{read:money,edit:project_meta}', permission_revokes = '{}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('two roles plus grants');

UPDATE public.project_membership SET permission_revokes = '{read:performance}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('revoke read:performance (member without container access)');

UPDATE public.project_membership SET roles = '{technical_director}', permission_revokes = '{read:performance}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('edit:performance implies read despite revoke');

-- Cambiar el paquete del rol cambia a quien lo lleva.
UPDATE public.workspace_role SET permissions = permissions || '{read:money}'
WHERE workspace_id = (SELECT ws FROM t) AND code = 'technical_director';
SELECT pg_temp.assert_parity('role permissions edited');

UPDATE public.workspace_role SET archived_at = now()
WHERE workspace_id = (SELECT ws FROM t) AND code = 'technical_director';
SELECT pg_temp.assert_parity('role archived');

UPDATE public.workspace_role SET archived_at = NULL
WHERE workspace_id = (SELECT ws FROM t) AND code = 'technical_director';
SELECT pg_temp.assert_parity('role unarchived');

-- Rol custom: creado, asignado, renombrado y borrado.
INSERT INTO public.workspace_role (workspace_id, code, label, access_level, permissions)
SELECT t.ws, 'zzz_custom', 'Custom', 'member', '{read:conversation,edit:conversation}' FROM t;
UPDATE public.project_membership SET roles = '{zzz_custom}', permission_revokes = '{}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('custom role assigned');

UPDATE public.workspace_role SET code = 'zzz_custom2'
WHERE workspace_id = (SELECT ws FROM t) AND code = 'zzz_custom';
SELECT pg_temp.assert_parity('custom role renamed (assignments dangle, as today)');

DELETE FROM public.workspace_role
WHERE workspace_id = (SELECT ws FROM t) AND code = 'zzz_custom2';
SELECT pg_temp.assert_parity('custom role deleted');

-- Espacio: guest, admin, baja.
UPDATE public.project_membership SET roles = '{performer}'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
UPDATE public.workspace_membership SET role = 'guest'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('workspace guest');

UPDATE public.workspace_membership SET role = 'admin'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('workspace admin bypass');

UPDATE public.workspace_membership SET role = 'viewer'
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('workspace viewer');

DELETE FROM public.workspace_membership
WHERE user_id = '00000000-0000-7000-8000-00000000f001';
SELECT pg_temp.assert_parity('workspace membership deleted, project membership left behind');

-- Proyecto borrado blando y duro; usuario borrado.
INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
SELECT t.ws, '00000000-0000-7000-8000-00000000f002', 'member', now() FROM t;
INSERT INTO public.project_membership (project_id, user_id, roles)
VALUES ('00000000-0000-7000-8000-00000000f0a0', '00000000-0000-7000-8000-00000000f002', '{producer}');
SELECT pg_temp.assert_parity('second person');

UPDATE public.project SET deleted_at = now() WHERE id = '00000000-0000-7000-8000-00000000f0a0';
SELECT pg_temp.assert_parity('project soft-deleted');

DELETE FROM auth.users WHERE id = '00000000-0000-7000-8000-00000000f002';
SELECT pg_temp.assert_parity('user deleted (cascade)');

DELETE FROM public.project WHERE id = '00000000-0000-7000-8000-00000000f0a0';
SELECT pg_temp.assert_parity('project hard-deleted (cascade)');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.membership WHERE user_id = '00000000-0000-7000-8000-00000000f002') THEN
    RAISE EXCEPTION 'membership rows survived the deleted user';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membership WHERE project_id = '00000000-0000-7000-8000-00000000f0a0') THEN
    RAISE EXCEPTION 'membership rows survived the deleted project';
  END IF;
END $$;

-- La tabla de niveles se cumple al escribir: Logística no existe en proyecto.
DO $$
DECLARE v_mid uuid;
BEGIN
  SELECT id INTO v_mid FROM public.membership WHERE level = 'project' LIMIT 1;
  IF v_mid IS NULL THEN
    RAISE NOTICE 'skip level guard: no project membership in this base';
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.membership_facet (membership_id, facet_key, verb, source)
    VALUES (v_mid, 'logistica', 'view', 'override');
    RAISE EXCEPTION 'level guard let logistica in at project level';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: logistica rejected at project level';
  END;
END $$;

DO $$ BEGIN RAISE NOTICE 'rehearsal ok'; END $$;

ROLLBACK;
