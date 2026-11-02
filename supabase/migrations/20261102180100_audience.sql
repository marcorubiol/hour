-- ADR-173 · El público y sus invitaciones, fase 1: esquema y RPC.
-- Plan: build/plans/2026-11-01-audience.md (§ 4, § 7 fase 1).
--
-- Según § 34: tablas y columnas nuevas; tres DROP NOT NULL que no rompen
-- lectores (`mailout.project_id`, `mailout_recipient.conversation_id`; el
-- `mailout.mail_domain_id` ya admitía NULL); RPC del envío reescritas desde su
-- firma viva (comprobada el 2026-11-02: el md5 de pg_get_functiondef de las 33
-- funciones del envío en producción es el de las migraciones). El Worker
-- desplegado sigue funcionando: las RPC que cambian de columnas de salida
-- (mailout_claim, mailout_preview, mailout_compose_preview,
-- mailout_send_context, mailout_unsubscribe_info) solo AÑADEN columnas al
-- final, y `add_mail_domain` gana un parámetro con valor por defecto (DROP y
-- CREATE: una sola firma, sin sobrecarga).
-- Rollback: build/runbooks/rollback-20261102-audience.sql.
--
-- Lo que hay:
--   · tablas `audience`, `audience_consent_text` (inmutable), `audience_import`,
--     `audience_subscription`, `audience_consent_event` (append-only);
--   · `mail_domain.purpose` (difusión o público); `mailout.kind` (envío o
--     invitación), con `audience_id`, `audience_mail_domain_id` y
--     `performance_id`; `mailout_recipient` con `audience_subscription_id`,
--     `mail_domain_id` (la identidad por la que sale, congelada al poner en
--     cola) y `consent_event_id`; `workspace.invitation_daily_cap` y la
--     revisión del primer envío real de la identidad del público;
--   · la faceta estándar «Público» (`audience`) a nivel de espacio, la única
--     que `set_membership_facet` deja dar en el espacio;
--   · RPC de persona, por token y de máquina (§ 4.4 a § 4.6).
--
-- Fronteras:
--   · El origen de un destinatario lo dice su fila: `conversation_id`
--     (profesional) o `audience_subscription_id` (público), nunca los dos
--     (ADR-173 § 10). Baja, pie, historial, tope e identidad miran eso.
--   · Leer el público: owner, admin o la faceta Público (ver); escribirlo, la
--     faceta con «ver y editar». La prueba con IP y el borrado de datos, solo
--     admin. Profesionales en una invitación: `edit:conversation` en el
--     proyecto de cada conversación, como el envío; una invitación solo a
--     profesionales no pide la faceta.
--   · Nadie escribe las tablas por la API: escriben las RPC. El token de
--     confirmación se guarda solo como hash y no tiene grant; IP, agente y
--     página del consentimiento tampoco (solo `audience_consent_proof`).
--   · `audience_subscribe` y `audience_confirm` son de service_role, no de
--     anon: la IP y el agente los pone el Worker (frontera de ADR-110 ampliada
--     a `audience_*` por ADR-173 § 4).
--
-- Diferencias con el plan (para el ADR o el plan, dichas al coordinador):
--   · `mailout_recipient.mail_domain_id` admite NULL: los borradores tienen
--     destinatarios antes de tener dominio, y en producción no queda ningún
--     envío con dominio (los de los tests se borraron). La regla es un CHECK:
--     en cola o saliendo, con dominio.
--   · `mailout` no lleva `CHECK (kind = 'invitation' OR mail_domain_id IS NOT
--     NULL)`: un borrador de difusión ya podía no tener dominio.
--   · `CHECK (audience_mail_domain_id IS NULL OR audience_id IS NOT NULL)` en
--     vez de la igualdad: borrar el dominio de una invitación acabada lo deja a
--     NULL; `queue_mailout` exige los dos.
--   · `audience_confirmation_token` (máquina) emite el token de un alta a mano
--     (`add_audience_subscription` no lo devuelve a quien la apunta: podría
--     confirmarla por la persona).
--   · Una dirección de baja que vuelve a apuntarse sigue `unsubscribed` hasta
--     que confirma (así la purga de pendientes no borra su baja).
--   · La unicidad `(mailout_id, address)` cuenta solo las filas que no quedan
--     saltadas: un profesional que no sale deja sitio a su suscripción.
--   · «Volver a apuntarme» del público es de máquina (`audience_resubscribe`,
--     con IP y agente): por token anon, `mailout_resubscribe` no lo hace.

-- ── Vocabulario ───────────────────────────────────────────────────────────
CREATE TYPE public.mail_domain_purpose AS ENUM ('outreach', 'audience');
CREATE TYPE public.mailout_kind AS ENUM ('outreach', 'invitation');
CREATE TYPE public.audience_status AS ENUM ('draft', 'open', 'closed', 'archived');
CREATE TYPE public.audience_subscription_status AS ENUM ('pending', 'confirmed', 'unsubscribed');
CREATE TYPE public.audience_source AS ENUM ('form', 'embed', 'import', 'manual');
CREATE TYPE public.audience_consent_event_kind AS ENUM (
  'requested', 'confirmed', 'imported', 'unsubscribed', 'resubscribed', 'complained'
);
CREATE TYPE public.audience_consent_channel AS ENUM ('form', 'embed', 'header', 'page', 'admin', 'import');
CREATE TYPE public.audience_import_status AS ENUM ('review', 'done', 'rejected');

-- ── La faceta Público ─────────────────────────────────────────────────────
INSERT INTO public.facet (key, sort) VALUES ('audience', 70);
INSERT INTO public.facet_level (facet_id, level)
SELECT f.id, 'workspace' FROM public.facet f WHERE f.key = 'audience' AND f.workspace_id IS NULL;

