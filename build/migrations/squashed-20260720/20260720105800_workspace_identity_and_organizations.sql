-- Hour identity boundary — additive phase.
--
-- One human keeps one opaque `person.id` across Hour, while contact data is
-- owned by each workspace in `workspace_person`. A signed-in human controls a
-- portable profile in `user_profile` and may explicitly share/synchronise it
-- with any workspace they have accepted. Organizations are first-class and
-- remain distinct from venues (a legal/social body is not a physical place).

begin;

--------------------------------------------------------------------------------
-- 1. Portable, user-owned profile
--------------------------------------------------------------------------------

alter table public.user_profile
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists city text,
  add column if not exists country char(2),
  add column if not exists languages text[] not null default '{}',
  add column if not exists professional_title text,
  add column if not exists bio text;

alter table public.user_profile
  drop constraint if exists user_profile_country_format;
alter table public.user_profile
  add constraint user_profile_country_format
  check (country is null or country ~ '^[A-Z]{2}$');

-- The privileged-column hardening migration intentionally revoked the broad
-- table UPDATE grant. Extend its allow-list only with user-owned profile data;
-- `person_id` and `is_platform_admin` remain non-user-writable.
revoke update on table public.user_profile from authenticated;
grant update (
  full_name, avatar_url, locale, first_name, last_name, phone, website, city,
  country, languages, professional_title, bio
) on table public.user_profile to authenticated;

--------------------------------------------------------------------------------
-- 2. Workspace-owned organizations and person dossiers
--------------------------------------------------------------------------------

create table public.workspace_organization (
  id uuid primary key default public.uuid_generate_v7(),
  workspace_id uuid not null references public.workspace (id) on delete cascade,
  slug text not null,
  name text not null,
  kind text not null default 'other',
  email extensions.citext,
  phone text,
  website text,
  address text,
  city text,
  country char(2),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workspace_organization_name_nonempty check (length(btrim(name)) > 0),
  constraint workspace_organization_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint workspace_organization_kind_check check (
    kind in ('company', 'festival', 'theatre', 'presenter', 'agency', 'institution', 'other')
  ),
  constraint workspace_organization_country_format
    check (country is null or country ~ '^[A-Z]{2}$')
);

create unique index workspace_organization_slug_key
  on public.workspace_organization (workspace_id, slug)
  where deleted_at is null;
create unique index workspace_organization_name_key
  on public.workspace_organization (workspace_id, lower(btrim(name)))
  where deleted_at is null;
create index workspace_organization_workspace_idx
  on public.workspace_organization (workspace_id)
  where deleted_at is null;

-- `id` is globally unique, but the tenant pair is the key referenced by
-- workspace_person so a mismatched organization can never cross workspaces.
alter table public.workspace_organization
  add constraint workspace_organization_workspace_id_id_key unique (workspace_id, id);

create table public.workspace_person (
  workspace_id uuid not null references public.workspace (id) on delete cascade,
  person_id uuid not null references public.person (id) on delete cascade,
  slug text not null,
  full_name text not null,
  first_name text,
  last_name text,
  email extensions.citext,
  phone text,
  website text,
  city text,
  country char(2),
  languages text[] not null default '{}',
  organization_id uuid,
  title text,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  profile_sync_enabled boolean not null default false,
  profile_shared_fields text[] not null default '{}',
  profile_shared_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (workspace_id, person_id),
  constraint workspace_person_organization_fkey
    foreign key (workspace_id, organization_id)
    references public.workspace_organization (workspace_id, id)
    on delete set null,
  constraint workspace_person_name_nonempty check (length(btrim(full_name)) > 0),
  constraint workspace_person_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint workspace_person_country_format
    check (country is null or country ~ '^[A-Z]{2}$')
);

create unique index workspace_person_slug_key
  on public.workspace_person (workspace_id, slug)
  where deleted_at is null;
create index workspace_person_email_idx
  on public.workspace_person (workspace_id, email)
  where deleted_at is null and email is not null;
create index workspace_person_organization_idx
  on public.workspace_person (workspace_id, organization_id)
  where organization_id is not null;

comment on table public.person is
  'Opaque global human identity. Workspace-owned contact data lives in workspace_person; signed-in portable data lives in user_profile.';
comment on table public.workspace_person is
  'A workspace-private dossier for one global person identity. No fields are copied from another workspace.';
comment on table public.workspace_organization is
  'Workspace-owned company/festival/theatre/institution. Distinct from venue, which is a physical place.';
comment on column public.workspace_person.profile_sync_enabled is
  'True only after the linked user explicitly shares their portable profile with this workspace.';

