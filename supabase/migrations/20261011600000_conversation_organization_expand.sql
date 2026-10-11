-- ADR-102, fase 1 (expand): la conversación de difusión es con la sala.
-- Plan: build/plans/2026-10-11-conversation-with-venue.md § 4, fase 1.
--
-- Aditiva. Conviven los dos modelos: `conversation.person_id` sigue mandando
-- para todo el código de hoy, y el nuevo (organización + contactos) se rellena
-- y se mantiene coherente con él hasta el contract (fase 4).
--
-- WHAT THIS DOES:
--   1. `conversation.organization_id`, nullable, con FK compuesta al mismo
--      espacio (`conversation_workspace_organization_fkey`, el nombre que
--      usarán los embeds de la fase 2) y su índice. Sin unicidad por
--      organización todavía: el alta de hoy la rompería (fase 2).
--   2. `conversation_contact`: las personas de la conversación, con su papel y
--      sus fechas. Un principal como mucho, y el principal siempre vigente.
--      RLS forzada; lectura heredada de la conversación (como
--      `conversation_event`, ADR-098); sin escritura directa para clientes.
--   3. Relleno, en esta misma transacción: la organización del dossier y un
--      contacto principal por conversación, también las borradas (revivir no
--      pierde el contacto). Comprobaciones que abortan si el resultado no cuadra.
--   4. Doble escritura mientras conviven: un INSERT o un cambio de
--      `person_id`/`role` en `conversation` deja el contacto principal igual a
--      (person_id, role), y rellena la organización desde el dossier si falta.
--   5. Dos RPC, aún sin uso en la UI: `set_conversation_contact` y
--      `end_conversation_contact`. Gate `edit:conversation`; «no existe» y «no
--      es tuyo» dan el mismo 42501.
--
-- Desviación del plan, a propósito: el relleno deja `since` a NULL (sin
-- límite inferior), no `first_contacted_at::date`. Las 154 conversaciones de
-- `muk-cia` se dieron de alta en octubre y su `first_contacted_at` es la fecha
-- del alta; con él de `since`, el emparejado por fechas de la fase 2 dejaría
-- fuera todo el correo anterior (el historial que ADR-100 quiere traer).
--
-- Regla de convivencia (se levanta en la fase 4): el principal es la persona
-- de `conversation.person_id`. Por eso no se puede cerrar ni degradar al
-- principal sin nombrar antes a otro; y nombrar principal a otra persona
-- cambia `conversation.person_id` (23505 si esa persona ya tiene otra
-- conversación compartida en el proyecto: la unicidad vieja sigue viva).
--
-- Datos: escribe filas nuevas (columna y tabla nuevas); no reescribe nada que
-- exista. Rollback: build/runbooks/rollback-20261011-conversation-organization-expand.sql.

-- ── 1 · conversation.organization_id ──────────────────────────────────────
ALTER TABLE public.conversation
  ADD COLUMN organization_id uuid;

-- MATCH SIMPLE: mientras sea NULL no se comprueba. Sin ON DELETE: una
-- organización se borra en blando, y en el contract la columna es NOT NULL.
ALTER TABLE public.conversation
  ADD CONSTRAINT conversation_workspace_organization_fkey
  FOREIGN KEY (workspace_id, organization_id)
  REFERENCES public.workspace_organization (workspace_id, id);