-- Las facetas de espacio siguen sin decidir, salvo Público (ADR-173 § 4).
-- Cuerpo vivo (md5 ffd261bd… en producción y en local) con solo esa línea.
CREATE OR REPLACE FUNCTION public.set_membership_facet(p_membership_id uuid, p_facet_id uuid, p_verb access_verb DEFAULT NULL::access_verb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_m      public.membership;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_m FROM public.membership WHERE id = p_membership_id;
  IF v_m.id IS NULL OR NOT private.can_manage_membership(v_m.id, v_caller) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF v_m.level = 'workspace' AND NOT EXISTS (
    SELECT 1 FROM public.facet f WHERE f.id = p_facet_id AND f.workspace_id IS NULL AND f.key = 'audience'
  ) THEN
    RAISE EXCEPTION 'workspace-level facets are not decided yet' USING ERRCODE = '0A000';
  END IF;

  IF p_verb IS NULL THEN
    DELETE FROM public.membership_facet
    WHERE membership_id = v_m.id AND facet_id = p_facet_id;
    RETURN;
  END IF;

  IF NOT private.model_has_facet_at(v_m.level, private.membership_container_id(v_m), p_facet_id, p_verb, v_caller) THEN
    RAISE EXCEPTION 'you can only grant what you hold' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.membership_facet (membership_id, facet_id, verb, source, granted_by)
  VALUES (v_m.id, p_facet_id, p_verb, 'override', v_caller)
  ON CONFLICT (membership_id, facet_id) DO UPDATE SET
    verb       = EXCLUDED.verb,
    source     = 'override',
    granted_by = EXCLUDED.granted_by;
END;
$function$;

-- Owner y admin del espacio, o un miembro con la faceta Público en el
-- espacio («ver», o «ver y editar» si se pide editar).
CREATE FUNCTION private.audience_access(p_workspace_id uuid, p_edit boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT me.uid IS NOT NULL AND p_workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.membership w
    WHERE w.level = 'workspace' AND w.workspace_id = p_workspace_id
      AND w.user_id = me.uid AND w.accepted_at IS NOT NULL
      AND (w.workspace_role IN ('owner', 'admin')
           OR EXISTS (
             SELECT 1 FROM public.membership_facet mf
             JOIN public.facet f ON f.id = mf.facet_id AND f.key = 'audience' AND f.workspace_id IS NULL
             WHERE mf.membership_id = w.id
               AND (mf.verb = 'edit' OR NOT coalesce(p_edit, true))))
  )
  FROM me;
$$;

COMMENT ON FUNCTION private.audience_access(uuid, boolean) IS
  'ADR-173 § 4: owner/admin, or the standard Audience facet on the workspace membership (view; edit when p_edit).';

-- ── workspace: tope y revisión de la identidad del público ────────────────
-- Las escribe solo service_role: el grant de UPDATE de `workspace` es por
-- columnas desde 20261015100000 y estas no están en él.
ALTER TABLE public.workspace
  ADD COLUMN invitation_daily_cap integer NOT NULL DEFAULT 1000,
  ADD COLUMN invitation_reviewed_at timestamptz,
  ADD COLUMN invitation_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT workspace_invitation_daily_cap_check CHECK (invitation_daily_cap BETWEEN 0 AND 100000);

CREATE INDEX workspace_invitation_reviewed_by_idx
  ON public.workspace (invitation_reviewed_by) WHERE invitation_reviewed_by IS NOT NULL;

COMMENT ON COLUMN public.workspace.invitation_daily_cap IS
  'ADR-173: how many invitation emails to the audience this workspace may send in any 24 hours (professionals count in mailout_daily_cap). service_role only.';
COMMENT ON COLUMN public.workspace.invitation_reviewed_at IS
  'ADR-173: when Marco approved the first real send through this workspace''s audience identity. NULL = the next one waits in review. service_role only.';

-- ── mail_domain: para qué es cada identidad ───────────────────────────────
ALTER TABLE public.mail_domain
  ADD COLUMN purpose public.mail_domain_purpose NOT NULL DEFAULT 'outreach';

COMMENT ON COLUMN public.mail_domain.purpose IS
  'ADR-173 § 5: outreach (the company''s main domain, professionals) or audience (a subdomain with its own tenant, invitations to the audience). Set when the domain is added.';

-- ── audience: una lista ───────────────────────────────────────────────────
CREATE TABLE public.audience (
  id                    uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id          uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  form_key              text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  languages             text[] NOT NULL DEFAULT ARRAY['es']::text[],
  default_language      text NOT NULL DEFAULT 'es',
  status                public.audience_status NOT NULL DEFAULT 'draft',
  current_text_version  integer,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT audience_form_key_key UNIQUE (form_key),
  CONSTRAINT audience_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT audience_description_length CHECK (description IS NULL OR length(description) BETWEEN 1 AND 500),
  CONSTRAINT audience_form_key_format CHECK (form_key ~ '^[0-9a-f]{32}$'),
  CONSTRAINT audience_languages_check
    CHECK (cardinality(languages) BETWEEN 1 AND 4 AND languages <@ ARRAY['es', 'ca', 'en', 'fr']::text[]),
  CONSTRAINT audience_default_language_check CHECK (default_language = ANY (languages)),
  CONSTRAINT audience_text_version_check CHECK (current_text_version IS NULL OR current_text_version >= 1)
);

COMMENT ON TABLE public.audience IS
  'ADR-173: a list of the company''s audience, with its versioned consent text and its public form (form_key). Read with the Audience facet; written by RPC.';

CREATE INDEX audience_workspace_idx ON public.audience (workspace_id);
CREATE INDEX audience_created_by_idx ON public.audience (created_by) WHERE created_by IS NOT NULL;

-- ── audience_consent_text: lo que se aceptó, inmutable ────────────────────
CREATE TABLE public.audience_consent_text (
  id            uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id  uuid NOT NULL,
  audience_id   uuid NOT NULL,
  version       integer NOT NULL,
  language      text NOT NULL,
  consent_text  text NOT NULL,
  info_text     text,
  privacy_url   text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_consent_text_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT audience_consent_text_audience_fkey FOREIGN KEY (audience_id, workspace_id)
    REFERENCES public.audience (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_consent_text_version_key UNIQUE (audience_id, version, language),
  CONSTRAINT audience_consent_text_version_check CHECK (version >= 1),
  CONSTRAINT audience_consent_text_language_check CHECK (language IN ('es', 'ca', 'en', 'fr')),
  CONSTRAINT audience_consent_text_consent_length CHECK (length(consent_text) BETWEEN 10 AND 500),
  CONSTRAINT audience_consent_text_info_length CHECK (info_text IS NULL OR length(info_text) BETWEEN 1 AND 1500),
  CONSTRAINT audience_consent_text_privacy_url_check
    CHECK (privacy_url IS NULL OR (privacy_url ~* '^https?://' AND length(privacy_url) <= 2048))
);

COMMENT ON TABLE public.audience_consent_text IS
  'ADR-173 · plan § 3.4: the consent text of a list, one row per version and language. Never updated: a change is a new version; subscriptions keep the one they accepted.';

CREATE INDEX audience_consent_text_audience_idx ON public.audience_consent_text (audience_id, workspace_id);
CREATE INDEX audience_consent_text_created_by_idx ON public.audience_consent_text (created_by) WHERE created_by IS NOT NULL;

-- ── audience_import: una importación con su base declarada ────────────────
CREATE TABLE public.audience_import (
  id                  uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id        uuid NOT NULL,
  audience_id         uuid NOT NULL,
  filename            text,
  basis_kind          public.mail_basis_kind NOT NULL,
  source_note         text NOT NULL,
  statement_text      text NOT NULL,
  statement_language  text NOT NULL,
  declared_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  declared_at         timestamptz NOT NULL DEFAULT now(),
  row_count           integer NOT NULL DEFAULT 0,
  imported_count      integer NOT NULL DEFAULT 0,
  skipped             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              public.audience_import_status NOT NULL DEFAULT 'review',
  reviewed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_import_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT audience_import_audience_fkey FOREIGN KEY (audience_id, workspace_id)
    REFERENCES public.audience (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_import_basis_check CHECK (basis_kind IN ('consent', 'relationship')),
  CONSTRAINT audience_import_source_note_length CHECK (length(source_note) BETWEEN 10 AND 1000),
  CONSTRAINT audience_import_statement_length CHECK (length(statement_text) BETWEEN 1 AND 1000),
  CONSTRAINT audience_import_statement_language_check CHECK (statement_language IN ('es', 'ca', 'en', 'fr')),
  CONSTRAINT audience_import_filename_length CHECK (filename IS NULL OR length(filename) BETWEEN 1 AND 255),
  CONSTRAINT audience_import_counts_check CHECK (row_count >= 0 AND imported_count BETWEEN 0 AND row_count),
  CONSTRAINT audience_import_skipped_object CHECK (jsonb_typeof(skipped) = 'object')
);

COMMENT ON TABLE public.audience_import IS
  'ADR-173 § 6 · plan § 3.6: an imported list with the basis its importer declared (source and exact statement kept). The first of each workspace waits in review; its rows get no invitation until approved.';

CREATE INDEX audience_import_audience_idx ON public.audience_import (audience_id, workspace_id);
CREATE INDEX audience_import_workspace_idx ON public.audience_import (workspace_id);
CREATE INDEX audience_import_declared_by_idx ON public.audience_import (declared_by) WHERE declared_by IS NOT NULL;
CREATE INDEX audience_import_reviewed_by_idx ON public.audience_import (reviewed_by) WHERE reviewed_by IS NOT NULL;

-- ── audience_subscription: una persona en una lista ───────────────────────
CREATE TABLE public.audience_subscription (
  id                           uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id                 uuid NOT NULL,
  audience_id                  uuid NOT NULL,
  address                      extensions.citext NOT NULL,
  name                         text,
  language                     text NOT NULL DEFAULT 'es',
  status                       public.audience_subscription_status NOT NULL DEFAULT 'pending',
  basis_kind                   public.mail_basis_kind NOT NULL DEFAULT 'consent',
  source                       public.audience_source NOT NULL,
  import_id                    uuid,
  consent_text_id              uuid,
  confirm_token_hash           text,
  confirm_expires_at           timestamptz,
  confirm_sent_count           integer NOT NULL DEFAULT 0,
  confirm_last_sent_at         timestamptz,
  confirm_provider_message_id  text,
  confirmed_at                 timestamptz,
  unsubscribed_at              timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_subscription_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT audience_subscription_audience_fkey FOREIGN KEY (audience_id, workspace_id)
    REFERENCES public.audience (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_subscription_import_fkey FOREIGN KEY (import_id, workspace_id)
    REFERENCES public.audience_import (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_subscription_text_fkey FOREIGN KEY (consent_text_id, workspace_id)
    REFERENCES public.audience_consent_text (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_subscription_address_key UNIQUE (audience_id, address),
  CONSTRAINT audience_subscription_address_format
    CHECK (address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(address) <= 254),
  CONSTRAINT audience_subscription_name_length CHECK (name IS NULL OR length(name) BETWEEN 1 AND 200),
  CONSTRAINT audience_subscription_language_check CHECK (language IN ('es', 'ca', 'en', 'fr')),
  CONSTRAINT audience_subscription_basis_check CHECK (basis_kind IN ('consent', 'relationship')),
  CONSTRAINT audience_subscription_import_source CHECK ((source = 'import') = (import_id IS NOT NULL)),
  CONSTRAINT audience_subscription_confirmed_at CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CONSTRAINT audience_subscription_token_format
    CHECK (confirm_token_hash IS NULL OR confirm_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audience_subscription_sent_count_check CHECK (confirm_sent_count BETWEEN 0 AND 100),
  CONSTRAINT audience_subscription_provider_message_length
    CHECK (confirm_provider_message_id IS NULL OR length(confirm_provider_message_id) <= 200)
);

COMMENT ON TABLE public.audience_subscription IS
  'ADR-173: one address on a list (pending until confirmed, confirmed, unsubscribed) and how it got there. The confirm_* columns have no grant for authenticated: the token is stored only as its SHA-256.';

CREATE UNIQUE INDEX audience_subscription_token_key
  ON public.audience_subscription (confirm_token_hash) WHERE confirm_token_hash IS NOT NULL;
CREATE INDEX audience_subscription_workspace_idx ON public.audience_subscription (workspace_id);
CREATE INDEX audience_subscription_import_idx ON public.audience_subscription (import_id, workspace_id) WHERE import_id IS NOT NULL;
CREATE INDEX audience_subscription_text_idx ON public.audience_subscription (consent_text_id, workspace_id) WHERE consent_text_id IS NOT NULL;
CREATE INDEX audience_subscription_workspace_address_idx ON public.audience_subscription (workspace_id, address);
CREATE INDEX audience_subscription_pending_idx ON public.audience_subscription (created_at) WHERE status = 'pending';
CREATE INDEX audience_subscription_provider_message_idx
  ON public.audience_subscription (confirm_provider_message_id) WHERE confirm_provider_message_id IS NOT NULL;

-- ── audience_consent_event: la prueba, append-only ────────────────────────
CREATE TABLE public.audience_consent_event (
  id                 uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id       uuid NOT NULL,
  subscription_id    uuid NOT NULL,
  kind               public.audience_consent_event_kind NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  consent_text_id    uuid,
  channel            public.audience_consent_channel,
  ip                 inet,
  user_agent         text,
  page_url           text,
  age_confirmed      boolean,
  actor_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  import_id          uuid,
  provider_event_id  text,
  CONSTRAINT audience_consent_event_id_workspace_key UNIQUE (id, workspace_id),
  -- Borrar los datos de alguien borra su prueba (plan § 4.2).
  CONSTRAINT audience_consent_event_subscription_fkey FOREIGN KEY (subscription_id, workspace_id)
    REFERENCES public.audience_subscription (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_consent_event_text_fkey FOREIGN KEY (consent_text_id, workspace_id)
    REFERENCES public.audience_consent_text (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_consent_event_import_fkey FOREIGN KEY (import_id, workspace_id)
    REFERENCES public.audience_import (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT audience_consent_event_lengths
    CHECK ((user_agent IS NULL OR length(user_agent) <= 500)
       AND (page_url IS NULL OR length(page_url) <= 2048)
       AND (provider_event_id IS NULL OR length(provider_event_id) BETWEEN 1 AND 200))
);

COMMENT ON TABLE public.audience_consent_event IS
  'ADR-173 · plan § 3.4: the consent record of a subscription (requested, confirmed, imported, unsubscribed, resubscribed, complained). Append-only. ip, user_agent and page_url have no grant: only audience_consent_proof (admin) returns them.';

CREATE INDEX audience_consent_event_subscription_idx ON public.audience_consent_event (subscription_id, workspace_id);
CREATE INDEX audience_consent_event_workspace_idx ON public.audience_consent_event (workspace_id);
CREATE INDEX audience_consent_event_text_idx ON public.audience_consent_event (consent_text_id, workspace_id) WHERE consent_text_id IS NOT NULL;
CREATE INDEX audience_consent_event_import_idx ON public.audience_consent_event (import_id, workspace_id) WHERE import_id IS NOT NULL;
CREATE INDEX audience_consent_event_actor_idx ON public.audience_consent_event (actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE UNIQUE INDEX audience_consent_event_provider_event_key
  ON public.audience_consent_event (provider_event_id) WHERE provider_event_id IS NOT NULL;

-- ── Guardas ───────────────────────────────────────────────────────────────

-- Texto y prueba no se cambian nunca.
CREATE FUNCTION private.audience_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audience_consent_text_immutable BEFORE UPDATE ON public.audience_consent_text
  FOR EACH ROW EXECUTE FUNCTION private.audience_guard_immutable();
CREATE TRIGGER audience_consent_event_immutable BEFORE UPDATE ON public.audience_consent_event
  FOR EACH ROW EXECUTE FUNCTION private.audience_guard_immutable();

-- Una lista abierta tiene texto vigente en todos sus idiomas y la política de
-- privacidad del espacio (plan § 4.2).
CREATE FUNCTION private.audience_guard_open()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'open' THEN
    IF NEW.current_text_version IS NULL OR EXISTS (
      SELECT 1 FROM unnest(NEW.languages) l
      WHERE NOT EXISTS (SELECT 1 FROM public.audience_consent_text t
                        WHERE t.audience_id = NEW.id AND t.version = NEW.current_text_version AND t.language = l)
    ) THEN
      RAISE EXCEPTION 'an open list needs a consent text in each of its languages' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = NEW.workspace_id AND w.privacy_url IS NOT NULL) THEN
      RAISE EXCEPTION 'an open list needs the workspace privacy policy' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audience_guard_open BEFORE INSERT OR UPDATE ON public.audience
  FOR EACH ROW EXECUTE FUNCTION private.audience_guard_open();

-- ── RLS, grants y triggers de las tablas nuevas ───────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audience', 'audience_consent_text', 'audience_import', 'audience_subscription', 'audience_consent_event'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.audience_access(workspace_id, false))',
      t || '_select', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['audience', 'audience_import', 'audience_subscription'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id()',
      t || '_guard_ws', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.audience, public.audience_consent_text, public.audience_import TO authenticated;
-- Por columnas A PROPÓSITO: el token, su caducidad y sus envíos no existen
-- para PostgREST.
GRANT SELECT (
  id, workspace_id, audience_id, address, name, language, status, basis_kind, source,
  import_id, consent_text_id, confirmed_at, unsubscribed_at, created_at, updated_at
) ON TABLE public.audience_subscription TO authenticated;
-- Sin IP, agente ni página: solo audience_consent_proof (admin).
GRANT SELECT (
  id, workspace_id, subscription_id, kind, occurred_at, consent_text_id, channel,
  age_confirmed, actor_user_id, import_id, provider_event_id
) ON TABLE public.audience_consent_event TO authenticated;

-- ── mailout: la invitación ────────────────────────────────────────────────
ALTER TABLE public.mailout
  ADD COLUMN kind public.mailout_kind NOT NULL DEFAULT 'outreach',
  ADD COLUMN audience_id uuid,
  ADD COLUMN audience_mail_domain_id uuid,
  ADD COLUMN performance_id uuid REFERENCES public.performance(id) ON DELETE SET NULL,
  ALTER COLUMN project_id DROP NOT NULL,
  ADD CONSTRAINT mailout_audience_fkey FOREIGN KEY (audience_id, workspace_id)
    REFERENCES public.audience (id, workspace_id),
  ADD CONSTRAINT mailout_audience_domain_fkey FOREIGN KEY (audience_mail_domain_id, workspace_id)
    REFERENCES public.mail_domain (id, workspace_id) ON DELETE SET NULL (audience_mail_domain_id),
  ADD CONSTRAINT mailout_outreach_has_project CHECK (kind = 'invitation' OR project_id IS NOT NULL),
  ADD CONSTRAINT mailout_audience_is_invitation CHECK (audience_id IS NULL OR kind = 'invitation'),
  ADD CONSTRAINT mailout_performance_is_invitation CHECK (performance_id IS NULL OR kind = 'invitation'),
  ADD CONSTRAINT mailout_audience_domain_has_audience CHECK (audience_mail_domain_id IS NULL OR audience_id IS NOT NULL);

COMMENT ON COLUMN public.mailout.kind IS
  'ADR-173: outreach (bulk send to conversations of one project) or invitation (to a list of the audience and/or professionals of any project). Each recipient says its own origin.';
COMMENT ON COLUMN public.mailout.audience_id IS
  'ADR-173: the list of an invitation (optional: an invitation may go only to professionals). Its confirmed subscriptions are frozen into recipients by queue_mailout.';
COMMENT ON COLUMN public.mailout.audience_mail_domain_id IS
  'ADR-173 § 5: the audience identity (purpose = audience) the list recipients go out through. mail_domain_id stays the outreach identity, for professionals.';

CREATE INDEX mailout_audience_idx ON public.mailout (audience_id, workspace_id) WHERE audience_id IS NOT NULL;
CREATE INDEX mailout_audience_domain_idx ON public.mailout (audience_mail_domain_id, workspace_id) WHERE audience_mail_domain_id IS NOT NULL;
CREATE INDEX mailout_performance_idx ON public.mailout (performance_id) WHERE performance_id IS NOT NULL;

-- Cada dominio con el propósito de su columna; la función, del espacio y, si
-- hay proyecto, del proyecto; el tipo no cambia.
CREATE FUNCTION private.mailout_guard_kind()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'a mailout does not change kind' USING ERRCODE = '42501';
  END IF;
  IF NEW.mail_domain_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_domain d WHERE d.id = NEW.mail_domain_id AND d.purpose = 'outreach'
  ) THEN
    RAISE EXCEPTION 'mail_domain_id must be an outreach domain' USING ERRCODE = '23514';
  END IF;
  IF NEW.audience_mail_domain_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_domain d WHERE d.id = NEW.audience_mail_domain_id AND d.purpose = 'audience'
  ) THEN
    RAISE EXCEPTION 'audience_mail_domain_id must be an audience domain' USING ERRCODE = '23514';
  END IF;
  IF NEW.performance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.performance p
    WHERE p.id = NEW.performance_id AND p.workspace_id = NEW.workspace_id
      AND (NEW.project_id IS NULL OR p.project_id = NEW.project_id)
  ) THEN
    RAISE EXCEPTION 'the performance is not in this workspace or project' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mailout_guard_kind
  BEFORE INSERT OR UPDATE OF kind, mail_domain_id, audience_mail_domain_id, performance_id, project_id
  ON public.mailout FOR EACH ROW EXECUTE FUNCTION private.mailout_guard_kind();

-- ── mailout_recipient: el origen y la identidad de cada fila ──────────────
ALTER TABLE public.mailout_recipient
  ALTER COLUMN conversation_id DROP NOT NULL,
  ADD COLUMN audience_subscription_id uuid,
  ADD COLUMN mail_domain_id uuid,
  ADD COLUMN consent_event_id uuid;

-- La identidad de lo que ya salió o está en vuelo, la de su envío.
UPDATE public.mailout_recipient r
SET mail_domain_id = m.mail_domain_id
FROM public.mailout m
WHERE m.id = r.mailout_id AND m.mail_domain_id IS NOT NULL
  AND r.mail_domain_id IS NULL AND r.status NOT IN ('pending', 'skipped');

ALTER TABLE public.mailout_recipient
  ADD CONSTRAINT mailout_recipient_subscription_fkey FOREIGN KEY (audience_subscription_id, workspace_id)
    REFERENCES public.audience_subscription (id, workspace_id) ON DELETE CASCADE,
  ADD CONSTRAINT mailout_recipient_domain_fkey FOREIGN KEY (mail_domain_id, workspace_id)
    REFERENCES public.mail_domain (id, workspace_id) ON DELETE SET NULL (mail_domain_id),
  ADD CONSTRAINT mailout_recipient_consent_event_fkey FOREIGN KEY (consent_event_id, workspace_id)
    REFERENCES public.audience_consent_event (id, workspace_id) ON DELETE SET NULL (consent_event_id),
  ADD CONSTRAINT mailout_recipient_one_origin CHECK (num_nonnulls(conversation_id, audience_subscription_id) = 1),
  ADD CONSTRAINT mailout_recipient_mailout_subscription_key UNIQUE (mailout_id, audience_subscription_id),
  ADD CONSTRAINT mailout_recipient_consent_event_is_subscriber
    CHECK (consent_event_id IS NULL OR audience_subscription_id IS NOT NULL),
  ADD CONSTRAINT mailout_recipient_subscriber_basis
    CHECK (audience_subscription_id IS NULL OR basis_kind IS NULL OR basis_kind IN ('consent', 'relationship')),
  ADD CONSTRAINT mailout_recipient_subscriber_kind
    CHECK (CASE WHEN audience_subscription_id IS NOT NULL THEN address_kind = 'subscriber'
                ELSE address_kind IS DISTINCT FROM 'subscriber' END),
  ADD CONSTRAINT mailout_recipient_in_flight_has_domain
    CHECK (status NOT IN ('queued', 'sending') OR mail_domain_id IS NOT NULL);

-- Un correo por dirección y envío, entre las filas que salen: una fila
-- saltada (un profesional sin base, en «no esta vez», no disponible) deja
-- sitio a la suscripción de la misma dirección (ADR-173 § 10).
ALTER TABLE public.mailout_recipient DROP CONSTRAINT mailout_recipient_mailout_address_key;
CREATE UNIQUE INDEX mailout_recipient_mailout_address_key
  ON public.mailout_recipient (mailout_id, address) WHERE status <> 'skipped';

COMMENT ON COLUMN public.mailout_recipient.audience_subscription_id IS
  'ADR-173 § 10: set for a recipient from the audience (then conversation_id is NULL). The column that is set is the origin.';
COMMENT ON COLUMN public.mailout_recipient.mail_domain_id IS
  'ADR-173 § 5: the identity this email goes out through, frozen by queue_mailout (outreach for a professional, audience for a subscriber). Cap and tenant follow its purpose.';
COMMENT ON COLUMN public.mailout_recipient.consent_event_id IS
  'ADR-173: the consent event (confirmed, imported or resubscribed) that justified sending to a subscriber, frozen at queue time.';

CREATE INDEX mailout_recipient_subscription_idx
  ON public.mailout_recipient (audience_subscription_id, workspace_id) WHERE audience_subscription_id IS NOT NULL;
CREATE INDEX mailout_recipient_domain_idx
  ON public.mailout_recipient (mail_domain_id, workspace_id) WHERE mail_domain_id IS NOT NULL;
CREATE INDEX mailout_recipient_consent_event_idx
  ON public.mailout_recipient (consent_event_id, workspace_id) WHERE consent_event_id IS NOT NULL;

GRANT SELECT (audience_subscription_id, mail_domain_id, consent_event_id)
  ON TABLE public.mailout_recipient TO authenticated;

-- ── Lectura de una invitación ─────────────────────────────────────────────

-- Una invitación la lee quien la creó (miembro del espacio), quien lleva el
-- público o quien lee alguna conversación de sus destinatarios, también por
-- una membresía solo de proyecto (plan § 4.3; como ADR-124 § 8).
-- SECURITY DEFINER: la política de `mailout_recipient` lee `mailout`.
CREATE FUNCTION private.invitation_readable_by_caller(p_mailout_id uuid, p_workspace_id uuid, p_created_by uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  SELECT (
    (p_created_by = me.uid AND public.is_workspace_member(p_workspace_id))
    OR private.audience_access(p_workspace_id, false)
    OR EXISTS (
      SELECT 1
      FROM public.mailout_recipient r
      JOIN public.conversation c ON c.id = r.conversation_id
      WHERE r.mailout_id = p_mailout_id
        AND c.deleted_at IS NULL
        AND (c.private_to IS NULL OR c.private_to = me.uid)
        AND private.model_has_permission(c.project_id, 'read:conversation', me.uid)
    )
  )
  FROM me;
$$;

ALTER POLICY mailout_select ON public.mailout
  USING (CASE kind
           WHEN 'outreach' THEN public.has_permission(project_id, 'read:conversation')
                                AND private.mailout_readable_by_caller(id, created_by)
           ELSE private.invitation_readable_by_caller(id, workspace_id, created_by)
         END);

-- Hereda el envío; cada fila, su origen: la conversación con la RLS de quien
-- llama, o el público con la faceta.
ALTER POLICY mailout_recipient_select ON public.mailout_recipient
  USING (
    EXISTS (SELECT 1 FROM public.mailout m WHERE m.id = mailout_recipient.mailout_id)
    AND CASE WHEN mailout_recipient.conversation_id IS NOT NULL
             THEN EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = mailout_recipient.conversation_id)
             ELSE private.audience_access(mailout_recipient.workspace_id, false) END
  );

-- ── Piezas internas ───────────────────────────────────────────────────────

-- El envío por id, si quien llama lo ve (y lo edita, si se pide). Mismo
-- 42501 para «no existe» y «no es tuyo». Un envío de difusión, como siempre:
-- `read`/`edit:conversation` en su proyecto. Una invitación: la lee quien
-- puede leerla (invitation_readable_by_caller); la escribe quien la creó o
-- lleva el público, y si tiene lista, solo quien lleva el público. Lo de cada
-- conversación (editarla) se mira al elegirlas y al poner en cola.
CREATE OR REPLACE FUNCTION private.mailout_for_caller(p_id uuid, p_edit boolean)
RETURNS public.mailout
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.mailout;
  v_ok  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_row FROM public.mailout m WHERE m.id = p_id;
  IF v_row.kind = 'invitation' THEN
    v_ok := CASE
      WHEN p_edit THEN public.is_workspace_member(v_row.workspace_id)
                       AND (v_row.created_by = auth.uid() OR private.audience_access(v_row.workspace_id, true))
                       AND (v_row.audience_id IS NULL OR private.audience_access(v_row.workspace_id, true))
      ELSE private.invitation_readable_by_caller(v_row.id, v_row.workspace_id, v_row.created_by)
    END;
  ELSE
    v_ok := v_row.id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.project p WHERE p.id = v_row.project_id AND p.deleted_at IS NULL)
      AND public.has_permission(v_row.project_id,
            CASE WHEN p_edit THEN 'edit:conversation' ELSE 'read:conversation' END);
  END IF;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'mailout % not found', p_id USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

-- El registro en la conversación dice si el correo era de una invitación
-- (la pantalla lo lee «de la invitación "{asunto}"»). Cuerpo de
-- 20261016100000 con solo `mailout_kind` en metadata.
CREATE OR REPLACE FUNCTION private.mailout_record_conversation_event(
  p_recipient public.mailout_recipient,
  p_body      text,
  p_subject   text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout;
  v_provider public.mail_sending_provider;
  v_rfc      text := coalesce(p_recipient.rfc_message_id, p_recipient.provider_message_id, p_recipient.id::text);
  v_id       uuid;
  v_now      timestamptz := statement_timestamp();
BEGIN
  SELECT * INTO v_m FROM public.mailout WHERE id = p_recipient.mailout_id;
  SELECT d.provider INTO v_provider FROM public.mail_domain d WHERE d.id = v_m.mail_domain_id;
  INSERT INTO public.conversation_event (
    workspace_id, conversation_id, occurred_at, kind, source, direction,
    body, participants, provenance, external_ref, metadata, created_by
  ) VALUES (
    p_recipient.workspace_id, p_recipient.conversation_id, v_now, 'email', 'email', 'outbound',
    nullif(btrim(left(coalesce(p_body, ''), 20000)), ''),
    jsonb_build_array(jsonb_build_object('address', p_recipient.address::text)),
    jsonb_strip_nulls(jsonb_build_object(
      'connector', 'mailout', 'mailout_id', v_m.id, 'provider', v_provider)),
    'mail:' || v_rfc || '#' || p_recipient.conversation_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'mailout_id', v_m.id,
      'mailout_kind', v_m.kind,
      'mailout_recipient_id', p_recipient.id,
      'rfc_message_id', p_recipient.rfc_message_id,
      'provider_message_id', p_recipient.provider_message_id,
      'subject', coalesce(nullif(btrim(left(p_subject, 998)), ''), v_m.subject),
      'from', v_m.from_address::text,
      'to', jsonb_build_array(p_recipient.address::text)
    )),
    v_m.queued_by
  )
  ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.conversation_event
    WHERE workspace_id = p_recipient.workspace_id AND source = 'email'
      AND external_ref = 'mail:' || v_rfc || '#' || p_recipient.conversation_id::text;
    RETURN v_id;
  END IF;

  -- Como record_conversation_event; el estado de la conversación no cambia.
  UPDATE public.conversation
  SET last_contacted_at = greatest(coalesce(last_contacted_at, v_now), v_now),
      first_contacted_at = coalesce(first_contacted_at, v_now)
  WHERE id = p_recipient.conversation_id;
  RETURN v_id;
END;
$$;

-- La lista por id, si quien llama lleva el público (y lo edita, si se pide).
CREATE FUNCTION private.audience_for_caller(p_id uuid, p_edit boolean)
RETURNS public.audience
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.audience;
BEGIN
  SELECT * INTO v_row FROM public.audience WHERE id = p_id;
  IF auth.uid() IS NULL OR v_row.id IS NULL OR NOT private.audience_access(v_row.workspace_id, p_edit) THEN
    RAISE EXCEPTION 'list % not found', p_id USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

-- El texto vigente de una lista en un idioma (o en el suyo por defecto).
CREATE FUNCTION private.audience_current_text(p_audience public.audience, p_language text)
RETURNS public.audience_consent_text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT t.* FROM public.audience_consent_text t
  WHERE t.audience_id = p_audience.id AND t.version = p_audience.current_text_version
    AND t.language IN (p_language, p_audience.default_language)
  ORDER BY (t.language = p_language) DESC
  LIMIT 1;
$$;

-- Una petición de alta (formulario o a mano). Crea la suscripción `pending`
-- o la reabre, apunta el evento `requested` y devuelve su id. Devuelve NULL y
-- no toca nada si ya está confirmada o si pasa de los límites (plan § 3.3: un
-- correo de confirmación por dirección y lista cada 24 horas, tres en total).
-- Una baja que vuelve a pedir sigue `unsubscribed` hasta que confirma.
CREATE FUNCTION private.audience_request(
  p_audience      public.audience,
  p_address       extensions.citext,
  p_name          text,
  p_language      text,
  p_text_id       uuid,
  p_age_confirmed boolean,
  p_source        public.audience_source,
  p_channel       public.audience_consent_channel,
  p_ip            inet,
  p_user_agent    text,
  p_page_url      text,
  p_actor         uuid
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_s public.audience_subscription;
BEGIN
  INSERT INTO public.audience_subscription (workspace_id, audience_id, address, name, language, status, source, consent_text_id)
  VALUES (p_audience.workspace_id, p_audience.id, p_address, left(nullif(btrim(coalesce(p_name, '')), ''), 200),
          p_language, 'pending', p_source, p_text_id)
  ON CONFLICT (audience_id, address) DO NOTHING;
  SELECT * INTO v_s FROM public.audience_subscription
  WHERE audience_id = p_audience.id AND address = p_address FOR UPDATE;

  IF v_s.status = 'confirmed'
     OR v_s.confirm_sent_count >= 3
     OR v_s.confirm_last_sent_at > now() - interval '24 hours' THEN
    RETURN NULL;
  END IF;

  UPDATE public.audience_subscription
  SET name = coalesce(left(nullif(btrim(coalesce(p_name, '')), ''), 200), name),
      language = p_language,
      consent_text_id = p_text_id,
      basis_kind = 'consent'
  WHERE id = v_s.id;

  INSERT INTO public.audience_consent_event (
    workspace_id, subscription_id, kind, consent_text_id, channel, ip, user_agent, page_url,
    age_confirmed, actor_user_id
  ) VALUES (
    v_s.workspace_id, v_s.id, 'requested', p_text_id, p_channel, p_ip, left(p_user_agent, 500),
    left(p_page_url, 2048), p_age_confirmed, p_actor
  );
  RETURN v_s.id;
END;
$$;

-- Un token de confirmación nuevo (solo su hash queda en la base), si los
-- límites lo dejan; si no, NULL.
CREATE FUNCTION private.audience_issue_token(p_subscription_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_s     public.audience_subscription;
  v_token text;
BEGIN
  SELECT * INTO v_s FROM public.audience_subscription WHERE id = p_subscription_id FOR UPDATE;
  IF v_s.id IS NULL OR v_s.status = 'confirmed'
     OR v_s.confirm_sent_count >= 3
     OR v_s.confirm_last_sent_at > now() - interval '24 hours' THEN
    RETURN NULL;
  END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.audience_subscription
  SET confirm_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
      confirm_expires_at = now() + interval '7 days',
      confirm_sent_count = confirm_sent_count + 1,
      confirm_last_sent_at = now(),
      confirm_provider_message_id = NULL
  WHERE id = v_s.id;
  RETURN v_token;
END;
$$;

-- Lo que justifica escribir a una suscripción ahora: su último evento de
-- confirmación, importación o vuelta.
CREATE FUNCTION private.audience_basis_event(p_subscription_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT e.id FROM public.audience_consent_event e
  WHERE e.subscription_id = p_subscription_id AND e.kind IN ('confirmed', 'imported', 'resubscribed')
  ORDER BY e.occurred_at DESC, e.id DESC
  LIMIT 1;
$$;

-- ── RPC de persona: dominios ──────────────────────────────────────────────

-- Alta de un dominio con su propósito (ADR-173 § 5): el del público lleva su
-- tenant (`hour-aud-<espacio>`) y `hola` como remitente por defecto. DROP y
-- CREATE: un parámetro nuevo con valor por defecto, una sola firma.
DROP FUNCTION public.add_mail_domain(uuid, text, public.mail_sending_provider, text, text);

CREATE FUNCTION public.add_mail_domain(
  p_workspace_id    uuid,
  p_domain          text,
  p_provider        public.mail_sending_provider DEFAULT 'simulator',
  p_from_local_part text DEFAULT NULL,
  p_from_name       text DEFAULT NULL,
  p_purpose         public.mail_domain_purpose DEFAULT 'outreach'
) RETURNS public.mail_domain
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_domain  extensions.citext := lower(btrim(coalesce(p_domain, '')));
  v_purpose public.mail_domain_purpose := coalesce(p_purpose, 'outreach');
  v_tenant  text := CASE v_purpose WHEN 'audience' THEN 'hour-aud-' ELSE 'hour-' END || p_workspace_id::text;
  v_row     public.mail_domain;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  IF v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' OR length(v_domain) > 253 THEN
    RAISE EXCEPTION 'domain is not valid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mail_domain d
             WHERE d.domain = v_domain
               AND (d.workspace_id = p_workspace_id OR (d.provider = 'ses' AND coalesce(p_provider, 'simulator') = 'ses'))) THEN
    RAISE EXCEPTION 'domain is not available' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.mail_domain (
    workspace_id, provider, domain, tenant_name, configuration_set, from_local_part, from_name, created_by, purpose
  )
  VALUES (p_workspace_id, coalesce(p_provider, 'simulator'), v_domain, v_tenant, v_tenant,
          lower(coalesce(nullif(btrim(p_from_local_part), ''),
                         CASE v_purpose WHEN 'audience' THEN 'hola' ELSE 'difusion' END)),
          nullif(btrim(coalesce(p_from_name, '')), ''), auth.uid(), v_purpose)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- El remitente por defecto de un dominio (admin). Sin parte local, la de su
-- propósito. Los envíos ya creados guardan el suyo.
CREATE OR REPLACE FUNCTION public.set_mail_domain_sender(
  p_id              uuid,
  p_from_local_part text,
  p_from_name       text DEFAULT NULL
) RETURNS public.mail_domain
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws  uuid;
  v_row public.mail_domain;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.mail_domain WHERE id = p_id;
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'mail domain % not found', p_id USING ERRCODE = '42501';
  END IF;
  UPDATE public.mail_domain
  SET from_local_part = lower(coalesce(nullif(btrim(p_from_local_part), ''),
                                       CASE purpose WHEN 'audience' THEN 'hola' ELSE 'difusion' END)),
      from_name = nullif(btrim(coalesce(p_from_name, '')), '')
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Baja de un dominio. No si un envío en marcha sale de él, por cualquiera de
-- sus dos identidades.
CREATE OR REPLACE FUNCTION public.remove_mail_domain(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.mail_domain WHERE id = p_id FOR UPDATE;
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'mail domain % not found', p_id USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mailout m
             WHERE (m.mail_domain_id = p_id OR m.audience_mail_domain_id = p_id)
               AND m.status IN ('review', 'queued', 'sending', 'paused')) THEN
    RAISE EXCEPTION 'a mailout in progress uses this domain' USING ERRCODE = '23503';
  END IF;
  -- Lo que se quedó a medias en un envío ya cancelado o acabado (un arriendo
  -- devuelto a la cola después de cancelar) no sale nunca: queda cancelado,
  -- y el dominio se puede borrar sin romper el CHECK de las filas en vuelo.
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'cancelled', claimed_at = NULL
  WHERE r.mail_domain_id = p_id AND r.status IN ('queued', 'sending');
  DELETE FROM public.mail_domain WHERE id = p_id;
END;
$$;

-- ── RPC de persona: envíos e invitaciones ─────────────────────────────────

-- Lo que se escribe del envío, solo en borrador. El dominio, de difusión (en
-- una invitación es el de los profesionales). Cuerpo vivo con solo eso.
CREATE OR REPLACE FUNCTION public.update_mailout(
  p_id                       uuid,
  p_subject                  text,
  p_body                     text,
  p_language                 text DEFAULT 'es',
  p_from_local_part          text DEFAULT 'difusion',
  p_from_name                text DEFAULT NULL,
  p_mail_domain_id           uuid DEFAULT NULL,
  p_reply_to_mail_account_id uuid DEFAULT NULL
) RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, true);
  v_row public.mailout;
BEGIN
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF p_mail_domain_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_domain d
    WHERE d.id = p_mail_domain_id AND d.workspace_id = v_m.workspace_id AND d.purpose = 'outreach'
  ) THEN
    RAISE EXCEPTION 'mail domain % not found', p_mail_domain_id USING ERRCODE = '22023';
  END IF;
  IF p_reply_to_mail_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_account a
    WHERE a.id = p_reply_to_mail_account_id AND a.workspace_id = v_m.workspace_id
      AND (a.scope = 'workspace' OR a.owner_user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'mail account % not usable', p_reply_to_mail_account_id USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout
  SET subject = nullif(btrim(coalesce(p_subject, '')), ''),
      body = nullif(btrim(coalesce(p_body, '')), ''),
      language = coalesce(nullif(btrim(p_language), ''), 'es'),
      from_local_part = lower(coalesce(nullif(btrim(p_from_local_part), ''), 'difusion')),
      from_name = nullif(btrim(coalesce(p_from_name, '')), ''),
      mail_domain_id = p_mail_domain_id,
      reply_to_mail_account_id = p_reply_to_mail_account_id
  WHERE id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Los profesionales de un borrador: sustituye la lista entera. En un envío de
-- difusión, conversaciones de su proyecto, como siempre. En una invitación,
-- de cualquier proyecto del espacio que quien llama edite (ADR-173 § 10). Viva
-- y visible para quien llama (la privada, solo si es suya); si una no lo es,
-- nada cambia (42501). La dirección no la manda el cliente.
CREATE OR REPLACE FUNCTION public.set_mailout_recipients(p_id uuid, p_conversation_ids uuid[])
RETURNS SETOF public.mailout_recipient
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m     public.mailout := private.mailout_for_caller(p_id, true);
  v_ids   uuid[];
  v_found integer;
BEGIN
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can change its recipients' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids FROM unnest(p_conversation_ids) x WHERE x IS NOT NULL;
  IF cardinality(v_ids) > 2000 THEN
    RAISE EXCEPTION 'at most 2000 recipients per mailout' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_found FROM public.conversation c
  WHERE c.id = ANY (v_ids) AND c.deleted_at IS NULL
    AND (c.private_to IS NULL OR c.private_to = auth.uid())
    AND CASE WHEN v_m.kind = 'invitation'
             THEN c.workspace_id = v_m.workspace_id AND public.has_permission(c.project_id, 'edit:conversation')
             ELSE c.project_id = v_m.project_id END;
  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'a conversation is not available for this mailout' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.mailout_recipient WHERE mailout_id = v_m.id AND conversation_id IS NOT NULL;

  INSERT INTO public.mailout_recipient (
    mailout_id, workspace_id, conversation_id, person_id, address, display_name, address_kind,
    status, skip_reason
  )
  -- Un duplicado se queda sin dirección: sale una vez, por la primera.
  SELECT v_m.id, v_m.workspace_id, r.conversation_id, r.person_id,
         CASE WHEN r.dup = 1 THEN r.address END, r.display_name, CASE WHEN r.dup = 1 THEN r.kind END,
         CASE WHEN r.address IS NULL OR r.dup > 1 THEN 'skipped' ELSE 'pending' END::public.mailout_recipient_status,
         CASE WHEN r.address IS NULL THEN 'no_address'
              WHEN r.dup > 1 THEN 'duplicate' END::public.mailout_skip_reason
  FROM (
    SELECT a.*,
           -- La misma dirección en dos conversaciones: sale una vez.
           CASE WHEN a.address IS NULL THEN 1
                ELSE row_number() OVER (PARTITION BY a.address ORDER BY a.conversation_id) END AS dup
    FROM (
      SELECT c.id AS conversation_id,
             CASE WHEN wp.email IS NOT NULL THEN wp.person_id END AS person_id,
             coalesce(wp.email, o.email) AS address,
             left(CASE WHEN wp.email IS NOT NULL THEN wp.full_name ELSE o.name END, 200) AS display_name,
             CASE WHEN wp.email IS NOT NULL THEN 'contact'
                  WHEN o.email IS NOT NULL THEN 'organization' END::public.mailout_address_kind AS kind
      FROM public.conversation c
      LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
      LEFT JOIN public.workspace_person wp
        ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id AND wp.deleted_at IS NULL
      LEFT JOIN public.workspace_organization o
        ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
      WHERE c.id = ANY (v_ids)
    ) a
  ) r;

  RETURN QUERY SELECT * FROM public.mailout_recipient WHERE mailout_id = v_m.id ORDER BY created_at, id;
END;
$$;

-- Una invitación en borrador (§ 4.4). Lista y profesionales, cada uno
-- opcional; desde una función puede nacer sin ninguno (se elige después; la
-- puesta en cola exige al menos uno). Toma el primer dominio de cada propósito
-- que haga falta, el verificado antes. La función y el proyecto, si los hay,
-- los ve quien llama (`read:performance` en el proyecto de la función; en un
-- proyecto sin función, leer sus funciones o sus conversaciones).
CREATE FUNCTION public.create_invitation(
  p_workspace_id     uuid,
  p_audience_id      uuid DEFAULT NULL,
  p_conversation_ids uuid[] DEFAULT NULL,
  p_project_id       uuid DEFAULT NULL,
  p_performance_id   uuid DEFAULT NULL
) RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_ids     uuid[];
  v_pros    boolean;
  v_perf    uuid;
  v_outdom  public.mail_domain;
  v_auddom  public.mail_domain;
  v_project uuid := p_project_id;
  v_row     public.mailout;
BEGIN
  IF v_uid IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids FROM unnest(p_conversation_ids) x WHERE x IS NOT NULL;
  v_pros := cardinality(v_ids) > 0;
  IF p_audience_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.audience a WHERE a.id = p_audience_id AND a.workspace_id = p_workspace_id)
       OR NOT private.audience_access(p_workspace_id, true) THEN
      RAISE EXCEPTION 'list % not found', p_audience_id USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_auddom FROM public.mail_domain d
    WHERE d.workspace_id = p_workspace_id AND d.purpose = 'audience'
    ORDER BY (d.verified_at IS NOT NULL) DESC, d.created_at
    LIMIT 1;
    IF v_auddom.id IS NULL THEN
      RAISE EXCEPTION 'this workspace has no audience sending domain' USING ERRCODE = '22023';
    END IF;
  ELSIF NOT v_pros AND NOT private.audience_access(p_workspace_id, true)
        AND (v_project IS NULL OR NOT public.has_permission(v_project, 'edit:conversation')) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  IF p_performance_id IS NOT NULL THEN
    SELECT p.project_id INTO v_perf FROM public.performance p
    WHERE p.id = p_performance_id AND p.workspace_id = p_workspace_id AND p.deleted_at IS NULL;
    IF v_perf IS NULL OR NOT public.has_permission(v_perf, 'read:performance') THEN
      RAISE EXCEPTION 'performance % not found', p_performance_id USING ERRCODE = '42501';
    END IF;
    IF v_project IS NOT NULL AND v_project <> v_perf THEN
      RAISE EXCEPTION 'the performance is not in this project' USING ERRCODE = '22023';
    END IF;
    v_project := v_perf;
  END IF;
  IF v_project IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM public.project p
                WHERE p.id = v_project AND p.workspace_id = p_workspace_id AND p.deleted_at IS NULL)
    OR NOT (public.has_permission(v_project, 'read:performance')
            OR public.has_permission(v_project, 'read:conversation'))
  ) THEN
    RAISE EXCEPTION 'project % not found', v_project USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_outdom FROM public.mail_domain d
  WHERE d.workspace_id = p_workspace_id AND d.purpose = 'outreach'
  ORDER BY (d.verified_at IS NOT NULL) DESC, d.created_at
  LIMIT 1;

  INSERT INTO public.mailout (
    workspace_id, kind, project_id, performance_id, audience_id, audience_mail_domain_id,
    mail_domain_id, from_local_part, from_name, created_by
  )
  SELECT p_workspace_id, 'invitation', v_project, p_performance_id, p_audience_id, v_auddom.id,
         v_outdom.id, coalesce(v_outdom.from_local_part, 'difusion'),
         coalesce(v_outdom.from_name, v_auddom.from_name, left(w.name, 100)), v_uid
  FROM public.workspace w WHERE w.id = p_workspace_id
  RETURNING * INTO v_row;

  IF v_pros THEN
    PERFORM public.set_mailout_recipients(v_row.id, v_ids);
  END IF;
  RETURN v_row;
END;
$$;

-- Pone o quita (NULL) la lista de una invitación en borrador, con el dominio
-- del público.
CREATE FUNCTION public.set_invitation_audience(p_mailout_id uuid, p_audience_id uuid)
RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m      public.mailout := private.mailout_for_caller(p_mailout_id, true);
  v_auddom public.mail_domain;
  v_row    public.mailout;
BEGIN
  IF v_m.kind <> 'invitation' THEN
    RAISE EXCEPTION 'only an invitation has a list' USING ERRCODE = '22023';
  END IF;
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be edited' USING ERRCODE = '22023';
  END IF;
  IF NOT private.audience_access(v_m.workspace_id, true) THEN
    RAISE EXCEPTION 'mailout % not found', p_mailout_id USING ERRCODE = '42501';
  END IF;
  IF p_audience_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.audience a WHERE a.id = p_audience_id AND a.workspace_id = v_m.workspace_id) THEN
      RAISE EXCEPTION 'list % not found', p_audience_id USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_auddom FROM public.mail_domain d
    WHERE d.workspace_id = v_m.workspace_id AND d.purpose = 'audience'
    ORDER BY (d.id = v_m.audience_mail_domain_id) DESC, (d.verified_at IS NOT NULL) DESC, d.created_at
    LIMIT 1;
    IF v_auddom.id IS NULL THEN
      RAISE EXCEPTION 'this workspace has no audience sending domain' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.mailout
  SET audience_id = p_audience_id, audience_mail_domain_id = v_auddom.id
  WHERE id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Vista previa: por destinatario visible, su origen, su identidad, su base,
-- si está excluido y si está listo. Una fila de conversación, con la RLS de
-- la conversación; una del público, con la faceta. DROP y CREATE: gana dos
-- columnas al final.
DROP FUNCTION public.mailout_preview(uuid);

CREATE FUNCTION public.mailout_preview(p_id uuid)
RETURNS TABLE (
  recipient_id             uuid,
  conversation_id          uuid,
  address                  text,
  display_name             text,
  address_kind             public.mailout_address_kind,
  status                   public.mailout_recipient_status,
  skip_reason              public.mailout_skip_reason,
  basis_kind               public.mail_basis_kind,
  basis_withdrawn_at       timestamptz,
  suppressed_reason        public.mail_suppression_reason,
  suppressed_at            timestamptz,
  ready                    boolean,
  audience_subscription_id uuid,
  mail_domain_id           uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout := private.mailout_for_caller(p_id, false);
  v_audience boolean := private.audience_access(v_m.workspace_id, false);
BEGIN
  RETURN QUERY
  SELECT r.id, r.conversation_id, r.address::text, r.display_name, r.address_kind, r.status,
         coalesce(r.skip_reason, CASE WHEN nn.held THEN 'not_now' END::public.mailout_skip_reason),
         coalesce(r.basis_kind, b.kind), b.withdrawn_at, s.reason, s.created_at,
         (r.status = 'pending' AND NOT nn.held AND s.address IS NULL
          AND (r.audience_subscription_id IS NOT NULL OR (b.kind IS NOT NULL AND b.withdrawn_at IS NULL))),
         r.audience_subscription_id, r.mail_domain_id
  FROM public.mailout_recipient r
  LEFT JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  LEFT JOIN public.mail_basis b
    ON b.workspace_id = r.workspace_id AND b.address = r.address AND r.conversation_id IS NOT NULL
  LEFT JOIN public.mail_suppression s ON s.workspace_id = r.workspace_id AND s.address = r.address
  CROSS JOIN LATERAL (
    SELECT r.status = 'pending' AND r.conversation_id IS NOT NULL
           AND private.conversation_not_now(r.conversation_id) AS held
  ) nn
  WHERE r.mailout_id = v_m.id
    AND CASE WHEN r.conversation_id IS NOT NULL THEN c.id IS NOT NULL ELSE v_audience END
  ORDER BY r.created_at, r.id;
END;
$$;

-- Poner en cola. Un envío de difusión, como siempre (ahora además congela la
-- identidad por fila). Una invitación congela sus dos orígenes (§ 4.4): las
-- conversaciones con su base de `mail_basis` y las suscripciones `confirmed`
-- de la lista (sin importaciones en revisión). Una dirección en los dos sale
-- como profesional si el profesional sale; si no, como público (ADR-173 § 10). Pide el dominio verificado de cada origen
-- que usa, el modo simulador, y la revisión del primer envío real de cada
-- identidad. Cuerpo vivo (20261020140100) con las ramas.
CREATE OR REPLACE FUNCTION public.queue_mailout(p_id uuid)
RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout := private.mailout_for_caller(p_id, true);
  v_ws       public.workspace;
  v_domain   public.mail_domain;
  v_auddom   public.mail_domain;
  v_list     public.audience;
  v_reply    public.mail_account;
  v_from     extensions.citext;
  v_ready    integer;
  v_pros     boolean;
  v_subs     boolean;
  v_row      public.mailout;
BEGIN
  SELECT * INTO v_m FROM public.mailout WHERE id = v_m.id FOR UPDATE;
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be queued' USING ERRCODE = '22023';
  END IF;
  IF v_m.subject IS NULL OR v_m.body IS NULL THEN
    RAISE EXCEPTION 'subject and body are required' USING ERRCODE = '22023';
  END IF;
  v_pros := EXISTS (SELECT 1 FROM public.mailout_recipient r
                    WHERE r.mailout_id = v_m.id AND r.conversation_id IS NOT NULL);
  IF v_m.kind = 'invitation' AND v_m.audience_id IS NULL AND NOT v_pros THEN
    RAISE EXCEPTION 'an invitation needs a list or professionals' USING ERRCODE = '22023';
  END IF;
  IF v_m.kind = 'outreach' OR v_pros THEN
    SELECT * INTO v_domain FROM public.mail_domain
    WHERE id = v_m.mail_domain_id AND workspace_id = v_m.workspace_id AND purpose = 'outreach';
    IF v_domain.id IS NULL OR v_domain.verified_at IS NULL THEN
      RAISE EXCEPTION 'the sending domain is not verified' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_m.audience_id IS NOT NULL THEN
    SELECT * INTO v_list FROM public.audience WHERE id = v_m.audience_id;
    IF v_list.status = 'archived' THEN
      RAISE EXCEPTION 'this list is archived' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_auddom FROM public.mail_domain
    WHERE id = v_m.audience_mail_domain_id AND workspace_id = v_m.workspace_id AND purpose = 'audience';
    IF v_auddom.id IS NULL OR v_auddom.verified_at IS NULL THEN
      RAISE EXCEPTION 'the audience sending domain is not verified' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_m.workspace_id;

  -- Quien pone en cola tiene que ver cada conversación que recibe (y, en una
  -- invitación, editarla): la que se borró después, la privada de otra persona
  -- o la de un proyecto que no edita queda fuera (`unavailable`).
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'unavailable'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending' AND r.conversation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation c
      WHERE c.id = r.conversation_id AND c.deleted_at IS NULL
        AND (c.private_to IS NULL OR c.private_to = auth.uid())
        AND (v_m.kind = 'outreach' OR public.has_permission(c.project_id, 'edit:conversation'))
    );

  -- «No esta vez» vigente (ADR-138 § 3): mientras dura, no recibe envíos.
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'not_now'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending' AND r.conversation_id IS NOT NULL
    AND private.conversation_not_now(r.conversation_id);

  -- Los profesionales, como el envío: modo simulador, exclusión y base.
  IF v_ws.mailout_simulator_only AND EXISTS (
    SELECT 1 FROM public.mailout_recipient r
    WHERE r.mailout_id = v_m.id AND r.status = 'pending'
      AND r.address::text !~* '@simulator\.amazonses\.com$'
  ) THEN
    RAISE EXCEPTION 'this workspace only sends to the mail simulator' USING ERRCODE = '42501';
  END IF;

  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'suppressed'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND EXISTS (SELECT 1 FROM public.mail_suppression s
                WHERE s.workspace_id = r.workspace_id AND s.address = r.address);

  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'no_basis'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending' AND r.conversation_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address
                      AND b.withdrawn_at IS NULL);

  -- El público: las confirmadas de la lista ahora, sin importaciones en
  -- revisión. Una dirección que sale como profesional no lleva fila del
  -- público; si el profesional quedó fuera (sin base, «no esta vez», no
  -- disponible, duplicado), la suscripción sale por la suya: el
  -- consentimiento de la lista es independiente (plan § 2.3). La exclusión del
  -- espacio corta las dos.
  IF v_m.audience_id IS NOT NULL THEN
    INSERT INTO public.mailout_recipient (
      mailout_id, workspace_id, audience_subscription_id, address, display_name, address_kind,
      status, basis_kind, consent_event_id, mail_domain_id
    )
    SELECT v_m.id, v_m.workspace_id, s.id, s.address, s.name, 'subscriber',
           'pending', s.basis_kind, private.audience_basis_event(s.id), v_auddom.id
    FROM public.audience_subscription s
    LEFT JOIN public.audience_import i ON i.id = s.import_id
    WHERE s.audience_id = v_m.audience_id AND s.status = 'confirmed'
      AND (s.import_id IS NULL OR i.status = 'done')
      AND NOT EXISTS (SELECT 1 FROM public.mailout_recipient x
                      WHERE x.mailout_id = v_m.id AND x.address = s.address AND x.status <> 'skipped');

    IF v_ws.mailout_simulator_only AND EXISTS (
      SELECT 1 FROM public.mailout_recipient r
      WHERE r.mailout_id = v_m.id AND r.status = 'pending'
        AND r.address::text !~* '@simulator\.amazonses\.com$'
    ) THEN
      RAISE EXCEPTION 'this workspace only sends to the mail simulator' USING ERRCODE = '42501';
    END IF;

    UPDATE public.mailout_recipient r
    SET status = 'skipped', skip_reason = 'suppressed'
    WHERE r.mailout_id = v_m.id AND r.status = 'pending' AND r.audience_subscription_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.mail_suppression s
                  WHERE s.workspace_id = r.workspace_id AND s.address = r.address);
  END IF;

  UPDATE public.mailout_recipient r
  SET status = 'queued', next_attempt_at = now(),
      basis_kind = CASE WHEN r.conversation_id IS NOT NULL
                        THEN (SELECT b.kind FROM public.mail_basis b
                              WHERE b.workspace_id = r.workspace_id AND b.address = r.address)
                        ELSE r.basis_kind END,
      mail_domain_id = CASE WHEN r.conversation_id IS NOT NULL THEN v_domain.id ELSE r.mail_domain_id END
  WHERE r.mailout_id = v_m.id AND r.status = 'pending';
  GET DIAGNOSTICS v_ready = ROW_COUNT;
  IF v_ready = 0 THEN
    RAISE EXCEPTION 'no recipient can receive this mailout' USING ERRCODE = '22023';
  END IF;
  v_pros := EXISTS (SELECT 1 FROM public.mailout_recipient r
                    WHERE r.mailout_id = v_m.id AND r.status = 'queued' AND r.conversation_id IS NOT NULL);
  v_subs := EXISTS (SELECT 1 FROM public.mailout_recipient r
                    WHERE r.mailout_id = v_m.id AND r.status = 'queued' AND r.audience_subscription_id IS NOT NULL);

  -- Respuestas: el buzón elegido si sigue activo; si no, el común del
  -- espacio; si no, el personal de quien envía; si no, el remitente.
  SELECT * INTO v_reply FROM public.mail_account a
  WHERE a.workspace_id = v_m.workspace_id AND a.status = 'active'
    AND (a.scope = 'workspace' OR a.owner_user_id = auth.uid())
  ORDER BY (a.id = v_m.reply_to_mail_account_id) DESC NULLS LAST, (a.scope = 'workspace') DESC, a.created_at
  LIMIT 1;
  -- El remitente del envío: el de la difusión si salen profesionales; si
  -- solo sale el público, el del dominio del público. Cada fila sale por el
  -- suyo (mailout_claim).
  v_from := CASE WHEN v_pros
                 THEN v_m.from_local_part || '@' || v_domain.domain::text
                 ELSE v_auddom.from_local_part || '@' || v_auddom.domain::text
            END::extensions.citext;

  UPDATE public.mailout
  SET status = CASE
        WHEN NOT v_ws.mailout_simulator_only
             AND ((v_pros AND v_domain.provider = 'ses' AND v_ws.mailout_reviewed_at IS NULL)
               OR (v_subs AND v_auddom.provider = 'ses' AND v_ws.invitation_reviewed_at IS NULL))
        THEN 'review' ELSE 'queued' END::public.mailout_status,
      from_address = v_from,
      reply_to_mail_account_id = v_reply.id,
      reply_to_address = coalesce(v_reply.address, v_from),
      queued_by = auth.uid(),
      queued_at = now()
  WHERE id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ── Montaje del correo (vista previa y cola) ──────────────────────────────
-- Gana, al final: el tipo del envío, el origen y el nombre de la lista, el
-- nombre de la persona apuntada y cuándo se apuntó (para el pie), y la sala y
-- la ciudad de la función de una invitación (`{sala}`, `{ciudad}`, § 4.7).
DROP FUNCTION public.mailout_compose_preview(uuid);
DROP FUNCTION public.mailout_send_context(uuid[]);
DROP FUNCTION private.mailout_compose_rows(uuid[]);

CREATE FUNCTION private.mailout_compose_rows(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  contact_first_name       text,
  contact_name             text,
  organization_name        text,
  city                     text,
  company_name             text,
  company_city             text,
  company_website          text,
  company_phone            text,
  company_signature        text,
  privacy_url              text,
  mailout_kind             public.mailout_kind,
  audience_subscription_id uuid,
  audience_name            text,
  subscriber_name          text,
  subscribed_at            timestamptz,
  venue_name               text,
  venue_city               text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT r.id, r.mailout_id, r.address_kind,
         -- La base congelada al poner en cola; antes, la vigente.
         coalesce(r.basis_kind, b.kind),
         CASE WHEN r.address_kind = 'contact'
              THEN coalesce(nullif(btrim(wp.first_name), ''), nullif(split_part(btrim(wp.full_name), ' ', 1), '')) END,
         CASE WHEN r.address_kind = 'contact' THEN nullif(btrim(wp.full_name), '') END,
         nullif(btrim(o.name), ''),
         coalesce(nullif(btrim(o.city), ''), CASE WHEN r.address_kind = 'contact' THEN nullif(btrim(wp.city), '') END),
         w.name,
         nullif(btrim(w.city), ''),
         nullif(btrim(w.website), ''),
         nullif(btrim(w.phone), ''),
         nullif(btrim(w.mail_signature), ''),
         w.privacy_url,
         m.kind,
         r.audience_subscription_id,
         a.name,
         nullif(btrim(s.name), ''),
         s.confirmed_at,
         coalesce(nullif(btrim(pf.venue_name), ''), nullif(btrim(v.name), '')),
         coalesce(nullif(btrim(pf.city), ''), nullif(btrim(v.city), ''))
  FROM public.mailout_recipient r
  JOIN public.mailout m ON m.id = r.mailout_id
  JOIN public.workspace w ON w.id = r.workspace_id
  LEFT JOIN public.conversation c ON c.id = r.conversation_id
  LEFT JOIN public.workspace_person wp
    ON wp.workspace_id = r.workspace_id AND wp.person_id = r.person_id AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization o
    ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
  LEFT JOIN public.mail_basis b
    ON b.workspace_id = r.workspace_id AND b.address = r.address AND b.withdrawn_at IS NULL
   AND r.conversation_id IS NOT NULL
  LEFT JOIN public.audience_subscription s ON s.id = r.audience_subscription_id
  LEFT JOIN public.audience a ON a.id = s.audience_id
  LEFT JOIN public.performance pf ON pf.id = m.performance_id AND pf.deleted_at IS NULL
  LEFT JOIN public.venue v ON v.id = pf.venue_id AND v.deleted_at IS NULL
  WHERE r.id = ANY (p_recipient_ids)
  ORDER BY r.created_at, r.id;
$$;

-- La cola, sin persona detrás: los destinatarios que acaba de tomar.
CREATE FUNCTION public.mailout_send_context(p_recipient_ids uuid[])
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  contact_first_name       text,
  contact_name             text,
  organization_name        text,
  city                     text,
  company_name             text,
  company_city             text,
  company_website          text,
  company_phone            text,
  company_signature        text,
  privacy_url              text,
  mailout_kind             public.mailout_kind,
  audience_subscription_id uuid,
  audience_name            text,
  subscriber_name          text,
  subscribed_at            timestamptz,
  venue_name               text,
  venue_city               text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM private.mailout_compose_rows(coalesce(p_recipient_ids, '{}'));
$$;

-- La vista previa: los destinatarios que quien llama ve (las conversaciones
-- privadas de otra persona no salen; el público, con la faceta), con lo mismo
-- que usará la cola.
CREATE FUNCTION public.mailout_compose_preview(p_id uuid)
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  contact_first_name       text,
  contact_name             text,
  organization_name        text,
  city                     text,
  company_name             text,
  company_city             text,
  company_website          text,
  company_phone            text,
  company_signature        text,
  privacy_url              text,
  mailout_kind             public.mailout_kind,
  audience_subscription_id uuid,
  audience_name            text,
  subscriber_name          text,
  subscribed_at            timestamptz,
  venue_name               text,
  venue_city               text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout := private.mailout_for_caller(p_id, false);
  v_audience boolean := private.audience_access(v_m.workspace_id, false);
  v_ids      uuid[];
BEGIN
  SELECT coalesce(array_agg(r.id), '{}') INTO v_ids
  FROM public.mailout_recipient r
  LEFT JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  WHERE r.mailout_id = v_m.id
    AND CASE WHEN r.conversation_id IS NOT NULL THEN c.id IS NOT NULL ELSE v_audience END;
  RETURN QUERY SELECT * FROM private.mailout_compose_rows(v_ids);
END;
$$;

-- ── RPC de persona: el público ────────────────────────────────────────────

CREATE FUNCTION public.create_audience(
  p_workspace_id     uuid,
  p_name             text,
  p_languages        text[] DEFAULT ARRAY['es']::text[],
  p_default_language text DEFAULT NULL
) RETURNS public.audience
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_langs text[];
  v_row   public.audience;
BEGIN
  IF auth.uid() IS NULL OR NOT private.audience_access(p_workspace_id, true) THEN
    RAISE EXCEPTION 'workspace % not found', p_workspace_id USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(l))), '{}') INTO v_langs
  FROM unnest(p_languages) l WHERE nullif(btrim(l), '') IS NOT NULL;
  IF cardinality(v_langs) = 0 OR NOT v_langs <@ ARRAY['es', 'ca', 'en', 'fr']::text[] THEN
    RAISE EXCEPTION 'languages must be among es, ca, en, fr' USING ERRCODE = '22023';
  END IF;
  IF p_default_language IS NOT NULL AND NOT (p_default_language = ANY (v_langs)) THEN
    RAISE EXCEPTION 'the default language must be one of the list' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'name must be 1 to 100 characters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audience (workspace_id, name, languages, default_language, created_by)
  VALUES (p_workspace_id, btrim(p_name), v_langs,
          coalesce(p_default_language, CASE WHEN 'es' = ANY (v_langs) THEN 'es' ELSE v_langs[1] END), auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.update_audience(
  p_id               uuid,
  p_name             text,
  p_description      text,
  p_languages        text[],
  p_default_language text
) RETURNS public.audience
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_a     public.audience := private.audience_for_caller(p_id, true);
  v_langs text[];
  v_row   public.audience;
BEGIN
  SELECT coalesce(array_agg(DISTINCT lower(btrim(l))), '{}') INTO v_langs
  FROM unnest(p_languages) l WHERE nullif(btrim(l), '') IS NOT NULL;
  IF cardinality(v_langs) = 0 OR NOT v_langs <@ ARRAY['es', 'ca', 'en', 'fr']::text[] THEN
    RAISE EXCEPTION 'languages must be among es, ca, en, fr' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_default_language = ANY (v_langs)) THEN
    RAISE EXCEPTION 'the default language must be one of the list' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 100
     OR length(coalesce(p_description, '')) > 500 THEN
    RAISE EXCEPTION 'name must be 1 to 100 characters and description up to 500' USING ERRCODE = '22023';
  END IF;
  -- Abierta, un idioma nuevo pide antes su texto (la guarda de la tabla).
  UPDATE public.audience
  SET name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      languages = v_langs,
      default_language = p_default_language
  WHERE id = v_a.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Una versión nueva del texto de consentimiento, un texto por idioma de la
