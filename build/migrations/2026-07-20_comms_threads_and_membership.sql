--------------------------------------------------------------------------------
-- 2026-07-20 · Comms threads + polymorphic membership + facets
--
-- ADR-082 (people / roles / access) · ADR-083 (comms layer) · ADR-085 (the
-- invitat + delegation bounded by the delegator), plus the amendments of
-- 2026-07-20 (facets per container level, General is not a facet, Producció
-- dropped as a facet). Design record: `_notes/spec-access-comms-decisions.md`.
--
-- STAGE 1 — PURELY ADDITIVE. Nothing existing changes:
--   · `workspace_membership` and `project_membership` are left untouched
--   · `has_permission()` is left untouched, and so are the ~11 money policies
--     that depend on it
--   · the new `membership` table is backfilled FROM them, one-way
-- The cutover (pointing has_permission at `membership`, then dropping the two
-- old tables) is stage 2 and a separate decision. Written this way on purpose:
-- security rewritten twice is how holes appear, so stage 1 adds and stage 2
-- removes, never both at once.
--
-- DEPENDS ON: `2026-07-18_user_profile_person_id.sql` (also unapplied). That
-- migration adds `user_profile.person_id` — the user↔person bridge from
-- ADR-072 §6. The first draft of THIS file duplicated that bridge on
-- `membership`, which would have left the codebase with two competing
-- answers to "which person is this user". Corrected: identity is always
-- resolved through `user_profile.person_id`; `membership.person_id` says who
-- the membership is FOR (an invitat may have no user at all), never who the
-- caller is.
--
-- NOT APPLIED to hour-phase0 at time of writing.
--------------------------------------------------------------------------------

BEGIN;

--------------------------------------------------------------------------------
-- 1. Vocabulary
--------------------------------------------------------------------------------

-- The four levels you can scope into. NOT the same as the three EDIT levels
-- (space / project / line→modules) — see `build/structure-model.md § Two
-- ladders`. A performance carries access and a conversation; it does not
-- compose modules.
CREATE TYPE public.container_level AS ENUM (
  'workspace', 'project', 'line', 'performance'
);

-- `edit` implies `view` (ADR-082 §4). There is no `none` member: absence of a
-- row IS "res". That is deliberate — it makes "granted nothing" and "never
-- granted" the same state, which is what the UI means by them.
CREATE TYPE public.facet_verb AS ENUM ('view', 'edit');

--------------------------------------------------------------------------------
-- 2. Facets — the vocabulary, AS DATA
--------------------------------------------------------------------------------
-- A facet does triple service (ADR-083 §4): it names a sub-thread, it is the
-- unit of permission, and it is the gutter label. One list, three jobs.
--
-- REVERSIBILITY IS A REQUIREMENT, not a nicety (Marco, 2026-07-20): moving
-- Tècnica from project to line has to be an UPDATE, never a migration and never
-- an `if`. That is why the level map below is rows in a table and not a CHECK,
-- an enum or a function body.

