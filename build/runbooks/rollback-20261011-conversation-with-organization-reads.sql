-- ROLLBACK for 20261011800000_conversation_with_organization_reads.sql
-- (ADR-102, fase 2: lecturas, alta por organización y correo)
--
-- Si 20261011810000 (slugs) está aplicada, primero su rollback.
--
-- Deshace: la búsqueda `conversation_search`, el índice del hilo de correo,
-- las versiones nuevas de `mail_contact_addresses`, `mail_ingest_message` y
-- `mail_send_authorize` (vuelven las de 20261011200000), de
-- `set_conversation_contact` y `conversation_sync_primary_contact` (vuelven
-- las de 20261011600000) y de `create_conversation` (vuelve la firma sin
-- `p_organization_id`, de 20261011500000); `conversation_free_slug`; la
-- unicidad por organización; el grant por columnas (vuelve INSERT y UPDATE a
-- tabla entera para anon y authenticated, como antes); y el NOT NULL de
-- `conversation.person_id`.
--
-- ANTES: el Worker de la fase 2 llama a `create_conversation` con
-- `p_organization_id` y a `rpc/conversation_search`: volver antes al deploy
-- anterior, o el alta y la búsqueda dan 404/400.
--
-- ABORTA si hay conversaciones sin persona (creadas solo con su organización):
-- el modelo viejo no las admite. Hay que darles un contacto principal
-- (`set_conversation_contact` con `p_is_primary`) o borrarlas, a mano y
-- sabiendo cuáles son:
--   SELECT id, workspace_id, slug FROM public.conversation WHERE person_id IS NULL;
--
-- DATOS: no se pierde nada. Los correos que entraron por la regla del hilo y
-- los contactos añadidos se quedan (son filas, no reglas).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation WHERE person_id IS NULL) THEN
    RAISE EXCEPTION 'conversations without a person exist: give them a primary contact or delete them first';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.conversation_search(text);
DROP INDEX IF EXISTS public.conversation_event_mail_thread_idx;
DROP INDEX IF EXISTS public.conversation_project_organization_shared_uidx;
DROP INDEX IF EXISTS public.conversation_project_organization_private_uidx;

DROP FUNCTION IF EXISTS public.create_conversation(
  uuid, uuid, text, text, text, text, text, public.conversation_status, text,
  timestamp with time zone, text, uuid, uuid
);
DROP FUNCTION IF EXISTS public.conversation_free_slug(uuid, text, uuid);

