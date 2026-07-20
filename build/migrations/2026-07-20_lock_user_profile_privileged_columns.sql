-- SECURITY: user_profile_update_self is intentionally broad at the row level,
-- but two privileged columns landed after that policy:
--   · is_platform_admin — trusted by review_workspace_alias
--   · person_id         — the future verified identity claim
--
-- RLS answers WHICH row may be updated; column privileges answer WHICH fields.
-- An authenticated user may edit only their ordinary profile fields. A future
-- SECURITY DEFINER claim RPC can still set person_id after verifying the auth
-- email, and service_role/operator SQL can still set is_platform_admin.
--
-- Deliver-files-only. Before applying, audit the current flag holders:
--   SELECT user_id FROM public.user_profile WHERE is_platform_admin;
-- Every returned user must be an expected operator.

BEGIN;

REVOKE UPDATE ON TABLE public.user_profile FROM authenticated;
GRANT UPDATE (full_name, avatar_url, locale) ON TABLE public.user_profile TO authenticated;

COMMENT ON COLUMN public.user_profile.is_platform_admin IS
  'Operator flag. Never user-writable: authenticated has UPDATE only on full_name/avatar_url/locale. Set by trusted operator tooling only.';

COMMENT ON COLUMN public.user_profile.person_id IS
  'Verified user-to-person identity link. Never user-writable directly: set only by a future gated claim/merge RPC after email verification and consent checks.';

COMMIT;
