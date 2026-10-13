-- Ensayo de permisos al modelo de facetas (expand 20261011100000, fase 2
-- 20261011300000 y fase 3 20261013200000).
--
-- Se corre como postgres contra una base con las migraciones aplicadas (la
-- local o staging; NUNCA producción: escribe, aunque todo acaba en ROLLBACK).
-- Mira qué fase tiene la base y ensaya sus caminos, exigiendo paridad cero
-- entre los lectores viejos y el modelo nuevo después de cada paso:
--   · Con el espejo del expand vivo (expand o fase 2): mueve el modelo viejo
--     por cada camino que el espejo tiene que seguir.
--   · Con la fase 3: mueve el modelo nuevo por las RPC (alta, invitación con
--     paquete, aceptación, rol, paquetes y overrides en proyecto y espacio,
--     techo del delegante, revocar, baja, cascadas) y comprueba que la
--     proyección deja las tablas viejas al día y cerradas a la API.
-- En las dos: la tabla de niveles se cumple al escribir y los paquetes en un
-- bolo respetan el techo.
--
-- Uso local:
--   docker exec -i supabase_db_hour-phase0 psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < build/runbooks/permissions-facets-rehearsal.sql
-- Sale con error en el primer paso que falle; si llega al final, imprime
-- «rehearsal ok».

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

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

CREATE FUNCTION pg_temp.phase3() RETURNS boolean
LANGUAGE sql AS $$
  SELECT to_regprocedure('public.revoke_membership(uuid)') IS NOT NULL;
$$;

-- Un proyecto de prueba en el primer espacio con dueño.
CREATE TEMP TABLE t AS
SELECT w.id AS ws,
       (SELECT wm.user_id FROM public.workspace_membership wm
         WHERE wm.workspace_id = w.id AND wm.role = 'owner' LIMIT 1) AS owner_id
FROM public.workspace w
WHERE EXISTS (SELECT 1 FROM public.workspace_membership wm WHERE wm.workspace_id = w.id AND wm.role = 'owner')
LIMIT 1;

INSERT INTO public.project (id, workspace_id, name, slug, created_by)
SELECT '00000000-0000-7000-8000-00000000f0a0', t.ws, 'Rehearsal', 'zzz-rehearsal-facets', t.owner_id FROM t;
SELECT pg_temp.assert_parity('setup');

-- ── A · espejo (expand y fase 2): el modelo viejo manda ───────────────────
DO $legacy$
DECLARE
  v_ws uuid := (SELECT ws FROM t);
  a    uuid := '00000000-0000-7000-8000-00000000f001';
  b    uuid := '00000000-0000-7000-8000-00000000f002';
  p    uuid := '00000000-0000-7000-8000-00000000f0a0';