create trigger workspace_organization_set_updated_at
  before update on public.workspace_organization
  for each row execute function public.set_updated_at();
create trigger workspace_person_set_updated_at
  before update on public.workspace_person
  for each row execute function public.set_updated_at();

--------------------------------------------------------------------------------
-- 3. Backfill: copy the current global dossier once into every workspace that
-- already has an operational relationship with the person.
--------------------------------------------------------------------------------

with person_workspaces as (
  select workspace_id, person_id from public.conversation
  union select workspace_id, person_id from public.cast_member
  union select workspace_id, person_id from public.crew_assignment
  union select workspace_id, person_id from public.cast_override
  union select workspace_id, replaces_person_id from public.cast_override where replaces_person_id is not null
  union select workspace_id, person_id from public.person_note
  union select workspace_id, person_id from public.availability_block where person_id is not null
  union select workspace_id, payer_person_id from public.invoice where payer_person_id is not null
), organization_names as (
  select
    pw.workspace_id,
    lower(btrim(p.organization_name)) as normalized_name,
    min(btrim(p.organization_name)) as name
  from person_workspaces pw
  join public.person p on p.id = pw.person_id
  where nullif(btrim(p.organization_name), '') is not null
  group by pw.workspace_id, lower(btrim(p.organization_name))
), prepared as (
  select
    public.uuid_generate_v7() as id,
    workspace_id,
    name,
    coalesce(nullif(public.slugify(name), ''), 'organization') as base_slug
  from organization_names
), ranked as (
  select *, row_number() over (partition by workspace_id, base_slug order by name) as slug_rank
  from prepared
)
insert into public.workspace_organization (id, workspace_id, slug, name)
select
  id,
  workspace_id,
  case
    when slug_rank = 1 then coalesce(nullif(rtrim(left(base_slug, 63), '-'), ''), 'organization')
    else rtrim(left(base_slug, 56), '-') || '-' || substring(replace(id::text, '-', '') from 1 for 6)
  end,
  name
from ranked
on conflict do nothing;

with person_workspaces as (
  select workspace_id, person_id from public.conversation
  union select workspace_id, person_id from public.cast_member
  union select workspace_id, person_id from public.crew_assignment
  union select workspace_id, person_id from public.cast_override
  union select workspace_id, replaces_person_id from public.cast_override where replaces_person_id is not null
  union select workspace_id, person_id from public.person_note
  union select workspace_id, person_id from public.availability_block where person_id is not null
  union select workspace_id, payer_person_id from public.invoice where payer_person_id is not null
)
insert into public.workspace_person (
  workspace_id, person_id, slug, full_name, first_name, last_name, email, phone,
  website, city, country, languages, organization_id, title, custom_fields,
  created_by, created_at, updated_at, deleted_at
)
select
  pw.workspace_id,
  p.id,
  p.slug,
  p.full_name,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  p.website,
  p.city,
  p.country,
  p.languages,
  o.id,
  p.title,
  p.custom_fields,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.deleted_at
from person_workspaces pw
join public.person p on p.id = pw.person_id
left join public.workspace_organization o
  on o.workspace_id = pw.workspace_id
 and lower(btrim(o.name)) = lower(btrim(p.organization_name))
 and o.deleted_at is null
on conflict (workspace_id, person_id) do nothing;

--------------------------------------------------------------------------------
-- 4. Make the tenant boundary structural, not merely conventional.
--------------------------------------------------------------------------------

