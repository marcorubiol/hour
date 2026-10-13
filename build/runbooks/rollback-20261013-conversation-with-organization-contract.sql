-- ROLLBACK for 20261013100000_conversation_with_organization_contract.sql (ADR-102 fase 4)
--
-- Vuelve a poner `conversation.person_id` y `conversation.role` (nullable),
-- rellenos desde el contacto principal; repone sus FKs, índices, la unicidad
-- por persona, los grants por columnas y la doble escritura de la fase 1; y
-- devuelve create_conversation, set_conversation_contact,
-- add_conversation_contact, create_invoice_from_bolo (12 parámetros, con
-- p_payer_person_id), update_invoice y list_money_payers a sus cuerpos de
-- antes del contract. `invoice.payer_person_id` vuelve vacía.
--
-- ANTES: nada del Worker. El Worker de la fase 4 no nombra estas columnas y
-- llama a create_invoice_from_bolo sin p_payer_person_id, que la firma de 12
-- también acepta.
--
-- DATA LOST: `invoice.payer_person_id` de antes del contract (sin lector
-- desde la fase 2b). `role` vuelve con el papel del contacto principal. Una
-- conversación sin principal vuelve con person_id nulo. ABORTA si la
-- unicidad por persona no se cumple (una persona principal de dos
-- conversaciones vivas del mismo proyecto, posible desde el contract):
-- revisar a mano antes.
-- Las organizaciones creadas por el relleno del contract se quedan.

BEGIN;

ALTER TABLE public.conversation
  ADD COLUMN person_id uuid,
  ADD COLUMN role text;

ALTER TABLE public.conversation DISABLE TRIGGER conversation_set_updated_at;
UPDATE public.conversation c
SET person_id = cc.person_id, role = cc.role
FROM public.conversation_contact cc
WHERE cc.conversation_id = c.id AND cc.is_primary;
ALTER TABLE public.conversation ENABLE TRIGGER conversation_set_updated_at;

ALTER TABLE public.conversation
  ADD CONSTRAINT conversation_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.person(id) ON DELETE RESTRICT,
  ADD CONSTRAINT conversation_workspace_person_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES public.workspace_person(workspace_id, person_id);
CREATE INDEX conversation_person_idx ON public.conversation USING btree (person_id) WHERE (deleted_at IS NULL);
CREATE INDEX conversation_workspace_person_idx ON public.conversation USING btree (workspace_id, person_id);
CREATE UNIQUE INDEX conversation_project_person_shared_uidx
  ON public.conversation (workspace_id, project_id, person_id)
  WHERE deleted_at IS NULL AND private_to IS NULL;
CREATE UNIQUE INDEX conversation_project_person_private_uidx
  ON public.conversation (workspace_id, project_id, person_id, private_to)
  WHERE deleted_at IS NULL AND private_to IS NOT NULL;

ALTER TABLE public.conversation ALTER COLUMN organization_id DROP NOT NULL;
DROP INDEX public.conversation_project_organization_shared_uidx;
DROP INDEX public.conversation_project_organization_private_uidx;
CREATE UNIQUE INDEX conversation_project_organization_shared_uidx
  ON public.conversation (workspace_id, project_id, organization_id)
  WHERE deleted_at IS NULL AND private_to IS NULL AND organization_id IS NOT NULL;
CREATE UNIQUE INDEX conversation_project_organization_private_uidx
  ON public.conversation (workspace_id, project_id, organization_id, private_to)
  WHERE deleted_at IS NULL AND private_to IS NOT NULL AND organization_id IS NOT NULL;

GRANT INSERT (person_id, role) ON TABLE public.conversation TO authenticated;
GRANT UPDATE (person_id, role) ON TABLE public.conversation TO authenticated;

CREATE OR REPLACE FUNCTION public.conversation_fill_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.conversation_sync_primary_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.conversation_fill_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_sync_primary_contact() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conversation_fill_organization
BEFORE INSERT OR UPDATE OF person_id ON public.conversation
FOR EACH ROW EXECUTE FUNCTION public.conversation_fill_organization();
CREATE TRIGGER conversation_sync_primary_contact
AFTER INSERT OR UPDATE OF person_id, role ON public.conversation
FOR EACH ROW EXECUTE FUNCTION public.conversation_sync_primary_contact();

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

  -- ── Sin organización por id: por nombre, la del dossier, o una con el
  --    nombre de la persona (ADR-102, añadido, punto 1) ──
  -- Volver a añadir a una persona sin nombrar organización: se recupera la
  -- última conversación borrada del proyecto en la que era la principal (que
  -- quien crea podría ver), con la organización que tenía, aunque el dossier
  -- diga hoy otra. Solo si esa organización sigue viva y no tiene ya otra
  -- conversación viva en el proyecto (20261011900000).
  if v_organization_id is null and v_org_name is null and v_person_id is not null then
    select c.organization_id into v_organization_id
    from public.conversation c
    join public.workspace_organization o
      on o.workspace_id = c.workspace_id and o.id = c.organization_id and o.deleted_at is null
    where c.workspace_id = v_workspace_id and c.project_id = p_project_id
      and c.person_id = v_person_id and c.deleted_at is not null
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
      -- Sin persona nueva se queda la principal de antes, salvo que esa
      -- persona ya sea la principal de otra viva del proyecto (la unicidad
      -- vieja por persona): entonces revive sin principal.
      person_id = case
        when v_person_id is not null then v_person_id
        when exists (
          select 1 from public.conversation o
          where o.workspace_id = v_workspace_id and o.project_id = p_project_id
            and o.person_id = v_conversation.person_id and o.deleted_at is null
            and o.id <> v_conversation.id
        ) then null
        else person_id
      end,
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
$function$;

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
$function$;

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
    v_conv.person_id IS NULL
  );
