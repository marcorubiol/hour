-- ADR-099, añadido del 2026-10-11 (firma): la firma es de la persona en cada
-- compañía, una por persona y espacio, y no del buzón. El buzón común firma
-- con la firma de la compañía, que edita un admin.
--
-- Aditiva según § 34:
--   · `workspace_membership.mail_signature`: la firma de quien es miembro en
--     ese espacio. Vive en la membresía porque existe para todo el que puede
--     enviar (el dossier solo existe si la persona compartió su perfil) y se
--     va con ella cuando la persona sale del espacio. La lee quien ya lee la
--     fila (la propia, y un admin las del espacio: policy
--     `workspace_membership_select`); `authenticated` no tiene UPDATE en la
--     tabla, así que solo se escribe por `set_my_mail_signature`, la propia.
--   · `workspace.website`, `workspace.phone`, `workspace.mail_signature`: los
--     datos de contacto de la compañía con los que Hour propone las firmas, y
--     la firma del buzón común. `workspace` tiene SELECT y UPDATE a tabla
--     entera para `authenticated`: los miembros las leen y las escribe un
--     admin (policy `workspace_update`), como `new_conversations_private`.
--   · Se copian las firmas que ya había en los buzones: la del personal a la
--     membresía de su dueño, la del común a la compañía. Solo donde no hay
--     nada; no se borra ninguna.
--   · `mail_account.signature` y `set_mail_signature` dejan de usarse desde
--     hoy y se retiran en una migración aparte, más adelante.
--
-- NULL en una firma = la propuesta de Hour, montada en el momento con lo que
-- haya (nombre, rol en la compañía, compañía, web, teléfono). Volver a la
-- propuesta es guardar NULL.
--
-- Rollback: build/runbooks/rollback-20261011-mail-signature-person.sql.

-- ── Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.workspace_membership
  ADD COLUMN mail_signature text,
  ADD CONSTRAINT workspace_membership_mail_signature_length
    CHECK (mail_signature IS NULL OR length(mail_signature) <= 2000);

COMMENT ON COLUMN public.workspace_membership.mail_signature IS
  'ADR-099 (firma): this member''s mail signature in this workspace. NULL = Hour''s proposal. Readable under workspace_membership_select (own row, admins); written only through set_my_mail_signature, one''s own.';

ALTER TABLE public.workspace
  ADD COLUMN website text,
  ADD COLUMN phone text,
  ADD COLUMN mail_signature text,
  ADD CONSTRAINT workspace_website_length CHECK (website IS NULL OR length(website) <= 2048),
  ADD CONSTRAINT workspace_phone_length CHECK (phone IS NULL OR length(phone) <= 64),
  ADD CONSTRAINT workspace_mail_signature_length
    CHECK (mail_signature IS NULL OR length(mail_signature) <= 2000);

COMMENT ON COLUMN public.workspace.website IS
  'ADR-099 (firma): the company''s website, used in the proposed signatures. Admins set it (workspace_update policy).';
COMMENT ON COLUMN public.workspace.phone IS
  'ADR-099 (firma): the company''s phone, used in the proposed signatures. Admins set it (workspace_update policy).';
COMMENT ON COLUMN public.workspace.mail_signature IS
  'ADR-099 (firma): the signature of the shared mailbox. NULL = Hour''s proposal. Admins set it (workspace_update policy).';

COMMENT ON COLUMN public.mail_account.signature IS
  'DEPRECATED (2026-10-11): the signature moved to workspace_membership.mail_signature (personal) and workspace.mail_signature (shared). Unused; dropped in a later migration.';

-- ── Lo que ya había ───────────────────────────────────────────────────────
UPDATE public.workspace_membership m
SET mail_signature = a.signature
FROM public.mail_account a
WHERE a.scope = 'personal'
  AND a.signature IS NOT NULL
  AND a.workspace_id = m.workspace_id
  AND a.owner_user_id = m.user_id
  AND m.mail_signature IS NULL;

UPDATE public.workspace w
SET mail_signature = s.signature
FROM (
  SELECT DISTINCT ON (workspace_id) workspace_id, signature
  FROM public.mail_account
  WHERE scope = 'workspace' AND signature IS NOT NULL
  ORDER BY workspace_id, updated_at DESC
) s
WHERE s.workspace_id = w.id
  AND w.mail_signature IS NULL;

-- ── RPC ───────────────────────────────────────────────────────────────────

-- Lo que hace falta para firmar en un espacio: las dos firmas guardadas (NULL
-- = propuesta) y las piezas de la propuesta. Solo las de quien llama, y solo
-- si es miembro. El nombre y el rol salen de su dossier en ese espacio si lo
-- tiene; si no, el nombre de su perfil. Lo usan Ajustes y el envío.
CREATE FUNCTION public.my_mail_signature(p_workspace_id uuid)
RETURNS TABLE (
  full_name          text,
  title              text,
  company_name       text,
  company_website    text,
  company_phone      text,
  signature          text,
  company_signature  text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(nullif(btrim(wp.full_name), ''), nullif(btrim(up.full_name), '')),
         nullif(btrim(wp.title), ''),
         w.name,
         nullif(btrim(w.website), ''),
         nullif(btrim(w.phone), ''),
         m.mail_signature,
         w.mail_signature
  FROM public.workspace_membership m
  JOIN public.workspace w ON w.id = m.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN public.user_profile up ON up.user_id = m.user_id
  LEFT JOIN public.workspace_person wp
    ON wp.workspace_id = m.workspace_id AND wp.person_id = up.person_id AND wp.deleted_at IS NULL
  WHERE m.workspace_id = p_workspace_id
    AND m.user_id = (SELECT auth.uid())
    AND public.is_workspace_member(p_workspace_id);
$$;

-- Guardar la propia firma en un espacio. Vacía o NULL = volver a la propuesta.
CREATE FUNCTION public.set_my_mail_signature(p_workspace_id uuid, p_signature text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_sig    text := nullif(btrim(coalesce(p_signature, '')), '');
BEGIN
  IF v_caller IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF length(v_sig) > 2000 THEN
    RAISE EXCEPTION 'signature too long' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace_membership
  SET mail_signature = v_sig
  WHERE workspace_id = p_workspace_id AND user_id = v_caller
    AND mail_signature IS DISTINCT FROM v_sig;
END;
$$;

ALTER FUNCTION public.my_mail_signature(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_my_mail_signature(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_mail_signature(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_mail_signature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_mail_signature(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_mail_signature(uuid, text) TO authenticated, service_role;