BEGIN
  IF pg_temp.phase3() THEN
    RAISE NOTICE 'skip mirror paths: phase 3 is applied (the mirror is off)';
    RETURN;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-a@hour.test', now(), now()),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-b@hour.test', now(), now());

  -- Alta en el espacio, aún sin aceptar: nada concede.
  INSERT INTO public.workspace_membership (workspace_id, user_id, role) VALUES (v_ws, a, 'member');
  INSERT INTO public.project_membership (project_id, user_id, roles) VALUES (p, a, '{performer}');
  PERFORM pg_temp.assert_parity('pending workspace membership');

  UPDATE public.workspace_membership SET accepted_at = now() WHERE user_id = a;
  PERFORM pg_temp.assert_parity('accept');

  UPDATE public.project_membership SET roles = '{producer}' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('role change to producer');

  UPDATE public.project_membership SET permission_revokes = '{read:money,edit:money}' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('revoke money');

  UPDATE public.project_membership
  SET roles = '{performer,press}', permission_grants = '{read:money,edit:project_meta}', permission_revokes = '{}'
  WHERE user_id = a;
  PERFORM pg_temp.assert_parity('two roles plus grants');

  UPDATE public.project_membership SET permission_revokes = '{read:performance}' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('revoke read:performance (member without container access)');

  UPDATE public.project_membership SET roles = '{technical_director}', permission_revokes = '{read:performance}'
  WHERE user_id = a;
  PERFORM pg_temp.assert_parity('edit:performance implies read despite revoke');

  -- Cambiar el paquete del rol cambia a quien lo lleva.
  UPDATE public.workspace_role SET permissions = permissions || '{read:money}'
  WHERE workspace_id = v_ws AND code = 'technical_director';
  PERFORM pg_temp.assert_parity('role permissions edited');

  UPDATE public.workspace_role SET archived_at = now() WHERE workspace_id = v_ws AND code = 'technical_director';
  PERFORM pg_temp.assert_parity('role archived');

  UPDATE public.workspace_role SET archived_at = NULL WHERE workspace_id = v_ws AND code = 'technical_director';
  PERFORM pg_temp.assert_parity('role unarchived');

  -- Rol custom: creado, asignado, renombrado y borrado.
  INSERT INTO public.workspace_role (workspace_id, code, label, access_level, permissions)
  VALUES (v_ws, 'zzz_custom', 'Custom', 'member', '{read:conversation,edit:conversation}');
  UPDATE public.project_membership SET roles = '{zzz_custom}', permission_revokes = '{}' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('custom role assigned');

  UPDATE public.workspace_role SET code = 'zzz_custom2' WHERE workspace_id = v_ws AND code = 'zzz_custom';
  PERFORM pg_temp.assert_parity('custom role renamed (assignments dangle, as today)');

  DELETE FROM public.workspace_role WHERE workspace_id = v_ws AND code = 'zzz_custom2';
  PERFORM pg_temp.assert_parity('custom role deleted');

  -- Espacio: guest, admin, baja.
  UPDATE public.project_membership SET roles = '{performer}' WHERE user_id = a;
  UPDATE public.workspace_membership SET role = 'guest' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('workspace guest');

  UPDATE public.workspace_membership SET role = 'admin' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('workspace admin bypass');

  UPDATE public.workspace_membership SET role = 'viewer' WHERE user_id = a;
  PERFORM pg_temp.assert_parity('workspace viewer');

  DELETE FROM public.workspace_membership WHERE user_id = a;
  PERFORM pg_temp.assert_parity('workspace membership deleted, project membership left behind');

  -- Proyecto borrado blando y duro; usuario borrado.
  INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at) VALUES (v_ws, b, 'member', now());
  INSERT INTO public.project_membership (project_id, user_id, roles) VALUES (p, b, '{producer}');
  PERFORM pg_temp.assert_parity('second person');

  UPDATE public.project SET deleted_at = now() WHERE id = p;
  PERFORM pg_temp.assert_parity('project soft-deleted');

  DELETE FROM auth.users WHERE id = b;
  PERFORM pg_temp.assert_parity('user deleted (cascade)');

  IF EXISTS (SELECT 1 FROM public.membership WHERE user_id = b) THEN
    RAISE EXCEPTION 'membership rows survived the deleted user';
  END IF;
END $legacy$;

-- ── B · fase 3: el modelo nuevo manda, las tablas viejas son su proyección ─
DO $phase3$
DECLARE
  v_ws    uuid := (SELECT ws FROM t);
  v_owner uuid := (SELECT owner_id FROM t);
  a       uuid := '00000000-0000-7000-8000-00000000f011';
  b       uuid := '00000000-0000-7000-8000-00000000f012';
  p       uuid := '00000000-0000-7000-8000-00000000f0a0';
  v_token text;
  v_a_ws  uuid;
  v_a_p   uuid;
  v_b_p   uuid;
  v_got   text;
  v_pm    public.project_membership;