CREATE INDEX conversation_workspace_organization_idx
  ON public.conversation (workspace_id, organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON COLUMN public.conversation.organization_id IS
  'ADR-102: who the conversation is with (the venue or whoever programs it). Nullable until the contract phase; filled from the dossier while conversation.person_id still exists.';

-- ── 2 · conversation_contact ──────────────────────────────────────────────
CREATE TABLE public.conversation_contact (
  id              uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  -- Derivado de la conversación por quien escribe; nunca lo manda el cliente.
  workspace_id    uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversation(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL,
  role            text,
  since           date,
  until           date,
  is_primary      boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- El dossier del mismo espacio. Si se borra el dossier, su papel en las
  -- conversaciones se va con él.
  CONSTRAINT conversation_contact_workspace_person_fkey
    FOREIGN KEY (workspace_id, person_id)
    REFERENCES public.workspace_person (workspace_id, person_id) ON DELETE CASCADE,
  -- Una fila por persona: volver es poner `until` a NULL.
  CONSTRAINT conversation_contact_conversation_person_key
    UNIQUE (conversation_id, person_id),
  CONSTRAINT conversation_contact_dates
    CHECK (until IS NULL OR since IS NULL OR until >= since),
  -- El principal es siempre un contacto vigente.
  CONSTRAINT conversation_contact_primary_is_current
    CHECK (NOT is_primary OR until IS NULL),
  CONSTRAINT conversation_contact_role_length
    CHECK (role IS NULL OR (length(btrim(role)) > 0 AND length(role) <= 200))
);

COMMENT ON TABLE public.conversation_contact IS
  'ADR-102: the people of a conversation with a venue, with their role and dates. until NULL = current contact. At most one primary, always current. Read inherits the conversation''s RLS; written only through set_conversation_contact / end_conversation_contact (and the dual-write trigger while conversation.person_id exists).';
COMMENT ON COLUMN public.conversation_contact.since IS
  'First day this person speaks for the venue in this conversation. NULL = no lower bound (unknown).';
COMMENT ON COLUMN public.conversation_contact.until IS
  'Last day this person speaks for the venue in this conversation. NULL = current contact.';

-- Un principal por conversación como mucho.
CREATE UNIQUE INDEX conversation_contact_primary_uidx
  ON public.conversation_contact (conversation_id)
  WHERE is_primary;
-- La ficha de persona y el emparejado de correo van de la persona a sus
-- conversaciones.
CREATE INDEX conversation_contact_workspace_person_idx
  ON public.conversation_contact (workspace_id, person_id);
CREATE INDEX conversation_contact_created_by_idx
  ON public.conversation_contact (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.conversation_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_contact FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_contact OWNER TO postgres;

REVOKE ALL ON TABLE public.conversation_contact FROM PUBLIC, anon, authenticated;
-- Solo lectura, y a tabla entera (sin grant por columnas).
GRANT SELECT ON TABLE public.conversation_contact TO authenticated;
GRANT ALL ON TABLE public.conversation_contact TO service_role;

-- Hereda la frontera de la conversación literalmente: la subconsulta corre
-- con la RLS de `conversation` del invocador (`read:conversation`, viva, y no
-- privada de otro). Un contacto no se ve si su conversación no se ve.
CREATE POLICY conversation_contact_select ON public.conversation_contact
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation c
      WHERE c.id = conversation_contact.conversation_id
    )
  );

CREATE TRIGGER conversation_contact_audit
AFTER INSERT OR DELETE OR UPDATE ON public.conversation_contact
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

CREATE TRIGGER conversation_contact_set_updated_at
BEFORE UPDATE ON public.conversation_contact
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER conversation_contact_guard_ws
BEFORE UPDATE ON public.conversation_contact
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();

-- ── 3 · relleno ───────────────────────────────────────────────────────────
-- La organización del dossier (aunque el dossier esté borrado: es dónde
-- trabajaba). Una organización borrada no se copia. Sin tocar `updated_at`:
-- el relleno no es una edición de nadie (la auditoría sí lo apunta).
ALTER TABLE public.conversation DISABLE TRIGGER conversation_set_updated_at;

UPDATE public.conversation c
SET organization_id = wp.organization_id
FROM public.workspace_person wp
JOIN public.workspace_organization o
  ON o.workspace_id = wp.workspace_id AND o.id = wp.organization_id
 AND o.deleted_at IS NULL
WHERE wp.workspace_id = c.workspace_id
  AND wp.person_id = c.person_id
  AND c.organization_id IS NULL;

ALTER TABLE public.conversation ENABLE TRIGGER conversation_set_updated_at;

-- Un contacto principal por conversación, también las borradas.
INSERT INTO public.conversation_contact (
  workspace_id, conversation_id, person_id, role, since, until, is_primary,
  created_by, created_at
)
SELECT c.workspace_id, c.id, c.person_id, nullif(btrim(c.role), ''), NULL, NULL, true,
       c.created_by, c.created_at
FROM public.conversation c;

DO $$
DECLARE
  v_missing  bigint;
  v_extra    bigint;
  v_org_miss bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.conversation c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.conversation_contact cc
    WHERE cc.conversation_id = c.id AND cc.person_id = c.person_id AND cc.is_primary
  );
  SELECT count(*) INTO v_extra
  FROM public.conversation_contact cc
  JOIN public.conversation c ON c.id = cc.conversation_id
  WHERE cc.person_id <> c.person_id OR NOT cc.is_primary;
  -- Toda conversación cuyo dossier tiene organización viva la ha recibido.
  SELECT count(*) INTO v_org_miss
  FROM public.conversation c
  JOIN public.workspace_person wp
    ON wp.workspace_id = c.workspace_id AND wp.person_id = c.person_id
  JOIN public.workspace_organization o
    ON o.workspace_id = wp.workspace_id AND o.id = wp.organization_id AND o.deleted_at IS NULL
  WHERE c.organization_id IS DISTINCT FROM wp.organization_id;
  IF v_missing <> 0 OR v_extra <> 0 OR v_org_miss <> 0 THEN
    RAISE EXCEPTION 'conversation_contact backfill does not add up: % without primary, % unexpected, % without organization',
      v_missing, v_extra, v_org_miss;
  END IF;
