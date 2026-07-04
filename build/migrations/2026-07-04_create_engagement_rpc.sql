-- ADR-051: person + engagement creation RPC — the difusión can finally
-- capture a new contact/conversation from the UI. Sixth case of the
-- claim-bound INSERT pattern (engagement_insert requires workspace_id =
-- current_workspace_id()): SECURITY DEFINER + explicit checks instead.
-- Gate: has_permission(project, 'edit:engagement') — the domain rule for
-- the difusión loop, same code the UPDATE policy uses.
--
-- One atomic RPC covers both shapes:
--   · p_person_id      → link an existing person (must pass can_see_person
--                        — no blind linking by uuid).
--   · inline fields    → find-or-create the person. person.email is
--                        citext UNIQUE over ALL rows (soft-deleted rows
--                        still hold their email), so the resolution order
--                        is: live match → reuse; soft-deleted match →
--                        resurrect (a new conversation restarts the file);
--                        no match → insert.
--     Reused/resurrected persons only get blank fields filled (phone,
--     organization_name, title) — never overwritten.
--
-- Slugs follow the ADR-024 backfill scheme (reset-v2 §3.3): person slug =
-- slugify(full_name), globally unique among live rows, 6-hex id suffix on
-- collision (id-suffix, NOT numeric — "pep-2" could be a real person).
-- Engagement slug = its person's slug, (workspace, slug) unique, same
-- id-suffix on collision.
--
-- first/last_contacted_at default to now() — capturing a contact IS the
-- first touch; the inline editors adjust later if needed.
--
-- The (workspace, project, person) unique violation is NOT caught: it
-- surfaces as 23505 and the API maps it to 409 engagement_exists — the UI
-- must not silently merge into an existing conversation (it would
-- overwrite its status).