BEGIN
  IF NOT pg_temp.phase3() THEN
    RAISE NOTICE 'skip phase 3 paths: phase 3 is not applied';
    RETURN;
  END IF;

  -- Alta: handle_new_user escribe membership y la proyección la fila vieja.
  INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  VALUES (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-p3a@hour.test', now(), now(), now()),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-p3b@hour.test', now(), now(), now());
  IF (SELECT count(*) FROM public.workspace_membership wm
      JOIN public.membership m ON m.level = 'workspace' AND m.workspace_id = wm.workspace_id AND m.user_id = wm.user_id
      WHERE wm.user_id IN (a, b) AND wm.role = 'owner' AND m.workspace_role = 'owner') <> 2 THEN
    RAISE EXCEPTION 'signup did not project the personal workspace';
  END IF;
  PERFORM pg_temp.assert_parity('signup (handle_new_user)');

  -- Invitación con paquete (Equip, etiqueta performer) y aceptación.
  PERFORM pg_temp.as_user(v_owner);
  SELECT i.token INTO v_token
  FROM public.create_workspace_invitation(v_ws, 'rehearsal-p3a@hour.test', 'member', p, 'performer', 7, 'equip') i;
  PERFORM pg_temp.as_user(a);
  PERFORM public.accept_workspace_invitation(v_token);
  SELECT m.id INTO v_a_p FROM public.membership m WHERE m.level = 'project' AND m.project_id = p AND m.user_id = a;
  SELECT string_agg(f.key || ':' || mf.verb || ':' || mf.source, ',' ORDER BY f.key) INTO v_got
  FROM public.membership_facet mf JOIN public.facet f ON f.id = mf.facet_id WHERE mf.membership_id = v_a_p;
  IF v_got IS DISTINCT FROM 'materials:view:preset,tecnica:view:preset' THEN
    RAISE EXCEPTION 'equip on a project expanded to %', v_got;
  END IF;
  SELECT * INTO v_pm FROM public.project_membership WHERE project_id = p AND user_id = a;
  IF v_pm.roles <> '{performer}' OR v_pm.permission_grants <> '{read:performance}' THEN
    RAISE EXCEPTION 'project_membership projected as roles=% grants=%', v_pm.roles, v_pm.permission_grants;
  END IF;
  PERFORM pg_temp.assert_parity('invitation with equip accepted');

  -- La llamada de seis argumentos del Worker desplegado sigue valiendo: Mínim.
  PERFORM pg_temp.as_user(v_owner);
  SELECT i.token INTO v_token
  FROM public.create_workspace_invitation(p_workspace_id => v_ws, p_email => 'rehearsal-p3b@hour.test',
         p_role => 'member', p_project_id => p, p_project_role_code => 'director', p_expires_days => 7) i;
  IF (SELECT wi.project_preset FROM public.workspace_invitation wi
      WHERE wi.workspace_id = v_ws AND wi.email = 'rehearsal-p3b@hour.test' AND wi.accepted_at IS NULL AND wi.revoked_at IS NULL)
     IS DISTINCT FROM 'minim' THEN
    RAISE EXCEPTION 'six-argument invitation did not default to minim';
  END IF;
  PERFORM pg_temp.as_user(b);
  PERFORM public.accept_workspace_invitation(v_token);
  SELECT m.id INTO v_b_p FROM public.membership m WHERE m.level = 'project' AND m.project_id = p AND m.user_id = b;
  IF (SELECT m.container_verb FROM public.membership m WHERE m.id = v_b_p) IS DISTINCT FROM 'view'
     OR EXISTS (SELECT 1 FROM public.membership_facet mf WHERE mf.membership_id = v_b_p) THEN
    RAISE EXCEPTION 'minim invitation gave more than the container';
  END IF;
  PERFORM pg_temp.assert_parity('six-argument invitation accepted (minim)');

  -- Rol del espacio por id de membership.
  PERFORM pg_temp.as_user(v_owner);
  SELECT m.id INTO v_a_ws FROM public.membership m WHERE m.level = 'workspace' AND m.workspace_id = v_ws AND m.user_id = a;
  IF NOT EXISTS (SELECT 1 FROM public.list_workspace_access(v_ws) l WHERE l.access_kind = 'member' AND l.id = v_a_ws) THEN
    RAISE EXCEPTION 'list_workspace_access does not return membership ids';
  END IF;
  PERFORM public.update_workspace_member_role(v_a_ws, 'viewer');
  PERFORM pg_temp.assert_parity('workspace role viewer');
  PERFORM public.update_workspace_member_role(v_a_ws, 'guest');
  PERFORM pg_temp.assert_parity('workspace role guest');
  PERFORM public.update_workspace_member_role(v_a_ws, 'member');
  PERFORM pg_temp.assert_parity('workspace role member');

  -- Paquete en proyecto y overrides.
  PERFORM public.grant_container_preset('project', p, a, 'coordinacio');
  SELECT * INTO v_pm FROM public.project_membership WHERE project_id = p AND user_id = a;
  IF NOT v_pm.permission_grants @> '{edit:performance,read:money,edit:conversation,edit:project_meta}'
     OR 'edit:money' = ANY (v_pm.permission_grants) THEN
    RAISE EXCEPTION 'coordinacio projected as %', v_pm.permission_grants;
  END IF;
  PERFORM pg_temp.assert_parity('coordinacio on a project');

  PERFORM public.set_membership_facet(v_a_p, private.standard_facet_id('diners'), 'edit');
  IF NOT public.has_permission_for_user(p, 'edit:money', a) THEN
    RAISE EXCEPTION 'diners edit override did not grant edit:money';
  END IF;
  PERFORM pg_temp.assert_parity('override diners edit');

  PERFORM public.set_membership_facet(v_a_p, private.standard_facet_id('diners'), NULL);
  IF public.has_permission_for_user(p, 'read:money', a) THEN
    RAISE EXCEPTION 'removing diners left read:money';
  END IF;
  PERFORM pg_temp.assert_parity('override diners removed');

  BEGIN
    PERFORM public.set_membership_facet(v_a_p, private.standard_facet_id('logistica'), 'view');
    RAISE EXCEPTION 'logistica accepted at project level';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: logistica rejected at project level (override)';
  END;

  -- Techo del delegante: A (Coordinació sin Diners) da Equip a B, no Direcció
  -- ni Diners; B (Equip) no toca a A; A quita a B.
  PERFORM pg_temp.as_user(a);
  PERFORM public.grant_container_preset('project', p, b, 'equip');
  PERFORM pg_temp.assert_parity('coordinator grants equip');
  BEGIN
    PERFORM public.grant_container_preset('project', p, b, 'direccio');
    RAISE EXCEPTION 'coordinator granted direccio';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: coordinator cannot grant direccio (ceiling)';
  END;
  BEGIN
    PERFORM public.set_membership_facet(v_b_p, private.standard_facet_id('diners'), 'view');
    RAISE EXCEPTION 'coordinator without diners granted diners';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: no diners override without diners (ceiling)';
  END;
  PERFORM pg_temp.as_user(b);
  BEGIN
    PERFORM public.revoke_membership(v_a_p);
    RAISE EXCEPTION 'equip holder revoked a coordinator';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: equip holder cannot revoke a coordinator';
  END;
  BEGIN
    PERFORM public.grant_container_preset('project', p, a, 'minim');
    RAISE EXCEPTION 'equip holder downgraded a coordinator';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: equip holder cannot downgrade a coordinator';
  END;
  PERFORM pg_temp.as_user(a);
  PERFORM public.revoke_membership(v_b_p);
  IF EXISTS (SELECT 1 FROM public.project_membership WHERE project_id = p AND user_id = b) THEN
    RAISE EXCEPTION 'revoked project membership survived in project_membership';
  END IF;
  PERFORM pg_temp.assert_parity('project membership revoked');

  -- Paquete en el espacio: Direcció es admin; otro paquete quita admin.
  PERFORM pg_temp.as_user(v_owner);
  PERFORM public.grant_container_preset('workspace', v_ws, a, 'direccio');
  IF private.model_workspace_role(v_ws, a) <> 'admin' THEN
    RAISE EXCEPTION 'direccio on the workspace did not make admin';
  END IF;
  PERFORM pg_temp.assert_parity('direccio on the workspace');
  PERFORM public.grant_container_preset('workspace', v_ws, a, 'equip');
  IF private.model_workspace_role(v_ws, a) <> 'member' THEN
    RAISE EXCEPTION 'equip on the workspace did not take admin away';
  END IF;
  PERFORM pg_temp.assert_parity('equip on the workspace');
  BEGIN
    PERFORM public.grant_container_preset('workspace', v_ws, v_owner, 'equip');
    RAISE EXCEPTION 'owner demoted by a preset';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: the owner is not touched by a preset';
  END;
  BEGIN
    PERFORM public.set_membership_facet(v_a_ws, private.standard_facet_id('diners'), 'view');
    RAISE EXCEPTION 'workspace-level facet accepted';
  EXCEPTION WHEN feature_not_supported THEN
    RAISE NOTICE 'ok: workspace-level facets wait for a decision';
  END;

  -- Los permisos de un rol ya no cambian accesos.
  UPDATE public.workspace_role SET permissions = permissions || '{read:money,edit:money}'
  WHERE workspace_id = v_ws AND code = 'performer';
  IF public.has_permission_for_user(p, 'read:money', a) THEN
    RAISE EXCEPTION 'role permissions still grant access in phase 3';
  END IF;
  PERFORM pg_temp.assert_parity('role permissions edited (no effect)');

  -- Las tablas viejas, cerradas a la API.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.project_membership (project_id, user_id, roles) VALUES (p, b, '{}');
    RAISE EXCEPTION 'authenticated wrote project_membership directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: project_membership is closed to the API';
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE public.workspace_membership SET role = 'admin' WHERE user_id = a;
    RAISE EXCEPTION 'authenticated wrote workspace_membership directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: workspace_membership is closed to the API';
  END;

  -- Baja del espacio: se van todas sus membresías y sus filas viejas.
  PERFORM public.grant_container_preset('bolo', (SELECT bo.id FROM public.bolo bo WHERE bo.workspace_id = v_ws AND bo.deleted_at IS NULL LIMIT 1), a, 'minim')
  WHERE EXISTS (SELECT 1 FROM public.bolo bo WHERE bo.workspace_id = v_ws AND bo.deleted_at IS NULL);
  PERFORM public.revoke_workspace_member(v_a_ws);
  IF EXISTS (SELECT 1 FROM public.membership WHERE workspace_id = v_ws AND user_id = a)
     OR EXISTS (SELECT 1 FROM public.workspace_membership WHERE workspace_id = v_ws AND user_id = a)
     OR EXISTS (SELECT 1 FROM public.project_membership WHERE project_id = p AND user_id = a) THEN
    RAISE EXCEPTION 'revoke_workspace_member left rows behind';
  END IF;
  PERFORM pg_temp.assert_parity('workspace member revoked');

  -- Cascadas: usuario borrado.
  PERFORM public.grant_container_preset('project', p, b, 'equip');
  PERFORM pg_temp.as_user(NULL);
  DELETE FROM auth.users WHERE id = b;
  IF EXISTS (SELECT 1 FROM public.membership WHERE user_id = b) THEN
    RAISE EXCEPTION 'membership rows survived the deleted user';
  END IF;
  PERFORM pg_temp.assert_parity('user deleted (cascade)');
