-- Take UPDATE on user_profile away from `anon`.
--
-- WRITTEN, NOT APPLIED. Found while building the profile-name editor
-- (2026-07-30) and verified against `hour-phase0`.
--
-- WHAT IS TRUE TODAY. The column grants on public.user_profile are split:
--
--   authenticated → avatar_url, bio, city, country, first_name, full_name,
--                   languages, last_name, locale, phone, professional_title,
--                   website          ← exactly the safe set
--   anon          → all of the above PLUS person_id, user_id,
--                   is_platform_admin, created_at, updated_at
--
-- The `authenticated` split is right and is what keeps the identity link
-- honest: a signed-in user cannot write their own `person_id`, which is the
-- whole point of that column being set only by share_my_profile_with_workspace.
-- The `anon` grant is a leftover from before the split.
--
-- THIS IS NOT AN OPEN DOOR, and the file says so rather than overstating it:
-- user_profile has RLS ENABLED and FORCED, and its only UPDATE policy is
-- `user_profile_update_self` — `user_id = auth.uid()`. For `anon`, auth.uid()
-- is NULL, so the predicate matches zero rows and the grant is unreachable.
-- Verified: relrowsecurity = t, relforcerowsecurity = t.
--
-- WHY CLOSE IT ANYWAY. The grant is one permissive policy away from being
-- three escalations at once, and they are the three worst columns in the
-- table: `person_id` (claim somebody else's person — and can_see_person then
-- grants you their visibility across every workspace they are in),
-- `user_id` (re-point a profile row at another login) and
-- `is_platform_admin`. Depending on a policy to neutralise a grant means the
-- next policy written by anyone becomes a security review of this table. Same
-- reasoning, and the same LOW rating, as the project_id_of_* helpers closed on
-- 2026-07-25: the exposure was small, closing it was smaller.
--
-- Scope note: this revokes UPDATE only. Any SELECT/INSERT/DELETE grants anon
-- may hold on this table are left alone — they are a separate question and
-- this file deliberately does not answer it while unverified.

REVOKE UPDATE ON TABLE public.user_profile FROM anon;

COMMENT ON COLUMN public.user_profile.person_id IS
  'The login → person bridge. Written ONLY by share_my_profile_with_workspace (a consent RPC); not in the authenticated UPDATE grant, and as of 20260730164608 not in anon''s either.';
