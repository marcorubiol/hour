-- Hosted projects can start with automatic Data API grants enabled. A
-- table-level UPDATE grant wins over the narrower column grants below, so
-- clear it explicitly before restoring the intended self-service fields.
revoke update on table public.user_profile from authenticated;

grant update (
  full_name,
  avatar_url,
  locale,
  first_name,
  last_name,
  phone,
  website,
  city,
  country,
  languages,
  professional_title,
  bio
) on table public.user_profile to authenticated;

-- Keep future public objects private until a migration grants the exact Data
-- API surface. These match Supabase's opt-in exposure recommendations.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
