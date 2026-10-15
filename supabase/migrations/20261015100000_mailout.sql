-- ADR-109, ADR-110, ADR-112 · Envío en bloque, fase 1: esquema y RPC.
-- Plan: build/plans/2026-10-14-bulk-send.md (§ 4, § 6, § 7, § 9, § 11 fase 1).
--
-- Aditiva según § 34. El Worker desplegado no lee nada de esto.
--   · enums y tablas nuevas: `mail_domain`, `mailout`, `mailout_recipient`,
--     `mailout_event`, `mail_suppression`, `mail_basis`. `mail_sending_account`
--     (cuenta SES propia) es de la fase 5 y no está;
--   · columnas nuevas en `workspace`: `privacy_url` (la escribe un admin),
--     y `mailout_simulator_only`, `mailout_daily_cap`, `mailout_reviewed_at`,
--     `mailout_reviewed_by`, que solo escribe service_role;
--   · `workspace` pasa de UPDATE a tabla entera a UPDATE por columnas para
--     `authenticated` (las mismas columnas de antes más `privacy_url`): con el
--     grant a tabla entera un admin podría subirse el tope o quitarse el modo
--     simulador por PATCH;
--   · RPC de persona (con su JWT) y RPC de máquina (solo service_role).
-- Rollback: build/runbooks/rollback-20261015-mailout.sql.
--
-- Fronteras:
--   · Acceso solo por `membership` + `membership_facet` (ADR-105): leer un envío
--     es `read:conversation` en su proyecto; escribirlo, `edit:conversation`.
--     Dominios y supresión: admin del espacio.
--   · Proveedor (ADR-111, 2026-10-15): no hay cuenta de AWS todavía. Cada
--     dominio lleva su `provider` (`simulator` por defecto, `ses` cuando la
--     haya). El simulador no envía nada; el esquema no exige nada de SES.
--   · Lo que sale del proveedor (estado del dominio, enviado, entregado,
--     rebote, queja) lo escribe solo service_role: un admin no puede marcar un
--     dominio como verificado.
--   · Sin base apuntada (`mail_basis`) una dirección no sale (ADR-110 punto 2).
--   · Tope diario por espacio (300 por defecto) y revisión de Marco del primer
--     envío real de cada espacio (ADR-110 punto 6): `queue_mailout` deja ese
--     envío en `review` y solo `mailout_approve_review` (service_role) lo
--     pone en cola.
--   · El destinatario nunca lo manda el cliente: sale del contacto principal de
--     la conversación o del correo genérico de su organización.

-- ── Vocabulario ───────────────────────────────────────────────────────────
CREATE TYPE public.mail_sending_provider AS ENUM ('simulator', 'ses');
CREATE TYPE public.mailout_status AS ENUM (
  'draft', 'review', 'queued', 'sending', 'paused', 'done', 'cancelled'
);
CREATE TYPE public.mailout_recipient_status AS ENUM (
  'pending', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'skipped', 'failed'
);
CREATE TYPE public.mailout_skip_reason AS ENUM (
  'suppressed', 'no_basis', 'no_address', 'duplicate', 'cancelled', 'unavailable'
);
CREATE TYPE public.mailout_address_kind AS ENUM ('contact', 'organization');
CREATE TYPE public.mailout_event_type AS ENUM (
  'send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay', 'rendering_failure'
);
CREATE TYPE public.mail_suppression_reason AS ENUM ('unsubscribe', 'bounce', 'complaint', 'manual');
CREATE TYPE public.mail_basis_kind AS ENUM ('consent', 'relationship', 'generic');

-- ── workspace: columnas nuevas y grant de UPDATE por columnas ─────────────
ALTER TABLE public.workspace
  ADD COLUMN privacy_url text,
  ADD COLUMN mailout_simulator_only boolean NOT NULL DEFAULT false,
  ADD COLUMN mailout_daily_cap integer NOT NULL DEFAULT 300,
  ADD COLUMN mailout_reviewed_at timestamptz,
  ADD COLUMN mailout_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT workspace_privacy_url_check
    CHECK (privacy_url IS NULL OR (privacy_url ~* '^https?://' AND length(privacy_url) <= 2048)),
  ADD CONSTRAINT workspace_mailout_daily_cap_check
    CHECK (mailout_daily_cap BETWEEN 0 AND 100000);

CREATE INDEX workspace_mailout_reviewed_by_idx
  ON public.workspace (mailout_reviewed_by) WHERE mailout_reviewed_by IS NOT NULL;

COMMENT ON COLUMN public.workspace.privacy_url IS
  'Bulk send (plan § 3.4): the company''s privacy policy, linked from the footer of each mailout. Admins write it like website.';
COMMENT ON COLUMN public.workspace.mailout_simulator_only IS
  'Bulk send (plan § 4): when true, queue_mailout refuses any address outside @simulator.amazonses.com. True in the playwright workspace. service_role only.';
COMMENT ON COLUMN public.workspace.mailout_daily_cap IS
  'ADR-110 § 6: how many mailout emails this workspace may send in any 24 hours; the rest waits in the queue. Set by Hour (service_role), not by the company.';
COMMENT ON COLUMN public.workspace.mailout_reviewed_at IS
  'ADR-110 § 6: when Marco approved this workspace''s first real mailout (mailout_approve_review). NULL = the next real mailout waits in review. service_role only.';

-- Hasta hoy `authenticated` tenía UPDATE a tabla entera (la policy
-- workspace_update deja al admin). Ahora por columnas: las de antes más
-- privacy_url. anon no tiene policy de escritura; se le quita también.
REVOKE UPDATE ON TABLE public.workspace FROM anon, authenticated;
GRANT UPDATE (
  id, slug, name, kind, country, timezone, settings, custom_fields, created_at,
  updated_at, deleted_at, previous_slugs, account_id, accent, description, domain,
  city, logo_url, alias, fiscal_identity_id, new_conversations_private, website,
  phone, mail_signature, privacy_url
) ON TABLE public.workspace TO authenticated;

-- El espacio de los tests no envía nunca fuera del simulador (plan § 11, fase 3).
UPDATE public.workspace SET mailout_simulator_only = true WHERE slug = 'playwright';

