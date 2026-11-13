-- 138 · Importar contactos desde una hoja (CSV, XLSX o pegada).
--
-- La hoja se lee en el dispositivo; aquí llegan las filas ya revisadas. Cada
-- fila guarda contactos y nada más: la persona en el dossier del espacio
-- (`workspace_person`, con su persona global anónima como `create_workspace_person`),
-- su organización (`workspace_organization`) y el vínculo entre ambas, o una
-- sola de las dos. Lo que la hoja trae sin campo va a una nota privada de quien
-- importa (ADR-093). Importar NO abre conversaciones ni toca `mail_basis`.
--
--   1. `contact_import`: quién, cuándo, en qué espacio, cuántas filas, cifras,
--      estado y cuándo se deshizo. Lo lee quien la hizo y el owner o admin del
--      espacio; nadie la escribe directamente. `filled` (lo que se completó en
--      fichas que ya existían, para devolverlo al deshacer) no se concede a
--      PostgREST.
--   2. `import_id` nullable en `workspace_person`, `workspace_organization` y
--      `note`, con FK compuesta por espacio a `contact_import`.
--      `note.import_id` sólo lo escribe la importación (trigger).
--   3. Lo importado es DIRECTORIO, no equipo (ADR-124): `private.person_is_team`
--      se redefine para que un dossier nacido en una importación no cuente
--      como equipo por no tener conversación; lo sigue siendo si está en un
--      reparto, un equipo técnico, una cuenta o lo demás que ya lo hacía equipo.
--      Su organización deja así de verse por la regla «organización de alguien
--      del equipo».
--   4. `contact_import_lookup`: qué correos, nombres de persona y nombres de
--      organización de la hoja ya están, sólo entre lo que quien llama lee.
--   5. `import_contacts`: escribe una tanda (hasta 500 filas; 2.000 por
--      importación), con un candado por espacio y repetible: la importación
--      lleva el id que le da el cliente y cada tanda su número, y una tanda
--      ya escrita no se vuelve a escribir. Cada fila va en su propio bloque: la
--      que falla no para el resto y vuelve con su número y un motivo que no
--      delata lo que quien importa no ve. Mismo correo, la misma persona;
--      mismo nombre de organización, la misma; de lo que ya existía sólo se
--      rellena lo vacío. Lo que no lee quien llama no se toca.
--   6. `undo_contact_import`: durante 7 días, quien importó (o el owner o
--      admin) la deshace: borra (lógico) lo que nació en ella y sigue igual,
--      devuelve a vacío los campos completados que nadie ha cambiado y deja lo
--      que alguien ha tocado o usa después. Las notas privadas sólo las borra
--      su autora; si deshace otra persona, se quedan y el resultado lo dice.
--
-- Quién (`private.can_import_contacts`): owner, admin o member del espacio que
-- además lee Conversaciones en él (`private.reads_conversations_in`, el permiso
-- del directorio de ADR-124): lo importado es directorio y quien importa tiene
-- que poder verlo.
--
-- Aditiva salvo una redefinición: `private.person_is_team(uuid, uuid)`, misma
-- firma, cuerpo de 20261018100000_directory_privacy.sql (la única migración que
-- la define) con una condición más. Rollback al final del fichero.

-- ── 1 · contact_import ──────────────────────────────────────────────────────
CREATE TABLE public.contact_import (
  id                     uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id           uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename               text,
  row_count              integer NOT NULL,
  rows_done              integer NOT NULL DEFAULT 0,
  rows_failed            integer NOT NULL DEFAULT 0,
  persons_created        integer NOT NULL DEFAULT 0,
  persons_filled         integer NOT NULL DEFAULT 0,
  organizations_created  integer NOT NULL DEFAULT 0,
  organizations_filled   integer NOT NULL DEFAULT 0,
  notes_created          integer NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'importing',
  -- Lo completado en fichas que ya existían: [{t: 'p'|'o', id, f, v}].
  filled                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Los números de tanda ya escritos: reenviar una no la duplica.
  batches                integer[] NOT NULL DEFAULT '{}',
  last_write_at          timestamptz NOT NULL DEFAULT now(),
  undone_at              timestamptz,
  undone_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_import_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT contact_import_status_check CHECK (status IN ('importing', 'done', 'undone')),
  CONSTRAINT contact_import_filename_length CHECK (filename IS NULL OR length(filename) BETWEEN 1 AND 255),
  CONSTRAINT contact_import_counts_check CHECK (
    row_count BETWEEN 1 AND 2000 AND rows_done BETWEEN 0 AND row_count AND rows_failed BETWEEN 0 AND rows_done
  ),
  CONSTRAINT contact_import_filled_array CHECK (jsonb_typeof(filled) = 'array'),
  CONSTRAINT contact_import_undone_consistent CHECK ((status = 'undone') = (undone_at IS NOT NULL))
);

COMMENT ON TABLE public.contact_import IS
  '138: one import of contacts from a sheet. Written only by import_contacts / undo_contact_import; read by its author and the workspace owner or admin. Imports never open conversations.';

CREATE INDEX contact_import_workspace_idx ON public.contact_import (workspace_id, created_at DESC);
CREATE INDEX contact_import_created_by_idx ON public.contact_import (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX contact_import_undone_by_idx ON public.contact_import (undone_by) WHERE undone_by IS NOT NULL;

ALTER TABLE public.contact_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_import FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_import OWNER TO postgres;
REVOKE ALL ON TABLE public.contact_import FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contact_import TO service_role;
-- Por columnas A PROPÓSITO: `filled` lleva valores de fichas que no hace falta enseñar.
GRANT SELECT (
  id, workspace_id, created_by, filename, row_count, rows_done, rows_failed,
  persons_created, persons_filled, organizations_created, organizations_filled, notes_created,
  status, last_write_at, undone_at, undone_by, created_at, updated_at
) ON TABLE public.contact_import TO authenticated;

CREATE POLICY contact_import_select ON public.contact_import
  FOR SELECT TO authenticated
  USING (
    (created_by = (SELECT auth.uid())
     AND private.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[]))
    OR private.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.membership_role[])
  );

