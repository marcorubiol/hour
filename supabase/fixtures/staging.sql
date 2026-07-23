-- Synthetic, deterministic staging fixture for the RLS contract.
-- Auth identities are deliberately created first through the Auth Admin API
-- (`provision-auth.mjs`); never insert directly into auth.users.

begin;

do $$
begin
  if (select count(*) from auth.users where email in ('playwright@hour.test', 'limited@hour.test', 'external@hour.test')) <> 3 then
    raise exception 'All three staging Auth fixture users must exist before loading SQL fixtures';
  end if;
end
$$;

insert into public.account (id, slug, name, kind, billing_email)
values
  ('10000000-0000-4000-8000-000000000001', 'playwright-acc', 'Playwright Account', 'personal', 'playwright@hour.test'),
  ('10000000-0000-4000-8000-000000000002', 'mamemi-acc', 'Synthetic MaMeMi Account', 'team', null),
  ('10000000-0000-4000-8000-000000000003', 'marco-rubiol-acc', 'Synthetic Marco Account', 'personal', null),
  ('10000000-0000-4000-8000-000000000004', 'demo-acc', 'Invisible Demo Account', 'team', null)
on conflict (id) do update set name = excluded.name, updated_at = now(), deleted_at = null;

insert into public.account_membership (account_id, user_id, role, accepted_at, revoked_at)
select
  '10000000-0000-4000-8000-000000000001',
  id,
  'owner',
  '2026-01-01T00:00:00Z',
  null
from auth.users
where email = 'playwright@hour.test'
on conflict (account_id, user_id) do update
set role = excluded.role, accepted_at = excluded.accepted_at, revoked_at = null;

insert into public.workspace (id, slug, name, kind, account_id, domain, city)
values
  ('20000000-0000-4000-8000-000000000001', 'playwright', 'Playwright Staging', 'personal', '10000000-0000-4000-8000-000000000001', 'mixed', 'Testville'),
  ('20000000-0000-4000-8000-000000000002', 'muk-cia', 'Synthetic Muk Cia', 'team', '10000000-0000-4000-8000-000000000002', 'theatre', 'Testville'),
  ('20000000-0000-4000-8000-000000000003', 'marco-rubiol', 'Synthetic Marco Workspace', 'personal', '10000000-0000-4000-8000-000000000003', 'other', 'Testville'),
  ('20000000-0000-4000-8000-000000000004', 'demo', 'Invisible Demo Workspace', 'team', '10000000-0000-4000-8000-000000000004', 'other', 'Testville')
on conflict (id) do update
set name = excluded.name, domain = excluded.domain, city = excluded.city, updated_at = now(), deleted_at = null;

insert into public.workspace_membership (workspace_id, user_id, role, accepted_at)
select fixture.workspace_id, users.id, fixture.role::public.membership_role, fixture.accepted_at
from (
  values
    ('playwright@hour.test', '20000000-0000-4000-8000-000000000001'::uuid, 'owner', '2026-01-01T00:00:00Z'::timestamptz),
    ('playwright@hour.test', '20000000-0000-4000-8000-000000000002'::uuid, 'admin', '2026-01-02T00:00:00Z'::timestamptz),
    ('playwright@hour.test', '20000000-0000-4000-8000-000000000003'::uuid, 'admin', '2026-01-03T00:00:00Z'::timestamptz),
    ('limited@hour.test', '20000000-0000-4000-8000-000000000001'::uuid, 'member', '2026-01-04T00:00:00Z'::timestamptz)
) as fixture(email, workspace_id, role, accepted_at)
join auth.users users on users.email = fixture.email
on conflict (workspace_id, user_id) do update
set role = excluded.role, accepted_at = excluded.accepted_at;

insert into public.project (id, workspace_id, slug, name, status, created_by)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'zzz-e2e-collab', 'ZZZ E2E Collaboration', 'active', (select id from auth.users where email = 'playwright@hour.test')),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'zzz-rls-foreign-project', 'ZZZ RLS Foreign Project', 'active', (select id from auth.users where email = 'playwright@hour.test')),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'mamemi', 'Synthetic MaMeMi Project', 'active', (select id from auth.users where email = 'playwright@hour.test'))
on conflict (id) do update set name = excluded.name, status = excluded.status, updated_at = now(), deleted_at = null;

insert into public.project_membership (project_id, user_id, roles, permission_grants, permission_revokes)
select
  '30000000-0000-4000-8000-000000000001',
  id,
  array['performer']::text[],
  '{}'::text[],
  '{}'::text[]
from auth.users
where email = 'limited@hour.test'
on conflict (project_id, user_id) do update
set roles = excluded.roles,
    permission_grants = excluded.permission_grants,
    permission_revokes = excluded.permission_revokes,
    updated_at = now();

