-- ADR-093 — `note`, the private post-it. And `person_note` dies into it.
--
-- A note is ALWAYS private (§2). What the team sees is comms, and comms is ONE
-- polymorphic mechanism (ADR-083 §1) — a table of shared, signed, audienced
-- notes would have been the second one, built eleven days after signing that
-- there would only ever be one. So: no signatures, no stack, no audience.
--
-- TWO coordinates, not one (§1). The ANCHOR says what the note is about; the
-- DAY says where it lives on the calendar. They are independent because the
-- margin has to exist on an empty day ("I can open a day with nothing in it and
-- still decide I have something to write"), so `on_day` cannot be derived from
-- the anchor — and because the five example notes in Marco's own prototype were
-- about a performance, a conversation or a person, never about the day.
-- Zero anchors is valid and means "the company"; the mould is
-- `task_at_most_one_parent`, FKs + CHECK, not a loose container_type/id (§4).
--
-- It nace with the shape `message` will need (§4). When comms lands, nothing
-- migrates: it gains an audience and a thread, and the first season of writing
-- is already in the rows. The table may know what it aspires to; the interface
-- must not promise it — on screen this is a post-it and nothing else.
--
-- `person_note` is absorbed NOW because only now is it free (§5): field for
-- field the same table with the anchor nailed to a person, and zero rows in
-- production despite having a table, two RPCs, an endpoint, a privacy toggle
-- and a green E2E. Rows are copied anyway, so a fixture-loaded local or staging
-- database survives this too. It also kills a latent bug: `person_note_select`
-- demanded `read:person_note_private` over SOME project of the workspace in
-- order to read YOUR OWN private note.
--
-- Deliberately NOT here:
--   · `conversation_id` and `bolo_id` anchors — comms owns the first (§4), and
--     nothing in the Planner draws the second.
--   · `parent_id` / `thread_id` — replying to someone's note is comms, and a
--     different size of project entirely (§ Rejected).
--   · a policy for `visibility = 'workspace'` — nothing can produce that value
--     yet, and a policy for an unreachable value is surface without a user (§5).
--     The enum carries it so the column is ready. That is all.
--   · retiring the `read:person_note_private` permission. It goes dead today,
--     but it is seeded into six roles and named in the closed-vocabulary
--     comment on `workspace_role.permissions`; that is its own migration.
--   · an `update_note` RPC. Rewriting the body gates on `author_id =
--     auth.uid()` alone, so PostgREST-direct is already correct.
--
-- `delete_note` DOES exist, and the reason is worth writing down because it
-- looks like ceremony and is not. Deletion is soft (ADR-048), i.e. an UPDATE
-- setting `deleted_at` — and Postgres enforces the SELECT policy against the
-- NEW row of an UPDATE, so `deleted_at IS NULL` in `note_select` makes a client
-- soft delete fail with 42501 every time. Verified empirically here: with
-- `WITH CHECK (true)` on `note_update` it still failed, and it only passed once
-- `deleted_at IS NULL` came out of `note_select`. That is exactly why
-- `delete_person_note` existed, and dropping it without a replacement would
-- have shipped a note nobody could delete.

-- ── The enum ──────────────────────────────────────────────────────────────
-- Same two values as `person_note_visibility`, which this replaces. 'workspace'
-- exists to be the seam comms writes through; nothing writes it today.
CREATE TYPE public.note_visibility AS ENUM ('private', 'workspace');

ALTER TYPE public.note_visibility OWNER TO postgres;

-- ── The table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.note (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    workspace_id uuid NOT NULL,
    author_id uuid NOT NULL,
    -- The ladder (§4): project · line · performance · date · person.
    project_id uuid,
    line_id uuid,
    performance_id uuid,
    date_id uuid,
    person_id uuid,
    -- Where it lives on the calendar. NOT NULL: every note is written from a
    -- day, even one about a performance three months out.
    on_day date NOT NULL,
    visibility public.note_visibility DEFAULT 'private'::public.note_visibility NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT note_body_nonempty CHECK ((length(btrim(body)) > 0)),
    -- Zero is valid and means "the company" (§4) — copied from
    -- `task_at_most_one_parent`, same shape, same intent.
    CONSTRAINT note_at_most_one_anchor CHECK (
        (((project_id IS NOT NULL))::integer
       + ((line_id IS NOT NULL))::integer
       + ((performance_id IS NOT NULL))::integer
       + ((date_id IS NOT NULL))::integer
       + ((person_id IS NOT NULL))::integer) <= 1
    )
);

-- ENABLE *and* FORCE. FORCE alone is inert — it only decides whether the table
-- owner is also subject, and if RLS was never enabled the policies below are
-- never evaluated at all. The checkpoint dump lists the two in far-apart
-- sections, which is exactly how you copy one and miss the other.
ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.note FORCE ROW LEVEL SECURITY;
ALTER TABLE public.note OWNER TO postgres;

COMMENT ON TABLE public.note IS
  'The private post-it (ADR-093). Always private in v1: what the team sees is comms (ADR-083). Anchor says what it is about, on_day says where it lives; zero anchors = the company. Shaped for `message` so comms migrates nothing.';

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_workspace_id_fkey FOREIGN KEY (workspace_id)
    REFERENCES public.workspace(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_author_id_fkey FOREIGN KEY (author_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.project(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_line_id_fkey FOREIGN KEY (line_id)
    REFERENCES public.line(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_performance_id_fkey FOREIGN KEY (performance_id)
    REFERENCES public.performance(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_date_id_fkey FOREIGN KEY (date_id)
    REFERENCES public."date"(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.note
    ADD CONSTRAINT note_person_id_fkey FOREIGN KEY (person_id)
    REFERENCES public.person(id) ON DELETE CASCADE;

-- ── Indexes ───────────────────────────────────────────────────────────────
-- The margin's own query: "my notes, this workspace, this month".
CREATE INDEX note_author_day_idx ON public.note
    USING btree (author_id, on_day) WHERE (deleted_at IS NULL);

CREATE INDEX note_workspace_day_idx ON public.note
    USING btree (workspace_id, on_day) WHERE (deleted_at IS NULL);

-- One per FK: the advisors count unindexed foreign keys, and each of these is
-- also a real read path (the person dossier reads by person_id).
CREATE INDEX note_project_idx ON public.note
    USING btree (project_id) WHERE (deleted_at IS NULL AND project_id IS NOT NULL);

CREATE INDEX note_line_idx ON public.note
    USING btree (line_id) WHERE (deleted_at IS NULL AND line_id IS NOT NULL);

CREATE INDEX note_performance_idx ON public.note
    USING btree (performance_id) WHERE (deleted_at IS NULL AND performance_id IS NOT NULL);

CREATE INDEX note_date_idx ON public.note
    USING btree (date_id) WHERE (deleted_at IS NULL AND date_id IS NOT NULL);

CREATE INDEX note_person_idx ON public.note
    USING btree (person_id) WHERE (deleted_at IS NULL AND person_id IS NOT NULL);

-- ── Anchors are fixed at creation ─────────────────────────────────────────
-- Clone of `guard_immutable_task_parents`, same reasoning: a relink would need
-- cross-workspace coherence guards the app does not carry, and this closes the
-- PostgREST-direct path (re-anchoring your own note to a container in another
-- workspace would leave workspace_id disagreeing with the anchor).
CREATE OR REPLACE FUNCTION public.guard_immutable_note_anchor() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.project_id     IS DISTINCT FROM OLD.project_id
  OR NEW.line_id        IS DISTINCT FROM OLD.line_id
  OR NEW.performance_id IS DISTINCT FROM OLD.performance_id
  OR NEW.date_id        IS DISTINCT FROM OLD.date_id
  OR NEW.person_id      IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'note anchor is immutable — delete and rewrite'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_immutable_note_anchor() OWNER TO postgres;

COMMENT ON FUNCTION public.guard_immutable_note_anchor() IS
  'A note anchor is fixed at creation (ADR-093). Same reasoning as guard_immutable_task_parents: a relink needs cross-workspace coherence the app does not carry.';

-- ── Triggers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER note_set_updated_at BEFORE UPDATE ON public.note
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER note_guard_author BEFORE UPDATE ON public.note
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_author();

CREATE OR REPLACE TRIGGER note_guard_ws BEFORE UPDATE ON public.note
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_workspace_id();

CREATE OR REPLACE TRIGGER note_guard_anchor BEFORE UPDATE ON public.note
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_note_anchor();

CREATE OR REPLACE TRIGGER note_audit AFTER INSERT OR DELETE OR UPDATE ON public.note
    FOR EACH ROW EXECUTE FUNCTION public.write_audit();

-- ── Grants ────────────────────────────────────────────────────────────────
-- No `anon`. `person_note` carried a GRANT to anon that meant nothing (RLS
-- forced, every policy needs auth.uid()), and 20260730164608 already started
-- retiring that class of grant. No DELETE either: deletion is soft (ADR-048),
-- which is an UPDATE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.note TO authenticated;
GRANT ALL ON TABLE public.note TO service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Author, and a member of the workspace. Nothing else (§5). No permission
-- check: needing a project-scoped grant to read your own post-it is exactly
-- the bug this replaces.
CREATE POLICY note_select ON public.note
    FOR SELECT TO authenticated
    USING (
      (deleted_at IS NULL)
      AND (author_id = (SELECT auth.uid()))
      AND public.is_workspace_member(workspace_id)
    );

CREATE POLICY note_insert ON public.note
    FOR INSERT TO authenticated
    WITH CHECK (
      (workspace_id = public.current_workspace_id())
      AND public.is_workspace_member(workspace_id)
      AND (author_id = (SELECT auth.uid()))
    );

CREATE POLICY note_update ON public.note
    FOR UPDATE TO authenticated
    USING (
      (deleted_at IS NULL)
      AND (author_id = (SELECT auth.uid()))
      AND public.is_workspace_member(workspace_id)
    )
    WITH CHECK (
      (author_id = (SELECT auth.uid()))
      AND public.is_workspace_member(workspace_id)
    );

-- ── create_note ───────────────────────────────────────────────────────────
-- The INSERT policy is claim-bound (`workspace_id = current_workspace_id()`)
-- and the app does not re-mint a token per workspace, so a direct insert would
-- only ever work for the workspace the claim happens to name. Same reason
-- `create_task`, `create_date` and `add_cast_member` exist.
--
-- The workspace is DERIVED from the anchor, never taken from the caller —
-- that is the integrity point of the whole table. A person anchor is the one
-- exception: a person is portable and can hold a dossier in several
-- workspaces, so the caller must say which, and the dossier must exist there
-- (the consent boundary of ADR-085 — no dossier, no note).
CREATE OR REPLACE FUNCTION public.create_note(
    p_body text,
    p_on_day date,
    p_workspace_id uuid DEFAULT NULL::uuid,
    p_project_id uuid DEFAULT NULL::uuid,
    p_line_id uuid DEFAULT NULL::uuid,
    p_performance_id uuid DEFAULT NULL::uuid,
    p_date_id uuid DEFAULT NULL::uuid,
    p_person_id uuid DEFAULT NULL::uuid
) RETURNS public.note
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_body         text := nullif(btrim(coalesce(p_body, '')), '');
  v_workspace_id uuid;
  v_anchors      int  := num_nonnulls(p_project_id, p_line_id, p_performance_id, p_date_id, p_person_id);
  v_note         public.note;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_anchors > 1 THEN
    RAISE EXCEPTION 'at most one of project_id / line_id / performance_id / date_id / person_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'body cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_on_day IS NULL THEN
    RAISE EXCEPTION 'on_day is required' USING ERRCODE = '22023';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.project WHERE id = p_project_id AND deleted_at IS NULL;
  ELSIF p_line_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.line WHERE id = p_line_id AND deleted_at IS NULL;
  ELSIF p_performance_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.performance WHERE id = p_performance_id AND deleted_at IS NULL;
  ELSIF p_date_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public."date" WHERE id = p_date_id AND deleted_at IS NULL;
  ELSIF p_person_id IS NOT NULL THEN
    -- Portable identity: the caller names the workspace, and the dossier has
    -- to be there. Without it there is nothing local to write a note about.
    IF p_workspace_id IS NULL THEN
      RAISE EXCEPTION 'workspace_id is required for a note about a person'
        USING ERRCODE = '22023';
    END IF;
    SELECT wp.workspace_id INTO v_workspace_id
    FROM public.workspace_person wp
    WHERE wp.workspace_id = p_workspace_id
      AND wp.person_id = p_person_id
      AND wp.deleted_at IS NULL;
  ELSE
    IF p_workspace_id IS NULL THEN
      RAISE EXCEPTION 'workspace_id is required for a note with no anchor'
        USING ERRCODE = '22023';
    END IF;
    v_workspace_id := p_workspace_id;
  END IF;

  IF p_workspace_id IS NOT NULL AND p_person_id IS NULL AND v_anchors = 1 THEN
    RAISE EXCEPTION 'workspace_id only applies to a note with no anchor, or one about a person'
      USING ERRCODE = '22023';
  END IF;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_member(v_workspace_id) THEN
    -- Not-found and no-membership collapse (no existence oracle).
    RAISE EXCEPTION 'anchor not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.note (
    workspace_id, author_id, project_id, line_id, performance_id, date_id,
    person_id, on_day, body
  ) VALUES (
    v_workspace_id, v_caller, p_project_id, p_line_id, p_performance_id,
    p_date_id, p_person_id, p_on_day, v_body
  )
  RETURNING * INTO v_note;

  RETURN v_note;
END;
$$;

ALTER FUNCTION public.create_note(text, date, uuid, uuid, uuid, uuid, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_note(text, date, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_note(text, date, uuid, uuid, uuid, uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.create_note(text, date, uuid, uuid, uuid, uuid, uuid, uuid) IS
  'Writes a private note (ADR-093). Workspace is derived from the anchor — a person anchor is the exception, since identity is portable and the dossier must exist in the named workspace (ADR-085).';

-- ── delete_note ───────────────────────────────────────────────────────────
-- Soft delete (ADR-048). SECURITY DEFINER because the client cannot do this
-- itself: Postgres checks the SELECT policy against the new row of an UPDATE,
-- and `note_select` requires `deleted_at IS NULL`, so the very act of setting
-- it is a 42501. Straight clone of the retired `delete_person_note`.
CREATE OR REPLACE FUNCTION public.delete_note(p_note_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — RPC requires authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.note
  SET deleted_at = now()
  WHERE id = p_note_id
    AND author_id = v_caller
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    -- Not-yours and not-found collapse: no existence oracle.
    RAISE EXCEPTION 'note not found or not yours' USING ERRCODE = '42501';
  END IF;
END;
$$;

ALTER FUNCTION public.delete_note(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_note(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_note(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_note(uuid) IS
  'Soft-deletes your own note (ADR-093/ADR-048). Exists because the SELECT policy is enforced against the new row of an UPDATE, so a client cannot set deleted_at itself.';

-- ── person_note dies ──────────────────────────────────────────────────────
-- Zero rows in production (verified 2026-07-31), but fixtures write them, so
-- copy before dropping rather than assert. `created_at::date` is the honest
-- day: it is the day the note was written, which is exactly what `on_day`
-- means. Visibility collapses to private — an exception on day one kills the
-- rule of §2.
INSERT INTO public.note (
    id, workspace_id, author_id, person_id, on_day, visibility, body,
    created_at, updated_at, deleted_at
)
SELECT
    pn.id, pn.workspace_id, pn.author_id, pn.person_id,
    (pn.created_at AT TIME ZONE 'UTC')::date,
    'private'::public.note_visibility,
    pn.body, pn.created_at, pn.updated_at, pn.deleted_at
FROM public.person_note pn
WHERE EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = pn.workspace_id)
  AND EXISTS (SELECT 1 FROM public.person p WHERE p.id = pn.person_id);

-- BY NAME, NOT BY SIGNATURE (2026-08-10, and this is the whole reason the
-- first production apply failed and rolled back).
--
-- `DROP FUNCTION IF EXISTS f(uuid, uuid, text, person_note_visibility)` drops
-- exactly one overload and stays SILENT when nothing matches — so on a
-- database carrying a different overload than the checkpoint records, both
-- drops succeeded at doing nothing, the table went, and `DROP TYPE` then
-- failed on a function nobody could see. It rolled back cleanly (`note`
-- absent, `person_note` intact), which is the only reason this is a footnote
-- and not an incident.
--
-- A retirement must not depend on guessing the argument list of what it is
-- retiring. The catalog knows; ask it.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT oid::regprocedure::text AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_person_note', 'delete_person_note')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

DROP TABLE IF EXISTS public.person_note;

-- And if ANYTHING still holds the type, name it instead of failing with a
-- symptom. `deptype = 'i'` is the enum's own array type, which goes with it.
DO $$
DECLARE holders text;
BEGIN
  SELECT string_agg(DISTINCT holder, ', ')
  INTO holders
  FROM (
    SELECT CASE
             WHEN d.classid = 'pg_proc'::regclass THEN 'function ' || d.objid::regprocedure::text
             WHEN d.classid = 'pg_class'::regclass THEN 'relation ' || d.objid::regclass::text
             ELSE d.classid::regclass::text || ' oid ' || d.objid::text
           END AS holder
    FROM pg_depend d
    WHERE d.refclassid = 'pg_type'::regclass
      AND d.refobjid = 'public.person_note_visibility'::regtype
      AND d.deptype <> 'i'
  ) s;

  IF holders IS NOT NULL THEN
    RAISE EXCEPTION 'person_note_visibility is still held by: %', holders;
  END IF;
END;
$$;

DROP TYPE IF EXISTS public.person_note_visibility;
