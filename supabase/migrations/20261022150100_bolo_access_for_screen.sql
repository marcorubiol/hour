-- Comms, carril 2, fase 2: lo que la pantalla de acceso del bolo necesita de
-- `bolo_access` (plan build/plans/2026-10-22-comms-threads-facets.md § 3.1).
--
-- 1. `bolo_access`: solo cambia lo que devuelve (misma firma, jsonb), tres
--    claves más:
--   · `members[].person_id`: la persona de esa cuenta (user_profile.person_id),
--     para cruzarla con «quién va», que habla de personas, no de logins.
--   · `can_extend`: si quien llama puede mover la fecha de una membresía del
--     bolo. Es la misma condición que `set_membership_expiry` añade sobre
--     `can_manage_membership` (estar por encima del bolo, en proyecto o línea,
--     o ser admin del espacio), para que la pantalla no ofrezca «Ampliar» a
--     quien la RPC va a rechazar (el invitado con Equip, sobre otro invitado).
--   · `readers`: las personas cuya cuenta lee el tablón de este bolo por
--     cualquier nivel (espacio, proyecto, línea, bolo, función), para que
--     «quién va» diga «va y no lo ve». Solo para quien puede invitar (como las
--     invitaciones pendientes): quien no puede invitar no necesita saberlo.
--     No dice el nivel ni el paquete de nadie.
-- 2. `preview_workspace_invitation`: la página de aceptar dice la función
--    donde aterriza y hasta cuándo dura el acceso, no solo el id. Tres
--    columnas más al final (`landing_performed_at`, `bolo_preset`,
--    `bolo_access_last_day`); cambia lo que devuelve, así que DROP y CREATE
--    con la misma entrada, como en 20261022100000. El Worker pasa la fila tal
--    cual (`api/invitations`). La fecha sale solo para quien tiene el token y
--    el correo de la invitación, como el resto de la vista previa.
-- Sin dinero, como antes. Grants: los de la base viva (EXECUTE a
-- authenticated), reescritos explícitos.
--
-- Firmas y cuerpos de la base viva con `pg_get_functiondef` (2026-10-22):
-- bolo_access md5 e444ebb81d051dfb94574b4fdbdfe5e3 y
-- preview_workspace_invitation md5 30ec75343ab6b6fca34dffef7c3f06d1, los de
-- 20261022100000.
-- Rollback: build/runbooks/rollback-20261022150100-bolo-access-for-screen.sql.