insert into public.line (id, workspace_id, project_id, name, kind, slug, modules, created_by)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'ZZZ E2E Main Line', 'tour', 'zzz-e2e-main-line', '["planner","notes"]', (select id from auth.users where email = 'playwright@hour.test')),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'ZZZ RLS Foreign Line', 'campaign', 'zzz-rls-foreign-line', '["planner"]', (select id from auth.users where email = 'playwright@hour.test')),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'Difusión 2026/27', 'campaign', 'difusion-2026-27', '["conversations","planner"]', (select id from auth.users where email = 'playwright@hour.test'))
on conflict (id) do update
set name = excluded.name, kind = excluded.kind, slug = excluded.slug, modules = excluded.modules, updated_at = now(), deleted_at = null;

insert into public.person (id, email, full_name, slug, created_by)
values (
  '50000000-0000-4000-8000-000000000001',
  'playwright@hour.test',
  'Playwright Staging Admin',
  'playwright-staging-admin',
  (select id from auth.users where email = 'playwright@hour.test')
)
on conflict (id) do update set full_name = excluded.full_name, updated_at = now(), deleted_at = null;

insert into public.user_profile (user_id, full_name, person_id)
select id, 'Playwright Staging Admin', '50000000-0000-4000-8000-000000000001'
from auth.users where email = 'playwright@hour.test'
on conflict (user_id) do update set full_name = excluded.full_name, person_id = excluded.person_id;

insert into public.user_profile (user_id, full_name)
select id, 'Limited Staging Performer'
from auth.users where email = 'limited@hour.test'
on conflict (user_id) do update set full_name = excluded.full_name;

insert into public.workspace_person (
  workspace_id, person_id, slug, full_name, email, profile_sync_enabled,
  profile_shared_fields, profile_shared_at, created_by
)
values (
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'playwright-staging-admin',
  'Playwright Staging Admin',
  'playwright@hour.test',
  true,
  array['full_name']::text[],
  now(),
  (select id from auth.users where email = 'playwright@hour.test')
)
on conflict (workspace_id, person_id) do update
set full_name = excluded.full_name, email = excluded.email, deleted_at = null;

insert into public.person (id, email, full_name, slug, created_by)
select
  md5('hour-staging-person-' || n)::uuid,
  ('synthetic-' || lpad(n::text, 3, '0') || '@example.test')::citext,
  'Synthetic Contact ' || lpad(n::text, 3, '0'),
  'synthetic-contact-' || lpad(n::text, 3, '0'),
  (select id from auth.users where email = 'playwright@hour.test')
from generate_series(1, 154) as n
on conflict (id) do update set full_name = excluded.full_name, updated_at = now(), deleted_at = null;

insert into public.workspace_person (
  workspace_id, person_id, slug, full_name, email, created_by
)
select
  '20000000-0000-4000-8000-000000000002',
  md5('hour-staging-person-' || n)::uuid,
  'synthetic-contact-' || lpad(n::text, 3, '0'),
  'Synthetic Contact ' || lpad(n::text, 3, '0'),
  ('synthetic-' || lpad(n::text, 3, '0') || '@example.test')::citext,
  (select id from auth.users where email = 'playwright@hour.test')
from generate_series(1, 154) as n
on conflict (workspace_id, person_id) do update
set full_name = excluded.full_name, email = excluded.email, updated_at = now(), deleted_at = null;

insert into public.conversation (
  id, workspace_id, project_id, person_id, status, next_action_note,
  created_by, slug, line_id
)
select
  md5('hour-staging-conversation-' || n)::uuid,
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  md5('hour-staging-person-' || n)::uuid,
  'contacted',
  'Synthetic staging fixture',
  (select id from auth.users where email = 'playwright@hour.test'),
  'synthetic-conversation-' || lpad(n::text, 3, '0'),
  '40000000-0000-4000-8000-000000000003'
from generate_series(1, 154) as n
on conflict (id) do update
set status = excluded.status, line_id = excluded.line_id, updated_at = now(), deleted_at = null;

-- ADR-087: the fee lives on the bolo (the deal). The performance (the function)
-- links to it via bolo_id and carries no fee.
insert into public.bolo (
  id, workspace_id, project_id, line_id, venue_name, status,
  fee_amount, fee_currency, created_by
)
values (
  '71000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'Synthetic Venue',
  'confirmed',
  2500.00,
  'EUR',
  (select id from auth.users where email = 'playwright@hour.test')
)
on conflict (id) do update
set venue_name = excluded.venue_name, status = excluded.status,
    fee_amount = excluded.fee_amount, fee_currency = excluded.fee_currency,
    updated_at = now(), deleted_at = null;

insert into public.performance (
  id, workspace_id, project_id, line_id, bolo_id, performed_at, venue_name, status,
  created_by, slug
)
values (
  '70000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '2030-06-15',
  'Synthetic Venue',
  'confirmed',
  (select id from auth.users where email = 'playwright@hour.test'),
  'zzz-e2e-1'
)
on conflict (id) do update
set venue_name = excluded.venue_name, status = excluded.status,
    bolo_id = excluded.bolo_id, updated_at = now(), deleted_at = null;

commit;
