-- ADR-189 · Importar un chat de WhatsApp (tarea 128): el núcleo del esquema
-- del ADR-188, recortado a lo que pide la importación.
--
-- Qué añade:
--   1. `channel_chat`: el chat importado, de quien lo importa. Directo o grupo,
--      título, «No es de trabajo» (`excluded`) y la atadura a un bolo (con
--      caducidad) o a una conversación. `channel_chat_member` recuerda quién es
--      quién (el nombre del export y su persona) para la siguiente importación.
--   2. `channel_message`: cada mensaje UNA vez (ADR-188 § 1), con su huella
--      única por espacio: el mismo chat exportado por dos personas o desde dos
--      teléfonos no entra dos veces. Remitente resuelto (o «número sin
--      nombre»), dirección, hora, cuerpo y adjuntos por nombre.
--   3. `message_placement`: dónde aparece (ADR-188 § 2): en una conversación
--      (con marca de bolo opcional) o en el tablón de un bolo. Estado
--      `placed | guess`, motivo y candidatos. Auditado (`write_audit`), sin
--      cuerpo (ADR-100).
--   4. `conversation_event.channel_message_id`: la colocación en una
--      conversación ES su evento (`source='whatsapp'`, `kind='message'`,
--      `metadata.via='whatsapp'`), sin cuerpo: el cuerpo vive en el mensaje.
--      El turno, «se enfría» y el último contacto no cambian.
--   5. RLS: un mensaje lo ve quien lo importó y la audiencia de cada sitio
--      donde está colocado (ADR-188 § 10). Escribe sólo la RPC.
--   6. `whatsapp_import_lookup` (huellas conocidas, chats propios que las
--      comparten, personas del equipo), `whatsapp_import_context` (personas,
--      conversaciones que quien importa edita, contactos con fechas, bolos) e
--      `import_whatsapp_chat` (escribe en tandas de hasta 1000). La huella la
--      calcula la base (`private.whatsapp_fingerprint`); la privacidad de un
--      chat con una sola persona más, y los topes, también se miran aquí.
--   7. `conversation_feed`: cuerpo vivo de 20261104170000 (md5 de prosrc
--      31d7d47c… comprobado contra la base viva el 2026-11-07), misma firma
--      de 19. Único cambio: lo que importó quien mira (`source='whatsapp'`
--      con su `created_by`) no le cuenta como no leído, como lo que apunta a
--      mano.
--
-- ADITIVA según § 34: tablas y funciones nuevas, una columna nullable y un
-- CREATE OR REPLACE con la misma firma. El Worker desplegado no las mira.
-- Rollback: build/runbooks/rollback-20261108-whatsapp-import.sql.

-- ── 1 · El chat ──────────────────────────────────────────────────────────────
CREATE TABLE public.channel_chat (
  id                    uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id          uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  owner_user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  channel               text NOT NULL DEFAULT 'whatsapp',
  kind                  text NOT NULL,
  title                 text,
  excluded              boolean NOT NULL DEFAULT false,
  bound_conversation_id uuid REFERENCES public.conversation (id) ON DELETE SET NULL,
  bound_bolo_id         uuid REFERENCES public.bolo (id) ON DELETE SET NULL,
  -- Hasta qué día cae lo nuevo en el bolo (ADR-188 § 9): el siguiente a la última función.
  bound_until           date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_chat_channel CHECK (channel IN ('whatsapp')),
  CONSTRAINT channel_chat_kind CHECK (kind IN ('direct', 'group')),
  CONSTRAINT channel_chat_title_length CHECK (title IS NULL OR length(title) <= 200),
  CONSTRAINT channel_chat_one_binding CHECK (num_nonnulls(bound_conversation_id, bound_bolo_id) <= 1),
  CONSTRAINT channel_chat_until_bolo CHECK (bound_until IS NULL OR bound_bolo_id IS NOT NULL)
);
COMMENT ON TABLE public.channel_chat IS
  'ADR-188/189: a chat brought from a channel (today: a WhatsApp export), owned by who brought it. A direct chat or a group; excluded = «No es de trabajo»; bound to a bolo (until the day after its last performance) or to a conversation. Written only by import_whatsapp_chat.';
CREATE INDEX channel_chat_workspace_owner_idx ON public.channel_chat (workspace_id, owner_user_id);
CREATE INDEX channel_chat_bound_conversation_idx ON public.channel_chat (bound_conversation_id) WHERE bound_conversation_id IS NOT NULL;
CREATE INDEX channel_chat_bound_bolo_idx ON public.channel_chat (bound_bolo_id) WHERE bound_bolo_id IS NOT NULL;

CREATE TABLE public.channel_chat_member (
  chat_id   uuid NOT NULL REFERENCES public.channel_chat (id) ON DELETE CASCADE,
  -- Como sale en el export: el nombre en la agenda de quien exportó, o el número.
  label     text NOT NULL,
  person_id uuid REFERENCES public.person (id) ON DELETE SET NULL,
  -- El nombre que se enseña: el de su dossier, o el del export.
  name      text NOT NULL,
  is_self   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (chat_id, label),
  CONSTRAINT channel_chat_member_label_length CHECK (length(label) BETWEEN 1 AND 200),
  CONSTRAINT channel_chat_member_name_length CHECK (length(name) BETWEEN 1 AND 200)
);
COMMENT ON TABLE public.channel_chat_member IS
  'ADR-189: who is who in an imported chat (export label → person), kept for the next import of the same chat.';
CREATE INDEX channel_chat_member_person_idx ON public.channel_chat_member (person_id) WHERE person_id IS NOT NULL;

-- ── 2 · El mensaje, una vez ─────────────────────────────────────────────────
CREATE TABLE public.channel_message (
  id               uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id     uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  chat_id          uuid NOT NULL REFERENCES public.channel_chat (id) ON DELETE CASCADE,
  fingerprint      text NOT NULL,
  occurred_at      timestamptz NOT NULL,
  direction        public.conversation_event_direction NOT NULL,
  sender_label     text NOT NULL,
  sender_person_id uuid REFERENCES public.person (id) ON DELETE SET NULL,
  sender_name      text NOT NULL,
  body             text,
  -- attachments: [{type, name}], edited.
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT channel_message_fingerprint_hex CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
  CONSTRAINT channel_message_body_length CHECK (body IS NULL OR length(body) <= 20000),
  CONSTRAINT channel_message_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT channel_message_fingerprint_key UNIQUE (workspace_id, fingerprint)
);
COMMENT ON TABLE public.channel_message IS
  'ADR-188 § 1, ADR-189: a message from a channel, stored once. fingerprint (minute, text, order among equals) is unique per workspace: a chat imported twice, or by two people, does not enter twice. Seen by who brought it and by the audience of every live placement. Written only by import_whatsapp_chat.';
CREATE INDEX channel_message_chat_idx ON public.channel_message (chat_id, occurred_at);
CREATE INDEX channel_message_sender_idx ON public.channel_message (sender_person_id) WHERE sender_person_id IS NOT NULL;
CREATE INDEX channel_message_created_by_idx ON public.channel_message (created_by);