alter table public.conversation
  add constraint conversation_workspace_person_fkey
  foreign key (workspace_id, person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.cast_member
  add constraint cast_member_workspace_person_fkey
  foreign key (workspace_id, person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.crew_assignment
  add constraint crew_assignment_workspace_person_fkey
  foreign key (workspace_id, person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.cast_override
  add constraint cast_override_workspace_person_fkey
  foreign key (workspace_id, person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.cast_override
  add constraint cast_override_workspace_replaces_person_fkey
  foreign key (workspace_id, replaces_person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.person_note
  add constraint person_note_workspace_person_fkey
  foreign key (workspace_id, person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.availability_block
  add constraint availability_block_workspace_person_fkey
  foreign key (workspace_id, person_id)
  references public.workspace_person (workspace_id, person_id);
alter table public.invoice
  add constraint invoice_workspace_payer_person_fkey
  foreign key (workspace_id, payer_person_id)
  references public.workspace_person (workspace_id, person_id);

-- PostgreSQL does not create indexes on the referencing side of a foreign
-- key. These pairs are also the natural tenant-scoped lookup path, and avoid
-- full child-table scans when a workspace_person row is validated or removed.
create index conversation_workspace_person_idx
  on public.conversation (workspace_id, person_id);
create index cast_member_workspace_person_idx
  on public.cast_member (workspace_id, person_id);
create index crew_assignment_workspace_person_idx
  on public.crew_assignment (workspace_id, person_id);
create index cast_override_workspace_person_idx
  on public.cast_override (workspace_id, person_id);
create index cast_override_workspace_replaces_person_idx
  on public.cast_override (workspace_id, replaces_person_id)
  where replaces_person_id is not null;
create index person_note_workspace_person_idx
  on public.person_note (workspace_id, person_id);
create index availability_block_workspace_person_idx
  on public.availability_block (workspace_id, person_id)
  where person_id is not null;
create index invoice_workspace_payer_person_idx
  on public.invoice (workspace_id, payer_person_id)
  where payer_person_id is not null;

--------------------------------------------------------------------------------
-- 5. RLS and explicit Data API grants (new Supabase projects no longer
-- auto-expose public objects).
--------------------------------------------------------------------------------

alter table public.workspace_organization enable row level security;
alter table public.workspace_organization force row level security;
alter table public.workspace_person enable row level security;
alter table public.workspace_person force row level security;

create policy workspace_organization_select on public.workspace_organization
  for select to authenticated
  using (deleted_at is null and public.is_workspace_member(workspace_id));
create policy workspace_organization_insert on public.workspace_organization
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.workspace_membership m
      where m.workspace_id = workspace_organization.workspace_id
        and m.user_id = auth.uid() and m.accepted_at is not null
        and m.role in ('owner', 'admin', 'member')
    )
  );
create policy workspace_organization_update on public.workspace_organization
  for update to authenticated
  using (
    deleted_at is null and exists (
      select 1 from public.workspace_membership m
      where m.workspace_id = workspace_organization.workspace_id
        and m.user_id = auth.uid() and m.accepted_at is not null
        and m.role in ('owner', 'admin', 'member')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_membership m
      where m.workspace_id = workspace_organization.workspace_id
        and m.user_id = auth.uid() and m.accepted_at is not null
        and m.role in ('owner', 'admin', 'member')
    )
  );

create policy workspace_person_select on public.workspace_person
  for select to authenticated
  using (deleted_at is null and public.is_workspace_member(workspace_id));
create policy workspace_person_insert on public.workspace_person
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.workspace_membership m
      where m.workspace_id = workspace_person.workspace_id
        and m.user_id = auth.uid() and m.accepted_at is not null
        and m.role in ('owner', 'admin', 'member')
    )
  );
create policy workspace_person_update on public.workspace_person
  for update to authenticated
  using (
    deleted_at is null and exists (
      select 1 from public.workspace_membership m
      where m.workspace_id = workspace_person.workspace_id
        and m.user_id = auth.uid() and m.accepted_at is not null
        and m.role in ('owner', 'admin', 'member')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_membership m
      where m.workspace_id = workspace_person.workspace_id
        and m.user_id = auth.uid() and m.accepted_at is not null
        and m.role in ('owner', 'admin', 'member')
    )
  );

revoke all on table public.workspace_organization from public, anon, authenticated;
revoke all on table public.workspace_person from public, anon, authenticated;
-- Direct PostgREST writes stay closed until the workspace/project capability
-- matrix is explicit. Today all legitimate writes already go through the
-- SECURITY DEFINER RPCs below, which validate membership, project permission,
-- verified identity and/or consent before touching these tables. Granting
-- table INSERT/UPDATE to every workspace member would let a basic member edit
-- another company's local dossier simply because they share that workspace.
grant select on table public.workspace_organization to authenticated;
grant select on table public.workspace_person to authenticated;

--------------------------------------------------------------------------------
-- 6. Explicit, consent-based portable-profile sharing.
--------------------------------------------------------------------------------

create or replace function public.share_my_profile_with_workspace(
  p_workspace_id uuid,
  p_fields text[] default array[
    'full_name', 'first_name', 'last_name', 'phone', 'website', 'city',
    'country', 'languages', 'professional_title'
  ]::text[]
)
returns public.workspace_person
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_profile public.user_profile;
  v_person public.person;
  v_person_id uuid;
  v_email extensions.citext;
  v_slug text;
  v_allowed constant text[] := array[
    'full_name', 'first_name', 'last_name', 'phone', 'website', 'city',
    'country', 'languages', 'professional_title'
  ];
  v_fields text[];
  v_result public.workspace_person;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'accepted workspace membership required' using errcode = '42501';
  end if;

  select * into v_profile from public.user_profile where user_id = v_caller;
  if v_profile.user_id is null then
    raise exception 'user profile not found' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct f order by f), '{}') into v_fields
  from unnest(coalesce(p_fields, '{}')) f
  where f = any(v_allowed);
  if cardinality(v_fields) = 0 or not ('full_name' = any(v_fields)) then
    raise exception 'shared fields must include full_name' using errcode = '22023';
  end if;

  v_person_id := v_profile.person_id;
  if v_person_id is null then
    select u.email::extensions.citext into v_email
    from auth.users u
    where u.id = v_caller and u.email_confirmed_at is not null;

    -- Explicit share + verified auth email is the claim event. Unlike contact
    -- capture, this may link an existing local dossier to the signed-in user.
    -- Prefer the target workspace, then another accepted workspace.
    if v_email is not null then
      select p.* into v_person
      from public.workspace_person wp
      join public.workspace_membership m on m.workspace_id = wp.workspace_id
      join public.person p on p.id = wp.person_id
      where wp.email = v_email and wp.deleted_at is null
        and m.user_id = v_caller and m.accepted_at is not null
        and not exists (
          select 1 from public.user_profile claimed where claimed.person_id = p.id
        )
      order by (wp.workspace_id = p_workspace_id) desc, wp.created_at asc
      limit 1;
    end if;

    -- Legacy rows may still carry the old global email without any local
    -- dossier. Keep this as a migration bridge, after the workspace lookup.
    if v_person.id is null and v_email is not null then
      select p.* into v_person
      from public.person p
      where p.email = v_email and p.deleted_at is null
        and not exists (
          select 1 from public.user_profile claimed where claimed.person_id = p.id
        )
      limit 1;
    end if;

    if v_person.id is null then
      v_person_id := public.uuid_generate_v7();
      v_slug := 'person-' || substring(replace(v_person_id::text, '-', '') from 1 for 12);
      insert into public.person (id, slug, full_name, email, created_by)
      values (
        v_person_id,
        v_slug,
        'Person ' || substring(replace(v_person_id::text, '-', '') from 1 for 8),
        null,
        v_caller
      );
    else
      v_person_id := v_person.id;
    end if;

    update public.user_profile set person_id = v_person_id where user_id = v_caller;
  end if;

  v_slug := coalesce(
    nullif(rtrim(left(public.slugify(v_profile.full_name), 63), '-'), ''),
    'person'
  );
  if exists (
    select 1 from public.workspace_person wp
    where wp.workspace_id = p_workspace_id and wp.slug = v_slug
      and wp.person_id <> v_person_id and wp.deleted_at is null
  ) then
    v_slug := rtrim(left(v_slug, 56), '-') || '-' || substring(replace(v_person_id::text, '-', '') from 1 for 6);
  end if;

  insert into public.workspace_person (
    workspace_id, person_id, slug, full_name, first_name, last_name, phone,
    website, city, country, languages, title, profile_sync_enabled,
    profile_shared_fields, profile_shared_at, created_by
  ) values (
    p_workspace_id, v_person_id, v_slug, v_profile.full_name,
    case when 'first_name' = any(v_fields) then v_profile.first_name end,
    case when 'last_name' = any(v_fields) then v_profile.last_name end,
    case when 'phone' = any(v_fields) then v_profile.phone end,
    case when 'website' = any(v_fields) then v_profile.website end,
    case when 'city' = any(v_fields) then v_profile.city end,
    case when 'country' = any(v_fields) then v_profile.country end,
    case when 'languages' = any(v_fields) then v_profile.languages else '{}' end,
    case when 'professional_title' = any(v_fields) then v_profile.professional_title end,
    true, v_fields, now(), v_caller
  )
  on conflict (workspace_id, person_id) do update set
    full_name = case when 'full_name' = any(v_fields) then excluded.full_name else workspace_person.full_name end,
    first_name = case when 'first_name' = any(v_fields) then excluded.first_name else workspace_person.first_name end,
    last_name = case when 'last_name' = any(v_fields) then excluded.last_name else workspace_person.last_name end,
    phone = case when 'phone' = any(v_fields) then excluded.phone else workspace_person.phone end,
    website = case when 'website' = any(v_fields) then excluded.website else workspace_person.website end,
    city = case when 'city' = any(v_fields) then excluded.city else workspace_person.city end,
    country = case when 'country' = any(v_fields) then excluded.country else workspace_person.country end,
    languages = case when 'languages' = any(v_fields) then excluded.languages else workspace_person.languages end,
    title = case when 'professional_title' = any(v_fields) then excluded.title else workspace_person.title end,
    profile_sync_enabled = true,
    profile_shared_fields = v_fields,
    profile_shared_at = now(),
    deleted_at = null
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.stop_sharing_my_profile_with_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_person_id uuid;
begin
  if v_caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select person_id into v_person_id from public.user_profile where user_id = v_caller;
  if v_person_id is null then return; end if;

  update public.workspace_person
  set profile_sync_enabled = false, profile_shared_fields = '{}'
  where workspace_id = p_workspace_id and person_id = v_person_id;
