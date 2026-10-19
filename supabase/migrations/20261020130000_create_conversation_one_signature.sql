-- ADR-138 E1, arreglo de 20261020120000.
--
-- 20261020120000 redefinió `create_conversation` partiendo de la firma de
-- 20261011500000 (12 argumentos), pero la viva era la de 20261013100000
-- (13, con p_organization_id). CREATE OR REPLACE con otra firma crea una
-- sobrecarga: PostgREST no sabe cuál llamar (300) y crear una conversación
-- dejó de funcionar. Aquí se borra la de 12 y se aplica el cambio a la de 13:
-- la conversación nace sin sello de contacto y recuperar una borrada conserva
-- los suyos. El cuerpo es el de 20261013100000 con solo esas dos líneas.

DROP FUNCTION public.create_conversation(uuid, uuid, text, text, text, text, text, public.conversation_status, text, timestamp with time zone, text, uuid);

CREATE OR REPLACE FUNCTION public.create_conversation(p_project_id uuid, p_person_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_organization_name text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_status conversation_status DEFAULT 'contacted'::conversation_status, p_role text DEFAULT NULL::text, p_next_action_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_next_action_note text DEFAULT NULL::text, p_line_id uuid DEFAULT NULL::uuid, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS conversation
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
        'person-' || right(replace(v_person_id::text, '-', ''), 12),
        'Person ' || right(replace(v_person_id::text, '-', ''), 8),
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
      v_person_slug := rtrim(left(v_person_slug, 56), '-') || '-' || right(replace(v_person_id::text, '-', ''), 6);
    end if;
  elsif p_organization_id is null and v_org_name is null then
    raise exception 'an organization or a person is required' using errcode = '22023';
  end if;

  -- ── La misma persona otra vez sin nombrar organización, siendo ya la
  --    principal de una viva del proyecto que quien crea ve: 409, como hacía
  --    la unicidad por persona antes del contract. ──
  if p_organization_id is null and v_org_name is null and v_person_id is not null and exists (
    select 1 from public.conversation c
    where c.workspace_id = v_workspace_id and c.project_id = p_project_id
      and c.deleted_at is null
      and (c.private_to is null or c.private_to = v_caller)
      and exists (
        select 1 from public.conversation_contact cc
        where cc.conversation_id = c.id and cc.person_id = v_person_id and cc.is_primary
      )
  ) then
    raise exception 'this person already has a conversation in this project'
      using errcode = '23505';
  end if;

  -- ── Sin organización por id: por nombre, la del dossier, o una con el
  --    nombre de la persona (ADR-102, añadido, punto 1) ──
  -- Volver a añadir a una persona sin nombrar organización: se recupera la
  -- última conversación borrada del proyecto en la que era el contacto
  -- principal (que quien crea podría ver), con la organización que tenía,
  -- aunque el dossier diga hoy otra. Solo si esa organización sigue viva y no
  -- tiene ya otra conversación viva en el proyecto (20261011900000).
  if v_organization_id is null and v_org_name is null and v_person_id is not null then
    select c.organization_id into v_organization_id
    from public.conversation c
    join public.workspace_organization o
      on o.workspace_id = c.workspace_id and o.id = c.organization_id and o.deleted_at is null
    where c.workspace_id = v_workspace_id and c.project_id = p_project_id
      and c.deleted_at is not null
      and exists (
        select 1 from public.conversation_contact cc
        where cc.conversation_id = c.id and cc.person_id = v_person_id and cc.is_primary
      )
      and (c.private_to is null or c.private_to = v_caller)
      and not exists (
        select 1 from public.conversation l
        where l.workspace_id = c.workspace_id and l.project_id = c.project_id
          and l.organization_id = c.organization_id and l.deleted_at is null
      )
    order by c.deleted_at desc, c.id desc
    limit 1;
  end if;

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
        v_organization_slug := rtrim(left(v_organization_slug, 56), '-') || '-' || right(replace(v_organization_id::text, '-', ''), 6);
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

  -- ── Revivir una borrada que quien crea podría ver, por organización. La
  --    más reciente; conserva sus contactos. ──
  select * into v_conversation from public.conversation
  where workspace_id = v_workspace_id and project_id = p_project_id
    and deleted_at is not null
    and (private_to is null or private_to = v_caller)
    and organization_id = v_organization_id
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
      status = p_status,
      next_action_at = p_next_action_at,
      next_action_note = nullif(btrim(coalesce(p_next_action_note, '')), ''),
      line_id = p_line_id,
      private_to = case when v_born_private then v_caller else null end
    where id = v_conversation.id returning * into v_conversation;
    -- Sin persona nueva se queda la principal de antes.
    if v_person_id is not null then
      perform private.conversation_make_primary(v_conversation.id, v_workspace_id, v_person_id, v_role);
    end if;
    return v_conversation;
  end if;

  v_conversation_id := public.uuid_generate_v7();
  insert into public.conversation (
    id, slug, workspace_id, project_id, organization_id, line_id, status,
    first_contacted_at, last_contacted_at, next_action_at, next_action_note, created_by
  ) values (
    v_conversation_id,
    public.conversation_free_slug(v_workspace_id, v_organization_slug, v_conversation_id),
    v_workspace_id, p_project_id, v_organization_id, p_line_id, p_status,
    null, null, p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''), v_caller
  ) returning * into v_conversation;

  if v_person_id is not null then
    perform private.conversation_make_primary(v_conversation.id, v_workspace_id, v_person_id, v_role);
  end if;
  return v_conversation;
end;
$function$;
