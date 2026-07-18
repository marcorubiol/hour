-- ADR-072 §6 (gap #8, confirmed in S1 — see ADR-074 §6): the user ↔ person
-- bridge. Nothing joined `auth.users` to `person`, so "my gigs / my
-- conflicts / my blackout" could not resolve for a person who is ALSO a
-- user (the actor/técnico managing their own calendar — Marco's symmetry
-- requirement). One nullable FK + a partial UNIQUE index: a person is
-- claimed by at most one user; a user claims at most one person (the
-- column itself).
--
-- SCOPE: column + index ONLY in this pass — NO claim flow. Claim-by-email
-- lands with the persona features; until then nothing in the app writes
-- this column. Same ship-the-column-first precedent as
-- user_profile.is_platform_admin (2026-07-16_workspace_shortid_alias.sql
-- §3): set manually / by a future gated flow, no self-service path by
-- design. (Known and accepted: user_profile_update_self would let a user
-- PATCH their own row — the claim flow's guard arrives with the claim
-- flow; Phase 0, matching the is_platform_admin precedent.)
--
-- NOT applied to any live DB yet — deliver-files-only pass (calendar-v2).
-- Apply via Supabase MCP apply_migration (name: user_profile_person_id),
-- additive-only; verify with probes (column exists, UNIQUE index rejects
-- a second claim of the same person).

--------------------------------------------------------------------------------
-- 1. Column
--------------------------------------------------------------------------------

ALTER TABLE public.user_profile
  ADD COLUMN person_id uuid REFERENCES public.person (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.user_profile.person_id IS
  'ADR-072 §6 (gap #8): which person row this user IS. Bridges auth ↔ domain so personal calendar/conflicts/blackouts resolve. NULL until the claim-by-email flow lands — no self-service claim path yet by design.';

--------------------------------------------------------------------------------
-- 2. A person belongs to at most one user
--------------------------------------------------------------------------------

CREATE UNIQUE INDEX user_profile_person_id_key
  ON public.user_profile (person_id)
  WHERE person_id IS NOT NULL;