-- lista ({"es": {"consent_text": …, "info_text": …}, …}); queda vigente. Las
-- versiones viejas no se tocan.
CREATE FUNCTION public.set_audience_consent_text(p_audience_id uuid, p_texts jsonb)
RETURNS public.audience
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_a       public.audience := private.audience_for_caller(p_audience_id, true);
  v_version integer;
  v_privacy text;
  v_row     public.audience;
BEGIN
  IF jsonb_typeof(p_texts) IS DISTINCT FROM 'object'
     OR NOT (SELECT array_agg(k) FROM jsonb_object_keys(p_texts) k) <@ v_a.languages
     OR NOT v_a.languages <@ (SELECT array_agg(k) FROM jsonb_object_keys(p_texts) k) THEN
    RAISE EXCEPTION 'one text per language of the list' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_texts) e
    WHERE length(btrim(coalesce(e.value ->> 'consent_text', ''))) NOT BETWEEN 10 AND 500
       OR length(coalesce(e.value ->> 'info_text', '')) > 1500
  ) THEN
    RAISE EXCEPTION 'consent text must be 10 to 500 characters and info text up to 1500' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(t.version), 0) + 1 INTO v_version
  FROM public.audience_consent_text t WHERE t.audience_id = v_a.id;
  SELECT w.privacy_url INTO v_privacy FROM public.workspace w WHERE w.id = v_a.workspace_id;
  INSERT INTO public.audience_consent_text (
    workspace_id, audience_id, version, language, consent_text, info_text, privacy_url, created_by
  )
  SELECT v_a.workspace_id, v_a.id, v_version, e.key, btrim(e.value ->> 'consent_text'),
         nullif(btrim(coalesce(e.value ->> 'info_text', '')), ''), v_privacy, auth.uid()
  FROM jsonb_each(p_texts) e;
  UPDATE public.audience SET current_text_version = v_version WHERE id = v_a.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Abrir, cerrar o archivar el formulario. Abrir pide el texto vigente y la
