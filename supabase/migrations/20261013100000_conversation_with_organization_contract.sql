-- ADR-102 fase 4 · Contract: la conversación es con la organización, y sus
-- personas son contactos (plan: build/plans/2026-10-11-conversation-with-venue.md § Fase 4).
--
-- Destructiva. Requiere, antes, un deploy del Worker que ya no nombre
-- `conversation.person_id`, `conversation.role` ni `invoice.payer_person_id`
-- (embeds por `conversation_workspace_person_fkey` incluidos), y el gate de
-- § 34 completo: staging, `inspect`, backup, plan, apply.
--
--   1. Comprobaciones que abortan: cada conversación con persona tiene a esa
--      persona de contacto principal.
--   2. Organización para las que no la tienen: la del dossier de su persona, o
--      una con el nombre de la persona (ADR-102, añadido, punto 1). Aborta si
--      una no tiene ni una ni otra, o si dos del mismo proyecto acaban en la
--      misma organización (eso se revisa a mano).
--   3. `conversation.organization_id SET NOT NULL`; la unicidad por
--      organización deja de ser parcial.
--   4. Fuera la doble escritura (los dos triggers de la fase 1), la unicidad,
--      los índices y las FKs por persona, y las columnas `person_id` y `role`.
--   5. `create_conversation`, `set_conversation_contact` y
--      `add_conversation_contact` escriben el principal en
--      `conversation_contact` (`private.conversation_make_primary`).
--   6. Books: fuera `invoice.payer_person_id` (sin lector desde la fase 2b),
--      `p_payer_person_id` de `create_invoice_from_bolo` y `update_invoice`, y
--      `list_money_payers` (personas).
--
-- Rollback: build/runbooks/rollback-20261013-conversation-with-organization-contract.sql

-- ── 1 · Comprobaciones ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.conversation c
  WHERE c.person_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation_contact cc
      WHERE cc.conversation_id = c.id AND cc.person_id = c.person_id AND cc.is_primary
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'contract: % conversaciones con persona sin ese contacto principal', v_bad;
  END IF;
END
$$;

-- ── 2 · Organización para las que no la tienen ─────────────────────────────
ALTER TABLE public.conversation DISABLE TRIGGER conversation_set_updated_at;

DO $$
DECLARE
  r record;
  v_org uuid;
  v_slug text;
  v_filled integer := 0;
  v_created integer := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.workspace_id, c.person_id, c.created_by,
           btrim(wp.full_name) AS full_name, o.id AS dossier_org
    FROM public.conversation c
    LEFT JOIN public.workspace_person wp
      ON wp.workspace_id = c.workspace_id AND wp.person_id = c.person_id
    LEFT JOIN public.workspace_organization o
      ON o.workspace_id = wp.workspace_id AND o.id = wp.organization_id AND o.deleted_at IS NULL
    WHERE c.organization_id IS NULL
    ORDER BY c.created_at, c.id
  LOOP
    v_org := r.dossier_org;
    IF v_org IS NULL THEN
      IF nullif(r.full_name, '') IS NULL THEN
        RAISE EXCEPTION 'contract: la conversación % no tiene organización ni persona', r.id;
      END IF;
      SELECT id INTO v_org
      FROM public.workspace_organization
      WHERE workspace_id = r.workspace_id AND lower(btrim(name)) = lower(r.full_name)
        AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1;
      IF v_org IS NULL THEN
        v_org := public.uuid_generate_v7();
        v_slug := coalesce(nullif(rtrim(left(public.slugify(r.full_name), 63), '-'), ''), 'organization');
        IF EXISTS (
          SELECT 1 FROM public.workspace_organization
          WHERE workspace_id = r.workspace_id AND slug = v_slug AND deleted_at IS NULL
        ) THEN
          v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_org::text, '-', ''), 6);
        END IF;
        INSERT INTO public.workspace_organization (id, workspace_id, slug, name, created_by)
        VALUES (v_org, r.workspace_id, v_slug, r.full_name, r.created_by);
        v_created := v_created + 1;
      END IF;
      -- El dossier sin organización se queda la de su conversación, como en el alta.
      UPDATE public.workspace_person
      SET organization_id = v_org
      WHERE workspace_id = r.workspace_id AND person_id = r.person_id AND organization_id IS NULL;
    END IF;

    BEGIN
      UPDATE public.conversation SET organization_id = v_org WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'contract: la conversación % choca con otra de la misma organización en su proyecto; revisar a mano', r.id;
    END;
    v_filled := v_filled + 1;
  END LOOP;
  RAISE NOTICE 'contract: % conversaciones con organización nueva (% organizaciones creadas)', v_filled, v_created;
