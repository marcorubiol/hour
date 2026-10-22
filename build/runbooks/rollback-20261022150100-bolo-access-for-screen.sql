-- Rollback de 20261022150100_bolo_access_for_screen.
-- Devuelve public.bolo_access(uuid) y public.preview_workspace_invitation(text)
-- a los cuerpos de 20261022100000 (los vivos del 2026-10-22, md5
-- e444ebb81d051dfb94574b4fdbdfe5e3 y 30ec75343ab6b6fca34dffef7c3f06d1 en
-- pg_get_functiondef): sin members[].person_id, can_extend ni readers, y la
-- vista previa sin landing_performed_at, bolo_preset ni bolo_access_last_day.
-- Sin datos que tocar. El Worker de esta rama trata las claves y columnas
-- como opcionales (sin «va y no lo ve», sin «Cambiar la fecha», sin el día de
-- la función en la página de aceptar), así que puede quedarse desplegado.
-- Probado en local dentro de una transacción con ROLLBACK (2026-10-22).

BEGIN;

CREATE OR REPLACE FUNCTION public.bolo_access(p_bolo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller    uuid := (SELECT auth.uid());
  v_bolo      public.bolo;
  v_minim     boolean;
  v_equip     boolean;
  v_members   jsonb;
  v_invites   jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_bolo FROM public.bolo b WHERE b.id = p_bolo_id AND b.deleted_at IS NULL;
  IF v_caller IS NULL OR v_bolo.id IS NULL
     OR private.model_container_verb_at('bolo', v_bolo.id, v_caller) IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  v_minim := private.can_grant_preset('bolo', v_bolo.id, 'minim', v_caller);
  v_equip := private.can_grant_preset('bolo', v_bolo.id, 'equip', v_caller);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', m.id,
           'user_id', m.user_id,
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
  END IF;

  RETURN jsonb_build_object(
    'bolo_id', v_bolo.id,
    'ends_at', private.bolo_access_ends_at(v_bolo.id),
    'can_invite', jsonb_build_object('minim', v_minim, 'equip', v_equip),
    'members', v_members,
    'invitations', v_invites
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bolo_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolo_access(uuid) TO authenticated;

DROP FUNCTION public.preview_workspace_invitation(text);
CREATE FUNCTION public.preview_workspace_invitation(p_token text)
 RETURNS TABLE(workspace_id uuid, workspace_slug text, workspace_name text, email text, role membership_role,
               project_id uuid, project_name text, project_role_code text, expires_at timestamp with time zone,
               bolo_id uuid, bolo_label text, landing_performance_id uuid)
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
         (SELECT pf.id
          FROM public.performance pf
          WHERE pf.bolo_id = b.id AND pf.deleted_at IS NULL
          ORDER BY (pf.performed_at < current_date),
                   CASE WHEN pf.performed_at >= current_date THEN pf.performed_at END ASC,
                   pf.performed_at DESC
          LIMIT 1)
  FROM public.workspace_invitation wi
  JOIN public.workspace w ON w.id = wi.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.project p ON p.id = wi.project_id AND p.deleted_at IS NULL
  LEFT JOIN public.bolo b ON b.id = wi.bolo_id AND b.deleted_at IS NULL
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

COMMIT;