CREATE OR REPLACE FUNCTION public.create_engagement(
  p_project_id uuid,
  p_person_id uuid DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_organization_name text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_status public.engagement_status DEFAULT 'contacted',
  p_role text DEFAULT NULL,
  p_next_action_at timestamptz DEFAULT NULL,
  p_next_action_note text DEFAULT NULL
)
RETURNS public.engagement
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_full_name    text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email        text := nullif(btrim(coalesce(p_email, '')), '');
  v_person       public.person;
  v_person_id    uuid;
  v_slug         text;
  v_eng_id       uuid;
  v_eng_slug     text;
  v_eng          public.engagement;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.project
  WHERE id = p_project_id AND deleted_at IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_permission(p_project_id, 'edit:engagement') THEN
    RAISE EXCEPTION 'edit:engagement required to create an engagement'
      USING ERRCODE = '42501';
  END IF;

  -- ── Resolve the person ────────────────────────────────────────────────
  IF p_person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.person
    WHERE id = p_person_id AND deleted_at IS NULL;
    IF v_person.id IS NULL OR NOT public.can_see_person(p_person_id) THEN
      RAISE EXCEPTION 'person % not found', p_person_id USING ERRCODE = '42501';
    END IF;
    v_person_id := v_person.id;
  ELSE
    IF v_full_name IS NULL THEN
      RAISE EXCEPTION 'full_name is required when person_id is not given'
        USING ERRCODE = '22023';
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
    END IF;

    IF v_email IS NOT NULL THEN
      -- citext equality; matches soft-deleted rows too (full UNIQUE).
      SELECT * INTO v_person FROM public.person WHERE email = v_email;
    END IF;

    IF v_person.id IS NOT NULL THEN
      v_person_id := v_person.id;
      IF v_person.deleted_at IS NOT NULL THEN
        -- Resurrect: while deleted the slug left the partial unique index,
        -- so a live row may have claimed it — re-suffix if needed.
        v_slug := v_person.slug;
        IF EXISTS (
          SELECT 1 FROM public.person
          WHERE slug = v_slug AND deleted_at IS NULL AND id <> v_person_id
        ) THEN
          v_slug := v_slug || '-' ||
            substring(replace(v_person_id::text, '-', '') FROM 1 FOR 6);
        END IF;
        UPDATE public.person
        SET deleted_at = NULL, slug = v_slug
        WHERE id = v_person_id;
      END IF;
      -- Fill blanks only; an existing file is never overwritten.
      UPDATE public.person SET
        phone             = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
        organization_name = coalesce(organization_name, nullif(btrim(coalesce(p_organization_name, '')), '')),
        title             = coalesce(title, nullif(btrim(coalesce(p_title, '')), ''))
      WHERE id = v_person_id;
    ELSE
      v_person_id := public.uuid_generate_v7();
      v_slug := coalesce(nullif(public.slugify(v_full_name), ''), 'person');
      IF EXISTS (
        SELECT 1 FROM public.person WHERE slug = v_slug AND deleted_at IS NULL
      ) THEN
        v_slug := v_slug || '-' ||
          substring(replace(v_person_id::text, '-', '') FROM 1 FOR 6);
      END IF;
      INSERT INTO public.person (id, slug, full_name, email, phone, organization_name, title, created_by)
      VALUES (
        v_person_id, v_slug, v_full_name, v_email,
        nullif(btrim(coalesce(p_phone, '')), ''),
        nullif(btrim(coalesce(p_organization_name, '')), ''),
        nullif(btrim(coalesce(p_title, '')), ''),
        v_caller
      );
    END IF;
  END IF;

  -- ── Resurrect a soft-deleted conversation for the same triple ────────
  -- The (workspace, project, person) UNIQUE constraint is FULL — it
  -- includes soft-deleted rows — so a deleted conversation would block
  -- the triple forever. Mirror of the person-by-email resurrect above:
  -- re-adding the contact restarts the conversation (fresh status and
  -- next action; first_contacted_at keeps the original history).
  SELECT * INTO v_eng FROM public.engagement
  WHERE workspace_id = v_workspace_id
    AND project_id = p_project_id
    AND person_id = v_person_id
    AND deleted_at IS NOT NULL;
  IF v_eng.id IS NOT NULL THEN
    v_eng_slug := v_eng.slug;
    -- While deleted its slug left the partial unique index — re-suffix if
    -- a live engagement claimed it.
    IF EXISTS (
      SELECT 1 FROM public.engagement
      WHERE workspace_id = v_workspace_id AND slug = v_eng_slug
        AND deleted_at IS NULL AND id <> v_eng.id
    ) THEN
      v_eng_slug := v_eng_slug || '-' ||
        substring(replace(v_eng.id::text, '-', '') FROM 1 FOR 6);
    END IF;
    UPDATE public.engagement SET
      deleted_at = NULL,
      slug = v_eng_slug,
      status = p_status,
      role = nullif(btrim(coalesce(p_role, '')), ''),
      last_contacted_at = now(),
      next_action_at = p_next_action_at,
      next_action_note = nullif(btrim(coalesce(p_next_action_note, '')), '')
    WHERE id = v_eng.id
    RETURNING * INTO v_eng;
    RETURN v_eng;
  END IF;

  -- ── Create the engagement ─────────────────────────────────────────────
  v_eng_id := public.uuid_generate_v7();
  SELECT slug INTO v_eng_slug FROM public.person WHERE id = v_person_id;
  v_eng_slug := coalesce(v_eng_slug, 'engagement');
  IF EXISTS (
    SELECT 1 FROM public.engagement
    WHERE workspace_id = v_workspace_id AND slug = v_eng_slug AND deleted_at IS NULL
  ) THEN
    v_eng_slug := v_eng_slug || '-' ||
      substring(replace(v_eng_id::text, '-', '') FROM 1 FOR 6);
  END IF;

  -- The (workspace, project, person) unique violation deliberately
  -- propagates as 23505 → API 409 engagement_exists.
  INSERT INTO public.engagement (
    id, slug, workspace_id, project_id, person_id, status, role,
    first_contacted_at, last_contacted_at, next_action_at, next_action_note,
    created_by
  ) VALUES (
    v_eng_id, v_eng_slug, v_workspace_id, p_project_id, v_person_id,
    p_status,
    nullif(btrim(coalesce(p_role, '')), ''),
    now(), now(), p_next_action_at,
    nullif(btrim(coalesce(p_next_action_note, '')), ''),
    v_caller
  )
  RETURNING * INTO v_eng;

  RETURN v_eng;
END;
$function$;

-- Grants: strip the default PUBLIC EXECUTE (a bare REVOKE FROM anon leaves
-- it in place — ADR-043 review lesson), authenticated only.
REVOKE ALL ON FUNCTION public.create_engagement(uuid, uuid, text, text, text, text, text, public.engagement_status, text, timestamptz, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_engagement(uuid, uuid, text, text, text, text, text, public.engagement_status, text, timestamptz, text) TO authenticated;