-- ── 1 · bolo_access ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bolo_access(p_bolo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller    uuid := (SELECT auth.uid());
  v_bolo      public.bolo;
  v_minim     boolean;
  v_equip     boolean;
  v_extend    boolean;
  v_members   jsonb;
  v_invites   jsonb := '[]'::jsonb;
  v_readers   jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_bolo FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;
  IF v_caller IS NULL OR v_bolo.id IS NULL
     OR private.model_container_verb_at('bolo', v_bolo.id, v_caller) IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  v_minim := private.can_grant_preset('bolo', v_bolo.id, 'minim', v_caller);
  v_equip := private.can_grant_preset('bolo', v_bolo.id, 'equip', v_caller);
  -- 20261022150100: la condición de set_membership_expiry.
  v_extend := EXISTS (
    SELECT 1 FROM private.chain_memberships('bolo', v_bolo.id, v_caller) c
    WHERE c.level IN ('project', 'line')
       OR (c.level = 'workspace' AND c.workspace_role IN ('owner', 'admin'))
  );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', m.id,
           'user_id', m.user_id,
           'person_id', up.person_id,
           'name', up.full_name,
           'preset', m.preset,
           'ends_at', private.membership_ends_at(m),
           'expires_with_bolo', m.expires_with_bolo,
           'live', coalesce(private.membership_ends_at(m) > now(), true),
           'can_manage', private.can_manage_membership(m.id, v_caller)
         ) ORDER BY up.full_name NULLS LAST, m.user_id), '[]'::jsonb)
  INTO v_members
  FROM public.membership m
  LEFT JOIN public.user_profile up ON up.user_id = m.user_id
  WHERE m.level = 'bolo' AND m.bolo_id = v_bolo.id AND m.accepted_at IS NOT NULL;

  IF v_minim THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', wi.id,
             'email', wi.email::text,
             'preset', wi.bolo_preset,
             'person_id', wi.person_id,
             'invited_by', wi.invited_by,
             'expires_at', wi.expires_at
           ) ORDER BY wi.created_at DESC), '[]'::jsonb)
    INTO v_invites
    FROM public.workspace_invitation wi
    WHERE wi.bolo_id = v_bolo.id
      AND wi.accepted_at IS NULL AND wi.revoked_at IS NULL AND wi.expires_at > now();

    -- 20261022150100: quién lee el tablón, como personas.
    SELECT coalesce(jsonb_agg(DISTINCT up.person_id), '[]'::jsonb)
    INTO v_readers
    FROM (SELECT DISTINCT m.user_id
          FROM public.membership m
          WHERE m.workspace_id = v_bolo.workspace_id AND m.accepted_at IS NOT NULL) u
    JOIN public.user_profile up ON up.user_id = u.user_id AND up.person_id IS NOT NULL
    WHERE private.model_container_verb_at('bolo', v_bolo.id, u.user_id) IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'bolo_id', v_bolo.id,
    'ends_at', private.bolo_access_ends_at(v_bolo.id),
    'can_invite', jsonb_build_object('minim', v_minim, 'equip', v_equip),
    'can_extend', v_extend,
    'members', v_members,
    'invitations', v_invites,
    'readers', v_readers
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bolo_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolo_access(uuid) TO authenticated;

-- ── 2 · la vista previa dice la función y el último día ──────────────────
DROP FUNCTION public.preview_workspace_invitation(text);
CREATE FUNCTION public.preview_workspace_invitation(p_token text)
 RETURNS TABLE(workspace_id uuid, workspace_slug text, workspace_name text, email text, role membership_role,
               project_id uuid, project_name text, project_role_code text, expires_at timestamp with time zone,
               bolo_id uuid, bolo_label text, landing_performance_id uuid,
               landing_performed_at date, bolo_preset text, bolo_access_last_day date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT wi.workspace_id,
         w.slug,
         w.name,
         wi.email::text,
         wi.role,
         wi.project_id,
         p.name,
         wi.project_role_code,
         wi.expires_at,
         b.id,
         nullif(concat_ws(' · ', nullif(btrim(b.venue_name), ''), nullif(btrim(b.city), '')), ''),
         landing.id,
         landing.performed_at,
         wi.bolo_preset,
         -- El último día con acceso: el siguiente a la última función viva
         -- (private.bolo_access_ends_at acaba al empezar el otro).
         (SELECT max(pf.performed_at) + 1
          FROM public.performance pf
          WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL)
  FROM public.workspace_invitation wi
  JOIN public.workspace w ON w.id = wi.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.project p ON p.id = wi.project_id AND p.deleted_at IS NULL
  LEFT JOIN public.bolo b ON b.id = wi.bolo_id AND b.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT pf.id, pf.performed_at
    FROM public.performance pf
    WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
    ORDER BY (pf.performed_at < current_date),
             CASE WHEN pf.performed_at >= current_date THEN pf.performed_at END ASC,
             pf.performed_at DESC
    LIMIT 1
  ) landing ON true
  JOIN auth.users au
    ON au.id = (SELECT auth.uid())
   AND au.email_confirmed_at IS NOT NULL
   AND lower(au.email::text) = lower(wi.email::text)
  WHERE wi.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL
    AND wi.expires_at > now();
$function$;
REVOKE ALL ON FUNCTION public.preview_workspace_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_workspace_invitation(text) TO authenticated;