END $phase3$;

DELETE FROM public.project WHERE id = '00000000-0000-7000-8000-00000000f0a0';
SELECT pg_temp.assert_parity('project hard-deleted (cascade)');

DO $$
BEGIN
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
    INSERT INTO public.membership_facet (membership_id, facet_id, verb, source)
    VALUES (v_mid, private.standard_facet_id('logistica'), 'view', 'override');
    RAISE EXCEPTION 'level guard let logistica in at project level';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: logistica rejected at project level';
  END;
END $$;

-- Paquetes en un bolo: el owner da Equip; quien tiene Equip puede dar Mínim y
-- Equip, no Coordinació. En proyecto: la fase 2 lo rechaza, la 3 lo acepta.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-00000000f003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-c@hour.test', now(), now()),
       ('00000000-0000-7000-8000-00000000f004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-d@hour.test', now(), now());

DO $$
DECLARE
  v_ws    uuid := (SELECT ws FROM t);
  c       uuid := '00000000-0000-7000-8000-00000000f003';
  d       uuid := '00000000-0000-7000-8000-00000000f004';
BEGIN
  IF pg_temp.phase3() THEN
    INSERT INTO public.membership (workspace_id, level, user_id, workspace_role, accepted_at)
    SELECT v_ws, 'workspace', u.id, 'member', now() FROM (VALUES (c), (d)) u (id);
  ELSE
    INSERT INTO public.workspace_membership (workspace_id, user_id, role, accepted_at)
    SELECT v_ws, u.id, 'member', now() FROM (VALUES (c), (d)) u (id);
  END IF;