END
$$;

-- ── 4 · doble escritura mientras conviven ─────────────────────────────────
-- BEFORE: una conversación nueva (o que cambia de persona) sin organización
-- toma la del dossier.
CREATE FUNCTION public.conversation_fill_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT o.id INTO NEW.organization_id
    FROM public.workspace_person wp
    JOIN public.workspace_organization o
      ON o.workspace_id = wp.workspace_id AND o.id = wp.organization_id
     AND o.deleted_at IS NULL
    WHERE wp.workspace_id = NEW.workspace_id AND wp.person_id = NEW.person_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.conversation_fill_organization() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversation_fill_organization() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversation_fill_organization
BEFORE INSERT OR UPDATE OF person_id ON public.conversation
FOR EACH ROW EXECUTE FUNCTION public.conversation_fill_organization();

-- AFTER: el contacto principal es (person_id, role) de la conversación. Si
-- cambia la persona, el principal anterior sigue de contacto, sin la marca.
CREATE FUNCTION public.conversation_sync_primary_contact()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.person_id IS NOT DISTINCT FROM OLD.person_id
     AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NULL;
  END IF;

  UPDATE public.conversation_contact
  SET is_primary = false
  WHERE conversation_id = NEW.id AND is_primary AND person_id <> NEW.person_id;

  INSERT INTO public.conversation_contact (
    workspace_id, conversation_id, person_id, role, is_primary, created_by
  ) VALUES (
    NEW.workspace_id, NEW.id, NEW.person_id, nullif(btrim(NEW.role), ''), true,
    coalesce(auth.uid(), NEW.created_by)
  )
  ON CONFLICT (conversation_id, person_id) DO UPDATE
  SET is_primary = true,
      until = NULL,
      role = EXCLUDED.role;

  RETURN NULL;
END;
$$;
ALTER FUNCTION public.conversation_sync_primary_contact() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversation_sync_primary_contact() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversation_sync_primary_contact
AFTER INSERT OR UPDATE OF person_id, role ON public.conversation
FOR EACH ROW EXECUTE FUNCTION public.conversation_sync_primary_contact();