-- create_conversation de 20261011500000
CREATE OR REPLACE FUNCTION public.create_conversation(
  p_project_id uuid,
  p_person_id uuid DEFAULT NULL::uuid,
  p_full_name text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_organization_name text DEFAULT NULL::text,
  p_title text DEFAULT NULL::text,
  p_status public.conversation_status DEFAULT 'contacted'::public.conversation_status,
  p_role text DEFAULT NULL::text,
  p_next_action_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_next_action_note text DEFAULT NULL::text,
  p_line_id uuid DEFAULT NULL::uuid
) RETURNS public.conversation
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_caller uuid := auth.uid();
  v_workspace_id uuid;
  v_born_private boolean;
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_person_id uuid;
  v_person_slug text;
  v_organization_id uuid;
  v_organization_slug text;
  v_conversation_id uuid;
  v_conversation_slug text;
  v_conversation public.conversation;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select workspace_id into v_workspace_id
  from public.project where id = p_project_id and deleted_at is null;
  if v_workspace_id is null or not public.has_permission(p_project_id, 'edit:conversation') then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if p_line_id is not null and not exists (
    select 1 from public.line
    where id = p_line_id and project_id = p_project_id and deleted_at is null
  ) then
    raise exception 'line does not belong to project' using errcode = '22023';
  end if;

  if p_person_id is not null then
    select wp.person_id, wp.slug into v_person_id, v_person_slug
    from public.workspace_person wp
    where wp.workspace_id = v_workspace_id and wp.person_id = p_person_id
      and wp.deleted_at is null;
    if v_person_id is null then
      raise exception 'person not found in target workspace' using errcode = '42501';
    end if;
  else
    if v_full_name is null then
      raise exception 'full_name is required when person_id is not given' using errcode = '22023';
    end if;
    if v_email is not null and v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'email is not valid' using errcode = '22023';
    end if;

    if v_email is not null then
      select wp.person_id, wp.slug into v_person_id, v_person_slug
      from public.workspace_person wp
      where wp.workspace_id = v_workspace_id and wp.email = v_email
        and wp.deleted_at is null
      limit 1;
    end if;

    if v_person_id is null then
      v_person_id := public.uuid_generate_v7();
      insert into public.person (id, slug, full_name, email, created_by)
      values (
        v_person_id,
        'person-' || substring(replace(v_person_id::text, '-', '') from 1 for 12),
        'Person ' || substring(replace(v_person_id::text, '-', '') from 1 for 8),
        null,
        v_caller
      );
    end if;

    v_person_slug := coalesce(
      nullif(rtrim(left(public.slugify(v_full_name), 63), '-'), ''),
      'person'
    );
    if exists (
      select 1 from public.workspace_person wp
      where wp.workspace_id = v_workspace_id and wp.slug = v_person_slug
        and wp.person_id <> v_person_id and wp.deleted_at is null
    ) then
      v_person_slug := rtrim(left(v_person_slug, 56), '-') || '-' || substring(replace(v_person_id::text, '-', '') from 1 for 6);
    end if;

    if nullif(btrim(coalesce(p_organization_name, '')), '') is not null then
      select id into v_organization_id
      from public.workspace_organization
      where workspace_id = v_workspace_id
        and lower(btrim(name)) = lower(btrim(p_organization_name))
        and deleted_at is null
      limit 1;

      if v_organization_id is null then
        v_organization_id := public.uuid_generate_v7();
        v_organization_slug := coalesce(
          nullif(rtrim(left(public.slugify(p_organization_name), 63), '-'), ''),
          'organization'
        );
        if exists (
          select 1 from public.workspace_organization
          where workspace_id = v_workspace_id and slug = v_organization_slug and deleted_at is null
        ) then
          v_organization_slug := rtrim(left(v_organization_slug, 56), '-') || '-' || substring(replace(v_organization_id::text, '-', '') from 1 for 6);
        end if;
        insert into public.workspace_organization (id, workspace_id, slug, name, created_by)
        values (v_organization_id, v_workspace_id, v_organization_slug, btrim(p_organization_name), v_caller);
      end if;
    end if;

    insert into public.workspace_person (
      workspace_id, person_id, slug, full_name, email, phone,
      organization_id, title, created_by
    ) values (
      v_workspace_id, v_person_id, v_person_slug, v_full_name, v_email,
      nullif(btrim(coalesce(p_phone, '')), ''), v_organization_id,
      nullif(btrim(coalesce(p_title, '')), ''), v_caller
    )
    on conflict (workspace_id, person_id) do update set
      deleted_at = null,
      full_name = excluded.full_name,
      email = coalesce(workspace_person.email, excluded.email),
      phone = coalesce(workspace_person.phone, excluded.phone),
      organization_id = coalesce(workspace_person.organization_id, excluded.organization_id),
      title = coalesce(workspace_person.title, excluded.title);
  end if;

  -- Ya hay una viva que quien crea ve (compartida o privada suya): el 409 de
  -- siempre. Una privada de otro no cuenta ni se nombra: quien crea recibe la
  -- suya.
  if exists (
    select 1 from public.conversation
    where workspace_id = v_workspace_id and project_id = p_project_id
      and person_id = v_person_id and deleted_at is null
      and (private_to is null or private_to = v_caller)
  ) then
    raise exception 'this person already has a conversation in this project'
      using errcode = '23505';
  end if;

  -- Se recupera una borrada solo si quien crea podría verla: compartida o
  -- privada suya. Una privada de otra persona sigue borrada e invisible, y
  -- quien crea recibe una conversación nueva.
  select * into v_conversation from public.conversation
  where workspace_id = v_workspace_id and project_id = p_project_id
    and person_id = v_person_id and deleted_at is not null
    and (private_to is null or private_to = v_caller)
  order by deleted_at desc, id desc
  limit 1;
  if v_conversation.id is not null then
    -- Recuperar es volver a nacer: el ajuste del espacio decide, como en el
    -- INSERT de la guarda.
    v_born_private := coalesce((
      select w.new_conversations_private from public.workspace w where w.id = v_workspace_id
    ), true);
    v_conversation_slug := v_conversation.slug;
    if exists (
      select 1 from public.conversation
      where workspace_id = v_workspace_id and slug = v_conversation_slug
        and deleted_at is null and id <> v_conversation.id
    ) then
      v_conversation_slug := rtrim(left(v_conversation_slug, 56), '-') || '-' || substring(replace(v_conversation.id::text, '-', '') from 1 for 6);
    end if;
    update public.conversation set
      deleted_at = null, slug = v_conversation_slug, status = p_status,
      role = nullif(btrim(coalesce(p_role, '')), ''), last_contacted_at = now(),
      next_action_at = p_next_action_at,
      next_action_note = nullif(btrim(coalesce(p_next_action_note, '')), ''),
      line_id = p_line_id,
      private_to = case when v_born_private then v_caller else null end
    where id = v_conversation.id returning * into v_conversation;
    return v_conversation;
  end if;

  v_conversation_id := public.uuid_generate_v7();
  v_conversation_slug := v_person_slug;
  if exists (
    select 1 from public.conversation
    where workspace_id = v_workspace_id and slug = v_conversation_slug and deleted_at is null
  ) then
    v_conversation_slug := rtrim(left(v_conversation_slug, 56), '-') || '-' || substring(replace(v_conversation_id::text, '-', '') from 1 for 6);
  end if;

  insert into public.conversation (
    id, slug, workspace_id, project_id, person_id, line_id, status, role,
    first_contacted_at, last_contacted_at, next_action_at, next_action_note, created_by
  ) values (
    v_conversation_id, v_conversation_slug, v_workspace_id, p_project_id,
    v_person_id, p_line_id, p_status, nullif(btrim(coalesce(p_role, '')), ''),
    now(), now(), p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''), v_caller
  ) returning * into v_conversation;

  return v_conversation;