CREATE TRIGGER contact_import_guard_ws BEFORE UPDATE ON public.contact_import
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();
CREATE TRIGGER contact_import_set_updated_at BEFORE UPDATE ON public.contact_import
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2 · import_id ───────────────────────────────────────────────────────────
ALTER TABLE public.workspace_person
  ADD COLUMN import_id uuid,
  ADD CONSTRAINT workspace_person_contact_import_fkey FOREIGN KEY (workspace_id, import_id)
    REFERENCES public.contact_import (workspace_id, id) ON DELETE SET NULL (import_id);
ALTER TABLE public.workspace_organization
  ADD COLUMN import_id uuid,
  ADD CONSTRAINT workspace_organization_contact_import_fkey FOREIGN KEY (workspace_id, import_id)
    REFERENCES public.contact_import (workspace_id, id) ON DELETE SET NULL (import_id);
ALTER TABLE public.note
  ADD COLUMN import_id uuid,
  ADD CONSTRAINT note_contact_import_fkey FOREIGN KEY (workspace_id, import_id)
    REFERENCES public.contact_import (workspace_id, id) ON DELETE SET NULL (import_id);

CREATE INDEX workspace_person_import_idx ON public.workspace_person (workspace_id, import_id) WHERE import_id IS NOT NULL;
CREATE INDEX workspace_organization_import_idx ON public.workspace_organization (workspace_id, import_id) WHERE import_id IS NOT NULL;
CREATE INDEX note_import_idx ON public.note (workspace_id, import_id) WHERE import_id IS NOT NULL;

COMMENT ON COLUMN public.workspace_person.import_id IS '138: the contact import this dossier was born in (undo removes it while untouched).';
COMMENT ON COLUMN public.workspace_organization.import_id IS '138: the contact import this organization was born in (undo removes it while untouched).';
COMMENT ON COLUMN public.note.import_id IS '138: the contact import that wrote this private note (the sheet''s columns without a field).';

-- `note` se escribe también por PostgREST (INSERT y UPDATE a `authenticated`):
-- `import_id` lo pone sólo la importación, que corre como su dueño.
CREATE FUNCTION private.guard_note_import_id() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.import_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.import_id END) THEN
    RAISE EXCEPTION 'import_id is written only by a contact import' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_note_import_id() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER note_guard_import_id BEFORE INSERT OR UPDATE ON public.note
  FOR EACH ROW EXECUTE FUNCTION private.guard_note_import_id();

-- ── 3 · Quién importa, y lo importado es directorio ─────────────────────────
CREATE FUNCTION private.can_import_contacts(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND private.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']::public.membership_role[])
    AND private.reads_conversations_in(p_workspace_id, (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.can_import_contacts(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.can_import_contacts(uuid) IS
  '138: who imports contacts into a workspace: owner, admin or member who reads Conversations there (the directory permission, ADR-124).';

-- Cuerpo de 20261018100000_directory_privacy.sql (la única que la define),
-- misma firma. Lo único nuevo: un dossier sin conversación cuenta como equipo
-- sólo si NO nació en una importación. Las demás razones de ser equipo siguen.
CREATE OR REPLACE FUNCTION private.person_is_team(p_workspace_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    (
      NOT EXISTS (
        SELECT 1
        FROM public.conversation_contact cc
        WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id
      )
      -- 138: lo importado es directorio, no equipo.
      AND NOT EXISTS (
        SELECT 1
        FROM public.workspace_person wp
        WHERE wp.workspace_id = p_workspace_id AND wp.person_id = p_person_id
          AND wp.import_id IS NOT NULL
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profile up
      JOIN public.membership m
        ON m.level = 'workspace' AND m.workspace_id = p_workspace_id
       AND m.user_id = up.user_id AND m.accepted_at IS NOT NULL
      WHERE up.person_id = p_person_id
    )
    OR EXISTS (
      SELECT 1 FROM public.workspace_invitation i
      WHERE i.workspace_id = p_workspace_id AND i.person_id = p_person_id
        AND i.revoked_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.cast_member x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.crew_assignment x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.cast_override x
      WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
        AND (x.person_id = p_person_id OR x.replaces_person_id = p_person_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.availability_block x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.commitment_person x
      WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id
    );
$$;

-- ── 4 · contact_import_lookup ───────────────────────────────────────────────
-- Lo que ya está, entre lo que quien llama lee: los dossiers con alguno de esos
-- correos o nombres, y las organizaciones con alguno de esos nombres.
CREATE FUNCTION public.contact_import_lookup(
  p_workspace_id  uuid,
  p_emails        text[],
  p_names         text[],
  p_organizations text[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_emails extensions.citext[];
  v_names  text[];
  v_orgs   text[];
BEGIN
  IF NOT private.can_import_contacts(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_emails), 0) > 2000 OR coalesce(cardinality(p_names), 0) > 2000
     OR coalesce(cardinality(p_organizations), 0) > 2000 THEN
    RAISE EXCEPTION 'too many values' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x::extensions.citext), '{}')
  INTO v_emails
  FROM unnest(coalesce(p_emails, '{}')) AS u(x)
  WHERE nullif(btrim(x), '') IS NOT NULL AND length(x) <= 320;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}')
  INTO v_names
  FROM unnest(coalesce(p_names, '{}')) AS u(x)
  WHERE nullif(btrim(x), '') IS NOT NULL AND length(x) <= 200;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}')
  INTO v_orgs
  FROM unnest(coalesce(p_organizations, '{}')) AS u(x)
  WHERE nullif(btrim(x), '') IS NOT NULL AND length(x) <= 200;

  RETURN jsonb_build_object(
    'persons', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'person_id', wp.person_id,
        'full_name', wp.full_name,
        'email', wp.email,
        'phone', wp.phone,
        'title', wp.title,
        'city', wp.city,
        'country', wp.country,
        'website', wp.website,
        'organization_id', CASE WHEN o.id IS NOT NULL
          AND private.workspace_organization_readable_by_caller(p_workspace_id, o.id) THEN o.id END,
        'organization_name', CASE WHEN o.id IS NOT NULL
          AND private.workspace_organization_readable_by_caller(p_workspace_id, o.id) THEN o.name END
      ) ORDER BY wp.created_at, wp.person_id)
      FROM public.workspace_person wp
      LEFT JOIN public.workspace_organization o
        ON o.workspace_id = wp.workspace_id AND o.id = wp.organization_id AND o.deleted_at IS NULL
      WHERE wp.workspace_id = p_workspace_id AND wp.deleted_at IS NULL
        AND (wp.email = ANY (v_emails) OR lower(btrim(wp.full_name)) = ANY (v_names))
        AND private.workspace_person_readable_by_caller(p_workspace_id, wp.person_id)
    ), '[]'::jsonb),
    'organizations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'kind', o.kind,
        'email', o.email,
        'phone', o.phone,
        'city', o.city,
        'country', o.country,
        'website', o.website
      ) ORDER BY o.name)
      FROM public.workspace_organization o
      WHERE o.workspace_id = p_workspace_id AND o.deleted_at IS NULL
        AND lower(btrim(o.name)) = ANY (v_orgs)
        AND private.workspace_organization_readable_by_caller(p_workspace_id, o.id)
    ), '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.contact_import_lookup(uuid, text[], text[], text[]) IS
  '138: which emails, person names and organization names of a sheet already exist in the workspace, among what the caller reads. Gate: private.can_import_contacts.';