-- ── mail_domain: el dominio de envío de un espacio ────────────────────────
CREATE TABLE public.mail_domain (
  id                   uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id         uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  provider             public.mail_sending_provider NOT NULL DEFAULT 'simulator',
  domain               extensions.citext NOT NULL,
  mail_from_subdomain  text NOT NULL DEFAULT 'bounce',
  tenant_name          text,
  configuration_set    text,
  dkim_status          text NOT NULL DEFAULT 'NOT_STARTED',
  mail_from_status     text NOT NULL DEFAULT 'NOT_STARTED',
  dns_records          jsonb NOT NULL DEFAULT '[]'::jsonb,
  dmarc_record         text,
  last_error           text,
  checked_at           timestamptz,
  verified_at          timestamptz,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_domain_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT mail_domain_format
    CHECK (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' AND length(domain) <= 253),
  CONSTRAINT mail_domain_mail_from_format
    CHECK (mail_from_subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT mail_domain_dkim_status_check
    CHECK (dkim_status IN ('NOT_STARTED', 'PENDING', 'SUCCESS', 'FAILED', 'TEMPORARY_FAILURE')),
  CONSTRAINT mail_domain_mail_from_status_check
    CHECK (mail_from_status IN ('NOT_STARTED', 'PENDING', 'SUCCESS', 'FAILED', 'TEMPORARY_FAILURE')),
  CONSTRAINT mail_domain_verified_means_success
    CHECK (verified_at IS NULL OR (dkim_status = 'SUCCESS' AND mail_from_status = 'SUCCESS')),
  CONSTRAINT mail_domain_dns_records_array CHECK (jsonb_typeof(dns_records) = 'array'),
  CONSTRAINT mail_domain_text_lengths
    CHECK ((tenant_name IS NULL OR length(tenant_name) <= 64)
       AND (configuration_set IS NULL OR length(configuration_set) <= 64)
       AND (dmarc_record IS NULL OR length(dmarc_record) <= 2000)
       AND (last_error IS NULL OR length(last_error) <= 500))
);

COMMENT ON TABLE public.mail_domain IS
  'Bulk send (plan § 4): a workspace''s sending domain. Admins add and remove it (RPC); its status comes from the provider and only service_role writes it (mail_domain_record_status). provider = simulator sends nothing (ADR-111).';

-- Un dominio una vez por espacio. En SES una identidad es única por cuenta y
-- región: en la cuenta de Hour, un dominio pertenece a un solo espacio.
CREATE UNIQUE INDEX mail_domain_workspace_domain_key ON public.mail_domain (workspace_id, domain);
CREATE UNIQUE INDEX mail_domain_ses_domain_key ON public.mail_domain (domain) WHERE provider = 'ses';
CREATE INDEX mail_domain_created_by_idx ON public.mail_domain (created_by) WHERE created_by IS NOT NULL;

-- ── mailout: un envío ─────────────────────────────────────────────────────
CREATE TABLE public.mailout (
  id                        uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id              uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  project_id                uuid NOT NULL REFERENCES public.project(id) ON DELETE CASCADE,
  line_id                   uuid REFERENCES public.line(id) ON DELETE SET NULL,
  mail_domain_id            uuid,
  from_local_part           text NOT NULL DEFAULT 'difusion',
  from_name                 text,
  -- Resuelta al poner en cola: `local@dominio`.
  from_address              extensions.citext,
  reply_to_mail_account_id  uuid REFERENCES public.mail_account(id) ON DELETE SET NULL,
  reply_to_address          extensions.citext,
  language                  text NOT NULL DEFAULT 'es',
  subject                   text,
  body                      text,
  status                    public.mailout_status NOT NULL DEFAULT 'draft',
  status_reason             text,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  queued_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  queued_at                 timestamptz,
  reviewed_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at               timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailout_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT mailout_domain_fkey FOREIGN KEY (mail_domain_id, workspace_id)
    REFERENCES public.mail_domain (id, workspace_id) ON DELETE SET NULL (mail_domain_id),
  CONSTRAINT mailout_from_local_part_format
    CHECK (from_local_part ~ '^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$'),
  CONSTRAINT mailout_from_name_length CHECK (from_name IS NULL OR length(from_name) BETWEEN 1 AND 100),
  CONSTRAINT mailout_language_check CHECK (language IN ('es', 'ca', 'en', 'fr')),
  CONSTRAINT mailout_subject_length CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 200),
  CONSTRAINT mailout_body_length CHECK (body IS NULL OR length(body) BETWEEN 1 AND 20000),
  CONSTRAINT mailout_status_reason_length CHECK (status_reason IS NULL OR length(status_reason) <= 500),
  CONSTRAINT mailout_queued_has_content
    CHECK (status IN ('draft', 'cancelled')
           OR (subject IS NOT NULL AND body IS NOT NULL AND from_address IS NOT NULL AND queued_at IS NOT NULL))
);

COMMENT ON TABLE public.mailout IS
  'Bulk send (ADR-109, ADR-110): one email, written once, sent one by one to conversations of a project. Read with read:conversation, written by RPC with edit:conversation.';

CREATE INDEX mailout_workspace_idx ON public.mailout (workspace_id);
CREATE INDEX mailout_project_idx ON public.mailout (project_id);
CREATE INDEX mailout_line_idx ON public.mailout (line_id) WHERE line_id IS NOT NULL;
CREATE INDEX mailout_domain_idx ON public.mailout (mail_domain_id, workspace_id) WHERE mail_domain_id IS NOT NULL;
CREATE INDEX mailout_reply_to_idx ON public.mailout (reply_to_mail_account_id) WHERE reply_to_mail_account_id IS NOT NULL;
CREATE INDEX mailout_created_by_idx ON public.mailout (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX mailout_queued_by_idx ON public.mailout (queued_by) WHERE queued_by IS NOT NULL;
CREATE INDEX mailout_reviewed_by_idx ON public.mailout (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX mailout_active_idx ON public.mailout (status) WHERE status IN ('queued', 'sending');

-- ── mailout_recipient: cada destinatario y su correo ──────────────────────
CREATE TABLE public.mailout_recipient (
  id                     uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  mailout_id             uuid NOT NULL,
  workspace_id           uuid NOT NULL,
  conversation_id        uuid NOT NULL REFERENCES public.conversation(id) ON DELETE CASCADE,
  -- El contacto; NULL si va al correo genérico de la organización.
  person_id              uuid,
  address                extensions.citext,
  display_name           text,
  address_kind           public.mailout_address_kind,
  status                 public.mailout_recipient_status NOT NULL DEFAULT 'pending',
  skip_reason            public.mailout_skip_reason,
  -- La base al ponerlo en cola, copiada: la prueba no cambia si la base cambia.
  basis_kind             public.mail_basis_kind,
  attempts               integer NOT NULL DEFAULT 0,
  next_attempt_at        timestamptz,
  claimed_at             timestamptz,
  last_error             text,
  provider_message_id    text,
  rfc_message_id         text,
  conversation_event_id  uuid REFERENCES public.conversation_event(id) ON DELETE SET NULL,
  unsubscribe_token      text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  sent_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailout_recipient_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT mailout_recipient_mailout_fkey FOREIGN KEY (mailout_id, workspace_id)
    REFERENCES public.mailout (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mailout_recipient_person_fkey FOREIGN KEY (workspace_id, person_id)
    REFERENCES public.workspace_person (workspace_id, person_id) ON DELETE SET NULL (person_id),
  CONSTRAINT mailout_recipient_mailout_address_key UNIQUE (mailout_id, address),
  CONSTRAINT mailout_recipient_mailout_conversation_key UNIQUE (mailout_id, conversation_id),
  CONSTRAINT mailout_recipient_token_key UNIQUE (unsubscribe_token),
  CONSTRAINT mailout_recipient_address_format
    CHECK (address IS NULL OR (address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(address) <= 254)),
  CONSTRAINT mailout_recipient_address_kind_present CHECK ((address IS NULL) = (address_kind IS NULL)),
  CONSTRAINT mailout_recipient_skip_reason_matches CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CONSTRAINT mailout_recipient_sendable_has_address
    CHECK (status IN ('pending', 'skipped') OR (address IS NOT NULL AND basis_kind IS NOT NULL)),
  CONSTRAINT mailout_recipient_lengths
    CHECK ((display_name IS NULL OR length(display_name) <= 200)
       AND (last_error IS NULL OR length(last_error) <= 500)
       AND (provider_message_id IS NULL OR length(provider_message_id) <= 200)
       AND (rfc_message_id IS NULL OR length(rfc_message_id) <= 998)),
  CONSTRAINT mailout_recipient_attempts_check CHECK (attempts BETWEEN 0 AND 100)
);

COMMENT ON TABLE public.mailout_recipient IS
  'Bulk send: one recipient of a mailout and its email. The queue is this table (status queued + next_attempt_at, plan § 6). unsubscribe_token has no grant for authenticated.';

CREATE INDEX mailout_recipient_workspace_idx ON public.mailout_recipient (workspace_id);
CREATE INDEX mailout_recipient_conversation_idx ON public.mailout_recipient (conversation_id);
CREATE INDEX mailout_recipient_person_idx ON public.mailout_recipient (workspace_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX mailout_recipient_event_idx ON public.mailout_recipient (conversation_event_id) WHERE conversation_event_id IS NOT NULL;
CREATE INDEX mailout_recipient_queue_idx ON public.mailout_recipient (next_attempt_at) WHERE status = 'queued';
CREATE INDEX mailout_recipient_sending_idx ON public.mailout_recipient (claimed_at) WHERE status = 'sending';
CREATE INDEX mailout_recipient_sent_idx ON public.mailout_recipient (workspace_id, sent_at) WHERE sent_at IS NOT NULL;
CREATE INDEX mailout_recipient_provider_message_idx ON public.mailout_recipient (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ── mailout_event: lo que el proveedor dice de cada correo ────────────────
CREATE TABLE public.mailout_event (
  id                 uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  recipient_id       uuid NOT NULL,
  workspace_id       uuid NOT NULL,
  type               public.mailout_event_type NOT NULL,
  bounce_type        text,
  occurred_at        timestamptz NOT NULL,
  provider_event_id  text NOT NULL,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailout_event_recipient_fkey FOREIGN KEY (recipient_id, workspace_id)
    REFERENCES public.mailout_recipient (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mailout_event_provider_event_key UNIQUE (provider_event_id),
  CONSTRAINT mailout_event_bounce_type_check
    CHECK (bounce_type IS NULL OR bounce_type IN ('Permanent', 'Transient', 'Undetermined')),
  CONSTRAINT mailout_event_detail_object CHECK (jsonb_typeof(detail) = 'object'),
  CONSTRAINT mailout_event_provider_event_length CHECK (length(provider_event_id) BETWEEN 1 AND 200)
);

COMMENT ON TABLE public.mailout_event IS
  'Bulk send: delivery events from the provider (send, delivery, bounce, complaint...). No content. Idempotent by provider_event_id. service_role writes.';

CREATE INDEX mailout_event_recipient_idx ON public.mailout_event (recipient_id, workspace_id);
CREATE INDEX mailout_event_workspace_idx ON public.mailout_event (workspace_id);

-- ── mail_suppression: direcciones excluidas, por espacio ──────────────────
CREATE TABLE public.mail_suppression (
  workspace_id          uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  address               extensions.citext NOT NULL,
  reason                public.mail_suppression_reason NOT NULL,
  mailout_recipient_id  uuid REFERENCES public.mailout_recipient(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, address),
  CONSTRAINT mail_suppression_address_format
    CHECK (address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(address) <= 254)
);

COMMENT ON TABLE public.mail_suppression IS
  'Bulk send: addresses a workspace no longer writes to (unsubscribe, permanent bounce, complaint, manual). Per workspace. Admins read it; senders only see the reason per recipient (mailout_preview).';

CREATE INDEX mail_suppression_recipient_idx ON public.mail_suppression (mailout_recipient_id) WHERE mailout_recipient_id IS NOT NULL;
CREATE INDEX mail_suppression_created_by_idx ON public.mail_suppression (created_by) WHERE created_by IS NOT NULL;

-- ── mail_basis: por qué se puede escribir a una dirección ─────────────────
CREATE TABLE public.mail_basis (
  workspace_id       uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  address            extensions.citext NOT NULL,
  kind               public.mail_basis_kind NOT NULL,
  note               text,
  evidence_event_id  uuid REFERENCES public.conversation_event(id) ON DELETE SET NULL,
  recorded_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  withdrawn_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, address),
  CONSTRAINT mail_basis_address_format
    CHECK (address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(address) <= 254),
  CONSTRAINT mail_basis_note_length CHECK (note IS NULL OR length(note) BETWEEN 1 AND 1000),
  CONSTRAINT mail_basis_consent_has_note CHECK (kind <> 'consent' OR note IS NOT NULL)
);

COMMENT ON TABLE public.mail_basis IS
  'ADR-110 § 2: the basis for writing to an address (consent, prior relationship, the venue''s generic address). Without an active one, an address does not receive a mailout. Admins read the table; senders see it per recipient (mailout_preview).';

CREATE INDEX mail_basis_evidence_idx ON public.mail_basis (evidence_event_id) WHERE evidence_event_id IS NOT NULL;
CREATE INDEX mail_basis_recorded_by_idx ON public.mail_basis (recorded_by) WHERE recorded_by IS NOT NULL;

-- ── RLS, grants y triggers de las tablas nuevas ───────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mail_domain', 'mailout', 'mailout_recipient', 'mailout_event', 'mail_suppression', 'mail_basis'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id()',
      t || '_guard_ws', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['mail_domain', 'mailout', 'mailout_recipient', 'mail_basis'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.mail_domain, public.mailout, public.mailout_event,
  public.mail_suppression, public.mail_basis TO authenticated;
-- Por columnas A PROPÓSITO: el token de baja no existe para PostgREST.
GRANT SELECT (
  id, mailout_id, workspace_id, conversation_id, person_id, address, display_name,
  address_kind, status, skip_reason, basis_kind, attempts, next_attempt_at, last_error,
  provider_message_id, rfc_message_id, conversation_event_id, sent_at, created_at, updated_at
) ON TABLE public.mailout_recipient TO authenticated;

CREATE POLICY mail_domain_select ON public.mail_domain
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY mailout_select ON public.mailout
  FOR SELECT TO authenticated
  USING (public.has_permission(project_id, 'read:conversation'));

-- Hereda el envío y la conversación, con la RLS de quien llama: un destinatario
-- de una conversación privada ajena no se ve.
CREATE POLICY mailout_recipient_select ON public.mailout_recipient
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.mailout m WHERE m.id = mailout_recipient.mailout_id)
    AND EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = mailout_recipient.conversation_id)
  );

CREATE POLICY mailout_event_select ON public.mailout_event
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mailout_recipient r WHERE r.id = mailout_event.recipient_id));

CREATE POLICY mail_suppression_select ON public.mail_suppression
  FOR SELECT TO authenticated
  USING (public.is_workspace_admin(workspace_id));

CREATE POLICY mail_basis_select ON public.mail_basis
  FOR SELECT TO authenticated
  USING (public.is_workspace_admin(workspace_id));

-- ── Piezas internas ───────────────────────────────────────────────────────

-- El envío por id, si quien llama lo ve (y lo edita, si se pide). Mismo
-- 42501 para «no existe» y «no es tuyo».
CREATE FUNCTION private.mailout_for_caller(p_id uuid, p_edit boolean)
RETURNS public.mailout
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.mailout;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_row FROM public.mailout m
  JOIN public.project p ON p.id = m.project_id AND p.deleted_at IS NULL
  WHERE m.id = p_id;
  IF v_row.id IS NULL
     OR NOT public.has_permission(v_row.project_id,
              CASE WHEN p_edit THEN 'edit:conversation' ELSE 'read:conversation' END) THEN
    RAISE EXCEPTION 'mailout % not found', p_id USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

-- ¿Puede quien llama apuntar o retirar la base de esta dirección? Si edita
-- alguna conversación viva del espacio, que ve, cuyo contacto principal o cuya
-- organización tienen esa dirección. Devuelve cómo la conoce: 'contact',
-- 'organization' o NULL.
CREATE FUNCTION private.mail_address_kind_for_caller(p_workspace_id uuid, p_address extensions.citext)
RETURNS public.mailout_address_kind
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT CASE
    WHEN bool_or(x.kind = 'organization') THEN 'organization'::public.mailout_address_kind
    WHEN bool_or(x.kind = 'contact') THEN 'contact'::public.mailout_address_kind
  END
  FROM (
    SELECT 'contact' AS kind
    FROM public.conversation c
    JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
    JOIN public.workspace_person wp
      ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id AND wp.deleted_at IS NULL
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.private_to IS NULL OR c.private_to = auth.uid())
      AND wp.email = p_address
      AND public.has_permission(c.project_id, 'edit:conversation')
    UNION ALL
    SELECT 'organization'
    FROM public.conversation c
    JOIN public.workspace_organization o
      ON o.workspace_id = c.workspace_id AND o.id = c.organization_id AND o.deleted_at IS NULL
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.private_to IS NULL OR c.private_to = auth.uid())
      AND o.email = p_address
      AND public.has_permission(c.project_id, 'edit:conversation')
  ) x;