-- ── 3 · Dónde aparece ───────────────────────────────────────────────────────
CREATE TABLE public.message_placement (
  id              uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  workspace_id    uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,
  message_id      uuid NOT NULL REFERENCES public.channel_message (id) ON DELETE CASCADE,
  -- Quien es dueño del mensaje (copia de channel_message.created_by): la
  -- política lo lee sin releer el mensaje.
  owner_user_id   uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  surface         text NOT NULL,
  conversation_id uuid REFERENCES public.conversation (id) ON DELETE CASCADE,
  bolo_id         uuid REFERENCES public.bolo (id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'placed',
  reason          text NOT NULL,
  candidates      uuid[] NOT NULL DEFAULT '{}',
  placed_by       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT message_placement_surface CHECK (surface IN ('conversation', 'bolo_team')),
  CONSTRAINT message_placement_shape CHECK (
    (surface = 'conversation' AND conversation_id IS NOT NULL)
    OR (surface = 'bolo_team' AND conversation_id IS NULL AND bolo_id IS NOT NULL)),
  CONSTRAINT message_placement_state CHECK (state IN ('placed', 'guess')),
  CONSTRAINT message_placement_reason CHECK (
    reason IN ('thread', 'burst', 'chat_binding', 'single_candidate', 'most_recent', 'person_choice'))
);
COMMENT ON TABLE public.message_placement IS
  'ADR-188 § 2: where a message appears. conversation: in its record (bolo_id = «habla de este bolo», does not widen the audience); bolo_team: on the bolo board. state guess = placed among several candidates, «Por colocar» will ask. Audited; never carries the body.';
CREATE UNIQUE INDEX message_placement_live_key
  ON public.message_placement (message_id, surface, coalesce(conversation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE removed_at IS NULL;
CREATE INDEX message_placement_conversation_idx ON public.message_placement (conversation_id) WHERE conversation_id IS NOT NULL AND removed_at IS NULL;
CREATE INDEX message_placement_bolo_idx ON public.message_placement (bolo_id, surface) WHERE bolo_id IS NOT NULL AND removed_at IS NULL;
CREATE INDEX message_placement_owner_idx ON public.message_placement (owner_user_id);

-- El chat NO se audita: `write_audit` copiaría la fila con su título (el
-- nombre de una persona o de un grupo) a `audit_log`, que leen los admins.
-- Lo que se audita es la colocación (dónde aparece qué mensaje), sin cuerpo.
CREATE TRIGGER message_placement_audit
AFTER INSERT OR DELETE OR UPDATE ON public.message_placement
FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── 4 · El evento apunta al mensaje ─────────────────────────────────────────
ALTER TABLE public.conversation_event
  ADD COLUMN channel_message_id uuid REFERENCES public.channel_message (id) ON DELETE SET NULL;
CREATE INDEX conversation_event_channel_message_idx
  ON public.conversation_event (channel_message_id) WHERE channel_message_id IS NOT NULL;
COMMENT ON COLUMN public.conversation_event.channel_message_id IS
  'ADR-188/189: the placement of a channel message in this conversation. The body lives in the message (body is NULL here).';

-- ── 5 · Quién lo ve ─────────────────────────────────────────────────────────
-- La audiencia de un sitio: la conversación (con su privacidad) o el tablón
-- del bolo (el General, como post_message).
CREATE FUNCTION private.placement_site_readable(p_conversation_id uuid, p_bolo_id uuid, p_surface text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_user_id IS NOT NULL AND CASE
    WHEN p_surface = 'conversation' THEN private.can_read_conversation(p_conversation_id, p_user_id)
    WHEN p_surface = 'bolo_team' THEN private.can_read_container_thread('bolo', p_bolo_id, NULL, p_user_id)
    ELSE false
  END;
$$;

-- Un mensaje: quien lo trajo, o la audiencia de alguna colocación viva. Lee
-- las colocaciones sin su RLS (sin recursión entre las dos políticas).
CREATE FUNCTION private.channel_message_readable_by_caller(p_message_id uuid, p_owner uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_owner = (SELECT auth.uid())
      OR EXISTS (
           SELECT 1 FROM public.message_placement mp
           WHERE mp.message_id = p_message_id AND mp.removed_at IS NULL
             AND private.placement_site_readable(mp.conversation_id, mp.bolo_id, mp.surface, (SELECT auth.uid())));
$$;

CREATE FUNCTION private.message_placement_readable_by_caller(
  p_owner uuid, p_conversation_id uuid, p_bolo_id uuid, p_surface text, p_removed_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_owner = (SELECT auth.uid())
      OR (p_removed_at IS NULL
          AND private.placement_site_readable(p_conversation_id, p_bolo_id, p_surface, (SELECT auth.uid())));
$$;

REVOKE ALL ON FUNCTION private.placement_site_readable(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.channel_message_readable_by_caller(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.message_placement_readable_by_caller(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC;
-- Las políticas corren como quien llama: sólo los envoltorios que leen
-- auth.uid() dentro tienen EXECUTE (patrón de thread_readable_by_caller).
GRANT EXECUTE ON FUNCTION private.channel_message_readable_by_caller(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.message_placement_readable_by_caller(uuid, uuid, uuid, text, timestamptz) TO authenticated;

ALTER TABLE public.channel_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_chat FORCE ROW LEVEL SECURITY;
ALTER TABLE public.channel_chat_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_chat_member FORCE ROW LEVEL SECURITY;
ALTER TABLE public.channel_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_message FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_placement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_placement FORCE ROW LEVEL SECURITY;

ALTER TABLE public.channel_chat OWNER TO postgres;
ALTER TABLE public.channel_chat_member OWNER TO postgres;
ALTER TABLE public.channel_message OWNER TO postgres;
ALTER TABLE public.message_placement OWNER TO postgres;

REVOKE ALL ON TABLE public.channel_chat, public.channel_chat_member, public.channel_message, public.message_placement FROM PUBLIC, anon;
-- Sólo lectura, a tabla entera; se escribe por la RPC.
GRANT SELECT ON TABLE public.channel_chat, public.channel_chat_member, public.channel_message, public.message_placement TO authenticated;
GRANT ALL ON TABLE public.channel_chat, public.channel_chat_member, public.channel_message, public.message_placement TO service_role;

-- El chat (título, quién es quién) es de quien lo importó.
CREATE POLICY channel_chat_select ON public.channel_chat
  FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY channel_chat_member_select ON public.channel_chat_member
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.channel_chat ch WHERE ch.id = channel_chat_member.chat_id));
CREATE POLICY channel_message_select ON public.channel_message
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND private.channel_message_readable_by_caller(id, created_by));
CREATE POLICY message_placement_select ON public.message_placement
  FOR SELECT TO authenticated
  USING (private.message_placement_readable_by_caller(owner_user_id, conversation_id, bolo_id, surface, removed_at));

-- ── 6 · Las RPC de la importación ───────────────────────────────────────────

-- Lo que hay ya en el espacio de este chat: qué huellas están (sólo la huella,
-- sin contenido: quien pregunta ya tiene el texto), qué chats propios las
-- comparten (el mismo chat importado antes, con su quién es quién) y qué
-- personas son del equipo (un chat 1 a 1 con ellas no se importa).
CREATE FUNCTION public.whatsapp_import_lookup(p_workspace_id uuid, p_fingerprints text[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT private.model_has_workspace_role(
       p_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_fingerprints), 0) > 20000 THEN
    RAISE EXCEPTION 'too many fingerprints' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    -- Sólo lo que quien llama ya ve: lo suyo y lo colocado donde lee. Lo que
    -- trajo otro sin colocar no se anuncia; si lo vuelve a importar, la
    -- huella choca y se escriben sus colocaciones.
    'known', coalesce((
      SELECT jsonb_agg(m.fingerprint)
      FROM public.channel_message m
      WHERE m.workspace_id = p_workspace_id AND m.fingerprint = ANY (p_fingerprints) AND m.deleted_at IS NULL
        AND (m.created_by = v_caller
             OR EXISTS (SELECT 1 FROM public.message_placement mp
                        WHERE mp.message_id = m.id AND mp.removed_at IS NULL
                          AND private.placement_site_readable(mp.conversation_id, mp.bolo_id, mp.surface, v_caller)))
    ), '[]'::jsonb),
    'chats', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ch.id, 'title', ch.title, 'kind', ch.kind,
               'bound_bolo_id', ch.bound_bolo_id, 'bound_conversation_id', ch.bound_conversation_id,
               'members', coalesce((
                 SELECT jsonb_agg(jsonb_build_object('label', mb.label, 'person_id', mb.person_id, 'is_self', mb.is_self))
                 FROM public.channel_chat_member mb WHERE mb.chat_id = ch.id), '[]'::jsonb))
             ORDER BY ch.updated_at DESC)
      FROM public.channel_chat ch
      WHERE ch.workspace_id = p_workspace_id AND ch.owner_user_id = v_caller
        AND EXISTS (SELECT 1 FROM public.channel_message m
                    WHERE m.chat_id = ch.id AND m.fingerprint = ANY (p_fingerprints))
    ), '[]'::jsonb),
    'team', coalesce((
      SELECT jsonb_agg(DISTINCT up.person_id)
      FROM public.membership mb
      JOIN public.user_profile up ON up.user_id = mb.user_id
      WHERE mb.workspace_id = p_workspace_id AND mb.level = 'workspace'
        AND mb.accepted_at IS NOT NULL AND up.person_id IS NOT NULL
    ), '[]'::jsonb),
    'me', (SELECT jsonb_build_object('person_id', up.person_id, 'name', up.full_name)
           FROM public.user_profile up WHERE up.user_id = v_caller)
  );
END;
$$;
COMMENT ON FUNCTION public.whatsapp_import_lookup(uuid, text[]) IS
  'ADR-189: for an import being reviewed on the device: which fingerprints the workspace already has (no content), the caller''s own chats sharing them, the workspace team''s persons and the caller''s profile. Owner, admin or member.';
REVOKE ALL ON FUNCTION public.whatsapp_import_lookup(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_import_lookup(uuid, text[]) TO authenticated;

-- El primer y el último día de un bolo (sin canceladas). `performance.bolo_id`
-- no tiene grant de lectura; sólo se llama sobre un bolo que quien llama ya
-- lee (la RLS de `bolo` filtra antes), y sólo da dos fechas.
CREATE FUNCTION private.bolo_days(p_bolo_id uuid, OUT first_day date, OUT last_day date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT min(pf.performed_at), max(pf.performed_at)
  FROM public.performance pf
  WHERE pf.bolo_id = p_bolo_id AND pf.deleted_at IS NULL AND pf.status::text <> 'cancelled';
$$;
REVOKE ALL ON FUNCTION private.bolo_days(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.bolo_days(uuid) TO authenticated;

-- Con qué se decide dónde va, con la RLS de quien importa: sus personas (con
-- número), las conversaciones vivas que edita, sus contactos con fechas
-- (ADR-102) y los bolos de esas conversaciones con su primer y último día.
CREATE FUNCTION public.whatsapp_import_context(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH convs AS (
    SELECT c.id, c.project_id, c.last_contacted_at, c.organization_id
    FROM public.conversation c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND public.has_permission(c.project_id, 'edit:conversation')
  )
  SELECT jsonb_build_object(
    'persons', coalesce((
      SELECT jsonb_agg(jsonb_build_object('person_id', wp.person_id, 'name', wp.full_name, 'phone', wp.phone) ORDER BY wp.full_name)
      FROM public.workspace_person wp
      WHERE wp.workspace_id = p_workspace_id AND wp.deleted_at IS NULL AND wp.full_name IS NOT NULL
    ), '[]'::jsonb),
    'conversations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id,
               'title', coalesce(o.name, pc.full_name, '?'),
               'project_name', p.name,
               'last_contacted_at', c.last_contacted_at))
      FROM convs c
      LEFT JOIN public.project p ON p.id = c.project_id
      LEFT JOIN public.workspace_organization o ON o.id = c.organization_id AND o.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT wp.full_name
        FROM public.conversation_contact cc
        JOIN public.workspace_person wp ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
        WHERE cc.conversation_id = c.id AND cc.is_primary
        LIMIT 1
      ) pc ON true
    ), '[]'::jsonb),
    'contacts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('conversation_id', cc.conversation_id, 'person_id', cc.person_id,
                                          'since', cc.since, 'until', cc.until))
      FROM public.conversation_contact cc
      WHERE cc.conversation_id IN (SELECT id FROM convs)
    ), '[]'::jsonb),
    'bolos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', b.id, 'conversation_id', b.conversation_id, 'project_name', p.name,
               'venue_name', b.venue_name, 'city', b.city,
               'start_day', (b.created_at AT TIME ZONE 'UTC')::date,
               'first_day', pd.first_day, 'last_day', pd.last_day))
      FROM public.bolo b
      LEFT JOIN public.project p ON p.id = b.project_id
      CROSS JOIN LATERAL private.bolo_days(b.id) pd
      WHERE b.workspace_id = p_workspace_id AND b.deleted_at IS NULL
        AND (pd.last_day IS NULL OR pd.last_day >= current_date - 400)
    ), '[]'::jsonb)
  );
