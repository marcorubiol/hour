-- ADR-102, fase 2: la conversación se lee, se crea y empareja el correo por su
-- organización y sus contactos.
-- Plan: build/plans/2026-10-11-conversation-with-venue.md § 4, fase 2.
--
-- Aditiva: no reescribe filas (los slugs van aparte, en 20261011810000, porque
-- esa sí reescribe datos). Conviven los dos modelos hasta el contract (fase 4):
-- `conversation.person_id` sigue siendo el contacto principal y su unicidad
-- vieja sigue viva.
--
-- WHAT THIS DOES:
--   1. `conversation.person_id` deja de ser obligatorio: una conversación puede
--      nacer solo con su organización (ADR-102, añadido, punto 1: la
--      organización es obligatoria; la persona es su contacto principal, si la
--      hay). Relajar un NOT NULL no toca filas.
--   2. Grant por columnas para escribir `conversation` (revisión de la fase 1):
--      `organization_id` deja de ser escribible por PostgREST; solo la ponen
--      `create_conversation` y el trigger de relleno. SELECT sigue a tabla
--      entera. Regla 8 de `_context.md`: una columna nueva de `conversation`
--      NO es escribible por PostgREST hasta nombrarla en estos grants.
--   3. Unicidad por organización entre las vivas: una compartida por (espacio,
--      proyecto, organización) y una privada por dueño. Parcial por
--      `organization_id IS NOT NULL` hasta el contract. Comprueba antes que los
--      datos la cumplen y aborta si no.
--   4. `conversation_sync_primary_contact`: una conversación sin persona no
--      tiene principal.
--   5. `create_conversation` gana `p_organization_id`; la persona es opcional.
--      Organización: la que llega por id o por nombre; si no, la del dossier;
--      si no, una con el nombre de la persona (programador independiente).
--      409 por organización con el id de la existente en DETAIL, para que la
--      pantalla ofrezca abrirla. Revive por organización (o, si la borrada es
--      de antes de la fase 1, por persona). Slug de la organización. Cambia de
--      firma: se borra la vieja.
--   6. `set_conversation_contact` y `create_conversation`: un papel de más de
--      200 caracteres es 22023, no el 23514 de la restricción (revisión de la
--      fase 1).
--   7. Correo (ADR-102, añadido, punto 4):
--      · `mail_contact_addresses`: las direcciones de los contactos de las
--        conversaciones elegibles, vigentes o cerrados hace menos de 12 meses;
--      · `mail_ingest_message`: un correo entra en una conversación si alguna
--        contraparte era contacto en la fecha del correo (hilo nuevo), o si es
--        o fue contacto y el correo sigue un hilo que ya está en ella (mismo
--        hilo del mismo buzón, o In-Reply-To/References a un correo suyo);
--        el recuento que devuelve no cuenta lo que entró en privadas que el
--        resto del buzón no ve;
--      · `mail_send_authorize`: los contactos vigentes con correo, el
--        principal primero;
--      · índice del hilo del proveedor en `conversation_event`.
--   8. `conversation_search(p_q)`: conversaciones cuya organización o algún
--      contacto (nombre o correo) contiene el texto, con la RLS de quien llama.
--      PostgREST no resuelve un `or` sobre dos embeds.
--
-- Rollback: build/runbooks/rollback-20261011-conversation-with-organization-reads.sql.

-- ── 1 · la persona es opcional ────────────────────────────────────────────
ALTER TABLE public.conversation ALTER COLUMN person_id DROP NOT NULL;

COMMENT ON COLUMN public.conversation.person_id IS
  'ADR-102: the primary contact while the two models coexist (dropped in the contract phase). NULL = a conversation with its organization and no primary contact yet.';