$$;

-- Cierra el envío cuando no le queda nada por enviar.
CREATE FUNCTION private.mailout_maybe_finish(p_mailout_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.mailout m
  SET status = 'done', finished_at = now()
  WHERE m.id = p_mailout_id
    AND m.status IN ('queued', 'sending')
    AND NOT EXISTS (
      SELECT 1 FROM public.mailout_recipient r
      WHERE r.mailout_id = m.id AND r.status IN ('pending', 'queued', 'sending')
    );
$$;

-- El correo enviado entra en el historial de su conversación (plan § 2): un
-- conversation_event email/outbound, idempotente por external_ref con el
-- mismo formato que la sincronización (`mail:<Message-ID>#<conversación>`),
-- para que la respuesta vuelva sola por la regla del hilo.
CREATE FUNCTION private.mailout_record_conversation_event(
  p_recipient public.mailout_recipient,
  p_body text
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
      'mailout_recipient_id', p_recipient.id,
      'rfc_message_id', p_recipient.rfc_message_id,
      'provider_message_id', p_recipient.provider_message_id,
      'subject', v_m.subject,
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

-- Una nota en la conversación por una baja, una vuelta o una queja. Sin texto:
-- la pantalla lo dice en su idioma a partir de metadata.mailout.
CREATE FUNCTION private.mailout_record_note(
  p_recipient public.mailout_recipient,
  p_what text
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.conversation_event (
    workspace_id, conversation_id, occurred_at, kind, source, provenance, metadata
  ) VALUES (
    p_recipient.workspace_id, p_recipient.conversation_id, statement_timestamp(), 'note', 'integration',
    jsonb_build_object('connector', 'mailout', 'mailout_id', p_recipient.mailout_id),
    jsonb_build_object('mailout', p_what, 'mailout_id', p_recipient.mailout_id,
                       'address', p_recipient.address::text)
  );
$$;

-- ── RPC de persona: dominios ──────────────────────────────────────────────

-- Alta de un dominio: fila sin verificar. El Worker habla después con el
-- proveedor y escribe el estado con mail_domain_record_status.
CREATE FUNCTION public.add_mail_domain(
  p_workspace_id uuid,
  p_domain       text,
  p_provider     public.mail_sending_provider DEFAULT 'simulator'
) RETURNS public.mail_domain
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_domain extensions.citext := lower(btrim(coalesce(p_domain, '')));
  v_row    public.mail_domain;
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
  INSERT INTO public.mail_domain (workspace_id, provider, domain, tenant_name, configuration_set, created_by)
  VALUES (p_workspace_id, coalesce(p_provider, 'simulator'), v_domain,
          'hour-' || p_workspace_id::text, 'hour-' || p_workspace_id::text, auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Baja de un dominio. No si un envío en marcha sale de él.
CREATE FUNCTION public.remove_mail_domain(p_id uuid)
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
             WHERE m.mail_domain_id = p_id AND m.status IN ('review', 'queued', 'sending', 'paused')) THEN
    RAISE EXCEPTION 'a mailout in progress uses this domain' USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.mail_domain WHERE id = p_id;
END;
$$;

-- ── RPC de persona: envíos ────────────────────────────────────────────────

CREATE FUNCTION public.create_mailout(
  p_project_id     uuid,
  p_line_id        uuid DEFAULT NULL,
  p_mail_domain_id uuid DEFAULT NULL
) RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ws  uuid;
  v_row public.mailout;
BEGIN
  SELECT p.workspace_id INTO v_ws FROM public.project p WHERE p.id = p_project_id AND p.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_ws IS NULL OR NOT public.has_permission(p_project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = '42501';
  END IF;
  IF p_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.line l WHERE l.id = p_line_id AND l.project_id = p_project_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'line % not found in this project', p_line_id USING ERRCODE = '22023';
  END IF;
  IF p_mail_domain_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mail_domain d WHERE d.id = p_mail_domain_id AND d.workspace_id = v_ws
  ) THEN
    RAISE EXCEPTION 'mail domain % not found', p_mail_domain_id USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mailout (workspace_id, project_id, line_id, mail_domain_id, from_name, created_by)
  VALUES (v_ws, p_project_id, p_line_id, p_mail_domain_id,
          (SELECT left(w.name, 100) FROM public.workspace w WHERE w.id = v_ws), auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Lo que se escribe del envío, solo en borrador. Llegan todos los campos.
CREATE FUNCTION public.update_mailout(
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
    SELECT 1 FROM public.mail_domain d WHERE d.id = p_mail_domain_id AND d.workspace_id = v_m.workspace_id
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

-- Los destinatarios de un borrador: sustituye la lista entera. Cada
-- conversación viva, del proyecto del envío y visible para quien llama (la
-- privada, solo si es suya); si una no lo es, nada cambia (42501). La
-- dirección no la manda el cliente: el contacto principal con email, si no el
-- correo genérico de la organización.
CREATE FUNCTION public.set_mailout_recipients(p_id uuid, p_conversation_ids uuid[])
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
    AND c.project_id = v_m.project_id
    AND (c.private_to IS NULL OR c.private_to = auth.uid());
  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'a conversation is not available for this mailout' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.mailout_recipient WHERE mailout_id = v_m.id;

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

-- Vista previa: por destinatario visible, la dirección, su base, si está
-- excluida (razón y fecha) y si está lista. No da la lista de supresión.
CREATE FUNCTION public.mailout_preview(p_id uuid)
RETURNS TABLE (
  recipient_id      uuid,
  conversation_id   uuid,
  address           text,
  display_name      text,
  address_kind      public.mailout_address_kind,
  status            public.mailout_recipient_status,
  skip_reason       public.mailout_skip_reason,
  basis_kind        public.mail_basis_kind,
  basis_withdrawn_at timestamptz,
  suppressed_reason public.mail_suppression_reason,
  suppressed_at     timestamptz,
  ready             boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m public.mailout := private.mailout_for_caller(p_id, false);
BEGIN
  RETURN QUERY
  SELECT r.id, r.conversation_id, r.address::text, r.display_name, r.address_kind, r.status, r.skip_reason,
         coalesce(r.basis_kind, b.kind), b.withdrawn_at, s.reason, s.created_at,
         (r.status = 'pending' AND s.address IS NULL AND b.kind IS NOT NULL AND b.withdrawn_at IS NULL)
  FROM public.mailout_recipient r
  JOIN public.conversation c
    ON c.id = r.conversation_id AND c.deleted_at IS NULL
   AND (c.private_to IS NULL OR c.private_to = auth.uid())
  LEFT JOIN public.mail_basis b ON b.workspace_id = r.workspace_id AND b.address = r.address
  LEFT JOIN public.mail_suppression s ON s.workspace_id = r.workspace_id AND s.address = r.address
  WHERE r.mailout_id = v_m.id
  ORDER BY r.created_at, r.id;
END;
$$;

-- La prueba solo va a quien la pide: devuelve el email de su login.
CREATE FUNCTION public.mailout_test_authorize(p_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m     public.mailout := private.mailout_for_caller(p_id, true);
  v_email text;
BEGIN
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'your login has no email address' USING ERRCODE = '22023';
  END IF;
  RETURN v_email;
END;
$$;

-- Poner en cola. Comprueba el dominio verificado, el contenido, el modo
-- simulador del espacio, y por destinatario la supresión y la base (los que
-- no pasan quedan `skipped` con su razón). Congela la lista. El primer envío
-- real de un espacio (proveedor `ses`, fuera del modo simulador) queda en
-- `review` hasta que Marco lo aprueba (ADR-110 punto 6).
CREATE FUNCTION public.queue_mailout(p_id uuid)
RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_m        public.mailout := private.mailout_for_caller(p_id, true);
  v_ws       public.workspace;
  v_domain   public.mail_domain;
  v_reply    public.mail_account;
  v_from     extensions.citext;
  v_ready    integer;
  v_row      public.mailout;
BEGIN
  SELECT * INTO v_m FROM public.mailout WHERE id = v_m.id FOR UPDATE;
  IF v_m.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft can be queued' USING ERRCODE = '22023';
  END IF;
  IF v_m.subject IS NULL OR v_m.body IS NULL THEN
    RAISE EXCEPTION 'subject and body are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_domain FROM public.mail_domain
  WHERE id = v_m.mail_domain_id AND workspace_id = v_m.workspace_id;
  IF v_domain.id IS NULL OR v_domain.verified_at IS NULL THEN
    RAISE EXCEPTION 'the sending domain is not verified' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_m.workspace_id;

  -- Quien pone en cola tiene que ver cada conversación que recibe: la que se
  -- borró después, o la privada de otra persona que la puso en la lista,
  -- queda fuera (`unavailable`).
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'unavailable'
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation c
      WHERE c.id = r.conversation_id AND c.deleted_at IS NULL
        AND (c.private_to IS NULL OR c.private_to = auth.uid())
    );

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
  WHERE r.mailout_id = v_m.id AND r.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address
                      AND b.withdrawn_at IS NULL);

  UPDATE public.mailout_recipient r
  SET status = 'queued', next_attempt_at = now(),
      basis_kind = (SELECT b.kind FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address)
  WHERE r.mailout_id = v_m.id AND r.status = 'pending';
  GET DIAGNOSTICS v_ready = ROW_COUNT;
  IF v_ready = 0 THEN
    RAISE EXCEPTION 'no recipient can receive this mailout' USING ERRCODE = '22023';
  END IF;

  -- Respuestas: el buzón elegido si sigue activo; si no, el común del
  -- espacio; si no, el personal de quien envía; si no, el remitente.
  SELECT * INTO v_reply FROM public.mail_account a
  WHERE a.workspace_id = v_m.workspace_id AND a.status = 'active'
    AND (a.scope = 'workspace' OR a.owner_user_id = auth.uid())
  ORDER BY (a.id = v_m.reply_to_mail_account_id) DESC NULLS LAST, (a.scope = 'workspace') DESC, a.created_at
  LIMIT 1;
  v_from := (v_m.from_local_part || '@' || v_domain.domain::text)::extensions.citext;

  UPDATE public.mailout
  SET status = CASE
        WHEN v_domain.provider = 'ses' AND NOT v_ws.mailout_simulator_only AND v_ws.mailout_reviewed_at IS NULL
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

-- Cancelar: lo que falta por salir queda `skipped (cancelled)`; lo que ya
-- está saliendo termina.
CREATE FUNCTION public.cancel_mailout(p_id uuid)
RETURNS public.mailout
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_m   public.mailout := private.mailout_for_caller(p_id, true);
  v_row public.mailout;
BEGIN
  IF v_m.status IN ('done', 'cancelled') THEN
    RAISE EXCEPTION 'this mailout is already finished' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mailout_recipient
  SET status = 'skipped', skip_reason = 'cancelled'
  WHERE mailout_id = v_m.id AND status IN ('pending', 'queued');
  UPDATE public.mailout SET status = 'cancelled', finished_at = now()
  WHERE id = v_m.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ── RPC de persona: base y supresión ──────────────────────────────────────

-- Apuntar la base de una dirección. Quien edita alguna conversación de esa
-- dirección. `consent` pide nota; `generic` solo vale para el correo de una
-- organización. Vuelve a dejarla vigente si se había retirado; no levanta
-- una exclusión.
CREATE FUNCTION public.set_mail_basis(
  p_workspace_id      uuid,
  p_address           text,
  p_kind              public.mail_basis_kind,
  p_note              text DEFAULT NULL,
  p_evidence_event_id uuid DEFAULT NULL
) RETURNS public.mail_basis
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_kind    public.mailout_address_kind;
  v_row     public.mail_basis;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  v_kind := private.mail_address_kind_for_caller(p_workspace_id, v_address);
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'address not found' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'kind is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'consent' AND v_note IS NULL THEN
    RAISE EXCEPTION 'a consent basis needs a note saying how and when' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'generic' AND v_kind <> 'organization' THEN
    RAISE EXCEPTION 'a generic basis is only for an organization''s address' USING ERRCODE = '22023';
  END IF;
  IF length(v_note) > 1000 THEN
    RAISE EXCEPTION 'note is too long' USING ERRCODE = '22023';
  END IF;
  IF p_evidence_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation_event e
    JOIN public.conversation c ON c.id = e.conversation_id AND c.deleted_at IS NULL
     AND (c.private_to IS NULL OR c.private_to = auth.uid())
    WHERE e.id = p_evidence_event_id AND e.workspace_id = p_workspace_id
      AND public.has_permission(c.project_id, 'read:conversation')
  ) THEN
    RAISE EXCEPTION 'evidence event not found' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mail_basis (workspace_id, address, kind, note, evidence_event_id, recorded_by)
  VALUES (p_workspace_id, v_address, p_kind, v_note, p_evidence_event_id, auth.uid())
  ON CONFLICT (workspace_id, address) DO UPDATE
  SET kind = EXCLUDED.kind, note = EXCLUDED.note, evidence_event_id = EXCLUDED.evidence_event_id,
      recorded_by = EXCLUDED.recorded_by, recorded_at = now(), withdrawn_at = NULL
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.withdraw_mail_basis(p_workspace_id uuid, p_address text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
BEGIN
  IF auth.uid() IS NULL
     OR (private.mail_address_kind_for_caller(p_workspace_id, v_address) IS NULL
         AND NOT public.is_workspace_admin(p_workspace_id)) THEN
    RAISE EXCEPTION 'address not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.mail_basis SET withdrawn_at = coalesce(withdrawn_at, now())
  WHERE workspace_id = p_workspace_id AND address = v_address;
END;
$$;

-- Excluir a mano una dirección (admin).
CREATE FUNCTION public.suppress_mail_address(p_workspace_id uuid, p_address text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  IF v_address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_address) > 254 THEN
    RAISE EXCEPTION 'address is not valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mail_suppression (workspace_id, address, reason, created_by)
  VALUES (p_workspace_id, v_address, 'manual', auth.uid())
  ON CONFLICT (workspace_id, address) DO NOTHING;
END;
$$;

-- Quitar una exclusión (admin): solo las manuales y los rebotes. Una baja o
-- un «spam» solo los deshace la persona, desde la página de baja.
CREATE FUNCTION public.remove_mail_suppression(p_workspace_id uuid, p_address text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_address extensions.citext := lower(btrim(coalesce(p_address, '')));
  v_reason  public.mail_suppression_reason;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace admin required' USING ERRCODE = '42501';
  END IF;
  SELECT reason INTO v_reason FROM public.mail_suppression
  WHERE workspace_id = p_workspace_id AND address = v_address FOR UPDATE;
  IF v_reason IS NULL THEN
    RETURN;
  END IF;
  IF v_reason NOT IN ('manual', 'bounce') THEN
    RAISE EXCEPTION 'only the person can undo an unsubscribe or a spam report' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.mail_suppression WHERE workspace_id = p_workspace_id AND address = v_address;
END;
$$;

-- ── RPC públicas por token (anon) ─────────────────────────────────────────

-- Baja en un clic. Un token que no existe no hace nada y no se distingue.
-- Idempotente: la segunda vez no cambia nada ni deja otra nota.
CREATE FUNCTION public.mailout_unsubscribe(p_token text)
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

-- Deshacer la propia baja (o el «spam») desde la página de baja: la base pasa
-- a consentimiento con su nota.
CREATE FUNCTION public.mailout_resubscribe(p_token text)
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

-- ── RPC de máquina (solo service_role) ────────────────────────────────────

-- El estado del dominio que dice el proveedor (o el simulador). Verificado
-- solo cuando DKIM y MAIL FROM están en SUCCESS.
CREATE FUNCTION public.mail_domain_record_status(
  p_id                uuid,
  p_dkim_status       text,
  p_mail_from_status  text,
  p_dns_records       jsonb DEFAULT NULL,
  p_dmarc_record      text DEFAULT NULL,
  p_error             text DEFAULT NULL
) RETURNS public.mail_domain
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.mail_domain;
BEGIN
  UPDATE public.mail_domain
  SET dkim_status = p_dkim_status,
      mail_from_status = p_mail_from_status,
      dns_records = coalesce(p_dns_records, dns_records),
      dmarc_record = left(p_dmarc_record, 2000),
      last_error = left(p_error, 500),
      checked_at = now(),
      verified_at = CASE
        WHEN p_dkim_status = 'SUCCESS' AND p_mail_from_status = 'SUCCESS' THEN coalesce(verified_at, now())
      END
  WHERE id = p_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'mail domain % not found', p_id USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END;
$$;

-- Marco aprueba el primer envío real de un espacio: el envío pasa a la cola
-- y el espacio queda revisado.
CREATE FUNCTION public.mailout_approve_review(p_mailout_id uuid, p_reviewed_by uuid DEFAULT NULL)
RETURNS public.mailout
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.mailout;
BEGIN
  UPDATE public.mailout
  SET status = 'queued', reviewed_at = now(), reviewed_by = p_reviewed_by
  WHERE id = p_mailout_id AND status = 'review'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'mailout % is not waiting for review', p_mailout_id USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace
  SET mailout_reviewed_at = coalesce(mailout_reviewed_at, now()),
      mailout_reviewed_by = coalesce(mailout_reviewed_by, p_reviewed_by)
  WHERE id = v_row.workspace_id;
  RETURN v_row;
END;
$$;

-- Toma de la cola hasta p_limit correos: destinatarios `queued` que tocan, de
-- envíos en marcha con el dominio verificado, sin pasar del tope diario de
-- cada espacio (en las últimas 24 horas, contando los que están saliendo) y
-- repartiendo entre espacios (plan § 6). Antes vuelve a mirar supresión y
-- base, y devuelve a la cola los arriendos caducados (15 minutos). Con
-- p_mailout_id, solo de ese envío: la primera pasada nada más ponerlo en cola.
CREATE FUNCTION public.mailout_claim(p_limit integer DEFAULT 50, p_mailout_id uuid DEFAULT NULL)
RETURNS TABLE (
  recipient_id       uuid,
  mailout_id         uuid,
  workspace_id       uuid,
  conversation_id    uuid,
  address            text,
  display_name       text,
  address_kind       public.mailout_address_kind,
  basis_kind         public.mail_basis_kind,
  unsubscribe_token  text,
  attempts           integer,
  provider           public.mail_sending_provider,
  tenant_name        text,
  configuration_set  text,
  from_address       text,
  from_name          text,
  reply_to_address   text,
  language           text,
  subject            text,
  body               text
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
  SET status = 'skipped', skip_reason = 'suppressed'
  WHERE r.status = 'queued'
    AND EXISTS (SELECT 1 FROM public.mail_suppression s
                WHERE s.workspace_id = r.workspace_id AND s.address = r.address);
  UPDATE public.mailout_recipient r
  SET status = 'skipped', skip_reason = 'no_basis'
  WHERE r.status = 'queued'
    AND NOT EXISTS (SELECT 1 FROM public.mail_basis b
                    WHERE b.workspace_id = r.workspace_id AND b.address = r.address
                      AND b.withdrawn_at IS NULL);

  RETURN QUERY
  WITH cand AS (
    SELECT r.id, r.workspace_id,
           row_number() OVER (PARTITION BY r.workspace_id ORDER BY r.next_attempt_at, r.id) AS rn
    FROM public.mailout_recipient r
    JOIN public.mailout m ON m.id = r.mailout_id AND m.status IN ('queued', 'sending')
    JOIN public.mail_domain d ON d.id = m.mail_domain_id AND d.verified_at IS NOT NULL
    WHERE r.status = 'queued' AND r.next_attempt_at <= now()
      AND (p_mailout_id IS NULL OR r.mailout_id = p_mailout_id)
  ),
  budget AS (
    SELECT w.id,
           greatest(w.mailout_daily_cap - (
             SELECT count(*) FROM public.mailout_recipient x
             WHERE x.workspace_id = w.id
               AND (x.status = 'sending' OR x.sent_at > now() - interval '24 hours')
           ), 0) AS remaining
    FROM public.workspace w
    WHERE w.id IN (SELECT c.workspace_id FROM cand c)
  ),
  pick AS (
    SELECT c.id FROM cand c JOIN budget b ON b.id = c.workspace_id
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
         m.from_address::text, m.from_name, m.reply_to_address::text, m.language, m.subject, m.body
  FROM claimed c
  JOIN public.mailout m ON m.id = c.mailout_id
  JOIN public.mail_domain d ON d.id = m.mail_domain_id;
END;
$$;

-- El proveedor aceptó el correo: `sent`, el evento en la conversación y
-- last_contacted_at, en una transacción. Idempotente.
CREATE FUNCTION public.mailout_record_sent(
  p_recipient_id        uuid,
  p_provider_message_id text,
  p_rfc_message_id      text,
  p_body                text
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
  IF v_r.status IN ('sent', 'delivered', 'bounced', 'complained') AND v_r.conversation_event_id IS NOT NULL THEN
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
  UPDATE public.mailout_recipient
  SET conversation_event_id = private.mailout_record_conversation_event(v_r, p_body)
  WHERE id = v_r.id
  RETURNING * INTO v_r;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN v_r;
END;
$$;

-- Fallo al enviar: con p_retry_at vuelve a la cola entonces (hasta 5
-- intentos); sin él, o pasado el quinto, `failed`.
CREATE FUNCTION public.mailout_record_failure(
  p_recipient_id uuid,
  p_error        text,
  p_retry_at     timestamptz DEFAULT NULL
) RETURNS public.mailout_recipient
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_r public.mailout_recipient;
BEGIN
  UPDATE public.mailout_recipient
  SET status = CASE WHEN p_retry_at IS NOT NULL AND attempts < 5 THEN 'queued' ELSE 'failed' END::public.mailout_recipient_status,
      next_attempt_at = CASE WHEN p_retry_at IS NOT NULL AND attempts < 5 THEN p_retry_at ELSE next_attempt_at END,
      claimed_at = NULL,
      last_error = left(p_error, 500)
  WHERE id = p_recipient_id AND status IN ('sending', 'queued')
  RETURNING * INTO v_r;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'recipient % is not being sent', p_recipient_id USING ERRCODE = '22023';
  END IF;
  PERFORM private.mailout_maybe_finish(v_r.mailout_id);
  RETURN v_r;
END;
$$;

-- Un evento del proveedor (o del simulador). Idempotente por
-- provider_event_id. p_payload: { provider_event_id, recipient_id? |
-- provider_message_id?, type, bounce_type?, occurred_at?, detail? }.
-- Devuelve false si ya estaba o si no casa con ningún destinatario.
CREATE FUNCTION public.mailout_record_event(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event_id text := nullif(btrim(coalesce(p_payload ->> 'provider_event_id', '')), '');
  v_type     public.mailout_event_type := (p_payload ->> 'type')::public.mailout_event_type;
  v_bounce   text := nullif(p_payload ->> 'bounce_type', '');
  v_r        public.mailout_recipient;
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
    RETURN false;
  END IF;

  INSERT INTO public.mailout_event (recipient_id, workspace_id, type, bounce_type, occurred_at, provider_event_id, detail)
  VALUES (v_r.id, v_r.workspace_id, v_type, v_bounce,
          least(coalesce((p_payload ->> 'occurred_at')::timestamptz, now()), now()),
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
    UPDATE public.mailout_recipient
    SET conversation_event_id = private.mailout_record_conversation_event(v_r, NULL)
    WHERE id = v_r.id;
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
    UPDATE public.mail_basis SET withdrawn_at = now()
    WHERE workspace_id = v_r.workspace_id AND address = v_r.address AND withdrawn_at IS NULL;
    PERFORM private.mailout_record_note(v_r, 'complained');
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
    'private.mailout_for_caller(uuid, boolean)',
    'private.mail_address_kind_for_caller(uuid, extensions.citext)',
    'private.mailout_maybe_finish(uuid)',
    'private.mailout_record_conversation_event(public.mailout_recipient, text)',
    'private.mailout_record_note(public.mailout_recipient, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;

  -- De persona: authenticated.
  FOREACH f IN ARRAY ARRAY[
    'public.add_mail_domain(uuid, text, public.mail_sending_provider)',
    'public.remove_mail_domain(uuid)',
    'public.create_mailout(uuid, uuid, uuid)',
    'public.update_mailout(uuid, text, text, text, text, text, uuid, uuid)',
    'public.set_mailout_recipients(uuid, uuid[])',
    'public.mailout_preview(uuid)',
    'public.mailout_test_authorize(uuid)',
    'public.queue_mailout(uuid)',
    'public.cancel_mailout(uuid)',
    'public.set_mail_basis(uuid, text, public.mail_basis_kind, text, uuid)',
    'public.withdraw_mail_basis(uuid, text)',
    'public.suppress_mail_address(uuid, text)',
    'public.remove_mail_suppression(uuid, text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;

  -- Por token: anon y authenticated (la página de baja no pide sesión).
  FOREACH f IN ARRAY ARRAY[
    'public.mailout_unsubscribe(text)',
    'public.mailout_resubscribe(text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;

  -- De máquina: solo service_role (frontera ampliada por ADR-110).
  FOREACH f IN ARRAY ARRAY[
    'public.mail_domain_record_status(uuid, text, text, jsonb, text, text)',
    'public.mailout_approve_review(uuid, uuid)',
    'public.mailout_claim(integer, uuid)',
    'public.mailout_record_sent(uuid, text, text, text)',
    'public.mailout_record_failure(uuid, text, timestamptz)',
    'public.mailout_record_event(jsonb)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;