-- política (la guarda de la tabla) y, hasta que haya SES, un espacio en modo
-- simulador o un dominio del público en SES (plan § 5.4).
CREATE FUNCTION public.set_audience_status(p_id uuid, p_status public.audience_status)
RETURNS public.audience
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_a   public.audience := private.audience_for_caller(p_id, true);
  v_row public.audience;
BEGIN
  IF p_status IS NULL THEN
    RAISE EXCEPTION 'status is required' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'open' AND NOT EXISTS (
    SELECT 1 FROM public.workspace w WHERE w.id = v_a.workspace_id AND w.mailout_simulator_only
  ) AND NOT EXISTS (
    SELECT 1 FROM public.mail_domain d
    WHERE d.workspace_id = v_a.workspace_id AND d.purpose = 'audience' AND d.provider = 'ses'
  ) THEN
    RAISE EXCEPTION 'a list opens to real people only with an audience domain on SES' USING ERRCODE = '22023';
  END IF;
  UPDATE public.audience SET status = p_status WHERE id = v_a.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Un enlace nuevo del formulario: el viejo deja de valer.
CREATE FUNCTION public.regenerate_audience_form_key(p_id uuid)
RETURNS public.audience
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_a   public.audience := private.audience_for_caller(p_id, true);
  v_row public.audience;