CREATE TABLE public.facet (
  key        text PRIMARY KEY,
  sort       smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.facet IS
  'The facet vocabulary (ADR-083 §4). Labels are i18n keys resolved client-side, never stored. `General` is NOT here: it is membership in the container (ADR-082 amendment 2026-07-20) and can never be a permission row.';

CREATE TABLE public.facet_level (
  facet_key text NOT NULL REFERENCES public.facet (key) ON DELETE CASCADE,
  level     public.container_level NOT NULL,
  PRIMARY KEY (facet_key, level)
);

COMMENT ON TABLE public.facet_level IS
  'Which facets exist at which container level. THE reversibility contract: changing where a facet lives is one row. Absent is not denied — a facet with no row at a level is not there at all, and the UI must say it in those words.';

INSERT INTO public.facet (key, sort) VALUES
  ('converses',    10),
  ('materials',    20),
  ('tecnica',      30),
  ('logistica',    40),
  ('full-de-ruta', 50),
  ('diners',       60);

-- The table decided 2026-07-20. `diners` is the only facet at all four levels,
-- which is exactly why it is the sensitive one — never smooth that away.
INSERT INTO public.facet_level (facet_key, level) VALUES
  ('converses',    'workspace'),
  ('converses',    'project'),
  ('converses',    'line'),

  ('materials',    'project'),
  ('materials',    'line'),
  ('materials',    'performance'),

  ('tecnica',      'project'),
  ('tecnica',      'line'),
  ('tecnica',      'performance'),

  ('logistica',    'line'),
  ('logistica',    'performance'),

  ('full-de-ruta', 'performance'),

  ('diners',       'workspace'),
  ('diners',       'project'),
  ('diners',       'line'),
  ('diners',       'performance');

--------------------------------------------------------------------------------
-- 3. Membership — polymorphic, and the bridge between the two worlds
--------------------------------------------------------------------------------
-- ADR-082 §1 diagnosed the root problem: access hangs off the login
-- (`*_membership.user_id`) and is disconnected from the world of contacts
-- (`person`, which has no user_id). Two worlds, no bridge. THIS TABLE IS THE
-- BRIDGE: it carries both, and `user_id IS NULL` is precisely what an
-- `invitat` is (ADR-085 §1) — a membership with permissions, minus a login,
-- plus an end date.

CREATE TABLE public.membership (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id   uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,

  -- Polymorphic container, same shape as `task` and `thread`. At most one of
  -- the three; all NULL = the workspace itself.
  project_id     uuid REFERENCES public.project (id) ON DELETE CASCADE,
  line_id        uuid REFERENCES public.line (id) ON DELETE CASCADE,
  performance_id uuid REFERENCES public.performance (id) ON DELETE CASCADE,

  person_id      uuid REFERENCES public.person (id) ON DELETE RESTRICT,
  user_id        uuid REFERENCES auth.users (id) ON DELETE CASCADE,

  preset         text,
  ends_at        timestamptz,

  invited_by     uuid REFERENCES auth.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at    timestamptz,
  revoked_at     timestamptz,

  CONSTRAINT membership_at_most_one_container CHECK (
    (project_id IS NOT NULL)::int
    + (line_id IS NOT NULL)::int
    + (performance_id IS NOT NULL)::int <= 1
  ),

  -- Somebody has to be on the other end.
  CONSTRAINT membership_has_a_subject CHECK (
    person_id IS NOT NULL OR user_id IS NOT NULL
  ),

  -- ADR-085 §8 as a constraint, not a convention: an `invitat` (no login)
  -- ALWAYS carries an end. Operators may have one (a fixed-term contract) but
  -- do not need one. This is the rule that stops a signed link living forever.
  CONSTRAINT membership_guest_must_expire CHECK (
    user_id IS NOT NULL OR ends_at IS NOT NULL
  )
);

COMMENT ON TABLE public.membership IS
  'Polymorphic membership at four container levels (ADR-082 amendment 2026-07-20). user_id NULL = an invitat: no login, no seat, always an ends_at (ADR-085). Effective access is the UNION across levels.';
COMMENT ON COLUMN public.membership.preset IS
  'Provenance label only — minim | equip | coordinacio | direccio. The actual grants live in membership_facet; this says which preset they were expanded from, so "where does this come from" is answerable (ADR-082 §4, hard requirement).';
COMMENT ON COLUMN public.membership.person_id IS
  'Nullable in stage 1 ONLY: the rows backfilled from workspace/project_membership have no person yet, and ADR-082 §6 forbids linking a login to a contact by email match. Stage 2 links them as a deliberate operator action, then this becomes NOT NULL.';

CREATE UNIQUE INDEX membership_unique_ws  ON public.membership (workspace_id, coalesce(user_id, person_id))
  WHERE project_id IS NULL AND line_id IS NULL AND performance_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX membership_unique_prj ON public.membership (project_id, coalesce(user_id, person_id))     WHERE project_id     IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX membership_unique_lin ON public.membership (line_id, coalesce(user_id, person_id))        WHERE line_id        IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX membership_unique_prf ON public.membership (performance_id, coalesce(user_id, person_id)) WHERE performance_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX membership_user_idx   ON public.membership (user_id)   WHERE revoked_at IS NULL;
CREATE INDEX membership_person_idx ON public.membership (person_id) WHERE revoked_at IS NULL;

--------------------------------------------------------------------------------
-- 4. The grants themselves
--------------------------------------------------------------------------------
-- A preset is EXPANDED into rows at grant time rather than resolved at read
-- time. Two reasons: reading permissions must not depend on a preset table that
-- can change under you afterwards, and `source` then answers ADR-082 §4's hard
-- requirement — "effective permissions AND where they come from" — without a
-- diff against a preset definition.

CREATE TABLE public.membership_facet (
  membership_id uuid NOT NULL REFERENCES public.membership (id) ON DELETE CASCADE,
  facet_key     text NOT NULL REFERENCES public.facet (key)     ON DELETE RESTRICT,
  verb          public.facet_verb NOT NULL,
  source        text NOT NULL DEFAULT 'preset',
  granted_by    uuid REFERENCES auth.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, facet_key),
  CONSTRAINT membership_facet_source CHECK (source IN ('preset', 'override'))
);

