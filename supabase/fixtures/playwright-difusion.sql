-- Synthetic difusión set for the E2E/RLS fixture user, inside its OWN
-- `playwright` workspace (_tasks.md § 31).
--
-- Until 2026-10 the suites read the conversations of `muk-cia`, which are
-- MüK Cia's REAL difusión list (imported 2026-04-19), and the fixture user was
-- admin there. This file gives the suites their own set so that access can be
-- revoked. Everything here is fake: `@example.test` emails, `zzz-` slugs.
--
-- Loaded in staging after `staging.sql`, and once in production by hand
-- (psql or SQL editor) with the plan in the § 31 lane. Idempotent: fixed ids
-- derived from md5, ON CONFLICT on each. The Auth user must exist first
-- (Auth Admin API, never an insert into auth.users).

begin;

do $$
begin
  if not exists (select 1 from auth.users where email = 'playwright@hour.test') then
    raise exception 'playwright@hour.test must exist before loading the difusión fixture';
  end if;
  if not exists (select 1 from public.workspace where slug = 'playwright' and deleted_at is null) then
    raise exception 'the playwright workspace must exist before loading the difusión fixture';
  end if;
end
$$;

insert into public.project (id, workspace_id, slug, name, status, created_by)
select
  md5('hour-playwright-difusion-project')::uuid,
  w.id,
  'zzz-difusion',
  'ZZZ Difusión Fixture',
  'active',
  (select id from auth.users where email = 'playwright@hour.test')
from public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (id) do update set name = excluded.name, status = excluded.status, updated_at = now(), deleted_at = null;

insert into public.line (id, workspace_id, project_id, name, kind, slug, modules, created_by)
select
  md5('hour-playwright-difusion-line')::uuid,
  w.id,
  md5('hour-playwright-difusion-project')::uuid,
  'ZZZ Difusión 2026/27',
  'campaign',
  'zzz-difusion-2026-27',
  '["conversations","planner"]',
  (select id from auth.users where email = 'playwright@hour.test')
from public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (id) do update
set name = excluded.name, kind = excluded.kind, slug = excluded.slug, modules = excluded.modules, updated_at = now(), deleted_at = null;

insert into public.person (id, email, full_name, slug, created_by)
select
  md5('hour-playwright-difusion-person-' || n)::uuid,
  ('zzz-difusion-' || lpad(n::text, 3, '0') || '@example.test')::citext,
  'ZZZ Difusión Contact ' || lpad(n::text, 3, '0'),
  'zzz-difusion-contact-' || lpad(n::text, 3, '0'),
  (select id from auth.users where email = 'playwright@hour.test')
from generate_series(1, 24) as n
on conflict (id) do update set full_name = excluded.full_name, updated_at = now(), deleted_at = null;

insert into public.workspace_person (
  workspace_id, person_id, slug, full_name, email, created_by
)
select
  w.id,
  md5('hour-playwright-difusion-person-' || n)::uuid,
  'zzz-difusion-contact-' || lpad(n::text, 3, '0'),
  'ZZZ Difusión Contact ' || lpad(n::text, 3, '0'),
  ('zzz-difusion-' || lpad(n::text, 3, '0') || '@example.test')::citext,
  (select id from auth.users where email = 'playwright@hour.test')
from generate_series(1, 24) as n
cross join public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (workspace_id, person_id) do update
set full_name = excluded.full_name, email = excluded.email, updated_at = now(), deleted_at = null;

-- ADR-102: the conversation is with an organization and the person is its
-- primary contact. One organization per contact.
insert into public.workspace_organization (id, workspace_id, slug, name, created_by)
select
  md5('hour-playwright-difusion-organization-' || n)::uuid,
  w.id,
  'zzz-difusion-venue-' || lpad(n::text, 3, '0'),
  'ZZZ Difusión Venue ' || lpad(n::text, 3, '0'),
  (select id from auth.users where email = 'playwright@hour.test')
from generate_series(1, 24) as n
cross join public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (id) do update set name = excluded.name, updated_at = now(), deleted_at = null;

update public.workspace_person wp
set organization_id = md5('hour-playwright-difusion-organization-' || n)::uuid
from generate_series(1, 24) as n, public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
  and wp.workspace_id = w.id
  and wp.person_id = md5('hour-playwright-difusion-person-' || n)::uuid;

-- Values are reset on every load, so a spec that writes one of these rows is
-- undone here. The relation is derived from the history (ADR-138).
insert into public.conversation (
  id, workspace_id, project_id, organization_id, next_action_note,
  custom_fields, created_by, slug, line_id
)
select
  md5('hour-playwright-difusion-conversation-' || n)::uuid,
  w.id,
  md5('hour-playwright-difusion-project')::uuid,
  md5('hour-playwright-difusion-organization-' || n)::uuid,
  'Synthetic difusión fixture',
  '{"season": "2026-27"}'::jsonb,
  (select id from auth.users where email = 'playwright@hour.test'),
  'zzz-difusion-conversation-' || lpad(n::text, 3, '0'),
  md5('hour-playwright-difusion-line')::uuid
from generate_series(1, 24) as n
cross join public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (id) do update
set next_action_note = excluded.next_action_note,
    organization_id = excluded.organization_id,
    custom_fields = excluded.custom_fields, line_id = excluded.line_id,
    updated_at = now(), deleted_at = null;

-- A spec may have named another primary: the load puts this one back.
update public.conversation_contact cc
set is_primary = false
from generate_series(1, 24) as n
where cc.conversation_id = md5('hour-playwright-difusion-conversation-' || n)::uuid
  and cc.person_id <> md5('hour-playwright-difusion-person-' || n)::uuid
  and cc.is_primary;

insert into public.conversation_contact (workspace_id, conversation_id, person_id, is_primary, created_by)
select
  w.id,
  md5('hour-playwright-difusion-conversation-' || n)::uuid,
  md5('hour-playwright-difusion-person-' || n)::uuid,
  true,
  (select id from auth.users where email = 'playwright@hour.test')
from generate_series(1, 24) as n
cross join public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (conversation_id, person_id) do update
set is_primary = true, until = null, updated_at = now();

commit;
