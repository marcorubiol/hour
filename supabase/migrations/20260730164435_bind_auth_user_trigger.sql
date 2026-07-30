-- Put the auth.users trigger binding back into the reconstructive history.
--
-- WRITTEN, NOT APPLIED. On production this is a no-op: the trigger is already
-- there and enabled (verified 2026-07-30 against `hour-phase0` — pg_trigger
-- reports `on_auth_user_created` on auth.users, tgenabled='O', calling
-- public.handle_new_user). What this file fixes is the REBUILD path.
--
-- The hole: `public.handle_new_user()` is defined in
-- 20260720105713_remote_schema_checkpoint.sql, but the CREATE TRIGGER that
-- binds it to auth.users appears in NO migration — only in `build/schema.sql`,
-- which the canon marks as historical and never executes. So a database
-- rebuilt with `pnpm db:reset` gets the function and not the hook, and on that
-- database signing up creates an auth user and then NOTHING:
--
--   no user_profile · no personal account · no account_membership
--   no workspace · no workspace_membership
--
-- i.e. a signed-in user with no rows and no workspace, which no test would
-- catch, because the fixtures seed those tables directly instead of signing
-- anybody up. That is also why the documented claim — "una base vacía se
-- reconstruye con pnpm db:reset … y pasa 120/120 RLS" — is true and still
-- hides this: the suite never exercises the one path the trigger owns.
--
-- The restore drill is NOT affected (a pg dump carries its own triggers); the
-- exposure is a fresh environment built from migrations — a new staging, a
-- branch database, or a real recovery that starts from this history rather
-- than from a dump.
--
-- Idempotent by construction, so applying it to production changes nothing
-- observable: DROP IF EXISTS + CREATE re-binds the identical hook to the
-- identical function. It does not touch handle_new_user's body.
--
-- NOTE ON PRIVILEGE: creating a trigger on auth.users needs an owner-level
-- role. Supabase migrations run as such; a plain `authenticated` session
-- cannot, which is why this cannot live in app code.

-- CREATE OR REPLACE, not DROP + CREATE. The drop-then-create pair leaves a
-- window — however short — in which auth.users has NO provisioning hook, and
-- if the CREATE then failed (a privilege problem, a typo) production would be
-- left silently accepting signups that create nothing. Replacing is atomic and
-- needs no window at all. It also still creates the trigger when it is absent,
-- which is the rebuild case this file exists for.
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Provisions a new login: user_profile + personal account + account_membership + workspace + workspace_membership(owner). Bound to auth.users by on_auth_user_created (20260730164435). Never sets user_profile.person_id — a login becomes a person only through share_my_profile_with_workspace.';