END
$$;

ALTER TABLE public.conversation ENABLE TRIGGER conversation_set_updated_at;

-- ── 3 · organization_id obligatoria; unicidad por organización sin parcial ─
ALTER TABLE public.conversation ALTER COLUMN organization_id SET NOT NULL;

DROP INDEX public.conversation_project_organization_shared_uidx;
DROP INDEX public.conversation_project_organization_private_uidx;
CREATE UNIQUE INDEX conversation_project_organization_shared_uidx
  ON public.conversation (workspace_id, project_id, organization_id)
  WHERE deleted_at IS NULL AND private_to IS NULL;
CREATE UNIQUE INDEX conversation_project_organization_private_uidx
  ON public.conversation (workspace_id, project_id, organization_id, private_to)
  WHERE deleted_at IS NULL AND private_to IS NOT NULL;

-- ── 4 · Fuera la persona de la conversación ────────────────────────────────
DROP TRIGGER conversation_fill_organization ON public.conversation;
DROP TRIGGER conversation_sync_primary_contact ON public.conversation;
DROP FUNCTION public.conversation_fill_organization();
DROP FUNCTION public.conversation_sync_primary_contact();

DROP INDEX public.conversation_project_person_shared_uidx;
DROP INDEX public.conversation_project_person_private_uidx;
DROP INDEX public.conversation_person_idx;
DROP INDEX public.conversation_workspace_person_idx;
ALTER TABLE public.conversation
  DROP CONSTRAINT conversation_workspace_person_fkey,
  DROP CONSTRAINT conversation_person_id_fkey,
  DROP COLUMN person_id,
  DROP COLUMN role;

-- ── 5 · El principal se escribe en conversation_contact ────────────────────
CREATE FUNCTION private.conversation_make_primary(
  p_conversation_id uuid, p_workspace_id uuid, p_person_id uuid, p_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.conversation_contact
  SET is_primary = false
  WHERE conversation_id = p_conversation_id AND is_primary AND person_id <> p_person_id;

  -- Quien ya era contacto vuelve vigente y principal; sin papel nuevo conserva el suyo.
  INSERT INTO public.conversation_contact (
    workspace_id, conversation_id, person_id, role, is_primary, created_by
  ) VALUES (
    p_workspace_id, p_conversation_id, p_person_id, nullif(btrim(p_role), ''), true, auth.uid()
  )
  ON CONFLICT (conversation_id, person_id) DO UPDATE
  SET is_primary = true,
      until = NULL,
      role = coalesce(EXCLUDED.role, conversation_contact.role);
END;
$function$;
REVOKE ALL ON FUNCTION private.conversation_make_primary(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- create_conversation
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
      last_contacted_at = now(),
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
    now(), now(), p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''), v_caller
  ) returning * into v_conversation;

  if v_person_id is not null then
    perform private.conversation_make_primary(v_conversation.id, v_workspace_id, v_person_id, v_role);
  end if;
  return v_conversation;
end;
$function$;

-- set_conversation_contact
CREATE OR REPLACE FUNCTION public.set_conversation_contact(p_conversation_id uuid, p_person_id uuid, p_role text DEFAULT NULL::text, p_since date DEFAULT NULL::date, p_is_primary boolean DEFAULT false)
 RETURNS conversation_contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- El principal no se degrada sin nombrar antes a otro.
  IF NOT v_primary AND EXISTS (
    SELECT 1 FROM public.conversation_contact
    WHERE conversation_id = v_conv.id AND person_id = p_person_id AND is_primary
  ) THEN
    RAISE EXCEPTION 'choose another primary contact first' USING ERRCODE = '22023';
  END IF;

  IF v_primary THEN
    UPDATE public.conversation_contact
    SET is_primary = false
    WHERE conversation_id = v_conv.id AND is_primary AND person_id <> p_person_id;
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
$function$;