end;
$$;

create or replace function public.sync_shared_profile_to_workspace_people()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.person_id is null then return new; end if;

  update public.workspace_person wp set
    full_name = case when 'full_name' = any(wp.profile_shared_fields) then new.full_name else wp.full_name end,
    first_name = case when 'first_name' = any(wp.profile_shared_fields) then new.first_name else wp.first_name end,
    last_name = case when 'last_name' = any(wp.profile_shared_fields) then new.last_name else wp.last_name end,
    phone = case when 'phone' = any(wp.profile_shared_fields) then new.phone else wp.phone end,
    website = case when 'website' = any(wp.profile_shared_fields) then new.website else wp.website end,
    city = case when 'city' = any(wp.profile_shared_fields) then new.city else wp.city end,
    country = case when 'country' = any(wp.profile_shared_fields) then new.country else wp.country end,
    languages = case when 'languages' = any(wp.profile_shared_fields) then new.languages else wp.languages end,
    title = case when 'professional_title' = any(wp.profile_shared_fields) then new.professional_title else wp.title end
  where wp.person_id = new.person_id and wp.profile_sync_enabled;

  return new;
end;
$$;

create trigger user_profile_sync_shared_profile
  after update of full_name, first_name, last_name, phone, website, city,
    country, languages, professional_title
  on public.user_profile
  for each row execute function public.sync_shared_profile_to_workspace_people();