REVOKE ALL ON FUNCTION public.contact_import_lookup(uuid, text[], text[], text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.contact_import_lookup(uuid, text[], text[], text[]) TO authenticated;

-- ── 5 · import_contacts ─────────────────────────────────────────────────────
-- Una fila: { line, person?: {match_person_id?, full_name, first_name?,
-- last_name?, title?, email?, phone?, city?, country?, website?},
-- organization?: {name, kind?, email?, phone?, city?, country?, website?},
-- note? }. El cliente da el id de la importación (la primera tanda la crea) y
-- el número de cada tanda (0, 1, …): una tanda ya escrita devuelve
-- `repeated: true` sin escribir nada, así que un reintento tras un corte no
-- duplica. `p_last` la da por terminada. La nota de una fila con persona es una
-- nota privada de quien importa; la de una fila con sólo organización va a
-- `workspace_organization.notes` si está vacía.
CREATE FUNCTION public.import_contacts(
  p_workspace_id uuid,
  p_import_id    uuid,
  p_batch        integer,
  p_filename     text,
  p_row_count    integer,
  p_rows         jsonb,
  p_last         boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller    uuid := auth.uid();
  v_import    public.contact_import;
  v_row       jsonb;
  v_p         jsonb;
  v_o         jsonb;
  v_line      integer;
  v_reason    text;
  v_row_warn  jsonb;
  -- Lo de la fila
  v_oname     text;
  v_okind     text;
  v_oemail    extensions.citext;
  v_ophone    text;
  v_ocity     text;
  v_ocountry  text;
  v_oweb      text;
  v_pname     text;
  v_pfirst    text;
  v_plast     text;
  v_ptitle    text;
  v_pemail    extensions.citext;
  v_pphone    text;
  v_pcity     text;
  v_pcountry  text;
  v_pweb      text;
  v_match     uuid;
  v_note      text;
  v_org       public.workspace_organization;
  v_wp        public.workspace_person;
  v_org_id    uuid;
  v_person_id uuid;
  v_slug      text;
  v_id        uuid;
  v_fill      jsonb;
  v_org_new   boolean;
  v_org_fill  boolean;
  v_per_new   boolean;
  v_per_fill  boolean;
  v_note_new  boolean;
  -- La tanda
  v_filled    jsonb := '[]'::jsonb;
  v_failed    jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  v_rows      integer;
  v_pc        integer := 0;
  v_pf        integer := 0;
  v_oc        integer := 0;
  v_of        integer := 0;
  v_nc        integer := 0;
BEGIN
  IF NOT private.can_import_contacts(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '42501';
  END IF;
  -- Una importación a la vez por espacio: dos tandas no compiten por el mismo
  -- nombre de organización ni por el mismo correo.
  PERFORM pg_advisory_xact_lock(hashtext('contact_import:' || p_workspace_id::text));
  IF p_import_id IS NULL OR p_batch IS NULL OR p_batch < 0 OR p_batch > 99 THEN
    RAISE EXCEPTION 'import id and batch number are required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be an array' USING ERRCODE = '22023';
  END IF;
  v_rows := jsonb_array_length(p_rows);
  IF v_rows < 1 OR v_rows > 500 THEN
    RAISE EXCEPTION 'between 1 and 500 rows per call' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_import FROM public.contact_import ci WHERE ci.id = p_import_id FOR UPDATE;
  IF v_import.id IS NULL THEN
    IF p_row_count IS NULL OR p_row_count < v_rows OR p_row_count > 2000 THEN
      RAISE EXCEPTION 'row_count must be between the rows sent and 2000' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.contact_import (id, workspace_id, created_by, filename, row_count)
    VALUES (p_import_id, p_workspace_id, v_caller, nullif(btrim(left(coalesce(p_filename, ''), 255)), ''), p_row_count)
    RETURNING * INTO v_import;
  ELSE
    IF v_import.workspace_id <> p_workspace_id OR v_import.created_by IS DISTINCT FROM v_caller
       OR v_import.created_at < now() - interval '1 hour' THEN
      RAISE EXCEPTION 'import not found' USING ERRCODE = '42501';
    END IF;
    -- Ya escrita: un reintento no hace nada.
    IF p_batch = ANY (v_import.batches) THEN
      RETURN jsonb_build_object(
        'import_id', v_import.id, 'repeated', true,
        'persons_created', 0, 'persons_filled', 0, 'organizations_created', 0,
        'organizations_filled', 0, 'notes_created', 0, 'failed', '[]'::jsonb, 'warnings', '[]'::jsonb);
    END IF;
    IF v_import.status <> 'importing' THEN
      RAISE EXCEPTION 'import not found' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_import.rows_done + v_rows > v_import.row_count THEN
    RAISE EXCEPTION 'more rows than announced' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_line := CASE WHEN (v_row ->> 'line') ~ '^\d{1,6}$' THEN (v_row ->> 'line')::integer END;
    v_reason := NULL;
    v_row_warn := '[]'::jsonb;
    BEGIN
      v_fill := '[]'::jsonb;
      v_org_id := NULL;
      v_person_id := NULL;
      v_org_new := false;
      v_org_fill := false;
      v_per_new := false;
      v_per_fill := false;
      v_note_new := false;
      v_org := NULL;
      v_wp := NULL;
      IF jsonb_typeof(v_row) <> 'object' THEN
        v_reason := 'invalid';
        RAISE EXCEPTION 'row must be an object' USING ERRCODE = '22023';
      END IF;
      v_o := CASE WHEN jsonb_typeof(v_row -> 'organization') = 'object' THEN v_row -> 'organization' END;
      v_p := CASE WHEN jsonb_typeof(v_row -> 'person') = 'object' THEN v_row -> 'person' END;
      v_note := nullif(btrim(coalesce(v_row ->> 'note', '')), '');
      IF v_o IS NULL AND v_p IS NULL THEN
        v_reason := 'no_name';
        RAISE EXCEPTION 'a row needs a person or an organization' USING ERRCODE = '22023';
      END IF;

      -- ── La organización ──
      IF v_o IS NOT NULL THEN
        v_oname    := nullif(btrim(coalesce(v_o ->> 'name', '')), '');
        v_okind    := nullif(btrim(coalesce(v_o ->> 'kind', '')), '');
        v_oemail   := nullif(btrim(coalesce(v_o ->> 'email', '')), '')::extensions.citext;
        v_ophone   := nullif(btrim(coalesce(v_o ->> 'phone', '')), '');
        v_ocity    := nullif(btrim(coalesce(v_o ->> 'city', '')), '');
        v_ocountry := upper(nullif(btrim(coalesce(v_o ->> 'country', '')), ''));
        v_oweb     := nullif(btrim(coalesce(v_o ->> 'website', '')), '');
        IF v_oname IS NULL OR length(v_oname) > 200 THEN
          v_reason := 'no_name';
          RAISE EXCEPTION 'organization name is required' USING ERRCODE = '22023';
        END IF;
        IF v_okind IS NOT NULL AND v_okind NOT IN ('company', 'festival', 'theatre', 'presenter', 'agency', 'institution', 'solo', 'other') THEN
          v_reason := 'invalid';
          RAISE EXCEPTION 'kind is not valid' USING ERRCODE = '22023';
        END IF;
        IF (v_oemail IS NOT NULL AND (length(v_oemail::text) > 320 OR v_oemail::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
           OR length(v_ophone) > 60 OR length(v_ocity) > 120 OR length(v_oweb) > 500
           OR (v_ocountry IS NOT NULL AND v_ocountry !~ '^[A-Z]{2}$') THEN
          v_reason := 'invalid';
          RAISE EXCEPTION 'organization field is not valid' USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_org FROM public.workspace_organization o
        WHERE o.workspace_id = p_workspace_id AND o.deleted_at IS NULL
          AND lower(btrim(o.name)) = lower(v_oname)
        FOR UPDATE;

        IF v_org.id IS NOT NULL THEN
          IF v_org.import_id IS DISTINCT FROM v_import.id
             AND NOT private.workspace_organization_readable_by_caller(p_workspace_id, v_org.id) THEN
            -- Una organización con ese nombre que quien importa no ve: ni se
            -- enlaza ni se completa. La fila sigue sin ella.
            v_row_warn := v_row_warn || jsonb_build_object('line', v_line, 'reason', 'unavailable');
          ELSE
            v_org_id := v_org.id;
            -- Sólo lo vacío; lo nacido en esta misma importación no se apunta.
            IF v_okind IS NOT NULL AND v_okind <> 'other' AND v_org.kind = 'other' THEN
              UPDATE public.workspace_organization SET kind = v_okind WHERE id = v_org.id;
              v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org.id, 'f', 'kind', 'v', v_okind);
            END IF;
            IF v_oemail IS NOT NULL AND v_org.email IS NULL THEN
              UPDATE public.workspace_organization SET email = v_oemail WHERE id = v_org.id;
              v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org.id, 'f', 'email', 'v', v_oemail::text);
            END IF;
            IF v_ophone IS NOT NULL AND v_org.phone IS NULL THEN
              UPDATE public.workspace_organization SET phone = v_ophone WHERE id = v_org.id;
              v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org.id, 'f', 'phone', 'v', v_ophone);
            END IF;
            IF v_ocity IS NOT NULL AND v_org.city IS NULL THEN
              UPDATE public.workspace_organization SET city = v_ocity WHERE id = v_org.id;
              v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org.id, 'f', 'city', 'v', v_ocity);
            END IF;
            IF v_ocountry IS NOT NULL AND v_org.country IS NULL THEN
              UPDATE public.workspace_organization SET country = v_ocountry WHERE id = v_org.id;
              v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org.id, 'f', 'country', 'v', v_ocountry);
            END IF;
            IF v_oweb IS NOT NULL AND v_org.website IS NULL THEN
              UPDATE public.workspace_organization SET website = v_oweb WHERE id = v_org.id;
              v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org.id, 'f', 'website', 'v', v_oweb);
            END IF;
            IF v_org.import_id IS NOT DISTINCT FROM v_import.id THEN
              v_fill := '[]'::jsonb;
            ELSE
              v_org_fill := jsonb_array_length(v_fill) > 0;
            END IF;
          END IF;
        ELSE
          v_id := public.uuid_generate_v7();
          v_slug := coalesce(nullif(rtrim(left(public.slugify(v_oname), 63), '-'), ''), 'organization');
          IF EXISTS (
            SELECT 1 FROM public.workspace_organization o
            WHERE o.workspace_id = p_workspace_id AND o.slug = v_slug AND o.deleted_at IS NULL
          ) THEN
            v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_id::text, '-', ''), 6);
          END IF;
          INSERT INTO public.workspace_organization (
            id, workspace_id, slug, name, kind, city, country, email, phone, website, created_by, import_id
          ) VALUES (
            v_id, p_workspace_id, v_slug, v_oname, coalesce(v_okind, 'other'), v_ocity, v_ocountry,
            v_oemail, v_ophone, v_oweb, v_caller, v_import.id
          );
          v_org_id := v_id;
          v_org_new := true;
        END IF;
      END IF;

      -- ── La persona ──
      IF v_p IS NOT NULL THEN
        v_pname    := nullif(btrim(coalesce(v_p ->> 'full_name', '')), '');
        v_pfirst   := nullif(btrim(coalesce(v_p ->> 'first_name', '')), '');
        v_plast    := nullif(btrim(coalesce(v_p ->> 'last_name', '')), '');
        v_ptitle   := nullif(btrim(coalesce(v_p ->> 'title', '')), '');
        v_pemail   := nullif(btrim(coalesce(v_p ->> 'email', '')), '')::extensions.citext;
        v_pphone   := nullif(btrim(coalesce(v_p ->> 'phone', '')), '');
        v_pcity    := nullif(btrim(coalesce(v_p ->> 'city', '')), '');
        v_pcountry := upper(nullif(btrim(coalesce(v_p ->> 'country', '')), ''));
        v_pweb     := nullif(btrim(coalesce(v_p ->> 'website', '')), '');
        v_match    := CASE WHEN (v_p ->> 'match_person_id') ~* '^[0-9a-f-]{36}$'
                           THEN (v_p ->> 'match_person_id')::uuid END;
        IF v_pname IS NULL OR length(v_pname) > 200 THEN
          v_reason := 'no_name';
          RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
        END IF;
        IF (v_pemail IS NOT NULL AND (length(v_pemail::text) > 320 OR v_pemail::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
           OR length(v_pphone) > 60 OR length(v_ptitle) > 200 OR length(v_pcity) > 120
           OR length(v_pweb) > 500 OR length(v_pfirst) > 200 OR length(v_plast) > 200
           OR (v_pcountry IS NOT NULL AND v_pcountry !~ '^[A-Z]{2}$') THEN
          v_reason := 'invalid';
          RAISE EXCEPTION 'person field is not valid' USING ERRCODE = '22023';
        END IF;

        -- La misma: la elegida al revisar, o la del mismo correo.
        IF v_match IS NOT NULL THEN
          SELECT * INTO v_wp FROM public.workspace_person wp
          WHERE wp.workspace_id = p_workspace_id AND wp.person_id = v_match AND wp.deleted_at IS NULL
          FOR UPDATE;
          IF v_wp.person_id IS NULL THEN
            v_reason := 'unavailable';
            RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
          END IF;
        ELSIF v_pemail IS NOT NULL THEN
          SELECT * INTO v_wp FROM public.workspace_person wp
          WHERE wp.workspace_id = p_workspace_id AND wp.email = v_pemail AND wp.deleted_at IS NULL
          ORDER BY wp.created_at, wp.person_id
          LIMIT 1
          FOR UPDATE;
        END IF;

        IF v_wp.person_id IS NOT NULL THEN
          IF v_wp.import_id IS DISTINCT FROM v_import.id
             AND NOT private.workspace_person_readable_by_caller(p_workspace_id, v_wp.person_id) THEN
            -- Alguien con ese correo que quien importa no ve: no se toca ni se
            -- duplica. La fila no entra.
            v_reason := 'unavailable';
            RAISE EXCEPTION 'person not readable' USING ERRCODE = '42501';
          END IF;
          v_person_id := v_wp.person_id;
          v_fill := CASE WHEN v_org_fill THEN v_fill ELSE '[]'::jsonb END;
          IF v_ptitle IS NOT NULL AND v_wp.title IS NULL THEN
            UPDATE public.workspace_person SET title = v_ptitle WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'title', 'v', v_ptitle);
          END IF;
          IF v_pemail IS NOT NULL AND v_wp.email IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.workspace_person x
            WHERE x.workspace_id = p_workspace_id AND x.email = v_pemail AND x.deleted_at IS NULL
          ) THEN
            UPDATE public.workspace_person SET email = v_pemail WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'email', 'v', v_pemail::text);
          END IF;
          IF v_pphone IS NOT NULL AND v_wp.phone IS NULL THEN
            UPDATE public.workspace_person SET phone = v_pphone WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'phone', 'v', v_pphone);
          END IF;
          IF v_pcity IS NOT NULL AND v_wp.city IS NULL THEN
            UPDATE public.workspace_person SET city = v_pcity WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'city', 'v', v_pcity);
          END IF;
          IF v_pcountry IS NOT NULL AND v_wp.country IS NULL THEN
            UPDATE public.workspace_person SET country = v_pcountry WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'country', 'v', v_pcountry);
          END IF;
          IF v_pweb IS NOT NULL AND v_wp.website IS NULL THEN
            UPDATE public.workspace_person SET website = v_pweb WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'website', 'v', v_pweb);
          END IF;
          IF v_pfirst IS NOT NULL AND v_wp.first_name IS NULL THEN
            UPDATE public.workspace_person SET first_name = v_pfirst WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'first_name', 'v', v_pfirst);
          END IF;
          IF v_plast IS NOT NULL AND v_wp.last_name IS NULL THEN
            UPDATE public.workspace_person SET last_name = v_plast WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'last_name', 'v', v_plast);
          END IF;
          IF v_org_id IS NOT NULL AND v_wp.organization_id IS NULL THEN
            UPDATE public.workspace_person SET organization_id = v_org_id WHERE workspace_id = p_workspace_id AND person_id = v_person_id;
            v_fill := v_fill || jsonb_build_object('t', 'p', 'id', v_person_id, 'f', 'organization_id', 'v', v_org_id::text);
          ELSIF v_org_id IS NOT NULL AND v_wp.organization_id IS DISTINCT FROM v_org_id THEN
            -- Una organización por persona (ADR-177): la que tenía se queda.
            v_row_warn := v_row_warn || jsonb_build_object('line', v_line, 'reason', 'other_organization');
          END IF;
          IF v_wp.import_id IS NOT DISTINCT FROM v_import.id THEN
            -- Nacida en esta importación: nada que devolver al deshacer.
            v_fill := (SELECT coalesce(jsonb_agg(e.v), '[]'::jsonb) FROM jsonb_array_elements(v_fill) AS e(v) WHERE e.v ->> 't' = 'o');
          ELSE
            v_per_fill := EXISTS (SELECT 1 FROM jsonb_array_elements(v_fill) AS e(v) WHERE e.v ->> 't' = 'p');
          END IF;
        ELSE
          -- Nueva: persona global anónima + dossier del espacio (ADR-107).
          v_person_id := public.uuid_generate_v7();
          INSERT INTO public.person (id, slug, full_name, email, created_by)
          VALUES (
            v_person_id,
            'person-' || right(replace(v_person_id::text, '-', ''), 12),
            'Person ' || right(replace(v_person_id::text, '-', ''), 8),
            NULL,
            v_caller
          );
          v_slug := coalesce(nullif(rtrim(left(public.slugify(v_pname), 63), '-'), ''), 'person');
          IF EXISTS (
            SELECT 1 FROM public.workspace_person wp
            WHERE wp.workspace_id = p_workspace_id AND wp.slug = v_slug AND wp.deleted_at IS NULL
          ) THEN
            v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_person_id::text, '-', ''), 6);
          END IF;
          INSERT INTO public.workspace_person (
            workspace_id, person_id, slug, full_name, first_name, last_name, email, phone, title,
            city, country, website, organization_id, created_by, import_id
          ) VALUES (
            p_workspace_id, v_person_id, v_slug, v_pname, v_pfirst, v_plast, v_pemail, v_pphone, v_ptitle,
            v_pcity, v_pcountry, v_pweb, v_org_id, v_caller, v_import.id
          );
          v_per_new := true;
        END IF;
      END IF;

      -- ── La nota: privada de quien importa (ADR-093), de la persona; sin
      --    persona, a las notas de la organización si están vacías ──
      IF v_note IS NOT NULL THEN
        IF v_person_id IS NULL AND v_org_id IS NOT NULL
           AND (v_org_new OR (v_org.notes IS NULL AND v_org.import_id IS DISTINCT FROM v_import.id)) THEN
          UPDATE public.workspace_organization SET notes = left(v_note, 4000) WHERE id = v_org_id AND notes IS NULL;
          IF NOT v_org_new THEN
            v_fill := v_fill || jsonb_build_object('t', 'o', 'id', v_org_id, 'f', 'notes', 'v', left(v_note, 4000));
            v_org_fill := true;
          END IF;
        ELSIF v_person_id IS NULL THEN
          v_row_warn := v_row_warn || jsonb_build_object('line', v_line, 'reason', 'note_not_saved');
        ELSE
          INSERT INTO public.note (workspace_id, author_id, person_id, on_day, visibility, body, import_id)
          VALUES (p_workspace_id, v_caller, v_person_id, current_date, 'private', left(v_note, 4000), v_import.id);
          v_note_new := true;
        END IF;
      END IF;

      -- La fila ha entrado: ahora sí cuenta.
      v_filled := v_filled || v_fill;
      v_oc := v_oc + v_org_new::integer;
      v_of := v_of + v_org_fill::integer;
      v_pc := v_pc + v_per_new::integer;
      v_pf := v_pf + v_per_fill::integer;
      v_nc := v_nc + v_note_new::integer;
      v_warnings := v_warnings || v_row_warn;
    EXCEPTION WHEN OTHERS THEN
      -- Lo que no se ve y lo inesperado salen con el mismo motivo: el detalle
      -- no sale de la base.
      v_failed := v_failed || jsonb_build_object(
        'line', v_line,
        'reason', coalesce(v_reason, CASE WHEN SQLSTATE = '22023' THEN 'invalid' ELSE 'unavailable' END)
      );
    END;
  END LOOP;

  UPDATE public.contact_import ci SET
    rows_done = ci.rows_done + v_rows,
    rows_failed = ci.rows_failed + jsonb_array_length(v_failed),
    persons_created = ci.persons_created + v_pc,
    persons_filled = ci.persons_filled + v_pf,
    organizations_created = ci.organizations_created + v_oc,
    organizations_filled = ci.organizations_filled + v_of,
    notes_created = ci.notes_created + v_nc,
    filled = ci.filled || v_filled,
    batches = array_append(ci.batches, p_batch),
    last_write_at = clock_timestamp(),
    status = CASE WHEN p_last THEN 'done' ELSE ci.status END
  WHERE ci.id = v_import.id;

  RETURN jsonb_build_object(
    'import_id', v_import.id,
    'repeated', false,
    'persons_created', v_pc,
    'persons_filled', v_pf,
    'organizations_created', v_oc,
    'organizations_filled', v_of,
    'notes_created', v_nc,
    'failed', v_failed,
    'warnings', v_warnings
  );
