-- Hour — Phase 0 seed / ownership claim
-- Two phases:
--   A. PRE-SEED (already applied via MCP 2026-04-19).
--      - workspace slug=marco-rubiol (Marco Rubiol, personal, ES)
--      - project  slug=mamemi (MaMeMi, show, active) inside that workspace
--      - No owner membership yet (awaits Marco's first signup).
--   B. CLAIM (run ONCE after Marco's first signup via the app).
--      - Deletes the empty workspace auto-created by handle_new_user trigger.
--      - Inserts Marco as owner on the pre-seeded marco-rubiol workspace.
--
-- Execution: apply the CLAIM block once in Supabase Studio → SQL Editor
-- (or via MCP apply_migration) AFTER Marco has signed up through the Hour app.

--------------------------------------------------------------------------------
-- A. PRE-SEED (reference — already applied)
--------------------------------------------------------------------------------

-- INSERT INTO public.workspace (slug, name, kind, country, timezone)
-- VALUES ('marco-rubiol', 'Marco Rubiol', 'personal', 'ES', 'Europe/Madrid')
-- ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;
--
-- INSERT INTO public.project (workspace_id, slug, name, type, status, description)
-- SELECT id, 'mamemi', 'MaMeMi', 'show', 'active',
--        'MaMeMi — the show. Source of the Difusión 2026-27 dates and engagements.'
-- FROM public.workspace WHERE slug = 'marco-rubiol'
-- ON CONFLICT (workspace_id, slug) DO UPDATE SET name = EXCLUDED.name;

--------------------------------------------------------------------------------
-- B. CLAIM (run once after Marco's first signup)
--------------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_user_id            uuid;
  v_pre_seeded_ws_id   uuid;
  v_trigger_ws_id      uuid;
BEGIN
  -- Marco's user
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'marcorubiol@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for marcorubiol@gmail.com. Sign up first, then rerun.';
  END IF;

  -- Pre-seeded workspace (slug=marco-rubiol)
  SELECT id INTO v_pre_seeded_ws_id
  FROM public.workspace
  WHERE slug = 'marco-rubiol'
  LIMIT 1;

  IF v_pre_seeded_ws_id IS NULL THEN
    RAISE EXCEPTION 'Pre-seeded workspace marco-rubiol not found. Re-apply PRE-SEED block first.';
  END IF;

  -- Trigger-created workspace: marco-rubiol-XXXX (suffix added because of slug collision)
  SELECT w.id INTO v_trigger_ws_id
  FROM public.workspace w
  JOIN public.membership m ON m.workspace_id = w.id
  WHERE m.user_id = v_user_id
    AND m.role = 'owner'
    AND w.id <> v_pre_seeded_ws_id
    AND w.slug LIKE 'marco-rubiol-%'
  ORDER BY w.created_at ASC
  LIMIT 1;

  -- 1. Attach Marco as owner to the pre-seeded workspace (idempotent).
  INSERT INTO public.membership (workspace_id, user_id, role, accepted_at)
  VALUES (v_pre_seeded_ws_id, v_user_id, 'owner', now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = 'owner', accepted_at = COALESCE(public.membership.accepted_at, now());

  -- 2. Delete the empty trigger-created workspace (cascades to its membership).
  IF v_trigger_ws_id IS NOT NULL THEN
    DELETE FROM public.workspace WHERE id = v_trigger_ws_id;
    RAISE NOTICE 'Removed duplicate trigger-created workspace %.', v_trigger_ws_id;
  END IF;

  RAISE NOTICE 'Claim complete. user=%, workspace=%.', v_user_id, v_pre_seeded_ws_id;
END $$;

COMMIT;

--------------------------------------------------------------------------------
-- Verification
--------------------------------------------------------------------------------

SELECT
  u.email        AS user_email,
  w.slug         AS workspace_slug,
  w.name         AS workspace_name,
  w.kind         AS workspace_kind,
  m.role         AS membership_role,
  p.slug         AS project_slug,
  p.name         AS project_name,
  p.type         AS project_type,
  p.status       AS project_status
FROM auth.users u
JOIN public.membership m  ON m.user_id = u.id AND m.role = 'owner'
JOIN public.workspace  w  ON w.id = m.workspace_id AND w.slug = 'marco-rubiol'
LEFT JOIN public.project p ON p.workspace_id = w.id AND p.slug = 'mamemi' AND p.deleted_at IS NULL
WHERE u.email = 'marcorubiol@gmail.com';