end;
$_$;

ALTER FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid) TO authenticated;

-- set_conversation_contact y conversation_sync_primary_contact de 20261011600000
CREATE OR REPLACE FUNCTION public.conversation_sync_primary_contact()
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

CREATE OR REPLACE FUNCTION public.set_conversation_contact(
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


-- correo de 20261011200000 (CREATE OR REPLACE conserva propietario y grants)
CREATE OR REPLACE FUNCTION public.mail_contact_addresses(p_account_id uuid)
RETURNS TABLE (address text, backfilled boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT DISTINCT lower(wp.email::text),
         EXISTS (SELECT 1 FROM public.mail_account_address m
                 WHERE m.mail_account_id = a.id AND m.address = lower(wp.email::text))
  FROM public.mail_account a
  JOIN public.conversation c ON c.workspace_id = a.workspace_id AND c.deleted_at IS NULL
  JOIN public.workspace_person wp
    ON wp.workspace_id = c.workspace_id AND wp.person_id = c.person_id
   AND wp.deleted_at IS NULL AND wp.email IS NOT NULL
  WHERE a.id = p_account_id
    AND lower(wp.email::text) <> lower(a.address::text)
    AND public.mail_account_eligible_conversation(a, c);
$$;

CREATE OR REPLACE FUNCTION public.mail_ingest_message(
  p_account_id uuid,
  p_message    jsonb,
  p_created_by uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_acc        public.mail_account;
  v_msg_id     text := nullif(btrim(coalesce(p_message ->> 'provider_message_id', '')), '');
  v_rfc        text := nullif(btrim(coalesce(p_message ->> 'rfc_message_id', '')), '');
  v_direction  public.conversation_event_direction;
  v_occurred   timestamptz;
  v_counter    text[];
  v_ref_base   text;
  v_created    integer := 0;
  v_conv       public.conversation;
  v_event_id   uuid;
BEGIN
  SELECT * INTO v_acc FROM public.mail_account WHERE id = p_account_id;
  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'mail account % not found', p_account_id USING ERRCODE = '42501';
  END IF;
  IF v_msg_id IS NULL THEN
    RAISE EXCEPTION 'provider_message_id is required' USING ERRCODE = '22023';
  END IF;
  v_direction := (p_message ->> 'direction')::public.conversation_event_direction;
  v_occurred := least(coalesce((p_message ->> 'occurred_at')::timestamptz, statement_timestamp()),
                      statement_timestamp());
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}')
  INTO v_counter
  FROM jsonb_array_elements_text(coalesce(p_message -> 'counterparts', '[]'::jsonb)) AS x
  WHERE btrim(x) <> '';

  -- Ya procesado en este buzón: nada que hacer.
  INSERT INTO public.mail_message (mail_account_id, provider_message_id, provider_thread_id, rfc_message_id)
  VALUES (v_acc.id, v_msg_id, nullif(p_message ->> 'provider_thread_id', ''), v_rfc)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_ref_base := 'mail:' || coalesce(v_rfc, v_acc.provider::text || ':' || v_acc.id::text || ':' || v_msg_id);

  FOR v_conv IN
    SELECT c.* FROM public.conversation c
    JOIN public.workspace_person wp
      ON wp.workspace_id = c.workspace_id AND wp.person_id = c.person_id
     AND wp.deleted_at IS NULL
    WHERE c.workspace_id = v_acc.workspace_id
      AND lower(wp.email::text) = ANY (v_counter)
      AND public.mail_account_eligible_conversation(v_acc, c)
    FOR UPDATE OF c
  LOOP
    v_event_id := NULL;
    INSERT INTO public.conversation_event (
      workspace_id, conversation_id, occurred_at, kind, source, direction,
      body, participants, provenance, external_ref, metadata, created_by
    ) VALUES (
      v_conv.workspace_id, v_conv.id, v_occurred, 'email', 'email', v_direction,
      nullif(btrim(left(coalesce(p_message ->> 'body', ''), 20000)), ''),
      (SELECT coalesce(jsonb_agg(jsonb_build_object('address', a)), '[]'::jsonb) FROM unnest(v_counter) a),
      jsonb_build_object('connector', 'mail_sync', 'provider', v_acc.provider),
      v_ref_base || '#' || v_conv.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'mail_account_id', v_acc.id,
        'mailbox_address', v_acc.address::text,
        'mailbox_scope', v_acc.scope,
        'provider', v_acc.provider,
        'provider_message_id', v_msg_id,
        'provider_thread_id', nullif(p_message ->> 'provider_thread_id', ''),
        'rfc_message_id', v_rfc,
        'subject', left(p_message ->> 'subject', 998),
        'from', left(p_message ->> 'from', 998),
        'to', p_message -> 'to',
        'cc', p_message -> 'cc'
      )),
      p_created_by
    )
    ON CONFLICT (workspace_id, source, external_ref) WHERE external_ref IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      v_created := v_created + 1;
      UPDATE public.conversation
      SET last_contacted_at = greatest(coalesce(last_contacted_at, v_occurred), v_occurred),
          first_contacted_at = coalesce(first_contacted_at, v_occurred)
      WHERE id = v_conv.id;
    END IF;
  END LOOP;

  UPDATE public.mail_message SET events_created = v_created
  WHERE mail_account_id = v_acc.id AND provider_message_id = v_msg_id;
  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.mail_send_authorize(p_conversation_id uuid, p_account_id uuid)
RETURNS TABLE (recipient_address text, recipient_name text, account_address text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   public.conversation;
  v_acc    public.mail_account;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conv FROM public.conversation
  WHERE id = p_conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);
  IF v_conv.id IS NULL OR NOT public.has_permission(v_conv.project_id, 'edit:conversation') THEN
    RAISE EXCEPTION 'conversation % not found', p_conversation_id USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_acc FROM public.mail_account
  WHERE id = p_account_id AND workspace_id = v_conv.workspace_id AND status = 'active'
    AND (scope = 'workspace' OR owner_user_id = v_caller);
  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'mail account % not usable', p_account_id USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT wp.email::text, wp.full_name, v_acc.address::text
  FROM public.workspace_person wp
  WHERE wp.workspace_id = v_conv.workspace_id AND wp.person_id = v_conv.person_id
    AND wp.deleted_at IS NULL AND wp.email IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the contact has no email address' USING ERRCODE = '22023';
  END IF;
END;
$$;


-- grants a tabla entera, como antes
GRANT INSERT, UPDATE ON TABLE public.conversation TO anon, authenticated;

ALTER TABLE public.conversation ALTER COLUMN person_id SET NOT NULL;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011800000';

COMMIT;