revoke all on function public.sync_shared_profile_to_workspace_people()
  from public, anon, authenticated, service_role;
revoke all on function public.share_my_profile_with_workspace(uuid, text[]) from public, anon, service_role;
revoke all on function public.stop_sharing_my_profile_with_workspace(uuid) from public, anon, service_role;
grant execute on function public.share_my_profile_with_workspace(uuid, text[]) to authenticated;
grant execute on function public.stop_sharing_my_profile_with_workspace(uuid) to authenticated;

--------------------------------------------------------------------------------
-- 7. Conversation capture now resolves email only inside the target
-- workspace. Cross-workspace linking happens later through the explicit,
-- verified profile-share/claim path, never as a side effect of contact entry.
--------------------------------------------------------------------------------

create or replace function public.create_conversation(
  p_project_id uuid,
  p_person_id uuid default null,
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_organization_name text default null,
  p_title text default null,
  p_status public.conversation_status default 'contacted',
  p_role text default null,
  p_next_action_at timestamptz default null,
  p_next_action_note text default null,
  p_line_id uuid default null
)
returns public.conversation
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_workspace_id uuid;
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

  select * into v_conversation from public.conversation
  where workspace_id = v_workspace_id and project_id = p_project_id
    and person_id = v_person_id and deleted_at is not null;
  if v_conversation.id is not null then
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
      line_id = p_line_id
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
$$;

revoke all on function public.create_conversation(
  uuid, uuid, text, text, text, text, text, public.conversation_status,
  text, timestamptz, text, uuid
) from public, anon, service_role;
grant execute on function public.create_conversation(
  uuid, uuid, text, text, text, text, text, public.conversation_status,
  text, timestamptz, text, uuid
) to authenticated;

-- Existing helper remains useful as an opaque-identity visibility predicate,
-- but its authority now derives from workspace_person, not a growing list of
-- relationship tables.
create or replace function public.can_see_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_person wp
    join public.workspace_membership m on m.workspace_id = wp.workspace_id
    where wp.person_id = p_person_id and wp.deleted_at is null
      and m.user_id = auth.uid() and m.accepted_at is not null
  ) or exists (
    select 1 from public.user_profile up
    where up.user_id = auth.uid() and up.person_id = p_person_id
  );
$$;

-- The application no longer reads contact fields from the global row. Keep
-- only the opaque id visible to authenticated callers; SECURITY DEFINER
-- identity/capture functions retain the internal email match they need.
revoke all on table public.person from authenticated;
grant select (id) on table public.person to authenticated;

notify pgrst, 'reload schema';

commit;