-- ── 2 · grant por columnas para escribir ──────────────────────────────────
-- Todas las que ya eran escribibles, menos `organization_id`. anon no tiene
-- policy de escritura; se le quita también el grant, que no usaba.
REVOKE INSERT, UPDATE ON TABLE public.conversation FROM anon, authenticated;
GRANT INSERT (
  id, workspace_id, project_id, person_id, status, role, first_contacted_at,
  last_contacted_at, next_action_at, next_action_note, custom_fields,
  created_by, created_at, updated_at, deleted_at, slug, previous_slugs,
  line_id, private_to
) ON TABLE public.conversation TO authenticated;
GRANT UPDATE (
  id, workspace_id, project_id, person_id, status, role, first_contacted_at,
  last_contacted_at, next_action_at, next_action_note, custom_fields,
  created_by, created_at, updated_at, deleted_at, slug, previous_slugs,
  line_id, private_to
) ON TABLE public.conversation TO authenticated;

-- ── 3 · unicidad por organización ─────────────────────────────────────────
DO $$
DECLARE
  v_shared  bigint;
  v_private bigint;
BEGIN
  SELECT count(*) INTO v_shared FROM (
    SELECT 1 FROM public.conversation
    WHERE deleted_at IS NULL AND private_to IS NULL AND organization_id IS NOT NULL
    GROUP BY workspace_id, project_id, organization_id HAVING count(*) > 1
  ) d;
  SELECT count(*) INTO v_private FROM (
    SELECT 1 FROM public.conversation
    WHERE deleted_at IS NULL AND private_to IS NOT NULL AND organization_id IS NOT NULL
    GROUP BY workspace_id, project_id, organization_id, private_to HAVING count(*) > 1
  ) d;
  IF v_shared <> 0 OR v_private <> 0 THEN
    RAISE EXCEPTION 'conversations per organization are not unique: % shared, % private groups', v_shared, v_private;
  END IF;
END
$$;

CREATE UNIQUE INDEX conversation_project_organization_shared_uidx
  ON public.conversation (workspace_id, project_id, organization_id)
  WHERE deleted_at IS NULL AND private_to IS NULL AND organization_id IS NOT NULL;

CREATE UNIQUE INDEX conversation_project_organization_private_uidx
  ON public.conversation (workspace_id, project_id, organization_id, private_to)
  WHERE deleted_at IS NULL AND private_to IS NOT NULL AND organization_id IS NOT NULL;

-- ── 4 · doble escritura: sin persona no hay principal ─────────────────────
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
  WHERE conversation_id = NEW.id AND is_primary
    AND person_id IS DISTINCT FROM NEW.person_id;

  IF NEW.person_id IS NULL THEN
    RETURN NULL;
  END IF;

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