COMMENT ON COLUMN public.membership_facet.source IS
  'preset = came with the chosen preset · override = someone turned this one pair by hand. The UI must show overrides marked and attributed (ADR-082 §4); without this column that view is impossible and the overrides rot into mystery.';

--------------------------------------------------------------------------------
-- 5. Threads and messages
--------------------------------------------------------------------------------
-- ONE polymorphic mechanism (ADR-083 §1), and it takes the exact shape `task`
-- already uses for the same idea — a hub hangs off any container. All four FKs
-- NULL = the workspace's own hub.

CREATE TABLE public.thread (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id    uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,

  project_id      uuid REFERENCES public.project (id)      ON DELETE CASCADE,
  line_id         uuid REFERENCES public.line (id)         ON DELETE CASCADE,
  performance_id  uuid REFERENCES public.performance (id)  ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversation (id) ON DELETE CASCADE,

  -- A facet thread is gated by the facet. A free thread has a label and an
  -- explicit participant list. Exactly one of the two, never both, never
  -- neither.
  -- Exactly one of three kinds:
  --   is_general = the container's own thread (NOT a facet — it is membership
  --                in the container; encoding it as a facet is the error the
  --                2026-07-20 amendment forbids)
  --   facet_key  = a facet thread, audience derived from permissions
  --   label      = a free thread, audience explicit
  is_general      boolean NOT NULL DEFAULT false,
  facet_key       text REFERENCES public.facet (key) ON DELETE RESTRICT,
  label           text,

  created_by      uuid REFERENCES auth.users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  deleted_at      timestamptz,

  CONSTRAINT thread_at_most_one_parent CHECK (
    (project_id IS NOT NULL)::int
    + (line_id IS NOT NULL)::int
    + (performance_id IS NOT NULL)::int
    + (conversation_id IS NOT NULL)::int <= 1
  ),
  CONSTRAINT thread_kind_exactly_one CHECK (
    (is_general)::int + (facet_key IS NOT NULL)::int + (label IS NOT NULL)::int = 1
  )
);

COMMENT ON TABLE public.thread IS
  'A hub hangs off any container (ADR-083 §1). facet_key set = a facet thread, audience derived from permissions. label set = a free thread, audience explicit. The general thread of a container is a facet-less, label-less row — see thread_general below.';

COMMENT ON COLUMN public.thread.is_general IS
  'The container''s own thread. Audience = the container''s members, full stop. Not a facet and never a permission row (ADR-082 amendment 2026-07-20).';

