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

-- Statuses cycle so the lens shows more than one state; values are reset on
-- every load, so a spec that writes one of these rows is undone here.
insert into public.conversation (
  id, workspace_id, project_id, person_id, status, next_action_note,
  custom_fields, created_by, slug, line_id
)
select
  md5('hour-playwright-difusion-conversation-' || n)::uuid,
  w.id,
  md5('hour-playwright-difusion-project')::uuid,
  md5('hour-playwright-difusion-person-' || n)::uuid,
  (array['contacted', 'in_conversation', 'hold', 'confirmed', 'declined', 'dormant'])[1 + (n - 1) % 6]::public.conversation_status,
  'Synthetic difusión fixture',
  '{"season": "2026-27"}'::jsonb,
  (select id from auth.users where email = 'playwright@hour.test'),
  'zzz-difusion-conversation-' || lpad(n::text, 3, '0'),
  md5('hour-playwright-difusion-line')::uuid
from generate_series(1, 24) as n
cross join public.workspace w
where w.slug = 'playwright' and w.deleted_at is null
on conflict (id) do update
set status = excluded.status, next_action_note = excluded.next_action_note,
    custom_fields = excluded.custom_fields, line_id = excluded.line_id,
    updated_at = now(), deleted_at = null;

commit;