$$;
COMMENT ON FUNCTION public.whatsapp_import_context(uuid) IS
  'ADR-189: what deciding where an imported chat goes needs, under the caller''s RLS: persons (with phone), live conversations the caller edits, their contacts with dates (ADR-102) and the bolos with first and last day.';
REVOKE ALL ON FUNCTION public.whatsapp_import_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_import_context(uuid) TO authenticated;

-- La huella de un mensaje, en la base (no se fía de la del cliente; ADR-189 § 3):
-- el minuto en UTC, el texto en NFC con los espacios ASCII juntados, los tipos
-- de lo adjunto y el orden entre iguales; SHA-256, 32 hex. `$lib/wa-import`
-- (`fingerprintKey`) calcula lo mismo en el dispositivo para preguntar qué ya está.
CREATE FUNCTION private.whatsapp_fingerprint(p_at timestamptz, p_body text, p_types text, p_n integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT left(encode(extensions.digest(
    to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') || '|' ||
    btrim(regexp_replace(normalize(coalesce(p_body, ''), NFC),
                         '[ ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || ']+', ' ', 'g'), ' ') || '|' ||
    coalesce(p_types, '') || '|' || p_n::text,
    'sha256'), 'hex'), 32);
$$;
REVOKE ALL ON FUNCTION private.whatsapp_fingerprint(timestamptz, text, text, integer) FROM PUBLIC;

-- Escribe una tanda de una importación. Idempotente por huella, que calcula
-- la base: lo que ya estaba no se vuelve a guardar, pero las colocaciones de
-- quien llama se escriben igual (otra persona pudo traerlo antes sin sitio).
-- Colocar es publicar (ADR-188 § 10): pide editar la conversación, o leer el
-- tablón del bolo (como post_message). La dirección la dice quién es quién.
-- Un chat con una sola persona más (sea cual sea `kind`) no puede ser con
-- alguien del equipo; un chat directo pide que esa persona sea alguien.
-- El último contacto se mueve una vez por conversación y tanda.
--   p_chat     {id?, kind, title?, bound_bolo_id?, bound_conversation_id?, bound_until?}
--   p_members  [{label, person_id?, name, is_self}]
--   p_messages [{n, at, label, body?, attachments? (≤20), edited?,
--                placements (≤4): [{surface, conversation_id?, bolo_id?, state, reason, candidates?}]}]
CREATE FUNCTION public.import_whatsapp_chat(
  p_workspace_id uuid,
  p_chat         jsonb,
  p_members      jsonb,
  p_messages     jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_now      timestamptz := now();
  v_chat     public.channel_chat;
  v_chat_id  uuid := nullif(p_chat ->> 'id', '')::uuid;
  v_kind     text := p_chat ->> 'kind';
  v_title    text := nullif(btrim(left(coalesce(p_chat ->> 'title', ''), 200)), '');
  v_bbolo    uuid := nullif(p_chat ->> 'bound_bolo_id', '')::uuid;
  v_bconv    uuid := nullif(p_chat ->> 'bound_conversation_id', '')::uuid;
  v_buntil   date := nullif(p_chat ->> 'bound_until', '')::date;
  v_mb       jsonb;
  v_m        jsonb;
  v_p        jsonb;
  v_member   public.channel_chat_member;
  v_other    public.channel_chat_member;
  v_others   int;
  v_at       timestamptz;
  v_body     text;
  v_types    text;
  v_n        int;
  v_fp       text;
  v_msg      public.channel_message;
  v_new      boolean;
  v_conv     public.conversation;
  v_bolo     public.bolo;
  v_ok_conv  uuid[] := '{}';
  v_ok_bolo  uuid[] := '{}';
  v_conv_id  uuid;
  v_mark     uuid;
  v_state    text;
  v_reason   text;
  v_created  int := 0;
  v_skipped  int := 0;
  v_placed   int := 0;
BEGIN
  IF v_caller IS NULL OR NOT private.model_has_workspace_role(
       p_workspace_id, v_caller, ARRAY['owner', 'admin', 'member']::public.membership_role[]) THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = '42501';
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('direct', 'group') THEN
    RAISE EXCEPTION 'chat kind must be direct or group' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_members) <> 'array' OR jsonb_typeof(p_messages) <> 'array' THEN
    RAISE EXCEPTION 'members and messages must be arrays' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_messages) > 1000 OR jsonb_array_length(p_members) > 300 THEN
    RAISE EXCEPTION 'too many messages or members in one call' USING ERRCODE = '22023';
  END IF;

  -- La atadura: un bolo vivo de este espacio cuyo tablón lees, o una
  -- conversación viva que editas.
  IF v_bbolo IS NOT NULL AND v_bconv IS NOT NULL THEN
    RAISE EXCEPTION 'a chat binds to a bolo or to a conversation, not both' USING ERRCODE = '22023';
  END IF;
  IF v_bbolo IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.bolo b WHERE b.id = v_bbolo AND b.workspace_id = p_workspace_id AND b.deleted_at IS NULL
         AND private.can_read_container_thread('bolo', b.id, NULL, v_caller)) THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  IF v_bconv IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.conversation c WHERE c.id = v_bconv AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
         AND public.has_permission(c.project_id, 'edit:conversation')) THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = '42501';
  END IF;
  IF v_bbolo IS NULL THEN v_buntil := NULL; END IF;

  -- El chat: uno propio ya importado, o nuevo.
  IF v_chat_id IS NOT NULL THEN
    SELECT * INTO v_chat FROM public.channel_chat
    WHERE id = v_chat_id AND workspace_id = p_workspace_id AND owner_user_id = v_caller
    FOR UPDATE;
    IF v_chat.id IS NULL THEN
      RAISE EXCEPTION 'chat not found' USING ERRCODE = '42501';
    END IF;
    IF v_chat.excluded THEN
      RAISE EXCEPTION 'this chat is marked as not work' USING ERRCODE = '22023';
    END IF;
    UPDATE public.channel_chat
    SET kind = v_kind, title = coalesce(v_title, title),
        bound_bolo_id = v_bbolo, bound_conversation_id = v_bconv, bound_until = v_buntil,
        updated_at = now()
    WHERE id = v_chat.id
    RETURNING * INTO v_chat;
  ELSE
    INSERT INTO public.channel_chat (workspace_id, owner_user_id, kind, title, bound_bolo_id, bound_conversation_id, bound_until)
    VALUES (p_workspace_id, v_caller, v_kind, v_title, v_bbolo, v_bconv, v_buntil)
    RETURNING * INTO v_chat;
  END IF;

  -- Quién es quién: cada persona, del espacio.
  FOR v_mb IN SELECT * FROM jsonb_array_elements(p_members) LOOP
    IF nullif(btrim(coalesce(v_mb ->> 'label', '')), '') IS NULL THEN
      RAISE EXCEPTION 'a member needs its label' USING ERRCODE = '22023';
    END IF;
    IF nullif(v_mb ->> 'person_id', '') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.workspace_person wp
         WHERE wp.workspace_id = p_workspace_id AND wp.person_id = (v_mb ->> 'person_id')::uuid AND wp.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'person not found' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.channel_chat_member (chat_id, label, person_id, name, is_self)
    VALUES (v_chat.id, btrim(left(v_mb ->> 'label', 200)), nullif(v_mb ->> 'person_id', '')::uuid,
            coalesce(nullif(btrim(left(v_mb ->> 'name', 200)), ''), btrim(left(v_mb ->> 'label', 200))),
            coalesce((v_mb ->> 'is_self')::boolean, false))
    ON CONFLICT (chat_id, label) DO UPDATE
    SET person_id = excluded.person_id, name = excluded.name, is_self = excluded.is_self;
  END LOOP;

  IF (SELECT count(*) FROM public.channel_chat_member WHERE chat_id = v_chat.id AND is_self) > 1 THEN
    RAISE EXCEPTION 'only one member is you' USING ERRCODE = '22023';
  END IF;

  -- Privacidad en la base, no en el cliente (ADR-188 § 8, ADR-189 § 7): con
  -- una sola persona más, sea cual sea `kind`, no puede ser del equipo; un
  -- chat directo pide exactamente una persona más y que sea alguien.
  SELECT count(*) INTO v_others FROM public.channel_chat_member WHERE chat_id = v_chat.id AND NOT is_self;
  IF v_others = 1 THEN
    SELECT * INTO v_other FROM public.channel_chat_member WHERE chat_id = v_chat.id AND NOT is_self;
    IF v_other.person_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_profile up
         JOIN public.membership ms ON ms.user_id = up.user_id AND ms.workspace_id = p_workspace_id
                                  AND ms.level = 'workspace' AND ms.accepted_at IS NOT NULL
         WHERE up.person_id = v_other.person_id) THEN
      RAISE EXCEPTION 'a direct chat with your own team is talked in Hour' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_kind = 'direct' AND (v_others <> 1 OR v_other.person_id IS NULL) THEN
    RAISE EXCEPTION 'a direct chat needs the other person to be someone in Hour' USING ERRCODE = '22023';
  END IF;

  FOR v_m IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
    v_at := (v_m ->> 'at')::timestamptz;
    IF v_at IS NULL OR v_at > statement_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'occurred_at is missing or in the future' USING ERRCODE = '22023';
    END IF;
    v_n := coalesce((v_m ->> 'n')::int, 0);
    IF v_n < 1 OR v_n > 10000 THEN
      RAISE EXCEPTION 'a message needs its order among equals' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(coalesce(v_m -> 'attachments', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(v_m -> 'attachments', '[]'::jsonb)) > 20
       OR jsonb_typeof(coalesce(v_m -> 'placements', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(v_m -> 'placements', '[]'::jsonb)) > 4 THEN
      RAISE EXCEPTION 'at most 20 attachments and 4 placements per message' USING ERRCODE = '22023';
    END IF;
    IF length(coalesce(v_m ->> 'body', '')) > 20000 THEN
      RAISE EXCEPTION 'body too long' USING ERRCODE = '22023';
    END IF;
    v_body := nullif(btrim(coalesce(v_m ->> 'body', '')), '');
    SELECT coalesce(string_agg(left(a ->> 'type', 20), ',' ORDER BY ord), '') INTO v_types
    FROM jsonb_array_elements(coalesce(v_m -> 'attachments', '[]'::jsonb)) WITH ORDINALITY AS t(a, ord);
    v_fp := private.whatsapp_fingerprint(v_at, v_m ->> 'body', v_types, v_n);

    SELECT * INTO v_member FROM public.channel_chat_member
    WHERE chat_id = v_chat.id AND label = btrim(left(coalesce(v_m ->> 'label', ''), 200));
    IF v_member.chat_id IS NULL THEN
      RAISE EXCEPTION 'a message from someone not in the chat' USING ERRCODE = '22023';
    END IF;

    v_msg := NULL;
    INSERT INTO public.channel_message (
      workspace_id, chat_id, fingerprint, occurred_at, direction,
      sender_label, sender_person_id, sender_name, body, metadata, created_by
    ) VALUES (
      p_workspace_id, v_chat.id, v_fp, v_at,
      CASE WHEN v_member.is_self THEN 'outbound' ELSE 'inbound' END::public.conversation_event_direction,
      v_member.label, v_member.person_id, v_member.name, v_body,
      jsonb_strip_nulls(jsonb_build_object(
        'attachments', CASE WHEN v_types <> ''
                            THEN (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                           'type', left(a ->> 'type', 20), 'name', left(a ->> 'name', 200))))
                                  FROM jsonb_array_elements(v_m -> 'attachments') a) END,
        'edited', CASE WHEN (v_m ->> 'edited') = 'true' THEN true END)),
      v_caller
    )
    ON CONFLICT (workspace_id, fingerprint) DO NOTHING
    RETURNING * INTO v_msg;

    v_new := v_msg.id IS NOT NULL;
    IF v_new THEN
      v_created := v_created + 1;
    ELSE
      -- Ya estaba (lo trajo antes quien llama u otra persona): no se vuelve a
      -- guardar, pero sus colocaciones sí se escriben.
      SELECT * INTO v_msg FROM public.channel_message
      WHERE workspace_id = p_workspace_id AND fingerprint = v_fp;
      v_skipped := v_skipped + 1;
    END IF;

    FOR v_p IN SELECT * FROM jsonb_array_elements(coalesce(v_m -> 'placements', '[]'::jsonb)) LOOP
      v_state := coalesce(v_p ->> 'state', 'placed');
      v_reason := coalesce(v_p ->> 'reason', 'person_choice');
      IF v_state NOT IN ('placed', 'guess')
         OR v_reason NOT IN ('chat_binding', 'single_candidate', 'most_recent', 'person_choice') THEN
        RAISE EXCEPTION 'bad placement state or reason' USING ERRCODE = '22023';
      END IF;

      IF v_p ->> 'surface' = 'conversation' THEN
        v_conv_id := nullif(v_p ->> 'conversation_id', '')::uuid;
        IF v_conv_id IS NULL OR NOT v_conv_id = ANY (v_ok_conv) THEN
          SELECT * INTO v_conv FROM public.conversation
          WHERE id = v_conv_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
          FOR UPDATE;
          IF v_conv.id IS NULL OR NOT public.has_permission(v_conv.project_id, 'edit:conversation') THEN
            RAISE EXCEPTION 'conversation not found' USING ERRCODE = '42501';
          END IF;
          v_ok_conv := array_append(v_ok_conv, v_conv.id);
        END IF;
        -- Ya colocado aquí: nada que hacer.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.message_placement mp
          WHERE mp.message_id = v_msg.id AND mp.surface = 'conversation'
            AND mp.conversation_id = v_conv_id AND mp.removed_at IS NULL);
        -- La marca de bolo, sólo un bolo de esa conversación.
        v_mark := nullif(v_p ->> 'bolo_id', '')::uuid;
        IF v_mark IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.bolo b WHERE b.id = v_mark AND b.conversation_id = v_conv_id AND b.deleted_at IS NULL) THEN
          v_mark := NULL;
        END IF;

        INSERT INTO public.message_placement (
          workspace_id, message_id, owner_user_id, surface, conversation_id, bolo_id, state, reason, candidates, placed_by)
        VALUES (
          p_workspace_id, v_msg.id, v_msg.created_by, 'conversation', v_conv_id, v_mark, v_state, v_reason,
          CASE WHEN v_state = 'guess' AND jsonb_typeof(v_p -> 'candidates') = 'array'
               THEN ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(v_p -> 'candidates') x LIMIT 20)
               ELSE '{}' END,
          v_caller);

        INSERT INTO public.conversation_event (
          workspace_id, conversation_id, occurred_at, kind, source, direction,
          body, participants, provenance, external_ref, metadata, created_by, channel_message_id
        ) VALUES (
          p_workspace_id, v_conv_id, v_msg.occurred_at, 'message', 'whatsapp', v_msg.direction,
          NULL, '[]'::jsonb,
          jsonb_build_object('connector', 'whatsapp_import'),
          'wa:' || v_fp || '#' || v_conv_id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'via', 'whatsapp',
            'chat_id', v_msg.chat_id,
            'placement', CASE WHEN v_state = 'guess' THEN 'guess' END,
            'bolo_id', v_mark)),
          v_caller, v_msg.id
        )
        ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL DO NOTHING;

      ELSIF v_p ->> 'surface' = 'bolo_team' THEN
        SELECT * INTO v_bolo FROM public.bolo
        WHERE id = nullif(v_p ->> 'bolo_id', '')::uuid AND workspace_id = p_workspace_id AND deleted_at IS NULL;
        IF v_bolo.id IS NULL OR NOT (v_bolo.id = ANY (v_ok_bolo)
                                     OR private.can_read_container_thread('bolo', v_bolo.id, NULL, v_caller)) THEN
          RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
        END IF;
        v_ok_bolo := array_append(v_ok_bolo, v_bolo.id);
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.message_placement mp
          WHERE mp.message_id = v_msg.id AND mp.surface = 'bolo_team' AND mp.removed_at IS NULL);
        INSERT INTO public.message_placement (
          workspace_id, message_id, owner_user_id, surface, bolo_id, state, reason, placed_by)
        VALUES (p_workspace_id, v_msg.id, v_msg.created_by, 'bolo_team', v_bolo.id, 'placed', v_reason, v_caller);
      ELSE
        RAISE EXCEPTION 'placement surface must be conversation or bolo_team' USING ERRCODE = '22023';
      END IF;
      v_placed := v_placed + 1;
    END LOOP;
  END LOOP;

  -- El último contacto, una vez por conversación: lo que esta tanda colocó.
  UPDATE public.conversation c
  SET last_contacted_at = greatest(coalesce(c.last_contacted_at, e.last_at), e.last_at),
      first_contacted_at = coalesce(c.first_contacted_at, e.first_at)
  FROM (
    SELECT ce.conversation_id, max(ce.occurred_at) AS last_at, min(ce.occurred_at) AS first_at
    FROM public.conversation_event ce
    WHERE ce.conversation_id = ANY (v_ok_conv) AND ce.source = 'whatsapp'
      AND ce.created_by = v_caller AND ce.recorded_at = v_now
    GROUP BY ce.conversation_id
  ) e
  WHERE c.id = e.conversation_id;

  RETURN jsonb_build_object('chat_id', v_chat.id, 'created', v_created, 'skipped', v_skipped, 'placed', v_placed);