END;
$function$;

DROP FUNCTION private.conversation_make_primary(uuid, uuid, uuid, text);

-- Books
ALTER TABLE public.invoice
  ADD COLUMN payer_person_id uuid,
  ADD CONSTRAINT invoice_payer_person_id_fkey FOREIGN KEY (payer_person_id) REFERENCES public.person(id) ON DELETE SET NULL,
  ADD CONSTRAINT invoice_workspace_payer_person_fkey FOREIGN KEY (workspace_id, payer_person_id) REFERENCES public.workspace_person(workspace_id, person_id);
CREATE INDEX invoice_payer_person_idx ON public.invoice USING btree (payer_person_id);
CREATE INDEX invoice_workspace_payer_person_idx ON public.invoice USING btree (workspace_id, payer_person_id) WHERE (payer_person_id IS NOT NULL);

DROP FUNCTION public.create_invoice_from_bolo(uuid, jsonb, text, date, text, date, text, text, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.create_invoice_from_bolo(p_bolo_id uuid, p_tax_lines jsonb DEFAULT '[]'::jsonb, p_number text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_expected_on date DEFAULT NULL::date, p_payment_condition text DEFAULT NULL::text, p_payer_person_id uuid DEFAULT NULL::uuid, p_doc_type text DEFAULT NULL::text, p_payer_fiscal_identity_id uuid DEFAULT NULL::uuid, p_country text DEFAULT NULL::text, p_payer_organization_id uuid DEFAULT NULL::uuid)
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
  v_inferred_payer uuid;
  v_inferred_org uuid;
  v_payer uuid;
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

  -- Legacy person payer (the Worker before phase 2b). Dropped in phase 4.
  IF p_payer_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_person wp
    WHERE wp.workspace_id = v_bolo.workspace_id
      AND wp.person_id = p_payer_person_id
      AND wp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payer is not in the bolo workspace' USING ERRCODE = '42501';
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
  SELECT person_id, organization_id INTO v_inferred_payer, v_inferred_org
  FROM public.conversation
  WHERE id = v_bolo.conversation_id AND deleted_at IS NULL
    AND (private_to IS NULL OR private_to = v_caller);

  v_payer := coalesce(p_payer_person_id, v_inferred_payer);

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
    currency, payer_person_id, payer_organization_id, payer_fiscal_identity_id, notes, created_by
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
    v_payer,
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

REVOKE ALL ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bolo(
  uuid, jsonb, text, date, text, date, text, uuid, text, uuid, text, uuid
) TO authenticated;

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
    payer_person_id = CASE WHEN p_patch ? 'payer_person_id'
      THEN nullif(p_patch->>'payer_person_id', '')::uuid ELSE payer_person_id END,
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

CREATE OR REPLACE FUNCTION public.list_money_payers(p_project_ids uuid[] DEFAULT NULL::uuid[], p_workspace_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, workspace_id uuid, slug text, full_name text, organization_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_projects uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  v_projects := public.accessible_project_ids('edit:money');

  RETURN QUERY
  SELECT DISTINCT ON (wp.workspace_id, wp.person_id)
    wp.person_id,
    wp.workspace_id,
    wp.slug,
    wp.full_name,
    org.name
  FROM public.conversation c
  JOIN public.workspace_person wp
    ON wp.workspace_id = c.workspace_id
   AND wp.person_id = c.person_id
   AND wp.deleted_at IS NULL
  LEFT JOIN public.workspace_organization org
    ON org.workspace_id = wp.workspace_id
   AND org.id = wp.organization_id
   AND org.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.project_id = ANY (v_projects)
    -- ADR-099 §4: una conversación privada solo la ve su dueño. El mismo
    -- criterio que la política conversation_select.
    AND (c.private_to IS NULL OR c.private_to = auth.uid())
    AND (
      (
        coalesce(cardinality(p_project_ids), 0) = 0
        AND coalesce(cardinality(p_workspace_ids), 0) = 0
      )
      OR c.project_id = ANY (coalesce(p_project_ids, '{}'::uuid[]))
      OR c.workspace_id = ANY (coalesce(p_workspace_ids, '{}'::uuid[]))
    )
  ORDER BY wp.workspace_id, wp.person_id, wp.full_name
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_money_payers(uuid[], uuid[], integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_money_payers(uuid[], uuid[], integer) TO authenticated;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261013100000';

COMMIT;