-- add_conversation_contact
CREATE OR REPLACE FUNCTION public.add_conversation_contact(p_conversation_id uuid, p_full_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_role text DEFAULT NULL::text)
 RETURNS conversation_contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_conv      public.conversation := public.conversation_for_contact_write(p_conversation_id);
  v_caller    uuid := auth.uid();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email     extensions.citext := nullif(btrim(coalesce(p_email, '')), '')::extensions.citext;
  v_person_id uuid;
  v_slug      text;
BEGIN
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT wp.person_id INTO v_person_id
    FROM public.workspace_person wp
    WHERE wp.workspace_id = v_conv.workspace_id AND wp.email = v_email AND wp.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_person_id IS NULL THEN
    v_person_id := public.uuid_generate_v7();
    INSERT INTO public.person (id, slug, full_name, email, created_by)
    VALUES (
      v_person_id,
      'person-' || right(replace(v_person_id::text, '-', ''), 12),
      'Person ' || right(replace(v_person_id::text, '-', ''), 8),
      NULL,
      v_caller
    );
    v_slug := coalesce(nullif(rtrim(left(public.slugify(v_full_name), 63), '-'), ''), 'person');
    IF EXISTS (
      SELECT 1 FROM public.workspace_person wp
      WHERE wp.workspace_id = v_conv.workspace_id AND wp.slug = v_slug AND wp.deleted_at IS NULL
    ) THEN
      v_slug := rtrim(left(v_slug, 56), '-') || '-' || right(replace(v_person_id::text, '-', ''), 6);
    END IF;
    INSERT INTO public.workspace_person (
      workspace_id, person_id, slug, full_name, email, phone, organization_id, created_by
    ) VALUES (
      v_conv.workspace_id, v_person_id, v_slug, v_full_name, v_email,
      nullif(btrim(coalesce(p_phone, '')), ''), v_conv.organization_id, v_caller
    );
  END IF;

  -- La persona ya es contacto vigente: no se rehace nada (ni papel ni fechas).
  IF EXISTS (
    SELECT 1 FROM public.conversation_contact
    WHERE conversation_id = v_conv.id AND person_id = v_person_id AND until IS NULL
  ) THEN
    RETURN (SELECT cc FROM public.conversation_contact cc
            WHERE cc.conversation_id = v_conv.id AND cc.person_id = v_person_id);
  END IF;

  -- Un contacto cerrado vuelve con su `since` y, si no llega otro, su papel.
  RETURN public.set_conversation_contact(
    v_conv.id, v_person_id,
    coalesce(nullif(btrim(coalesce(p_role, '')), ''),
             (SELECT role FROM public.conversation_contact
              WHERE conversation_id = v_conv.id AND person_id = v_person_id)),
    (SELECT since FROM public.conversation_contact
     WHERE conversation_id = v_conv.id AND person_id = v_person_id),
    NOT EXISTS (
      SELECT 1 FROM public.conversation_contact
      WHERE conversation_id = v_conv.id AND is_primary
    )
  );
END;
$function$;

-- ── 6 · Books: fuera el pagador persona ────────────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.invoice
  WHERE payer_person_id IS NOT NULL AND payer_organization_id IS NULL;
  -- No aborta: el pagador es la organización desde la fase 2b; se avisa de
  -- cuántas facturas pierden una persona que no tenía organización al lado.
  RAISE NOTICE 'contract: % facturas con persona y sin organización pagadora', v_n;
END
$$;

DROP FUNCTION public.list_money_payers(uuid[], uuid[], integer);
DROP FUNCTION public.create_invoice_from_bolo(uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text, uuid);

DROP INDEX public.invoice_payer_person_idx;
DROP INDEX public.invoice_workspace_payer_person_idx;
ALTER TABLE public.invoice
  DROP CONSTRAINT invoice_workspace_payer_person_fkey,
  DROP CONSTRAINT invoice_payer_person_id_fkey,
  DROP COLUMN payer_person_id;