-- ── 5 · RPC ───────────────────────────────────────────────────────────────
-- La conversación que quien llama puede editar, bloqueada; si no, 42501.
CREATE FUNCTION public.conversation_for_contact_write(p_conversation_id uuid)
RETURNS public.conversation
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   public.conversation;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conv
  FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller)
  FOR UPDATE;
  IF v_conv.id IS NULL OR NOT public.has_permission(v_conv.project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;
  RETURN v_conv;
END;
$$;
ALTER FUNCTION public.conversation_for_contact_write(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversation_for_contact_write(uuid) FROM PUBLIC, anon, authenticated;

-- Añade un contacto o rehace el suyo (papel, desde), y lo deja vigente.
-- Con p_is_primary pasa a ser el principal: mientras conviven los modelos,
-- eso cambia `conversation.person_id` (y `role`).
CREATE FUNCTION public.set_conversation_contact(
  p_conversation_id uuid,
  p_person_id       uuid,
  p_role            text DEFAULT NULL,
  p_since           date DEFAULT NULL,
  p_is_primary      boolean DEFAULT false
) RETURNS public.conversation_contact
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_conv    public.conversation := public.conversation_for_contact_write(p_conversation_id);
  v_role    text := nullif(btrim(coalesce(p_role, '')), '');
  v_primary boolean := coalesce(p_is_primary, false);
  v_row     public.conversation_contact;
BEGIN
  IF p_person_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_person wp
    WHERE wp.workspace_id = v_conv.workspace_id AND wp.person_id = p_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'person not found in target workspace' USING ERRCODE = '42501';
  END IF;

  IF NOT v_primary AND p_person_id = v_conv.person_id THEN
    RAISE EXCEPTION 'choose another primary contact first' USING ERRCODE = '22023';
  END IF;

  IF v_primary THEN
    -- El trigger de doble escritura mueve la marca de principal.
    UPDATE public.conversation
    SET person_id = p_person_id, role = v_role
    WHERE id = v_conv.id
      AND (person_id IS DISTINCT FROM p_person_id OR role IS DISTINCT FROM v_role);
  END IF;

  INSERT INTO public.conversation_contact (
    workspace_id, conversation_id, person_id, role, since, is_primary, created_by
  ) VALUES (
    v_conv.workspace_id, v_conv.id, p_person_id, v_role, p_since, v_primary, auth.uid()
  )
  ON CONFLICT (conversation_id, person_id) DO UPDATE
  SET role = EXCLUDED.role,
      since = EXCLUDED.since,
      until = NULL,
      is_primary = EXCLUDED.is_primary
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
ALTER FUNCTION public.set_conversation_contact(uuid, uuid, text, date, boolean) OWNER TO postgres;
COMMENT ON FUNCTION public.set_conversation_contact(uuid, uuid, text, date, boolean) IS
  'ADR-102: add a contact to a conversation, or redo theirs (role, since), leaving it current. p_is_primary makes them the primary, which while conversation.person_id exists also moves person_id/role. Gate: edit:conversation on a conversation the caller sees; otherwise 42501.';
REVOKE ALL ON FUNCTION public.set_conversation_contact(uuid, uuid, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_contact(uuid, uuid, text, date, boolean) TO authenticated;

-- Cierra un contacto: deja de hablar por la sala desde p_until (incluido).
CREATE FUNCTION public.end_conversation_contact(
  p_conversation_id uuid,
  p_person_id       uuid,
  p_until           date DEFAULT NULL
) RETURNS public.conversation_contact
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_conv public.conversation := public.conversation_for_contact_write(p_conversation_id);
  v_row  public.conversation_contact;
BEGIN
  SELECT * INTO v_row
  FROM public.conversation_contact
  WHERE conversation_id = v_conv.id AND person_id = p_person_id
  FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'contact not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.is_primary THEN
    RAISE EXCEPTION 'choose another primary contact first' USING ERRCODE = '22023';
  END IF;

  UPDATE public.conversation_contact
  SET until = coalesce(p_until, current_date)
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
ALTER FUNCTION public.end_conversation_contact(uuid, uuid, date) OWNER TO postgres;
COMMENT ON FUNCTION public.end_conversation_contact(uuid, uuid, date) IS
  'ADR-102: close a contact (until, default today). The primary cannot be closed: name another primary first. Gate: edit:conversation on a conversation the caller sees; otherwise 42501.';
REVOKE ALL ON FUNCTION public.end_conversation_contact(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_conversation_contact(uuid, uuid, date) TO authenticated;