END;
$function$;

COMMENT ON FUNCTION public.import_contacts(uuid, uuid, integer, text, integer, jsonb, boolean) IS
  '138: one batch (<= 500 rows, <= 2000 per import) of a contact import. Persons, organizations and the link between them, never conversations. Same email = same person, same organization name = same organization, only empty fields are filled; what the caller cannot read is not touched. A failing row does not stop the rest; a batch already written is not written again. Gate: private.can_import_contacts.';
REVOKE ALL ON FUNCTION public.import_contacts(uuid, uuid, integer, text, integer, jsonb, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.import_contacts(uuid, uuid, integer, text, integer, jsonb, boolean) TO authenticated;

-- ── 6 · undo_contact_import ─────────────────────────────────────────────────
CREATE FUNCTION public.undo_contact_import(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller   uuid := auth.uid();
  v_import   public.contact_import;
  v_cut      timestamptz;
  v_item     jsonb;
  v_n        integer;
  v_restored integer := 0;
  v_notes    integer := 0;
  v_nkept    integer := 0;
  v_own      boolean;
  v_persons  integer := 0;
  v_orgs     integer := 0;
  v_pkept    integer := 0;
  v_okept    integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM public.contact_import ci WHERE ci.id = p_import_id FOR UPDATE;
  IF v_import.id IS NULL OR NOT (
    (v_import.created_by = v_caller AND private.can_import_contacts(v_import.workspace_id))
    OR private.has_workspace_role(v_import.workspace_id, ARRAY['owner', 'admin']::public.membership_role[])
  ) THEN
    RAISE EXCEPTION 'import not found' USING ERRCODE = '42501';
  END IF;
  IF v_import.status = 'undone' THEN
    RAISE EXCEPTION 'import already undone' USING ERRCODE = '22023';
  END IF;
  IF v_import.created_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'undo expired' USING ERRCODE = '22023';
  END IF;
  v_cut := v_import.last_write_at;
  v_own := v_import.created_by = v_caller;

  -- 1 · Lo completado vuelve a vacío si sigue siendo lo que puso la importación.
  FOR v_item IN SELECT e.v FROM jsonb_array_elements(v_import.filled) AS e(v) LOOP
    IF v_item ->> 't' = 'o' AND v_item ->> 'f' IN ('kind', 'email', 'phone', 'city', 'country', 'website', 'notes') THEN
      EXECUTE format(
        'UPDATE public.workspace_organization SET %1$I = %2$s
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL AND %1$I::text = $3',
        v_item ->> 'f', CASE WHEN v_item ->> 'f' = 'kind' THEN quote_literal('other') ELSE 'NULL' END)
      USING v_import.workspace_id, (v_item ->> 'id')::uuid, v_item ->> 'v';
    ELSIF v_item ->> 't' = 'p' AND v_item ->> 'f' IN (
      'title', 'email', 'phone', 'city', 'country', 'website', 'first_name', 'last_name', 'organization_id'
    ) THEN
      EXECUTE format(
        'UPDATE public.workspace_person SET %1$I = NULL
         WHERE workspace_id = $1 AND person_id = $2 AND deleted_at IS NULL AND %1$I::text = $3',
        v_item ->> 'f')
      USING v_import.workspace_id, (v_item ->> 'id')::uuid, v_item ->> 'v';
    ELSE
      CONTINUE;
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := v_restored + v_n;
  END LOOP;

  -- 2 · Las notas de la importación que nadie ha reescrito, sólo si deshace
  --     su autora: una nota privada ajena no se borra (ADR-093).
  IF v_own THEN
    UPDATE public.note n SET deleted_at = now()
    WHERE n.workspace_id = v_import.workspace_id AND n.import_id = v_import.id
      AND n.deleted_at IS NULL AND n.updated_at <= v_cut;
    GET DIAGNOSTICS v_notes = ROW_COUNT;
  END IF;
  SELECT count(*) INTO v_nkept FROM public.note n
  WHERE n.workspace_id = v_import.workspace_id AND n.import_id = v_import.id AND n.deleted_at IS NULL;

  -- 3 · Las personas nacidas en ella, sin tocar después y sin uso.
  WITH gone AS (
    UPDATE public.workspace_person wp SET deleted_at = now()
    WHERE wp.workspace_id = v_import.workspace_id AND wp.import_id = v_import.id
      AND wp.deleted_at IS NULL AND wp.updated_at <= v_cut
      AND NOT EXISTS (SELECT 1 FROM public.user_profile up WHERE up.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.conversation_contact cc
                      WHERE cc.workspace_id = wp.workspace_id AND cc.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.cast_member m
                      WHERE m.workspace_id = wp.workspace_id AND m.person_id = wp.person_id AND m.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.crew_assignment a
                      WHERE a.workspace_id = wp.workspace_id AND a.person_id = wp.person_id AND a.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.cast_override o
                      WHERE o.workspace_id = wp.workspace_id AND o.deleted_at IS NULL
                        AND (o.person_id = wp.person_id OR o.replaces_person_id = wp.person_id))
      AND NOT EXISTS (SELECT 1 FROM public.availability_block b
                      WHERE b.workspace_id = wp.workspace_id AND b.person_id = wp.person_id AND b.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.commitment_person cp
                      WHERE cp.workspace_id = wp.workspace_id AND cp.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.mailout_recipient r
                      WHERE r.workspace_id = wp.workspace_id AND r.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.person_acquaintance pa
                      WHERE pa.workspace_id = wp.workspace_id AND pa.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.workspace_invitation wi
                      WHERE wi.workspace_id = wp.workspace_id AND wi.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.person_merge pm
                      WHERE pm.keep_person_id = wp.person_id OR pm.drop_person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.channel_chat_member ccm WHERE ccm.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.channel_message cm WHERE cm.sender_person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.expense e WHERE e.paid_by_person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.roadsheet_share rs WHERE rs.person_id = wp.person_id)
      AND NOT EXISTS (SELECT 1 FROM public.roadsheet_late_notice rl WHERE rl.person_id = wp.person_id)
      -- Una nota que no es de esta importación (las suyas no cuentan: si las
      -- deja otra persona al deshacer, se quedan con su autora).
      AND NOT EXISTS (SELECT 1 FROM public.note n
                      WHERE n.workspace_id = wp.workspace_id AND n.person_id = wp.person_id AND n.deleted_at IS NULL
                        AND n.import_id IS DISTINCT FROM v_import.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_persons FROM gone;
  SELECT count(*) INTO v_pkept FROM public.workspace_person wp
  WHERE wp.workspace_id = v_import.workspace_id AND wp.import_id = v_import.id AND wp.deleted_at IS NULL;

  -- 4 · Las organizaciones nacidas en ella, sin tocar después, sin nadie dentro y sin uso.
  WITH gone AS (
    UPDATE public.workspace_organization o SET deleted_at = now()
    WHERE o.workspace_id = v_import.workspace_id AND o.import_id = v_import.id
      AND o.deleted_at IS NULL AND o.updated_at <= v_cut
      AND NOT EXISTS (SELECT 1 FROM public.workspace_person wp
                      WHERE wp.workspace_id = o.workspace_id AND wp.organization_id = o.id AND wp.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.conversation c
                      WHERE c.workspace_id = o.workspace_id AND c.organization_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.invoice i
                      WHERE i.workspace_id = o.workspace_id AND i.payer_organization_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.venue v
                      WHERE v.workspace_id = o.workspace_id AND v.organization_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.organization_merge om
                      WHERE om.keep_organization_id = o.id OR om.drop_organization_id = o.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_orgs FROM gone;
  SELECT count(*) INTO v_okept FROM public.workspace_organization o
  WHERE o.workspace_id = v_import.workspace_id AND o.import_id = v_import.id AND o.deleted_at IS NULL;

  UPDATE public.contact_import SET status = 'undone', undone_at = now(), undone_by = v_caller
  WHERE id = v_import.id;

  RETURN jsonb_build_object(
    'persons_removed', v_persons,
    'organizations_removed', v_orgs,
    'notes_removed', v_notes,
    'notes_kept', v_nkept,
    'fields_restored', v_restored,
    'persons_kept', v_pkept,
    'organizations_kept', v_okept
  );
END;
$function$;

COMMENT ON FUNCTION public.undo_contact_import(uuid) IS
  '138: undo a contact import within 7 days (its author, or the workspace owner or admin). Soft-deletes what was born in it and is untouched and unused, and empties the fields it filled that still hold its value. What someone touched or uses afterwards stays, and so do the author''s private notes when someone else undoes it.';
REVOKE ALL ON FUNCTION public.undo_contact_import(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_contact_import(uuid) TO authenticated;

-- ── Rollback (después de desplegar la app anterior) ─────────────────────────
-- Lo importado se queda como contactos normales: las columnas caen, las filas no.
-- `person_is_team` vuelve al cuerpo de 20261018100000 ANTES de quitar la
-- columna que nombra (una función sql no registra esa dependencia).
--   BEGIN;
--   CREATE OR REPLACE FUNCTION private.person_is_team(p_workspace_id uuid, p_person_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
--   AS $$
--     SELECT
--       NOT EXISTS (SELECT 1 FROM public.conversation_contact cc
--                   WHERE cc.workspace_id = p_workspace_id AND cc.person_id = p_person_id)
--       OR EXISTS (SELECT 1 FROM public.user_profile up
--                  JOIN public.membership m ON m.level = 'workspace' AND m.workspace_id = p_workspace_id
--                   AND m.user_id = up.user_id AND m.accepted_at IS NOT NULL
--                  WHERE up.person_id = p_person_id)
--       OR EXISTS (SELECT 1 FROM public.workspace_invitation i
--                  WHERE i.workspace_id = p_workspace_id AND i.person_id = p_person_id AND i.revoked_at IS NULL)
--       OR EXISTS (SELECT 1 FROM public.cast_member x
--                  WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL)
--       OR EXISTS (SELECT 1 FROM public.crew_assignment x
--                  WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL)
--       OR EXISTS (SELECT 1 FROM public.cast_override x
--                  WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
--                    AND (x.person_id = p_person_id OR x.replaces_person_id = p_person_id))
--       OR EXISTS (SELECT 1 FROM public.availability_block x
--                  WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id AND x.deleted_at IS NULL)
--       OR EXISTS (SELECT 1 FROM public.commitment_person x
--                  WHERE x.workspace_id = p_workspace_id AND x.person_id = p_person_id);
--   $$;
--   DROP FUNCTION public.undo_contact_import(uuid);
--   DROP FUNCTION public.import_contacts(uuid, uuid, integer, text, integer, jsonb, boolean);
--   DROP FUNCTION public.contact_import_lookup(uuid, text[], text[], text[]);
--   DROP FUNCTION private.can_import_contacts(uuid);
--   DROP TRIGGER note_guard_import_id ON public.note;
--   DROP FUNCTION private.guard_note_import_id();
--   ALTER TABLE public.note DROP COLUMN import_id;
--   ALTER TABLE public.workspace_organization DROP COLUMN import_id;
--   ALTER TABLE public.workspace_person DROP COLUMN import_id;
--   DROP TABLE public.contact_import;
--   COMMIT;
