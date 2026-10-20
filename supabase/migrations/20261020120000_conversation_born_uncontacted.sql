-- ADR-138 E1, corrección: una conversación nace sin contacto.
--
-- `create_conversation` sellaba `first_contacted_at` y `last_contacted_at` con
-- now() al crear. Con la relación derivada (20261020100000), eso hacía que
-- toda sala recién añadida saliera «contactada» sin que nadie le hubiera
-- escrito: «nunca contactada» no podía darse. El contacto lo sellan los
-- eventos (ADR-098) y el primer correo; añadir una sala no es escribirle.
--
-- Cambian dos cosas: en el INSERT los dos sellos nacen NULL, y recuperar una
-- borrada conserva sus sellos (antes ponía last_contacted_at = now()). El
-- resto de la función es la de 20261011500000, igual. Las filas que ya
-- existen no se tocan: no se puede saber cuáles se crearon sin escribir.
-- Rollback: volver a aplicar la definición de 20261011500000.

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
      role = nullif(btrim(coalesce(p_role, '')), ''),
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
    null, null, p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''), v_caller
  ) returning * into v_conversation;

  return v_conversation;
end;
$_$;

ALTER FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid) TO authenticated;