-- One facet thread per container per facet; one general thread per container.
CREATE UNIQUE INDEX thread_one_per_facet ON public.thread (
  coalesce(project_id, line_id, performance_id, conversation_id, workspace_id), facet_key
) WHERE facet_key IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX thread_one_general ON public.thread (
  coalesce(project_id, line_id, performance_id, conversation_id, workspace_id)
) WHERE is_general AND deleted_at IS NULL;

CREATE INDEX thread_ws_idx   ON public.thread (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX thread_recent_idx ON public.thread (workspace_id, last_message_at DESC NULLS LAST) WHERE deleted_at IS NULL;

-- Explicit participants: free threads always, and guests wherever they were
-- invited. ADR-085 §5: a free thread NEVER inherits guests granted at facet
-- level — it always has its own list.
CREATE TABLE public.thread_participant (
  thread_id  uuid NOT NULL REFERENCES public.thread (id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES public.person (id) ON DELETE CASCADE,
  added_by   uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, person_id)
);

CREATE TABLE public.message (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  thread_id    uuid NOT NULL REFERENCES public.thread (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspace (id) ON DELETE CASCADE,

  -- The author is a PERSON, not a user. An invitat writes and has no login
  -- (ADR-085 §4), and revoking is not erasing (§7) — so attribution must
  -- survive the account that may never have existed.
  author_person_id uuid NOT NULL REFERENCES public.person (id) ON DELETE RESTRICT,
  author_user_id   uuid REFERENCES auth.users (id),

  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);

COMMENT ON COLUMN public.message.author_person_id IS
  'Author is a person, never a user: guests write (ADR-085 §4) and what they wrote stays when their access ends (§7). author_user_id is the login that typed it, when there was one.';

CREATE INDEX message_thread_idx ON public.message (thread_id, created_at DESC) WHERE deleted_at IS NULL;

--------------------------------------------------------------------------------
-- 6. Audience resolution
--------------------------------------------------------------------------------
-- The formula, once, for both kinds of thread (ADR-085 §6):
--
--     audience = derived(facet, container) ∪ explicitly invited
--
-- A free thread's derived set is empty, so the same expression covers it. This
-- is the simplification that replaced ADR-083 §5's two audience models.

-- Ancestors-or-self of a container, as a level/id pair set. A membership at any
-- of these covers the container — that IS the union rule (ADR-082 §3).
-- Ancestors-or-self of a container. A membership at any of these covers the
-- container — that IS the union rule (ADR-082 §3).
--
-- Reads the DENORMALISED fks that `performance`, `line` and `conversation`
-- already carry instead of walking upward. Not an optimisation, a correctness
-- fix: `performance.line_id` is NULLABLE, so a gig with no line would have lost
-- its project and workspace on the way up, and with them every permission
-- granted above.
CREATE OR REPLACE FUNCTION public.container_chain(
  p_workspace uuid, p_project uuid, p_line uuid, p_performance uuid,
  p_conversation uuid DEFAULT NULL
) RETURNS TABLE (level public.container_level, id uuid) AS $$
  WITH r AS (
    SELECT
      p_performance AS perf_id,
      coalesce(p_line,
               (SELECT pf.line_id FROM public.performance pf WHERE pf.id = p_performance)) AS line_id,
      coalesce(p_project,
               (SELECT pf.project_id FROM public.performance pf  WHERE pf.id = p_performance),
               (SELECT l.project_id  FROM public.line l          WHERE l.id  = p_line),
               (SELECT cv.project_id FROM public.conversation cv WHERE cv.id = p_conversation)) AS project_id,
      coalesce(p_workspace,
               (SELECT pf.workspace_id FROM public.performance pf  WHERE pf.id = p_performance),
               (SELECT l.workspace_id  FROM public.line l          WHERE l.id  = p_line),
               (SELECT cv.workspace_id FROM public.conversation cv WHERE cv.id = p_conversation),
               (SELECT pr.workspace_id FROM public.project pr      WHERE pr.id = p_project)) AS workspace_id
  )
  SELECT 'performance'::public.container_level, perf_id      FROM r WHERE perf_id      IS NOT NULL
  UNION ALL SELECT 'line'::public.container_level,      line_id      FROM r WHERE line_id      IS NOT NULL
  UNION ALL SELECT 'project'::public.container_level,   project_id   FROM r WHERE project_id   IS NOT NULL
  UNION ALL SELECT 'workspace'::public.container_level, workspace_id FROM r WHERE workspace_id IS NOT NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- SECURITY DEFINER + no caller check = a cross-tenant structure oracle if left
-- callable by PostgREST. It is an internal helper, so lock it down.
REVOKE EXECUTE ON FUNCTION public.container_chain(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Is the caller a live member ANYWHERE on the container's chain? This is what
-- "the container's members" means, and it is what the general thread uses.
-- `accepted_at` is required, matching every other gate in the codebase
-- (is_workspace_member, current_workspace_role, has_permission) — a pending
-- invitation must not already carry access.
CREATE OR REPLACE FUNCTION public.is_container_member(
  p_workspace uuid, p_project uuid, p_line uuid, p_performance uuid,
  p_conversation uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.container_chain(p_workspace, p_project, p_line, p_performance, p_conversation) c
    JOIN public.membership m
      ON  m.user_id     = auth.uid()
      AND m.revoked_at  IS NULL
      AND m.accepted_at IS NOT NULL
      AND (m.ends_at IS NULL OR m.ends_at > now())
      AND ( (c.level = 'workspace'   AND m.workspace_id   = c.id AND m.project_id IS NULL AND m.line_id IS NULL AND m.performance_id IS NULL)
         OR (c.level = 'project'     AND m.project_id     = c.id)
         OR (c.level = 'line'        AND m.line_id        = c.id)
         OR (c.level = 'performance' AND m.performance_id = c.id) )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- Does the CURRENT user hold `p_facet` at `p_verb` or better, anywhere on the
-- chain? Workspace owner/admin bypasses, identical to has_permission (ADR-006)
-- — one bypass rule, not two.
CREATE OR REPLACE FUNCTION public.has_facet(
  p_workspace uuid, p_project uuid, p_line uuid, p_performance uuid,
  p_facet text, p_verb public.facet_verb DEFAULT 'view',
  p_conversation uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_membership wm
    WHERE wm.user_id = auth.uid()
      AND wm.accepted_at IS NOT NULL
      AND wm.role IN ('owner', 'admin')
      AND wm.workspace_id = (
        SELECT c.id FROM public.container_chain(p_workspace, p_project, p_line, p_performance, p_conversation) c
        WHERE c.level = 'workspace' LIMIT 1
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.container_chain(p_workspace, p_project, p_line, p_performance, p_conversation) c
    JOIN public.membership m
      ON  m.user_id     = auth.uid()
      AND m.revoked_at  IS NULL
      AND m.accepted_at IS NOT NULL
      AND (m.ends_at IS NULL OR m.ends_at > now())
      AND ( (c.level = 'workspace'   AND m.workspace_id   = c.id AND m.project_id IS NULL AND m.line_id IS NULL AND m.performance_id IS NULL)
         OR (c.level = 'project'     AND m.project_id     = c.id)
         OR (c.level = 'line'        AND m.line_id        = c.id)
         OR (c.level = 'performance' AND m.performance_id = c.id) )
    JOIN public.membership_facet mf
      ON  mf.membership_id = m.id
      AND mf.facet_key     = p_facet
      AND (mf.verb = 'edit' OR mf.verb = p_verb)   -- edit implies view
    -- A facet only counts where it exists. This is what makes "absent is not
    -- denied" true at the DB level and not only in the UI.
    JOIN public.facet_level fl
      ON  fl.facet_key = p_facet
      AND fl.level     = c.level
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.has_facet(uuid, uuid, uuid, uuid, text, public.facet_verb, uuid) IS
  'Effective facet check across the container chain (union of levels, ADR-082 §3). Requires accepted_at, like every other gate in the codebase. Does NOT replace has_permission — that stays untouched in stage 1.';

-- Can the current user read this thread? The one formula, three branches.
CREATE OR REPLACE FUNCTION public.can_read_thread(p_thread_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread t
    WHERE t.id = p_thread_id
      AND t.deleted_at IS NULL
      AND (
        -- explicitly invited. Identity comes from user_profile.person_id, the
        -- ONE user↔person bridge (ADR-072 §6) — never from membership, which
        -- says who a membership is FOR, not who is calling.
        EXISTS (
          SELECT 1 FROM public.thread_participant tp
          JOIN public.user_profile up
            ON up.person_id = tp.person_id AND up.user_id = auth.uid()
          WHERE tp.thread_id = t.id
        )
        -- the container's own thread: THE CONTAINER'S members, not the
        -- workspace's. is_workspace_member would have opened every general
        -- thread of every project and gig to every member of the space —
        -- exactly what the 2026-07-20 amendment forbids.
        OR (t.is_general AND public.is_container_member(
              t.workspace_id, t.project_id, t.line_id, t.performance_id, t.conversation_id))
        -- a facet thread: derived from the facet
        OR (t.facet_key IS NOT NULL AND public.has_facet(
              t.workspace_id, t.project_id, t.line_id, t.performance_id,
              t.facet_key, 'view', t.conversation_id))
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

--------------------------------------------------------------------------------
-- 7. Backfill — one way, from what exists
--------------------------------------------------------------------------------
-- person_id stays NULL: ADR-082 §6 forbids linking a login to a contact by
-- email match, and a migration is the worst possible place to do it silently.
-- Stage 2 links them as a deliberate act.

INSERT INTO public.membership (workspace_id, user_id, preset, accepted_at, invited_by, created_at)
SELECT wm.workspace_id, wm.user_id,
       CASE wm.role WHEN 'owner' THEN 'direccio' WHEN 'admin' THEN 'direccio' ELSE 'equip' END,
       wm.accepted_at, wm.invited_by, wm.created_at
FROM public.workspace_membership wm
WHERE NOT EXISTS (
  SELECT 1 FROM public.membership m
  WHERE m.workspace_id = wm.workspace_id AND m.user_id = wm.user_id
    AND m.project_id IS NULL AND m.line_id IS NULL AND m.performance_id IS NULL
);

INSERT INTO public.membership (workspace_id, project_id, user_id, preset, invited_by, created_at)
SELECT p.workspace_id, pm.project_id, pm.user_id, 'equip', pm.invited_by, pm.created_at
FROM public.project_membership pm
JOIN public.project p ON p.id = pm.project_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.membership m
  WHERE m.project_id = pm.project_id AND m.user_id = pm.user_id
);

--------------------------------------------------------------------------------
-- 8. RLS
--------------------------------------------------------------------------------

ALTER TABLE public.facet              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facet_level        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_facet   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message            ENABLE ROW LEVEL SECURITY;

-- The vocabulary is public to any authenticated user: knowing that a facet
-- called `diners` exists leaks nothing, and the UI needs it to render the
-- matrix. Writes are operator tooling only (no policy = no writes).
CREATE POLICY facet_select       ON public.facet       FOR SELECT TO authenticated USING (true);
CREATE POLICY facet_level_select ON public.facet_level FOR SELECT TO authenticated USING (true);

-- You see the memberships of workspaces you are in. That is what makes the
-- "who enters and why" view possible, and ADR-083 §5 requires it to be visible.
CREATE POLICY membership_select ON public.membership
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY membership_facet_select ON public.membership_facet
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.membership m
    WHERE m.id = membership_id AND public.is_workspace_member(m.workspace_id)
  ));

-- Threads: the one formula.
CREATE POLICY thread_select ON public.thread
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_read_thread(id));

CREATE POLICY thread_participant_select ON public.thread_participant
  FOR SELECT TO authenticated
  USING (public.can_read_thread(thread_id));

CREATE POLICY message_select ON public.message
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_read_thread(thread_id));

-- Writing a message requires READ on the thread and nothing more: if you can be
-- in the conversation you can speak in it. The view/edit axis gates the DATA of
-- a facet, not the right to talk about it — an invitat with `view` on tècnica
-- still writes in the tècnica thread (ADR-085 §4).
CREATE POLICY message_insert ON public.message
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_read_thread(thread_id)
    AND workspace_id = current_workspace_id()
    -- Bind the author to the caller, or any thread reader can post as anybody
    -- — including the promoter, in the diners thread. Same shape as
    -- person_note_insert (rls-policies.sql:621).
    AND author_user_id = auth.uid()
    AND author_person_id = (SELECT up.person_id FROM public.user_profile up WHERE up.user_id = auth.uid())
  );

-- Editing your own words only, and only in place: without the guards below a
-- user could UPDATE thread_id + workspace_id and drop an authentic-looking
-- message into a workspace they were never in.
CREATE POLICY message_update ON public.message
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_message_immutable_anchor()
RETURNS trigger AS $$
BEGIN
  IF NEW.thread_id        IS DISTINCT FROM OLD.thread_id
  OR NEW.workspace_id     IS DISTINCT FROM OLD.workspace_id
  OR NEW.author_person_id IS DISTINCT FROM OLD.author_person_id
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'message anchor is immutable (thread, workspace, author, created_at)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_guard_anchor BEFORE UPDATE ON public.message
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_immutable_anchor();

CREATE TRIGGER membership_set_updated_at BEFORE UPDATE ON public.membership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER thread_set_updated_at BEFORE UPDATE ON public.thread
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--------------------------------------------------------------------------------
-- 9. What stage 2 owes
--------------------------------------------------------------------------------
-- · link membership.person_id for the backfilled rows (deliberate, not by email)
-- · point has_permission() at `membership`, verify the ~11 money policies, then
--   drop workspace_membership / project_membership
-- · membership.person_id becomes NOT NULL
-- · INSERT/UPDATE policies for membership + membership_facet, once the granting
--   RPC exists (delegation bounded by the delegator: facet, verb AND level —
--   ADR-085 §10, enforced in the RPC, never in the client)
-- · thread INSERT policy, once "who may open a free thread" rides its RPC
--
-- TWO THINGS STAGE 1 CANNOT SHIP WITHOUT, found in review 2026-07-20:
-- · **No membership_facet rows exist and there is no path to write them**, so
--   no facet thread is readable by anyone but a workspace owner/admin. A
--   preset-expansion RPC is not stage-2 nice-to-have, it is what makes stage 1
--   non-dead.
-- · **The invitat cannot authenticate.** Every read path keys on auth.uid(),
--   and an invitat is by definition `user_id IS NULL`. The signed-link access
--   path (token table? scoped JWT? RPC under anon?) is undesigned. The schema
--   can STORE an invitat and nothing can let one read. Design decision, not a
--   bug fix.

--------------------------------------------------------------------------------
-- 10. Rollback
--------------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS message_guard_anchor ON public.message;
-- DROP TRIGGER IF EXISTS membership_set_updated_at ON public.membership;
-- DROP TRIGGER IF EXISTS thread_set_updated_at ON public.thread;
-- DROP FUNCTION IF EXISTS public.guard_message_immutable_anchor();
-- DROP FUNCTION IF EXISTS public.can_read_thread(uuid);
-- DROP FUNCTION IF EXISTS public.has_facet(uuid,uuid,uuid,uuid,text,public.facet_verb,uuid);
-- DROP FUNCTION IF EXISTS public.is_container_member(uuid,uuid,uuid,uuid,uuid);
-- DROP FUNCTION IF EXISTS public.container_chain(uuid,uuid,uuid,uuid,uuid);
-- DROP TABLE IF EXISTS public.message, public.thread_participant, public.thread,
--                      public.membership_facet, public.membership,
--                      public.facet_level, public.facet CASCADE;
-- DROP TYPE IF EXISTS public.facet_verb, public.container_level;
-- Nothing existing was altered, so there is nothing else to restore.

COMMIT;