END;
$$;
COMMENT ON FUNCTION public.import_whatsapp_chat(uuid, jsonb, jsonb, jsonb) IS
  'ADR-189: writes one batch (up to 1000) of an imported WhatsApp chat. The fingerprint is computed here (private.whatsapp_fingerprint); a message already stored is not stored again, but the caller''s placements are written. Placing in a conversation needs edit:conversation and writes its conversation_event (source whatsapp, no body, channel_message_id); placing on a bolo board needs reading it (like post_message). A chat with one other person who is on the team is refused whatever its kind; a direct chat needs that person to be someone. last_contacted_at moves once per conversation and batch. Owner, admin or member.';
REVOKE ALL ON FUNCTION public.import_whatsapp_chat(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_whatsapp_chat(uuid, jsonb, jsonb, jsonb) TO authenticated;

-- ── 7 · conversation_feed: lo importado por quien mira no le cuenta como nuevo ──
CREATE OR REPLACE FUNCTION public.conversation_feed(
  p_workspace_ids   uuid[]  DEFAULT NULL,
  p_project_ids     uuid[]  DEFAULT NULL,
  p_tag             text    DEFAULT NULL,
  p_q               text    DEFAULT NULL,
  p_limit           int     DEFAULT 100,
  p_list            boolean DEFAULT false,
  p_offset          int     DEFAULT 0,
  p_order           text    DEFAULT NULL,
  p_relation        text    DEFAULT NULL,
  p_line            text    DEFAULT NULL,
  p_season          boolean DEFAULT false,
  p_season_line_ids uuid[]  DEFAULT NULL,
  p_turn            text    DEFAULT NULL,
  p_temp            text    DEFAULT NULL,
  p_mailout_id      uuid    DEFAULT NULL,
  p_mailout_pick    text    DEFAULT NULL,
  p_ids_only        boolean DEFAULT false,
  p_kind            text    DEFAULT NULL,
  p_city            text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_all     boolean := coalesce(cardinality(p_workspace_ids), 0) = 0
                   AND coalesce(cardinality(p_project_ids), 0) = 0;
  v_tag     text := nullif(btrim(coalesce(p_tag, '')), '');
  v_q       text := lower(nullif(btrim(coalesce(p_q, '')), ''));
  v_limit   int  := greatest(1, least(coalesce(p_limit, 100), 500));
  v_list    boolean := coalesce(p_list, false);
  v_offset  int  := greatest(0, coalesce(p_offset, 0));
  v_ids     boolean := coalesce(p_ids_only, false);
  v_season  boolean := coalesce(p_season, false);
  v_sort    text;
  v_line_id uuid;
  v_mailout public.mailout;
  v_pick    text;
  v_total   int := 0;
  v_convs   boolean;
  v_threads boolean;
  v_items   jsonb := '[]'::jsonb;
  v_n       int := 0;
  v_more    boolean := false;
  v_extra   jsonb;
  v_city    text := lower(nullif(btrim(coalesce(p_city, '')), ''));
  v_place   boolean;
  rec       record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_tag = 'all' THEN
    v_tag := NULL;
  END IF;
  IF v_tag IS NOT NULL AND v_tag <> 'team' AND v_tag !~ '^[a-z][a-z0-9_]{1,31}$' THEN
    RAISE EXCEPTION 'invalid tag %', v_tag USING ERRCODE = '22023';
  END IF;

  -- Lo de la lista solo va con la lista: el feed de Todas no cambia.
  IF NOT v_list AND (v_offset <> 0 OR p_order IS NOT NULL OR p_relation IS NOT NULL
                     OR p_line IS NOT NULL OR v_season OR p_season_line_ids IS NOT NULL OR p_turn IS NOT NULL
                     OR p_temp IS NOT NULL OR p_mailout_id IS NOT NULL OR p_mailout_pick IS NOT NULL OR v_ids
                     OR p_kind IS NOT NULL OR p_city IS NOT NULL) THEN
    RAISE EXCEPTION 'list filters need p_list' USING ERRCODE = '22023';
  END IF;
  IF v_list AND v_tag = 'team' THEN
    RAISE EXCEPTION 'the list has no team threads' USING ERRCODE = '22023';
  END IF;
  IF p_order IS NOT NULL AND p_order NOT IN ('pide', 'movimiento', 'paso', 'nombre', 'ciudad') THEN
    RAISE EXCEPTION 'invalid order %', p_order USING ERRCODE = '22023';
  END IF;
  -- El tipo (ADR-177 § 2): una clave de `workspace_organization.kind` salvo
  -- 'other', que nunca se enseña, o 'solo' (la organización que es una sola
  -- persona y se llama como ella, ADR-177 § 3).
  IF p_kind IS NOT NULL
     AND p_kind NOT IN ('company', 'festival', 'theatre', 'presenter', 'agency', 'institution', 'solo') THEN
    RAISE EXCEPTION 'invalid kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_city IS NOT NULL AND v_city IS NULL THEN
    RAISE EXCEPTION 'invalid city' USING ERRCODE = '22023';
  END IF;
  IF p_relation IS NOT NULL AND p_relation NOT IN ('never', 'contacted', 'talking', 'regular', 'dormant', 'not_now') THEN
    RAISE EXCEPTION 'invalid relation %', p_relation USING ERRCODE = '22023';
  END IF;
  IF p_turn IS NOT NULL AND p_turn NOT IN ('nuestro', 'suyo') THEN
    RAISE EXCEPTION 'invalid turn %', p_turn USING ERRCODE = '22023';
  END IF;
  IF p_temp IS NOT NULL AND p_temp NOT IN ('caliente', 'fria', 'ronda', 'parada', 'sin-fecha') THEN
    RAISE EXCEPTION 'invalid temperature %', p_temp USING ERRCODE = '22023';
  END IF;
  IF p_mailout_pick IS NOT NULL AND (p_mailout_id IS NULL
       OR p_mailout_pick NOT IN ('todos', 'respuestas', 'sin-respuesta', 'rebotes')) THEN
    RAISE EXCEPTION 'invalid mailout pick %', p_mailout_pick USING ERRCODE = '22023';
  END IF;
  IF p_line IS NOT NULL THEN
    IF p_line ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      v_line_id := p_line::uuid;
    ELSIF p_line <> 'sin' THEN
      RAISE EXCEPTION 'invalid line %', p_line USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_mailout_id IS NOT NULL THEN
    -- La puerta de `mailout_preview`: un envío que no lees es 42501.
    v_mailout := private.mailout_for_caller(p_mailout_id, false);
    v_pick := coalesce(p_mailout_pick, 'todos');
  END IF;


  -- El orden: el feed de Todas el de siempre; la lista el del menú, o el de su
  -- bloque (applyListFilter: la temperatura manda sobre el turno; «sin fecha»
  -- no ordena).
  v_sort := CASE
    WHEN NOT v_list THEN 'feed'
    WHEN p_temp = 'caliente' THEN 'hot'
    WHEN p_temp IN ('fria', 'ronda', 'parada') THEN 'cold'
    WHEN p_turn = 'nuestro' THEN 'due'
    WHEN p_turn = 'suyo' THEN 'theirs'
    WHEN p_temp = 'sin-fecha' THEN 'id'
    ELSE coalesce(p_order, 'pide')
  END;

  -- Tipo, «por libre» y ciudad solo se calculan en las candidatas cuando
  -- filtran u ordenan; la fila de la página los lleva siempre (abajo).
  v_place := p_kind IS NOT NULL OR v_city IS NOT NULL OR v_sort = 'ciudad';

  v_convs   := v_tag IS DISTINCT FROM 'team';
  v_threads := NOT v_list AND (v_tag IS NULL OR v_tag = 'team');

  -- Las candidatas, ya en su orden: el corte por espacio, el alcance, la
  -- etiqueta, la búsqueda y los filtros, con lo que ordena. La regla de lectura
  -- NO va aquí: corre abajo, fila a fila y en este orden (en el feed, hasta
  -- llenar la página; en la lista, en todas, para contar el total).
  FOR rec IN
    WITH ws AS MATERIALIZED (
      -- Toda lectura de conversaciones e hilos exige ser miembro aceptado del
      -- espacio (`model_has_permission`, `thread_feed`).
      SELECT m.workspace_id
      FROM public.membership m
      WHERE m.level = 'workspace' AND m.user_id = v_caller AND m.accepted_at IS NOT NULL
    ),
    conv_cand AS (
      SELECT c.id, c.workspace_id, c.project_id, c.line_id, c.created_at,
             c.last_contacted_at, c.next_action_at, c.next_action_note, c.reply_settled_at,
             c.not_now_at, c.not_now_until,
             c.organization_id, c.first_contacted_at, c.contacted_undated,
             c.custom_fields->>'legacy_status' AS legacy_status
      FROM public.conversation c
      JOIN ws ON ws.workspace_id = c.workspace_id
      WHERE v_convs
        AND c.deleted_at IS NULL
        AND (v_all
             OR c.workspace_id = ANY (coalesce(p_workspace_ids, '{}'))
             OR c.project_id = ANY (coalesce(p_project_ids, '{}')))
        -- La etiqueta acota; nunca abre (la regla va después, con AND).
        AND (v_tag IS NULL
             OR EXISTS (
                  SELECT 1 FROM public.conversation_tagging g
                  JOIN public.conversation_tag t ON t.id = g.tag_id
                  WHERE g.conversation_id = c.id AND t.key = v_tag)
             OR (v_tag = 'sales'
                 AND NOT EXISTS (SELECT 1 FROM public.conversation_tagging g WHERE g.conversation_id = c.id)))
        AND (v_q IS NULL
             OR EXISTS (
                  SELECT 1 FROM public.workspace_organization o
                  WHERE o.workspace_id = c.workspace_id AND o.id = c.organization_id
                    AND strpos(lower(o.name), v_q) > 0)
             OR EXISTS (
                  SELECT 1
                  FROM public.conversation_contact cc
                  JOIN public.workspace_person wp
                    ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
                   AND wp.deleted_at IS NULL
                  WHERE cc.conversation_id = c.id
                    AND (strpos(lower(wp.full_name), v_q) > 0
                         OR strpos(lower(coalesce(wp.email::text, '')), v_q) > 0))
             OR EXISTS (
                  SELECT 1 FROM public.project p
                  WHERE p.id = c.project_id AND strpos(lower(coalesce(p.name, p.slug)), v_q) > 0)
             OR EXISTS (
                  SELECT 1 FROM public.line l
                  WHERE l.id = c.line_id AND strpos(lower(l.name), v_q) > 0))
        -- Los filtros de la lista que no leen el historial.
        AND (p_line IS NULL
             OR (v_line_id IS NULL AND c.line_id IS NULL)
             OR c.line_id = v_line_id)
        AND (NOT v_season
             OR coalesce(cardinality(p_season_line_ids), 0) = 0
             OR c.line_id = ANY (p_season_line_ids))
        -- La temporada: sin funciones que quien llama lea, o con una en ella.
        AND (NOT v_season
             OR NOT EXISTS (
                  SELECT 1 FROM public.performance pf
                  WHERE pf.conversation_id = c.id AND pf.deleted_at IS NULL AND pf.status <> 'cancelled'
                    AND (public.has_permission(pf.project_id, 'read:performance')
                         OR private.performance_readable_through_chain_by_caller(pf.id)))
             OR EXISTS (
                  SELECT 1 FROM public.performance pf
                  WHERE pf.conversation_id = c.id AND pf.deleted_at IS NULL AND pf.status <> 'cancelled'
                    -- La temporada en curso del espacio de la conversación (tarea 78).
                    AND pf.performed_at >= private.workspace_season_start(c.workspace_id, current_date)
                    AND pf.performed_at < (private.workspace_season_start(c.workspace_id, current_date) + interval '1 year')::date
                    AND (public.has_permission(pf.project_id, 'read:performance')
                         OR private.performance_readable_through_chain_by_caller(pf.id))))
        -- El envío: solo quien lo recibió (la tanda exacta, abajo).
        AND (p_mailout_id IS NULL
             OR EXISTS (SELECT 1 FROM public.mailout_recipient mr
                        WHERE mr.mailout_id = v_mailout.id AND mr.conversation_id = c.id))
    ),
    conv_rows AS (
      SELECT c.*,
             lt.direction AS last_direction, lt.occurred_at AS last_occurred_at, lt.kind AS last_kind,
             lt.subject AS last_subject,
             li.occurred_at AS last_in_at,
             coalesce(ev.unread, 0) AS event_unread,
             th.id AS thread_id, th.last_message_at AS thread_last_at, coalesce(th.unread, 0) AS thread_unread,
             -- «No esta vez» en vigor (`notNowInForce`): no ha llegado su día y no han vuelto a escribir.
             (c.not_now_at IS NOT NULL
              AND (c.not_now_until IS NULL OR c.not_now_until > current_date)
              AND (li.occurred_at IS NULL OR li.occurred_at <= c.not_now_at)) AS not_now,
             -- Los hechos de la relación (`relationOf`): lo último que se movió,
             -- si han contestado y si se les escribió.
             greatest(lt.occurred_at, li.occurred_at, c.last_contacted_at) AS activity,
             (li.occurred_at IS NOT NULL
              OR coalesce(c.legacy_status IN ('in_conversation', 'hold', 'confirmed'), false)) AS answered,
             (lt.direction = 'outbound' OR c.first_contacted_at IS NOT NULL OR c.contacted_undated) IS TRUE AS wrote
      FROM conv_cand c
      LEFT JOIN public.conversation_read cr ON cr.conversation_id = c.id AND cr.user_id = v_caller
      -- El último correo, mensaje o llamada con dirección, no automático: el turno.
      LEFT JOIN LATERAL (
        SELECT e.direction::text AS direction, e.occurred_at, e.kind::text AS kind, e.metadata->>'subject' AS subject
        FROM public.conversation_event e
        WHERE e.conversation_id = c.id
          AND e.direction IS NOT NULL
          AND e.kind::text IN ('email', 'message', 'call')
          AND e.metadata->>'auto' IS NULL
        ORDER BY e.occurred_at DESC, e.recorded_at DESC
        LIMIT 1
      ) lt ON true
      -- El último que vino de fuera: si han contestado, y si «no esta vez» caducó.
      LEFT JOIN LATERAL (
        SELECT e.occurred_at
        FROM public.conversation_event e
        WHERE e.conversation_id = c.id
          AND e.direction = 'inbound'
          AND e.kind::text IN ('email', 'message', 'call')
          AND e.metadata->>'auto' IS NULL
        ORDER BY e.occurred_at DESC, e.recorded_at DESC
        LIMIT 1
      ) li ON true
      -- No leídos del registro.
      LEFT JOIN LATERAL (
        SELECT count(*) AS unread
        FROM public.conversation_event e
        WHERE e.conversation_id = c.id
          AND e.direction = 'inbound'
          AND e.metadata->>'auto' IS NULL
          AND NOT (e.source IN ('manual', 'whatsapp') AND e.created_by IS NOT DISTINCT FROM v_caller)
          AND e.recorded_at > coalesce(cr.last_read_at, c.created_at)
      ) ev ON true
      -- Su hilo del equipo: el General de la conversación, que se lee como ella
      -- (`thread_readable`), con mensajes vivos.
      LEFT JOIN LATERAL (
        SELECT t.id, t.last_message_at, cnt.unread
        FROM public.thread t
        LEFT JOIN public.thread_read tr ON tr.thread_id = t.id AND tr.user_id = v_caller
        CROSS JOIN LATERAL (
          SELECT count(*) AS total,
                 count(*) FILTER (
                   WHERE msg.author_id IS DISTINCT FROM v_caller
                     AND (tr.last_read_at IS NULL OR msg.created_at > tr.last_read_at)
                 ) AS unread
          FROM public.message msg
          WHERE msg.thread_id = t.id AND msg.deleted_at IS NULL
        ) cnt
        WHERE t.conversation_id = c.id AND t.facet_id IS NULL AND cnt.total > 0
        LIMIT 1
      ) th ON true
    ),
    conv_derived AS (
      SELECT r.*,
             -- `dueReason`: una respuesta pendiente (no atendida) o un seguimiento
             -- vencido, fuera de «no esta vez».
             CASE
               WHEN r.not_now THEN NULL
               WHEN r.last_direction = 'inbound'
                    AND (r.reply_settled_at IS NULL OR r.last_occurred_at > r.reply_settled_at) THEN 'reply'
               WHEN r.next_action_at IS NOT NULL AND r.next_action_at::date <= current_date THEN 'follow_up'
             END AS due_reason,
             -- `turnOf`: de quien no escribió lo último (lo atendido no tiene turno).
             CASE
               WHEN r.last_direction IS NULL OR r.not_now THEN NULL
               WHEN r.last_direction = 'inbound'
                    AND r.reply_settled_at IS NOT NULL AND r.last_occurred_at <= r.reply_settled_at THEN NULL
               WHEN r.last_direction = 'inbound' THEN 'ours'
               ELSE 'theirs'
             END AS turn_side,
             -- La relación solo para filtrar; la de la página se calcula al armarla.
             CASE WHEN p_relation IS NOT NULL THEN
               private.relation_of(r.not_now_at, r.not_now_until, r.last_in_at, r.activity, r.wrote, r.answered,
                                   private.organization_is_regular(r.workspace_id, r.organization_id, current_date),
                                   current_date)
             END AS relation,
             -- Para el orden por nombre (y el desempate del de ciudad): con quién
             -- (la organización o el contacto principal).
             CASE WHEN v_sort IN ('nombre', 'ciudad') THEN coalesce((
               SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name)
               FROM public.conversation x
               LEFT JOIN public.workspace_organization o ON o.id = x.organization_id AND o.deleted_at IS NULL
               LEFT JOIN public.conversation_contact cc ON cc.conversation_id = x.id AND cc.is_primary
               LEFT JOIN public.person pe ON pe.id = cc.person_id
               LEFT JOIN public.workspace_person wp ON wp.workspace_id = x.workspace_id AND wp.person_id = cc.person_id
               WHERE x.id = r.id
               LIMIT 1), '') END AS title,
             pl.org_kind, coalesce(pl.solo, false) AS solo, pl.city AS place_city
      FROM conv_rows r
      -- El tipo, «por libre» y la ciudad, los mismos que la fila (v_extra, abajo).
      LEFT JOIN LATERAL (
        SELECT CASE WHEN o.kind NOT IN ('other', 'solo') THEN o.kind END AS org_kind,
               CASE WHEN o.kind = 'solo' THEN true WHEN o.kind <> 'other' THEN false ELSE coalesce((
                 SELECT count(*) = 1 AND bool_and(lower(btrim(w.full_name)) = lower(btrim(o.name)))
                 FROM public.workspace_person w
                 WHERE w.workspace_id = o.workspace_id AND w.organization_id = o.id AND w.deleted_at IS NULL
               ), false) END AS solo,
               coalesce(nullif(o.city, ''), nullif(wp.city, '')) AS city
        FROM (SELECT 1) one
        LEFT JOIN public.workspace_organization o ON o.id = r.organization_id AND o.deleted_at IS NULL
        LEFT JOIN public.conversation_contact cc ON cc.conversation_id = r.id AND cc.is_primary
        LEFT JOIN public.workspace_person wp ON wp.workspace_id = r.workspace_id AND wp.person_id = cc.person_id
        LIMIT 1
      ) pl ON v_place
    ),
    conv_temp AS (
      SELECT d.*,
             -- `isHot`
             (NOT d.not_now
              AND ((d.last_in_at IS NOT NULL AND current_date - d.last_in_at::date <= 14)
                   OR (d.answered AND d.activity IS NOT NULL AND current_date - d.activity::date <= 14))) AS hot,
             -- `coolingOf`: los días (NULL = no se enfría) y el grupo.
             CASE
               WHEN d.not_now OR d.due_reason IS NOT NULL THEN NULL
               WHEN d.turn_side = 'theirs' AND current_date - d.last_occurred_at::date >= 21
                 THEN current_date - d.last_occurred_at::date
               WHEN d.last_direction IS NULL AND NOT d.answered AND d.last_contacted_at IS NOT NULL
                    AND current_date - d.last_contacted_at::date >= 21
                 THEN current_date - d.last_contacted_at::date
               WHEN d.answered AND d.activity IS NOT NULL AND current_date - d.activity::date >= 30
                 THEN current_date - d.activity::date
             END AS cool_days,
             -- `isUndated`
             (NOT d.not_now AND (d.contacted_undated OR d.answered)
              AND d.last_direction IS NULL AND d.activity IS NULL AND d.next_action_at IS NULL) AS undated
      FROM conv_derived d
    ),
    conv_feed AS (
      SELECT 'conversation'::text AS kind, r.id, r.id AS conversation_id, NULL::uuid AS bolo_id, NULL::uuid AS facet_id,
             (r.event_unread + r.thread_unread) AS unread,
             -- Nunca NULL: un NULL va primero en DESC.
             (r.due_reason IS NOT NULL) AS due,
             coalesce(greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at),
                      r.created_at) AS sort_at,
             greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at) AS last_at,
             r.due_reason, r.last_occurred_at, r.next_action_at, r.title, r.activity,
             CASE WHEN r.cool_days IS NOT NULL THEN CASE WHEN r.answered THEN 'stalled' ELSE 'round' END END AS cool_group,
             r.cool_days,
             r.relation, r.workspace_id AS ws_id, r.organization_id AS org_id, r.not_now_at, r.not_now_until,
             r.last_in_at, r.wrote, r.answered, r.place_city,
             jsonb_build_object(
               'kind', 'conversation',
               'id', r.id,
               'workspace_id', r.workspace_id,
               'project_id', r.project_id,
               'line_id', r.line_id,
               'created_at', r.created_at,
               'unread_count', r.event_unread + r.thread_unread,
               'event_unread', r.event_unread,
               'thread_unread', r.thread_unread,
               'thread_id', r.thread_id,
               'last', CASE WHEN r.last_occurred_at IS NULL THEN NULL ELSE jsonb_build_object(
                         'direction', r.last_direction,
                         'occurred_at', r.last_occurred_at,
                         'kind', r.last_kind,
                         'subject', r.last_subject) END,
               'last_in', CASE WHEN r.last_in_at IS NULL THEN NULL
                               ELSE jsonb_build_object('occurred_at', r.last_in_at) END,
               'last_at', greatest(r.last_occurred_at, r.last_in_at, r.thread_last_at, r.last_contacted_at),
               'last_contacted_at', r.last_contacted_at,
               'reply_settled_at', r.reply_settled_at,
               'next_action_at', r.next_action_at,
               'next_action_note', r.next_action_note,
               'not_now_at', r.not_now_at,
               'not_now_until', r.not_now_until) AS d
      FROM conv_temp r
      WHERE (p_relation IS NULL OR r.relation = p_relation)
        AND (p_turn IS NULL
             OR (p_turn = 'nuestro' AND r.due_reason IS NOT NULL)
             OR (p_turn = 'suyo' AND r.turn_side = 'theirs'))
        AND (p_temp IS NULL
             OR (p_temp = 'caliente' AND r.hot)
             OR (p_temp = 'fria' AND r.cool_days IS NOT NULL)
             OR (p_temp = 'ronda' AND r.cool_days IS NOT NULL AND NOT r.answered)
             OR (p_temp = 'parada' AND r.cool_days IS NOT NULL AND r.answered)
             OR (p_temp = 'sin-fecha' AND r.undated))
        -- Tipo (ADR-177 § 2 y 3): 'solo' es la organización que se enseña como
        -- persona; un tipo no la incluye, porque su fila dice «por libre».
        AND (p_kind IS NULL
             OR (p_kind = 'solo' AND r.solo)
             OR (p_kind <> 'solo' AND NOT r.solo AND r.org_kind = p_kind))
        -- Zona: la ciudad de la fila, sin mayúsculas ni espacios de más.
        AND (v_city IS NULL OR lower(btrim(r.place_city)) = v_city)
        -- La tanda del envío (`mailoutPicks`): contestó = le salió y su último
        -- correo de fuera es posterior a la salida.
        AND (p_mailout_id IS NULL
             OR EXISTS (
                  SELECT 1 FROM public.mailout_recipient mr
                  CROSS JOIN LATERAL (
                    SELECT mr.status::text IN ('sent', 'delivered', 'bounced', 'complained') AS left_,
                           (mr.status::text IN ('sent', 'delivered', 'bounced', 'complained')
                            AND coalesce(mr.sent_at, v_mailout.queued_at) IS NOT NULL
                            AND r.last_in_at IS NOT NULL
                            AND r.last_in_at > coalesce(mr.sent_at, v_mailout.queued_at)) AS replied
                  ) x
                  WHERE mr.mailout_id = v_mailout.id AND mr.conversation_id = r.id
                    AND CASE v_pick
                          WHEN 'rebotes' THEN mr.status::text = 'bounced'
                          WHEN 'todos' THEN x.left_
                          WHEN 'respuestas' THEN x.replied
                          ELSE x.left_ AND mr.status::text <> 'bounced' AND NOT x.replied
                        END))
    ),
    thread_cand AS (
      -- El prefiltro de `thread_feed`: espacio, con mensajes, ancla de bolo o de
      -- conversación viva, alcance. Con conversaciones en la lista, el hilo de
      -- una conversación va dentro de su fila y no sale aparte.
      SELECT t.id, t.workspace_id, t.bolo_id, t.conversation_id, t.facet_id, t.last_message_at,
             coalesce(b.project_id, c.project_id) AS project_id
      FROM public.thread t
      JOIN ws ON ws.workspace_id = t.workspace_id
      LEFT JOIN public.bolo b ON b.id = t.bolo_id AND b.deleted_at IS NULL
      LEFT JOIN public.conversation c ON c.id = t.conversation_id AND c.deleted_at IS NULL
      WHERE v_threads
        AND t.last_message_at IS NOT NULL
        AND (b.id IS NOT NULL OR (c.id IS NOT NULL AND NOT v_convs))
        AND (v_all
             OR t.workspace_id = ANY (coalesce(p_workspace_ids, '{}'))
             OR coalesce(b.project_id, c.project_id) = ANY (coalesce(p_project_ids, '{}')))
        AND (v_q IS NULL
             OR strpos(lower(coalesce(b.venue_name, '')), v_q) > 0
             OR strpos(lower(coalesce(b.city, '')), v_q) > 0
             OR EXISTS (
                  SELECT 1 FROM public.project p
                  WHERE p.id = coalesce(b.project_id, c.project_id)
                    AND strpos(lower(coalesce(p.name, p.slug)), v_q) > 0)
             OR EXISTS (
                  SELECT 1 FROM public.workspace_organization o
                  WHERE o.workspace_id = c.workspace_id AND o.id = c.organization_id
                    AND strpos(lower(o.name), v_q) > 0))
    ),
    thread_feed_rows AS (
      SELECT 'thread'::text AS kind, x.id, x.conversation_id, x.bolo_id, x.facet_id,
             cnt.unread, false AS due, x.last_message_at AS sort_at, x.last_message_at AS last_at,
             NULL::text AS due_reason, NULL::timestamptz AS last_occurred_at, NULL::timestamptz AS next_action_at,
             NULL::text AS title, NULL::timestamptz AS activity, NULL::text AS cool_group, NULL::int AS cool_days,
             NULL::text AS relation, NULL::uuid AS ws_id, NULL::uuid AS org_id, NULL::timestamptz AS not_now_at,
             NULL::date AS not_now_until, NULL::timestamptz AS last_in_at, NULL::boolean AS wrote,
             NULL::boolean AS answered, NULL::text AS place_city,
             jsonb_build_object(
               'kind', 'thread',
               'thread_id', x.id,
               'workspace_id', x.workspace_id,
               'project_id', x.project_id,
               'anchor_kind', CASE WHEN x.bolo_id IS NOT NULL THEN 'bolo' ELSE 'conversation' END,
               'anchor_id', coalesce(x.bolo_id, x.conversation_id),
               'facet_id', x.facet_id,
               'message_count', cnt.total,
               'unread_count', cnt.unread,
               'last_message_at', x.last_message_at) AS d
      FROM thread_cand x
      LEFT JOIN public.thread_read tr ON tr.thread_id = x.id AND tr.user_id = v_caller
      CROSS JOIN LATERAL (
        SELECT count(*) AS total,
               count(*) FILTER (
                 WHERE msg.author_id IS DISTINCT FROM v_caller
                   AND (tr.last_read_at IS NULL OR msg.created_at > tr.last_read_at)
               ) AS unread
        FROM public.message msg
        WHERE msg.thread_id = x.id AND msg.deleted_at IS NULL
      ) cnt
      WHERE cnt.total > 0
    )
    SELECT f.*
    FROM (SELECT * FROM conv_feed UNION ALL SELECT * FROM thread_feed_rows) f
    -- Un CASE por clave: la que no es de este orden vale NULL en todas las filas.
    ORDER BY
      CASE WHEN v_sort IN ('feed', 'pide') THEN f.unread > 0 END DESC NULLS LAST,
      CASE WHEN v_sort IN ('feed', 'pide') THEN f.due END DESC NULLS LAST,
      CASE WHEN v_sort IN ('pide', 'due') THEN CASE f.due_reason WHEN 'reply' THEN 0 WHEN 'follow_up' THEN 1 END END ASC NULLS LAST,
      CASE WHEN v_sort IN ('pide', 'due') AND f.due_reason = 'reply' THEN f.last_occurred_at END DESC NULLS LAST,
      CASE WHEN v_sort IN ('pide', 'due') AND f.due_reason = 'follow_up' THEN f.next_action_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'paso' THEN f.next_action_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'ciudad' THEN f.place_city COLLATE private.list_name END ASC NULLS LAST,
      CASE WHEN v_sort IN ('nombre', 'ciudad') THEN f.title COLLATE private.list_name END ASC NULLS LAST,
      CASE WHEN v_sort = 'theirs' THEN f.last_occurred_at END ASC NULLS LAST,
      CASE WHEN v_sort = 'hot' THEN f.activity END DESC NULLS LAST,
      CASE WHEN v_sort = 'cold' THEN f.cool_group = 'stalled' END DESC NULLS LAST,
      CASE WHEN v_sort = 'cold' THEN f.cool_days END DESC NULLS LAST,
      CASE WHEN v_sort IN ('feed', 'pide', 'movimiento', 'paso') THEN f.sort_at END DESC NULLS LAST,
      f.id
  LOOP
    -- La regla de cada fila, la de su política: `conversation_select` o
    -- `thread_select`. Lo que no pasa no sale, ni sus no leídos ni su nombre,
    -- ni cuenta en el total.
    CONTINUE WHEN NOT CASE rec.kind
      WHEN 'conversation' THEN private.can_read_conversation(rec.id, v_caller)
      ELSE private.thread_readable(rec.conversation_id, NULL, NULL, rec.bolo_id, rec.facet_id, v_caller)
    END;

    IF v_list THEN
      v_total := v_total + 1;
      IF v_ids THEN
        IF v_total <= 1000 THEN
          v_items := v_items || jsonb_build_array(jsonb_build_object('id', rec.id, 'project_id', rec.d->'project_id'));
        END IF;
        CONTINUE;
      END IF;
      CONTINUE WHEN v_total <= v_offset OR v_total > v_offset + v_limit;
    ELSE
      IF v_n = v_limit THEN
        v_more := true;
        EXIT;
      END IF;
      v_n := v_n + 1;
    END IF;

    IF rec.kind = 'conversation' THEN
      -- Con quién (la organización o el contacto principal, con su papel), el
      -- tipo de la organización (NULL si es 'other'), si es «por libre» (una
      -- sola persona viva que se llama como ella), la ciudad (la de la
      -- organización, si no la del contacto: ADR-177 § 2), sus etiquetas y su
      -- relación. Tipo, «por libre» y ciudad son los mismos que filtran arriba.
      SELECT jsonb_build_object(
               'title', ct.title,
               'person', CASE WHEN ct.person IS DISTINCT FROM ct.title THEN ct.person END,
               'contact_role', ct.role,
               'org_kind', ct.org_kind,
               'solo', ct.solo,
               'city', ct.city,
               'tags', coalesce(tg.keys, '[]'::jsonb),
               'due', rec.due,
               'relation', coalesce(rec.relation, private.relation_of(
                             rec.not_now_at, rec.not_now_until, rec.last_in_at, rec.activity, rec.wrote, rec.answered,
                             private.organization_is_regular(rec.ws_id, rec.org_id, current_date), current_date)))
      INTO v_extra
      FROM (
        SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name) AS title,
               coalesce(wp.full_name, pe.full_name) AS person,
               cc.role,
               CASE WHEN o.kind NOT IN ('other', 'solo') THEN o.kind END AS org_kind,
               CASE WHEN o.kind = 'solo' THEN true WHEN o.kind <> 'other' THEN false ELSE coalesce((
                 SELECT count(*) = 1 AND bool_and(lower(btrim(w.full_name)) = lower(btrim(o.name)))
                 FROM public.workspace_person w
                 WHERE w.workspace_id = o.workspace_id AND w.organization_id = o.id AND w.deleted_at IS NULL
               ), false) END AS solo,
               coalesce(nullif(o.city, ''), nullif(wp.city, '')) AS city
        FROM public.conversation c
        LEFT JOIN public.workspace_organization o ON o.id = c.organization_id AND o.deleted_at IS NULL
        LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
        LEFT JOIN public.person pe ON pe.id = cc.person_id
        LEFT JOIN public.workspace_person wp ON wp.workspace_id = c.workspace_id AND wp.person_id = cc.person_id
        WHERE c.id = rec.id
        LIMIT 1
      ) ct
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT t.key) AS keys
        FROM public.conversation_tagging g
        JOIN public.conversation_tag t ON t.id = g.tag_id
        WHERE g.conversation_id = rec.id
      ) tg ON true;
    ELSE
      -- La forma de `thread_feed`, sin dinero (ADR-106 § 1).
      SELECT jsonb_build_object(
               'facet_key', f.key,
               'label', coalesce(fs.label, f.label),
               'labels', CASE WHEN f.id IS NULL THEN '{}'::jsonb
                              ELSE f.labels || coalesce(fs.labels, '{}'::jsonb) END,
               'last_message', jsonb_build_object(
                 'author_id', lm.author_id,
                 'body', left(lm.body, 280),
                 'created_at', lm.created_at),
               'bolo', CASE WHEN rec.bolo_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'venue_name', b.venue_name,
                 'city', b.city,
                 'first_day', pd.first_day,
                 'last_day', pd.last_day,
                 'performance_slug', pt.slug,
                 'performance_id', pt.id) END,
               'conversation', CASE WHEN rec.conversation_id IS NULL THEN NULL ELSE jsonb_build_object(
                 'title', ct.title) END)
      INTO v_extra
      FROM (SELECT 1) one
      LEFT JOIN public.facet f ON f.id = rec.facet_id
      LEFT JOIN public.workspace_facet_setting fs
        ON fs.workspace_id = (rec.d->>'workspace_id')::uuid AND fs.facet_id = rec.facet_id
      LEFT JOIN public.bolo b ON b.id = rec.bolo_id
      LEFT JOIN LATERAL (
        SELECT msg.author_id, msg.body, msg.created_at
        FROM public.message msg
        WHERE msg.thread_id = rec.id AND msg.deleted_at IS NULL
        ORDER BY msg.created_at DESC, msg.id DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT min(pf.performed_at) AS first_day, max(pf.performed_at) AS last_day
        FROM public.performance pf
        WHERE pf.bolo_id = rec.bolo_id AND pf.deleted_at IS NULL
      ) pd ON rec.bolo_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT pf.id, pf.slug
        FROM public.performance pf
        WHERE pf.bolo_id = rec.bolo_id AND pf.deleted_at IS NULL
        ORDER BY pf.performed_at < current_date,
                 CASE WHEN pf.performed_at >= current_date THEN pf.performed_at END,
                 pf.performed_at DESC, pf.id
        LIMIT 1
      ) pt ON rec.bolo_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT coalesce(o.name, wp.full_name, pe.full_name, pe.organization_name) AS title
        FROM public.conversation c
        LEFT JOIN public.workspace_organization o ON o.id = c.organization_id AND o.deleted_at IS NULL
        LEFT JOIN public.conversation_contact cc ON cc.conversation_id = c.id AND cc.is_primary
        LEFT JOIN public.person pe ON pe.id = cc.person_id
        LEFT JOIN public.workspace_person wp ON wp.workspace_id = c.workspace_id AND wp.person_id = cc.person_id
        WHERE c.id = rec.conversation_id
        LIMIT 1
      ) ct ON rec.conversation_id IS NOT NULL;
    END IF;

    v_items := v_items || jsonb_build_array(rec.d || v_extra);
  END LOOP;

  IF v_list THEN
    RETURN jsonb_build_object(
      'items', v_items,
      'more', CASE WHEN v_ids THEN v_total > 1000 ELSE v_total > v_offset + v_limit END,
      'total', v_total);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'more', v_more);
END;
$$;