BEGIN
  UPDATE public.audience SET form_key = encode(extensions.gen_random_bytes(16), 'hex') WHERE id = v_a.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Alta a mano (la persona lo pidió en persona): queda `pending` hasta que
-- confirme, como el formulario. No devuelve el token (lo emite la máquina,
-- audience_confirmation_token, para el correo); sí si hay que mandarlo.
CREATE FUNCTION public.add_audience_subscription(
  p_audience_id uuid,
  p_address     text,
  p_name        text DEFAULT NULL,
  p_language    text DEFAULT NULL
) RETURNS TABLE (subscription_id uuid, send_confirmation boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_a       public.audience := private.audience_for_caller(p_audience_id, true);
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
  v_lang    text := CASE WHEN p_language = ANY (v_a.languages) THEN p_language ELSE v_a.default_language END;
  v_id      uuid;
BEGIN
  IF v_address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_address) > 254 THEN
    RAISE EXCEPTION 'address is not valid' USING ERRCODE = '22023';
  END IF;
  IF v_a.status = 'archived' THEN
    RAISE EXCEPTION 'this list is archived' USING ERRCODE = '22023';
  END IF;
  v_id := private.audience_request(
    v_a, v_address, p_name, v_lang, (private.audience_current_text(v_a, v_lang)).id, NULL,
    'manual', 'admin', NULL, NULL, NULL, auth.uid()
  );
  RETURN QUERY SELECT coalesce(v_id, (SELECT s.id FROM public.audience_subscription s
                                      WHERE s.audience_id = v_a.id AND s.address = v_address)),
                      v_id IS NOT NULL;
