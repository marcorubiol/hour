-- RLS selects the profile row; column grants protect platform admin and
-- verified identity fields from direct user writes.

begin;

revoke update on table public.user_profile from authenticated;
grant update (full_name, avatar_url, locale) on table public.user_profile to authenticated;

comment on column public.user_profile.is_platform_admin is
  'Operator flag. Never user-writable: authenticated has UPDATE only on full_name/avatar_url/locale. Set by trusted operator tooling only.';

comment on column public.user_profile.person_id is
  'Verified user-to-person identity link. Never user-writable directly: set only by a gated claim/merge RPC after email verification and consent checks.';

commit;