END $$;
SELECT pg_temp.assert_parity('two members for the bolo presets');

DO $$
DECLARE
  v_ws    uuid := (SELECT ws FROM t);
  v_owner uuid := (SELECT owner_id FROM t);
  v_bolo  uuid;
  v_mid   uuid;
  v_keys  text;
BEGIN
  SELECT b.id INTO v_bolo FROM public.bolo b WHERE b.workspace_id = v_ws AND b.deleted_at IS NULL LIMIT 1;
  IF v_bolo IS NULL THEN
    RAISE NOTICE 'skip presets: no bolo in this workspace';
    RETURN;
  END IF;

  PERFORM pg_temp.as_user(v_owner);
  v_mid := public.grant_container_preset('bolo', v_bolo, '00000000-0000-7000-8000-00000000f003', 'equip');
  SELECT string_agg(f.key || ':' || mf.verb || ':' || mf.source, ',' ORDER BY f.key) INTO v_keys
  FROM public.membership_facet mf JOIN public.facet f ON f.id = mf.facet_id
  WHERE mf.membership_id = v_mid;
  IF v_keys IS DISTINCT FROM 'comidas:view:preset,full_de_ruta:view:preset,logistica:view:preset,materials:view:preset,tecnica:view:preset' THEN
    RAISE EXCEPTION 'equip on a bolo expanded to %', v_keys;
  END IF;
  RAISE NOTICE 'ok: owner grants equip on a bolo (%)', v_keys;

  IF pg_temp.phase3() THEN
    PERFORM public.grant_container_preset('project', (SELECT project_id FROM public.bolo WHERE id = v_bolo),
                                          '00000000-0000-7000-8000-00000000f003', 'minim');
    RAISE NOTICE 'ok: project-level preset accepted in phase 3';
  ELSE
    BEGIN
      PERFORM public.grant_container_preset('project', (SELECT project_id FROM public.bolo WHERE id = v_bolo),
                                            '00000000-0000-7000-8000-00000000f003', 'equip');
      RAISE EXCEPTION 'project-level preset accepted in phase 2';
    EXCEPTION WHEN feature_not_supported THEN
      RAISE NOTICE 'ok: project-level preset waits for phase 3';
    END;
  END IF;

  PERFORM pg_temp.as_user('00000000-0000-7000-8000-00000000f003');
  PERFORM public.grant_container_preset('bolo', v_bolo, '00000000-0000-7000-8000-00000000f004', 'minim');
  PERFORM public.grant_container_preset('bolo', v_bolo, '00000000-0000-7000-8000-00000000f004', 'equip');
  RAISE NOTICE 'ok: equip holder delegates minim and equip';
  BEGIN
    PERFORM public.grant_container_preset('bolo', v_bolo, '00000000-0000-7000-8000-00000000f004', 'coordinacio');
    RAISE EXCEPTION 'equip holder granted coordinacio';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: equip holder cannot grant coordinacio (ceiling)';
  END;

  PERFORM pg_temp.as_user(NULL);
END $$;
SELECT pg_temp.assert_parity('presets on a bolo (and a project in phase 3)');

DO $$ BEGIN RAISE NOTICE 'rehearsal ok'; END $$;

ROLLBACK;