END;
$$;

-- Importar una lista con su base declarada (plan § 3.6). p_rows: [{email,
-- name?, language?}]. Se saltan y se cuentan: mal formadas, repetidas en el
-- fichero, excluidas en el espacio, de baja en la lista (una baja no se
-- deshace importando) y las que ya están. La primera importación del espacio
-- queda en revisión.
CREATE FUNCTION public.import_audience(
  p_audience_id        uuid,
  p_filename           text,
  p_rows               jsonb,
  p_basis_kind         public.mail_basis_kind,
  p_source_note        text,
  p_statement_language text DEFAULT 'es'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_a         public.audience := private.audience_for_caller(p_audience_id, true);
  v_note      text := nullif(btrim(coalesce(p_source_note, '')), '');
  v_lang      text := coalesce(p_statement_language, 'es');
  v_company   text;
  v_statement text;
  v_import    public.audience_import;
  v_skipped   jsonb;
  v_rows      integer;
  v_imported  integer;
BEGIN
  IF p_basis_kind IS NULL OR p_basis_kind NOT IN ('consent', 'relationship') THEN
    RAISE EXCEPTION 'an import needs a basis: consent or relationship' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL OR length(v_note) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'an import needs its source in writing (10 to 1000 characters)' USING ERRCODE = '22023';
  END IF;
  IF v_lang NOT IN ('es', 'ca', 'en', 'fr') THEN
    RAISE EXCEPTION 'statement language must be es, ca, en or fr' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows must be a non-empty array' USING ERRCODE = '22023';
  END IF;
  v_rows := jsonb_array_length(p_rows);
  IF v_rows > 5000 THEN
    RAISE EXCEPTION 'at most 5000 rows per import' USING ERRCODE = '22023';
  END IF;
  IF v_a.status = 'archived' THEN
    RAISE EXCEPTION 'this list is archived' USING ERRCODE = '22023';
  END IF;

  -- La declaración exacta que se acepta, en su idioma (plan § 6.2).
  SELECT w.name INTO v_company FROM public.workspace w WHERE w.id = v_a.workspace_id;
  v_statement := CASE p_basis_kind
    WHEN 'consent' THEN CASE v_lang
      WHEN 'ca' THEN 'Van acceptar rebre comunicacions de ' || v_company || '. Puc demostrar que aquestes persones ho van acceptar.'
      WHEN 'en' THEN 'They agreed to receive messages from ' || v_company || '. I can prove these people agreed to it.'
      WHEN 'fr' THEN 'Ils ont accepté de recevoir des messages de ' || v_company || '. Je peux prouver que ces personnes l''ont accepté.'
      ELSE 'Aceptaron recibir comunicaciones de ' || v_company || '. Puedo demostrar que estas personas lo aceptaron.' END
    ELSE CASE v_lang
      WHEN 'ca' THEN 'Han estat clients de ' || v_company || '.'
      WHEN 'en' THEN 'They have been customers of ' || v_company || '.'
      WHEN 'fr' THEN 'Ils ont été clients de ' || v_company || '.'
      ELSE 'Han sido clientes de ' || v_company || '.' END
  END;

  INSERT INTO public.audience_import (
    workspace_id, audience_id, filename, basis_kind, source_note, statement_text, statement_language,
    declared_by, row_count, status
  ) VALUES (
    v_a.workspace_id, v_a.id, left(nullif(btrim(coalesce(p_filename, '')), ''), 255), p_basis_kind, v_note,
    v_statement, v_lang, auth.uid(), v_rows,
    CASE WHEN EXISTS (SELECT 1 FROM public.audience_import i
                      WHERE i.workspace_id = v_a.workspace_id AND i.status = 'done')
         THEN 'done' ELSE 'review' END::public.audience_import_status
  ) RETURNING * INTO v_import;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.audience_import_rows (
    ord bigint, address text, name text, language text, skip text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.audience_import_rows;
  INSERT INTO pg_temp.audience_import_rows
  SELECT x.ord, x.address, x.name, x.language,
         CASE
           WHEN x.address IS NULL OR x.address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(x.address) > 254 THEN 'invalid'
           WHEN row_number() OVER (PARTITION BY x.address ORDER BY x.ord) > 1 THEN 'duplicate'
           WHEN EXISTS (SELECT 1 FROM public.mail_suppression s
                        WHERE s.workspace_id = v_a.workspace_id AND s.address = x.address::extensions.citext) THEN 'suppressed'
           WHEN EXISTS (SELECT 1 FROM public.audience_subscription s
                        WHERE s.audience_id = v_a.id AND s.address = x.address::extensions.citext
                          AND s.status = 'unsubscribed') THEN 'unsubscribed'
           WHEN EXISTS (SELECT 1 FROM public.audience_subscription s
                        WHERE s.audience_id = v_a.id AND s.address = x.address::extensions.citext) THEN 'existing'
         END
  FROM (
    SELECT t.ord,
           lower(nullif(btrim(t.r ->> 'email'), '')) AS address,
           left(nullif(btrim(t.r ->> 'name'), ''), 200) AS name,
           lower(nullif(btrim(t.r ->> 'language'), '')) AS language
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, ord)
  ) x;

  SELECT coalesce(jsonb_object_agg(k.skip, k.n), '{}'::jsonb) INTO v_skipped
  FROM (SELECT skip, count(*) AS n FROM pg_temp.audience_import_rows WHERE skip IS NOT NULL GROUP BY skip) k;

  WITH ins AS (
    INSERT INTO public.audience_subscription (
      workspace_id, audience_id, address, name, language, status, basis_kind, source, import_id, confirmed_at
    )
    SELECT v_a.workspace_id, v_a.id, x.address::extensions.citext, x.name,
           CASE WHEN x.language = ANY (v_a.languages) THEN x.language ELSE v_a.default_language END,
           'confirmed', p_basis_kind, 'import', v_import.id, now()
    FROM pg_temp.audience_import_rows x
    WHERE x.skip IS NULL
    ORDER BY x.ord
    ON CONFLICT (audience_id, address) DO NOTHING
    RETURNING id
  ), ev AS (
    INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, channel, actor_user_id, import_id)
    SELECT v_a.workspace_id, ins.id, 'imported', 'import', auth.uid(), v_import.id FROM ins
    RETURNING 1
  )
  SELECT count(*) INTO v_imported FROM ev;

  UPDATE public.audience_import
  SET imported_count = v_imported, skipped = v_skipped
  WHERE id = v_import.id
  RETURNING * INTO v_import;

  RETURN jsonb_build_object(
    'import_id', v_import.id, 'status', v_import.status, 'row_count', v_import.row_count,
    'imported_count', v_import.imported_count, 'skipped', v_import.skipped
  );
END;
$$;

-- Baja a petición de la persona (por teléfono, por correo).
CREATE FUNCTION public.unsubscribe_audience_subscription(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_s public.audience_subscription;
BEGIN
  SELECT * INTO v_s FROM public.audience_subscription WHERE id = p_id FOR UPDATE;
  IF auth.uid() IS NULL OR v_s.id IS NULL OR NOT private.audience_access(v_s.workspace_id, true) THEN
    RAISE EXCEPTION 'subscription % not found', p_id USING ERRCODE = '42501';
  END IF;
  IF v_s.status = 'unsubscribed' THEN
    RETURN;
  END IF;
  UPDATE public.audience_subscription
  SET status = 'unsubscribed', unsubscribed_at = now(), confirm_token_hash = NULL, confirm_expires_at = NULL
  WHERE id = v_s.id;
  INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, channel, actor_user_id)
  VALUES (v_s.workspace_id, v_s.id, 'unsubscribed', 'admin', auth.uid());
END;
$$;

-- Borrar los datos de una persona (RGPD art. 17), con su prueba y sus filas
-- de invitación. Admin. La exclusión del espacio, si la hay, queda (plan
-- § 3.7, punto 7, para el abogado).
CREATE FUNCTION public.erase_audience_subscription(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.audience_subscription WHERE id = p_id FOR UPDATE;
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'subscription % not found', p_id USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.audience_subscription WHERE id = p_id;
END;
$$;

-- La prueba completa de una dirección, con IP, agente, página y los textos
-- aceptados (plan § 3.4). Admin.
CREATE FUNCTION public.audience_consent_proof(p_subscription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_s public.audience_subscription;
BEGIN
  SELECT * INTO v_s FROM public.audience_subscription WHERE id = p_subscription_id;
  IF auth.uid() IS NULL OR v_s.id IS NULL OR NOT public.is_workspace_admin(v_s.workspace_id) THEN
    RAISE EXCEPTION 'subscription % not found', p_subscription_id USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'subscription', jsonb_build_object(
      'id', v_s.id, 'audience_id', v_s.audience_id, 'address', v_s.address::text, 'name', v_s.name,
      'language', v_s.language, 'status', v_s.status, 'basis_kind', v_s.basis_kind, 'source', v_s.source,
      'confirmed_at', v_s.confirmed_at, 'unsubscribed_at', v_s.unsubscribed_at, 'created_at', v_s.created_at,
      'audience_name', (SELECT a.name FROM public.audience a WHERE a.id = v_s.audience_id)
    ),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'occurred_at', e.occurred_at, 'channel', e.channel,
               'ip', host(e.ip), 'user_agent', e.user_agent, 'page_url', e.page_url,
               'age_confirmed', e.age_confirmed, 'actor_user_id', e.actor_user_id,
               'consent_text_id', e.consent_text_id, 'import_id', e.import_id
             ) ORDER BY e.occurred_at, e.id)
      FROM public.audience_consent_event e WHERE e.subscription_id = v_s.id), '[]'::jsonb),
    'texts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'version', t.version, 'language', t.language, 'consent_text', t.consent_text,
               'info_text', t.info_text, 'privacy_url', t.privacy_url, 'created_at', t.created_at
             ) ORDER BY t.version, t.language)
      FROM public.audience_consent_text t
      WHERE t.id = v_s.consent_text_id
         OR t.id IN (SELECT e.consent_text_id FROM public.audience_consent_event e WHERE e.subscription_id = v_s.id)), '[]'::jsonb),
    'imports', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', i.id, 'basis_kind', i.basis_kind, 'source_note', i.source_note,
               'statement_text', i.statement_text, 'declared_by', i.declared_by, 'declared_at', i.declared_at,
               'status', i.status, 'reviewed_at', i.reviewed_at
             ))
      FROM public.audience_import i WHERE i.id = v_s.import_id), '[]'::jsonb)
  );
END;
$$;

-- ── RPC públicas por token (anon) ─────────────────────────────────────────