-- ── 5 · slug libre para una conversación ──────────────────────────────────
-- La base (el slug de la organización) llevada al formato de slug de la
-- conversación; si está reservada o la usa otra conversación viva del
-- espacio, con el sufijo del id.
CREATE FUNCTION public.conversation_free_slug(
  p_workspace_id uuid,
  p_base         text,
  p_id           uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_slug text := coalesce(
    nullif(rtrim(left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'), 63), '-'), ''),
    'conversation'
  );
BEGIN
  v_slug := ltrim(v_slug, '-');
  IF v_slug = '' THEN
    v_slug := 'conversation';
  END IF;
  IF public.is_reserved_slug(v_slug) OR EXISTS (
    SELECT 1 FROM public.conversation
    WHERE workspace_id = p_workspace_id AND slug = v_slug
      AND deleted_at IS NULL AND id <> p_id
  ) THEN
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || substring(replace(p_id::text, '-', '') from 1 for 6);
  END IF;
  RETURN v_slug;
END;
$$;
ALTER FUNCTION public.conversation_free_slug(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversation_free_slug(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 6 · create_conversation por organización ──────────────────────────────
DROP FUNCTION public.create_conversation(
  uuid, uuid, text, text, text, text, text, public.conversation_status, text,
  timestamp with time zone, text, uuid
);

CREATE FUNCTION public.create_conversation(
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
  p_line_id uuid DEFAULT NULL::uuid,
  p_organization_id uuid DEFAULT NULL::uuid
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
  v_org_name text := nullif(btrim(coalesce(p_organization_name, '')), '');
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_person_id uuid;
  v_person_slug text;
  v_person_name text;
  v_organization_id uuid;
  v_organization_slug text;
  v_existing uuid;
  v_conversation_id uuid;
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
  if v_role is not null and length(v_role) > 200 then
    raise exception 'role is too long' using errcode = '22023';
  end if;

  -- ── La organización que llega (por id o por nombre) ──
  if p_organization_id is not null then
    select id into v_organization_id
    from public.workspace_organization
    where workspace_id = v_workspace_id and id = p_organization_id and deleted_at is null;
    if v_organization_id is null then
      raise exception 'organization not found in target workspace' using errcode = '42501';
    end if;
  end if;

  -- ── La persona, si la hay: el contacto principal ──
  if p_person_id is not null then
    select wp.person_id, wp.slug, wp.full_name into v_person_id, v_person_slug, v_person_name
    from public.workspace_person wp
    where wp.workspace_id = v_workspace_id and wp.person_id = p_person_id
      and wp.deleted_at is null;
    if v_person_id is null then
      raise exception 'person not found in target workspace' using errcode = '42501';
    end if;
  elsif v_full_name is not null then
    if v_email is not null and v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'email is not valid' using errcode = '22023';
    end if;
    v_person_name := v_full_name;

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
  elsif p_organization_id is null and v_org_name is null then
    raise exception 'an organization or a person is required' using errcode = '22023';
  end if;

  -- ── Sin organización por id: por nombre, la del dossier, o una con el
  --    nombre de la persona (ADR-102, añadido, punto 1) ──
  if v_organization_id is null and v_org_name is null and v_person_id is not null then
    select o.id into v_organization_id
    from public.workspace_person wp
    join public.workspace_organization o
      on o.workspace_id = wp.workspace_id and o.id = wp.organization_id and o.deleted_at is null
    where wp.workspace_id = v_workspace_id and wp.person_id = v_person_id and wp.deleted_at is null;
    if v_organization_id is null then
      v_org_name := v_person_name;
    end if;
  end if;

  if v_organization_id is null then
    select id into v_organization_id
    from public.workspace_organization
    where workspace_id = v_workspace_id
      and lower(btrim(name)) = lower(v_org_name)
      and deleted_at is null
    limit 1;

    if v_organization_id is null then
      v_organization_id := public.uuid_generate_v7();
      v_organization_slug := coalesce(
        nullif(rtrim(left(public.slugify(v_org_name), 63), '-'), ''),
        'organization'
      );
      if exists (
        select 1 from public.workspace_organization
        where workspace_id = v_workspace_id and slug = v_organization_slug and deleted_at is null
      ) then
        v_organization_slug := rtrim(left(v_organization_slug, 56), '-') || '-' || substring(replace(v_organization_id::text, '-', '') from 1 for 6);
      end if;
      insert into public.workspace_organization (id, workspace_id, slug, name, created_by)
      values (v_organization_id, v_workspace_id, v_organization_slug, v_org_name, v_caller);
    end if;
  end if;

  select slug into v_organization_slug
  from public.workspace_organization where id = v_organization_id;

  -- ── El dossier: el alta en línea lo crea o lo revive; uno sin organización
  --    se queda la de esta conversación ──
  if v_full_name is not null and p_person_id is null then
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
  elsif v_person_id is not null then
    update public.workspace_person
    set organization_id = v_organization_id
    where workspace_id = v_workspace_id and person_id = v_person_id
      and organization_id is null;
  end if;

  -- ── Ya hay una viva que quien crea ve (compartida o privada suya) con esta
  --    organización: 409, con su id para que la pantalla la abra. Una privada
  --    de otro no cuenta ni se nombra. ──
  select id into v_existing
  from public.conversation
  where workspace_id = v_workspace_id and project_id = p_project_id
    and organization_id = v_organization_id and deleted_at is null
    and (private_to is null or private_to = v_caller)
  order by (private_to is null) desc, created_at
  limit 1;
  if v_existing is not null then
    raise exception 'this organization already has a conversation in this project'
      using errcode = '23505', detail = 'conversation_id=' || v_existing::text;
  end if;

  -- La unicidad vieja por persona sigue viva hasta el contract.
  if v_person_id is not null and exists (
    select 1 from public.conversation
    where workspace_id = v_workspace_id and project_id = p_project_id
      and person_id = v_person_id and deleted_at is null
      and (private_to is null or private_to = v_caller)
  ) then
    raise exception 'this person already has a conversation in this project'
      using errcode = '23505';
  end if;

  -- ── Revivir una borrada que quien crea podría ver: por organización, o por
  --    persona si es de antes de la organización. La más reciente. ──
  select * into v_conversation from public.conversation
  where workspace_id = v_workspace_id and project_id = p_project_id
    and deleted_at is not null
    and (private_to is null or private_to = v_caller)
    and (
      organization_id = v_organization_id
      or (organization_id is null and v_person_id is not null and person_id = v_person_id)
    )
  order by deleted_at desc, id desc
  limit 1;
  if v_conversation.id is not null then
    v_born_private := coalesce((
      select w.new_conversations_private from public.workspace w where w.id = v_workspace_id
    ), true);
    update public.conversation set
      deleted_at = null,
      slug = public.conversation_free_slug(v_workspace_id, v_organization_slug, v_conversation.id),
      previous_slugs = case
        when v_conversation.slug = public.conversation_free_slug(v_workspace_id, v_organization_slug, v_conversation.id)
          or v_conversation.slug = any (v_conversation.previous_slugs)
        then v_conversation.previous_slugs
        else v_conversation.previous_slugs || v_conversation.slug
      end,
      organization_id = v_organization_id,
      person_id = coalesce(v_person_id, person_id),
      status = p_status,
      role = case when v_person_id is not null then v_role else role end,
      last_contacted_at = now(),
      next_action_at = p_next_action_at,
      next_action_note = nullif(btrim(coalesce(p_next_action_note, '')), ''),
      line_id = p_line_id,
      private_to = case when v_born_private then v_caller else null end
    where id = v_conversation.id returning * into v_conversation;
    return v_conversation;
  end if;

  v_conversation_id := public.uuid_generate_v7();
  insert into public.conversation (
    id, slug, workspace_id, project_id, person_id, organization_id, line_id, status, role,
    first_contacted_at, last_contacted_at, next_action_at, next_action_note, created_by
  ) values (
    v_conversation_id,
    public.conversation_free_slug(v_workspace_id, v_organization_slug, v_conversation_id),
    v_workspace_id, p_project_id, v_person_id, v_organization_id, p_line_id, p_status,
    case when v_person_id is not null then v_role end,
    now(), now(), p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''), v_caller
  ) returning * into v_conversation;

  return v_conversation;
end;
$_$;

ALTER FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid, uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid, uuid) IS
  'ADR-102: create (or revive) the conversation of a project with an organization. Organization by id, by name, from the person''s dossier, or a new one named after the person. The person is optional: the primary contact. 23505 when the caller already sees a live one with that organization (DETAIL conversation_id=<uuid>) or, until the contract, with that person.';
REVOKE ALL ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid, uuid) TO authenticated;

-- ── 6b · set_conversation_contact: papel largo = 22023 ────────────────────
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
  IF v_role IS NOT NULL AND length(v_role) > 200 THEN
    RAISE EXCEPTION 'role is too long' USING ERRCODE = '22023';
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

-- ── 7 · correo ────────────────────────────────────────────────────────────
-- El hilo del proveedor de un correo ya registrado (regla del hilo).
CREATE INDEX conversation_event_mail_thread_idx
  ON public.conversation_event ((metadata ->> 'provider_thread_id'))
  WHERE source = 'email';

-- Las direcciones que este buzón busca: las de los contactos de las
-- conversaciones elegibles, vigentes o cerrados hace menos de 12 meses (para
-- traer su historial, ADR-100, y ver las respuestas a hilos que ya están).
-- Elegibilidad sin cambios: el personal, solo lo que su dueño lee (nunca una
-- privada de otro); el común, todo el espacio, privadas incluidas, y lo que
-- trae de una privada solo lo ve su dueño (el evento hereda la conversación).
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
  JOIN public.conversation_contact cc
    ON cc.conversation_id = c.id
   AND (cc.until IS NULL OR cc.until >= (current_date - interval '12 months')::date)
  JOIN public.workspace_person wp
    ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
   AND wp.deleted_at IS NULL AND wp.email IS NOT NULL
  WHERE a.id = p_account_id
    AND lower(wp.email::text) <> lower(a.address::text)
    AND public.mail_account_eligible_conversation(a, c);
$$;

-- Registra un correo en las conversaciones de sus contactos (ADR-102, añadido,
-- punto 4). Entra en una conversación elegible si alguna contraparte:
--   · por fechas: era contacto en el día del correo (en la zona del espacio);
--   · por hilo: es o fue contacto, y el correo sigue un hilo que ya tiene un
--     correo en esa conversación: mismo `provider_thread_id` en el mismo buzón
--     (el id de hilo de Gmail es por buzón), o un In-Reply-To/References que
--     nombra un correo suyo (cruza buzones: el personal y el común).
-- Idempotente como antes. p_message suma `in_reply_to` (texto) y `references`
-- (lista) a lo de 20261011200000. Devuelve cuántos eventos nuevos creó en
-- conversaciones que ve todo el que ve el buzón: lo que entra en una privada
-- no cuenta en el recuento del buzón (ADR-099 punto 4).
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
  v_thread     text := nullif(btrim(coalesce(p_message ->> 'provider_thread_id', '')), '');
  v_direction  public.conversation_event_direction;
  v_occurred   timestamptz;
  v_day        date;
  v_counter    text[];
  v_refs       text[];
  v_ref_base   text;
  v_created    integer := 0;
  v_visible    integer := 0;
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
  v_day := (v_occurred AT TIME ZONE coalesce(
    (SELECT w.timezone FROM public.workspace w WHERE w.id = v_acc.workspace_id), 'UTC'))::date;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}')
  INTO v_counter
  FROM jsonb_array_elements_text(coalesce(p_message -> 'counterparts', '[]'::jsonb)) AS x
  WHERE btrim(x) <> '';
  -- Los Message-ID a los que responde: In-Reply-To más References (los 50
  -- últimos bastan para encontrar el hilo).
  SELECT coalesce(array_agg(DISTINCT r), '{}')
  INTO v_refs
  FROM (
    SELECT btrim(x) AS r
    FROM jsonb_array_elements_text(
      CASE jsonb_typeof(p_message -> 'references') WHEN 'array' THEN p_message -> 'references' ELSE '[]'::jsonb END
    ) AS x
    WHERE btrim(x) <> '' AND length(x) <= 998
    UNION
    SELECT btrim(p_message ->> 'in_reply_to')
    WHERE btrim(coalesce(p_message ->> 'in_reply_to', '')) <> '' AND length(p_message ->> 'in_reply_to') <= 998
  ) refs
  WHERE r IS NOT NULL;
  IF cardinality(v_refs) > 50 THEN
    v_refs := v_refs[1:50];
  END IF;

  -- Ya procesado en este buzón: nada que hacer.
  INSERT INTO public.mail_message (mail_account_id, provider_message_id, provider_thread_id, rfc_message_id)
  VALUES (v_acc.id, v_msg_id, v_thread, v_rfc)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_ref_base := 'mail:' || coalesce(v_rfc, v_acc.provider::text || ':' || v_acc.id::text || ':' || v_msg_id);

  FOR v_conv IN
    SELECT c.* FROM public.conversation c
    WHERE c.workspace_id = v_acc.workspace_id
      AND public.mail_account_eligible_conversation(v_acc, c)
      AND EXISTS (
        SELECT 1
        FROM public.conversation_contact cc
        JOIN public.workspace_person wp
          ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
         AND wp.deleted_at IS NULL
        WHERE cc.conversation_id = c.id
          AND lower(wp.email::text) = ANY (v_counter)
          AND (
            -- Por fechas: un hilo nuevo, solo de quien era contacto ese día.
            ((cc.since IS NULL OR v_day >= cc.since) AND (cc.until IS NULL OR v_day <= cc.until))
            -- Por hilo: una respuesta a un hilo que ya está en la conversación.
            OR EXISTS (
              SELECT 1 FROM public.conversation_event e
              WHERE e.conversation_id = c.id AND e.source = 'email'
                AND v_thread IS NOT NULL
                AND e.metadata ->> 'provider_thread_id' = v_thread
                AND e.metadata ->> 'mail_account_id' = v_acc.id::text
            )
            OR EXISTS (
              SELECT 1 FROM public.conversation_event e
              WHERE e.workspace_id = c.workspace_id AND e.source = 'email'
                AND e.external_ref IN (
                  SELECT 'mail:' || r || '#' || c.id::text FROM unnest(v_refs) AS r
                )
            )
          )
      )
    ORDER BY c.id
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
        'provider_thread_id', v_thread,
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
      IF v_conv.private_to IS NULL
         OR (v_acc.scope = 'personal' AND v_conv.private_to = v_acc.owner_user_id) THEN
        v_visible := v_visible + 1;
      END IF;
      UPDATE public.conversation
      SET last_contacted_at = greatest(coalesce(last_contacted_at, v_occurred), v_occurred),
          first_contacted_at = coalesce(first_contacted_at, v_occurred)
      WHERE id = v_conv.id;
    END IF;
  END LOOP;

  UPDATE public.mail_message SET events_created = v_created
  WHERE mail_account_id = v_acc.id AND provider_message_id = v_msg_id;
  RETURN v_visible;
END;
$$;

-- Antes de enviar: ¿puede quien llama escribir a esta conversación desde este
-- buzón? Igual que en 20261011200000; los destinatarios posibles son ahora los
-- contactos vigentes con correo, el principal primero (el envío toma el
-- primero). El cliente nunca manda la dirección.
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
  FROM public.conversation_contact cc
  JOIN public.workspace_person wp
    ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
   AND wp.deleted_at IS NULL AND wp.email IS NOT NULL
  WHERE cc.conversation_id = v_conv.id
    AND (cc.since IS NULL OR cc.since <= current_date)
    AND (cc.until IS NULL OR cc.until >= current_date)
  ORDER BY cc.is_primary DESC, wp.full_name, wp.email;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the contact has no email address' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ── 8 · búsqueda por organización o por cualquier contacto ────────────────
-- PostgREST no resuelve un `or` sobre dos embeds; esta función sí, y como
-- devuelve filas de `conversation` admite los mismos embeds, filtros y orden
-- que la tabla. SECURITY INVOKER: corre con la RLS de quien llama (la
-- conversación, sus contactos, la organización y el dossier).
CREATE FUNCTION public.conversation_search(p_q text)
RETURNS SETOF public.conversation
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT c.*
  FROM public.conversation c
  WHERE nullif(btrim(coalesce(p_q, '')), '') IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.workspace_organization o
        WHERE o.workspace_id = c.workspace_id AND o.id = c.organization_id
          AND strpos(lower(o.name), lower(btrim(p_q))) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM public.conversation_contact cc
        JOIN public.workspace_person wp
          ON wp.workspace_id = cc.workspace_id AND wp.person_id = cc.person_id
        WHERE cc.conversation_id = c.id
          AND (strpos(lower(wp.full_name), lower(btrim(p_q))) > 0
               OR strpos(lower(coalesce(wp.email::text, '')), lower(btrim(p_q))) > 0)
      )
    );
$$;
ALTER FUNCTION public.conversation_search(text) OWNER TO postgres;
COMMENT ON FUNCTION public.conversation_search(text) IS
  'ADR-102: conversations whose organization name, or any contact''s name or email, contains p_q (case-insensitive). Runs with the caller''s RLS; returns conversation rows so PostgREST embeds and filters apply.';
REVOKE ALL ON FUNCTION public.conversation_search(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_search(text) TO authenticated;