-- create_invoice_from_bolo
CREATE FUNCTION public.create_invoice_from_bolo(p_bolo_id uuid, p_tax_lines jsonb DEFAULT '[]'::jsonb, p_number text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_expected_on date DEFAULT NULL::date, p_payment_condition text DEFAULT NULL::text, p_doc_type text DEFAULT NULL::text, p_payer_fiscal_identity_id uuid DEFAULT NULL::uuid, p_country text DEFAULT NULL::text, p_payer_organization_id uuid DEFAULT NULL::uuid)
 RETURNS invoice
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_bolo public.bolo;
  v_ws public.workspace;
  v_project_name text;
  v_first_date date;
  v_inferred_org uuid;
  v_payer_org uuid;
  v_payer_fi uuid;
  v_doc_type text;
  v_country text;
  v_subtotal numeric;
  v_total numeric;
  v_desc text;
  v_invoice public.invoice;
  v_elem jsonb;
  v_label text;
  v_kind text;
  v_rate numeric;
  v_reason text;
  v_amount numeric;
  v_ordinal integer := 0;
  v_tax_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_tax_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'tax_lines must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND upper(btrim(p_country)) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country must be an ISO alpha-2 code' USING ERRCODE = '22023';
  END IF;
  IF p_payment_condition IS NOT NULL AND length(p_payment_condition) > 2000 THEN
    RAISE EXCEPTION 'payment_condition is too long' USING ERRCODE = '22023';
  END IF;
  IF p_doc_type IS NOT NULL AND p_doc_type NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'doc_type must be factura or proforma' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bolo
  FROM public.bolo
  WHERE id = p_bolo_id AND deleted_at IS NULL;

  IF v_bolo.id IS NULL THEN
    RAISE EXCEPTION 'bolo not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission(v_bolo.project_id, 'edit:money') THEN
    RAISE EXCEPTION 'edit:money required' USING ERRCODE = '42501';
  END IF;
  IF v_bolo.fee_amount IS NULL THEN
    RAISE EXCEPTION 'bolo has no fee — set the fee first' USING ERRCODE = '22023';
  END IF;
  IF p_expected_on IS NOT NULL AND p_expected_on < CURRENT_DATE THEN
    RAISE EXCEPTION 'expected_on cannot precede issued_on' USING ERRCODE = '22023';
  END IF;

  IF p_payer_organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_organization o
    WHERE o.workspace_id = v_bolo.workspace_id
      AND o.id = p_payer_organization_id
      AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payer organization is not in the bolo workspace' USING ERRCODE = '42501';
  END IF;

  IF p_payer_fiscal_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_identity fi
    WHERE fi.id = p_payer_fiscal_identity_id
      AND fi.workspace_id = v_bolo.workspace_id
      AND fi.kind = 'receiver'
      AND fi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'receiver fiscal identity is not a workspace receiver' USING ERRCODE = '42501';
  END IF;

  -- doc_type: explicit param wins; else derive from the workspace invoicing_mode
  -- (interno → proforma, legal/off → factura).
  SELECT * INTO v_ws FROM public.workspace WHERE id = v_bolo.workspace_id;
  v_doc_type := coalesce(
    p_doc_type,
    CASE WHEN v_ws.settings->>'invoicing_mode' = 'interno' THEN 'proforma' ELSE 'factura' END
  );

  -- country: the tax regime this document is snapshotted under. The app passes
  -- the resolved regime; fall back to the bolo's, then the workspace's.
  v_country := upper(nullif(btrim(coalesce(p_country, v_bolo.country, v_ws.country, '')), ''));

  SELECT name INTO v_project_name FROM public.project WHERE id = v_bolo.project_id;

  -- The deal may span several functions; date the line by the earliest one.
  SELECT min(pf.performed_at) INTO v_first_date
  FROM public.performance pf
  WHERE pf.bolo_id = v_bolo.id AND pf.deleted_at IS NULL;

  -- ADR-099 §4: nothing is inferred from someone else's private conversation.
  -- The same criterion as the conversation_select policy.
  SELECT organization_id INTO v_inferred_org
  FROM public.conversation
  WHERE id = v_bolo.conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);

  -- ADR-102 decision 5: the payer is the organization.
  v_payer_org := coalesce(p_payer_organization_id, v_inferred_org);
  IF v_payer_org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_organization o
    WHERE o.workspace_id = v_bolo.workspace_id AND o.id = v_payer_org AND o.deleted_at IS NULL
  ) THEN
    v_payer_org := NULL;
  END IF;

  -- Explicit receiver wins; else the organization's own, if still live.
  v_payer_fi := p_payer_fiscal_identity_id;
  IF v_payer_fi IS NULL AND v_payer_org IS NOT NULL THEN
    SELECT fi.id INTO v_payer_fi
    FROM public.workspace_organization o
    JOIN public.fiscal_identity fi
      ON fi.id = o.fiscal_identity_id
     AND fi.workspace_id = o.workspace_id
     AND fi.kind = 'receiver'
     AND fi.deleted_at IS NULL
    WHERE o.id = v_payer_org;
  END IF;

  v_subtotal := v_bolo.fee_amount;
  v_total := v_subtotal;

  -- Validate + compute each generic tax line. The per-country preset (app layer)
  -- decided which lines apply; the core just signs each and sums the total.
  FOR v_elem IN SELECT value FROM jsonb_array_elements(coalesce(p_tax_lines, '[]'::jsonb))
  LOOP
    v_label  := btrim(coalesce(v_elem->>'label', ''));
    v_kind   := coalesce(v_elem->>'kind', '');
    v_rate   := coalesce((v_elem->>'rate_pct')::numeric, 0);
    v_reason := nullif(btrim(coalesce(v_elem->>'exempt_reason', '')), '');

    IF v_label = '' THEN
      RAISE EXCEPTION 'tax line label is required' USING ERRCODE = '22023';
    END IF;
    IF v_kind NOT IN ('add', 'withhold', 'exempt') THEN
      RAISE EXCEPTION 'tax line kind must be add, withhold or exempt' USING ERRCODE = '22023';
    END IF;
    IF v_rate < 0 OR v_rate > 100 THEN
      RAISE EXCEPTION 'tax line rate must be between 0 and 100' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'exempt' AND v_reason IS NULL THEN
      RAISE EXCEPTION 'an exempt tax line needs a reason' USING ERRCODE = '22023';
    END IF;

    v_amount := CASE v_kind
      WHEN 'add'      THEN round(v_subtotal * v_rate / 100, 2)
      WHEN 'withhold' THEN -round(v_subtotal * v_rate / 100, 2)
      ELSE 0
    END;
    v_total := v_total + v_amount;

    v_tax_rows := v_tax_rows || jsonb_build_object(
      'label', v_label, 'kind', v_kind, 'rate_pct', v_rate,
      'base_amount', v_subtotal, 'amount', v_amount,
      'exempt_reason', v_reason, 'ordinal', v_ordinal
    );
    v_ordinal := v_ordinal + 1;
  END LOOP;

  v_desc := concat_ws(
    ' — ',
    coalesce(v_project_name, 'Performance'),
    nullif(concat_ws(', ', v_bolo.venue_name, v_bolo.city), ''),
    to_char(v_first_date, 'YYYY-MM-DD')
  );

  INSERT INTO public.invoice (
    workspace_id, project_id, number, due_on, expected_on, payment_condition,
    status, doc_type, country, subtotal, total,
    currency, payer_organization_id, payer_fiscal_identity_id, notes, created_by
  ) VALUES (
    v_bolo.workspace_id,
    v_bolo.project_id,
    nullif(btrim(coalesce(p_number, '')), ''),
    p_due_on,
    p_expected_on,
    nullif(btrim(coalesce(p_payment_condition, '')), ''),
    'draft',
    v_doc_type,
    v_country,
    v_subtotal,
    v_total,
    coalesce(v_bolo.fee_currency, 'EUR'),
    v_payer_org,
    v_payer_fi,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_caller
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line (
    workspace_id, invoice_id, bolo_id, description, quantity, unit_amount
  ) VALUES (
    v_bolo.workspace_id, v_invoice.id, v_bolo.id, v_desc, 1, v_subtotal
  );

  INSERT INTO public.invoice_tax_line (
    workspace_id, invoice_id, label, kind, rate_pct, base_amount, amount, exempt_reason, ordinal
  )
  SELECT
    v_bolo.workspace_id, v_invoice.id,
    e->>'label', e->>'kind', (e->>'rate_pct')::numeric,
    (e->>'base_amount')::numeric, (e->>'amount')::numeric,
    e->>'exempt_reason', (e->>'ordinal')::integer
  FROM jsonb_array_elements(v_tax_rows) AS e;

  RETURN v_invoice;
END;
$function$;

-- update_invoice
CREATE OR REPLACE FUNCTION public.update_invoice(p_invoice_id uuid, p_patch jsonb)
 RETURNS invoice
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_inv    public.invoice;
  v_status text;
  v_org    uuid;
  v_org_fi uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty patch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM public.invoice
  WHERE id = p_invoice_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_inv.id IS NULL OR NOT (
    (v_inv.project_id IS NOT NULL AND public.has_permission(v_inv.project_id, 'edit:money'))
    OR (v_inv.project_id IS NULL AND public.is_workspace_admin(v_inv.workspace_id))
  ) THEN
    RAISE EXCEPTION 'invoice not found or edit:money required' USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'number' THEN
    RAISE EXCEPTION 'invoice numbers are assigned by issue_invoice(), not by hand'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'status' THEN
    v_status := p_patch->>'status';
    IF v_status = 'issued' THEN
      RAISE EXCEPTION 'issue an invoice through issue_invoice() so it gets a real correlative and frozen snapshots'
        USING ERRCODE = '42501';
    END IF;
    IF v_status = 'paid' THEN
      RAISE EXCEPTION 'paid is derived from payments, not set directly' USING ERRCODE = '42501';
    END IF;
    IF v_status NOT IN ('draft', 'cancelled') THEN
      RAISE EXCEPTION 'status must be draft or cancelled' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ADR-102 phase 2b: the payer organization, on a draft only (an issued
  -- invoice froze its payer). Setting it also sets the receiver fiscal
  -- identity to the organization's own (null if it has none, or on clear):
  -- re-setting the same organization after adding its fiscal data is how a
  -- draft picks them up before issue_invoice freezes them.
  IF p_patch ? 'payer_organization_id' THEN
    IF v_inv.status <> 'draft' THEN
      RAISE EXCEPTION 'the payer can only change on a draft' USING ERRCODE = '22023';
    END IF;
    v_org := nullif(p_patch->>'payer_organization_id', '')::uuid;
    IF v_org IS NOT NULL THEN
      SELECT o.id, fi.id INTO v_org, v_org_fi
      FROM public.workspace_organization o
      LEFT JOIN public.fiscal_identity fi
        ON fi.id = o.fiscal_identity_id
       AND fi.workspace_id = o.workspace_id
       AND fi.kind = 'receiver'
       AND fi.deleted_at IS NULL
      WHERE o.id = v_org
        AND o.workspace_id = v_inv.workspace_id
        AND o.deleted_at IS NULL;
      IF v_org IS NULL THEN
        RAISE EXCEPTION 'payer organization is not in the invoice workspace' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  UPDATE public.invoice SET
    status = CASE WHEN p_patch ? 'status'
      THEN (p_patch->>'status')::public.invoice_status ELSE status END,
    due_on = CASE WHEN p_patch ? 'due_on'
      THEN nullif(p_patch->>'due_on', '')::date ELSE due_on END,
    expected_on = CASE WHEN p_patch ? 'expected_on'
      THEN nullif(p_patch->>'expected_on', '')::date ELSE expected_on END,
    payment_condition = CASE WHEN p_patch ? 'payment_condition'
      THEN nullif(btrim(coalesce(p_patch->>'payment_condition', '')), '') ELSE payment_condition END,
    payer_organization_id = CASE WHEN p_patch ? 'payer_organization_id'
      THEN v_org ELSE payer_organization_id END,
    payer_fiscal_identity_id = CASE WHEN p_patch ? 'payer_organization_id'
      THEN v_org_fi ELSE payer_fiscal_identity_id END,
    notes = CASE WHEN p_patch ? 'notes'
      THEN nullif(btrim(coalesce(p_patch->>'notes', '')), '') ELSE notes END
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, text, uuid, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, text, uuid, text, uuid
) TO authenticated;