-- Lo que pinta el formulario de una lista: nada más que esto. Una clave que
-- no existe, o una lista en borrador o archivada, no devuelve nada.
CREATE FUNCTION public.audience_form_info(p_key text, p_language text DEFAULT NULL)
RETURNS TABLE (
  company_name     text,
  logo_url         text,
  audience_name    text,
  description      text,
  language         text,
  languages        text[],
  consent_text_id  uuid,
  consent_text     text,
  info_text        text,
  privacy_url      text,
  open             boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT w.name, w.logo_url, a.name, a.description, t.language, a.languages,
         t.id, t.consent_text, t.info_text, coalesce(t.privacy_url, w.privacy_url), a.status = 'open'
  FROM public.audience a
  JOIN public.workspace w ON w.id = a.workspace_id
  LEFT JOIN LATERAL private.audience_current_text(a, p_language) t ON true
  WHERE a.form_key = btrim(coalesce(p_key, '')) AND a.status IN ('open', 'closed');
$$;

-- Lo que pinta la página de confirmación. No confirma: eso es un POST
-- (audience_confirm, máquina). Un token que no existe no devuelve nada.
CREATE FUNCTION public.audience_confirm_info(p_token text)
RETURNS TABLE (company_name text, audience_name text, language text, valid boolean, confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT w.name, a.name, s.language,
         coalesce(s.confirm_expires_at > now(), false) AND a.status <> 'archived',
         s.status = 'confirmed'
  FROM public.audience_subscription s
  JOIN public.audience a ON a.id = s.audience_id
  JOIN public.workspace w ON w.id = s.workspace_id
  WHERE s.confirm_token_hash = encode(extensions.digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex');
$$;

-- Baja en un clic. Un token que no existe no hace nada y no se distingue.
-- Idempotente. Un destinatario del público se da de baja de su lista, no del
-- espacio (§ 3.5); un profesional, como siempre: exclusión, base retirada y
-- nota en su conversación.
CREATE OR REPLACE FUNCTION public.mailout_unsubscribe(p_token text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r    public.mailout_recipient;
  v_prev public.mail_suppression_reason;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE unsubscribe_token = btrim(coalesce(p_token, '')) AND address IS NOT NULL;
  IF v_r.id IS NULL THEN
    RETURN;
  END IF;
  IF v_r.audience_subscription_id IS NOT NULL THEN
    UPDATE public.audience_subscription
    SET status = 'unsubscribed', unsubscribed_at = now(), confirm_token_hash = NULL, confirm_expires_at = NULL
    WHERE id = v_r.audience_subscription_id AND status <> 'unsubscribed';
    IF FOUND THEN
      INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, channel)
      VALUES (v_r.workspace_id, v_r.audience_subscription_id, 'unsubscribed', 'page');
    END IF;
    RETURN;
  END IF;
  SELECT reason INTO v_prev FROM public.mail_suppression
  WHERE workspace_id = v_r.workspace_id AND address = v_r.address FOR UPDATE;
  IF v_prev IN ('unsubscribe', 'complaint') THEN
    RETURN;
  END IF;
  INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
  VALUES (v_r.workspace_id, v_r.address, 'unsubscribe', v_r.id)
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET reason = 'unsubscribe', mailout_recipient_id = EXCLUDED.mailout_recipient_id, created_at = now(),
      created_by = NULL;
  UPDATE public.mail_basis SET withdrawn_at = now()
  WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND withdrawn_at IS NULL;
  PERFORM private.mailout_record_note(v_r, 'unsubscribed');
END;
$$;

-- «No recibir nada más de {compañía}» (§ 3.5): la baja de su origen y la
-- exclusión de todo el espacio, que también corta la difusión a esa dirección.
CREATE FUNCTION public.mailout_unsubscribe_everything(p_token text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r public.mailout_recipient;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE unsubscribe_token = btrim(coalesce(p_token, '')) AND address IS NOT NULL;
  IF v_r.id IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.mailout_unsubscribe(p_token);
  INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
  VALUES (v_r.workspace_id, v_r.address, 'unsubscribe', v_r.id)
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET reason = CASE WHEN mail_suppression.reason = 'complaint' THEN 'complaint'::public.mail_suppression_reason
                    ELSE 'unsubscribe'::public.mail_suppression_reason END,
      mailout_recipient_id = coalesce(mail_suppression.mailout_recipient_id, EXCLUDED.mailout_recipient_id),
      created_by = NULL;
END;
$$;

-- Deshacer la propia baja desde la página de baja. Un profesional, como
-- siempre: la base pasa a consentimiento con su nota. Un destinatario del
-- público no: volver a su lista es un consentimiento nuevo y su prueba lleva
-- IP y agente, que pone el Worker (audience_resubscribe, de máquina, § 3.4).
-- Por token anon no hace nada. Cuerpo vivo con esa rama.
CREATE OR REPLACE FUNCTION public.mailout_resubscribe(p_token text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r public.mailout_recipient;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE unsubscribe_token = btrim(coalesce(p_token, '')) AND address IS NOT NULL;
  IF v_r.id IS NULL THEN
    RETURN;
  END IF;
  IF v_r.audience_subscription_id IS NOT NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.mail_suppression
  WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND reason IN ('unsubscribe', 'complaint');
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.mail_basis (workspace_id, address, kind, note)
  VALUES (v_r.workspace_id, v_r.address, 'consent', 'volvió a apuntarse desde la página de baja')
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET kind = 'consent', note = EXCLUDED.note, evidence_event_id = NULL, recorded_by = NULL,
      recorded_at = now(), withdrawn_at = NULL;
  PERFORM private.mailout_record_note(v_r, 'resubscribed');
END;
$$;

-- La página de baja: de quién, en qué idioma, si ya está de baja de su
-- origen; y, nuevas al final, la lista (si es del público) y si la dirección
-- está excluida de todo el espacio. DROP y CREATE: cambian las columnas.
DROP FUNCTION public.mailout_unsubscribe_info(text);

CREATE FUNCTION public.mailout_unsubscribe_info(p_token text)
RETURNS TABLE (company_name text, language text, unsubscribed boolean, audience_name text, suppressed boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT w.name, coalesce(s.language, m.language),
         CASE WHEN r.audience_subscription_id IS NOT NULL THEN s.status = 'unsubscribed' ELSE sup.found END,
         a.name,
         sup.found
  FROM public.mailout_recipient r
  JOIN public.mailout m ON m.id = r.mailout_id
  JOIN public.workspace w ON w.id = r.workspace_id
  LEFT JOIN public.audience_subscription s ON s.id = r.audience_subscription_id
  LEFT JOIN public.audience a ON a.id = s.audience_id
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM public.mail_suppression x
                   WHERE x.workspace_id = r.workspace_id AND x.address = r.address
                     AND x.reason IN ('unsubscribe', 'complaint')) AS found
  ) sup
  WHERE r.unsubscribe_token = btrim(coalesce(p_token, '')) AND r.address IS NOT NULL;
$$;

-- ── RPC de máquina (solo service_role) ────────────────────────────────────

-- El alta del formulario (§ 3.3). El Worker pone IP, agente y página. Siempre
-- una fila: sin token, no se manda nada (lista cerrada o desconocida, ya
-- confirmada, o pasada de límites); la respuesta a la persona es la misma.
CREATE FUNCTION public.audience_subscribe(
  p_key           text,
  p_address       text,
  p_name          text,
  p_language      text,
  p_text_id       uuid,
  p_age_confirmed boolean,
  p_ip            inet,
  p_user_agent    text,
  p_channel       public.audience_consent_channel DEFAULT 'form',
  p_page_url      text DEFAULT NULL
) RETURNS TABLE (subscription_id uuid, token text, language text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_a       public.audience;
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
  v_lang    text;
  v_text    public.audience_consent_text;
  v_id      uuid;
BEGIN
  IF coalesce(p_channel, 'form') NOT IN ('form', 'embed') THEN
    RAISE EXCEPTION 'channel must be form or embed' USING ERRCODE = '22023';
  END IF;
  IF v_address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_address) > 254 THEN
    RAISE EXCEPTION 'address is not valid' USING ERRCODE = '22023';
  END IF;
  IF p_age_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'the age statement is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.audience WHERE form_key = btrim(coalesce(p_key, '')) AND status = 'open';
  IF v_a.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_lang := CASE WHEN p_language = ANY (v_a.languages) THEN p_language ELSE v_a.default_language END;
  IF p_text_id IS NULL THEN
    v_text := private.audience_current_text(v_a, v_lang);
  ELSE
    SELECT * INTO v_text FROM public.audience_consent_text t WHERE t.id = p_text_id AND t.audience_id = v_a.id;
  END IF;
  IF v_text.id IS NULL THEN
    RAISE EXCEPTION 'consent text not found for this list' USING ERRCODE = '22023';
  END IF;
  v_id := private.audience_request(
    v_a, v_address, p_name, v_text.language, v_text.id, true, coalesce(p_channel, 'form')::text::public.audience_source,
    coalesce(p_channel, 'form'), p_ip, p_user_agent, p_page_url, NULL
  );
  RETURN QUERY SELECT v_id, CASE WHEN v_id IS NOT NULL THEN private.audience_issue_token(v_id) END, v_text.language;
END;
$$;

-- El token de confirmación de un alta a mano, para el correo (§ 4.4). NULL
-- si ya está confirmada o pasa de los límites.
CREATE FUNCTION public.audience_confirmation_token(p_subscription_id uuid)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT private.audience_issue_token(p_subscription_id);
$$;

-- «¿Ha sido un error? Volver a apuntarme» desde la página de baja de una
-- invitación (§ 3.5). El Worker pone IP y agente: el evento `resubscribed`
-- guarda, como la confirmación, la versión vigente del texto, y vale como base
-- (audience_basis_event). Primero la suscripción del token; después solo se
-- levanta la exclusión del espacio que nació de ella (su «nada más» o su
-- queja), nunca una de la difusión. Idempotente. false si el token no es de
-- una persona del público.
CREATE FUNCTION public.audience_resubscribe(p_token text, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r    public.mailout_recipient;
  v_s    public.audience_subscription;
  v_a    public.audience;
  v_text uuid;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE unsubscribe_token = btrim(coalesce(p_token, '')) AND address IS NOT NULL
    AND audience_subscription_id IS NOT NULL;
  IF v_r.id IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_s FROM public.audience_subscription WHERE id = v_r.audience_subscription_id FOR UPDATE;
  SELECT * INTO v_a FROM public.audience WHERE id = v_s.audience_id;
  IF v_a.status = 'archived' THEN
    RETURN false;
  END IF;
  DELETE FROM public.mail_suppression s
  WHERE s.workspace_id = v_s.workspace_id AND s.address = v_s.address
    AND s.reason IN ('unsubscribe', 'complaint')
    AND s.mailout_recipient_id IN (SELECT x.id FROM public.mailout_recipient x
                                   WHERE x.audience_subscription_id = v_s.id);
  IF v_s.status <> 'unsubscribed' THEN
    RETURN true;
  END IF;
  v_text := (private.audience_current_text(v_a, v_s.language)).id;
  UPDATE public.audience_subscription
  SET status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), unsubscribed_at = NULL,
      consent_text_id = coalesce(v_text, consent_text_id)
  WHERE id = v_s.id;
  INSERT INTO public.audience_consent_event (
    workspace_id, subscription_id, kind, consent_text_id, channel, ip, user_agent
  ) VALUES (
    v_s.workspace_id, v_s.id, 'resubscribed', v_text, 'page', p_ip, left(p_user_agent, 500)
  );
  RETURN true;
END;
$$;

-- El POST de la página de confirmación (§ 3.3, paso 4). Idempotente: una
-- segunda vez con el mismo token, true sin otro evento. Caducado o
-- desconocido, false.
CREATE FUNCTION public.audience_confirm(p_token text, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_s public.audience_subscription;
BEGIN
  SELECT * INTO v_s FROM public.audience_subscription
  WHERE confirm_token_hash = encode(extensions.digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex')
  FOR UPDATE;
  IF v_s.id IS NULL OR v_s.confirm_expires_at <= now()
     OR EXISTS (SELECT 1 FROM public.audience a WHERE a.id = v_s.audience_id AND a.status = 'archived') THEN
    RETURN false;
  END IF;
  IF v_s.status = 'confirmed' THEN
    RETURN true;
  END IF;
  UPDATE public.audience_subscription
  SET status = 'confirmed', confirmed_at = now(), unsubscribed_at = NULL, basis_kind = 'consent'
  WHERE id = v_s.id;
  INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, consent_text_id, ip, user_agent)
  VALUES (v_s.workspace_id, v_s.id, 'confirmed', v_s.consent_text_id, p_ip, left(p_user_agent, 500));
  RETURN true;
END;
$$;

-- El correo de confirmación salió: su id del proveedor, para casar un rebote
-- o una queja (§ 4.6).
CREATE FUNCTION public.audience_confirmation_sent(p_subscription_id uuid, p_provider_message_id text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.audience_subscription
  SET confirm_provider_message_id = left(nullif(btrim(p_provider_message_id), ''), 200)
  WHERE id = p_subscription_id;
$$;

-- Cron diario: de quien no confirmó en 30 días no se guarda nada (§ 3.3).
CREATE FUNCTION public.audience_purge_pending()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.audience_subscription
  WHERE status = 'pending'
    AND greatest(created_at, coalesce(confirm_last_sent_at, created_at)) < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- La revisión de Marco de la primera importación de un espacio (§ 3.6).
CREATE FUNCTION public.audience_approve_import(p_import_id uuid, p_reviewed_by uuid DEFAULT NULL)
RETURNS public.audience_import
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.audience_import;
BEGIN
  UPDATE public.audience_import
  SET status = 'done', reviewed_at = now(), reviewed_by = p_reviewed_by
  WHERE id = p_import_id AND status = 'review'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'import % is not waiting for review', p_import_id USING ERRCODE = '22023';
  END IF;
  RETURN v_row;
END;
$$;

-- Marco aprueba el primer envío real: pasa a la cola, y queda revisada cada
-- identidad que usa (la de la difusión, la del público o las dos).
CREATE OR REPLACE FUNCTION public.mailout_approve_review(p_mailout_id uuid, p_reviewed_by uuid DEFAULT NULL)
RETURNS public.mailout
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row  public.mailout;
  v_pros boolean;
  v_subs boolean;
BEGIN
  UPDATE public.mailout
  SET status = 'queued', reviewed_at = now(), reviewed_by = p_reviewed_by
  WHERE id = p_mailout_id AND status = 'review'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'mailout % is not waiting for review', p_mailout_id USING ERRCODE = '22023';
  END IF;
  v_pros := EXISTS (SELECT 1 FROM public.mailout_recipient r
                    WHERE r.mailout_id = v_row.id AND r.conversation_id IS NOT NULL AND r.status <> 'skipped');
  v_subs := EXISTS (SELECT 1 FROM public.mailout_recipient r
                    WHERE r.mailout_id = v_row.id AND r.audience_subscription_id IS NOT NULL AND r.status <> 'skipped');
  UPDATE public.workspace
  SET mailout_reviewed_at = CASE WHEN v_pros THEN coalesce(mailout_reviewed_at, now()) ELSE mailout_reviewed_at END,
      mailout_reviewed_by = CASE WHEN v_pros THEN coalesce(mailout_reviewed_by, p_reviewed_by) ELSE mailout_reviewed_by END,
      invitation_reviewed_at = CASE WHEN v_subs THEN coalesce(invitation_reviewed_at, now()) ELSE invitation_reviewed_at END,
      invitation_reviewed_by = CASE WHEN v_subs THEN coalesce(invitation_reviewed_by, p_reviewed_by) ELSE invitation_reviewed_by END
  WHERE id = v_row.workspace_id;
  RETURN v_row;
END;
$$;

-- Toma de la cola hasta p_limit correos: destinatarios `queued` que tocan, de
-- envíos en marcha con la identidad de la fila verificada, sin pasar del tope
-- diario de cada espacio y propósito (difusión: mailout_daily_cap; público:
-- invitation_daily_cap) y repartiendo entre espacios. Antes vuelve a mirar
-- «no esta vez», supresión, la base de un profesional y el estado de una
-- suscripción, y devuelve a la cola los arriendos caducados (15 minutos).
-- DROP y CREATE: gana dos columnas al final; el remitente de una fila del
-- público es el de su dominio.
DROP FUNCTION public.mailout_claim(integer, uuid);

CREATE FUNCTION public.mailout_claim(p_limit integer DEFAULT 50, p_mailout_id uuid DEFAULT NULL)
RETURNS TABLE (
  recipient_id             uuid,
  mailout_id               uuid,
  workspace_id             uuid,
  conversation_id          uuid,
  address                  text,
  display_name             text,
  address_kind             public.mailout_address_kind,
  basis_kind               public.mail_basis_kind,
  unsubscribe_token        text,
  attempts                 integer,
  provider                 public.mail_sending_provider,
  tenant_name              text,
  configuration_set        text,
  from_address             text,
  from_name                text,
  reply_to_address         text,
  language                 text,
  subject                  text,
  body                     text,
  audience_subscription_id uuid,
  mail_domain_id           uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  -- Una pasada a la vez: el tope diario se cuenta sin carreras.
  PERFORM pg_advisory_xact_lock(hashtext('public.mailout_claim'));

  UPDATE public.mailout_recipient
  SET status = 'queued', claimed_at = NULL, next_attempt_at = now()
  WHERE status = 'sending' AND claimed_at < now() - interval '15 minutes';

  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'not_now'
  WHERE r.status = 'queued' AND r.conversation_id IS NOT NULL
    AND private.conversation_not_now(r.conversation_id);
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'suppressed'
  WHERE r.status = 'queued'
    AND EXISTS (SELECT 1 FROM public.mail_suppression s
                WHERE s.workspace_id = r.workspace_id AND s.address = r.address);
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'no_basis'
  WHERE r.status = 'queued' AND r.conversation_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address
                      AND b.withdrawn_at IS NULL);
  -- Una persona del público que se dio de baja después, o de una importación
  -- que dejó de estar aprobada, ya no recibe.
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'no_basis'
  WHERE r.status = 'queued' AND r.audience_subscription_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.audience_subscription s
                    LEFT JOIN public.audience_import i ON i.id = s.import_id
                    WHERE s.id = r.audience_subscription_id AND s.status = 'confirmed'
                      AND (s.import_id IS NULL OR i.status = 'done'));

  RETURN QUERY
  WITH cand AS (
    SELECT r.id, r.workspace_id, d.purpose,
           row_number() OVER (PARTITION BY r.workspace_id, d.purpose ORDER BY r.next_attempt_at, r.id) AS rn
    FROM public.mailout_recipient r
    JOIN public.mailout m ON m.id = r.mailout_id AND m.status IN ('queued', 'sending')
    JOIN public.mail_domain d ON d.id = r.mail_domain_id AND d.verified_at IS NOT NULL
    WHERE r.status = 'queued' AND r.next_attempt_at <= now()
      AND (p_mailout_id IS NULL OR r.mailout_id = p_mailout_id)
  ),
  -- El origen dice el propósito: un profesional sale por la difusión, una
  -- persona del público por su subdominio.
  budget AS (
    SELECT w.id, p.purpose,
           greatest(CASE p.purpose WHEN 'audience' THEN w.invitation_daily_cap ELSE w.mailout_daily_cap END - (
             SELECT count(*) FROM public.mailout_recipient x
             WHERE x.workspace_id = w.id
               AND (x.audience_subscription_id IS NOT NULL) = (p.purpose = 'audience')
               AND (x.status = 'sending' OR x.sent_at > now() - interval '24 hours')
           ), 0) AS remaining
    FROM (SELECT DISTINCT c.workspace_id, c.purpose FROM cand c) p
    JOIN public.workspace w ON w.id = p.workspace_id
  ),
  pick AS (
    SELECT c.id FROM cand c JOIN budget b ON b.id = c.workspace_id AND b.purpose = c.purpose
    WHERE c.rn <= b.remaining
    ORDER BY c.rn, c.id
    LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
  ),
  locked AS (
    SELECT r.id FROM public.mailout_recipient r
    WHERE r.id IN (SELECT id FROM pick)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.mailout_recipient r
    SET status = 'sending', claimed_at = now(), attempts = r.attempts + 1
    WHERE r.id IN (SELECT id FROM locked)
    RETURNING r.*
  ),
  started AS (
    UPDATE public.mailout m SET status = 'sending'
    WHERE m.status = 'queued' AND m.id IN (SELECT mailout_id FROM claimed)
    RETURNING m.id
  )
  SELECT c.id, c.mailout_id, c.workspace_id, c.conversation_id, c.address::text, c.display_name,
         c.address_kind, c.basis_kind, c.unsubscribe_token, c.attempts,
         d.provider, d.tenant_name, d.configuration_set,
         CASE WHEN d.purpose = 'audience' THEN d.from_local_part || '@' || d.domain::text
              ELSE m.from_address::text END,
         m.from_name, m.reply_to_address::text, m.language, m.subject, m.body,
         c.audience_subscription_id, c.mail_domain_id
  FROM claimed c
  JOIN public.mailout m ON m.id = c.mailout_id
  JOIN public.mail_domain d ON d.id = c.mail_domain_id;
END;
$$;

-- El proveedor aceptó el correo: `sent` y, para un profesional, el evento en
-- su conversación y last_contacted_at, en una transacción. Una persona del
-- público no deja `conversation_event` (§ 2.1). Idempotente. Cuerpo vivo
-- (20261016100000) con esa rama.
CREATE OR REPLACE FUNCTION public.mailout_record_sent(
  p_recipient_id        uuid,
  p_provider_message_id text,
  p_rfc_message_id      text,
  p_body                text,
  p_subject             text DEFAULT NULL
) RETURNS public.mailout_recipient
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r public.mailout_recipient;
BEGIN
  SELECT * INTO v_r FROM public.mailout_recipient WHERE id = p_recipient_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'recipient % not found', p_recipient_id USING ERRCODE = '42501';
  END IF;
  IF v_r.status IN ('sent', 'delivered', 'bounced', 'complained')
     AND (v_r.conversation_id IS NULL OR v_r.conversation_event_id IS NOT NULL) THEN
    RETURN v_r;
  END IF;
  IF v_r.status NOT IN ('sending', 'queued', 'sent') THEN
    RAISE EXCEPTION 'recipient % is not being sent', p_recipient_id USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout_recipient
  SET status = 'sent',
      provider_message_id = coalesce(nullif(btrim(p_provider_message_id), ''), provider_message_id),
      rfc_message_id = coalesce(nullif(btrim(p_rfc_message_id), ''), rfc_message_id),
      sent_at = coalesce(sent_at, now()),
      claimed_at = NULL,
      last_error = NULL
  WHERE id = v_r.id
  RETURNING * INTO v_r;
  IF v_r.conversation_id IS NOT NULL THEN
    UPDATE public.mailout_recipient
    SET conversation_event_id = private.mailout_record_conversation_event(v_r, p_body, p_subject)
    WHERE id = v_r.id
    RETURNING * INTO v_r;
  END IF;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN v_r;
END;
$$;

-- Un evento del proveedor (o del simulador). Idempotente por
-- provider_event_id. Cuerpo vivo con las ramas por origen: la queja de una
-- persona del público la da de baja de su lista (evento `complained`) y la
-- excluye del espacio; la de un profesional, como siempre. Un evento que no
-- casa con ningún destinatario puede ser del correo de confirmación de un
-- alta: rebote permanente y queja, a la exclusión del espacio.
CREATE OR REPLACE FUNCTION public.mailout_record_event(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event_id text := nullif(btrim(coalesce(p_payload ->> 'provider_event_id', '')), '');
  v_type     public.mailout_event_type := (p_payload ->> 'type')::public.mailout_event_type;
  v_bounce   text := nullif(p_payload ->> 'bounce_type', '');
  v_at       timestamptz := least(coalesce((p_payload ->> 'occurred_at')::timestamptz, now()), now());
  v_r        public.mailout_recipient;
  v_s        public.audience_subscription;
  v_new      uuid;
BEGIN
  IF v_event_id IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'provider_event_id and type are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.mailout_recipient
  WHERE (p_payload ? 'recipient_id' AND id = (p_payload ->> 'recipient_id')::uuid)
     OR (NOT p_payload ? 'recipient_id' AND provider_message_id = p_payload ->> 'provider_message_id')
  FOR UPDATE;
  IF v_r.id IS NULL THEN
    IF p_payload ? 'recipient_id' OR nullif(p_payload ->> 'provider_message_id', '') IS NULL THEN
      RETURN false;
    END IF;
    SELECT * INTO v_s FROM public.audience_subscription
    WHERE confirm_provider_message_id = p_payload ->> 'provider_message_id'
    FOR UPDATE;
    IF v_s.id IS NULL THEN
      RETURN false;
    END IF;
    IF v_type = 'bounce' AND v_bounce = 'Permanent' THEN
      INSERT INTO public.mail_suppression (workspace_id, address, reason)
      VALUES (v_s.workspace_id, v_s.address, 'bounce')
      ON CONFLICT (workspace_id, address) DO NOTHING;
      RETURN FOUND;
    ELSIF v_type = 'complaint' THEN
      INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, occurred_at, provider_event_id)
      VALUES (v_s.workspace_id, v_s.id, 'complained', v_at, v_event_id)
      ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_new;
      IF v_new IS NULL THEN
        RETURN false;
      END IF;
      INSERT INTO public.mail_suppression (workspace_id, address, reason)
      VALUES (v_s.workspace_id, v_s.address, 'complaint')
      ON CONFLICT (workspace_id, address) DO UPDATE
      SET reason = 'complaint', created_at = now(), created_by = NULL;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  INSERT INTO public.mailout_event (recipient_id, workspace_id, type, bounce_type, occurred_at, provider_event_id, detail)
  VALUES (v_r.id, v_r.workspace_id, v_type, v_bounce, v_at,
          v_event_id, coalesce(p_payload -> 'detail', '{}'::jsonb))
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO v_new;
  IF v_new IS NULL THEN
    RETURN false;
  END IF;

  IF v_type = 'send' AND v_r.status IN ('sending', 'queued') THEN
    -- mailout_record_sent no llegó: el correo salió igual.
    UPDATE public.mailout_recipient
    SET status = 'sent', sent_at = coalesce(sent_at, now()), claimed_at = NULL
    WHERE id = v_r.id RETURNING * INTO v_r;
    IF v_r.conversation_id IS NOT NULL THEN
      UPDATE public.mailout_recipient
      SET conversation_event_id = private.mailout_record_conversation_event(v_r, NULL)
      WHERE id = v_r.id;
    END IF;
  ELSIF v_type = 'delivery' AND v_r.status IN ('sending', 'sent') THEN
    UPDATE public.mailout_recipient SET status = 'delivered', sent_at = coalesce(sent_at, now())
    WHERE id = v_r.id;
  ELSIF v_type = 'bounce' AND v_bounce = 'Permanent' THEN
    UPDATE public.mailout_recipient SET status = 'bounced' WHERE id = v_r.id;
    INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
    VALUES (v_r.workspace_id, v_r.address, 'bounce', v_r.id)
    ON CONFLICT (workspace_id, address) DO NOTHING;
  ELSIF v_type = 'complaint' THEN
    UPDATE public.mailout_recipient SET status = 'complained' WHERE id = v_r.id;
    INSERT INTO public.mail_suppression (workspace_id, address, reason, mailout_recipient_id)
    VALUES (v_r.workspace_id, v_r.address, 'complaint', v_r.id)
    ON CONFLICT (workspace_id, address) DO UPDATE
    SET reason = 'complaint', mailout_recipient_id = EXCLUDED.mailout_recipient_id, created_at = now(),
        created_by = NULL;
    IF v_r.audience_subscription_id IS NOT NULL THEN
      UPDATE public.audience_subscription
      SET status = 'unsubscribed', unsubscribed_at = coalesce(unsubscribed_at, now())
      WHERE id = v_r.audience_subscription_id;
      INSERT INTO public.audience_consent_event (workspace_id, subscription_id, kind, occurred_at, provider_event_id)
      VALUES (v_r.workspace_id, v_r.audience_subscription_id, 'complained', v_at, v_event_id)
      ON CONFLICT (provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING;
    ELSE
      UPDATE public.mail_basis SET withdrawn_at = now()
      WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND withdrawn_at IS NULL;
      PERFORM private.mailout_record_note(v_r, 'complained');
    END IF;
  ELSIF v_type IN ('reject', 'rendering_failure') AND v_r.status IN ('sending', 'queued', 'sent') THEN
    UPDATE public.mailout_recipient
    SET status = 'failed', claimed_at = NULL, last_error = left(coalesce(p_payload -> 'detail' ->> 'message', v_type::text), 500)
    WHERE id = v_r.id;
  END IF;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN true;
END;
$$;

-- ── Propiedad y grants de funciones ───────────────────────────────────────
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.audience_guard_immutable()',
    'private.audience_guard_open()',
    'private.mailout_guard_kind()',
    'private.mailout_for_caller(uuid, boolean)',
    'private.mailout_record_conversation_event(public.mailout_recipient, text, text)',
    'private.audience_for_caller(uuid, boolean)',
    'private.audience_current_text(public.audience, text)',
    'private.audience_request(public.audience, extensions.citext, text, text, uuid, boolean, public.audience_source, public.audience_consent_channel, inet, text, text, uuid)',
    'private.audience_issue_token(uuid)',
    'private.audience_basis_event(uuid)',
    'private.mailout_compose_rows(uuid[])'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;

  -- Las dos que leen las políticas: authenticated (como
  -- private.mailout_readable_by_caller).
  FOREACH f IN ARRAY ARRAY[
    'private.audience_access(uuid, boolean)',
    'private.invitation_readable_by_caller(uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;

  -- De persona: authenticated.
  FOREACH f IN ARRAY ARRAY[
    'public.add_mail_domain(uuid, text, public.mail_sending_provider, text, text, public.mail_domain_purpose)',
    'public.set_mail_domain_sender(uuid, text, text)',
    'public.remove_mail_domain(uuid)',
    'public.update_mailout(uuid, text, text, text, text, text, uuid, uuid)',
    'public.set_mailout_recipients(uuid, uuid[])',
    'public.create_invitation(uuid, uuid, uuid[], uuid, uuid)',
    'public.set_invitation_audience(uuid, uuid)',
    'public.mailout_preview(uuid)',
    'public.mailout_compose_preview(uuid)',
    'public.queue_mailout(uuid)',
    'public.create_audience(uuid, text, text[], text)',
    'public.update_audience(uuid, text, text, text[], text)',
    'public.set_audience_consent_text(uuid, jsonb)',
    'public.set_audience_status(uuid, public.audience_status)',
    'public.regenerate_audience_form_key(uuid)',
    'public.add_audience_subscription(uuid, text, text, text)',
    'public.import_audience(uuid, text, jsonb, public.mail_basis_kind, text, text)',
    'public.unsubscribe_audience_subscription(uuid)',
    'public.erase_audience_subscription(uuid)',
    'public.audience_consent_proof(uuid)',
    'public.set_membership_facet(uuid, uuid, public.access_verb)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;

  -- Por token: anon y authenticated (las páginas públicas no piden sesión).
  FOREACH f IN ARRAY ARRAY[
    'public.mailout_unsubscribe(text)',
    'public.mailout_resubscribe(text)',
    'public.mailout_unsubscribe_info(text)',
    'public.mailout_unsubscribe_everything(text)',
    'public.audience_form_info(text, text)',
    'public.audience_confirm_info(text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;

  -- De máquina: solo service_role (frontera de ADR-110, ampliada a
  -- `audience_*` por ADR-173 § 4).
  FOREACH f IN ARRAY ARRAY[
    'public.mailout_approve_review(uuid, uuid)',
    'public.mailout_claim(integer, uuid)',
    'public.mailout_send_context(uuid[])',
    'public.mailout_record_sent(uuid, text, text, text, text)',
    'public.mailout_record_event(jsonb)',
    'public.audience_subscribe(text, text, text, text, uuid, boolean, inet, text, public.audience_consent_channel, text)',
    'public.audience_confirmation_token(uuid)',
    'public.audience_confirm(text, inet, text)',
    'public.audience_resubscribe(text, inet, text)',
    'public.audience_confirmation_sent(uuid, text)',
    'public.audience_purge_pending()',
    'public.audience_approve_import(uuid, uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;
