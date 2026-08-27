-- ADR-093 §5 — `read:person_note_private` is retired.
--
-- The permission went dead on 2026-08-11, when `note_absorbs_person_note`
-- dropped `person_note` and with it `person_note_select`, the only policy that
-- ever asked for it. That migration said so and deliberately did NOT retire it,
-- because a permission is not one object: a trigger seeds it into six system
-- roles, it sits in the `permissions` array of every role those six seedings
-- have already written, and it is named in the closed-vocabulary comment that
-- documents the column. That is its own migration, and this is it.
--
-- VERIFIED ON A DATABASE REBUILT FROM THIS HISTORY (2026-08-27), because the
-- claim «nothing uses it» is exactly the kind that is assumed rather than
-- checked: no policy names it in `qual` or `with_check`, and the only function
-- whose body contains it is `seed_system_roles_on_workspace`. `person_note` is
-- gone. So the three moves below are the whole of it.
--
-- NOT DESTRUCTIVE, but it does WRITE: the UPDATE touches live rows and fires
-- `workspace_role_audit`, which is correct — retiring a permission is a change
-- to who could have been allowed what, and that belongs in the audit log. It is
-- idempotent (`array_remove` on an array that lacks the element is a no-op) and
-- it cannot trip `guard_immutable_workspace_id`, which only defends
-- `workspace_id`. Migrations run as `postgres`, which carries BYPASSRLS, so the
-- FORCE'd row security on `workspace_role` does not hide rows from it.

-- ── 1 · new workspaces stop being given it ────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_system_roles_on_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.workspace_role (
    workspace_id, code, label, is_system, access_level, permissions
  ) VALUES
    (NEW.id, 'owner',              'Owner',              true, 'owner',    ARRAY['read:performance','read:money','read:conversation','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta','edit:membership','admin:project']::text[]),
    (NEW.id, 'admin',              'Admin',              true, 'admin',    ARRAY['read:performance','read:money','read:conversation','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta','edit:membership']::text[]),
    (NEW.id, 'producer',           'Producer',           true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'production_manager', 'Production Manager', true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'tour_manager',       'Tour Manager',       true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:internal_notes','edit:performance','edit:conversation','edit:money','edit:project_meta']::text[]),
    (NEW.id, 'distribution',       'Distribution',       true, 'producer', ARRAY['read:performance','read:money','read:conversation','read:internal_notes','edit:performance','edit:conversation','edit:project_meta']::text[]),
    (NEW.id, 'director',           'Director',           true, 'member',   ARRAY['read:performance','read:conversation','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'author',             'Author',             true, 'member',   ARRAY['read:performance','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'technical_director', 'Technical Director', true, 'member',   ARRAY['read:performance','read:internal_notes','edit:performance']::text[]),
    (NEW.id, 'performer',          'Performer',          true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'light_design',       'Light Design',       true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'sound_design',       'Sound Design',       true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'stage_design',       'Stage Design',       true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'costume_design',     'Costume Design',     true, 'member',   ARRAY['read:performance','read:internal_notes']::text[]),
    (NEW.id, 'press',              'Press',              true, 'member',   ARRAY['read:performance','read:conversation','read:internal_notes']::text[]),
    (NEW.id, 'viewer',             'Viewer',             true, 'viewer',   ARRAY['read:performance']::text[]);
  RETURN NEW;
END;
$function$;

-- ── 2 · the roles that already carry it let it go ─────────────────────────
-- Only the six seeded `owner`…`distribution` rows can hold it, but the filter
-- is on the value and not on the code: a workspace whose roles were edited by
-- hand is still a workspace, and this should reach it too.
UPDATE public.workspace_role
   SET permissions = array_remove(permissions, 'read:person_note_private')
 WHERE 'read:person_note_private' = ANY (permissions);

-- ── 3 · the vocabulary says the truth again ───────────────────────────────
COMMENT ON COLUMN public.workspace_role.permissions IS
  'Closed vocabulary: read:performance, read:money, read:conversation, read:internal_notes, edit:performance, edit:conversation, edit:money, edit:project_meta, edit:membership, admin:project.';
